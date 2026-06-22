// ============================================================
// Boxes and Lines Diagram — Edge label placement
// ============================================================
//
// Makes edge/arrow labels legible regardless of length or layout via a priority
// ladder (each step only fires when the previous can't make the label legible):
//
//   1. WRAP   — cap label width and wrap onto up to MAX_LABEL_LINES lines.
//   2. MOVE   — if the wrapped box still overlaps a node box, slide it to a clear
//               spot near its own line (along the polyline, then a small
//               perpendicular offset), staying proximal. No leader line.
//   3. RELAYOUT (last resort, owned by layout.ts) — re-run the search reserving
//               dagre label space so a gap opens; this module only reports which
//               labels stayed unresolved so the caller can decide to escalate.
//
// Placement runs in layout (not the renderer) so it sees node/group boxes and so
// the relayout decision can re-invoke the search. The renderer is a pure consumer
// of the labelX/labelY/labelWidth/labelHeight/labelLines fields written here.

import type { BLLayoutResult } from './layout';
import {
  measureText,
  wrapTextToWidth,
  truncateText,
} from '../utils/text-measure';

// Keep in sync with EDGE_LABEL_FONT_SIZE in renderer.ts (ScaleContext is identity
// there, so layout-space px == screen px for the unscaled diagram coords).
export const EDGE_LABEL_FONT_SIZE = 11;

const LABEL_MAX_WIDTH = 160; // ≈ DESC_NODE_WIDTH + slack; flat (not canvas-relative)
const MAX_LABEL_LINES = 3;
const LABEL_LINE_HEIGHT = 1.3;
const H_PAD = 6; // horizontal halo padding (each side)
const V_PAD = 3; // vertical halo padding (each side)
const BOX_CLEAR_PAD = 4; // min clearance kept between a label box and a node box
const PERP_STEP = 8; // perpendicular offset increment (px)
const PERP_MAX = 40; // max perpendicular offset before giving up
const SLIDE_SAMPLES = 9; // arc-length samples per side when sliding along the edge

type Pt = { readonly x: number; readonly y: number };

interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface MeasuredLabel {
  readonly lines: readonly string[];
  /** Halo box width, including 2·H_PAD. */
  readonly width: number;
  /** Halo box height, including 2·V_PAD. */
  readonly height: number;
}

/**
 * Wrap + measure an edge label into a bounded multi-line box. Long unbreakable
 * tokens are hard-broken at the char boundary; overflow past MAX_LABEL_LINES is
 * ellipsized so the box is bounded in both axes.
 */
export function measureEdgeLabel(
  label: string,
  fontSize: number = EDGE_LABEL_FONT_SIZE,
  maxWidth: number = LABEL_MAX_WIDTH
): MeasuredLabel {
  let lines = wrapTextToWidth(label, fontSize, maxWidth, { hardBreak: true });
  if (lines.length > MAX_LABEL_LINES) {
    const kept = lines.slice(0, MAX_LABEL_LINES - 1);
    const rest = lines.slice(MAX_LABEL_LINES - 1).join(' ');
    kept.push(truncateText(rest, fontSize, maxWidth));
    lines = kept;
  }
  let textW = 0;
  for (const ln of lines) {
    const w = measureText(ln, fontSize);
    if (w > textW) textW = w;
  }
  return {
    lines,
    width: textW + 2 * H_PAD,
    height: lines.length * fontSize * LABEL_LINE_HEIGHT + 2 * V_PAD,
  };
}

/** Point at the half-way arc length along an edge polyline — the geometric
 *  centre of the connector, so a label seeds in the gap BETWEEN the two nodes
 *  rather than drifting under the target. Degenerate point lists fall back. */
export function edgePolylineMidpoint(points: ReadonlyArray<Pt>): Pt {
  return pointAtArcFraction(points, 0.5).p;
}

/** Position + unit normal at arc-length fraction t∈[0,1] of a polyline. The
 *  normal is perpendicular to the local segment (for proximal perp offsets). */
function pointAtArcFraction(
  points: ReadonlyArray<Pt>,
  t: number
): { p: Pt; nx: number; ny: number } {
  if (points.length === 0) return { p: { x: 0, y: 0 }, nx: 0, ny: 1 };
  if (points.length === 1)
    return { p: { x: points[0]!.x, y: points[0]!.y }, nx: 0, ny: 1 };
  const segLen: number[] = [];
  let total = 0;
  for (let k = 1; k < points.length; k++) {
    const len = Math.hypot(
      points[k]!.x - points[k - 1]!.x,
      points[k]!.y - points[k - 1]!.y
    );
    segLen.push(len);
    total += len;
  }
  let want = total * Math.max(0, Math.min(1, t));
  for (let k = 1; k < points.length; k++) {
    const len = segLen[k - 1]!;
    if (want <= len || k === points.length - 1) {
      const f = len === 0 ? 0 : Math.min(1, want / len);
      const ax = points[k - 1]!.x;
      const ay = points[k - 1]!.y;
      const bx = points[k]!.x;
      const by = points[k]!.y;
      const dx = bx - ax;
      const dy = by - ay;
      const dlen = Math.hypot(dx, dy) || 1;
      // Unit normal = perpendicular to the local tangent.
      return {
        p: { x: ax + dx * f, y: ay + dy * f },
        nx: -dy / dlen,
        ny: dx / dlen,
      };
    }
    want -= len;
  }
  const last = points[points.length - 1]!;
  return { p: { x: last.x, y: last.y }, nx: 0, ny: 1 };
}

function rectFromCenter(cx: number, cy: number, w: number, h: number): Rect {
  return {
    minX: cx - w / 2,
    minY: cy - h / 2,
    maxX: cx + w / 2,
    maxY: cy + h / 2,
  };
}

/** Does a label box centred at (cx,cy) overlap any obstacle (within pad)? */
function overlapsAny(
  cx: number,
  cy: number,
  w: number,
  h: number,
  obstacles: readonly Rect[],
  pad: number
): boolean {
  const minX = cx - w / 2 - pad;
  const minY = cy - h / 2 - pad;
  const maxX = cx + w / 2 + pad;
  const maxY = cy + h / 2 + pad;
  for (const o of obstacles) {
    if (minX < o.maxX && maxX > o.minX && minY < o.maxY && maxY > o.minY)
      return true;
  }
  return false;
}

/** Arc-length fractions sampled centre-outward (keeps the label proximal to the
 *  true midpoint), clamped away from the endpoints. */
function slideFractions(): number[] {
  const out = [0.5];
  for (let k = 1; k <= SLIDE_SAMPLES; k++) {
    const off = k * 0.08;
    if (0.5 - off >= 0.12) out.push(0.5 - off);
    if (0.5 + off <= 0.88) out.push(0.5 + off);
  }
  return out;
}

/** Find the nearest clear centre for a label box of (w,h) along/near `points`.
 *  Pass 1 slides along the line; pass 2 offsets perpendicular. null = no clear
 *  spot found within the proximity budget. */
function findClearPosition(
  w: number,
  h: number,
  points: ReadonlyArray<Pt>,
  obstacles: readonly Rect[]
): Pt | null {
  const ts = slideFractions();
  for (const t of ts) {
    const { p } = pointAtArcFraction(points, t);
    if (!overlapsAny(p.x, p.y, w, h, obstacles, BOX_CLEAR_PAD)) return p;
  }
  for (let mag = PERP_STEP; mag <= PERP_MAX; mag += PERP_STEP) {
    for (const t of ts) {
      const { p, nx, ny } = pointAtArcFraction(points, t);
      for (const sign of [-1, 1]) {
        const x = p.x + nx * mag * sign;
        const y = p.y + ny * mag * sign;
        if (!overlapsAny(x, y, w, h, obstacles, BOX_CLEAR_PAD)) return { x, y };
      }
    }
  }
  return null;
}

interface LabelBox {
  edgeIdx: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  lines: readonly string[];
  resolved: boolean;
}

/** Separate overlapping label boxes vertically (variable sizes), mirroring the
 *  old renderer pass. Runs after node-collision resolution; the caller re-checks
 *  node overlap afterwards. */
function resolveLabelOverlaps(boxes: LabelBox[]): void {
  const MAX_PASSES = 8;
  const PAD = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const dx = Math.abs(a.cx - b.cx);
        const dy = Math.abs(a.cy - b.cy);
        const overlapX = (a.w + b.w) / 2 + PAD - dx;
        const overlapY = (a.h + b.h) / 2 + PAD - dy;
        if (overlapX > 0 && overlapY > 0) {
          const shift = overlapY / 2 + 1;
          if (a.cy < b.cy) {
            a.cy -= shift;
            b.cy += shift;
          } else {
            a.cy += shift;
            b.cy -= shift;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

export interface PlaceEdgeLabelsResult {
  readonly layout: BLLayoutResult;
  /** Edge indices whose label still overlaps a node box (escalate to relayout). */
  readonly unresolved: number[];
}

/**
 * Wrap, then collision-resolve every edge label against node boxes (steps 1–2),
 * writing labelX/labelY/labelWidth/labelHeight/labelLines onto each edge. Returns
 * the edge indices that could not be cleared so the caller can trigger a
 * last-resort relayout.
 */
export function placeEdgeLabels(
  layout: BLLayoutResult,
  opts?: { fontSize?: number; maxWidth?: number }
): PlaceEdgeLabelsResult {
  const fontSize = opts?.fontSize ?? EDGE_LABEL_FONT_SIZE;
  const maxWidth = opts?.maxWidth ?? LABEL_MAX_WIDTH;

  // Obstacles = real node boxes + collapsed groups (drawn as boxes). Expanded
  // groups are containers — their interior is valid label space, so they are NOT
  // obstacles.
  const obstacles: Rect[] = [];
  for (const n of layout.nodes)
    obstacles.push(rectFromCenter(n.x, n.y, n.width, n.height));
  for (const g of layout.groups)
    if (g.collapsed)
      obstacles.push(rectFromCenter(g.x, g.y, g.width, g.height));

  const boxes: LabelBox[] = [];
  layout.edges.forEach((e, idx) => {
    if (!e.label || e.points.length < 2) return;
    const m = measureEdgeLabel(e.label, fontSize, maxWidth);
    const mid = edgePolylineMidpoint(e.points);
    let cy = mid.y;
    // Fold in the parallel-edge fan offset so each line's label clears its line.
    if (e.parallelCount > 1 && e.yOffset !== 0)
      cy += (e.yOffset < 0 ? -1 : 1) * (m.height / 2);
    boxes.push({
      edgeIdx: idx,
      cx: mid.x,
      cy,
      w: m.width,
      h: m.height,
      lines: m.lines,
      resolved: true,
    });
  });

  // Step 2: reposition any box that overlaps a node.
  for (const box of boxes) {
    if (!overlapsAny(box.cx, box.cy, box.w, box.h, obstacles, BOX_CLEAR_PAD))
      continue;
    const e = layout.edges[box.edgeIdx]!;
    const clear = findClearPosition(box.w, box.h, e.points, obstacles);
    if (clear) {
      box.cx = clear.x;
      box.cy = clear.y;
    } else {
      box.resolved = false;
    }
  }

  // Separate stacked labels, then re-check node overlap (a vertical nudge can
  // push a label back onto a box — that becomes an unresolved escalation).
  resolveLabelOverlaps(boxes);
  for (const box of boxes) {
    if (overlapsAny(box.cx, box.cy, box.w, box.h, obstacles, BOX_CLEAR_PAD))
      box.resolved = false;
  }

  const boxByIdx = new Map<number, LabelBox>();
  for (const b of boxes) boxByIdx.set(b.edgeIdx, b);
  const edges = layout.edges.map((e, idx) => {
    const b = boxByIdx.get(idx);
    if (!b) return e;
    return {
      ...e,
      labelX: b.cx,
      labelY: b.cy,
      labelWidth: b.w,
      labelHeight: b.h,
      labelLines: b.lines,
    };
  });

  return {
    layout: { ...layout, edges },
    unresolved: boxes.filter((b) => !b.resolved).map((b) => b.edgeIdx),
  };
}
