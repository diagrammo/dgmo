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
  geoConicEqualArea,
  geoMercator,
  type GeoProjection,
  type GeoPath,
} from 'd3-geo';
import { feature } from 'topojson-client';
import { mix, shapeFill } from '../palettes/color-utils';
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
// Rivers are thin lines over land, so they need a more saturated blue than the
// flat ocean/lake fill to stay legible against the green land.
const RIVER_TINT = 88; // % palette-blue of bg for river centerlines
const RIVER_WIDTH = 1.3; // px stroke width for river lines
// % palette-gray of bg for non-US neighbour land. Higher on dark so it reads as
// a clear gray rather than sinking into the dark background.
const FOREIGN_TINT_LIGHT = 30;
const FOREIGN_TINT_DARK = 62;
const COLO_R = 9; // spiderfy radius
const GOLDEN_ANGLE = 2.399963229728653; // rad (137.5deg) -- even spiral, no random
const FAN_STEP = 16; // px perpendicular offset between parallel edges
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

/** A framed inset "cutout" (albers-usa AK/HI), in screen px. The frame is a
 *  quad whose TOP edge is angled to ride just under the conus southern coast,
 *  so a tall box can claim the deep lower-left water without covering AZ/TX.
 *  `points` are the four corners (top-left, top-right, bottom-right,
 *  bottom-left); `x/y/w/h` is the bounding box (legend-collision math + a
 *  rectangular fallback). */
export interface MapLayoutInset {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly points: ReadonlyArray<readonly [number, number]>;
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
  /** Halo/outline colour — the OPPOSITE lightness of `color`, so the text reads
   *  whether it sits on its fill or overflows onto a different-coloured area. */
  readonly haloColor: string;
  /** Render inside a solid rounded badge (state abbrev labels) vs plain haloed
   *  text (POI labels). The badge colours come from `badgeFill`/`color`. */
  readonly badge: boolean;
  readonly badgeFill?: string;
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

/** A drawn river centerline — an open stroked path (no fill). */
export interface MapLayoutRiver {
  readonly d: string;
  readonly color: string;
  readonly width: number;
}

export interface MapLayout {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly title: string | null;
  readonly subtitle?: string;
  readonly caption?: string;
  readonly regions: readonly MapLayoutRegion[];
  /** Major river centerlines, drawn over land/lakes and under POIs/edges. */
  readonly rivers: readonly MapLayoutRiver[];
  readonly legs: readonly MapLayoutLeg[];
  readonly pois: readonly MapLayoutPoi[];
  readonly labels: readonly PlacedLabel[];
  /** Numbered-pin fallback legend list (pin -> label). */
  readonly pinList: ReadonlyArray<{ pin: number; label: string }>;
  readonly legend: MapLayoutLegend | null;
  /** Framed AK/HI inset cutouts (albers-usa only; empty otherwise). */
  readonly insets: readonly MapLayoutInset[];
  /** AK/HI region paths drawn inside the inset boxes (foreground, over an
   *  opaque ocean fill). Paired positionally with `insets`. */
  readonly insetRegions: readonly MapLayoutRegion[];
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

// Our own US map (replaces d3 geoAlbersUsa, whose fixed composite clips
// Canada/Mexico to hard lines and bakes in inset boxes we can't control). A
// plain Albers conic for the contiguous 48 — it does NOT clip, so neighbour land
// projects naturally and bleeds off the canvas edges. Alaska & Hawaii are drawn
// as our own insets with the dedicated projections below.
const usConusProjection = (): GeoProjection =>
  geoConicEqualArea().parallels([29.5, 45.5]).rotate([96, 0]);
const alaskaProjection = (): GeoProjection =>
  geoConicEqualArea().rotate([154, 0]).center([-2, 58.5]).parallels([55, 65]);
const hawaiiProjection = (): GeoProjection => geoMercator();

function projectionFor(family: ProjectionFamily): GeoProjection {
  switch (family) {
    case 'albers-usa':
      return usConusProjection();
    case 'mercator':
      return geoMercator();
    case 'natural-earth':
    default:
      return geoNaturalEarth1();
  }
}

/** US state ISO codes that render as insets (drawn off the conus). */
const INSET_STATES = new Set(['US-AK', 'US-HI']);
/** US territories excluded from the contiguous-US fit frame. */
const US_NON_CONUS = new Set([
  'US-AK',
  'US-HI',
  'US-AS',
  'US-GU',
  'US-MP',
  'US-PR',
  'US-VI',
]);

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

  // Land is a muted green; the ocean/backdrop is blue. Scored/tagged regions
  // paint over the land base, and the score ramp blends FROM the land colour so
  // low scores stay land-toned rather than fading out. In a US view the world
  // layer is just neighbour context (Mexico/Canada at the frame edge) — fill it
  // gray so the green US reads as the subject; world maps (no us-states layer)
  // keep green land for every country.
  const landTint = isDark ? LAND_TINT_DARK : LAND_TINT_LIGHT;
  const neutralFill = mix(palette.colors.green, palette.bg, landTint);
  const water = mapBackgroundColor(palette);
  const usContext = usLayer !== null;
  const foreignFill = mix(
    palette.colors.gray,
    palette.bg,
    isDark ? FOREIGN_TINT_DARK : FOREIGN_TINT_LIGHT
  );
  // Region borders: a clearly dark outline in BOTH themes. palette.text flips
  // (dark on light, light on dark), so mix toward whichever of text/bg is the
  // dark one — never a light hairline over the land fills.
  const regionStroke = isDark
    ? mix(palette.bg, palette.text, 78) // dark theme: near-bg dark outline
    : mix(palette.text, palette.bg, 78); // light theme: near-text dark outline

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

  // Score ramp base: a NEUTRAL tint of the page, NOT the (green) land colour —
  // blending red toward green produced muddy brown mid-tones that blurred into
  // the unscored land. Anchored to a neutral, the ramp is a clean single-hue red
  // scale (light → deep) distinct from the green base. On dark, lift the anchor
  // off the near-black surface so the lowest scores read as a clear muted red
  // rather than sinking to maroon-black.
  const rampBase = isDark ? mix(palette.surface, palette.text, 28) : palette.bg;
  const fillForScore = (s: number): string => {
    const t = rampMax > rampMin ? (s - rampMin) / (rampMax - rampMin) : 1;
    const pct = RAMP_FLOOR + Math.max(0, Math.min(1, t)) * (100 - RAMP_FLOOR);
    return mix(rampHue, rampBase, pct);
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
  // For world projections we fit to the resolver's (padded, never-degenerate)
  // extent box — fitting to raw drawn points would collapse to a zero-size
  // target (single/coincident POIs → Infinity scale → NaN). albers-usa fits to
  // its own conus features (below).
  //
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
  if (resolved.projection === 'albers-usa' && usLayer) {
    // Frame the contiguous 48 + DC (insets/territories excluded). The conic
    // projects everything else — Canada, Mexico — around it, bleeding off the
    // canvas edges so there's no empty water band and no hard clip line.
    fitFeatures = [...usLayer.entries()]
      .filter(([iso]) => !US_NON_CONUS.has(iso))
      .map(([, f]) => f);
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
  const fitBox: [[number, number], [number, number]] = [
    [FIT_PAD, topPad],
    [
      Math.max(FIT_PAD + 1, width - FIT_PAD),
      Math.max(topPad + 1, height - FIT_PAD),
    ],
  ];
  projection.fitExtent(fitBox, fitTarget as never);
  const path: GeoPath = geoPath(projection);
  const project = (lon: number, lat: number): [number, number] | null =>
    projection([lon, lat]) ?? null;

  // -- Alaska & Hawaii insets (our own, replacing geoAlbersUsa's fixed boxes) --
  // The conus conic projects AK/HI to their real positions (far off-frame), so
  // they're culled from the main layer; instead each is drawn in its own framed
  // box in the lower-left with a dedicated projection fit to that box. Inset
  // region paths (computed here, in inset-projection screen coords) are appended
  // to `regions` so the renderer draws them like any other region.
  const insets: MapLayoutInset[] = [];
  const insetRegions: MapLayoutRegion[] = [];
  // Seeds for AK/HI labels (centroid in inset-projection coords) — turned into
  // PlacedLabels in the labels section so they share the badge styling.
  const insetLabelSeeds: {
    x: number;
    y: number;
    iso: string;
    name: string;
    lineNumber: number;
  }[] = [];
  if (resolved.projection === 'albers-usa' && usLayer) {
    const PAD = 8;
    const GAP = 12; // px the top edge rides below the coast
    const MAX_H = height * 0.42; // box height cap
    const MIN_H = 70; // box height floor
    const yB = height - FIT_PAD; // box bottom (shared by both insets)
    // Southern-coast profile: the lowest (max-y) projected vertex of any conus
    // state per x-column. One pass over the real polygon vertices — accurate
    // even where a bounding box would lie (Texas's diagonal Rio Grande border
    // puts its bbox bottom at Brownsville, far south of the El Paso coast).
    const ceil = yB - MAX_H; // open-ocean columns may rise to here
    const BW = 4; // x-bucket width (px)
    const coast = new Map<number, number>(); // bucket → southern-most y
    const addPt = (lon: number, lat: number): void => {
      const p = projection([lon, lat]);
      if (!p) return;
      const bi = Math.floor(p[0] / BW);
      const cur = coast.get(bi);
      if (cur === undefined || p[1] > cur) coast.set(bi, p[1]);
    };
    const walk = (co: unknown): void => {
      if (Array.isArray(co) && typeof co[0] === 'number') {
        addPt(co[0] as number, co[1] as number);
      } else if (Array.isArray(co)) for (const c of co) walk(c);
    };
    for (const [iso, f] of usLayer) {
      if (US_NON_CONUS.has(iso)) continue;
      walk((f.geometry as { coordinates?: unknown }).coordinates);
    }
    // South coast at x (checks neighbour buckets); ceil over open ocean.
    const at = (x: number): number => {
      const bi = Math.floor(x / BW);
      let y = -Infinity;
      for (let k = bi - 1; k <= bi + 1; k++) {
        const v = coast.get(k);
        if (v !== undefined && v > y) y = v;
      }
      return y === -Infinity ? ceil : y;
    };
    // One straight top edge across [x0, xr]: slope from the endpoints, then the
    // whole line pushed down until it clears the sampled coast (+GAP). The result
    // is always a single straight segment — it just sits below the coast.
    const topLine = (boxX: number, w: number, maxH: number) => {
      const xr = boxX + w;
      const clamp = (y: number): number =>
        Math.min(Math.max(y, yB - maxH), yB - MIN_H);
      const slope = xr > boxX ? (at(xr) - at(boxX)) / (xr - boxX) : 0;
      let b = at(boxX); // intercept of the endpoint line at boxX
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const x = boxX + ((xr - boxX) * i) / n;
        const need = at(x) - slope * (x - boxX);
        if (need > b) b = need;
      }
      return {
        x0: boxX,
        xr,
        yL: clamp(b + GAP),
        yR: clamp(slope * (xr - boxX) + b + GAP),
      };
    };
    // AK gets the big box (the state is big); HI a modest one.
    const akW = Math.max(150, width * 0.2);
    const hiW = Math.max(110, width * 0.16);
    const akLine = topLine(FIT_PAD, akW, height * 0.42);
    const hiLine = topLine(FIT_PAD + akW + 14, hiW, height * 0.26);
    const drawInset = (
      iso: string,
      proj: GeoProjection,
      line: { x0: number; xr: number; yL: number; yR: number }
    ): void => {
      const f = usLayer.get(iso);
      if (!f) return;
      const { x0, xr, yL, yR } = line;
      // State fits below the LOWER top corner so the slope never clips it.
      const topFit = Math.max(yL, yR);
      proj.fitExtent(
        [
          [x0 + PAD, topFit + PAD],
          [xr - PAD, yB - PAD],
        ],
        f as never
      );
      const d = geoPath(proj)(f as never) ?? '';
      if (!d) return;
      const r = regionById.get(iso);
      let fill = neutralFill;
      let lineNumber = -1;
      if (r?.layer === 'us-state') {
        if (r.score !== undefined) fill = fillForScore(r.score);
        else fill = tagFill(r.tags, activeGroup) ?? neutralFill;
        lineNumber = r.lineNumber;
      }
      insets.push({
        x: x0,
        y: Math.min(yL, yR),
        w: xr - x0,
        h: yB - Math.min(yL, yR),
        points: [
          [x0, yL],
          [xr, yR],
          [xr, yB],
          [x0, yB],
        ],
      });
      insetRegions.push({
        id: iso,
        d,
        fill,
        stroke: regionStroke,
        lineNumber,
        layer: 'us-state',
      });
      const ctr = geoPath(proj).centroid(f as never);
      if (Number.isFinite(ctr[0])) {
        const name = (f.properties as { name?: string } | null)?.name ?? iso;
        insetLabelSeeds.push({ x: ctr[0], y: ctr[1], iso, name, lineNumber });
      }
    };
    drawInset('US-AK', alaskaProjection(), akLine);
    drawInset('US-HI', hawaiiProjection(), hiLine);
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
      // Alaska/Hawaii are drawn as insets under albers-usa — skip them in the
      // main conus layer (the conic would otherwise place them far off-frame).
      if (layerKind === 'us-state' && usContext && INSET_STATES.has(iso))
        continue;
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
  // US-states layer (cull off-view; AK/HI are handled as insets above).
  if (usLayer) pushRegionLayer(usLayer, 'us-state', !isGlobalView);
  // NOTE: insetRegions (AK/HI) are returned SEPARATELY so the renderer can draw
  // them in the foreground over an opaque box — drawn inline here they'd sit
  // behind neighbour land (Mexico) showing through the inset.

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

  // Rivers (Amazon, Nile, Mississippi, …) as thin water lines over the land.
  // Open paths: stroked, no fill. Drawn over lakes but under POIs/edges/labels.
  const riverColor = mix(palette.colors.blue, palette.bg, RIVER_TINT);
  const rivers: MapLayoutRiver[] = [];
  if (data.rivers) {
    for (const [, f] of decodeLayer(data.rivers)) {
      const viewF = isGlobalView ? f : cullFeatureToView(f);
      if (!viewF) continue;
      const d = path(viewF as never) ?? '';
      if (!d) continue;
      rivers.push({ d, color: riverColor, width: RIVER_WIDTH });
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

  // Region labels (default off). Each abbrev sits in a solid rounded BADGE —
  // dark backing + light text — so it reads consistently on any fill colour. A
  // label is shown only when its badge fits inside the region (small states like
  // the NE cluster auto-hide rather than overlap / spill onto the ocean).
  const regionLabelMode = resolved.directives.regionLabels ?? 'off';
  const BADGE_PADX = 6;
  const BADGE_PADY = 3;
  const badgeW = (text: string): number =>
    measureLegendText(text, FONT) + 2 * BADGE_PADX;
  const badgeH = FONT + 2 * BADGE_PADY;
  const pushBadge = (
    x: number,
    y: number,
    text: string,
    lineNumber: number
  ): void => {
    labels.push({
      x,
      y,
      text,
      anchor: 'middle',
      color: palette.textOnFillLight,
      halo: false,
      haloColor: palette.textOnFillDark,
      badge: true,
      badgeFill: palette.textOnFillDark,
      lineNumber,
    });
  };
  if (regionLabelMode === 'full' || regionLabelMode === 'abbrev') {
    for (const r of regions) {
      if (r.layer === 'base' || r.label === undefined) continue;
      const f =
        r.layer === 'us-state' ? usLayer?.get(r.id) : worldLayer.get(r.id);
      if (!f) continue;
      const [[x0, y0], [x1, y1]] = path.bounds(f as never);
      const text =
        regionLabelMode === 'abbrev' ? r.id.replace(/^US-/, '') : r.label;
      // Hide if the badge wouldn't fit inside the region's footprint.
      if (badgeW(text) > x1 - x0 || badgeH > y1 - y0) continue;
      const c = path.centroid(f as never);
      if (!Number.isFinite(c[0])) continue;
      pushBadge(c[0], c[1], text, r.lineNumber);
    }
    // AK/HI labels live in their insets (own projection centroids).
    for (const seed of insetLabelSeeds) {
      const text =
        regionLabelMode === 'abbrev' ? seed.iso.replace(/^US-/, '') : seed.name;
      pushBadge(seed.x, seed.y, text, seed.lineNumber);
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
      // Inline placement: prefer the right of the marker, but flip to the left
      // when the right would run OFF-CANVAS (a coastal POI near the edge). A mere
      // collision still escalates (the ring already tries left, with a leader).
      const placeInline = (side: 'right' | 'left'): boolean => {
        const tx = side === 'right' ? p.cx + p.r + 3 : p.cx - p.r - 3;
        const rect: LabelRect = {
          x: side === 'right' ? tx : tx - w,
          y: p.cy - h / 2,
          w,
          h,
        };
        if (rect.x < 0 || rect.x + rect.w > width) return false; // off-canvas
        if (collides(rect)) return false;
        obstacles.push(rect);
        labels.push({
          x: tx,
          y: p.cy + FONT / 3,
          text,
          anchor: side === 'right' ? 'start' : 'end',
          color: palette.text,
          halo: true,
          haloColor: palette.bg,
          badge: false,
          lineNumber: p.lineNumber,
        });
        return true;
      };
      const rightFitsCanvas = p.cx + p.r + 3 + w <= width;
      if (rightFitsCanvas) {
        if (placeInline('right')) continue;
      } else if (placeInline('left')) {
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
            haloColor: palette.bg,
            badge: false,
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
        haloColor: palette.bg,
        badge: false,
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
            base: rampBase,
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
    rivers,
    legs,
    pois,
    labels,
    pinList,
    legend,
    insets,
    insetRegions,
  };
}
