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
