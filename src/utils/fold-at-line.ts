/**
 * One host-facing fold edit for every chart type (#1741). A static host
 * (Obsidian, a docs site) finds a toggle by `data-node-toggle`,
 * `data-group-toggle`, `data-section-toggle` or `data-note-toggle`, reads its
 * `data-line-number` and `aria-expanded`, and asks for the source with that
 * fold flipped. The host writes the result back and re-renders; the fold lives
 * in the source as a `collapsed` marker on that line.
 *
 * The chart type is detected here, so the host needs no per-type knowledge.
 */
import { parseDgmoChartType } from '../chart-type-detect';
import { parseMindmap } from '../mindmap/parser';
import { parseOrg } from '../org/parser';
import { parseSitemap } from '../sitemap/parser';
import {
  applyCollapsedMarkerAtLine,
  applyGroupHeaderCollapsedMarkerAtLine,
  applyIndentedGroupCollapsedMarkerAtLine,
  applyNoteCollapsedMarkerAtLine,
} from './collapse-marker';

interface LabelledNode {
  readonly label: string;
  readonly lineNumber: number;
  readonly children: readonly LabelledNode[];
}

/** Chart types whose foldable nodes are plain labelled lines. */
const NODE_TREES: Readonly<
  Record<string, (source: string) => readonly LabelledNode[]>
> = {
  mindmap: (s) => parseMindmap(s).roots,
  org: (s) => parseOrg(s).roots,
  sitemap: (s) => parseSitemap(s).roots,
};

/** Chart types that fold a `[group]` header line. */
const GROUP_HEADER_TYPES: ReadonlySet<string> = new Set([
  'block',
  'boxes-and-lines',
  'event-line',
  'gantt',
  'infra',
  'journey-map',
  'kanban',
  'org',
  'pert',
  'raci',
  'sequence',
  'sitemap',
  'state',
  'timeline',
]);

/** A `[group]` header, with gantt's optional start offset (`+7d [Blockade]`). */
const GROUP_HEAD = /^(?:[+-]\S*\s+)?\[/;

/** A sequence section divider, with or without its marker. */
const SECTION_LINE = /^==\s+\S/;
const SECTION_MARKER = /(?:\s*,)?\s+collapsed(?::\s*\S+)?\s*$/;

function labelAtLine(
  nodes: readonly LabelledNode[],
  line: number
): string | null {
  for (const n of nodes) {
    if (n.lineNumber === line) return n.label;
    const inner = labelAtLine(n.children, line);
    if (inner !== null) return inner;
  }
  return null;
}

/** The divider minus any marker is its label, so a bare flag is removed too. */
function foldSection(
  source: string,
  line: number,
  text: string,
  collapse: boolean
): string {
  const label = text.trim().replace(SECTION_MARKER, '');
  return applyCollapsedMarkerAtLine(source, line, label, collapse);
}

/**
 * Chart types that also read an indented `collapsed: true` property line under
 * the folded thing — a node or a `[group]` header alike. The same-line edit
 * cannot see that form, so unfolding removes it as well.
 */
const INDENTED_MARKER_TYPES: ReadonlySet<string> = new Set([
  'infra',
  'org',
  'sitemap',
]);

function foldGroupHeader(
  source: string,
  line: number,
  collapse: boolean
): string {
  return applyGroupHeaderCollapsedMarkerAtLine(source, line, collapse);
}

/**
 * The DGMO `source` with the fold on its 1-based `line` set to `collapse`
 * (true folds, false unfolds), or null when the chart type folds nothing on
 * that line or the line already has that state.
 *
 * `line` is a toggle's `data-line-number`; `collapse` is the toggle's
 * `aria-expanded === "true"`.
 */
export function foldAtLine(
  source: string,
  line: number,
  collapse: boolean
): string | null {
  if (!Number.isInteger(line) || line < 1) return null;
  const chartType = parseDgmoChartType(source);
  if (chartType === null) return null;
  const text = source.split('\n')[line - 1];
  if (text === undefined) return null;
  const trimmed = text.trim();

  let next: string | null = null;
  if (GROUP_HEAD.test(trimmed)) {
    if (GROUP_HEADER_TYPES.has(chartType)) {
      next = foldGroupHeader(source, line, collapse);
    }
  } else if (chartType === 'sequence') {
    if (SECTION_LINE.test(trimmed)) {
      next = foldSection(source, line, text, collapse);
    } else if (/^note(\s|$)/i.test(trimmed)) {
      next = applyNoteCollapsedMarkerAtLine(source, line, collapse);
    }
  } else {
    const tree = NODE_TREES[chartType];
    const label = tree ? labelAtLine(tree(source), line) : null;
    if (label !== null) {
      next = applyCollapsedMarkerAtLine(source, line, label, collapse);
    }
  }
  // Unfold also drops an indented marker line, for the types that read one.
  if (!collapse && INDENTED_MARKER_TYPES.has(chartType)) {
    const base = next ?? source;
    const lifted = applyIndentedGroupCollapsedMarkerAtLine(base, line, false);
    if (lifted !== base) next = lifted;
  }
  return next === null || next === source ? null : next;
}
