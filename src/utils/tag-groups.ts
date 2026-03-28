// ============================================================
// Shared tag-group types, regexes, and matchers
// ============================================================

import { stripQuotes, tokenizeQuoteAware } from './parsing';

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
  /** First value in the tag declaration is the default (nodes without metadata get this) */
  defaultValue?: string;
  lineNumber: number;
}

/** Result of matching a tag block heading */
export interface TagBlockMatch {
  name: string;
  alias: string | undefined;
  colorHint: string | undefined;
  /** Inline tag values parsed from single-line form (e.g., `tag Priority p High(red), Low(blue)`) */
  inlineValues?: string[];
}

// ── Regexes ─────────────────────────────────────────────────

/** Canonical syntax: line starting with `tag` keyword (no colon). */
export const TAG_BLOCK_NOCOLON_RE = /^tag\s+/i;

// ── Alias Inference ─────────────────────────────────────────

/** Returns true if the token looks like an alias: 1-4 lowercase ASCII characters. */
function isAliasToken(token: string): boolean {
  return /^[a-z]{1,4}$/.test(token);
}

// ── Matchers ────────────────────────────────────────────────

/** Returns true if `trimmed` is a tag block heading. */
export function isTagBlockHeading(trimmed: string): boolean {
  return TAG_BLOCK_NOCOLON_RE.test(trimmed);
}

/**
 * Parse a new-syntax tag declaration line: `tag Name [alias] [Values...]`
 *
 * Alias inference: the token immediately after the name is the alias if it's 1-4 lowercase chars.
 * Everything after the alias (or name, if no alias) that contains a comma or `(` is treated as inline values.
 *
 * Supports quoted names: `tag "Marketing mktg"` → name="Marketing mktg", no alias.
 */
export function parseTagDeclaration(line: string): TagBlockMatch | null {
  // Must start with `tag ` (case-insensitive)
  if (!TAG_BLOCK_NOCOLON_RE.test(line)) return null;

  // Strip the `tag ` prefix
  const afterTag = line.replace(/^tag\s+/i, '');
  if (!afterTag.trim()) return null;

  // Check if there are inline values (indicated by presence of `(` for colors after the name part)
  // Strategy: tokenize, identify name + optional alias, rest is inline values
  const tokens = tokenizeQuoteAware(afterTag);
  if (tokens.length === 0) return null;

  // First token (or quoted token) is the tag name
  let name = stripQuotes(tokens[0]);
  let alias: string | undefined;
  let inlineValues: string[] | undefined;
  let colorHint: string | undefined;
  let restStartIdx = 1;

  // If the first token is quoted, name is the quoted content — check for alias next
  if (tokens[0][0] === '"' || tokens[0][0] === "'") {
    // Quoted name — check if next token is alias
    if (tokens.length > 1 && isAliasToken(tokens[1])) {
      alias = tokens[1];
      restStartIdx = 2;
    }
  } else {
    // Unquoted — collect multi-word name. The alias is the last token that's 1-4 lowercase
    // BEFORE any value tokens (values have `(color)` suffixes or appear after we see a comma).

    // First check for explicit `alias` keyword: `tag Name alias X`
    const aliasKeywordIdx = tokens.findIndex((t, i) => i > 0 && t.toLowerCase() === 'alias');
    if (aliasKeywordIdx > 0 && aliasKeywordIdx + 1 < tokens.length) {
      // Everything before `alias` is the name, the token after `alias` is the alias
      name = tokens.slice(0, aliasKeywordIdx).map(t => stripQuotes(t)).join(' ');
      alias = tokens[aliasKeywordIdx + 1];
      restStartIdx = aliasKeywordIdx + 2;
    } else {
      // Find where inline values start — look for a token with `(` in it (color suffix)
      // or the presence of a comma in the remaining text
      const remainingText = tokens.slice(1).join(' ');
      const commaInRemaining = remainingText.includes(',');

      if (tokens.length === 1) {
        // Just `tag Name` — no alias, no values
      } else if (tokens.length === 2 && isAliasToken(tokens[1]) && !commaInRemaining) {
        // `tag Priority p` — alias only, no values
        alias = tokens[1];
        restStartIdx = 2;
      } else if (tokens.length >= 2) {
        // Check if token[1] is an alias
        if (isAliasToken(tokens[1])) {
          alias = tokens[1];
          restStartIdx = 2;
          // Multi-word name not applicable when alias is right after first token
        } else {
          // Could be multi-word name: `tag Risk Level lo`
          // Walk tokens to find the alias at the end (before inline values)
          // Find where inline values begin — first token containing `(` or after comma
          let valueStart = tokens.length; // default: no values
          for (let i = 1; i < tokens.length; i++) {
            // A token containing `(` suggests a value with color: `High(red)`
            if (tokens[i].includes('(')) {
              valueStart = i;
              break;
            }
          }

          // Check if the token just before valueStart is an alias
          if (valueStart > 1 && isAliasToken(tokens[valueStart - 1])) {
            alias = tokens[valueStart - 1];
            // Name is everything from token[0] to token[valueStart-2]
            name = tokens.slice(0, valueStart - 1).map(t => stripQuotes(t)).join(' ');
            restStartIdx = valueStart;
          } else {
            // No alias — name is everything before values
            name = tokens.slice(0, valueStart).map(t => stripQuotes(t)).join(' ');
            restStartIdx = valueStart;
          }
        }
      }
    }
  }

  // Parse remaining tokens as inline values (if any)
  if (restStartIdx < tokens.length) {
    // Rejoin and split by comma for inline values
    const valueStr = tokens.slice(restStartIdx).join(' ');
    inlineValues = valueStr.split(',').map(v => v.trim()).filter(Boolean);
  }

  // Check for trailing color hint on name (without inline values)
  // e.g., `tag Location(blue)` — colorHint on the tag group itself
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
    inlineValues: inlineValues && inlineValues.length > 0 ? inlineValues : undefined,
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
    group.entries.find(
      (e) => e.value.toLowerCase() === metaValue.toLowerCase()
    )?.color ?? '#999999'
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
  entities: ReadonlyArray<{ metadata: Record<string, string>; lineNumber: number }>,
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
        const isPrefix = group.entries.some(
          (e) => e.value.toLowerCase().startsWith(valueLower)
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
      defaults.push({ key: group.name.toLowerCase(), value: group.defaultValue });
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

// ── Matchers ────────────────────────────────────────────────

export function matchTagBlockHeading(trimmed: string): TagBlockMatch | null {
  return parseTagDeclaration(trimmed);
}
