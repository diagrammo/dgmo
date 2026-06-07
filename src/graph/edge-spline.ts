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
 * Build a smooth edge path that PASSES THROUGH its first and last points.
 *
 * `d3.curveBasis` is an *approximating* cubic B-spline: it starts at
 * `(P0 + 4·P1 + P2)/6`, not at `P0`. For a gently curved edge that barely
 * shows, but a sharply-turning edge (e.g. a back-edge / loop) visibly
 * detaches from the node border. Triplicating the endpoints clamps the
 * spline so it begins exactly at `P0` and ends exactly at `Pn`, keeping the
 * smooth interior while reconnecting the arrow to its shapes.
 */
export function edgeSplinePath(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>
): string | null {
  const pts = points as ReadonlyArray<{ x: number; y: number }>;
  if (pts.length < 2) return lineGenerator(pts as { x: number; y: number }[]);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return lineGenerator([first, first, ...pts, last, last]);
}
