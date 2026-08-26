// ============================================================
// Edge spline — basis curve clamped to its endpoints
// ============================================================

import * as d3Shape from 'd3-shape';

const lineGenerator = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

/**
 * Build a smooth edge path through dagre waypoints.
 *
 * `d3.curveBasis` already begins with `moveTo(P0)` and ends with
 * `lineTo(Pn)`, so the path reaches both node borders and its final
 * segment carries a real direction (correct `marker-end` orientation).
 *
 * NOTE: do NOT clamp by triplicating the endpoints — that appends
 * zero-length trailing segments, and WebKit then computes a degenerate
 * tangent for the arrowhead, rendering it at the wrong angle (resvg and
 * Chromium tolerate it; WKWebView does not).
 */
export function edgeSplinePath(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>
): string | null {
  return lineGenerator(points as { x: number; y: number }[]);
}

/**
 * Build a self-loop as a single cubic.
 *
 * dagre does not route a self-edge as an arc — it emits a flat-bottomed
 * trapezoid whose shoulder waypoints sit OUTSIDE the entry and exit
 * points, so the path doubles back on itself. Running `curveBasis` over
 * those waypoints rounds the corners without removing them, and the loop
 * reads as pinched at the shoulders and flat along the bottom (#501).
 *
 * dagre's PLACEMENT is what we want and keep: which side of the node the
 * loop hangs off (perpendicular to the rank direction), and how far out —
 * `layoutGraph` folds that extent into the canvas bounds. Only the
 * waypoints are replaced. Both control points are pushed along the outward
 * normal by the amount that lands the curve's midpoint on dagre's apex, so
 * the arc reaches exactly as far as the reserved space and no further.
 *
 * 🔴 The apex is the waypoint farthest from the CHORD `p0 → p3`, never the
 * one farthest from the node center — the trapezoid's two corners beat the
 * true apex on centre distance, and picking one throws the loop sideways.
 *
 * Returns null when the shape cannot be derived (too few waypoints, or a
 * degenerate apex); the caller falls back to the plain spline.
 */
export function selfLoopArcPath(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>
): string | null {
  if (points.length < 3) return null;
  const p0 = points[0]!;
  const p3 = points[points.length - 1]!;

  const chordX = p3.x - p0.x;
  const chordY = p3.y - p0.y;
  const chordLen = Math.hypot(chordX, chordY);
  if (chordLen === 0) return null;

  let apex = points[Math.floor(points.length / 2)]!;
  let farthest = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const pt = points[i]!;
    const away =
      Math.abs((pt.x - p0.x) * chordY - (pt.y - p0.y) * chordX) / chordLen;
    if (away > farthest) {
      farthest = away;
      apex = pt;
    }
  }

  // Outward normal: from the chord's midpoint toward the apex.
  let ux = apex.x - (p0.x + p3.x) / 2;
  let uy = apex.y - (p0.y + p3.y) / 2;
  const uLen = Math.hypot(ux, uy);
  if (uLen === 0) return null;
  ux /= uLen;
  uy /= uLen;

  // A cubic's midpoint is (P0 + 3C1 + 3C2 + P3) / 8. Anchor the control
  // points on dagre's own shoulders so the loop keeps its width, then slide
  // both along the normal by the t that puts that midpoint on the apex.
  const a1 = points[1]!;
  const a2 = points[points.length - 2]!;
  const needX = (8 * apex.x - p0.x - p3.x) / 3;
  const needY = (8 * apex.y - p0.y - p3.y) / 3;
  const t =
    Math.abs(ux) >= Math.abs(uy)
      ? (needX - (a1.x + a2.x)) / (2 * ux)
      : (needY - (a1.y + a2.y)) / (2 * uy);
  if (!Number.isFinite(t)) return null;

  const c1x = a1.x + ux * t;
  const c1y = a1.y + uy * t;
  const c2x = a2.x + ux * t;
  const c2y = a2.y + uy * t;
  return `M${p0.x},${p0.y}C${c1x},${c1y},${c2x},${c2y},${p3.x},${p3.y}`;
}
