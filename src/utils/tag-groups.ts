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

/** A single entry inside a tag group: `Value(color)` */
export interface TagEntry {
  value: string;
  color: string;
  lineNumber: number;
}

/** A tag group block: heading + entries */
export interface TagGroup {
  name: string;
  alias?: string;
  entries: TagEntry[];
  /** Default value for nodes without explicit metadata. First entry unless another is marked `default`. */
  defaultValue?: string;
  lineNumber: number;
}

/** Result of matching a tag block heading */
interface TagBlockMatch {
  name: string;
  alias: string | undefined;
  colorHint: string | undefined;
  /** Inline tag values parsed from single-line form (e.g., `tag Priority as p High(red), Low(blue)`) */
  inlineValues?: string[];
  /**
   * If the heading used the legacy `tag Name <alias>` (bare shorthand)
   * or `tag Name alias <alias>` (explicit-keyword) syntax, this is set
   * so the calling parser can emit `E_TAG_SHORTHAND_REMOVED`. Pre-1.0
   * hard-break — bare shorthand still parses for graceful degradation
   * but is no longer a valid form.
   */
  legacyForm?: 'bare-shorthand' | 'alias-keyword';
}

// ── Default Modifier ────────────────────────────────────────

/**
 * Strip trailing `default` keyword from a tag entry string.
 * Returns the cleaned text and whether the keyword was present.
 *
 * Examples:
 *   "NA(gray) default" → { text: "NA(gray)", isDefault: true }
 *   "Done(green)"      → { text: "Done(green)", isDefault: false }
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
 * Canonical form (post-TD-18): `tag Priority as p High(red), Low(blue)`.
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

  let name = stripQuotes(tokens[0]);
  let alias: string | undefined;
  let inlineValues: string[] | undefined;
  let colorHint: string | undefined;
  let legacyForm: 'bare-shorthand' | 'alias-keyword' | undefined;
  let restStartIdx = 1;

  // Locate any keyword separator (`as` or legacy `alias`) that appears
  // BEFORE the first inline-value token. Inline values are tokens that
  // contain `(` (color suffix) or follow a comma.
  let valueStart = tokens.length;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].includes('(')) {
      valueStart = i;
      break;
    }
  }

  // Search left-to-right for the keyword within [1, valueStart).
  let keywordIdx = -1;
  let keywordKind: 'as' | 'alias' | null = null;
  for (let i = 1; i < valueStart; i++) {
    const t = tokens[i].toLowerCase();
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
    const candidate = tokens[keywordIdx + 1];
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
    // candidate; if it passes the universal alias regex, accept it and
    // mark legacyForm='bare-shorthand'.
    if (tokens[0][0] === '"' || tokens[0][0] === "'") {
      // Quoted name. Check the next token for legacy bare alias.
      if (tokens.length > 1 && isAliasToken(tokens[1]) && valueStart > 1) {
        alias = tokens[1];
        legacyForm = 'bare-shorthand';
        restStartIdx = 2;
      }
    } else if (valueStart > 1 && isAliasToken(tokens[valueStart - 1])) {
      // Bare shorthand at the end of the name span.
      alias = tokens[valueStart - 1];
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

  // Trailing `(color)` on the name itself (no inline values).
  if (!inlineValues || inlineValues.length === 0) {
    const colorMatch = name.match(/\(([^)]+)\)\s*$/);
    if (colorMatch) {
      colorHint = colorMatch[1];
      name = name.substring(0, colorMatch.index!).trim();
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
 * "suppress tag coloring."
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
  if (tagGroups.length > 0) return tagGroups[0].name;

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
