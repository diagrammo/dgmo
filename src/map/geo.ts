// Geometry helpers for the resolver: topology indexing + antimeridian-correct
// feature bounds (via d3-geo geoBounds — NOT naive min/max, which breaks on the
// antimeridian and on multi-part features like US Alaska/Hawaii; R5/R6).
import { feature, neighbors } from 'topojson-client';
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

// Memoize adjacency on the RAW asset object (never the per-render-mutated
// `worldLayer`). Keyed by topology identity — the assets are stable singletons
// from load-data.ts, so one build per topology lasts the process (G13).
const adjacencyCache = new WeakMap<BoundaryTopology, Map<string, string[]>>();

/** Per-topology arc-adjacency: ISO → neighbour ISOs, from shared TopoJSON arcs
 *  (`topojson-client.neighbors()` on the RAW topology geometries — arcs live on
 *  the topology, independent of any `feature()` decode — F2/ADR-4). Computed
 *  per-topology (a country never neighbours a state) and memoized.
 *
 *  DATA HYGIENE (G1): the raw geometry array can carry (a) `type: null`
 *  sovereignty stubs with no arcs (e.g. "Ashmore & Cartier Is." tagged `AU`) and
 *  (b) genuine duplicate ISO ids. Null stubs are skipped (no arcs → no
 *  adjacency), and every geometry sharing one ISO is UNIONED into a single ISO
 *  node — matching the merged layer `decodeLayer` actually draws. Without this
 *  the ISO-keyed graph corrupts and the AC9 no-collision guarantee degrades. */
export function buildAdjacency(topo: BoundaryTopology): Map<string, string[]> {
  const cached = adjacencyCache.get(topo);
  if (cached) return cached;
  const geometries = geomObject(topo).geometries as Array<{
    id: string;
    type?: string;
  }>;
  // neighbors() returns, per geometry BY ARRAY POSITION, the indices of
  // arc-sharing geometries. Null-geometry stubs share no arcs → empty lists.
  const nb = neighbors(geometries as never);
  const sets = new Map<string, Set<string>>();
  geometries.forEach((g, i) => {
    if (!g.type || g.type === 'null') return; // skip arc-less sovereignty stubs
    let set = sets.get(g.id);
    if (!set) {
      set = new Set<string>();
      sets.set(g.id, set);
    }
    for (const j of nb[i] ?? []) {
      const nid = geometries[j]?.id;
      if (nid && nid !== g.id) set.add(nid); // union; never self
    }
  });
  const out = new Map<string, string[]>();
  // Deterministic neighbour order (sorted) so downstream coloring is stable.
  for (const [iso, set] of sets) out.set(iso, [...set].sort());
  adjacencyCache.set(topo, out);
  return out;
}

/** A decoded boundary feature: the GeoJSON geometry plus its ISO id and display
 *  name (carried straight from the topology's `properties.name`). Used for
 *  point-in-polygon reverse-geocoding by the geo-query. */
export interface DecodedFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly properties: { readonly name: string };
  readonly geometry: unknown;
}

/** Decode every feature of a topology into GeoJSON, keyed nowhere — returned as a
 *  flat array so the geo-query can decode ONCE at construction and reuse the
 *  result across every `regionAt` call (no per-click re-decode). Uses this
 *  module's own `geomObject`/`feature` (never layout.ts's private decoder). */
export function decodeFeatures(topo: BoundaryTopology): DecodedFeature[] {
  return geomObject(topo).geometries.map((g) => {
    const f = feature(topo as never, g as never) as unknown as {
      geometry: unknown;
    };
    return {
      type: 'Feature',
      id: g.id,
      properties: g.properties,
      geometry: f.geometry,
    };
  });
}

/** Even-odd ray-cast: is `[lon, lat]` inside a single lon/lat ring? Planar (NOT
 *  spherical): d3-geo `geoContains` is winding-sensitive and the Natural-Earth
 *  rings invert under it (a small country reads as covering the globe). A planar
 *  ray-cast on the raw lon/lat coordinates is the correct, robust test at this
 *  reverse-geocode resolution (antimeridian crossers ship as seam-split parts, so
 *  no ring actually wraps ±180). */
function pointInRing(
  lon: number,
  lat: number,
  ring: ReadonlyArray<readonly number[]>
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// On-boundary tolerance (degrees). A click landing exactly on a shared border or
// a ring vertex is otherwise float-dependent (ray-cast vertex double-count → the
// point reads as inside neither neighbour, returning ocean over land). Treating
// an on-edge point as INSIDE makes `regionAt` deterministic: the first iterated
// country whose boundary the point sits on wins, rather than a rounding coin-flip.
const EDGE_EPS = 1e-9;

/** Is `[lon, lat]` on any edge of `ring` (within EDGE_EPS)? */
function pointOnRingEdge(
  lon: number,
  lat: number,
  ring: ReadonlyArray<readonly number[]>
): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    // Bounding-box reject first (cheap).
    if (lon < Math.min(xi, xj) - EDGE_EPS || lon > Math.max(xi, xj) + EDGE_EPS)
      continue;
    if (lat < Math.min(yi, yj) - EDGE_EPS || lat > Math.max(yi, yj) + EDGE_EPS)
      continue;
    // Collinear with the segment ⇒ on it (bbox already bounded the extent).
    const cross = (xj - xi) * (lat - yi) - (yj - yi) * (lon - xi);
    if (Math.abs(cross) <= EDGE_EPS) return true;
  }
  return false;
}

/** Point-in-polygon for a Polygon/MultiPolygon geometry (outer ring minus holes).
 *  A point on the outer boundary counts as inside (deterministic border handling).
 *  Exported so layout's context-label dodge-position generation can validate that
 *  a candidate interior point sits on the country's OWN rendered geometry —
 *  holes-aware, so enclaves and neighbours are both rejected (map-context-neighbor
 *  -labels D8). */
export function pointInGeometry(
  geometry: unknown,
  lon: number,
  lat: number
): boolean {
  const g = geometry as {
    type: string;
    coordinates: number[][][] | number[][][][];
  } | null;
  if (!g) return false;
  const polys: number[][][][] =
    g.type === 'Polygon'
      ? [g.coordinates as number[][][]]
      : g.type === 'MultiPolygon'
        ? (g.coordinates as number[][][][])
        : [];
  for (const rings of polys) {
    if (!rings.length) continue;
    // On the outer boundary ⇒ inside (deterministic; beats the ray-cast coin-flip).
    if (pointOnRingEdge(lon, lat, rings[0]!)) return true;
    if (!pointInRing(lon, lat, rings[0]!)) continue;
    // Inside the outer ring — exclude if it falls strictly within a hole (a point
    // on the hole boundary is still land, so it stays inside).
    let inHole = false;
    for (let h = 1; h < rings.length; h++) {
      if (
        pointInRing(lon, lat, rings[h]!) &&
        !pointOnRingEdge(lon, lat, rings[h]!)
      ) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Reverse-geocode a `[lon, lat]` to its containing country and (US-only) state
 *  via planar point-in-polygon. Honest about misses: returns `country: null`
 *  when no polygon contains the point (open ocean / outside any country) rather
 *  than guessing (F4). State is tested only when the country is the US.
 *  `countries` should be world-detail (50m) features; `states` the us-states
 *  (10m) features. Both are pre-decoded by the caller. */
export function regionAt(
  lonLat: readonly [number, number],
  countries: readonly DecodedFeature[],
  states: readonly DecodedFeature[] | null
): {
  country: { iso: string; name: string } | null;
  state: { iso: string; name: string } | null;
} {
  const lon = lonLat[0];
  const lat = lonLat[1];
  let country: { iso: string; name: string } | null = null;
  for (const f of countries) {
    if (pointInGeometry(f.geometry, lon, lat)) {
      country = { iso: f.id, name: f.properties.name };
      break;
    }
  }
  let state: { iso: string; name: string } | null = null;
  if (country?.iso === 'US' && states) {
    for (const f of states) {
      if (pointInGeometry(f.geometry, lon, lat)) {
        state = { iso: f.id, name: f.properties.name };
        break;
      }
    }
  }
  return { country, state };
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
