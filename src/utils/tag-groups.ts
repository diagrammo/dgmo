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
