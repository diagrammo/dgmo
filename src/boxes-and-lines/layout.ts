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
import { NODE_HEIGHT, NODE_WIDTH } from './node-metrics';
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

const DESC_NODE_WIDTH = 140;
const DESC_FONT_SIZE = 10;
const DESC_LINE_HEIGHT = 1.4;
const DESC_PADDING = 8;
const SEPARATOR_GAP = 4;
const MAX_DESC_LINES = 6;
const MAX_LABEL_LINES = 3;
const LABEL_LINE_HEIGHT = 1.3;
const LABEL_PAD = 12;
// Bottom value-row reserved on a DESCRIBED node with a value (default-on;
// suppressed by `no-value`): a thin divider + a "Metric: value" footer line
// (replaces the old corner badge).
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
    /** Interactive collapse stability: freeze surviving nodes, anchor the
     *  collapsed pill at its members' previous bounding-box centre, and close
     *  the vacated gap — instead of re-running the placement search. Requires
     *  `previousPositions`; falls back to the search when coverage is
     *  incomplete. */
    stableCollapse?: boolean;
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
    ...(layoutOptions?.stableCollapse !== undefined && {
      stableCollapse: layoutOptions.stableCollapse,
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
 * an unordered {source,target} pair are spread into lanes either side of the line
 * joining their two boxes; beyond `MAX_PARALLEL_EDGES` the extras are dropped
 * (`parallelCount: 0` ⇒ renderer skips them). The ELK path computes this inside
 * extractLayout; the search engine produces a single set of points per pair, so it
 * needs the same offsets applied here.
 *
 * 🔴 The lane order comes from the PORTS, not from the edge's index in the group.
 * Assigning by index was blind to the fact that the router has usually separated
 * the two ends already, so a two-way pair could be handed the offsets that drag
 * each edge across the other: on a bare two-node diagram the A→B edge left both
 * boxes 19px BELOW the B→A edge and was then pushed 11px above it in the middle,
 * leaving the two curves 2.8px apart and reading as one line. On a real diagram
 * with a wider port gap the same swap became two true crossings per pair, and the
 * two-way pairs were the only thing crossing on the whole canvas (#642).
 *
 * 🔴 The offset runs PERPENDICULAR to that line, not down the page. A plain y
 * offset is a sideways spread only while the pair happens to be horizontal; on a
 * TB diagram the two boxes sit above one another and shifting in y moves the lane
 * ALONG its own edge, separating nothing.
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

  // Endpoint boxes, so a group can be given a direction. Collapsed groups are
  // edge endpoints too (`__group_<label>`), exactly as in the pierce detector.
  const centre = new Map<string, { x: number; y: number }>();
  for (const n of layout.nodes) centre.set(n.label, { x: n.x, y: n.y });
  for (const g of layout.groups)
    if (g.collapsed) centre.set('__group_' + g.label, { x: g.x, y: g.y });

  const yOffset = new Array(layout.edges.length).fill(0);
  const count = new Array(layout.edges.length).fill(1);
  const normal: ({ x: number; y: number } | undefined)[] = new Array(
    layout.edges.length
  ).fill(undefined);
  for (const [key, idxs] of groups) {
    const capped = idxs.slice(0, MAX_PARALLEL_EDGES);
    for (const drop of idxs.slice(MAX_PARALLEL_EDGES)) count[drop] = 0;
    if (capped.length < 2) continue;

    // Lane direction: perpendicular to the line between the two boxes. A self
    // pair, or an endpoint that isn't a box, leaves the old straight-down
    // normal — the renderer's self-loop path draws those, not this fan.
    const sep = key.indexOf('\x00');
    const ca = centre.get(key.slice(0, sep));
    const cb = centre.get(key.slice(sep + 1));
    let nx = 0;
    let ny = 1;
    if (ca && cb) {
      const dx = cb.x - ca.x;
      const dy = cb.y - ca.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        nx = -dy / len;
        ny = dx / len;
      }
    }

    // Where each edge's own ports already sit on that axis. Ties keep the
    // group's insertion order, so the assignment stays deterministic.
    const ordered = capped
      .map((idx) => {
        const pts = layout.edges[idx]!.points;
        const p0 = pts[0];
        const p1 = pts[pts.length - 1];
        const mx = ((p0?.x ?? 0) + (p1?.x ?? 0)) / 2;
        const my = ((p0?.y ?? 0) + (p1?.y ?? 0)) / 2;
        return { idx, along: mx * nx + my * ny };
      })
      .sort((p, q) => p.along - q.along || p.idx - q.idx);

    ordered.forEach(({ idx }, j) => {
      yOffset[idx] = (j - (capped.length - 1) / 2) * PARALLEL_SPACING;
      count[idx] = capped.length;
      normal[idx] = { x: nx, y: ny };
    });
  }
  return {
    ...layout,
    edges: layout.edges.map((e, i) => {
      const off = yOffset[i]!;
      const cnt = count[i]!;
      const base = { ...e, yOffset: off, parallelCount: cnt };
      if (off === 0 || cnt <= 1) return base;
      // 🔴 Build the fan HERE, not at render time. This used to set only the
      // offset and leave `points` alone; the renderer then discarded `points`
      // entirely and drew a five-point fan from the endpoints. So the label —
      // placed by placeEdgeLabels against `points`, one step later — sat on a
      // curve that was never drawn. Where the router had taken a long detour and
      // the fan drew a short direct line, that put the label 216px from its own
      // edge, over blank canvas (#640). 28% of real boxes-and-lines diagrams
      // carry at least one fanned edge, and no gallery fixture does.
      const s = e.points[0];
      const t = e.points[e.points.length - 1];
      if (!s || !t) return base;
      const n = normal[i] ?? { x: 0, y: 1 };
      // A point `u` of the way along the straight port-to-port line, pushed
      // `k · off` off it along the lane normal. Interpolating BOTH coordinates
      // is what keeps a slanted pair straight — the y used to be pinned to the
      // near port's y while x moved, which kinked every non-horizontal fan.
      const at = (u: number, k: number) => ({
        x: s.x + (t.x - s.x) * u + n.x * off * k,
        y: s.y + (t.y - s.y) * u + n.y * off * k,
      });
      return {
        ...base,
        points: [
          { x: s.x, y: s.y }, // port
          at(0.15, 0.5), // separate
          at(0.5, 1), // full spread
          at(0.85, 0.5), // converge
          { x: t.x, y: t.y }, // port
        ],
      };
    }),
  };
}
