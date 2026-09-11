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
import type { BLGroup } from './types';
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
// Max perpendicular offset before giving up — TWO reaches, used in order (#703).
//
// NEAR is the everyday search, and it is the one that decides whether a layout
// escalates to the label-reserving relayout (layout.ts): a label NEAR cannot
// place is what makes the engine open a gap for it, and that relayout puts
// labels back ON their lines. WIDE is a last resort, run only on the layout
// already chosen, only for labels still on a box after the relayout decision.
// Using WIDE for the first pass stops that relayout from running — a small LR diagram
// (test-fixtures/canvas-spike/02-tags-desc-comments.dgmo) went from every label
// 0px from its line to two of them 48px out, with no overlap to fix.
//
// WIDE is a MEASURED step, not whatever clears everything: on the OAUTH fixture
// in tests/boxes-and-lines-edge-labels.test.ts, 48 clears nothing; 56 clears
// line 29 ("Signs tokens with", which covered both boxes it names) at 56px from
// its line — the "legitimate displacement" that test already documents; 72
// clears one more at 72px; 80 clears all three by sitting exactly on that
// test's 80px detachment bound, i.e. by trading the #640 defect back in. Each
// px here is distance from the line the label names.
export const LABEL_REACH_NEAR = 40;
export const LABEL_REACH_WIDE = 56;
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
  obstacles: readonly Rect[],
  perpMax: number
): Pt | null {
  const ts = slideFractions();
  for (const t of ts) {
    const { p } = pointAtArcFraction(points, t);
    if (!overlapsAny(p.x, p.y, w, h, obstacles, BOX_CLEAR_PAD)) return p;
  }
  for (let mag = PERP_STEP; mag <= perpMax; mag += PERP_STEP) {
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

/**
 * label -> every group label containing it, transitively, a group counting as
 * containing itself. Used to decide whether an expanded group is an obstacle for
 * a given edge's label (#777): it is NOT, exactly when it contains both
 * endpoints — the "this edge lives here" case the group interior was always
 * meant to serve.
 *
 * Parentage is read from `parentGroup` where the parser set it and inferred from
 * a `children` entry that is itself a group where it did not, so a nested group
 * is never mistaken for a foreign one just because one of the two was absent.
 */
function buildGroupContainers(
  groups: readonly BLGroup[]
): Map<string, Set<string>> {
  const byLabel = new Map(groups.map((g) => [g.label, g]));
  const parent = new Map<string, string>();
  for (const g of groups)
    for (const c of g.children) if (byLabel.has(c)) parent.set(c, g.label);
  // An explicit parentGroup wins over one inferred from a children list.
  for (const g of groups) if (g.parentGroup) parent.set(g.label, g.parentGroup);

  /** A group plus its ancestors. Guarded against a parent cycle, which a
   *  hand-written diagram can express even though the parser should not. */
  const chainOf = (label: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = label;
    while (cur !== undefined && byLabel.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = parent.get(cur);
    }
    return out;
  };

  const containers = new Map<string, Set<string>>();
  for (const g of groups) containers.set(g.label, new Set(chainOf(g.label)));
  for (const g of groups) {
    const chain = chainOf(g.label);
    for (const c of g.children) {
      if (byLabel.has(c)) continue; // a child group already has its own chain
      let set = containers.get(c);
      if (!set) {
        set = new Set<string>();
        containers.set(c, set);
      }
      for (const a of chain) set.add(a);
    }
  }
  return containers;
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
  /** Edge indices whose label still overlaps an obstacle — a node box, a
   *  collapsed group, or an expanded group the edge does not live inside
   *  (#777). Drives the caller's escalation to a label-reserving relayout. */
  readonly unresolved: number[];
}

/**
 * Wrap, then collision-resolve every edge label against the boxes it must clear
 * (steps 1–2), writing labelX/labelY/labelWidth/labelHeight/labelLines onto each
 * edge. Returns the edge indices that could not be cleared so the caller can
 * trigger a last-resort relayout.
 */
export function placeEdgeLabels(
  layout: BLLayoutResult,
  opts?: {
    fontSize?: number;
    maxWidth?: number;
    perpMax?: number;
    /** Parsed groups, for the containment test below. Omitted, every expanded
     *  group is treated as valid label space for every label — the pre-#777
     *  behaviour, kept so a caller without the parse still lays out. */
    groups?: readonly BLGroup[];
  }
): PlaceEdgeLabelsResult {
  const fontSize = opts?.fontSize ?? EDGE_LABEL_FONT_SIZE;
  const maxWidth = opts?.maxWidth ?? LABEL_MAX_WIDTH;
  const perpMax = opts?.perpMax ?? LABEL_REACH_NEAR;

  // Obstacles are PER EDGE, because an expanded group is an obstacle for some
  // labels and valid space for others (#777).
  //
  // Base, for every label = real node boxes + collapsed groups (drawn as boxes).
  //
  // An expanded group is a container, and its interior is valid label space for
  // a label whose edge LIVES there — both endpoints inside it. For an edge that
  // merely CROSSES the boundary the label belongs to neither side, and nothing
  // used to stop it landing astride the border: this list never held the group,
  // so findClearPosition reported a clean placement having never looked, while
  // the renderer — which draws edge labels last, over everything — cut the
  // label's knockout halo through the group's fill, border and title. Measured
  // on a real diagram: two labels each covering more than half the width of a
  // 143px-wide group, one of them across its title. 9 of the 25 grouped
  // boxes-and-lines diagrams in the corpus carried it, tests/fixtures included.
  //
  // Containment is TRANSITIVE and BOTH endpoints must be inside, which is what
  // makes nesting come out right: a label on an edge inside a child group is not
  // evicted from that child's ancestors, and a label on an edge between two
  // sibling children may use the parent's corridor but neither child's interior.
  const baseObstacles: Rect[] = [];
  for (const n of layout.nodes)
    baseObstacles.push(rectFromCenter(n.x, n.y, n.width, n.height));
  const expandedGroups: { readonly label: string; readonly rect: Rect }[] = [];
  for (const g of layout.groups) {
    const r = rectFromCenter(g.x, g.y, g.width, g.height);
    if (g.collapsed) baseObstacles.push(r);
    else expandedGroups.push({ label: g.label, rect: r });
  }

  const containers = buildGroupContainers(opts?.groups ?? []);
  const noContainers: ReadonlySet<string> = new Set<string>();
  const obstacleCache = new Map<number, readonly Rect[]>();
  const obstaclesFor = (edgeIdx: number): readonly Rect[] => {
    const cached = obstacleCache.get(edgeIdx);
    if (cached !== undefined) return cached;
    let out: readonly Rect[] = baseObstacles;
    if (expandedGroups.length > 0) {
      const e = layout.edges[edgeIdx]!;
      const src = containers.get(e.source) ?? noContainers;
      const tgt = containers.get(e.target) ?? noContainers;
      const foreign = expandedGroups
        .filter((g) => !(src.has(g.label) && tgt.has(g.label)))
        .map((g) => g.rect);
      if (foreign.length > 0) out = [...baseObstacles, ...foreign];
    }
    obstacleCache.set(edgeIdx, out);
    return out;
  };

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

  // Step 2: reposition any box that overlaps one of ITS OWN obstacles.
  //
  // 🔴 The two obstacle sets are a PRIORITY, not alternatives, and collapsing
  // them into one search is a regression: asking for a position that clears the
  // groups too can fail where clearing the nodes alone would have succeeded, and
  // a failed search leaves the label on its raw midpoint — which is often ON a
  // node. Measured while building #777: searching the combined set in one pass
  // took the OAUTH fixture in this file from 2 labels over node boxes to 4,
  // undoing half of #703. So the group pass can only ever ADD clearance.
  //
  // The ranking is what the reader loses. A label over a node box hides the
  // node's NAME (#703); a label over a group's fill hides tint and a border. So
  // the base set — node boxes and collapsed groups — is the floor, and a
  // position clearing it is kept even when no position clears the groups too.
  for (const box of boxes) {
    const obstacles = obstaclesFor(box.edgeIdx);
    if (!overlapsAny(box.cx, box.cy, box.w, box.h, obstacles, BOX_CLEAR_PAD))
      continue;
    const e = layout.edges[box.edgeIdx]!;
    const clear =
      findClearPosition(box.w, box.h, e.points, obstacles, perpMax) ??
      findClearPosition(box.w, box.h, e.points, baseObstacles, perpMax);
    if (clear) {
      box.cx = clear.x;
      box.cy = clear.y;
    }
    // Unresolved whenever the FULL set is not cleared, group clearance included
    // — that is the signal the caller escalates on, and a relayout is exactly
    // what can open the corridor this label could not find.
    if (overlapsAny(box.cx, box.cy, box.w, box.h, obstacles, BOX_CLEAR_PAD))
      box.resolved = false;
  }

  // Separate stacked labels, then re-check overlap (a vertical nudge can push a
  // label back onto a box — that becomes an unresolved escalation).
  resolveLabelOverlaps(boxes);
  for (const box of boxes) {
    const obstacles = obstaclesFor(box.edgeIdx);
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
