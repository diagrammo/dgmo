// ============================================================
// Shared tag-group types, regexes, and matchers
// ============================================================

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
  /** Value of the entry marked `default` (nodes without metadata get this) */
  defaultValue?: string;
  lineNumber: number;
}

/** Result of matching a tag block heading */
export interface TagBlockMatch {
  name: string;
  alias: string | undefined;
  colorHint: string | undefined;
  /** true when the heading used `## …` (deprecated) */
  deprecated: boolean;
}

// ── Regexes ─────────────────────────────────────────────────

/** New canonical syntax: `tag: GroupName [alias X] [(color)]` (case-insensitive) */
export const TAG_BLOCK_RE =
  /^tag:\s+(.+?)(?:\s+alias\s+(\w+))?(?:\s*\(([^)]+)\))?\s*$/i;

/** Legacy syntax: `## GroupName [alias X] [(color)]` */
export const GROUP_HEADING_RE =
  /^##\s+(.+?)(?:\s+alias\s+(\w+))?(?:\s*\(([^)]+)\))?\s*$/;

// ── Matchers ────────────────────────────────────────────────

/** Returns true if `trimmed` is a tag block heading in either syntax. */
export function isTagBlockHeading(trimmed: string): boolean {
  return TAG_BLOCK_RE.test(trimmed) || GROUP_HEADING_RE.test(trimmed);
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
  // Try new syntax first
  const tagMatch = trimmed.match(TAG_BLOCK_RE);
  if (tagMatch) {
    return {
      name: tagMatch[1].trim(),
      alias: tagMatch[2] || undefined,
      colorHint: tagMatch[3] || undefined,
      deprecated: false,
    };
  }

  // Fall back to legacy syntax
  const groupMatch = trimmed.match(GROUP_HEADING_RE);
  if (groupMatch) {
    return {
      name: groupMatch[1].trim(),
      alias: groupMatch[2] || undefined,
      colorHint: groupMatch[3] || undefined,
      deprecated: true,
    };
  }

  return null;
}
