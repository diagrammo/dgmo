/**
 * Add or remove the `collapsed: true` view-state marker on an element's source
 * line (mindmap node label, or a `[group]` header via the group-header variant),
 * preserving any other same-line metadata. This is what makes a host's (the app's, Obsidian's)
 * automatic write-through (collapse in the preview → mutate the source) land as
 * clean, hand-editable dgmo rather than a naive append.
 *
 * `collapsed` is a reserved key, so dgmo's parser cuts the label at the first
 * `collapsed:` regardless of comma placement — but a SECOND metadata key must be
 * comma-separated from the first, so we comma-join when the line already carries
 * metadata and space-append when it doesn't.
 *
 * Hand-written dgmo usually carries the bare trailing flag instead (`Gold
 * collapsed`, `Wine w: Prized, collapsed`), which dgmo's
 * `peelTrailingCollapsedFlag` reads as the same thing. Treating it as metadata
 * wrote `Gold collapsed, collapsed: true`, which parses to the label
 * `Gold collapsed,` (#1571).
 */

const MARKER_VALUE = /collapsed:\s*\S+/;
const BARE_FLAG = /(?:\s*,)?[ \t]+collapsed\s*$/;

/** A line that is only the label carries no flag: `collapsed` is its name. */
const hasBareFlag = (line: string, label: string): boolean =>
  line.trim() !== label && BARE_FLAG.test(line);

/** Toggle the `collapsed: true` marker on a single line, given the node's label. */
export function applyCollapsedMarker(
  line: string,
  label: string,
  collapse: boolean
): string {
  if (collapse) {
    // Idempotent: an existing marker (any value) normalizes to true.
    if (MARKER_VALUE.test(line)) {
      return line.replace(MARKER_VALUE, 'collapsed: true');
    }
    if (hasBareFlag(line, label)) return line;
    const stripped = line.replace(/\s+$/, '');
    const body = line.trimStart();
    const hasMeta =
      body.startsWith(label) && body.slice(label.length).trim().length > 0;
    return hasMeta
      ? `${stripped}, collapsed: true`
      : `${stripped} collapsed: true`;
  }
  // Expand: remove the marker and tidy the surrounding separator, whichever
  // position it occupies (", collapsed: X" | "collapsed: X, " | " collapsed: X").
  const expanded = line
    .replace(/\s*,\s*collapsed:\s*[^,\s]+/, '')
    .replace(/\bcollapsed:\s*[^,\s]+\s*,\s*/, '')
    .replace(/\s+collapsed:\s*[^,\s]+/, '')
    .replace(/\s+$/, '');
  return hasBareFlag(expanded, label)
    ? expanded.replace(BARE_FLAG, '')
    : expanded;
}

/** Apply {@link applyCollapsedMarker} to the given 1-based line of a document. */
export function applyCollapsedMarkerAtLine(
  text: string,
  lineNumber: number,
  label: string,
  collapse: boolean
): string {
  const lines = text.split('\n');
  const idx = lineNumber - 1;
  const target = lines[idx];
  if (target === undefined) return text;
  lines[idx] = applyCollapsedMarker(target, label, collapse);
  return lines.join('\n');
}

/**
 * Toggle `collapsed: true` on a bracketed group-header line (`[Name]` →
 * `[Name] collapsed: true`), used by sequence/gantt/etc. where the collapse
 * marker rides on the group header rather than a node label. The `]` is the
 * label/metadata boundary, so no separate label argument is needed.
 */
export function applyGroupHeaderCollapsedMarkerAtLine(
  text: string,
  lineNumber: number,
  collapse: boolean
): string {
  const lines = text.split('\n');
  const idx = lineNumber - 1;
  const target = lines[idx];
  if (target === undefined) return text;
  const close = target.indexOf(']');
  if (close === -1) return text; // not a [group] header — leave untouched
  const header = target.slice(0, close + 1).trimStart(); // e.g. "[Bridge]"
  lines[idx] = applyCollapsedMarker(target, header, collapse);
  return lines.join('\n');
}

const INDENT = (s: string): number => s.length - s.trimStart().length;
const COLLAPSED_LINE = /^\s*collapsed:\s*\S+\s*$/;

/**
 * Toggle `collapsed: true` as an INDENTED property line under a `[group]`
 * header (infra's form — the header itself doesn't take same-line metadata).
 * Collapse inserts `  collapsed: true` as the group's first child; expand
 * removes the immediate-child `collapsed:` line. Child indent is inferred from
 * the group's existing first child (falls back to header indent + 2).
 */
export function applyIndentedGroupCollapsedMarkerAtLine(
  text: string,
  headerLineNumber: number,
  collapse: boolean
): string {
  const lines = text.split('\n');
  const hIdx = headerLineNumber - 1;
  const header = lines[hIdx];
  if (header === undefined) return text;
  const headerIndent = INDENT(header);

  // Walk the group's child block (until a line indented <= the header).
  let blockEnd = lines.length;
  let childIndent: number | null = null;
  for (let i = hIdx + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === '') continue;
    const ind = INDENT(line);
    if (ind <= headerIndent) {
      blockEnd = i;
      break;
    }
    childIndent ??= ind;
  }
  const indentStr = ' '.repeat(childIndent ?? headerIndent + 2);

  if (collapse) {
    for (let i = hIdx + 1; i < blockEnd; i++) {
      if (COLLAPSED_LINE.test(lines[i] as string)) {
        lines[i] = `${indentStr}collapsed: true`;
        return lines.join('\n');
      }
    }
    lines.splice(hIdx + 1, 0, `${indentStr}collapsed: true`);
    return lines.join('\n');
  }
  for (let i = hIdx + 1; i < blockEnd; i++) {
    if (COLLAPSED_LINE.test(lines[i] as string)) {
      lines.splice(i, 1);
      return lines.join('\n');
    }
  }
  return text;
}
