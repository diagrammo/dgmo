// Geometry helpers for the resolver: topology indexing + antimeridian-correct
// feature bounds (via d3-geo geoBounds — NOT naive min/max, which breaks on the
// antimeridian and on multi-part features like US Alaska/Hawaii; R5/R6).
import { feature } from 'topojson-client';
import { geoBounds } from 'd3-geo';
import type { BoundaryTopology } from './data/types';
import type { GeoExtent } from './resolved-types';

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** The single geometry object of a step-1 topology (`countries` | `states`). */
function geomObject(topo: BoundaryTopology): {
  geometries: Array<{ id: string; properties: { name: string } }>;
} {
  const key = Object.keys(topo.objects)[0]!;
  return topo.objects[key]! as never;
}

/** folded display-name → { id, name } for one layer (per-layer; never merged — R12). */
export function featureIndex(
  topo: BoundaryTopology
): Map<string, { id: string; name: string }> {
  const idx = new Map<string, { id: string; name: string }>();
  for (const g of geomObject(topo).geometries) {
    const f = fold(g.properties.name);
    if (!idx.has(f)) idx.set(f, { id: g.id, name: g.properties.name }); // keep first on dup
  }
  return idx;
}

/** Set of geometry ids (ISO codes) present in a topology. */
export function idSet(topo: BoundaryTopology): Set<string> {
  return new Set(geomObject(topo).geometries.map((g) => g.id));
}

/** Antimeridian-correct geographic bbox of one feature (by id), or null. */
export function featureBbox(
  topo: BoundaryTopology,
  geomId: string
): GeoExtent | null {
  const geom = geomObject(topo).geometries.find((g) => g.id === geomId);
  if (!geom) return null;
  // feature() needs the geometry OBJECT, not a string (a string would be read as
  // topology.objects[string] — R6).
  const gj = feature(topo as never, geom as never);
  const b = geoBounds(gj as never); // [[west, south], [east, north]], antimeridian-aware
  if (!b || !Number.isFinite(b[0][0])) return null;
  return [
    [b[0][0], b[0][1]],
    [b[1][0], b[1][1]],
  ];
}

/** Union of bboxes + POI points into one extent; null if empty. Longitude union
 *  uses the smaller-arc rule so an antimeridian-crossing union doesn't span the
 *  globe. */
export function unionExtent(
  boxes: GeoExtent[],
  points: Array<[number, number]>
): GeoExtent | null {
  const lats: number[] = [];
  const lons: number[] = [];
  for (const b of boxes) {
    lats.push(b[0][1], b[1][1]);
    lons.push(b[0][0], b[1][0]);
  }
  for (const [lon, lat] of points) {
    lons.push(lon);
    lats.push(lat);
  }
  if (!lats.length) return null;
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const { west, east } = unionLongitudes(lons);
  return [
    [west, south],
    [east, north],
  ];
}

/** Tightest enclosing longitude arc, antimeridian-aware: the content occupies
 *  everything EXCEPT the largest empty gap between sample longitudes. If that
 *  largest gap straddles the ±180 seam, the content is contiguous (no wrap);
 *  otherwise the extent wraps and `east` is returned > 180 (east = w + 360). */
function unionLongitudes(lons: number[]): { west: number; east: number } {
  const pts = [...new Set(lons)].sort((a, b) => a - b);
  if (pts.length === 1) return { west: pts[0]!, east: pts[0]! };
  // Largest interior gap.
  let maxGap = -1;
  let gapIdx = -1;
  for (let i = 1; i < pts.length; i++) {
    const g = pts[i]! - pts[i - 1]!;
    if (g > maxGap) {
      maxGap = g;
      gapIdx = i;
    }
  }
  // Gap that crosses the seam (from the easternmost point around to westernmost).
  const wrapGap = pts[0]! + 360 - pts[pts.length - 1]!;
  if (wrapGap >= maxGap) {
    // Empty region is at the seam → data is contiguous in [−180,180].
    return { west: pts[0]!, east: pts[pts.length - 1]! };
  }
  // Empty region is interior → content wraps across the seam.
  return { west: pts[gapIdx]!, east: pts[gapIdx - 1]! + 360 };
}

export { fold };
