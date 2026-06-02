// Geometry helpers for the resolver: topology indexing + antimeridian-correct
// feature bounds (via d3-geo geoBounds — NOT naive min/max, which breaks on the
// antimeridian and on multi-part features like US Alaska/Hawaii; R5/R6).
import { feature } from 'topojson-client';
import { geoBounds, geoArea } from 'd3-geo';
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

/** folded display-name → { id, name } for one layer (per-layer; never merged — R12).
 *  Also keyed by the lowercased ISO id (`us`, `cd`, `us-or`) so a region can be
 *  matched by code — the §24B.8 ISO-alias promise — which rescues abbreviated
 *  Natural-Earth names like "Dem. Rep. Congo" / "W. Sahara" (#6). Display-name
 *  keys are inserted first and win; id keys only fill gaps (no name collides with
 *  another feature's 2-letter code in the shipped data). */
export function featureIndex(
  topo: BoundaryTopology
): Map<string, { id: string; name: string }> {
  const idx = new Map<string, { id: string; name: string }>();
  for (const g of geomObject(topo).geometries) {
    const f = fold(g.properties.name);
    if (!idx.has(f)) idx.set(f, { id: g.id, name: g.properties.name }); // keep first on dup
  }
  for (const g of geomObject(topo).geometries) {
    const idKey = g.id.toLowerCase();
    if (!idx.has(idKey)) idx.set(idKey, { id: g.id, name: g.properties.name });
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

// Framing-extent thresholds for `featureBboxPrimary` (R5). A detached polygon is
// kept in the framing bbox only if it is either near the dominant cluster
// (within GAP degrees in both axes) or large enough to matter (≥ AREA_FRAC of
// the largest polygon). This drops far-flung minor territories — French Guiana,
// Hawaii, the Canaries are already absent from coarse Spain — so a "Europe"
// choropleth that names France frames on metropolitan France, not the Atlantic,
// while keeping near islands and large detached parts (Alaska) in frame.
const DETACH_GAP_DEG = 10;
const DETACH_AREA_FRAC = 0.25;

/** Decompose a Polygon/MultiPolygon GeoJSON geometry into per-polygon features. */
function explodePolygons(gj: {
  type: string;
  geometry?: { type: string; coordinates: unknown };
}): Array<{
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: unknown };
}> {
  const g = gj.geometry ?? (gj as never);
  const t = (g as { type: string }).type;
  const coords = (g as { coordinates: unknown[] }).coordinates;
  if (t === 'Polygon') {
    return [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: coords } },
    ];
  }
  if (t === 'MultiPolygon') {
    return (coords as unknown[]).map((rings) => ({
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: rings },
    }));
  }
  return [];
}

/** Gap (degrees) between two bboxes — 0 if they overlap/touch on an axis. */
function bboxGap(a: GeoExtent, b: GeoExtent): number {
  const lonGap = Math.max(0, a[0][0] - b[1][0], b[0][0] - a[1][0]);
  const latGap = Math.max(0, a[0][1] - b[1][1], b[0][1] - a[1][1]);
  return Math.max(lonGap, latGap);
}

/** Like `featureBbox`, but for FRAMING: ignores far-detached minor territories
 *  (overseas DOM-TOM, distant small islands) so a multi-part country frames on
 *  its dominant landmass cluster. Falls back to the full bbox for single-part
 *  features or when decomposition fails. Antimeridian-spanning parts (geoBounds
 *  west > east) are treated as full-bbox to avoid mis-clustering across the seam. */
export function featureBboxPrimary(
  topo: BoundaryTopology,
  geomId: string
): GeoExtent | null {
  const geom = geomObject(topo).geometries.find((g) => g.id === geomId);
  if (!geom) return null;
  const gj = feature(topo as never, geom as never) as never;
  const parts = explodePolygons(gj);
  if (parts.length <= 1) return featureBbox(topo, geomId);

  const polys = parts
    .map((p) => {
      const b = geoBounds(p as never);
      if (!b || !Number.isFinite(b[0][0])) return null;
      // Skip antimeridian-wrapping parts for clustering math (handled by full bbox).
      const wraps = b[1][0] < b[0][0];
      const bbox: GeoExtent = [
        [b[0][0], b[0][1]],
        [b[1][0], b[1][1]],
      ];
      return { bbox, area: geoArea(p as never), wraps };
    })
    .filter(
      (p): p is { bbox: GeoExtent; area: number; wraps: boolean } => p !== null
    );

  if (polys.length <= 1 || polys.some((p) => p.wraps))
    return featureBbox(topo, geomId);

  const maxArea = Math.max(...polys.map((p) => p.area));
  const anchor = polys.find((p) => p.area === maxArea)!;
  // Grow the cluster: keep a part if it is near the current cluster OR large.
  const cluster: GeoExtent = [
    [anchor.bbox[0][0], anchor.bbox[0][1]],
    [anchor.bbox[1][0], anchor.bbox[1][1]],
  ];
  const remaining = polys.filter((p) => p !== anchor);
  let added = true;
  while (added) {
    added = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const p = remaining[i]!;
      const near = bboxGap(p.bbox, cluster) <= DETACH_GAP_DEG;
      const large = p.area >= DETACH_AREA_FRAC * maxArea;
      if (near || large) {
        cluster[0][0] = Math.min(cluster[0][0], p.bbox[0][0]);
        cluster[0][1] = Math.min(cluster[0][1], p.bbox[0][1]);
        cluster[1][0] = Math.max(cluster[1][0], p.bbox[1][0]);
        cluster[1][1] = Math.max(cluster[1][1], p.bbox[1][1]);
        remaining.splice(i, 1);
        added = true;
      }
    }
  }
  return cluster;
}

/** Union of bboxes + POI points into one extent; null if empty. Longitude union
 *  uses the smaller-arc rule so an antimeridian-crossing union doesn't span the
 *  globe.
 *
 *  KNOWN RESIDUAL (#2, documented not fixed): a single feature whose own bbox
 *  wraps the antimeridian (`geoBounds` returns west > east — e.g. Russia, Fiji)
 *  is flattened to its two corner longitudes here. For that feature ALONE the
 *  two corners reconstruct the occupied arc correctly via `unionLongitudes`; but
 *  combined with other features the per-feature wrap is lost and the framing may
 *  be sub-optimal (never globe-spanning — the #1 smaller-arc rule still bounds
 *  it). v1 ships only country + US-state region fills, so a dateline-spanning
 *  region mixed with distant content is rare. A full fix feeds occupied
 *  longitude RANGES (not corner samples) into a circular-arc cover. */
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
