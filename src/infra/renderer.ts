// ============================================================
// Infra Chart SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import type { InfraTagGroup } from './types';
import { resolveColor } from '../colors';
import { renderInlineText } from '../utils/inline-markdown';
import { preprocessDescriptionLine } from '../utils/description-helpers';
import type {
  InfraLayoutResult,
  InfraLayoutNode,
  InfraLayoutEdge,
  InfraLayoutGroup,
} from './layout';
import {
  inferRoles,
  collectDiagramRoles,
  collectFanoutSourceIds,
  FANOUT_ROLE,
} from './roles';
import { parseInfra } from './parser';
import { computeInfra } from './compute';
import { layoutInfra } from './layout';
import {
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  measureLegendText,
} from '../utils/legend-constants';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
  TITLE_OFFSET,
} from '../utils/title-constants';

// ============================================================
// Constants
// ============================================================

const NODE_FONT_SIZE = 13;
const META_FONT_SIZE = 10;
const META_LINE_HEIGHT = 14;
const EDGE_LABEL_FONT_SIZE = 11;
const GROUP_LABEL_FONT_SIZE = 14;
const NODE_BORDER_RADIUS = 8;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const OVERLOAD_STROKE_WIDTH = 3;
const ROLE_DOT_RADIUS = 3;
const NODE_HEADER_HEIGHT = 28;
const NODE_SEPARATOR_GAP = 4;
const NODE_PAD_BOTTOM = 10;
const COLLAPSE_BAR_HEIGHT = 6;
const COLLAPSE_BAR_INSET = 0;

const LEGEND_FIXED_GAP = 16; // gap between fixed legend and scaled diagram — local, not shared
const SPEED_BADGE_H_PAD = 5; // horizontal padding inside active speed badge
const SPEED_BADGE_V_PAD = 3; // vertical padding inside active speed badge
const SPEED_BADGE_GAP = 6; // gap between speed option slots

// Health colors (from UX spec)
const COLOR_HEALTHY = '#22c55e';
const COLOR_WARNING = '#eab308';
const COLOR_OVERLOADED = '#ef4444';
/** SLO thresholds resolved for a single node (chart-level + per-node override). */
interface NodeSlo {
  availThreshold: number | null; // fraction e.g. 0.999
  latencyP90: number | null; // ms e.g. 200
  warningMargin: number; // fraction e.g. 0.05
}

/** Resolve effective SLO for a node: per-node properties take precedence over chart-level options.
 *  Returns null if neither availThreshold nor latencyP90 is declared. */
function resolveNodeSlo(
  node: InfraLayoutNode,
  diagramOptions: Record<string, string>
): NodeSlo | null {
  const nodeProp = (key: string) => node.properties.find((p) => p.key === key);

  const availRaw =
    nodeProp('slo-availability')?.value ?? diagramOptions['slo-availability'];
  const latencyRaw =
    nodeProp('slo-p90-latency-ms')?.value ??
    diagramOptions['slo-p90-latency-ms'];
  const marginRaw =
    nodeProp('slo-warning-margin')?.value ??
    diagramOptions['slo-warning-margin'];

  const availParsed =
    availRaw != null
      ? parseFloat(String(availRaw).replace('%', '')) / 100
      : NaN;
  const availThreshold = !isNaN(availParsed) ? availParsed : null;
  const latencyParsed =
    latencyRaw != null ? parseFloat(String(latencyRaw)) : NaN;
  const latencyP90 = !isNaN(latencyParsed) ? latencyParsed : null;
  const marginParsed =
    marginRaw != null
      ? parseFloat(String(marginRaw).replace('%', '')) / 100
      : NaN;
  const warningMargin = !isNaN(marginParsed) ? marginParsed : 0.05;

  if (availThreshold == null && latencyP90 == null) return null;
  return { availThreshold, latencyP90, warningMargin };
}

/** A row in the node card body. `inverted` renders as a colored pill with light text. */
interface NodeRow {
  key: string;
  value: string;
  valueFill: string;
  fontWeight: string;
  inverted?: boolean;
  invertedBg?: string;
}

/** Computed metric row (latency percentiles, availability, CB state). */
interface ComputedRow {
  key: string;
  value: string;
  color?: string;
  inverted?: boolean;
}

// Animation constants
const FLOW_SPEED_MIN = 2.5; // seconds at max RPS
const FLOW_SPEED_MAX = 6; // seconds at min RPS
const PARTICLE_R = 5; // particle circle radius
const PARTICLE_COUNT_MIN = 1; // min particles per edge
const PARTICLE_COUNT_MAX = 4; // max particles per edge (at max RPS)
const NODE_PULSE_SPEED = 1.5; // seconds for warning pulse
const NODE_PULSE_OVERLOAD = 0.7; // seconds for overload pulse

// Reject particle constants
const REJECT_PARTICLE_R = PARTICLE_R;
const REJECT_DROP_DISTANCE = 30; // px downward travel
const REJECT_DURATION_MIN = 1.5; // seconds per drop at max reject
const REJECT_DURATION_MAX = 3; // seconds per drop at min reject
const REJECT_COUNT_MIN = 1;
const REJECT_COUNT_MAX = 3;

// ============================================================
// Edge path generator
// ============================================================

type Pt = { x: number; y: number };

/** Produce an SVG path string for a sequence of waypoints.
 *  2-point paths use curveBumpX/Y (nice S-curve).
 *  Multi-point obstacle-avoiding paths use CatmullRom for a smooth fit. */
function buildPathD(pts: Pt[], direction: 'LR' | 'TB'): string {
  const gen = d3Shape
    .line<Pt>()
    .x((d) => d.x)
    .y((d) => d.y);
  if (pts.length <= 2) {
    gen.curve(direction === 'TB' ? d3Shape.curveBumpY : d3Shape.curveBumpX);
  } else {
    gen.curve(d3Shape.curveCatmullRom.alpha(0.5));
  }
  return gen(pts) ?? '';
}

type Rect = { x: number; y: number; width: number; height: number };

/** Port-order exit and enter points for edges to eliminate fan-out crossings.
 *
 *  For each node with ≥2 outgoing edges: sort edges by target perpendicular coord
 *  and assign source-border exit positions in the same order.
 *  For each node with ≥2 incoming edges: sort edges by source perpendicular coord
 *  and assign target-border enter positions in the same order.
 *
 *  Returns two maps keyed by "sourceId:targetId":
 *  - srcPts: port-ordered exit point on the source border
 *  - tgtPts: port-ordered enter point on the target border */
function computePortPts(
  edges: InfraLayoutEdge[],
  nodeMap: Map<string, InfraLayoutNode>,
  direction: 'LR' | 'TB'
): { srcPts: Map<string, Pt>; tgtPts: Map<string, Pt> } {
  const srcPts = new Map<string, Pt>();
  const tgtPts = new Map<string, Pt>();
  const PAD = 0.1; // keep ports 10% in from node edges

  const activeEdges = edges.filter((e) => e.points.length > 0);

  // ── Source (exit) port ordering ──────────────────────────────────────────
  const bySource = new Map<string, InfraLayoutEdge[]>();
  for (const e of activeEdges) {
    if (!bySource.has(e.sourceId)) bySource.set(e.sourceId, []);
    bySource.get(e.sourceId)!.push(e);
  }
  for (const [sourceId, es] of bySource) {
    if (es.length < 2) continue;
    const source = nodeMap.get(sourceId);
    if (!source) continue;
    const sorted = es
      .map((e) => ({ e, t: nodeMap.get(e.targetId) }))
      .filter(
        (x): x is { e: InfraLayoutEdge; t: InfraLayoutNode } => x.t != null
      )
      .sort((a, b) => (direction === 'LR' ? a.t.y - b.t.y : a.t.x - b.t.x));
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0.5 : PAD + ((1 - 2 * PAD) * i) / (n - 1);
      const { e, t } = sorted[i];
      const isBackward = direction === 'LR' ? t.x < source.x : t.y < source.y;
      if (direction === 'LR') {
        srcPts.set(`${e.sourceId}:${e.targetId}`, {
          x: isBackward
            ? source.x - source.width / 2
            : source.x + source.width / 2,
          y: source.y - source.height / 2 + frac * source.height,
        });
      } else {
        srcPts.set(`${e.sourceId}:${e.targetId}`, {
          x: source.x - source.width / 2 + frac * source.width,
          y: isBackward
            ? source.y - source.height / 2
            : source.y + source.height / 2,
        });
      }
    }
  }

  // ── Target (enter) port ordering ─────────────────────────────────────────
  const byTarget = new Map<string, InfraLayoutEdge[]>();
  for (const e of activeEdges) {
    if (!byTarget.has(e.targetId)) byTarget.set(e.targetId, []);
    byTarget.get(e.targetId)!.push(e);
  }
  for (const [targetId, es] of byTarget) {
    if (es.length < 2) continue;
    const target = nodeMap.get(targetId);
    if (!target) continue;
    const sorted = es
      .map((e) => ({ e, s: nodeMap.get(e.sourceId) }))
      .filter(
        (x): x is { e: InfraLayoutEdge; s: InfraLayoutNode } => x.s != null
      )
      .sort((a, b) => (direction === 'LR' ? a.s.y - b.s.y : a.s.x - b.s.x));
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0.5 : PAD + ((1 - 2 * PAD) * i) / (n - 1);
      const { e, s } = sorted[i];
      const isBackward = direction === 'LR' ? target.x < s.x : target.y < s.y;
      if (direction === 'LR') {
        tgtPts.set(`${e.sourceId}:${e.targetId}`, {
          x: isBackward
            ? target.x + target.width / 2
            : target.x - target.width / 2,
          y: target.y - target.height / 2 + frac * target.height,
        });
      } else {
        tgtPts.set(`${e.sourceId}:${e.targetId}`, {
          x: target.x - target.width / 2 + frac * target.width,
          y: isBackward
            ? target.y + target.height / 2
            : target.y - target.height / 2,
        });
      }
    }
  }

  return { srcPts, tgtPts };
}

/** Find the Y lane for routing around blocking obstacles.
 *  Prefers threading through Y gaps between blocking rects over routing above/below all.
 *  Picks the candidate closest to targetY to minimise arc size.
 *
 *  Uses a tight merge expansion (MERGE_SLOP) so narrow inter-group gaps are preserved
 *  and can be threaded, rather than being swallowed into one large merged interval. */
function findRoutingLane(
  blocking: Rect[],
  targetY: number,
  margin: number
): number {
  // Use a small slop for merging so closely-spaced (but distinct) groups
  // stay as separate intervals and the gap between them can be threaded.
  const MERGE_SLOP = 4;
  const sorted = [...blocking].sort(
    (a, b) => a.y + a.height / 2 - (b.y + b.height / 2)
  );
  const merged: [number, number][] = [];
  for (const r of sorted) {
    const lo = r.y - MERGE_SLOP;
    const hi = r.y + r.height + MERGE_SLOP;
    if (merged.length && lo <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], hi);
    } else {
      merged.push([lo, hi]);
    }
  }
  if (merged.length === 0) return targetY;

  // Candidate lanes: above all, below all, mid-points of gaps wide enough to thread.
  // MIN_GAP: allow narrow gaps (edge is ~1.5px, so even 10px clearance is fine).
  const MIN_GAP = 10;
  const candidates: number[] = [
    merged[0][0] - margin, // above all blocking rects
    merged[merged.length - 1][1] + margin, // below all blocking rects
  ];
  for (let i = 0; i < merged.length - 1; i++) {
    const gapLo = merged[i][1];
    const gapHi = merged[i + 1][0];
    if (gapHi - gapLo >= MIN_GAP) {
      candidates.push((gapLo + gapHi) / 2); // thread through the gap
    }
  }

  // Return the candidate closest to targetY (tightest arc)
  return candidates.reduce(
    (best, c) => (Math.abs(c - targetY) < Math.abs(best - targetY) ? c : best),
    candidates[0]
  );
}

/** Check whether segment p1→p2 passes through (or has an endpoint inside) the rectangle. */
function segmentIntersectsRect(
  p1: Pt,
  p2: Pt,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  const { x: rx, y: ry, width: rw, height: rh } = rect;
  const rr = rx + rw;
  const rb = ry + rh;
  // Point-in-rect check
  const inRect = (p: Pt) => p.x >= rx && p.x <= rr && p.y >= ry && p.y <= rb;
  if (inRect(p1) || inRect(p2)) return true;
  // Segment bounding box vs rect
  if (Math.max(p1.x, p2.x) < rx || Math.min(p1.x, p2.x) > rr) return false;
  if (Math.max(p1.y, p2.y) < ry || Math.min(p1.y, p2.y) > rb) return false;
  // Cross product sign helper (z-component of cross product)
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  // Does segment p1p2 cross segment a→b?
  const crosses = (a: Pt, b: Pt) => {
    const d1 = cross(a, b, p1);
    const d2 = cross(a, b, p2);
    const d3 = cross(p1, p2, a);
    const d4 = cross(p1, p2, b);
    return (
      ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    );
  };
  const tl: Pt = { x: rx, y: ry };
  const tr: Pt = { x: rr, y: ry };
  const br: Pt = { x: rr, y: rb };
  const bl: Pt = { x: rx, y: rb };
  return (
    crosses(tl, tr) || crosses(tr, br) || crosses(br, bl) || crosses(bl, tl)
  );
}

/** Check whether the curveBumpX/Y S-curve from sc to tc intersects rect.
 *
 *  curveBumpX (LR) stays near sc.y for the left half of the edge, transitions
 *  vertically at the midpoint, then stays near tc.y for the right half.
 *  Approximated as three Manhattan segments:
 *    sc → (midX, sc.y) → (midX, tc.y) → tc
 *
 *  curveBumpY (TB) mirrors this on the other axis. */
function curveIntersectsRect(
  sc: Pt,
  tc: Pt,
  rect: Rect,
  direction: 'LR' | 'TB'
): boolean {
  if (direction === 'LR') {
    const midX = (sc.x + tc.x) / 2;
    const m1: Pt = { x: midX, y: sc.y };
    const m2: Pt = { x: midX, y: tc.y };
    return (
      segmentIntersectsRect(sc, m1, rect) ||
      segmentIntersectsRect(m1, m2, rect) ||
      segmentIntersectsRect(m2, tc, rect)
    );
  } else {
    const midY = (sc.y + tc.y) / 2;
    const m1: Pt = { x: sc.x, y: midY };
    const m2: Pt = { x: tc.x, y: midY };
    return (
      segmentIntersectsRect(sc, m1, rect) ||
      segmentIntersectsRect(m1, m2, rect) ||
      segmentIntersectsRect(m2, tc, rect)
    );
  }
}

/** Compute waypoints for an edge.
 *
 *  - Backward edges (going against the primary layout direction) arc above/left
 *    of all layout content to avoid crossing everything.
 *  - Forward edges that cross a group bounding box or an unrelated node arc
 *    above or below the collective blocking region (gap-aware Y routing).
 *  - Clear forward edges use a direct 2-point path (curveBumpX/Y S-curve). */
function edgeWaypoints(
  source: InfraLayoutNode,
  target: InfraLayoutNode,
  groups: InfraLayoutGroup[],
  nodes: InfraLayoutNode[],
  direction: 'LR' | 'TB',
  margin = 30,
  srcExitPt?: Pt, // port-ordered exit point on source border
  tgtEnterPt?: Pt // port-ordered enter point on target border
): Pt[] {
  const sc: Pt = { x: source.x, y: source.y };
  const tc: Pt = { x: target.x, y: target.y };

  // ── Backward edge handling ───────────────────────────────────────────────
  // curveBumpX/Y on a backward edge creates a loop. Route around obstacles
  // in the backward path's axis band for a tight arc (not global min/max).
  const isBackward = direction === 'LR' ? tc.x < sc.x : tc.y < sc.y;
  if (isBackward) {
    if (direction === 'LR') {
      // Collect group/node rects that overlap the X band [tc.x, sc.x]
      const xBandObs: Rect[] = [];
      for (const g of groups) {
        if (g.x + g.width < tc.x - margin || g.x > sc.x + margin) continue;
        xBandObs.push({ x: g.x, y: g.y, width: g.width, height: g.height });
      }
      for (const n of nodes) {
        if (n.id === source.id || n.id === target.id) continue;
        const nLeft = n.x - n.width / 2;
        const nRight = n.x + n.width / 2;
        if (nRight < tc.x - margin || nLeft > sc.x + margin) continue;
        xBandObs.push({
          x: nLeft,
          y: n.y - n.height / 2,
          width: n.width,
          height: n.height,
        });
      }
      const midY = (sc.y + tc.y) / 2;
      const routeY =
        xBandObs.length > 0 ? findRoutingLane(xBandObs, midY, margin) : midY;
      const exitBorder: Pt =
        srcExitPt ?? nodeBorderPoint(source, { x: sc.x, y: routeY });
      const exitPt: Pt = { x: exitBorder.x, y: routeY };
      const enterPt: Pt = { x: tc.x, y: routeY };
      const tp = tgtEnterPt ?? nodeBorderPoint(target, enterPt);
      return srcExitPt
        ? [srcExitPt, exitPt, enterPt, tp]
        : [exitBorder, exitPt, enterPt, tp];
    } else {
      // TB backward: collect obstacles in Y band [tc.y, sc.y]; find X lane
      const yBandObs: Rect[] = [];
      for (const g of groups) {
        if (g.y + g.height < tc.y - margin || g.y > sc.y + margin) continue;
        yBandObs.push({ x: g.x, y: g.y, width: g.width, height: g.height });
      }
      for (const n of nodes) {
        if (n.id === source.id || n.id === target.id) continue;
        const nTop = n.y - n.height / 2;
        const nBot = n.y + n.height / 2;
        if (nBot < tc.y - margin || nTop > sc.y + margin) continue;
        yBandObs.push({
          x: n.x - n.width / 2,
          y: nTop,
          width: n.width,
          height: n.height,
        });
      }
      // Rotate axes so findRoutingLane (which works in Y) resolves an X lane
      const rotated = yBandObs.map((r) => ({
        x: r.y,
        y: r.x,
        width: r.height,
        height: r.width,
      }));
      const midX = (sc.x + tc.x) / 2;
      const routeX =
        rotated.length > 0 ? findRoutingLane(rotated, midX, margin) : midX;
      const exitPt: Pt = srcExitPt ?? { x: routeX, y: sc.y };
      const enterPt: Pt = { x: routeX, y: tc.y };
      return [
        srcExitPt ?? nodeBorderPoint(source, exitPt),
        exitPt,
        enterPt,
        tgtEnterPt ?? nodeBorderPoint(target, enterPt),
      ];
    }
  }

  // ── Forward edge: obstacle avoidance (groups + individual nodes) ─────────
  const blocking: { x: number; y: number; width: number; height: number }[] =
    [];
  const blockingGroupIds = new Set<string>();

  // Use actual path endpoints (port-ordered) for more accurate blocking detection.
  // Node centers underestimate midX/midY, causing nearby obstacles to go undetected.
  const pathSrc: Pt = srcExitPt ?? sc;
  const pathTgt: Pt = tgtEnterPt ?? tc;

  // Groups (excluding source/target groups)
  for (const g of groups) {
    if (g.id === source.groupId || g.id === target.groupId) continue;
    const gRect: Rect = { x: g.x, y: g.y, width: g.width, height: g.height };
    if (curveIntersectsRect(pathSrc, pathTgt, gRect, direction)) {
      blocking.push(gRect);
      blockingGroupIds.add(g.id);
    }
  }

  // Individual nodes not already covered by a blocking group rect
  for (const n of nodes) {
    if (n.id === source.id || n.id === target.id) continue;
    // Skip nodes in source/target groups (routing around the group handles them)
    if (
      n.groupId &&
      (n.groupId === source.groupId || n.groupId === target.groupId)
    )
      continue;
    // Skip nodes inside a group whose bounding box is already blocking
    if (n.groupId && blockingGroupIds.has(n.groupId)) continue;
    const nodeRect: Rect = {
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
      width: n.width,
      height: n.height,
    };
    if (curveIntersectsRect(pathSrc, pathTgt, nodeRect, direction)) {
      blocking.push(nodeRect);
    }
  }

  if (blocking.length === 0) {
    // Direct 2-point path — use port-ordered entry/exit points when provided.
    const sp = srcExitPt ?? nodeBorderPoint(source, tc);
    const tp = tgtEnterPt ?? nodeBorderPoint(target, sp);
    return [sp, tp];
  }

  const obsLeft = Math.min(...blocking.map((o) => o.x));
  const obsRight = Math.max(...blocking.map((o) => o.x + o.width));

  const routeY = findRoutingLane(blocking, tc.y, margin);

  // Clamp exit/enter X to [sc.x, tc.x] for LR so the path never reverses
  // direction when an obstacle's bounding box extends past source or target.
  const exitX =
    direction === 'LR' ? Math.max(sc.x, obsLeft - margin) : obsLeft - margin;
  const enterX =
    direction === 'LR' ? Math.min(tc.x, obsRight + margin) : obsRight + margin;
  const exitPt: Pt = { x: exitX, y: routeY };
  const enterPt: Pt = { x: enterX, y: routeY };

  const tp = tgtEnterPt ?? nodeBorderPoint(target, enterPt);

  if (srcExitPt) {
    return [srcExitPt, exitPt, enterPt, tp];
  }

  return [nodeBorderPoint(source, exitPt), exitPt, enterPt, tp];
}

/** Compute the point on a node's border closest to an external target point. */
function nodeBorderPoint(
  node: InfraLayoutNode,
  target: { x: number; y: number }
): { x: number; y: number } {
  const hw = node.width / 2;
  const hh = node.height / 2;
  const dx = target.x - node.x;
  const dy = target.y - node.y;
  if (dx === 0 && dy === 0) return { x: node.x + hw, y: node.y };

  // Scale factor to reach the bounding box edge
  const sx = hw / Math.abs(dx || 1);
  const sy = hh / Math.abs(dy || 1);
  const s = Math.min(sx, sy);

  return { x: node.x + dx * s, y: node.y + dy * s };
}

/** Map RPS to animation duration — higher RPS = faster (shorter duration). */
function flowDuration(rps: number, maxRps: number): number {
  if (maxRps <= 0) return FLOW_SPEED_MAX;
  const t = Math.min(rps / maxRps, 1);
  return FLOW_SPEED_MAX - t * (FLOW_SPEED_MAX - FLOW_SPEED_MIN);
}

/** Map RPS to particle count — more traffic = more particles. */
function particleCount(rps: number, maxRps: number): number {
  if (maxRps <= 0) return PARTICLE_COUNT_MIN;
  const t = Math.min(rps / maxRps, 1);
  return Math.round(
    PARTICLE_COUNT_MIN + t * (PARTICLE_COUNT_MAX - PARTICLE_COUNT_MIN)
  );
}

/** Determine if a node is in warning state (>70% capacity but not overloaded). */
function isWarning(node: InfraLayoutNode): boolean {
  if (node.overloaded || node.isEdge) return false;
  // Serverless: concurrency-based capacity
  const concurrencyProp = node.properties.find((p) => p.key === 'concurrency');
  if (concurrencyProp) {
    const concurrency = Number(concurrencyProp.value);
    const durationProp = node.properties.find((p) => p.key === 'duration-ms');
    const durationMs = durationProp ? Number(durationProp.value) : 100;
    const cap = concurrency / (durationMs / 1000);
    return cap > 0 && node.computedRps / cap > 0.7;
  }
  // Traditional: max-rps * instances
  const maxRps = node.properties.find((p) => p.key === 'max-rps');
  if (!maxRps) return false;
  const cap = Number(maxRps.value) * node.computedInstances;
  return cap > 0 && node.computedRps / cap > 0.7;
}

// ============================================================
// Helpers
// ============================================================

/** Display names for behavior property keys. Aligned with DSL property names. */
const PROP_DISPLAY: Record<string, string> = {
  'cache-hit': 'cache hit',
  'firewall-block': 'firewall block',
  'ratelimit-rps': 'rate limit RPS',
  'latency-ms': 'latency',
  uptime: 'uptime',
  instances: 'instances',
  'max-rps': 'max RPS',
  'cb-error-threshold': 'CB error threshold',
  'cb-latency-threshold-ms': 'CB latency threshold',
  concurrency: 'concurrency',
  'duration-ms': 'duration',
  'cold-start-ms': 'cold start',
  buffer: 'buffer',
  'drain-rate': 'drain rate',
  'retention-hours': 'retention',
  partitions: 'partitions',
};

const DESC_MAX_CHARS = 120;

/** Truncate description text to DESC_MAX_CHARS. */
function truncateDesc(text: string): string {
  if (text.length <= DESC_MAX_CHARS) return text;
  return text.slice(0, DESC_MAX_CHARS - 1) + '…';
}

/** Keys whose values are RPS counts and should be formatted like RPS. */
const RPS_FORMAT_KEYS = new Set(['max-rps', 'ratelimit-rps']);

/** Keys whose values are milliseconds and should show the "ms" suffix. */
const MS_FORMAT_KEYS = new Set([
  'latency-ms',
  'cb-latency-threshold-ms',
  'duration-ms',
  'cold-start-ms',
]);

/** Keys whose values are percentages and should show the "%" suffix. */
const PCT_FORMAT_KEYS = new Set([
  'cache-hit',
  'firewall-block',
  'uptime',
  'cb-error-threshold',
]);

/** Compute SLO color for a p90 latency value against the configured threshold.
 *  Callers must guard slo.latencyP90 != null before calling. */
function sloLatencyColor(p90: number, slo: NodeSlo): string {
  const t = slo.latencyP90 ?? 0;
  if (t === 0) return COLOR_HEALTHY; // no meaningful threshold — treat as healthy
  const m = slo.warningMargin;
  return p90 > t
    ? COLOR_OVERLOADED
    : p90 > t * (1 - m)
      ? COLOR_WARNING
      : COLOR_HEALTHY;
}

/** Computed metric rows (latency percentiles, uptime, availability, CB state) shown after declared props. */
function getComputedRows(
  node: InfraLayoutNode,
  expanded: boolean,
  slo?: NodeSlo | null
): ComputedRow[] {
  const rows: ComputedRow[] = [];

  // Serverless instances: demand vs concurrency limit
  if (node.computedConcurrentInvocations > 0) {
    const concurrency = getNodeNumProp(node, 'concurrency', 0);
    const demand = node.computedConcurrentInvocations;
    const ratio = concurrency > 0 ? demand / concurrency : 0;
    const color =
      ratio > 1 ? COLOR_OVERLOADED : ratio > 0.7 ? COLOR_WARNING : undefined;
    const value =
      concurrency > 0
        ? `${formatCount(demand)} / ${formatCount(concurrency)}`
        : `${formatCount(demand)}`;
    rows.push({ key: 'instances', value, color, inverted: color != null });
  }

  const p = node.computedLatencyPercentiles;
  if (p.p50 > 0 || p.p90 > 0 || p.p99 > 0) {
    if (expanded) {
      rows.push({ key: 'p50', value: formatMsShort(p.p50) });
      if (slo?.latencyP90 != null) {
        const color = sloLatencyColor(p.p90, slo);
        const p90Value =
          color !== COLOR_HEALTHY
            ? `${formatMsShort(p.p90)} / ${formatMsShort(slo.latencyP90!)}`
            : formatMsShort(p.p90);
        rows.push({
          key: 'p90',
          value: p90Value,
          color,
          inverted: color !== COLOR_HEALTHY,
        });
      } else {
        rows.push({ key: 'p90', value: formatMsShort(p.p90) });
      }
      rows.push({ key: 'p99', value: formatMsShort(p.p99) });
    } else if (p.p90 > 0) {
      // Collapsed: show p90 (with SLO color if configured) instead of p99
      if (slo?.latencyP90 != null) {
        const color = sloLatencyColor(p.p90, slo);
        const p90Value =
          color !== COLOR_HEALTHY
            ? `${formatMsShort(p.p90)} / ${formatMsShort(slo.latencyP90!)}`
            : formatMsShort(p.p90);
        rows.push({
          key: 'p90',
          value: p90Value,
          color,
          inverted: color !== COLOR_HEALTHY,
        });
      } else {
        rows.push({ key: 'p90', value: formatMsShort(p.p90) });
      }
    }
  }
  // Computed (cumulative) uptime — only show when it differs from the declared node uptime.
  // On the edge node this is the system-wide uptime; on other nodes it's the path product.
  // Label as "eff. uptime" to distinguish from the declared "uptime" property row.
  if (node.computedUptime < 1) {
    const declaredUptime = node.properties.find((p) => p.key === 'uptime');
    const declaredVal = declaredUptime ? Number(declaredUptime.value) / 100 : 1;
    const differs = Math.abs(node.computedUptime - declaredVal) > 0.000001;
    if (differs || node.isEdge) {
      rows.push({
        key: 'eff. uptime',
        value: formatUptimeShort(node.computedUptime),
      });
    }
  }
  if (node.computedAvailability < 1) {
    let color: string | undefined;
    if (slo?.availThreshold != null) {
      const t = slo.availThreshold;
      const m = slo.warningMargin;
      if (node.computedAvailability < t) color = COLOR_OVERLOADED;
      else if (node.computedAvailability < Math.min(1, t + m))
        color = COLOR_WARNING;
      else color = COLOR_HEALTHY;
    } else {
      color =
        node.computedAvailability < 0.95
          ? COLOR_OVERLOADED
          : node.computedAvailability < 0.99
            ? COLOR_WARNING
            : undefined;
    }
    rows.push({
      key: 'availability',
      value: formatUptimeShort(node.computedAvailability),
      color,
      inverted: color != null && color !== COLOR_HEALTHY,
    });
  }
  // Circuit breaker state — show when a CB is configured and open
  if (node.computedCbState === 'open') {
    rows.push({
      key: 'CB',
      value: 'OPEN',
      color: COLOR_OVERLOADED,
      inverted: true,
    });
  }
  // Queue computed rows: lag and overflow
  if (node.queueMetrics) {
    const { fillRate, timeToOverflow } = node.queueMetrics;
    if (fillRate > 0) {
      rows.push({
        key: 'lag',
        value: `${formatCount(Math.round(fillRate))} msg/s`,
      });
    }
    if (fillRate > 0 && timeToOverflow < Infinity) {
      const overflowColor =
        timeToOverflow < 60 ? COLOR_OVERLOADED : COLOR_WARNING;
      rows.push({
        key: 'overflow',
        value: `~${Math.round(timeToOverflow)}s`,
        color: overflowColor,
        inverted: timeToOverflow < 60,
      });
    }
  }
  return rows;
}

function formatCount(n: number): string {
  if (n >= 1000000)
    return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

function formatMsShort(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatUptimeShort(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 99.99) return '99.99%';
  if (pct >= 99.9) return `${pct.toFixed(2)}%`;
  if (pct >= 99) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(1)}%`;
}

/** Properties shown as key-value rows inside the node card. */
function getDisplayProps(
  node: InfraLayoutNode,
  expanded: boolean,
  diagramOptions?: Record<string, string>
): { key: string; displayKey: string; value: string }[] {
  if (node.isEdge) return [];
  const rows: { key: string; displayKey: string; value: string }[] = [];
  for (const p of node.properties) {
    const displayKey = PROP_DISPLAY[p.key];
    if (!displayKey) continue;
    // Rate limit and max-rps are already shown in the RPS denominator —
    // only show the dedicated row when the node is expanded (selected).
    if (p.key === 'ratelimit-rps' && !expanded) continue;
    if (p.key === 'max-rps' && !expanded) continue;
    if (p.key === 'concurrency' && !expanded) continue;
    // Format values with appropriate units
    if (RPS_FORMAT_KEYS.has(p.key)) {
      const num =
        typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
      rows.push({
        key: p.key,
        displayKey,
        value: isNaN(num) ? String(p.value) : formatRpsShort(num),
      });
    } else if (MS_FORMAT_KEYS.has(p.key)) {
      const num =
        typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
      rows.push({
        key: p.key,
        displayKey,
        value: isNaN(num) ? String(p.value) : formatMsShort(num),
      });
    } else if (PCT_FORMAT_KEYS.has(p.key)) {
      const num =
        typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
      rows.push({
        key: p.key,
        displayKey,
        value: isNaN(num) ? String(p.value) : `${num}%`,
      });
    } else if (p.key === 'buffer') {
      const num =
        typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
      rows.push({
        key: p.key,
        displayKey,
        value: isNaN(num) ? String(p.value) : formatCount(num),
      });
    } else if (p.key === 'drain-rate') {
      const num =
        typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
      rows.push({
        key: p.key,
        displayKey,
        value: isNaN(num) ? String(p.value) : `${formatRpsShort(num)}/s`,
      });
    } else if (p.key === 'retention-hours') {
      const num =
        typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
      rows.push({
        key: p.key,
        displayKey,
        value: isNaN(num) ? String(p.value) : `${num}h`,
      });
    } else {
      rows.push({ key: p.key, displayKey, value: String(p.value) });
    }
  }
  // Inject diagram-level defaults for properties the node doesn't explicitly declare
  if (diagramOptions) {
    const hasLatency = node.properties.some((p) => p.key === 'latency-ms');
    const hasUptime = node.properties.some((p) => p.key === 'uptime');
    const isServerlessNode = node.properties.some(
      (p) => p.key === 'concurrency'
    );
    const defaultLatency =
      parseFloat(diagramOptions['default-latency-ms'] ?? '') || 0;
    const defaultUptime =
      parseFloat(diagramOptions['default-uptime'] ?? '') || 0;
    if (!hasLatency && !isServerlessNode && defaultLatency > 0) {
      rows.push({
        key: 'latency-ms',
        displayKey: 'latency',
        value: formatMsShort(defaultLatency),
      });
    }
    if (!hasUptime && defaultUptime > 0 && defaultUptime < 100) {
      rows.push({
        key: 'uptime',
        displayKey: 'uptime',
        value: `${defaultUptime}%`,
      });
    }
  }
  return rows;
}

/** RPS value without "rps" suffix — for key-value rows where the key already says "RPS". */
function formatRpsShort(rps: number): string {
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k`;
  return `${Math.round(rps)}`;
}

/** Compute the worst severity across all row-producing conditions for a node.
 *  Returns 'overloaded' (red), 'warning' (yellow), 'healthy' (green), or 'normal'. */
function worstNodeSeverity(
  node: InfraLayoutNode,
  slo?: NodeSlo | null
): 'overloaded' | 'warning' | 'healthy' | 'normal' {
  let worst: 'overloaded' | 'warning' | 'normal' = 'normal';
  const upgrade = (s: 'overloaded' | 'warning') => {
    if (s === 'overloaded') worst = 'overloaded';
    else if (worst !== 'overloaded') worst = 'warning';
  };

  // Collapsed group nodes: incorporate child health state
  if (node.childHealthState === 'overloaded') upgrade('overloaded');
  else if (node.childHealthState === 'warning') upgrade('warning');

  // RPS-based: overloaded, rate-limited, or >70% capacity
  if (node.overloaded) upgrade('overloaded');
  if (node.rateLimited) upgrade('warning');
  if (isWarning(node)) upgrade('warning');

  // Availability — SLO threshold if declared, otherwise hardcoded fallback
  if (slo?.availThreshold != null) {
    const t = slo.availThreshold;
    const m = slo.warningMargin;
    if (node.computedAvailability < t) upgrade('overloaded');
    else if (node.computedAvailability < Math.min(1, t + m)) upgrade('warning');
    // else: in green zone — handled after loop
  } else {
    if (node.computedAvailability < 0.95) upgrade('overloaded');
    else if (node.computedAvailability < 0.99) upgrade('warning');
  }

  // p90 Latency SLO
  if (slo?.latencyP90 != null) {
    const t = slo.latencyP90;
    const m = slo.warningMargin;
    const p90 = node.computedLatencyPercentiles.p90;
    if (p90 > t) upgrade('overloaded');
    else if (p90 > t * (1 - m)) upgrade('warning');
    // else: in green zone
  }

  // Circuit breaker open
  if (node.computedCbState === 'open') upgrade('overloaded');

  // Queue state: filling → warning, imminent overflow → overloaded
  if (node.queueMetrics && node.queueMetrics.fillRate > 0) {
    if (node.queueMetrics.timeToOverflow < 60) upgrade('overloaded');
    else upgrade('warning');
  }

  // Rate-limit row (pre-rate-limit RPS vs configured limit)
  if (!node.isEdge) {
    const nodeRateLimit = getNodeNumProp(node, 'ratelimit-rps', 0);
    if (nodeRateLimit > 0 && node.computedRps > 0) {
      let preRl = node.computedRps;
      const ch = getNodeNumProp(node, 'cache-hit', 0);
      if (ch > 0) preRl *= (100 - ch) / 100;
      const fw = getNodeNumProp(node, 'firewall-block', 0);
      if (fw > 0) preRl *= (100 - fw) / 100;
      if (preRl > nodeRateLimit) upgrade('overloaded');
      else if (preRl > nodeRateLimit * 0.8) upgrade('warning');
    }
  }

  // Healthy: SLO declared AND all checks are in the green zone
  if (worst === 'normal' && slo != null) {
    const availGreen =
      slo.availThreshold == null ||
      node.computedAvailability >=
        Math.min(1, slo.availThreshold + slo.warningMargin);
    const latencyGreen =
      slo.latencyP90 == null ||
      node.computedLatencyPercentiles.p90 <=
        slo.latencyP90 * (1 - slo.warningMargin);
    if (availGreen && latencyGreen) return 'healthy';
  }

  return worst;
}

function nodeColor(
  _node: InfraLayoutNode,
  palette: PaletteColors,
  isDark: boolean,
  severity: ReturnType<typeof worstNodeSeverity>,
  solid?: boolean
): {
  fill: string;
  stroke: string;
  textFill: string;
} {
  // Severity fills: canonical 25% tint via shapeFill() (TD-3).
  // Fills are visibly LOUDER than pre-spec 8-20% color; combined with
  // the 2x OVERLOAD_STROKE_WIDTH, severity reads cleanly without a badge.
  if (severity === 'overloaded') {
    const fill = shapeFill(palette, COLOR_OVERLOADED, isDark, { solid });
    return {
      fill,
      stroke: COLOR_OVERLOADED,
      textFill: contrastText(
        fill,
        palette.textOnFillLight,
        palette.textOnFillDark
      ),
    };
  }
  if (severity === 'warning') {
    const fill = shapeFill(palette, COLOR_WARNING, isDark, { solid });
    return {
      fill,
      stroke: COLOR_WARNING,
      textFill: contrastText(
        fill,
        palette.textOnFillLight,
        palette.textOnFillDark
      ),
    };
  }
  if (severity === 'healthy') {
    const fill = shapeFill(palette, COLOR_HEALTHY, isDark, { solid });
    return {
      fill,
      stroke: COLOR_HEALTHY,
      textFill: contrastText(
        fill,
        palette.textOnFillLight,
        palette.textOnFillDark
      ),
    };
  }
  // Normal-state node: subtle-neutral 5-10% text tint — intentionally
  // near-invisible so default nodes recede. Out of scope per TD-2 / F2;
  // migrating to shapeFill() would 5x its saturation.
  return {
    fill: isDark
      ? mix(palette.bg, palette.text, 90)
      : mix(palette.bg, palette.text, 95),
    stroke: isDark
      ? mix(palette.text, palette.bg, 60)
      : mix(palette.text, palette.bg, 40),
    textFill: palette.text,
  };
}

function edgeColor(_edge: InfraLayoutEdge, palette: PaletteColors): string {
  return palette.textMuted;
}

function edgeWidth(): number {
  return EDGE_STROKE_WIDTH;
}

// ============================================================
// Render functions
// ============================================================

function renderGroups(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  groups: InfraLayoutGroup[],
  palette: PaletteColors,
  _isDark: boolean
) {
  for (const group of groups) {
    const g = svg
      .append('g')
      .attr('class', 'infra-group')
      .attr('data-line-number', group.lineNumber)
      .attr('data-node-toggle', group.id)
      .style('cursor', 'pointer');

    // Filled background (matching org chart container style)
    const groupFill = mix(palette.surface, palette.bg, 40);
    const groupStroke = palette.textMuted;
    g.append('rect')
      .attr('x', group.x)
      .attr('y', group.y)
      .attr('width', group.width)
      .attr('height', group.height)
      .attr('rx', 6)
      .attr('fill', groupFill)
      .attr('stroke', groupStroke)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1);

    // Group label (centered at top)
    g.append('text')
      .attr('x', group.x + group.width / 2)
      .attr('y', group.y + 16)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', GROUP_LABEL_FONT_SIZE)
      .attr('font-weight', '600')
      .attr('fill', palette.text)
      .text(group.label);

    // Group instances badge (top-right, like node instance badges)
    const gi =
      typeof group.instances === 'number'
        ? group.instances
        : typeof group.instances === 'string'
          ? parseInt(String(group.instances), 10) || 0
          : 0;
    if (gi > 1) {
      g.append('text')
        .attr('x', group.x + group.width - 8)
        .attr('y', group.y + 16)
        .attr('text-anchor', 'end')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', META_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(`${gi}x`);
    }
  }
}

function renderEdgePaths(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  edges: InfraLayoutEdge[],
  nodes: InfraLayoutNode[],
  groups: InfraLayoutGroup[],
  palette: PaletteColors,
  _isDark: boolean,
  animate: boolean,
  direction: 'LR' | 'TB',
  speedMultiplier: number = 1
) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const maxRps = Math.max(...edges.map((e) => e.computedRps), 1);
  const { srcPts, tgtPts } = computePortPts(edges, nodeMap, direction);

  for (const edge of edges) {
    if (edge.points.length === 0) continue;

    const targetNode = nodeMap.get(edge.targetId);
    const sourceNode = nodeMap.get(edge.sourceId);
    const color = edgeColor(edge, palette);
    const strokeW = edgeWidth();

    if (!sourceNode || !targetNode) continue;
    const key = `${edge.sourceId}:${edge.targetId}`;
    const pts = edgeWaypoints(
      sourceNode,
      targetNode,
      groups,
      nodes,
      direction,
      30,
      srcPts.get(key),
      tgtPts.get(key)
    );
    const pathD = buildPathD(pts, direction);
    const edgeG = svg
      .append('g')
      .attr('class', 'infra-edge')
      .attr('data-line-number', edge.lineNumber);

    const edgePath = edgeG
      .append('path')
      .attr('d', pathD)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', strokeW);
    if (edge.async) {
      edgePath.attr('stroke-dasharray', '6 4');
    }

    if (animate && edge.computedRps > 0) {
      const baseDur = flowDuration(edge.computedRps, maxRps);
      const dur = speedMultiplier > 0 ? baseDur / speedMultiplier : baseDur;

      // Particles traveling along the path — always green (overloaded nodes
      // already have red styling + reject particles to show the problem)
      const count = particleCount(edge.computedRps, maxRps);
      const particleColor = palette.colors.green;

      for (let i = 0; i < count; i++) {
        const delay = (dur / count) * i;
        const circle = edgeG
          .append('circle')
          .attr('r', PARTICLE_R)
          .attr('fill', particleColor)
          .attr('opacity', 0.85);

        // Use SMIL <animateMotion> for path-following
        circle
          .append('animateMotion')
          .attr('dur', `${dur}s`)
          .attr('repeatCount', 'indefinite')
          .attr('begin', `${delay}s`)
          .attr('path', pathD);
      }
    }
  }
}

function renderEdgeLabels(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  edges: InfraLayoutEdge[],
  nodes: InfraLayoutNode[],
  groups: InfraLayoutGroup[],
  palette: PaletteColors,
  _isDark: boolean,
  animate: boolean,
  direction: 'LR' | 'TB'
) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const { srcPts, tgtPts } = computePortPts(edges, nodeMap, direction);
  for (const edge of edges) {
    if (edge.points.length === 0) continue;
    if (!edge.label) continue;

    const sourceNode = nodeMap.get(edge.sourceId);
    const targetNode = nodeMap.get(edge.targetId);
    if (!sourceNode || !targetNode) continue;

    const key = `${edge.sourceId}:${edge.targetId}`;
    const wps = edgeWaypoints(
      sourceNode,
      targetNode,
      groups,
      nodes,
      direction,
      30,
      srcPts.get(key),
      tgtPts.get(key)
    );
    // Label midpoint: middle waypoint of the routed path
    const midPt = wps[Math.floor(wps.length / 2)];
    const labelText = edge.label;

    const g = svg.append('g').attr('class', animate ? 'infra-edge-label' : '');

    // Background rect for readability
    const textWidth = labelText.length * 6.5 + 8;
    g.append('rect')
      .attr('x', midPt.x - textWidth / 2)
      .attr('y', midPt.y - 8)
      .attr('width', textWidth)
      .attr('height', 16)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.9);

    g.append('text')
      .attr('x', midPt.x)
      .attr('y', midPt.y + 4)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', EDGE_LABEL_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .text(labelText);

    // When animated, add a wider invisible hover zone so labels appear on hover
    if (animate) {
      const pathD = buildPathD(wps, direction);
      g.insert('path', ':first-child')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', 20);
    }
  }
}

/** Returns the resolved tag color for a node's active tag group, or null if not applicable. */
function resolveActiveTagStroke(
  node: InfraLayoutNode,
  activeGroup: string,
  tagGroups: InfraTagGroup[],
  palette: PaletteColors
): string | null {
  const tg = tagGroups.find(
    (t) => t.name.toLowerCase() === activeGroup.toLowerCase()
  );
  if (!tg) return null;
  const tagKey = (tg.alias ?? tg.name).toLowerCase();
  const tagVal = node.tags[tagKey];
  if (!tagVal) return null;
  const tv = tg.values.find(
    (v) => v.name.toLowerCase() === tagVal.toLowerCase()
  );
  if (!tv?.color) return null;
  return resolveColor(tv.color, palette);
}

function renderNodes(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  nodes: InfraLayoutNode[],
  palette: PaletteColors,
  isDark: boolean,
  animate: boolean,
  expandedNodeIds?: Set<string> | null,
  activeGroup?: string | null,
  diagramOptions?: Record<string, string>,
  collapsedNodes?: Set<string> | null,
  tagGroups?: InfraTagGroup[],
  fanoutSourceIds?: Set<string>,
  scaledGroupIds?: Set<string>
) {
  for (const node of nodes) {
    const slo =
      !node.isEdge && diagramOptions
        ? resolveNodeSlo(node, diagramOptions)
        : null;
    const severity = worstNodeSeverity(node, slo);
    // Infra INTENTIONALLY ignores `solid-fill` — the renderer relies on subtle
    // tint gradations to communicate severity tiers (normal / warning /
    // overloaded), instance counts, RPS load indicators, and the nested
    // header/body/metrics panel structure. Solid fills collapse all of those
    // signals into one saturated rectangle, making the diagram unreadable.
    const nodeColors = nodeColor(node, palette, isDark, severity, false);
    const textFill = nodeColors.textFill;
    let { fill, stroke } = nodeColors;

    // When a tag legend is active, override border color with tag color
    if (activeGroup && tagGroups && !node.isEdge) {
      const tagStroke = resolveActiveTagStroke(
        node,
        activeGroup,
        tagGroups,
        palette
      );
      if (tagStroke) {
        stroke = tagStroke;
        fill = mix(palette.bg, tagStroke, isDark ? 88 : 94);
      }
    }
    let cls = 'infra-node';
    if (animate && node.isEdge) {
      cls += ' infra-node-edge-throb';
    } else if (animate && !node.isEdge) {
      if (node.computedCbState === 'open') cls += ' infra-node-cb-open';
      else if (severity === 'overloaded') cls += ' infra-node-overload';
      else if (severity === 'warning') cls += ' infra-node-warning';
    }
    const g = svg
      .append('g')
      .attr('class', cls)
      .attr('data-line-number', node.lineNumber)
      .attr('data-infra-node', node.id)
      .attr('data-node-collapse', node.id)
      .style('cursor', 'pointer');

    // Collapsed group nodes: toggle attribute
    if (node.id.startsWith('[')) {
      g.attr('data-node-toggle', node.id);
    }

    // Expose tag values for legend hover dimming
    for (const [tagKey, tagVal] of Object.entries(node.tags)) {
      g.attr(`data-tag-${tagKey.toLowerCase()}`, tagVal.toLowerCase());
    }

    // Expose role names for role legend hover dimming
    if (!node.isEdge) {
      const roles = inferRoles(node.properties);
      for (const role of roles) {
        g.attr(
          `data-role-${role.name.toLowerCase().replace(/\s+/g, '-')}`,
          'true'
        );
      }
      if (fanoutSourceIds?.has(node.id)) {
        g.attr('data-role-fan-out', 'true');
      }
    }

    const x = node.x - node.width / 2;
    const y = node.y - node.height / 2;
    const isCollapsedGroup = node.id.startsWith('[');
    const strokeWidth =
      severity !== 'normal' ? OVERLOAD_STROKE_WIDTH : NODE_STROKE_WIDTH;

    // Node rect
    g.append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', NODE_BORDER_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', strokeWidth);

    // Node name — centered in header area
    const headerCenterY = y + NODE_HEADER_HEIGHT / 2 + NODE_FONT_SIZE * 0.35;
    g.append('text')
      .attr('x', node.x)
      .attr('y', headerCenterY)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', NODE_FONT_SIZE)
      .attr('font-weight', '600')
      .attr('fill', textFill)
      .text(node.label);

    // --- Key-value rows below header (skipped for collapsed nodes) ---
    const isNodeCollapsed = collapsedNodes?.has(node.id) ?? false;
    if (isNodeCollapsed) {
      // Collapsed: show a subtle chevron indicator at the bottom of the header
      const chevronY = y + node.height - 6;
      g.append('text')
        .attr('x', node.x)
        .attr('y', chevronY)
        .attr('text-anchor', 'middle')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 8)
        .attr('fill', textFill)
        .attr('opacity', 0.5)
        .text('▼');
    }
    if (!isNodeCollapsed) {
      const expanded = expandedNodeIds?.has(node.id) ?? false;

      // Description subtitle — shown below label only when node is selected
      const descLines =
        expanded && node.description && !node.isEdge ? node.description : [];
      const descH = descLines.length * META_LINE_HEIGHT;
      for (let di = 0; di < descLines.length; di++) {
        const rawLine = descLines[di];
        const processed = preprocessDescriptionLine(rawLine);
        const descTruncated = truncateDesc(processed);
        const isTruncated = descTruncated !== processed;
        const textEl = g
          .append('text')
          .attr('x', node.x)
          .attr(
            'y',
            y +
              NODE_HEADER_HEIGHT +
              di * META_LINE_HEIGHT +
              META_LINE_HEIGHT / 2 +
              META_FONT_SIZE * 0.35
          )
          .attr('text-anchor', 'middle')
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', META_FONT_SIZE)
          .attr('fill', textFill);
        renderInlineText(textEl, descTruncated, palette, META_FONT_SIZE);
        if (isTruncated) textEl.append('title').text(rawLine);
      }

      // Declared properties only shown when node is selected (expanded)
      const displayProps =
        !node.isEdge && expanded
          ? getDisplayProps(node, expanded, diagramOptions)
          : [];
      const computedRows = getComputedRows(node, expanded, slo);
      const hasContent =
        displayProps.length > 0 ||
        computedRows.length > 0 ||
        node.computedRps > 0;

      if (hasContent) {
        // Separator line between header and body
        const sepY = y + NODE_HEADER_HEIGHT + descH;
        g.append('line')
          .attr('x1', x)
          .attr('y1', sepY)
          .attr('x2', x + node.width)
          .attr('y2', sepY)
          .attr('stroke', stroke)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);

        // Build rows in two sections: computed (dynamic) on top, declared (config) below.
        // A second separator line divides them when both sections have content.
        const computedSection: NodeRow[] = [];
        const declaredSection: NodeRow[] = [];

        // Determine effective throughput limit for the RPS row denominator
        const nodeMaxRps = getNodeNumProp(node, 'max-rps', 0);
        const nodeRateLimit = getNodeNumProp(node, 'ratelimit-rps', 0);
        const nodeConcurrency = getNodeNumProp(node, 'concurrency', 0);
        const nodeDurationMs = getNodeNumProp(node, 'duration-ms', 100);
        const serverlessCap =
          nodeConcurrency > 0 ? nodeConcurrency / (nodeDurationMs / 1000) : 0;
        const effectiveCap =
          serverlessCap > 0
            ? serverlessCap
            : nodeMaxRps > 0 && nodeRateLimit > 0
              ? Math.min(nodeMaxRps * node.computedInstances, nodeRateLimit)
              : nodeMaxRps > 0
                ? nodeMaxRps * node.computedInstances
                : nodeRateLimit > 0
                  ? nodeRateLimit
                  : 0;

        // --- Computed section: RPS + computed metrics ---
        if (node.computedRps > 0) {
          // Check rate-limit proximity (pre-ratelimit RPS after cache/fw reductions)
          let rlSeverity: 'overloaded' | 'warning' | 'normal' = 'normal';
          if (nodeRateLimit > 0 && node.computedRps > 0 && !node.isEdge) {
            let preRl = node.computedRps;
            const ch = getNodeNumProp(node, 'cache-hit', 0);
            if (ch > 0) preRl *= (100 - ch) / 100;
            const fw = getNodeNumProp(node, 'firewall-block', 0);
            if (fw > 0) preRl *= (100 - fw) / 100;
            if (preRl > nodeRateLimit) rlSeverity = 'overloaded';
            else if (preRl > nodeRateLimit * 0.8) rlSeverity = 'warning';
          }
          const rpsSeverity: 'overloaded' | 'warning' | 'normal' =
            node.overloaded
              ? 'overloaded'
              : rlSeverity === 'overloaded'
                ? 'overloaded'
                : node.rateLimited
                  ? 'warning'
                  : isWarning(node)
                    ? 'warning'
                    : rlSeverity === 'warning'
                      ? 'warning'
                      : 'normal';
          const rpsColor =
            rpsSeverity === 'overloaded'
              ? COLOR_OVERLOADED
              : rpsSeverity === 'warning'
                ? COLOR_WARNING
                : textFill;
          const rpsInverted = rpsSeverity !== 'normal';
          const rpsText =
            effectiveCap > 0 && !node.isEdge
              ? `${formatRpsShort(node.computedRps)} / ${formatRpsShort(effectiveCap)}`
              : formatRpsShort(node.computedRps);
          computedSection.push({
            key: 'RPS',
            value: rpsText,
            valueFill: rpsColor,
            fontWeight: '500',
            inverted: rpsInverted,
            invertedBg: rpsInverted ? rpsColor : undefined,
          });
        }
        for (const cr of computedRows) {
          computedSection.push({
            key: cr.key,
            value: cr.value,
            valueFill: cr.color ?? textFill,
            fontWeight: 'normal',
            inverted: cr.inverted,
            invertedBg: cr.inverted ? cr.color : undefined,
          });
        }

        // --- Declared section: user-defined properties (only when node is selected) ---
        for (const prop of displayProps) {
          let propColor = textFill;
          let inverted = false;
          let invertedBg: string | undefined;
          if (
            prop.key === 'ratelimit-rps' &&
            nodeRateLimit > 0 &&
            node.computedRps > 0
          ) {
            let preRl = node.computedRps;
            const ch = getNodeNumProp(node, 'cache-hit', 0);
            if (ch > 0) preRl *= (100 - ch) / 100;
            const fw = getNodeNumProp(node, 'firewall-block', 0);
            if (fw > 0) preRl *= (100 - fw) / 100;
            if (preRl > nodeRateLimit) {
              propColor = COLOR_OVERLOADED;
              inverted = true;
              invertedBg = COLOR_OVERLOADED;
            } else if (preRl > nodeRateLimit * 0.8) {
              propColor = COLOR_WARNING;
              inverted = true;
              invertedBg = COLOR_WARNING;
            }
          }
          declaredSection.push({
            key: prop.displayKey,
            value: prop.value,
            valueFill: propColor,
            fontWeight: 'normal',
            inverted,
            invertedBg,
          });
        }

        const rows = [...computedSection, ...declaredSection];

        // Compute max key width so values align vertically
        const maxKeyLen = Math.max(...rows.map((r) => r.key.length));
        const valueX = x + 10 + (maxKeyLen + 2) * (META_FONT_SIZE * 0.6);

        let rowY = sepY + NODE_SEPARATOR_GAP + META_FONT_SIZE;
        const needsSectionSep =
          computedSection.length > 0 && declaredSection.length > 0;
        let rowIdx = 0;
        for (const row of rows) {
          // Draw separator line between computed and declared sections
          if (needsSectionSep && rowIdx === computedSection.length) {
            const sepLineY = rowY - META_FONT_SIZE + 1;
            g.append('line')
              .attr('x1', x)
              .attr('y1', sepLineY)
              .attr('x2', x + node.width)
              .attr('y2', sepLineY)
              .attr('stroke', stroke)
              .attr('stroke-opacity', 0.3)
              .attr('stroke-width', 1);
            rowY += NODE_SEPARATOR_GAP;
          }
          if (row.inverted && row.invertedBg) {
            // Inverted pill: colored background spanning full row width, white text, values still aligned
            const pillH = META_LINE_HEIGHT - 1;
            const pillPad = 4;
            const pillX = x + pillPad;
            const pillY = rowY - META_FONT_SIZE + 1;
            const pillW = node.width - pillPad * 2;
            g.append('rect')
              .attr('x', pillX)
              .attr('y', pillY)
              .attr('width', pillW)
              .attr('height', pillH)
              .attr('rx', 3)
              .attr('fill', row.invertedBg)
              .attr('opacity', 0.9);
            // Inverted text: use lightest available color for max contrast on colored pills
            const pillTextColor = isDark ? '#ffffff' : palette.text;
            // Key — same x as normal rows
            g.append('text')
              .attr('x', x + 10)
              .attr('y', rowY)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', META_FONT_SIZE)
              .attr('font-weight', '600')
              .attr('fill', pillTextColor)
              .text(`${row.key}: `);
            // Value — aligned with other rows
            g.append('text')
              .attr('x', valueX)
              .attr('y', rowY)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', META_FONT_SIZE)
              .attr('font-weight', '600')
              .attr('fill', pillTextColor)
              .text(row.value);
          } else {
            // Normal row: contrast key + colored value (textFill instead of
            // mutedColor — gray on saturated solid fills is illegible).
            g.append('text')
              .attr('x', x + 10)
              .attr('y', rowY)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', META_FONT_SIZE)
              .attr('fill', textFill)
              .text(`${row.key}: `);

            g.append('text')
              .attr('x', valueX)
              .attr('y', rowY)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', META_FONT_SIZE)
              .attr('font-weight', row.fontWeight)
              .attr('fill', row.valueFill)
              .text(row.value);
          }

          rowY += META_LINE_HEIGHT;
          rowIdx++;
        }
      }

      // Instance badge — clickable for interactive adjustment (not for edge or serverless nodes)
      // Serverless nodes show instances in a computed row instead (demand / concurrency).
      // Nodes inside a scaled group suppress their badge — the group header already shows Nx.
      const inScaledGroup =
        node.groupId != null && (scaledGroupIds?.has(node.groupId) ?? false);
      if (
        !node.isEdge &&
        node.computedConcurrentInvocations === 0 &&
        node.computedInstances > 1 &&
        !inScaledGroup
      ) {
        const badgeText = `${node.computedInstances}x`;
        g.append('text')
          .attr('x', x + node.width - 6)
          .attr('y', y + NODE_HEADER_HEIGHT / 2 + META_FONT_SIZE * 0.35)
          .attr('text-anchor', 'end')
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', META_FONT_SIZE)
          .attr('fill', textFill)
          .attr('data-instance-node', node.id)
          .style('cursor', 'pointer')
          .text(badgeText);
      }

      // Role badge dots — only shown when Capabilities legend is expanded
      const showDots = activeGroup?.toLowerCase() === 'capabilities';
      const roles = showDots && !node.isEdge ? inferRoles(node.properties) : [];
      if (roles.length > 0) {
        // Move dots up above the collapse bar for collapsed groups
        const dotY = isCollapsedGroup
          ? y + node.height - COLLAPSE_BAR_HEIGHT - NODE_PAD_BOTTOM / 2
          : y + node.height - NODE_PAD_BOTTOM / 2;
        const totalDotsWidth = roles.length * (ROLE_DOT_RADIUS * 2 + 2) - 2;
        const startX = node.x - totalDotsWidth / 2 + ROLE_DOT_RADIUS;
        for (let i = 0; i < roles.length; i++) {
          g.append('circle')
            .attr('cx', startX + i * (ROLE_DOT_RADIUS * 2 + 2))
            .attr('cy', dotY)
            .attr('r', ROLE_DOT_RADIUS)
            .attr('fill', roles[i].color);
        }
      }

      // Collapse bar at bottom of collapsed group nodes (accent stripe, clipped to card)
      if (isCollapsedGroup) {
        const clipId = `clip-${node.id.replace(/[[\]\s]/g, '')}`;
        g.append('clipPath')
          .attr('id', clipId)
          .append('rect')
          .attr('x', x)
          .attr('y', y)
          .attr('width', node.width)
          .attr('height', node.height)
          .attr('rx', NODE_BORDER_RADIUS);
        g.append('rect')
          .attr('x', x + COLLAPSE_BAR_INSET)
          .attr('y', y + node.height - COLLAPSE_BAR_HEIGHT)
          .attr('width', node.width - COLLAPSE_BAR_INSET * 2)
          .attr('height', COLLAPSE_BAR_HEIGHT)
          .attr('fill', stroke)
          .attr('clip-path', `url(#${clipId})`)
          .attr('class', 'infra-collapse-bar');
      }
    }
  }
}

// ============================================================
// Reject Particles — red fading drops for traffic-shedding nodes
// ============================================================

/** Get a numeric property from an InfraLayoutNode. */
function getNodeNumProp(
  node: InfraLayoutNode,
  key: string,
  fallback: number
): number {
  const prop = node.properties.find((p) => p.key === key);
  if (!prop) return fallback;
  if (typeof prop.value === 'number') return prop.value;
  const num = parseFloat(String(prop.value));
  return isNaN(num) ? fallback : num;
}

/**
 * Compute rejected RPS for a node — traffic that arrives but is dropped/blocked.
 * This includes: firewall-block, rate-limit excess, and overload excess.
 * Cache-hit is NOT a reject — the request is served from cache.
 */
function computeRejectedRps(node: InfraLayoutNode): number {
  if (node.isEdge || node.computedRps <= 0) return 0;
  let rejected = 0;
  const inbound = node.computedRps;

  // Firewall block: N% of inbound is rejected
  const fwBlock = getNodeNumProp(node, 'firewall-block', 0);
  if (fwBlock > 0) rejected += inbound * (fwBlock / 100);

  // Rate limit excess (applied after cache/fw reductions)
  const rateLimit = getNodeNumProp(node, 'ratelimit-rps', 0);
  if (rateLimit > 0) {
    let preRateLimitRps = inbound;
    const cacheHit = getNodeNumProp(node, 'cache-hit', 0);
    if (cacheHit > 0) preRateLimitRps *= (100 - cacheHit) / 100;
    if (fwBlock > 0) preRateLimitRps *= (100 - fwBlock) / 100;
    if (preRateLimitRps > rateLimit) {
      rejected += preRateLimitRps - rateLimit;
    }
  }

  // Overload excess
  if (node.overloaded || node.childHealthState === 'overloaded') {
    const maxRps = getNodeNumProp(node, 'max-rps', 0);
    if (maxRps > 0) {
      const capacity = maxRps * node.computedInstances;
      if (inbound > capacity) {
        rejected += inbound - capacity;
      }
    }
    // For collapsed groups: childHealthState signals child overload even when
    // the virtual node's aggregated capacity math doesn't trigger (due to
    // group instances being baked into both max-rps and computedInstances).
    // Ensure we always produce a reject signal.
    if (rejected === 0) {
      rejected = inbound * 0.1;
    }
  }

  return rejected;
}

function renderRejectParticles(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  nodes: InfraLayoutNode[],
  speedMultiplier: number = 1
) {
  // Compute max rejected RPS across all nodes for scaling
  const rejectMap: { node: InfraLayoutNode; rejected: number }[] = [];
  for (const node of nodes) {
    const rejected = computeRejectedRps(node);
    if (rejected > 0) rejectMap.push({ node, rejected });
  }
  if (rejectMap.length === 0) return;

  const maxRejected = Math.max(...rejectMap.map((r) => r.rejected));

  for (const { node, rejected } of rejectMap) {
    const t = Math.min(rejected / maxRejected, 1);
    const count = Math.round(
      REJECT_COUNT_MIN + t * (REJECT_COUNT_MAX - REJECT_COUNT_MIN)
    );
    const baseDur =
      REJECT_DURATION_MAX - t * (REJECT_DURATION_MAX - REJECT_DURATION_MIN);
    const dur = speedMultiplier > 0 ? baseDur / speedMultiplier : baseDur;

    const nodeBottom = node.y + node.height / 2;

    for (let i = 0; i < count; i++) {
      const delay = (dur / count) * i;
      // Spread particles horizontally around the node center
      const spread = node.width * 0.3;
      const startX =
        node.x + (count > 1 ? -spread / 2 + spread * (i / (count - 1)) : 0);
      const startY = nodeBottom;
      const endY = nodeBottom + REJECT_DROP_DISTANCE;

      const rejectColor =
        node.overloaded || node.childHealthState === 'overloaded'
          ? COLOR_OVERLOADED
          : COLOR_WARNING;
      const circle = svg
        .append('circle')
        .attr('r', REJECT_PARTICLE_R)
        .attr('fill', rejectColor)
        .attr('opacity', 0);

      // Drop straight down from node bottom
      circle
        .append('animate')
        .attr('attributeName', 'cy')
        .attr('from', startY)
        .attr('to', endY)
        .attr('dur', `${dur}s`)
        .attr('repeatCount', 'indefinite')
        .attr('begin', `${delay}s`);

      circle
        .append('animate')
        .attr('attributeName', 'cx')
        .attr('from', startX)
        .attr('to', startX)
        .attr('dur', `${dur}s`)
        .attr('repeatCount', 'indefinite')
        .attr('begin', `${delay}s`);

      // Fade: appear quickly, then fade out
      circle
        .append('animate')
        .attr('attributeName', 'opacity')
        .attr('values', '0;0.8;0.6;0')
        .attr('keyTimes', '0;0.1;0.5;1')
        .attr('dur', `${dur}s`)
        .attr('repeatCount', 'indefinite')
        .attr('begin', `${delay}s`);
    }
  }
}

// ============================================================
// Legend — pill/capsule groups (matching org chart style)
// ============================================================

interface InfraLegendEntry {
  value: string;
  color: string;
  /** For role: kebab-case role name. For tag: lowercase tag value. */
  key: string;
}

export interface InfraLegendGroup {
  name: string;
  type: 'role' | 'tag';
  /** For tag groups: the key used in data-tag-* attributes (alias or name). */
  tagKey?: string;
  entries: InfraLegendEntry[];
  width: number;
  minifiedWidth: number;
}

/** Build legend groups from roles + tags. */
export function computeInfraLegendGroups(
  nodes: InfraLayoutNode[],
  tagGroups: InfraTagGroup[],
  palette: PaletteColors,
  edges?: InfraLayoutEdge[]
): InfraLegendGroup[] {
  const groups: InfraLegendGroup[] = [];

  // Capabilities group (from inferred roles + fanout edges)
  const roles = collectDiagramRoles(
    nodes.filter((n) => !n.isEdge).map((n) => n.properties)
  );
  if (edges && collectFanoutSourceIds(edges).size > 0) {
    roles.push(FANOUT_ROLE);
  }
  if (roles.length > 0) {
    const entries = roles.map((r) => ({
      value: r.name,
      color: r.color,
      key: r.name.toLowerCase().replace(/\s+/g, '-'),
    }));
    const pillWidth =
      measureLegendText('Capabilities', LEGEND_PILL_FONT_SIZE) +
      LEGEND_PILL_PAD;
    let entriesWidth = 0;
    for (const e of entries) {
      entriesWidth +=
        LEGEND_DOT_R * 2 +
        LEGEND_ENTRY_DOT_GAP +
        measureLegendText(e.value, LEGEND_ENTRY_FONT_SIZE) +
        LEGEND_ENTRY_TRAIL;
    }
    groups.push({
      name: 'Capabilities',
      type: 'role',
      entries,
      width: LEGEND_CAPSULE_PAD * 2 + pillWidth + 4 + entriesWidth,
      minifiedWidth: pillWidth,
    });
  }

  // Tag groups
  for (const tg of tagGroups) {
    const entries: InfraLegendEntry[] = [];
    for (const tv of tg.values) {
      if (tv.color) {
        entries.push({
          value: tv.name,
          color: resolveColor(tv.color, palette) ?? tv.color,
          key: tv.name.toLowerCase(),
        });
      }
    }
    if (entries.length === 0) continue;
    const pillWidth =
      measureLegendText(tg.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
    let entriesWidth = 0;
    for (const e of entries) {
      entriesWidth +=
        LEGEND_DOT_R * 2 +
        LEGEND_ENTRY_DOT_GAP +
        measureLegendText(e.value, LEGEND_ENTRY_FONT_SIZE) +
        LEGEND_ENTRY_TRAIL;
    }
    groups.push({
      name: tg.name,
      type: 'tag',
      tagKey: (tg.alias ?? tg.name).toLowerCase(),
      entries,
      width: LEGEND_CAPSULE_PAD * 2 + pillWidth + 4 + entriesWidth,
      minifiedWidth: pillWidth,
    });
  }

  return groups;
}

function renderLegend(
  rootSvg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  legendGroups: InfraLegendGroup[],
  totalWidth: number,
  legendY: number,
  palette: PaletteColors,
  isDark: boolean,
  activeGroup: string | null,
  playback?: InfraPlaybackState,
  exportMode = false
) {
  if (legendGroups.length === 0 && !playback) return;

  const legendG = rootSvg
    .append('g')
    .attr('transform', `translate(0, ${legendY})`);

  if (activeGroup) {
    legendG.attr('data-legend-active', activeGroup.toLowerCase());
  }

  // Build all groups including Playback as a regular group for consistent rendering
  const allGroups = legendGroups.map((g) => ({
    name: g.name,
    entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
  }));
  // Add Playback as a group with empty entries (collapsed pill) or dummy entries (expanded)
  if (playback) {
    allGroups.push({ name: 'Playback', entries: [] });
  }

  const legendConfig: LegendConfig = {
    groups: allGroups,
    position: { placement: 'top-center', titleRelation: 'below-title' },
    mode: exportMode ? 'export' : 'preview',
    showEmptyGroups: true,
  };
  const legendState: LegendState = { activeGroup };
  renderLegendD3(
    legendG,
    legendConfig,
    legendState,
    palette,
    isDark,
    undefined,
    totalWidth
  );

  // Add infra-specific classes and data attributes for app interactivity
  legendG.selectAll('[data-legend-group]').classed('infra-legend-group', true);
  for (const group of legendGroups) {
    const groupKey = group.name.toLowerCase();
    for (const entry of group.entries) {
      const entryEl = legendG.select(
        `[data-legend-group="${groupKey}"] [data-legend-entry="${entry.value.toLowerCase()}"]`
      );
      if (!entryEl.empty()) {
        entryEl
          .attr('data-legend-entry', entry.key.toLowerCase())
          .attr('data-legend-color', entry.color)
          .attr('data-legend-type', group.type)
          .attr(
            'data-legend-tag-group',
            group.type === 'tag' ? (group.tagKey ?? '') : null
          );
      }
    }
  }

  // Mark the Playback pill with infra-playback-pill class for app interactivity
  const playbackEl = legendG.select('[data-legend-group="playback"]');
  if (!playbackEl.empty()) {
    playbackEl.classed('infra-playback-pill', true);
  }

  // Inject speed badges into the Playback pill when expanded
  // Speed badges are injected into the Playback pill below

  // Inject speed badges into the Playback pill when expanded
  if (playback && playback.expanded && !playbackEl.empty()) {
    const pillWidth =
      measureLegendText('Playback', LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;

    let entryX = pillWidth + 8;
    const entryY = LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1;

    const ppLabel = playback.paused ? '▶' : '⏸';
    playbackEl
      .append('text')
      .attr('x', entryX)
      .attr('y', entryY)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .attr('data-playback-action', 'toggle-pause')
      .style('cursor', 'pointer')
      .text(ppLabel);
    entryX += LEGEND_PILL_FONT_SIZE * 0.8 + 6;

    for (const s of playback.speedOptions) {
      const label = `${s}x`;
      const isSpeedActive = playback.speed === s;
      const slotW =
        measureLegendText(label, LEGEND_ENTRY_FONT_SIZE) +
        SPEED_BADGE_H_PAD * 2;
      const badgeH = LEGEND_ENTRY_FONT_SIZE + SPEED_BADGE_V_PAD * 2;
      const badgeY = (LEGEND_HEIGHT - badgeH) / 2;

      const speedG = playbackEl
        .append('g')
        .attr('data-playback-action', 'set-speed')
        .attr('data-playback-value', String(s))
        .style('cursor', 'pointer');

      speedG
        .append('rect')
        .attr('x', entryX)
        .attr('y', badgeY)
        .attr('width', slotW)
        .attr('height', badgeH)
        .attr('rx', badgeH / 2)
        .attr('fill', isSpeedActive ? palette.primary : 'transparent');

      speedG
        .append('text')
        .attr('x', entryX + slotW / 2)
        .attr('y', entryY)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
        .attr('font-weight', isSpeedActive ? '600' : '400')
        .attr('fill', isSpeedActive ? palette.bg : palette.textMuted)
        .attr('text-anchor', 'middle')
        .text(label);
      entryX += slotW + SPEED_BADGE_GAP;
    }
  }
}

// ============================================================
// Main render
// ============================================================

export interface InfraPlaybackState {
  expanded: boolean;
  paused: boolean;
  speed: number;
  speedOptions: readonly number[];
}

export function renderInfra(
  container: HTMLDivElement,
  layout: InfraLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  title: string | null,
  titleLineNumber: number | null,
  tagGroups?: InfraTagGroup[],
  activeGroup?: string | null,
  animate?: boolean,
  playback?: InfraPlaybackState | null,
  expandedNodeIds?: Set<string> | null,
  exportMode?: boolean,
  collapsedNodes?: Set<string> | null
) {
  // Clear previous render (preserve tooltips if any)
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  // Build legend groups
  const legendGroups = computeInfraLegendGroups(
    layout.nodes,
    tagGroups ?? [],
    palette,
    layout.edges
  );
  const hasLegend = legendGroups.length > 0 || !!playback;
  // In app mode (not export), legend is rendered as a separate fixed-size SVG
  const fixedLegend = !exportMode && hasLegend;
  const legendOffset = hasLegend && !fixedLegend ? LEGEND_HEIGHT : 0;

  const titleOffset = title ? TITLE_OFFSET : 0;
  const totalWidth = layout.width;
  const totalHeight = layout.height + titleOffset + legendOffset;

  const shouldAnimate = animate !== false;

  // In app mode with legend + title, render the title as a separate fixed-size SVG
  // so the legend can be inserted between title and diagram.
  const fixedTitleH = fixedLegend && title ? TITLE_OFFSET : 0;
  const diagramViewHeight = fixedLegend
    ? layout.height + (title && !fixedTitleH ? titleOffset : 0) + legendOffset
    : totalHeight;

  if (fixedTitleH) {
    const titleContainerW = container.clientWidth || totalWidth;
    const titleSvg = d3Selection
      .select(container)
      .append('svg')
      .attr('class', 'infra-title-fixed')
      .attr('width', '100%')
      .attr('height', fixedTitleH)
      .attr('viewBox', `0 0 ${titleContainerW} ${fixedTitleH}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('display', 'block');
    titleSvg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', titleContainerW / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .attr('data-line-number', titleLineNumber != null ? titleLineNumber : '')
      .text(title!);
  }

  const fixedOverheadH =
    (fixedLegend ? LEGEND_HEIGHT + LEGEND_FIXED_GAP : 0) + fixedTitleH;
  const rootSvg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', '100%')
    .attr(
      'height',
      fixedOverheadH > 0 ? `calc(100% - ${fixedOverheadH}px)` : '100%'
    )
    .attr('viewBox', `0 0 ${totalWidth} ${diagramViewHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Inject animation keyframes + edge label hover styles
  if (shouldAnimate) {
    rootSvg.append('style').text(`
      @keyframes infra-pulse-warning {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      @keyframes infra-pulse-overload {
        0%, 100% { stroke-width: ${OVERLOAD_STROKE_WIDTH}; }
        50% { stroke-width: ${OVERLOAD_STROKE_WIDTH + 2}; }
      }
      @keyframes infra-pulse-cb {
        0%, 49% { stroke-dasharray: none; }
        50%, 100% { stroke-dasharray: 6 4; }
      }
      .infra-node-warning > rect:first-of-type {
        animation: infra-pulse-warning ${NODE_PULSE_SPEED}s ease-in-out infinite;
      }
      .infra-node-overload > rect:first-of-type {
        animation: infra-pulse-overload ${NODE_PULSE_OVERLOAD}s ease-in-out infinite;
      }
      .infra-node-cb-open > rect:first-of-type {
        stroke-dasharray: 6 4;
        animation: infra-pulse-cb 1s step-end infinite;
      }
      @keyframes infra-edge-throb {
        0%, 100% { stroke-width: 1.5; }
        50% { stroke-width: 3; }
      }
      .infra-node-edge-throb > rect:first-of-type {
        animation: infra-edge-throb 2s ease-in-out infinite;
        cursor: pointer;
      }
      .infra-edge-label {
        opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: all;
      }
      .infra-edge-label:hover {
        opacity: 1;
      }
    `);
  }

  // Content group offset: skip title space (unless title was extracted to fixed SVG)
  const contentTitleOffset = fixedTitleH ? 0 : titleOffset;
  const svg = rootSvg
    .append('g')
    .attr('transform', `translate(0, ${contentTitleOffset + legendOffset})`);

  // Title (inside rootSvg when not using fixed title)
  if (title && !fixedTitleH) {
    rootSvg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', totalWidth / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .attr('data-line-number', titleLineNumber != null ? titleLineNumber : '')
      .text(title);
  }

  // Render layers: groups (back), edge paths, nodes, reject particles, edge labels (front)
  renderGroups(svg, layout.groups, palette, isDark);
  const speedMultiplier = playback?.speed ?? 1;
  renderEdgePaths(
    svg,
    layout.edges,
    layout.nodes,
    layout.groups,
    palette,
    isDark,
    shouldAnimate,
    layout.direction,
    speedMultiplier
  );
  const fanoutSourceIds = collectFanoutSourceIds(layout.edges);
  const scaledGroupIds = new Set<string>(
    layout.groups
      .filter((g) => {
        const gi =
          typeof g.instances === 'number'
            ? g.instances
            : typeof g.instances === 'string'
              ? parseInt(String(g.instances), 10) || 0
              : 0;
        return gi > 1;
      })
      .map((g) => g.id)
  );
  renderNodes(
    svg,
    layout.nodes,
    palette,
    isDark,
    shouldAnimate,
    expandedNodeIds,
    activeGroup,
    layout.options,
    collapsedNodes,
    tagGroups ?? [],
    fanoutSourceIds,
    scaledGroupIds
  );
  if (shouldAnimate) {
    renderRejectParticles(svg, layout.nodes, speedMultiplier);
  }
  renderEdgeLabels(
    svg,
    layout.edges,
    layout.nodes,
    layout.groups,
    palette,
    isDark,
    shouldAnimate,
    layout.direction
  );

  // Legend at top
  if (hasLegend) {
    if (fixedLegend) {
      // Render legend in a separate SVG that stays at fixed pixel size, inserted between title and diagram
      const containerWidth = container.clientWidth || totalWidth;
      const legendSvg = d3Selection
        .select(container)
        .insert('svg', 'svg:last-of-type')
        .attr('class', 'infra-legend-fixed')
        .attr('width', '100%')
        .attr('height', LEGEND_HEIGHT + LEGEND_FIXED_GAP)
        .attr(
          'viewBox',
          `0 0 ${containerWidth} ${LEGEND_HEIGHT + LEGEND_FIXED_GAP}`
        )
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('display', 'block')
        .style('pointer-events', 'none');
      renderLegend(
        legendSvg,
        legendGroups,
        containerWidth,
        LEGEND_FIXED_GAP / 2,
        palette,
        isDark,
        activeGroup ?? null,
        playback ?? undefined,
        exportMode
      );
      // Re-enable pointer events on interactive legend elements
      legendSvg
        .selectAll('.infra-legend-group')
        .style('pointer-events', 'auto');
    } else {
      // Export mode: render legend at top (below title)
      renderLegend(
        rootSvg,
        legendGroups,
        totalWidth,
        titleOffset,
        palette,
        isDark,
        activeGroup ?? null,
        playback ?? undefined,
        exportMode
      );
    }
  }
}

// ============================================================
// Export pipeline (for CLI / d3.ts integration)
// ============================================================

export function parseAndLayoutInfra(content: string) {
  const parsed = parseInfra(content);
  if (parsed.error) return { parsed, computed: null, layout: null };
  const computed = computeInfra(parsed);
  const layout = layoutInfra(computed);
  return { parsed, computed, layout };
}
