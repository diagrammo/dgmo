// A map's fitted d3-geo projection, as plain data.
//
// `layoutMap` fits a live d3-geo projection (a function carrying closures), and
// a function cannot cross `structuredClone` / `postMessage` — so the layout
// returns the projection's PARAMETERS instead, and anything that needs the live
// projection (the geo-query's pixel↔lonLat) rebuilds it here (#645).
//
// Exactness: a d3 projection's transform is a pure function of its final
// parameter values, whatever order they were set in. So the spec records the
// construction INPUTS (family, parallels, center, rotate — never read back
// through their getters, which round-trip through radians and can drift by an
// ULP), and `scale` / `translate` / `clipExtent` are read off the fitted
// projection, whose getters return the stored numbers unchanged. The rebuilt
// projection then maps every point to the same pixel, bit for bit.
import {
  geoConicEqualArea,
  geoEqualEarth,
  geoEquirectangular,
  geoMercator,
  geoNaturalEarth1,
} from 'd3-geo';
import type { GeoProjection } from 'd3-geo';

/** The d3-geo projection factories a map layout can use. */
export type MapProjectionKind =
  | 'conic-equal-area'
  | 'mercator'
  | 'equal-earth'
  | 'equirectangular'
  | 'natural-earth';

/** How a projection was constructed, before it is fitted to a canvas. */
export interface MapProjectionSpec {
  readonly kind: MapProjectionKind;
  readonly parallels?: readonly [number, number];
  readonly center?: readonly [number, number];
  readonly rotate?: readonly [number, number];
}

/** A fitted projection as structured-cloneable data: its spec plus the
 *  canvas-dependent fit. `rebuildMapProjection` turns it back into a live
 *  projection that projects identically. */
export interface MapProjectionParams extends MapProjectionSpec {
  readonly scale: number;
  readonly translate: readonly [number, number];
  readonly clipExtent:
    | readonly [readonly [number, number], readonly [number, number]]
    | null;
}

/** Construct the un-fitted projection a spec describes. */
export function createMapProjection(spec: MapProjectionSpec): GeoProjection {
  let p: GeoProjection;
  switch (spec.kind) {
    case 'conic-equal-area':
      p = geoConicEqualArea();
      break;
    case 'mercator':
      p = geoMercator();
      break;
    case 'equal-earth':
      p = geoEqualEarth();
      break;
    case 'natural-earth':
      p = geoNaturalEarth1();
      break;
    case 'equirectangular':
    default:
      p = geoEquirectangular();
      break;
  }
  // Only conic projections have parallels; the spec only carries them for one.
  if (spec.parallels) {
    (p as unknown as { parallels(v: [number, number]): unknown }).parallels([
      spec.parallels[0],
      spec.parallels[1],
    ]);
  }
  if (spec.center) p.center([spec.center[0], spec.center[1]]);
  if (spec.rotate) p.rotate([spec.rotate[0], spec.rotate[1]]);
  return p;
}

/** Read a fitted projection built from `spec` into cloneable parameters. */
export function captureMapProjection(
  spec: MapProjectionSpec,
  projection: GeoProjection
): MapProjectionParams {
  const [tx, ty] = projection.translate();
  const clip = projection.clipExtent();
  return {
    ...spec,
    scale: projection.scale(),
    translate: [tx, ty],
    clipExtent: clip
      ? [
          [clip[0][0], clip[0][1]],
          [clip[1][0], clip[1][1]],
        ]
      : null,
  };
}

/** Rebuild the live projection a layout was fitted with. */
export function rebuildMapProjection(
  params: MapProjectionParams
): GeoProjection {
  const p = createMapProjection(params)
    .scale(params.scale)
    .translate([params.translate[0], params.translate[1]]);
  if (params.clipExtent) {
    const [[x0, y0], [x1, y1]] = params.clipExtent;
    p.clipExtent([
      [x0, y0],
      [x1, y1],
    ]);
  }
  return p;
}
