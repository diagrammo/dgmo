// Layout (step 4, part 1): ResolvedMap + MapData -> MapLayout. PURE + SYNC +
// DETERMINISTIC -- no DOM, no Math.random/Date. Decodes the basemap topology,
// builds the d3-geo projection chosen by the resolver, fits it to the screen,
// projects POIs/routes/edges, computes choropleth + categorical fills, scales
// POI radii + edge widths, and places labels with per-cluster collision
// escalation. The SVG emission is renderer.ts (it only draws what we compute).
// See spec section 24B.3-.7/.11 + the tech-spec Adversarial Review Resolutions AR1-AR9.
import {
  geoPath,
  geoNaturalEarth1,
  geoAlbersUsa,
  geoMercator,
  type GeoProjection,
  type GeoPath,
} from 'd3-geo';
import { feature } from 'topojson-client';
import { mix, shapeFill, contrastText } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes/types';
import { resolveActiveTagGroup } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import { rectsOverlap, rectCircleOverlap } from '../label-layout';
import type { LabelRect, PointCircle } from '../label-layout';
import { measureLegendText } from '../utils/legend-constants';
import { TITLE_FONT_SIZE, TITLE_Y } from '../utils/title-constants';
import type { BoundaryTopology } from './data/types';
import type {
  MapData,
  ResolvedMap,
  ResolvedPoi,
  ResolvedEdge,
  ProjectionFamily,
} from './resolved-types';

// Minimal GeoJSON shapes (avoid a hard @types/geojson dep; cast at d3 calls).
interface GeoFeature {
  type: 'Feature';
  id?: string | number;
  properties: unknown;
  geometry: unknown;
}
interface GeoFC {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

// -- Tunable constants (deterministic; no magic at call sites) --
const FIT_PAD = 24; // px padding inside the viewport
const RAMP_FLOOR = 15; // % tint floor so min still reads as "low, present" (24B.3)
const R_DEFAULT = 6; // POI radius without size:
const R_MIN = 4;
const R_MAX = 22;
const W_MIN = 1.25; // edge stroke width
const W_MAX = 8;
const FONT = 11; // on-map label font px
const LEADER_STEP = 14; // px ring radius step for label escalation
const COLO_EPS = 1.5; // px: POIs closer than this are "co-located"
// % palette-yellow of bg for unscored land. Higher on dark so the soft palette
// yellow reads as yellow rather than muddying toward tan against the dark bg.
const LAND_TINT_LIGHT = 58;
const LAND_TINT_DARK = 75;
const WATER_TINT = 55; // % palette-blue of bg for the ocean / backdrop
// % palette-gray of bg for non-US neighbour land. Higher on dark so it reads as
// a clear gray rather than sinking into the dark background.
const FOREIGN_TINT_LIGHT = 30;
const FOREIGN_TINT_DARK = 62;
const COLO_R = 9; // spiderfy radius
const GOLDEN_ANGLE = 2.399963229728653; // rad (137.5deg) -- even spiral, no random
const FAN_STEP = 16; // px perpendicular offset between parallel edges
const TINY_REGION_AREA = 600; // px^2: region label auto-hidden below this
const ARC_CURVE_FRAC = 0.18; // default arc bow as a fraction of leg length

// Fixed candidate ring for label escalation (E, S, W, N, then diagonals).
const RING_DIRS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

export interface MapLayoutRegion {
  readonly id: string; // iso
  readonly d: string; // SVG path data
  readonly fill: string;
  readonly stroke: string;
  readonly label?: string;
  readonly lineNumber: number;
  readonly layer: 'base' | 'country' | 'us-state';
}

/** A framed inset "cutout" (albers-usa AK/HI), in screen px. */
export interface MapLayoutInset {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface MapLayoutPoi {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill: string;
  readonly stroke: string;
  readonly lineNumber: number;
  readonly implicit: boolean;
  readonly isOrigin: boolean; // route origin -> distinct marker
  readonly routeNumber?: number; // route stop badge
}

/** A drawn connector -- an edge or a route leg (same geometry contract). */
export interface MapLayoutLeg {
  readonly d: string;
  readonly width: number;
  readonly color: string;
  readonly arrow: boolean;
  readonly label?: string;
  readonly labelX?: number;
  readonly labelY?: number;
  readonly lineNumber: number;
}

export interface PlacedLabel {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly color: string;
  readonly halo: boolean;
  readonly leader?: { x1: number; y1: number; x2: number; y2: number };
  readonly pin?: number; // numbered-pin fallback
  readonly lineNumber: number;
}

export interface MapLayoutLegend {
  readonly tagGroups: ReadonlyArray<{
    name: string;
    entries: ReadonlyArray<{ value: string; color: string }>;
  }>;
  readonly activeGroup: string | null;
  readonly ramp?: {
    metric?: string;
    min: number;
    max: number;
    hue: string;
    /** Low end of the ramp gradient (the land colour the fills blend from). */
    base: string;
  };
  readonly size?: { metric?: string; min: number; max: number };
  readonly weight?: { metric?: string; min: number; max: number };
}

export interface MapLayout {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly title: string | null;
  readonly subtitle?: string;
  readonly caption?: string;
  readonly regions: readonly MapLayoutRegion[];
  readonly legs: readonly MapLayoutLeg[];
  readonly pois: readonly MapLayoutPoi[];
  readonly labels: readonly PlacedLabel[];
  /** Numbered-pin fallback legend list (pin -> label). */
  readonly pinList: ReadonlyArray<{ pin: number; label: string }>;
  readonly legend: MapLayoutLegend | null;
  /** Framed AK/HI inset cutouts (albers-usa only; empty otherwise). */
  readonly insets: readonly MapLayoutInset[];
}

export interface LayoutOptions {
  readonly palette: PaletteColors;
  readonly isDark: boolean;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** The single geometry object of a step-1 topology (`countries` | `states`). */
function geomObject(topo: BoundaryTopology): {
  geometries: BoundaryTopology['objects'][string]['geometries'];
} {
  const key = Object.keys(topo.objects)[0]!;
  return topo.objects[key]!;
}

/** Decode every feature of a topology into GeoJSON, keyed by ISO id. */
function decodeLayer(topo: BoundaryTopology): Map<string, GeoFeature> {
  const out = new Map<string, GeoFeature>();
  for (const g of geomObject(topo).geometries) {
    const f = feature(topo as never, g as never) as unknown as GeoFeature;
    out.set(g.id, { ...f, id: g.id });
  }
  return out;
}

function projectionFor(family: ProjectionFamily): GeoProjection {
  switch (family) {
    case 'albers-usa':
      return geoAlbersUsa();
    case 'mercator':
      return geoMercator();
    case 'natural-earth':
    default:
      return geoNaturalEarth1();
  }
}

/** The map's water / backdrop colour for a palette — the single source of truth
 *  shared by the renderer's `<rect>` fill and any host wrapper that needs to
 *  match it (so letterbox gaps around the SVG don't show a stray band). */
export function mapBackgroundColor(palette: PaletteColors): string {
  return mix(palette.colors.blue, palette.bg, WATER_TINT);
}

export function layoutMap(
  resolved: ResolvedMap,
  data: MapData,
  size: Size,
  opts: LayoutOptions
): MapLayout {
  const { palette, isDark } = opts;
  const { width, height } = size;

  // -- Basemap decode --
  const worldTopo =
    resolved.basemaps.world === 'detail' ? data.worldDetail : data.worldCoarse;
  const worldLayer = decodeLayer(worldTopo);
  const usLayer = resolved.basemaps.subdivisions.includes('us-states')
    ? decodeLayer(data.usStates)
    : null;

  // Land is a muted yellow; the ocean/backdrop is blue. Scored/tagged regions
  // paint over the land base, and the score ramp blends FROM the land colour so
  // low scores stay land-toned rather than fading out. In a US view the world
  // layer is just neighbour context (Mexico/Canada at the frame edge) — fill it
  // gray so the yellow US reads as the subject; world maps (no us-states layer)
  // keep yellow land for every country.
  const landTint = isDark ? LAND_TINT_DARK : LAND_TINT_LIGHT;
  const neutralFill = mix(palette.colors.yellow, palette.bg, landTint);
  const water = mapBackgroundColor(palette);
  const usContext = usLayer !== null;
  const foreignFill = mix(
    palette.colors.gray,
    palette.bg,
    isDark ? FOREIGN_TINT_DARK : FOREIGN_TINT_LIGHT
  );
  // Region borders: a darker line (toward the text colour) so state outlines
  // read clearly over the land fills rather than as a faint hairline.
  const regionStroke = mix(palette.text, palette.bg, isDark ? 58 : 72);

  // -- Region fill model (choropleth + categorical; AR4/AR6) --
  const scores = resolved.regions
    .filter((r) => r.score !== undefined)
    .map((r) => r.score!);
  const scaleOverride = resolved.directives.scale;
  const rampMin = scaleOverride ? scaleOverride.min : Math.min(...scores);
  const rampMax = scaleOverride ? scaleOverride.max : Math.max(...scores);
  // Score ramp is red so scored regions stand out against the blue water
  // (palette.primary is a blue in most palettes and would blend in).
  const rampHue = palette.colors.red;
  const hasRamp = scores.length > 0;

  const activeGroup = resolveActiveTagGroup(
    resolved.tagGroups as TagGroup[],
    resolved.directives.activeTag
  );

  const fillForScore = (s: number): string => {
    const t = rampMax > rampMin ? (s - rampMin) / (rampMax - rampMin) : 1;
    const pct = RAMP_FLOOR + Math.max(0, Math.min(1, t)) * (100 - RAMP_FLOOR);
    // Blend from the land colour up to the ramp hue, so the lowest scores read
    // as faintly-tinted land rather than fading into the dark background.
    return mix(rampHue, neutralFill, pct);
  };

  /** Resolve a tag value (name) -> tinted hex via a declared group, or null. */
  const tagFill = (
    tags: Readonly<Record<string, string>>,
    groupName: string | null
  ): string | null => {
    if (!groupName) return null;
    const group = resolved.tagGroups.find(
      (g) => g.name.toLowerCase() === groupName.toLowerCase()
    );
    if (!group) return null;
    const val = tags[group.name.toLowerCase()] ?? group.defaultValue;
    if (!val) return null;
    const entry = group.entries.find(
      (e) => e.value.toLowerCase() === val.toLowerCase()
    );
    // The map parser pre-resolves tag colors to hex at parse time
    // (extractColor); entry.color is already a hex string, NOT a name — so it
    // is used directly (do NOT run it through resolveColor, which rejects `#`).
    // An unknown tag VALUE (no matching entry) falls back to neutral (AR4/AC25).
    if (!entry?.color) return null;
    return shapeFill(palette, entry.color, isDark); // 25% tint, never solid by default
  };

  const regionById = new Map(resolved.regions.map((r) => [r.iso, r]));

  // -- Projection + fit (AR2, refined) --
  // The drawn region polygons drive an albers fit; for world projections we fit
  // to the resolver's (padded, never-degenerate) extent box — fitting to raw
  // drawn points would collapse to a zero-size target (single/coincident POIs →
  // Infinity scale → NaN). albers-usa is US-only with AK/HI insets, so a
  // geographic bbox is wrong there — fit to the actual US features instead, and
  // fall back to the whole-US base when only POIs are present.
  const regionFeatures: GeoFeature[] = [];
  for (const r of resolved.regions) {
    const f =
      r.layer === 'us-state' ? usLayer?.get(r.iso) : worldLayer.get(r.iso);
    if (f) regionFeatures.push(f);
  }
  // The extent's four CORNERS as a MultiPoint — NOT a Polygon. A hand-built
  // lat/lon rectangle's spherical winding is ambiguous to d3-geo, which can
  // read it as the whole-globe complement (→ tiny content framed on a world
  // map). Corner points have no interior/winding ambiguity, so fitExtent frames
  // exactly the extent box.
  const extentCorners = (): GeoFeature => {
    const [[w, s], [e, n]] = resolved.extent;
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
        ],
      },
    };
  };

  let fitFeatures: GeoFeature[];
  if (resolved.projection === 'albers-usa') {
    if (regionFeatures.length > 0) fitFeatures = regionFeatures;
    else if (usLayer) fitFeatures = [...usLayer.values()];
    else {
      const us = worldLayer.get('US');
      fitFeatures = us ? [us] : [...worldLayer.values()];
    }
  } else {
    fitFeatures = [extentCorners()];
  }
  const fitTarget: GeoFC = { type: 'FeatureCollection', features: fitFeatures };

  const projection = projectionFor(resolved.projection);
  // mercator / natural-earth: rotate to the extent's center longitude BEFORE
  // fitting (rotate changes the bounds fitExtent measures). albers-usa is a
  // US-only composite with NO .rotate -- never call it (AR2).
  if (resolved.projection !== 'albers-usa') {
    let centerLon = (resolved.extent[0][0] + resolved.extent[1][0]) / 2;
    if (centerLon > 180) centerLon -= 360;
    projection.rotate([-centerLon, 0]);
  }
  // Reserve top padding for the title/subtitle banner ONLY when there are POIs,
  // so their markers/labels don't project up under the title (which renders in
  // the foreground). A POI-less choropleth needs no reserve — the land fills to
  // the top and the title simply overlays it, so neighbour land (e.g. Canada)
  // isn't cut short by a band of empty water above it.
  const TITLE_GAP = 16;
  let topPad = FIT_PAD;
  if (resolved.title && resolved.pois.length > 0) {
    const bannerBottom =
      (resolved.subtitle ? TITLE_Y + TITLE_FONT_SIZE : TITLE_Y) +
      TITLE_FONT_SIZE / 2;
    topPad = Math.max(FIT_PAD, bannerBottom + TITLE_GAP);
  }
  projection.fitExtent(
    [
      [FIT_PAD, topPad],
      [
        Math.max(FIT_PAD + 1, width - FIT_PAD),
        Math.max(topPad + 1, height - FIT_PAD),
      ],
    ],
    fitTarget as never
  );
  const path: GeoPath = geoPath(projection);
  const project = (lon: number, lat: number): [number, number] | null =>
    projection([lon, lat]) ?? null;

  // -- AK / HI inset cutouts (albers-usa) --
  // geoAlbersUsa composites Alaska and Hawaii into the lower-left but draws no
  // separator, so they read as ocean — Hawaii nearly vanishes. Frame each as an
  // inset "card" so they stand out as insets. The screen bbox comes from
  // projecting the feature's own vertices through the composite projection.
  const insets: MapLayoutInset[] = [];
  if (resolved.projection === 'albers-usa' && usLayer) {
    const INSET_PAD = 10;
    for (const iso of ['US-AK', 'US-HI']) {
      const f = usLayer.get(iso);
      if (!f) continue;
      // path.bounds is projection-aware (handles the albers composite + the
      // antimeridian Aleutians exactly like the rendered path), so the frame
      // always contains the drawn inset — manual vertex projection does not.
      const b = path.bounds(f as never);
      if (!b || !Number.isFinite(b[0][0])) continue;
      // Clamp to the canvas (small margin) so a frame never bleeds off an edge
      // — Alaska's inset sits hard against the lower-left corner.
      const m = 4;
      const x0 = Math.max(m, b[0][0] - INSET_PAD);
      const y0 = Math.max(m, b[0][1] - INSET_PAD);
      const x1 = Math.min(width - m, b[1][0] + INSET_PAD);
      const y1 = Math.min(height - m, b[1][1] + INSET_PAD);
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      insets.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }

  // -- Basemap culling --
  // At a regional zoom (e.g. a Caribbean route) far-away land — especially the
  // poles and antimeridian-spanning countries (Antarctica, Russia, Canada) —
  // projects to frame-filling garbage whose fill covers the whole viewport,
  // painting "sea" as land. Only draw features whose geographic bounds overlap
  // the (padded) visible extent. A near-global view draws everything.
  const [[exW, exS], [exE, exN]] = resolved.extent;
  const lonSpan = exE - exW;
  const latSpan = exN - exS;
  // A near-global view draws everything. (albers-usa is handled per-layer at the
  // pushRegionLayer calls: the world layer IS culled by the contiguous-US extent
  // so far countries don't project to frame-filling garbage, while the us-states
  // layer is NEVER culled so Alaska & Hawaii — far outside that extent — survive.)
  const isGlobalView = lonSpan >= 270 || latSpan >= 130;
  const padLon = Math.max(8, lonSpan * 0.35);
  const padLat = Math.max(8, latSpan * 0.35);
  const vW = exW - padLon;
  const vE = exE + padLon;
  const vS = exS - padLat;
  const vN = exN + padLat;
  // Pacific-crossing extents use extended longitudes (e.g. 247 = 113°W), but
  // ring vertices are in [-180,180]. Shift each vertex into the extent's frame
  // so the overlap test compares like-for-like.
  const vLonCenter = (exW + exE) / 2;
  const normLon = (lon: number): number => {
    let L = lon;
    while (L < vLonCenter - 180) L += 360;
    while (L > vLonCenter + 180) L -= 360;
    return L;
  };
  // True if an outer ring overlaps the padded view box. A ring with a vertex
  // inside is in; otherwise a non-wrapping bbox overlap also counts (a big
  // coastal polygon whose edge clips the box). Antimeridian-wrapping rings with
  // no in-view vertex are dropped — they are the frame-fill artifact source.
  type Ring = ReadonlyArray<readonly [number, number]>;
  const ringOverlapsView = (ring: Ring): boolean => {
    let anyIn = false;
    let loMin = Infinity,
      loMax = -Infinity,
      laMin = Infinity,
      laMax = -Infinity,
      rawMin = Infinity,
      rawMax = -Infinity;
    for (const [rawLon, lat] of ring) {
      const lon = normLon(rawLon);
      if (lon >= vW && lon <= vE && lat >= vS && lat <= vN) anyIn = true;
      if (lon < loMin) loMin = lon;
      if (lon > loMax) loMax = lon;
      if (rawLon < rawMin) rawMin = rawLon;
      if (rawLon > rawMax) rawMax = rawLon;
      if (lat < laMin) laMin = lat;
      if (lat > laMax) laMax = lat;
    }
    // A near-circumpolar ring (Antarctica, polar wrap) spans almost all
    // longitudes and projects to a frame-filling fill at regional zoom — drop it.
    if (loMax - loMin > 270) return false;
    // An antimeridian-crossing ring (raw lons span >180 but normalize to a small
    // arc — e.g. Fiji at 177°E..178°W) inverts under a rotated projection and
    // fills the frame. At coarse tier these are tiny islands; drop them in
    // regional views rather than paint the whole ocean as land.
    if (rawMax - rawMin > 180 && loMax - loMin < 90) return false;
    if (anyIn) return true;
    if (loMax - loMin > 180) return false; // wraps antimeridian, none in view
    return !(loMax < vW || loMin > vE || laMax < vS || laMin > vN);
  };
  // Drop a feature's sub-polygons that don't touch the view (e.g. Alaska's
  // Aleutians on a US feature framed over the Caribbean). Returns null if the
  // whole feature is out of view. Near-global views keep everything.
  const cullFeatureToView = (f: GeoFeature): GeoFeature | null => {
    if (isGlobalView) return f;
    const g = f.geometry as {
      type: string;
      coordinates: number[][][] | number[][][][];
    } | null;
    if (!g) return f;
    if (g.type === 'Polygon') {
      const ring = (g.coordinates as number[][][])[0] as unknown as Ring;
      return ringOverlapsView(ring) ? f : null;
    }
    if (g.type === 'MultiPolygon') {
      const polys = g.coordinates as number[][][][];
      const keep = polys.filter((p) =>
        ringOverlapsView(p[0] as unknown as Ring)
      );
      if (!keep.length) return null;
      if (keep.length === polys.length) return f;
      return { ...f, geometry: { ...g, coordinates: keep } } as GeoFeature;
    }
    return f;
  };

  // -- Regions: base layer (neutral) then resolved fills on top --
  const regions: MapLayoutRegion[] = [];
  const pushRegionLayer = (
    layerFeatures: Map<string, GeoFeature>,
    layerKind: 'country' | 'us-state',
    shouldCull: boolean
  ): void => {
    for (const [iso, f] of layerFeatures) {
      const r = regionById.get(iso);
      const viewF = shouldCull ? cullFeatureToView(f) : f; // drop far/off-view land
      if (!viewF) continue;
      const d = path(viewF as never) ?? '';
      if (!d) continue;
      const isThisLayer = r?.layer === layerKind;
      // Non-US neighbour land in a US view is gray context, not yellow land.
      const isForeign = layerKind === 'country' && usContext && iso !== 'US';
      let fill = isForeign ? foreignFill : neutralFill;
      let label: string | undefined;
      let lineNumber = -1;
      let layer: MapLayoutRegion['layer'] = 'base';
      if (isThisLayer) {
        // score wins over tag (24B.4 / AR4)
        if (r.score !== undefined) fill = fillForScore(r.score);
        else fill = tagFill(r.tags, activeGroup) ?? neutralFill;
        lineNumber = r.lineNumber;
        layer = layerKind;
        label = r.name;
      }
      regions.push({
        id: iso,
        d,
        fill,
        stroke: regionStroke,
        lineNumber,
        layer,
        ...(label !== undefined && { label }),
      });
    }
  };
  // World/foreign layer: cull by the visible extent (unless near-global) so far
  // countries don't project to frame-filling garbage under albers-usa.
  pushRegionLayer(worldLayer, 'country', !isGlobalView);
  // US-states layer: never cull under albers-usa, or Alaska/Hawaii (far outside
  // the contiguous extent) would be dropped.
  if (usLayer)
    pushRegionLayer(
      usLayer,
      'us-state',
      !isGlobalView && resolved.projection !== 'albers-usa'
    );

  // Lakes (Great Lakes etc.) painted as water OVER the land so they don't read
  // as land — the coarse country polygons don't carve them out. Drawn last so
  // they sit above both neighbour land and US states; culled like the world
  // layer, and far lakes null-project away under albers-usa.
  if (data.lakes) {
    for (const [, f] of decodeLayer(data.lakes)) {
      const viewF = isGlobalView ? f : cullFeatureToView(f);
      if (!viewF) continue;
      const d = path(viewF as never) ?? '';
      if (!d) continue;
      regions.push({
        id: 'lake',
        d,
        fill: water,
        stroke: 'none',
        lineNumber: -1,
        layer: 'base',
      });
    }
  }

  // -- POIs: project, size-scale, co-located spiderfy --
  const sizeVals = resolved.pois
    .map((p) => Number(p.meta['size']))
    .filter((n) => Number.isFinite(n) && n > 0);
  const sizeMin = sizeVals.length ? Math.min(...sizeVals) : 0;
  const sizeMax = sizeVals.length ? Math.max(...sizeVals) : 0;
  const radiusFor = (p: ResolvedPoi): number => {
    const v = Number(p.meta['size']);
    if (!Number.isFinite(v) || v <= 0 || sizeMax <= 0) return R_DEFAULT;
    // sqrt so AREA encodes the value
    const t =
      sizeMax > sizeMin
        ? (Math.sqrt(v) - Math.sqrt(sizeMin)) /
          (Math.sqrt(sizeMax) - Math.sqrt(sizeMin))
        : 1;
    return R_MIN + Math.max(0, Math.min(1, t)) * (R_MAX - R_MIN);
  };

  // POI tag color: FIRST declared group for which the POI has a value (AR4).
  const poiFill = (p: ResolvedPoi): { fill: string; stroke: string } => {
    for (const group of resolved.tagGroups) {
      const val = p.tags[group.name.toLowerCase()];
      if (!val) continue;
      const entry = group.entries.find(
        (e) => e.value.toLowerCase() === val.toLowerCase()
      );
      const hex = entry?.color; // already hex (parser-resolved)
      if (hex) return { fill: hex, stroke: mix(hex, palette.text, 18) };
    }
    return {
      fill: palette.accent,
      stroke: mix(palette.accent, palette.text, 18),
    };
  };

  // Route metadata first so POIs know origin/number.
  const routeNumberById = new Map<string, number>();
  const originIds = new Set<string>();
  for (const rt of resolved.routes) {
    rt.stopIds.forEach((id, i) => {
      if (i === 0) originIds.add(id);
      if (!routeNumberById.has(id)) routeNumberById.set(id, i + 1);
    });
  }

  const poiScreen = new Map<string, { cx: number; cy: number }>();
  const pois: MapLayoutPoi[] = [];
  // Stable order for deterministic co-location indices (AR9).
  const orderedPois = [...resolved.pois].sort(
    (a, b) => a.lineNumber - b.lineNumber || (a.id < b.id ? -1 : 1)
  );
  interface Proj {
    p: ResolvedPoi;
    xy: [number, number];
  }
  const projected: Proj[] = [];
  for (const p of orderedPois) {
    const xy = project(p.lon, p.lat);
    if (xy) projected.push({ p, xy });
  }
  const coloGroups = new Map<string, Proj[]>();
  for (const e of projected) {
    const key = `${Math.round(e.xy[0] / COLO_EPS)},${Math.round(e.xy[1] / COLO_EPS)}`;
    const arr = coloGroups.get(key);
    if (arr) arr.push(e);
    else coloGroups.set(key, [e]);
  }
  for (const group of coloGroups.values()) {
    group.forEach((e, i) => {
      let cx = e.xy[0];
      let cy = e.xy[1];
      if (group.length > 1) {
        const ang = i * GOLDEN_ANGLE;
        cx += Math.cos(ang) * COLO_R;
        cy += Math.sin(ang) * COLO_R;
      }
      const { fill, stroke } = poiFill(e.p);
      poiScreen.set(e.p.id, { cx, cy });
      const num = routeNumberById.get(e.p.id);
      pois.push({
        id: e.p.id,
        cx,
        cy,
        r: radiusFor(e.p),
        fill,
        stroke,
        lineNumber: e.p.lineNumber,
        implicit: !!e.p.implicit,
        isOrigin: originIds.has(e.p.id),
        ...(num !== undefined && { routeNumber: num }),
      });
    });
  }

  // -- Connectors: routes + edges (with parallel fan-out) --
  const legs: MapLayoutLeg[] = [];
  const legPath = (
    a: { cx: number; cy: number },
    b: { cx: number; cy: number },
    curved: boolean,
    offset: number
  ): string => {
    if (!curved && offset === 0) return `M${a.cx},${a.cy}L${b.cx},${b.cy}`;
    const mx = (a.cx + b.cx) / 2;
    const my = (a.cy + b.cy) / 2;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bow = offset !== 0 ? offset : len * ARC_CURVE_FRAC;
    return `M${a.cx},${a.cy}Q${mx + nx * bow},${my + ny * bow} ${b.cx},${b.cy}`;
  };

  // Routes: legs between consecutive stops (loop closing leg included).
  for (const rt of resolved.routes) {
    const curved = rt.meta['style'] === 'arc';
    for (let i = 1; i < rt.stopIds.length; i++) {
      const a = poiScreen.get(rt.stopIds[i - 1]!);
      const b = poiScreen.get(rt.stopIds[i]!);
      if (!a || !b) continue;
      legs.push({
        d: legPath(a, b, curved, 0),
        width: W_MIN,
        color: mix(palette.text, palette.bg, 55),
        arrow: true,
        lineNumber: rt.lineNumber,
      });
    }
  }

  // Edges: group by unordered endpoint pair for deterministic fan-out (AR9).
  const weightVals = resolved.edges
    .map((e) => Number(e.meta['weight']))
    .filter((n) => Number.isFinite(n) && n > 0);
  const wMin = weightVals.length ? Math.min(...weightVals) : 0;
  const wMax = weightVals.length ? Math.max(...weightVals) : 0;
  const widthFor = (e: ResolvedEdge): number => {
    const v = Number(e.meta['weight']);
    if (!Number.isFinite(v) || v <= 0 || wMax <= 0) return W_MIN;
    const t = wMax > wMin ? (v - wMin) / (wMax - wMin) : 1;
    return W_MIN + t * (W_MAX - W_MIN);
  };
  const pairGroups = new Map<string, ResolvedEdge[]>();
  for (const e of resolved.edges) {
    const key = [e.fromId, e.toId].sort().join(' ');
    const arr = pairGroups.get(key);
    if (arr) arr.push(e);
    else pairGroups.set(key, [e]);
  }
  for (const groupEdges of pairGroups.values()) {
    const ordered = [...groupEdges].sort((a, b) => a.lineNumber - b.lineNumber);
    const n = ordered.length;
    ordered.forEach((e, i) => {
      const a = poiScreen.get(e.fromId);
      const b = poiScreen.get(e.toId);
      if (!a || !b) return;
      const curved = e.style === 'arc' || n > 1;
      const offset = n > 1 ? (i - (n - 1) / 2) * FAN_STEP : 0;
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      legs.push({
        d: legPath(a, b, curved, offset),
        width: widthFor(e),
        color: mix(palette.text, palette.bg, 45),
        arrow: e.directed,
        lineNumber: e.lineNumber,
        ...(e.label !== undefined && {
          label: e.label,
          labelX: mx,
          labelY: my - 4,
        }),
      });
    });
  }

  // -- Labels: regions + POIs with escalation (AR5) --
  const labels: PlacedLabel[] = [];
  const pinList: { pin: number; label: string }[] = [];
  const obstacles: LabelRect[] = [];
  const markers: PointCircle[] = pois.map((p) => ({
    cx: p.cx,
    cy: p.cy,
    r: p.r,
  }));
  const collides = (rect: LabelRect): boolean =>
    markers.some((m) => rectCircleOverlap(rect, m)) ||
    obstacles.some((o) => rectsOverlap(rect, o));

  // Region labels (default off; auto-hide tiny).
  const regionLabelMode = resolved.directives.regionLabels ?? 'off';
  if (regionLabelMode === 'full' || regionLabelMode === 'abbrev') {
    for (const r of regions) {
      if (r.layer === 'base' || r.label === undefined) continue;
      const f =
        r.layer === 'us-state' ? usLayer?.get(r.id) : worldLayer.get(r.id);
      if (!f) continue;
      const [[x0, y0], [x1, y1]] = path.bounds(f as never);
      if ((x1 - x0) * (y1 - y0) < TINY_REGION_AREA) continue; // auto-hide
      const c = path.centroid(f as never);
      if (!Number.isFinite(c[0])) continue;
      const text =
        regionLabelMode === 'abbrev' ? r.id.replace(/^US-/, '') : r.label;
      labels.push({
        x: c[0],
        y: c[1],
        text,
        anchor: 'middle',
        color: contrastText(
          r.fill,
          palette.textOnFillLight,
          palette.textOnFillDark
        ),
        halo: true,
        lineNumber: r.lineNumber,
      });
    }
  }

  // POI labels (default auto; off -> none; all -> every POI).
  const poiLabelMode = resolved.directives.poiLabels ?? 'auto';
  if (poiLabelMode !== 'off') {
    const ordered = [...pois].sort(
      (a, b) => a.lineNumber - b.lineNumber || (a.id < b.id ? -1 : 1)
    );
    const poiById = new Map(resolved.pois.map((q) => [q.id, q]));
    const labelText = (p: MapLayoutPoi): string => {
      const src = poiById.get(p.id);
      return src?.label ?? src?.name ?? p.id;
    };
    let pinCounter = 0;
    for (const p of ordered) {
      const text = labelText(p);
      const w = measureLegendText(text, FONT);
      const h = FONT * 1.25;
      const inline: LabelRect = { x: p.cx + p.r + 3, y: p.cy - h / 2, w, h };
      if (!collides(inline)) {
        obstacles.push(inline);
        labels.push({
          x: inline.x,
          y: p.cy + FONT / 3,
          text,
          anchor: 'start',
          color: palette.text,
          halo: true,
          lineNumber: p.lineNumber,
        });
        continue;
      }
      // Escalate: fixed candidate ring -> leader line to first free slot.
      let placed = false;
      for (let k = 1; k <= 2 && !placed; k++) {
        for (const [dx, dy] of RING_DIRS) {
          const cx = p.cx + dx * LEADER_STEP * k;
          const cy = p.cy + dy * LEADER_STEP * k;
          const rect: LabelRect = {
            x: dx >= 0 ? cx : cx - w,
            y: cy - h / 2,
            w,
            h,
          };
          // Keep escalated labels on-canvas (#8) and collision-free.
          if (
            rect.x < 0 ||
            rect.x + rect.w > width ||
            rect.y < 0 ||
            rect.y + rect.h > height
          ) {
            continue;
          }
          if (collides(rect)) continue;
          obstacles.push(rect);
          labels.push({
            x: cx,
            y: cy + FONT / 3,
            text,
            anchor: dx >= 0 ? 'start' : 'end',
            color: palette.text,
            halo: true,
            leader: { x1: p.cx, y1: p.cy, x2: cx, y2: cy },
            lineNumber: p.lineNumber,
          });
          placed = true;
          break;
        }
      }
      if (placed) continue;
      // Final fallback: numbered pin + legend list entry.
      pinCounter += 1;
      pinList.push({ pin: pinCounter, label: text });
      labels.push({
        x: p.cx + p.r + 2,
        y: p.cy - p.r,
        text: String(pinCounter),
        anchor: 'start',
        color: palette.text,
        halo: true,
        pin: pinCounter,
        lineNumber: p.lineNumber,
      });
    }
  }

  // -- Legend model (AR1: categorical via renderer's renderLegendD3) --
  let legend: MapLayoutLegend | null = null;
  if (!resolved.directives.noLegend) {
    const tagGroups = resolved.tagGroups.map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
    }));
    const hasAnything =
      tagGroups.length > 0 ||
      hasRamp ||
      sizeVals.length > 0 ||
      weightVals.length > 0;
    if (hasAnything) {
      legend = {
        tagGroups,
        activeGroup,
        ...(hasRamp && {
          ramp: {
            ...(resolved.directives.metric !== undefined && {
              metric: resolved.directives.metric,
            }),
            min: rampMin,
            max: rampMax,
            hue: rampHue,
            base: neutralFill,
          },
        }),
        ...(sizeVals.length > 0 && {
          size: {
            ...(resolved.directives.sizeMetric !== undefined && {
              metric: resolved.directives.sizeMetric,
            }),
            min: sizeMin,
            max: sizeMax,
          },
        }),
        ...(weightVals.length > 0 && {
          weight: { min: wMin, max: wMax },
        }),
      };
    }
  }

  return {
    width,
    height,
    background: water,
    title: resolved.title,
    ...(resolved.subtitle !== undefined && { subtitle: resolved.subtitle }),
    ...(resolved.caption !== undefined && { caption: resolved.caption }),
    regions,
    legs,
    pois,
    labels,
    pinList,
    legend,
    insets,
  };
}
