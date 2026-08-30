// ============================================================
// Shared tag-group types, regexes, and matchers
// ============================================================

import { peelQuotedName, stripQuotes, tokenizeQuoteAware } from './parsing';
import {
  CATEGORICAL_COLOR_ORDER,
  RECOGNIZED_COLOR_NAMES,
  resolveColor,
} from '../colors';
import { suggest } from '../diagnostics';
import type { PaletteColors } from '../palettes/types';
import type { Writable } from './brand';

/** A single entry inside a tag group: `Value color` */
export interface TagEntry {
  readonly value: string;
  readonly color: string;
  /**
   * The color NAME the author wrote (one of the recognized palette names),
   * when the entry declared an explicit color. Absent for bare/auto-colored
   * entries. `color` above is always the RESOLVED hex (auto and explicit are
   * indistinguishable there); this preserves the authored-vs-auto distinction
   * so a GUI editor can round-trip an explicit color through a reparse.
   */
  readonly authoredColor?: string;
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

/**
 * DOM-safe key for a tag group — used wherever the group name becomes a
 * `data-tag-*` attribute suffix, an entity metadata key, or an `active-tag`
 * match target. For a single-identifier name (the only form the parser used to
 * accept) this is exactly `name.toLowerCase()`, so swapping it in for existing
 * diagrams is byte-identical. A quoted multi-word name (`tag "Trust Zone" as tz`)
 * slugs to a hyphenated identifier (`trust-zone`) so it never produces an
 * invalid DOM attribute name; the original `name` is kept for the legend label.
 */
export function tagAttrKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Result of matching a tag block heading */
interface TagBlockMatch {
  name: string;
  alias: string | undefined;
  colorHint: string | undefined;
  /** Inline tag values parsed from single-line form (e.g., `tag Priority as p High red, Low blue`) */
  // eOPT: widened — constructor always assigns this slot
  inlineValues?: string[] | undefined;
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
 * End-of-parse normalization for a parser's tag groups: peel §2.2 quoting
 * from every value, then run {@link assignAutoTagColors} over each group
 * (e.g. `result.tagGroups`). Safe to call once at the end of a parser.
 *
 * The peel happens HERE rather than in the shared label helpers because
 * quotes still carry meaning while a line is being tokenized — treemap
 * reads `"Region 5"` as a label whose trailing digit is not a value, and
 * a quoted name is what stops the metadata cut at a colon. By the time a
 * group is finalized, every such decision is already made, and a value
 * that kept its quotes would disagree with the assignment side (which
 * peels), producing a spurious `Unknown value` warning.
 */
export function finalizeAutoTagColors(
  groups: ReadonlyArray<Writable<TagGroup>>,
  palette?: PaletteColors
): void {
  for (const g of groups) {
    for (let i = 0; i < g.entries.length; i++) {
      // In-bounds by loop guard.
      const entry = g.entries[i]!;
      const peeled = peelQuotedName(entry.value);
      if (peeled !== entry.value) g.entries[i] = { ...entry, value: peeled };
    }
    if (g.defaultValue !== undefined) {
      g.defaultValue = peelQuotedName(g.defaultValue);
    }
    assignAutoTagColors(g, palette);
  }
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
 * Canonical form (universal §1.5):
 *   - no alias:        `tag Priority`
 *   - aliased:         `tag Priority as p`
 *   - inline values:   `tag Priority High red, Low blue`
 *   - aliased+values:  `tag Priority as p High red, Low blue`
 *
 * The ONLY way to declare an alias is the `as` keyword. A trailing bare
 * token (`tag Priority p`) is NOT inferred as an alias — it is treated as
 * part of the name span (or, when a recognized palette color, a color hint).
 *
 * Supports quoted names: `tag "Marketing mktg"` → name="Marketing mktg", no alias.
 */
export function parseTagDeclaration(line: string): TagBlockMatch | null {
  if (!TAG_BLOCK_NOCOLON_RE.test(line)) return null;

  const afterTag = line.replace(/^tag\s+/i, '');
  if (!afterTag.trim()) return null;

  const tokens = tokenizeQuoteAware(afterTag);
  if (tokens.length === 0) return null;

  let name: string;
  let alias: string | undefined;
  let inlineValues: string[] | undefined;
  let colorHint: string | undefined;
  let restStartIdx: number;

  // Inline values are recognized by a comma in the line. Under §1.5
  // trailing-token syntax a comma anywhere after the name span signals
  // that inline values follow; `valueStart` is a coarse upper bound on
  // the name/alias prefix.
  let valueStart = tokens.length;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i]!.includes(',')) {
      valueStart = i;
      break;
    }
  }

  // The only alias form is the `as` keyword, which must appear within the
  // name/alias prefix (before any inline values).
  let keywordIdx = -1;
  for (let i = 1; i < valueStart; i++) {
    if (tokens[i]!.toLowerCase() === 'as') {
      keywordIdx = i;
      break;
    }
  }

  if (
    keywordIdx > 0 &&
    keywordIdx + 1 < tokens.length &&
    isAliasToken(tokens[keywordIdx + 1]!)
  ) {
    // `tag Name [Multi Word] as <alias> [Values...]` — the alias is the
    // token after `as`; inline values (if any) follow it.
    name = tokens
      .slice(0, keywordIdx)
      .map((t) => stripQuotes(t))
      .join(' ');
    alias = tokens[keywordIdx + 1]!;
    restStartIdx = keywordIdx + 2;
  } else {
    // No alias (`as` absent, or its candidate isn't a valid alias token).
    // A trailing bare token is part of the name, never an inferred alias.
    //
    // When inline values are present, the first value's name token sits
    // just before the comma token, so the name span must stop before it.
    // value #1 spans `<valueName> <color>` (color present) or `<valueName>`
    // (no color); everything before that is the group name.
    let prefixEnd = valueStart;
    if (valueStart < tokens.length) {
      const isColorWord = (s: string): boolean =>
        (RECOGNIZED_COLOR_NAMES as readonly string[]).includes(s);
      const lastBeforeComma = tokens[valueStart]!.replace(/,$/, '');
      prefixEnd = isColorWord(lastBeforeComma) ? valueStart - 1 : valueStart;
      // Never consume the entire prefix as a value — keep at least the
      // first token as the group name.
      if (prefixEnd < 1) prefixEnd = 1;
    }
    name = tokens
      .slice(0, prefixEnd)
      .map((t) => stripQuotes(t))
      .join(' ');
    restStartIdx = prefixEnd;
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
/**
 * Color `resolveTagColor` returns for an entity the active tag group does not
 * classify. It is a SENTINEL, not a paint value: every consumer is expected to
 * compare against it and substitute `palette.textMuted`, so that an untagged
 * node reads as neutral in whatever palette and theme are in force. It was an
 * unnamed `'#999999'` literal in eleven files until 2026-08-28, which is how
 * some consumers came to paint it raw.
 */
export const UNTAGGED_TAG_COLOR = '#999999';

/**
 * The color a GROUP FRAME should take from the active tag group, or
 * `undefined` when the group has no value of its own.
 *
 * This is `resolveTagColor` with the two decisions a container always makes,
 * made once instead of per chart:
 *
 * - 🔴 `isContainer: true`, so the tag group's `defaultValue` does NOT apply.
 *   A frame colors only when the author wrote a value on the group line. Drop
 *   this and every untagged frame in the diagram wears the first entry's
 *   color, which is worse than the uncolored frames this was meant to fix.
 * - `UNTAGGED_TAG_COLOR` is a sentinel, not a paint value, so a group the
 *   active tag group does not classify comes back `undefined` and the caller
 *   falls back to its neutral frame.
 *
 * Added for diagrammo/diagrammo#585, where boxes-and-lines, infra, kanban, c4
 * and pert all drew an uncolored frame over a group that had a value.
 */
export function resolveGroupTagColor(
  metadata: Readonly<Record<string, string>> | undefined,
  tagGroups: readonly TagGroup[],
  activeGroupName: string | null
): string | undefined {
  if (!metadata || Object.keys(metadata).length === 0) return undefined;
  const color = resolveTagColor(
    { ...metadata },
    [...tagGroups],
    activeGroupName,
    true
  );
  return color && color !== UNTAGGED_TAG_COLOR ? color : undefined;
}

/**
 * The VALUE the active tag group gives an entity — the legend entry it belongs
 * under — or `undefined` when nothing classifies it.
 *
 * 🔴 It answers in the group's OWN spelling, not the author's. A value matches
 * its entry case-insensitively (`crew: deck` wears `Deck`'s colour), so a
 * consumer comparing the raw metadata against a legend entry would find nothing
 * on exactly the entities the picture has already coloured. An unknown value
 * comes back verbatim: it is not the group's, and `resolveTagColor` paints it
 * `UNTAGGED_TAG_COLOR`.
 *
 * `resolveTagColor` is the same question one step further on, and calls this —
 * so "which value is this" and "what colour is it" cannot answer differently
 * about `defaultValue`, about containers, or about case. Exported for the app's
 * live sketch canvas, which needs the value rather than the colour to pair a
 * hovered legend entry with the marks under it (diagrammo/diagrammo#599): two
 * values may be authored the same colour, so the colour cannot stand in for the
 * value.
 *
 * @param metadata  The entity's key-value metadata (keys already lowercased)
 * @param tagGroups All declared tag groups
 * @param activeGroupName The currently selected tag group (null = no group active)
 * @param isContainer When true, `defaultValue` is NOT applied (containers are structural, not data)
 */
export function resolveTagValue(
  metadata: Record<string, string>,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  isContainer?: boolean
): string | undefined {
  if (!activeGroupName) return undefined;

  const group = tagGroups.find(
    (g) => tagAttrKey(g.name) === tagAttrKey(activeGroupName)
  );
  if (!group) return undefined;

  const metaValue =
    metadata[tagAttrKey(group.name)] ??
    (isContainer ? undefined : group.defaultValue);
  if (!metaValue) return undefined;

  return (
    group.entries.find((e) => e.value.toLowerCase() === metaValue.toLowerCase())
      ?.value ?? metaValue
  );
}

export function resolveTagColor(
  metadata: Record<string, string>,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  isContainer?: boolean
): string | undefined {
  if (!activeGroupName) return undefined;

  const group = tagGroups.find(
    (g) => tagAttrKey(g.name) === tagAttrKey(activeGroupName)
  );
  if (!group) return undefined;

  const metaValue = resolveTagValue(
    metadata,
    tagGroups,
    activeGroupName,
    isContainer
  );
  if (!metaValue) return UNTAGGED_TAG_COLOR;

  return (
    group.entries.find((e) => e.value.toLowerCase() === metaValue.toLowerCase())
      ?.color ?? UNTAGGED_TAG_COLOR
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
  for (const g of tagGroups) groupMap.set(tagAttrKey(g.name), g);

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
          let msg =
            `Unknown value '${value}' for tag group '${group.name}' — ` +
            `use one of: ${defined.join(', ')}`;
          const hint = suggestFn?.(value, defined);
          if (hint) {
            msg += `. ${hint}`;
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
    // A single-identifier name is valid as-is; a multi-word name is valid when
    // quoted (`tag "Trust Zone" as tz`) — it slugs to a DOM-safe key while the
    // original text stays the legend label. Reject only names whose slug is
    // not a usable identifier (e.g. all-punctuation, or leading digit).
    if (!VALID_TAG_IDENT_RE.test(tagAttrKey(group.name))) {
      report(
        group.lineNumber,
        `Tag group name "${group.name}" can't form a valid key — use letters, digits, underscore, or hyphen, and quote a multi-word name (e.g. tag "Trust Zone" as tz)`
      );
    }
    if (group.alias != null && !VALID_TAG_IDENT_RE.test(group.alias)) {
      report(
        group.lineNumber,
        `Tag group alias "${group.alias}" contains invalid characters — use a single identifier (letters, digits, underscore, hyphen)`
      );
    }
    // `tag Status s` (missing `as`) declares a group NAMED "Status s" with no
    // alias — every later `s:` assignment then falls through silently. The
    // trailing token is deliberately not inferred as an alias (TD-18), so the
    // author's only feedback is this warning. Quotes are stripped before
    // validation, so a quoted spaced name is indistinguishable here; fire only
    // when the group has no alias and the last word is alias-shaped (lowercase
    // start), which a spaced display name like "Trust Zone" rarely is.
    if (group.alias == null) {
      const words = group.name.trim().split(/\s+/);
      const last = words[words.length - 1]!;
      if (words.length > 1 && /^[a-z][a-z0-9_]{0,11}$/.test(last)) {
        const head = words.slice(0, -1).join(' ');
        pushWarning(
          group.lineNumber,
          `Tag group "${group.name}" has a space and no alias — if '${last}' is meant as an alias, write 'tag ${head} as ${last}'; if the space is intentional, quote the name: tag "${group.name}"`
        );
      }
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
  const keys = tagGroups.map((g) => tagAttrKey(g.name));
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
        key: tagAttrKey(group.name),
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

/**
 * The message for an `active-tag` that names nothing the diagram declares, or
 * `null` when there is nothing to report.
 *
 * `resolveActiveTagGroup` above deliberately hands an explicit `active-tag`
 * straight back without consulting the groups — every caller then fails to
 * find it and quietly renders in flat neutral colours, which is
 * indistinguishable from a diagram that has no tags at all. This is the check
 * that makes a typo say so. It is a WARNING, not an error: the diagram still
 * draws, and the colouring is the only thing lost.
 *
 * Callers own the push and the line number, because both are per-parser.
 *
 * Four things it must not fire on, covered here or by the caller:
 *   1. `active-tag none` — reserved, means "no colouring". Returns null.
 *   2. A declared-but-EMPTY group — pass what was DECLARED, never a list
 *      already filtered by `entries.length > 0`, or this reports a group the
 *      author can plainly see in their source.
 *   3. The programmatic override — that is the app's runtime tag switcher,
 *      not source, so it never reaches a parser and must never be checked.
 *   4. A chart whose directive accepts more than tag-group names (treemap's
 *      heat label, boxes-and-lines' metric) — widen `extraNames` rather than
 *      skipping the check.
 *
 * @param activeTag   the raw `active-tag` value from source, if any
 * @param tagGroups   the groups the diagram DECLARES (only `.name` is read)
 * @param extraNames  other values this chart's directive legitimately accepts
 * @param extraLabel  what those extra names are, for the message's first line
 */
export function activeTagNoMatchMessage(
  activeTag: string | undefined | null,
  tagGroups: ReadonlyArray<{ name: string }>,
  extraNames: readonly string[] = [],
  extraLabel?: string
): string | null {
  const at = activeTag?.trim();
  if (!at) return null;
  const lower = at.toLowerCase();
  if (lower === 'none') return null;

  const valid = [...tagGroups.map((g) => g.name), ...extraNames];
  // Accept the raw name AND its DOM-safe slug. The spec says a quoted group
  // name "slugs to a DOM-safe key (`Trust Zone` → `trust-zone`) used for
  // assignment, matching, and `active-tag`" (§1.4 Name), while several
  // renderers match the raw name case-insensitively instead. Both spellings
  // colour something somewhere, so both must pass: this is a WARNING, and a
  // false positive on a diagram that renders correctly is the damaging kind of
  // mistake here, while a false negative costs nothing.
  if (valid.some((n) => n.toLowerCase() === lower || tagAttrKey(n) === lower)) {
    return null;
  }

  const subject = extraLabel
    ? `a declared tag group or ${extraLabel}`
    : 'a declared tag group';
  const available = valid.length
    ? ` Available: ${valid.join(', ')}, none.`
    : ' No tag groups are declared.';
  const didYouMean = suggest(at, valid);

  return (
    `active-tag "${at}" does not match ${subject}.` +
    available +
    (didYouMean ? ` ${didYouMean}` : '')
  );
}

// ── Matchers ────────────────────────────────────────────────

export function matchTagBlockHeading(trimmed: string): TagBlockMatch | null {
  return parseTagDeclaration(trimmed);
}
