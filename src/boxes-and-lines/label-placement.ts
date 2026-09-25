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

import { curveBasis } from 'd3-shape';
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
export const BOX_CLEAR_PAD = 4; // min clearance kept between a label box and a node box
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
const CURVE_STEP = 4; // px between samples of a drawn edge curve
// A label's halo is only 0.9 opaque, so a line running through it still shows
// through the text; labels keep this far off every OTHER edge's line (#932).
const EDGE_CLEAR_PAD = 2;
// Band either side of a group's border, and the title strip at its top, that a
// label living INSIDE the group keeps off (#932). Keep the title numbers in
// sync with renderer.ts: 14px bold, centred, baseline 18px below the top.
const GROUP_BORDER_BAND = 4;
const GROUP_TITLE_FONT_SIZE = 14;
const GROUP_TITLE_DEPTH = 24;
const GROUP_LABEL_ZONE = 32;

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
  points: ReadonlyArray<Pt>,
  blocked: (cx: number, cy: number) => boolean,
  perpMax: number,
  firstSide: 1 | -1 = -1
): Pt | null {
  const ts = slideFractions();
  for (const t of ts) {
    const { p } = pointAtArcFraction(points, t);
    if (!blocked(p.x, p.y)) return p;
  }
  for (let mag = PERP_STEP; mag <= perpMax; mag += PERP_STEP) {
    for (const t of ts) {
      const { p, nx, ny } = pointAtArcFraction(points, t);
      for (const sign of [firstSide, -firstSide]) {
        const x = p.x + nx * mag * sign;
        const y = p.y + ny * mag * sign;
        if (!blocked(x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** The curve the renderer draws for an edge (curveBasis over its points),
 *  flattened to a dense run of points. */
function sampleDrawnCurve(points: ReadonlyArray<Pt>): Pt[] {
  const out: Pt[] = [];
  if (points.length < 2) return out;
  let cx = 0;
  let cy = 0;
  const ctx = {
    moveTo(x: number, y: number) {
      out.push({ x, y });
      cx = x;
      cy = y;
    },
    lineTo(x: number, y: number) {
      const n = Math.max(1, Math.ceil(Math.hypot(x - cx, y - cy) / CURVE_STEP));
      for (let k = 1; k <= n; k++)
        out.push({ x: cx + ((x - cx) * k) / n, y: cy + ((y - cy) * k) / n });
      cx = x;
      cy = y;
    },
    bezierCurveTo(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x: number,
      y: number
    ) {
      const n = Math.max(
        1,
        Math.ceil(
          (Math.hypot(x1 - cx, y1 - cy) +
            Math.hypot(x2 - x1, y2 - y1) +
            Math.hypot(x - x2, y - y2)) /
            CURVE_STEP
        )
      );
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const u = 1 - t;
        out.push({
          x:
            u * u * u * cx +
            3 * u * u * t * x1 +
            3 * u * t * t * x2 +
            t * t * t * x,
          y:
            u * u * u * cy +
            3 * u * u * t * y1 +
            3 * u * t * t * y2 +
            t * t * t * y,
        });
      }
      cx = x;
      cy = y;
    },
    closePath() {},
  };
  const curve = curveBasis(ctx as unknown as CanvasRenderingContext2D);
  curve.lineStart();
  for (const p of points) curve.point(p.x, p.y);
  curve.lineEnd();
  return out;
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

  // Preferred clearance, on top of the obstacles above (#932): the lines of
  // every OTHER edge, the border band of a group the edge lives inside, and the
  // title of every expanded group. None of it decides `resolved` — that stays
  // the node-and-foreign-group test the relayout escalates on — so a label that
  // cannot find such a spot keeps the one it had.
  const curves = layout.edges.map((e) => {
    const pts = sampleDrawnCurve(e.points);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { pts, minX, minY, maxX, maxY };
  });
  const crossesOtherEdge = (
    edgeIdx: number,
    cx: number,
    cy: number,
    w: number,
    h: number
  ): boolean => {
    const minX = cx - w / 2 - EDGE_CLEAR_PAD;
    const minY = cy - h / 2 - EDGE_CLEAR_PAD;
    const maxX = cx + w / 2 + EDGE_CLEAR_PAD;
    const maxY = cy + h / 2 + EDGE_CLEAR_PAD;
    for (let j = 0; j < curves.length; j++) {
      if (j === edgeIdx) continue;
      const c = curves[j]!;
      if (c.maxX < minX || c.minX > maxX || c.maxY < minY || c.minY > maxY)
        continue;
      for (const p of c.pts)
        if (p.x > minX && p.x < maxX && p.y > minY && p.y < maxY) return true;
    }
    return false;
  };
  const hasSubGroup = new Set(
    (opts?.groups ?? []).flatMap((g) => (g.parentGroup ? [g.parentGroup] : []))
  );
  const drawnTop = (g: (typeof layout.groups)[number]): number =>
    g.y - g.height / 2 - (hasSubGroup.has(g.label) ? GROUP_LABEL_ZONE : 0);
  const titleRects: Rect[] = layout.groups
    .filter((g) => !g.collapsed)
    .map((g) => {
      const tw = measureText(g.label, GROUP_TITLE_FONT_SIZE, { bold: true });
      const top = drawnTop(g);
      return {
        minX: g.x - tw / 2,
        minY: top,
        maxX: g.x + tw / 2,
        maxY: top + GROUP_TITLE_DEPTH,
      };
    });
  const borderBands = (g: (typeof layout.groups)[number]): Rect[] => {
    const B = GROUP_BORDER_BAND;
    const l = g.x - g.width / 2;
    const r = g.x + g.width / 2;
    const t = drawnTop(g);
    const b = g.y + g.height / 2;
    return [
      { minX: l - B, minY: t - B, maxX: r + B, maxY: t + B },
      { minX: l - B, minY: b - B, maxX: r + B, maxY: b + B },
      { minX: l - B, minY: t - B, maxX: l + B, maxY: b + B },
      { minX: r - B, minY: t - B, maxX: r + B, maxY: b + B },
    ];
  };
  const preferredCache = new Map<number, readonly Rect[]>();
  const preferredFor = (edgeIdx: number): readonly Rect[] => {
    const cached = preferredCache.get(edgeIdx);
    if (cached !== undefined) return cached;
    const e = layout.edges[edgeIdx]!;
    const src = containers.get(e.source) ?? noContainers;
    const tgt = containers.get(e.target) ?? noContainers;
    const own = layout.groups.filter(
      (g) => !g.collapsed && src.has(g.label) && tgt.has(g.label)
    );
    const out = [
      ...obstaclesFor(edgeIdx),
      ...titleRects,
      ...own.flatMap(borderBands),
    ];
    preferredCache.set(edgeIdx, out);
    return out;
  };
  const clearOfAll = (
    edgeIdx: number,
    cx: number,
    cy: number,
    w: number,
    h: number
  ) =>
    !overlapsAny(cx, cy, w, h, preferredFor(edgeIdx), BOX_CLEAR_PAD) &&
    !crossesOtherEdge(edgeIdx, cx, cy, w, h);

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
  //
  // Above both sits the preferred set (#932), tried first and given up without
  // cost: a spot clearing it is taken, otherwise a label already clear of its
  // obstacles stays put and one that is not falls through to the ladder below.
  for (const box of boxes) {
    const obstacles = obstaclesFor(box.edgeIdx);
    if (clearOfAll(box.edgeIdx, box.cx, box.cy, box.w, box.h)) continue;
    const e = layout.edges[box.edgeIdx]!;
    const { w, h } = box;
    // Offsets try the side of the line the label already sits on first, so a
    // fanned pair's labels, folded apart above, do not swap sides.
    const mid = pointAtArcFraction(e.points, 0.5);
    const side =
      (box.cx - mid.p.x) * mid.nx + (box.cy - mid.p.y) * mid.ny > 0 ? 1 : -1;
    const ideal = findClearPosition(
      e.points,
      (x, y) => !clearOfAll(box.edgeIdx, x, y, w, h),
      perpMax,
      side
    );
    if (ideal) {
      box.cx = ideal.x;
      box.cy = ideal.y;
      continue;
    }
    if (!overlapsAny(box.cx, box.cy, w, h, obstacles, BOX_CLEAR_PAD)) continue;
    const clear =
      findClearPosition(
        e.points,
        (x, y) => overlapsAny(x, y, w, h, obstacles, BOX_CLEAR_PAD),
        perpMax
      ) ??
      findClearPosition(
        e.points,
        (x, y) => overlapsAny(x, y, w, h, baseObstacles, BOX_CLEAR_PAD),
        perpMax
      );
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
      labelResolved: b.resolved,
    };
  });

  return {
    layout: { ...layout, edges },
    unresolved: boxes.filter((b) => !b.resolved).map((b) => b.edgeIdx),
  };
}
