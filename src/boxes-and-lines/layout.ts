// ============================================================
// Boxes and Lines Diagram — Layout Engine
// ============================================================
//
// Node sizing + the public `layoutBoxesAndLines` entry. Placement and edge
// routing are delegated to the dagre placement-search engine (layout-search.ts);
// this module owns node sizing, parallel-edge fan offsets, and note floating —
// the engine-agnostic post-passes applied to whatever the engine returns.

import type { ParsedBoxesAndLines, BLNode, BLGroup } from './types';
import type { BLSearchConfig } from './layout-search';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import { placeEdgeLabels } from './label-placement';
import {
  resolveNotes,
  buildPlacedNotes,
  noteCanvasShift,
  type PlacedNote,
} from '../utils/notes';

// ── Constants ──────────────────────────────────────────────
const MARGIN = 40;
const MAX_PARALLEL_EDGES = 5;
const PARALLEL_SPACING = 22;

const PHI = 1.618;
export const NODE_HEIGHT = 60;
export const NODE_WIDTH = Math.round(NODE_HEIGHT * PHI);
const DESC_NODE_WIDTH = 140;
const DESC_FONT_SIZE = 10;
const DESC_LINE_HEIGHT = 1.4;
const DESC_PADDING = 8;
const SEPARATOR_GAP = 4;
const MAX_DESC_LINES = 6;
const MAX_LABEL_LINES = 3;
const LABEL_LINE_HEIGHT = 1.3;
const LABEL_PAD = 12;
// Bottom value-row reserved on a DESCRIBED node under `show-values`: a thin
// divider + a "Metric: value" footer line (replaces the old corner badge).
const VALUE_ROW_FONT = 11;
const VALUE_ROW_H =
  SEPARATOR_GAP + VALUE_ROW_FONT * DESC_LINE_HEIGHT + DESC_PADDING;

// ── Result types ───────────────────────────────────────────

export interface BLLayoutNode {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** A note floated beside this box (never moves the box). */
  readonly note?: PlacedNote;
}

export interface BLLayoutEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly bidirectional: boolean;
  readonly lineNumber: number;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** Centre of the label box (set by label-placement). */
  readonly labelX?: number;
  readonly labelY?: number;
  /** Wrapped label box dimensions + lines (set by label-placement; the renderer
   *  draws the halo + tspans straight from these). */
  readonly labelWidth?: number;
  readonly labelHeight?: number;
  readonly labelLines?: readonly string[];
  readonly yOffset: number;
  readonly parallelCount: number;
  readonly metadata: Readonly<Record<string, string>>;
  /** Marker for renderer: draw with linear curve, not curveBasis (ELK gives
   * us orthogonal polylines and curveBasis would smooth corners into waves) */
  readonly deferred?: boolean;
}

export interface BLLayoutGroup {
  readonly label: string;
  readonly lineNumber: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly collapsed: boolean;
  readonly childCount?: number;
}

export interface BLLayoutResult {
  readonly nodes: readonly BLLayoutNode[];
  readonly edges: readonly BLLayoutEdge[];
  readonly groups: readonly BLLayoutGroup[];
  readonly width: number;
  readonly height: number;
}

// ── Node sizing ────────────────────────────────────────────

function splitCamelCase(word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    // In-bounds by loop guard (i >= 1 and i < word.length).
    const prev = word.charAt(i - 1);
    const curr = word.charAt(i);
    const next = i + 1 < word.length ? word.charAt(i + 1) : '';
    const lowerToUpper =
      prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z';
    const upperRunEnd =
      prev >= 'A' &&
      prev <= 'Z' &&
      curr >= 'A' &&
      curr <= 'Z' &&
      next >= 'a' &&
      next <= 'z';
    if (lowerToUpper || upperRunEnd) {
      parts.push(word.slice(start, i));
      start = i;
    }
  }
  parts.push(word.slice(start));
  return parts.length > 1 ? parts : [word];
}

function estimateLabelLines(label: string, nodeWidth = NODE_WIDTH): number {
  const rawParts = label.split(/[\s-]+/);
  const words: string[] = [];
  for (const part of rawParts) {
    if (!part) continue;
    words.push(...splitCamelCase(part));
  }
  const maxTextWidth = nodeWidth - 24;
  for (let fontSize = 13; fontSize >= 9; fontSize--) {
    if (maxTextWidth < measureText('MM', fontSize)) continue;
    let lines = 1;
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (measureText(test, fontSize) <= maxTextWidth) {
        current = test;
      } else {
        lines++;
        current = word;
      }
    }
    if (lines <= MAX_LABEL_LINES) return Math.min(lines, MAX_LABEL_LINES);
  }
  return MAX_LABEL_LINES;
}

export function computeNodeSize(
  node: BLNode,
  reserveValueRow: boolean
): { width: number; height: number } {
  if (!node.description || node.description.length === 0) {
    return { width: NODE_WIDTH, height: NODE_HEIGHT };
  }
  const w = DESC_NODE_WIDTH;
  const labelLines = estimateLabelLines(node.label, w);
  const labelHeight = labelLines * 13 * LABEL_LINE_HEIGHT + LABEL_PAD;
  const maxTextWidth = w - 24;
  let totalRenderedLines = 0;
  for (const line of node.description) {
    if (measureText(line, DESC_FONT_SIZE) <= maxTextWidth) {
      totalRenderedLines += 1;
    } else {
      // Hard-break long words to match the renderer's slicing behaviour.
      totalRenderedLines += wrapTextToWidth(
        line,
        DESC_FONT_SIZE,
        maxTextWidth,
        {
          hardBreak: true,
        }
      ).length;
    }
  }
  totalRenderedLines = Math.min(totalRenderedLines, MAX_DESC_LINES);
  const descriptionHeight =
    totalRenderedLines * DESC_FONT_SIZE * DESC_LINE_HEIGHT;
  const totalHeight =
    labelHeight +
    SEPARATOR_GAP +
    DESC_PADDING +
    descriptionHeight +
    DESC_PADDING +
    (reserveValueRow ? VALUE_ROW_H : 0);
  return { width: w, height: Math.max(NODE_HEIGHT, totalHeight) };
}

// ── Main layout ────────────────────────────────────────────

export async function layoutBoxesAndLines(
  parsed: ParsedBoxesAndLines,
  collapseInfo?: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: readonly BLGroup[];
  },
  layoutOptions?: {
    hideDescriptions?: boolean;
    collapsedNotes?: ReadonlySet<number>;
    /** Previous node positions (label → {x,y}) for layout stability —
     *  minimizes node drift on edit/collapse. */
    previousPositions?: ReadonlyMap<string, { x: number; y: number }>;
    /** Progress hook (interactive path). When set, the search yields between
     *  candidates so the UI can paint a "trying X of Y" indicator. */
    onProgress?: (done: number, total: number, phase: string) => void;
  }
): Promise<BLLayoutResult> {
  const { layoutBoxesAndLinesSearch } = await import('./layout-search');
  const searchOpts = {
    ...(layoutOptions?.hideDescriptions !== undefined && {
      hideDescriptions: layoutOptions.hideDescriptions,
    }),
    ...(layoutOptions?.previousPositions !== undefined && {
      previousPositions: layoutOptions.previousPositions,
    }),
    ...(layoutOptions?.onProgress !== undefined && {
      onProgress: layoutOptions.onProgress,
    }),
  };
  // Capture the winning stage-1 candidate family so the (rare) label-reserving
  // relayout below can re-run just those configs instead of regenerating and
  // re-scoring the entire seed pool a second time.
  let topConfigs: BLSearchConfig[] | undefined;
  const searched = await layoutBoxesAndLinesSearch(parsed, collapseInfo, {
    ...searchOpts,
    onTopConfigs: (cfgs) => {
      topConfigs = cfgs;
    },
  });

  // Edge-label legibility (priority ladder): wrap + reposition labels on the
  // chosen layout. If any label still can't clear a node box, escalate ONCE to a
  // label-aware relayout that reserves dagre label space so a gap opens — and
  // keep it only if it actually resolves more labels.
  let placed = placeEdgeLabels(applyParallelEdgeOffsets(searched));
  if (placed.unresolved.length > 0) {
    const relaid = await layoutBoxesAndLinesSearch(parsed, collapseInfo, {
      ...searchOpts,
      reserveEdgeLabels: true,
      // Only the label reservation changed — re-laying-out the top candidates
      // from the first search is enough. Falls back to the full pool when the
      // first search surfaced no dagre candidates.
      ...(topConfigs !== undefined &&
        topConfigs.length > 0 && { configs: topConfigs }),
    });
    const relaidPlaced = placeEdgeLabels(applyParallelEdgeOffsets(relaid));
    if (relaidPlaced.unresolved.length < placed.unresolved.length)
      placed = relaidPlaced;
  }

  // Engine-agnostic post-processing: float notes (and shift the canvas to fit
  // them) on the label-placed layout.
  return attachNotes(placed.layout, parsed, layoutOptions?.collapsedNotes);
}

/**
 * Float notes beside their boxes on the chosen layout (runs after variant
 * selection — notes don't affect scoring). `no-notes` opts out. A note placed
 * above/left can land off-canvas, so the whole layout is shifted to fit.
 * Un-annotated diagrams are returned unchanged (min coords stay ≥ 0).
 */
function attachNotes(
  layout: BLLayoutResult,
  parsed: ParsedBoxesAndLines,
  collapsedNotes?: ReadonlySet<number>
): BLLayoutResult {
  const notesSuppressed = parsed.options?.['no-notes'] === 'on';
  const noteByNode =
    notesSuppressed || !parsed.notes
      ? new Map()
      : resolveNotes(
          parsed.notes,
          parsed.nodes.map((n) => ({ id: n.label, label: n.label }))
        );
  if (noteByNode.size === 0) return layout;

  const placed = buildPlacedNotes(
    layout.nodes.map((n) => ({
      id: n.label,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    })),
    noteByNode,
    parsed.direction === 'TB' ? 'TB' : 'LR',
    collapsedNotes
  );
  const notedNodes: BLLayoutNode[] = layout.nodes.map((n) => {
    const note = placed.get(n.label);
    return note ? { ...n, note } : n;
  });

  // Content bbox over nodes (+ their floated notes) and groups — matches the
  // prior max-extent computation plus the notes.
  let bbMinX = Infinity;
  let bbMinY = Infinity;
  let bbMaxX = -Infinity;
  let bbMaxY = -Infinity;
  const extend = (l: number, t: number, r: number, b: number): void => {
    if (l < bbMinX) bbMinX = l;
    if (t < bbMinY) bbMinY = t;
    if (r > bbMaxX) bbMaxX = r;
    if (b > bbMaxY) bbMaxY = b;
  };
  for (const n of notedNodes) {
    extend(
      n.x - n.width / 2,
      n.y - n.height / 2,
      n.x + n.width / 2,
      n.y + n.height / 2
    );
    if (n.note && !n.note.collapsed) {
      extend(
        n.x + n.note.x,
        n.y + n.note.y,
        n.x + n.note.x + n.note.width,
        n.y + n.note.y + n.note.height
      );
    }
  }
  for (const grp of layout.groups) {
    extend(
      grp.x - grp.width / 2,
      grp.y - grp.height / 2,
      grp.x + grp.width / 2,
      grp.y + grp.height / 2
    );
  }
  if (!Number.isFinite(bbMinX)) return { ...layout, nodes: notedNodes };

  const { shiftX, shiftY } = noteCanvasShift(bbMinX, bbMinY);
  const shifted = shiftX !== 0 || shiftY !== 0;
  const finalNodes = shifted
    ? notedNodes.map((n) => ({ ...n, x: n.x + shiftX, y: n.y + shiftY }))
    : notedNodes;
  const finalEdges = shifted
    ? layout.edges.map((e) => ({
        ...e,
        points: e.points.map((pt) => ({ x: pt.x + shiftX, y: pt.y + shiftY })),
        ...(e.labelX !== undefined && { labelX: e.labelX + shiftX }),
        ...(e.labelY !== undefined && { labelY: e.labelY + shiftY }),
        // labelWidth/labelHeight/labelLines are shift-invariant — carried via spread.
      }))
    : layout.edges;
  const finalGroups = shifted
    ? layout.groups.map((grp) => ({
        ...grp,
        x: grp.x + shiftX,
        y: grp.y + shiftY,
      }))
    : layout.groups;

  return {
    nodes: finalNodes,
    edges: finalEdges,
    groups: finalGroups,
    width: bbMaxX + shiftX + MARGIN,
    height: bbMaxY + shiftY + MARGIN,
  };
}

/**
 * Assign parallel-edge fan offsets on any layout (engine-agnostic). Edges sharing
 * an unordered {source,target} pair are bundled at their ports and spread in the
 * middle by the renderer using `yOffset`/`parallelCount`; beyond `MAX_PARALLEL_EDGES`
 * the extras are dropped (`parallelCount: 0` ⇒ renderer skips them). The ELK path
 * computes this inside extractLayout; the search engine produces a single set of
 * points per pair, so it needs the same offsets applied here.
 */
function applyParallelEdgeOffsets(layout: BLLayoutResult): BLLayoutResult {
  const groups = new Map<string, number[]>();
  layout.edges.forEach((e, i) => {
    const [a, b] =
      e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = `${a}\x00${b}`;
    const arr = groups.get(key);
    if (arr) arr.push(i);
    else groups.set(key, [i]);
  });
  if ([...groups.values()].every((g) => g.length < 2)) return layout;

  const yOffset = new Array(layout.edges.length).fill(0);
  const count = new Array(layout.edges.length).fill(1);
  for (const idxs of groups.values()) {
    const capped = idxs.slice(0, MAX_PARALLEL_EDGES);
    for (const drop of idxs.slice(MAX_PARALLEL_EDGES)) count[drop] = 0;
    if (capped.length < 2) continue;
    capped.forEach((idx, j) => {
      yOffset[idx] = (j - (capped.length - 1) / 2) * PARALLEL_SPACING;
      count[idx] = capped.length;
    });
  }
  return {
    ...layout,
    edges: layout.edges.map((e, i) => ({
      ...e,
      yOffset: yOffset[i]!,
      parallelCount: count[i]!,
    })),
  };
}
