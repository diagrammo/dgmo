// Clip an edge polyline back to its endpoint nodes' boundary rectangles.
//
// dagre does this itself (`intersectRect`), so edges from the dagre candidate
// have always arrived pre-clipped. The hand-rolled candidate generators —
// layout-grouped's tier router and layout-layered — emit node CENTRES as the
// first and last point instead, and nothing downstream restores the boundary:
// deroutePierces, applyParallelEdgeOffsets and placeEdgeLabels all preserve the
// end points, and the renderer draws them verbatim.
//
// The visible cost is the arrowhead, not the line. Edges paint before nodes, so
// a `marker-end` sitting at the target's centre is covered by that node's own
// opaque rect — every arrow in the diagram disappears at once, and the reader
// loses the direction of every flow. Reported from outside on an OAuth diagram
// where all 13 arrowheads were swallowed (#625).

export type ClipPt = { x: number; y: number };
export type ClipRect = { x: number; y: number; w: number; h: number };

/**
 * Where the ray from the rect's centre toward `toward` exits the rect.
 * `rect` is centre-based. A `toward` equal to the centre has no direction to
 * follow, so the centre is returned unchanged.
 */
export function rectBorderPoint(rect: ClipRect, toward: ClipPt): ClipPt {
  const dx = toward.x - rect.x;
  const dy = toward.y - rect.y;
  const sx = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  if (!Number.isFinite(s)) return { x: rect.x, y: rect.y };
  return { x: rect.x + dx * s, y: rect.y + dy * s };
}

/**
 * Strictly inside, by more than half a pixel on both axes.
 *
 * 🔴 The tolerance is what makes this safe to run over EVERY candidate,
 * dagre's included. A correctly clipped endpoint sits exactly ON the boundary,
 * where an inclusive test would call it "inside" and re-project it onto a
 * different border point — moving geometry that was already right, and moving
 * every gallery baseline with it. A buried endpoint sits at the node's centre,
 * half a box away, so no plausible rounding brings the two cases together.
 */
export function isInsideRect(p: ClipPt, rect: ClipRect): boolean {
  const EPS = 0.5;
  return (
    Math.abs(p.x - rect.x) < rect.w / 2 - EPS &&
    Math.abs(p.y - rect.y) < rect.h / 2 - EPS
  );
}

/**
 * Trim both ends of `pts` back to the boundaries of the endpoint node rects,
 * dropping any interior points that fall inside the rect being trimmed to.
 *
 * 🔴 The two rects are NOT positional — each end is matched to whichever rect
 * actually contains it. The generators' back-edge router builds its polyline
 * from the lower-rank endpoint outward, so for an up-tier edge the array runs
 * target→source and a positional read clips both ends against the wrong node.
 * That left exactly one arrowhead buried on the reported diagram after the
 * first pass at this fix (#625).
 *
 * An end inside neither rect is already clear of both nodes and is left alone —
 * never projected, which would move a correctly routed endpoint. Either rect
 * may be undefined. Fewer than two points has no segment to intersect.
 */
export function clipEndpointsToNodes(
  pts: readonly ClipPt[],
  rectA: ClipRect | undefined,
  rectB: ClipRect | undefined
): ClipPt[] {
  if (pts.length < 2) return pts as ClipPt[];
  const rects = [rectA, rectB].filter((r): r is ClipRect => r !== undefined);
  if (rects.length === 0) return pts as ClipPt[];
  const enclosing = (p: ClipPt): ClipRect | undefined =>
    rects.find((r) => isInsideRect(p, r));

  let out: ClipPt[] = pts as ClipPt[];
  const head = enclosing(out[0]!);
  if (head) {
    let k = 0;
    while (k < out.length - 1 && isInsideRect(out[k]!, head)) k++;
    out = [rectBorderPoint(head, out[k]!), ...out.slice(k)];
  }
  const tail = enclosing(out[out.length - 1]!);
  if (tail) {
    let k = out.length - 1;
    while (k > 0 && isInsideRect(out[k]!, tail)) k--;
    out = [...out.slice(0, k + 1), rectBorderPoint(tail, out[k]!)];
  }
  return out;
}
