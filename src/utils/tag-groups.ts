// ============================================================
// Shared tag-group types, regexes, and matchers
// ============================================================

import { stripQuotes, tokenizeQuoteAware } from './parsing';
import {
  ALIAS_DIAGNOSTIC_CODES,
  makeDgmoError,
  tagShorthandRemovedMessage,
  type DgmoError,
} from '../diagnostics';
import {
  CATEGORICAL_COLOR_ORDER,
  RECOGNIZED_COLOR_NAMES,
  resolveColor,
} from '../colors';
import type { PaletteColors } from '../palettes/types';
import type { Writable } from './brand';

/** A single entry inside a tag group: `Value color` */
export interface TagEntry {
  readonly value: string;
  readonly color: string;
  readonly lineNumber: number;
}

/**
 * A tag group block: heading + entries.
 *
 * Parser internals build via `Writable<TagGroup>` from `utils/brand.ts`;
 * once returned to a chart-type parser, consumers see the readonly view.
 */
export interface TagGroup {
  readonly name: string;
  readonly alias?: string;
  readonly entries: readonly TagEntry[];
  /** Default value for nodes without explicit metadata. First entry unless another is marked `default`. */
  readonly defaultValue?: string;
  readonly lineNumber: number;
}

/** Result of matching a tag block heading */
interface TagBlockMatch {
  name: string;
  alias: string | undefined;
  colorHint: string | undefined;
  /** Inline tag values parsed from single-line form (e.g., `tag Priority as p High red, Low blue`) */
  // eOPT: widened — constructor always assigns this slot
  inlineValues?: string[] | undefined;
  /**
   * If the heading used the legacy `tag Name <alias>` (bare shorthand)
   * or `tag Name alias <alias>` (explicit-keyword) syntax, this is set
   * so the calling parser can emit `E_TAG_SHORTHAND_REMOVED`. Pre-1.0
   * hard-break — bare shorthand still parses for graceful degradation
   * but is no longer a valid form.
   */
  // eOPT: widened — constructor always assigns this slot
  legacyForm?: 'bare-shorthand' | 'alias-keyword' | undefined;
}

// ── Default Modifier ────────────────────────────────────────

/**
 * Strip trailing `default` keyword from a tag entry string.
 * Returns the cleaned text and whether the keyword was present.
 *
 * Examples:
 *   "NA gray default" → { text: "NA gray", isDefault: true }
 *   "Done green"      → { text: "Done green", isDefault: false }
 */
export function stripDefaultModifier(text: string): {
  text: string;
  isDefault: boolean;
} {
  if (/\bdefault\s*$/.test(text)) {
    return { text: text.replace(/\s+default\s*$/, '').trim(), isDefault: true };
  }
  return { text, isDefault: false };
}

// ── Auto Color Assignment ───────────────────────────────────

/**
 * Sentinel stored in `TagEntry.color` for an entry declared WITHOUT an
 * explicit color (a "bare" tag value). The per-group finalize pass
 * (`assignAutoTagColors`) replaces every sentinel with a deterministic
 * palette color. Parsers MUST run that pass before returning, otherwise a
 * sentinel-colored entry would render with an empty fill.
 *
 * Empty string is used (rather than e.g. `undefined`) so the existing
 * `if (!color)` shape in callers naturally treats it as "needs a color",
 * and so `TagEntry.color` stays a plain `string`.
 */
export const AUTO_TAG_COLOR_SENTINEL = '';

/**
 * The categorical name cycle used to auto-assign colors to bare tag values,
 * in deterministic order. Aliased to the shared {@link CATEGORICAL_COLOR_ORDER}
 * (RGB-seeded, max-contrast, neutrals excluded) so tag swatches and data-chart
 * series colors share one canonical rotation. If a group has more colorless
 * entries than free categorical names, the cycle wraps.
 */
export const autoTagColorCycle: readonly string[] = CATEGORICAL_COLOR_ORDER;

/**
 * Finalize a tag group's auto-color assignment.
 *
 * Walks the group's entries in declaration order and replaces each
 * `AUTO_TAG_COLOR_SENTINEL` (a bare value with no explicit color) with a
 * deterministic palette color, resolved to the SAME hex form that
 * `extractColor` stores for explicit entries (so renderers/legends treat
 * auto and explicit entries identically).
 *
 * Rules:
 *  - Skip any cycle name whose resolved hex is already used by an EXPLICIT
 *    entry in this group — INCLUDING explicit entries that appear after the
 *    bare one (this is why assignment must be a post-build pass, not inline).
 *  - Skip any cycle name already consumed by an earlier auto-assignment in
 *    this same group, so two bare values never collide while names remain.
 *  - Cycle in `autoTagColorCycle` order; wrap around once names are
 *    exhausted (collisions acceptable past exhaustion).
 *
 * Idempotent: entries that already have a non-sentinel color are left
 * untouched, so it is safe to call once over every group at end of parse.
 *
 * @param group   The group being finalized (mutable construction view).
 * @param palette Active palette; when omitted, names resolve to the
 *                built-in Nord defaults (still deterministic).
 */
export function assignAutoTagColors(
  group: Writable<TagGroup>,
  palette?: PaletteColors
): void {
  const entries = group.entries as TagEntry[];
  // Hexes claimed by explicit entries (anywhere in the group).
  const explicitHexes = new Set<string>();
  let hasSentinel = false;
  for (const e of entries) {
    if (e.color === AUTO_TAG_COLOR_SENTINEL) hasSentinel = true;
    else explicitHexes.add(e.color.toLowerCase());
  }
  if (!hasSentinel) return;

  // Pre-resolve cycle names → hex once for this palette.
  const cycle = autoTagColorCycle.map((name) => ({
    name,
    hex: resolveColor(name, palette) ?? name,
  }));

  // Hexes consumed by earlier auto-assignments in this group.
  const autoHexes = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.color !== AUTO_TAG_COLOR_SENTINEL) continue;

    // First pass: a name whose hex collides with neither an explicit nor a
    // prior auto color. Fall back to the next cycle slot (wrap) once the
    // categorical names are exhausted, accepting collisions.
    let chosen = cycle.find(
      (c) =>
        !explicitHexes.has(c.hex.toLowerCase()) &&
        !autoHexes.has(c.hex.toLowerCase())
    );
    if (!chosen) {
      // Exhausted distinct names — wrap deterministically by auto-index.
      chosen = cycle[autoHexes.size % cycle.length]!;
    }
    autoHexes.add(chosen.hex.toLowerCase());
    entries[i] = { ...e, color: chosen.hex };
  }
}

/**
 * Convenience: run {@link assignAutoTagColors} over every group in a list
 * (e.g. `result.tagGroups`). Safe to call once at the end of a parser.
 */
export function finalizeAutoTagColors(
  groups: ReadonlyArray<Writable<TagGroup>>,
  palette?: PaletteColors
): void {
  for (const g of groups) assignAutoTagColors(g, palette);
}

// ── Regexes ─────────────────────────────────────────────────

/** Canonical syntax: line starting with `tag` keyword (no colon). */
export const TAG_BLOCK_NOCOLON_RE = /^tag\s+/i;

// ── Alias Inference ─────────────────────────────────────────

/**
 * Returns true if the token matches the universal alias character set:
 * `[A-Za-z][A-Za-z0-9_]{0,11}` — letter start, letters/digits/underscore,
 * length 1–12 (per TD-18). Widened from the previous 1-4 lowercase rule.
 */
function isAliasToken(token: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(token);
}

// ── Matchers ────────────────────────────────────────────────

/** Returns true if `trimmed` is a tag block heading. */
export function isTagBlockHeading(trimmed: string): boolean {
  return TAG_BLOCK_NOCOLON_RE.test(trimmed);
}

/**
 * Parse a tag declaration line: `tag Name [as <alias>] [Values...]`
 *
 * Canonical form: `tag Priority as p High red, Low blue` (universal §1.5).
 *
 * Legacy forms still parse for graceful degradation but set
 * `legacyForm` on the result so the caller can emit
 * `E_TAG_SHORTHAND_REMOVED`:
 *   - bare shorthand:  `tag Priority p`
 *   - alias keyword:   `tag Priority alias p`
 *
 * Supports quoted names: `tag "Marketing mktg"` → name="Marketing mktg", no alias.
 */
export function parseTagDeclaration(line: string): TagBlockMatch | null {
  if (!TAG_BLOCK_NOCOLON_RE.test(line)) return null;

  const afterTag = line.replace(/^tag\s+/i, '');
  if (!afterTag.trim()) return null;

  const tokens = tokenizeQuoteAware(afterTag);
  if (tokens.length === 0) return null;

  let name = stripQuotes(tokens[0]!);
  let alias: string | undefined;
  let inlineValues: string[] | undefined;
  let colorHint: string | undefined;
  let legacyForm: 'bare-shorthand' | 'alias-keyword' | undefined;
  let restStartIdx = 1;

  // Locate any keyword separator (`as` or legacy `alias`) that appears
  // BEFORE the first inline-value token. Inline values are recognized by
  // a comma in the line: scan tokens for one. Under §1.5 trailing-token
  // syntax there's no `(color)` marker anymore — a comma anywhere after
  // the name span signals that inline values follow.
  let valueStart = tokens.length;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i]!.includes(',')) {
      // valueStart is the FIRST token of the first inline value, which is
      // the token immediately following the alias / keyword span. Walk
      // back to the start of the value span by finding the most recent
      // word boundary — but for the simple heuristic here, the inline
      // value list starts at the previous non-keyword token.
      valueStart = i;
      // The token containing the comma might be `High` (in `High red,`)
      // or `red,` (in `High red,` if tokenized differently). Treat the
      // value span as starting at the token BEFORE the first comma
      // unless that token is the alias / keyword.
      // Simpler: use this index as a coarse upper bound. The keyword
      // search below uses [1, valueStart) — anything past `as`/`alias`
      // belongs to the value span.
      break;
    }
  }

  // Search left-to-right for the keyword within [1, valueStart).
  let keywordIdx = -1;
  let keywordKind: 'as' | 'alias' | null = null;
  for (let i = 1; i < valueStart; i++) {
    const t = tokens[i]!.toLowerCase();
    if (t === 'as') {
      keywordIdx = i;
      keywordKind = 'as';
      break;
    }
    if (t === 'alias') {
      keywordIdx = i;
      keywordKind = 'alias';
      break;
    }
  }

  if (keywordIdx > 0 && keywordIdx + 1 < tokens.length) {
    // `tag Name [Multi Word] (as|alias) <token> [Values...]`
    const candidate = tokens[keywordIdx + 1]!;
    if (isAliasToken(candidate)) {
      // Name is everything before the keyword (joined for multi-word names).
      // First token may be quoted; preserve stripQuotes behavior.
      name = tokens
        .slice(0, keywordIdx)
        .map((t) => stripQuotes(t))
        .join(' ');
      alias = candidate;
      if (keywordKind === 'alias') legacyForm = 'alias-keyword';
      restStartIdx = keywordIdx + 2;
    } else {
      // Keyword present but candidate doesn't look like a valid alias.
      // Treat the line as if the keyword wasn't there — name extends.
      // (Caller will likely emit a diagnostic via extract-alias path.)
      name = tokens
        .slice(0, valueStart)
        .map((t) => stripQuotes(t))
        .join(' ');
      restStartIdx = valueStart;
    }
  } else {
    // No `as`/`alias` keyword — try legacy bare-shorthand. The trailing
    // token of the name span (just before inline values) is the alias
    // candidate; if it passes the universal alias regex AND is NOT a
    // recognized palette color (§1.5 escape hatch), accept it.
    //
    // When inline values are present (valueStart < tokens.length), the
    // tokens immediately before the first value-segment-with-color form
    // the (name + alias) prefix. The first value contains at least the
    // value name + trailing color, so we walk back to find where it
    // starts: skip the trailing color token, then 1+ name tokens.
    const isColorWord = (s: string): boolean =>
      (RECOGNIZED_COLOR_NAMES as readonly string[]).includes(s);

    if (valueStart < tokens.length) {
      // Inline values are present (we found a comma at valueStart).
      // The first value's last token is at index commaIdx; strip the
      // comma to inspect. Walk back to determine the value name length.
      const commaTokenIdx = valueStart;
      // Find where the first value starts: the value contains at least
      // 1 word + optional trailing color. Walk back from commaTokenIdx
      // while the previous tokens look like value-name words (i.e. not
      // a recognized alias-shaped lowercase short token that is followed
      // by a value start).
      // Simpler heuristic: pre-comma trailing color is the last token if
      // it's a recognized color (after stripping comma). The value's
      // name is the token immediately before that. So the value spans
      // (firstValueStart..=commaTokenIdx). The "name + alias" prefix
      // is [0, firstValueStart).
      const lastBeforeComma = tokens[commaTokenIdx]!.replace(/,$/, '');
      // value = `<name word(s)> <color>` if trailing token is a recognized
      // palette word; otherwise value = `<name word(s)>` (no color).
      const firstValueStart = isColorWord(lastBeforeComma)
        ? commaTokenIdx - 1
        : commaTokenIdx;
      // Now firstValueStart points at the first token of value #1.
      // [0, firstValueStart) is the `<name + optional alias>` prefix.
      const prefixEnd = firstValueStart;
      const aliasCandidate = prefixEnd > 1 ? tokens[prefixEnd - 1] : undefined;
      if (
        aliasCandidate &&
        isAliasToken(aliasCandidate) &&
        !isColorWord(aliasCandidate)
      ) {
        alias = aliasCandidate;
        legacyForm = 'bare-shorthand';
        name = tokens
          .slice(0, prefixEnd - 1)
          .map((t) => stripQuotes(t))
          .join(' ');
        restStartIdx = prefixEnd;
      } else {
        name = tokens
          .slice(0, prefixEnd)
          .map((t) => stripQuotes(t))
          .join(' ');
        restStartIdx = prefixEnd;
      }
    } else if (tokens[0]![0] === '"' || tokens[0]![0] === "'") {
      // Quoted name. Check the next token for legacy bare alias.
      if (
        tokens.length > 1 &&
        isAliasToken(tokens[1]!) &&
        !isColorWord(tokens[1]!)
      ) {
        alias = tokens[1]!;
        legacyForm = 'bare-shorthand';
        restStartIdx = 2;
      }
    } else if (
      valueStart > 1 &&
      isAliasToken(tokens[valueStart - 1]!) &&
      !isColorWord(tokens[valueStart - 1]!)
    ) {
      // Bare shorthand at the end of the name span.
      alias = tokens[valueStart - 1]!;
      legacyForm = 'bare-shorthand';
      name = tokens
        .slice(0, valueStart - 1)
        .map((t) => stripQuotes(t))
        .join(' ');
      restStartIdx = valueStart;
    } else {
      // No alias at all. Name extends through all non-value tokens.
      name = tokens
        .slice(0, valueStart)
        .map((t) => stripQuotes(t))
        .join(' ');
      restStartIdx = valueStart;
    }
  }

  // Parse remaining tokens as inline values (if any)
  if (restStartIdx < tokens.length) {
    const valueStr = tokens.slice(restStartIdx).join(' ');
    inlineValues = valueStr
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  // Trailing recognized-color token on the name itself (no inline values).
  // Per §1.5 universal trailing-token: case-sensitive lowercase match.
  if (!inlineValues || inlineValues.length === 0) {
    const lastSpaceIdx = name.lastIndexOf(' ');
    if (lastSpaceIdx > 0) {
      const trailing = name.substring(lastSpaceIdx + 1);
      if ((RECOGNIZED_COLOR_NAMES as readonly string[]).includes(trailing)) {
        colorHint = trailing;
        name = name.substring(0, lastSpaceIdx).trimEnd();
      }
    }
  }

  return {
    name,
    alias,
    colorHint,
    inlineValues:
      inlineValues && inlineValues.length > 0 ? inlineValues : undefined,
    legacyForm,
  };
}

/**
 * Parse a tag block heading line into structured data.
 * Returns `null` if the line is not a tag block heading.
 */
// ── Tag Resolution ────────────────────────────────────────

/**
 * Resolve a tag color for an entity given its metadata, available tag groups,
 * and the currently active group.
 *
 * Returns the hex color from the matching tag entry, `'#999999'` for
 * untagged/unknown values, or `undefined` when no group is active.
 *
 * @param metadata  The entity's key-value metadata (keys already lowercased)
 * @param tagGroups All declared tag groups
 * @param activeGroupName The currently selected tag group (null = no group active)
 * @param isContainer When true, `defaultValue` is NOT applied (containers are structural, not data)
 */
export function resolveTagColor(
  metadata: Record<string, string>,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  isContainer?: boolean
): string | undefined {
  if (!activeGroupName) return undefined;

  const group = tagGroups.find(
    (g) => g.name.toLowerCase() === activeGroupName.toLowerCase()
  );
  if (!group) return undefined;

  const metaValue =
    metadata[group.name.toLowerCase()] ??
    (isContainer ? undefined : group.defaultValue);
  if (!metaValue) return '#999999';

  return (
    group.entries.find((e) => e.value.toLowerCase() === metaValue.toLowerCase())
      ?.color ?? '#999999'
  );
}

// ── Tag Validation ────────────────────────────────────────

/**
 * Validate tag metadata values on a collection of entities against declared
 * tag groups. Emits warnings (via `pushWarning`) for unknown values with
 * did-you-mean suggestions.
 *
 * @param entities  Objects with `metadata` and `lineNumber`
 * @param tagGroups Declared tag groups to validate against
 * @param pushWarning Callback to emit a warning at a given line
 * @param suggestFn Optional did-you-mean suggestion function
 */
export function validateTagValues(
  entities: ReadonlyArray<{
    metadata: Record<string, string>;
    lineNumber: number;
  }>,
  tagGroups: ReadonlyArray<TagGroup>,
  pushWarning: (lineNumber: number, message: string) => void,
  suggestFn?: (input: string, candidates: readonly string[]) => string | null
): void {
  if (tagGroups.length === 0) return;

  const groupMap = new Map<string, TagGroup>();
  for (const g of tagGroups) groupMap.set(g.name.toLowerCase(), g);

  for (const entity of entities) {
    for (const [key, value] of Object.entries(entity.metadata)) {
      const group = groupMap.get(key);
      if (!group) continue;
      const match = group.entries.some(
        (e) => e.value.toLowerCase() === value.toLowerCase()
      );
      if (!match) {
        // Suppress warning if the value is a prefix of any valid entry —
        // the user is likely still typing (live parse during editing).
        const valueLower = value.toLowerCase();
        const isPrefix = group.entries.some((e) =>
          e.value.toLowerCase().startsWith(valueLower)
        );
        if (!isPrefix) {
          const defined = group.entries.map((e) => e.value);
          let msg = `Unknown value '${value}' for tag group '${group.name}'`;
          const hint = suggestFn?.(value, defined);
          if (hint) {
            msg += `. ${hint}`;
          } else {
            msg += ` — defined values: ${defined.join(', ')}`;
          }
          pushWarning(entity.lineNumber, msg);
        }
      }
    }
  }
}

// ── Tag Group Name Validation ────────────────────────────

/**
 * Valid identifier for use as a `data-tag-<name>` attribute suffix.
 * Must start with a letter or underscore, then letters/digits/underscore/hyphen only.
 * Spaces and punctuation are rejected because they produce invalid DOM attribute
 * names (setAttribute throws "Invalid qualified name").
 */
const VALID_TAG_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Validate tag group names (and aliases) for reserved keywords and DOM-safe
 * identifier syntax. Should be called alongside `validateTagValues()` in each
 * parser's post-parse validation.
 *
 * - Reserved name `none` (case-insensitive) → warning
 * - Name or alias containing chars invalid for a `data-tag-*` attribute → error
 *   (falls back to `pushWarning` if `pushError` is not supplied)
 */
export function validateTagGroupNames(
  tagGroups: ReadonlyArray<{
    name: string;
    alias?: string | null;
    lineNumber: number;
  }>,
  pushWarning: (lineNumber: number, message: string) => void,
  pushError?: (lineNumber: number, message: string) => void
): void {
  const report = pushError ?? pushWarning;
  for (const group of tagGroups) {
    if (group.name.toLowerCase() === 'none') {
      pushWarning(
        group.lineNumber,
        `'none' is a reserved keyword and cannot be used as a tag group name`
      );
    }
    if (!VALID_TAG_IDENT_RE.test(group.name)) {
      report(
        group.lineNumber,
        `Tag group name "${group.name}" contains invalid characters — use a single identifier (letters, digits, underscore, hyphen)`
      );
    }
    if (group.alias != null && !VALID_TAG_IDENT_RE.test(group.alias)) {
      report(
        group.lineNumber,
        `Tag group alias "${group.alias}" contains invalid characters — use a single identifier (letters, digits, underscore, hyphen)`
      );
    }
  }
}

// ── Parent → Child Tag Cascade ────────────────────────────

/**
 * Cascade explicit tag values down a node tree: a child that has no value of
 * its own for a given tag group inherits the value of its nearest ancestor
 * that does. A child's own explicit value always wins and becomes the new
 * inherited value for its subtree.
 *
 * Run this on the parsed tree BEFORE {@link injectDefaultTagMetadata} so that
 * an inherited ancestor value takes precedence over the group's global
 * default — only nodes with no tagged ancestor fall through to the default.
 * Idempotent and mutates `metadata` in place.
 *
 * @param roots     Root nodes of the tree (each with mutable `metadata` + `children`)
 * @param tagGroups Declared tag groups (only `.name` is used)
 */
export function cascadeTagMetadata<
  T extends { metadata: Record<string, string>; children: readonly T[] },
>(roots: readonly T[], tagGroups: ReadonlyArray<{ name: string }>): void {
  const keys = tagGroups.map((g) => g.name.toLowerCase());
  if (keys.length === 0) return;

  const walk = (node: T, inherited: Record<string, string>): void => {
    const childInherited = { ...inherited };
    for (const key of keys) {
      const own = node.metadata[key];
      if (own) {
        childInherited[key] = own; // own explicit value propagates downward
      } else if (inherited[key]) {
        node.metadata[key] = inherited[key]; // inherit from nearest ancestor
      }
    }
    for (const child of node.children) walk(child, childInherited);
  };

  for (const root of roots) walk(root, {});
}

// ── Default Metadata Injection ────────────────────────────

/**
 * Inject default tag group values into entity metadata.
 * Only sets keys not already present. Idempotent.
 *
 * @param entities  Objects with mutable `metadata`
 * @param tagGroups Tag groups (only those with `defaultValue` matter)
 * @param skip Optional predicate — entities matching this are skipped (e.g. containers)
 */
export function injectDefaultTagMetadata(
  entities: Array<{ metadata: Record<string, string> }>,
  tagGroups: ReadonlyArray<TagGroup>,
  skip?: (entity: { metadata: Record<string, string> }) => boolean
): void {
  const defaults: { key: string; value: string }[] = [];
  for (const group of tagGroups) {
    if (group.defaultValue) {
      defaults.push({
        key: group.name.toLowerCase(),
        value: group.defaultValue,
      });
    }
  }
  if (defaults.length === 0) return;

  for (const entity of entities) {
    if (skip?.(entity)) continue;
    for (const { key, value } of defaults) {
      if (!(key in entity.metadata)) {
        entity.metadata[key] = value;
      }
    }
  }
}

// ── Active Tag Group Resolution ──────────────────────────────

/**
 * Determine which tag group should be active, using a priority chain:
 *
 * 1. Programmatic override (from render API / CLI flag) — highest priority
 * 2. Diagram-level `active-tag` option (from parsed source)
 * 3. Auto-activate first declared tag group
 * 4. No coloring (null)
 *
 * The sentinel value `"none"` (case-insensitive) at any level means
 * "suppress tag coloring." Diagrams with tag groups render colored by
 * default across every render path (CLI, export, share-link, app); use
 * `active-tag none` to opt out.
 *
 * @param tagGroups     Declared tag groups (only `.name` is used)
 * @param explicitActiveTag  Value of `active-tag` option from parsed diagram, if any
 * @param programmaticOverride  Value from render API / CLI; `undefined` = not set,
 *                              `null` or `''` = explicitly no coloring
 */
export function resolveActiveTagGroup(
  tagGroups: ReadonlyArray<{ name: string }>,
  explicitActiveTag: string | undefined,
  programmaticOverride?: string | null
): string | null {
  // 1. Programmatic override (highest priority)
  if (programmaticOverride !== undefined) {
    if (!programmaticOverride) return null; // null or ''
    if (programmaticOverride.toLowerCase() === 'none') return null;
    return programmaticOverride;
  }

  // 2. Diagram-level active-tag option
  if (explicitActiveTag) {
    if (explicitActiveTag.toLowerCase() === 'none') return null;
    return explicitActiveTag;
  }

  // 3. Auto-activate first declared group
  if (tagGroups.length > 0) return tagGroups[0]!.name;

  // 4. No tag groups → no coloring
  return null;
}

// ── Matchers ────────────────────────────────────────────────

export function matchTagBlockHeading(trimmed: string): TagBlockMatch | null {
  return parseTagDeclaration(trimmed);
}

/**
 * Emit `E_TAG_SHORTHAND_REMOVED` if the match captured a legacy tag
 * shorthand form (bare or `alias` keyword). Caller-side helper so
 * each parser can emit the diagnostic without duplicating the
 * messaging logic. No-op if the match is in canonical form.
 */
export function emitTagLegacyDiagnostic(
  match: TagBlockMatch,
  lineNumber: number,
  diagnostics: DgmoError[]
): void {
  if (!match.legacyForm || !match.alias) return;
  diagnostics.push(
    makeDgmoError(
      lineNumber,
      tagShorthandRemovedMessage({ name: match.name, alias: match.alias }),
      'error',
      ALIAS_DIAGNOSTIC_CODES.TAG_SHORTHAND_REMOVED
    )
  );
}
