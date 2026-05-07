// ============================================================
// Universal Name Normalization (Universal Name Handling spec)
// ============================================================
//
// One pinned algorithm shared by every chart-type parser that
// auto-creates entities on first use. Two source-distinct names
// that normalize to the same key are treated as the same entity;
// the FIRST-SEEN casing/spacing wins for display.
//
// Pinned algorithm (do not vary across parsers):
//   1. NFC normalize the input
//   2. Replace runs of Unicode whitespace with a single ASCII space
//   3. Trim leading/trailing whitespace
//   4. Case-fold via `toLocaleLowerCase('en-US')`
//
// The `en-US` locale is intentional — language-neutral case folding
// would silently diverge across parsers (Turkish dotted/dotless I,
// German ß) the moment a build environment changed locale defaults.
//
// See `docs/dgmo-language-spec.md` § "Universal Name Handling".

/** Module-scoped — Unicode-aware whitespace run. */
const WHITESPACE_RUN_RE = /\s+/gu;

/**
 * Reduce a name to its canonical key for equality comparison.
 *
 * Idempotent: `normalizeName(normalizeName(x)) === normalizeName(x)`.
 *
 * The returned key is for equality only — never display it. Callers
 * that need to render a name should use the `displayLabel` field of
 * the `NameEntry` returned by `getOrCreateName`.
 */
export function normalizeName(input: string): string {
  return input
    .normalize('NFC')
    .replace(WHITESPACE_RUN_RE, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

/**
 * Reduce a name to its display form: NFC normalize and trim only.
 *
 * Casing AND internal whitespace are preserved verbatim — the spec
 * says "first-seen casing/spacing wins for display" (ADR-002), so a
 * double space typed by the user survives into the rendered label.
 * Renderers may collapse it for layout, but the source-of-truth is
 * what the user typed.
 *
 * Two inputs that share the same `normalizeName(...)` key but have
 * different `displayName(...)` values are a "merge" — surfaced via
 * the `NAME_MERGED` diagnostic.
 */
export function displayName(input: string): string {
  return input.normalize('NFC').trim();
}

/**
 * One entity, identified by its normalized key.
 *
 * Parsers either use this shape directly in their entity Map or
 * compose it into a richer per-chart node type. Equality MUST use
 * only `normalizedKey`; rendering MUST use only `displayLabel`.
 */
export interface NameEntry {
  /** Output of `normalizeName(input)` — the lookup key. */
  normalizedKey: string;
  /** First-seen casing/spacing — what gets rendered. */
  displayLabel: string;
  /** 1-based source line where the name was first declared. */
  declaredLine: number;
}

/**
 * Result of an entity insertion attempt.
 *
 * `created` is true on first sighting. `merged` is present iff the
 * input collided with an existing entry AND the displayed forms
 * differ — that is the case worth reporting via `NAME_MERGED`.
 * Identical re-declarations produce neither `created` nor `merged`.
 */
export interface GetOrCreateNameResult {
  entry: NameEntry;
  created: boolean;
  merged?: {
    existingLine: number;
    existingDisplay: string;
    incomingDisplay: string;
  };
}

/**
 * Insert-or-fetch helper for `Map<normalizedKey, NameEntry>` stores.
 *
 * Parsers that need a richer node type (e.g. flowchart's `Node`
 * carries shape + edges) should wrap this helper: call it for the
 * normalization + merge-detection bookkeeping, then store the result
 * in their own `Map<normalizedKey, RichNode>`.
 *
 * When an `aliasStore` is provided, alias resolution runs FIRST: an
 * exact-match (case-sensitive) hit returns the bound canonical entry
 * untouched (the alias literal does NOT contribute to display or
 * merge bookkeeping). Misses fall through to UNH normalization.
 */
export function getOrCreateName(
  input: string,
  store: Map<string, NameEntry>,
  lineNumber: number,
  aliasStore?: AliasMap
): GetOrCreateNameResult {
  // Alias resolution is exact-match, case-sensitive, never normalized.
  // A miss falls through to UNH; a hit short-circuits with the bound
  // canonical entry — see B5 in the tech-spec.
  if (aliasStore !== undefined) {
    const aliased = aliasStore.get(input.trim());
    if (aliased !== undefined) {
      return { entry: aliased, created: false };
    }
  }

  const key = normalizeName(input);
  const incomingDisplay = displayName(input);

  const existing = store.get(key);
  if (existing) {
    if (existing.displayLabel !== incomingDisplay) {
      return {
        entry: existing,
        created: false,
        merged: {
          existingLine: existing.declaredLine,
          existingDisplay: existing.displayLabel,
          incomingDisplay,
        },
      };
    }
    return { entry: existing, created: false };
  }

  const entry: NameEntry = {
    normalizedKey: key,
    displayLabel: incomingDisplay,
    declaredLine: lineNumber,
  };
  store.set(key, entry);
  return { entry, created: true };
}

// ============================================================
// Universal Alias Map (sibling structure — TD-18)
// ============================================================
//
// Aliases are short-token bindings to existing `NameEntry` records.
// Distinct from UNH normalization: aliases are exact-match,
// case-sensitive ASCII tokens. `pm` and `PM` are different aliases.
//
// The map is per-parse — never persisted. LSP incremental-parse
// implementations MUST clear and rebuild from scratch (C8). See the
// `ParseContext` shape below for the threading model.

/** alias literal → bound canonical entry. Exact-match, case-sensitive. */
export type AliasMap = Map<string, NameEntry>;

export function createAliasMap(): AliasMap {
  return new Map();
}

export interface AliasBindingResult {
  /** Successful binding. */
  bound?: { alias: string; entry: NameEntry };
  /** Diagnostic-relevant rejection — caller emits the appropriate code. */
  conflict?:
    | { kind: 'collision'; existingEntry: NameEntry }
    | { kind: 'rebinding'; existingAlias: string }
    | { kind: 'shadows-name'; existingEntry: NameEntry };
}

/**
 * Register `alias → entry` after the alias has already passed
 * format validation in `extract-alias.ts`.
 *
 * Detects collision / rebinding / shadows-name. The `alias-of-alias`
 * case is checked at the CALLER level (parser pre-flight on the
 * canonical-side `aliasStore.has(canonical)`), not here — that case
 * is a property of the DECLARATION, not of the binding op itself.
 *
 * Does NOT emit diagnostics — returns the conflict shape so the
 * caller can use the canonical message factories with the right
 * context (line numbers, conflicting-canonical strings) per C7.
 */
export function bindAlias(
  alias: string,
  entry: NameEntry,
  aliasStore: AliasMap,
  nameStore: Map<string, NameEntry>
): AliasBindingResult {
  // collision: alias literal already bound to a different entry.
  const existingBinding = aliasStore.get(alias);
  if (existingBinding !== undefined && existingBinding !== entry) {
    return { conflict: { kind: 'collision', existingEntry: existingBinding } };
  }

  // shadows-name: the alias literal (after UNH normalization) collides
  // with an existing canonical entry. Pre-1.0 token-collision check —
  // covers `pm` clashing with a canonical `PM` typed earlier.
  const normalizedAlias = normalizeName(alias);
  const shadowed = nameStore.get(normalizedAlias);
  if (shadowed !== undefined && shadowed !== entry) {
    return { conflict: { kind: 'shadows-name', existingEntry: shadowed } };
  }

  // rebinding: this entry already has a different alias bound to it.
  for (const [existingAlias, existingEntry] of aliasStore) {
    if (existingEntry === entry && existingAlias !== alias) {
      return { conflict: { kind: 'rebinding', existingAlias } };
    }
  }

  aliasStore.set(alias, entry);
  return { bound: { alias, entry } };
}

/**
 * Pre-flight check: returns true if the given canonical literal
 * (LHS of a `Name as <alias>` declaration) is itself already a
 * registered alias. The caller then emits `E_ALIAS_OF_ALIAS`.
 */
export function isAliasLiteral(
  canonical: string,
  aliasStore: AliasMap
): boolean {
  return aliasStore.has(canonical.trim());
}

// ============================================================
// ParseContext (W2 threading model)
// ============================================================
//
// Per-parse context object threaded through helper calls. Zero
// module-level state: each parser entry-point creates a fresh
// `ParseContext` so an LSP edit-and-reparse cycle starts with an
// empty alias map (C8).

import type { DgmoError } from '../diagnostics.js';

export interface ParseContext {
  nameStore: Map<string, NameEntry>;
  nameAliasMap: AliasMap;
  diagnostics: DgmoError[];
  /** 1-based; updated as the parser advances. */
  lineNumber: number;
}

export function createParseContext(): ParseContext {
  return {
    nameStore: new Map(),
    nameAliasMap: createAliasMap(),
    diagnostics: [],
    lineNumber: 0,
  };
}
