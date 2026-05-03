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
 */
export function getOrCreateName(
  input: string,
  store: Map<string, NameEntry>,
  lineNumber: number
): GetOrCreateNameResult {
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
