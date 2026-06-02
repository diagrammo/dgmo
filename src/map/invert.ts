// Composite- + stretch-aware pixel↔lonLat for the geo-query (step-5 inspector).
// This is the FIRST map code to call `projection.invert()`. It binds to the
// REAL fitted projection(s) captured on the MapLayout (layout.ts Task 1) — the
// caller never reconstructs a projection from metadata, so an inverted pixel
// lands exactly where the rendered SVG drew the corresponding point.
//
// Three cases, in priority order:
//   1. albers-usa insets — a pixel inside an AK/HI frame rect inverts against
//      that inset's FITTED projection (the un-fitted factory would be garbage).
//   2. global stretch fit — undo the non-uniform stretch BEFORE the main invert
//      (and apply it AFTER the main project).
//   3. plain regional/world fit — invert/project the main projection directly
//      (clipExtent set on a regional projection is ignored by `.invert`).
import type { MapLayout, MapLayoutInset } from './layout';

/** True if `(px,py)` is inside an inset frame's bounding box. */
function inInsetFrame(inset: MapLayoutInset, px: number, py: number): boolean {
  return (
    px >= inset.x &&
    px <= inset.x + inset.w &&
    py >= inset.y &&
    py <= inset.y + inset.h
  );
}

/** Undo the global stretch: screen px → base-projection px. */
function unstretch(
  layout: MapLayout,
  px: number,
  py: number
): [number, number] {
  const s = layout.stretch!;
  return [
    s.bx0 + (s.sx !== 0 ? (px - s.ox) / s.sx : 0),
    s.by0 + (s.sy !== 0 ? (py - s.oy) / s.sy : 0),
  ];
}

/** Apply the global stretch: base-projection px → screen px. */
function applyStretch(
  layout: MapLayout,
  x: number,
  y: number
): [number, number] {
  const s = layout.stretch!;
  return [s.ox + (x - s.bx0) * s.sx, s.oy + (y - s.by0) * s.sy];
}

/** Screen pixel → `[lon, lat]`, or null for an out-of-domain pixel (e.g. deep
 *  ocean beyond the projection's clip disc). */
export function pixelToLonLat(
  layout: MapLayout,
  px: number,
  py: number
): [number, number] | null {
  // (1) Inset hit-test first — AK/HI frames sit over the lower-left water of the
  // conus, so their pixels would otherwise invert against the conus conic.
  for (const inset of layout.insets) {
    if (inInsetFrame(inset, px, py)) {
      const ll = inset.projection.invert?.([px, py]);
      return ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1])
        ? [ll[0], ll[1]]
        : null;
    }
  }
  // (2)/(3) main projection (undo the stretch first for a global fit).
  const [x, y] = layout.stretch ? unstretch(layout, px, py) : [px, py];
  const ll = layout.projection.invert?.([x, y]);
  return ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1])
    ? [ll[0], ll[1]]
    : null;
}

/** `[lon, lat]` → screen pixel, or null if it projects nowhere. AK/HI points
 *  land in their inset frames; everything else projects via the main projection
 *  (with the forward stretch for a global fit). */
export function lonLatToPixel(
  layout: MapLayout,
  lonLat: readonly [number, number]
): [number, number] | null {
  const pt: [number, number] = [lonLat[0], lonLat[1]];
  // Main projection first.
  const main = layout.projection(pt);
  const mainPx: [number, number] | null =
    main && Number.isFinite(main[0]) && Number.isFinite(main[1])
      ? layout.stretch
        ? applyStretch(layout, main[0], main[1])
        : [main[0], main[1]]
      : null;
  // If the main pixel is on-canvas, it's the lower-48/world position — use it.
  const onCanvas =
    !!mainPx &&
    mainPx[0] >= 0 &&
    mainPx[0] <= layout.width &&
    mainPx[1] >= 0 &&
    mainPx[1] <= layout.height;
  if (onCanvas) return mainPx;
  // Off-canvas under the main projection (AK/HI under the conus conic): see if an
  // inset claims it — project via the inset and keep it if it lands in the frame.
  for (const inset of layout.insets) {
    const p = inset.projection(pt);
    if (
      p &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]) &&
      inInsetFrame(inset, p[0], p[1])
    )
      return [p[0], p[1]];
  }
  return mainPx;
}
