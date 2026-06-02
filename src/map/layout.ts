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
  geoEquirectangular,
  geoConicEqualArea,
  geoMercator,
  geoBounds,
  geoTransform,
  type GeoProjection,
  type GeoPath,
} from 'd3-geo';
import { feature } from 'topojson-client';
import { mix, contrastRatio, relativeLuminance } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes/types';
import {
  rectsOverlap,
  rectCircleOverlap,
  segmentRectOverlap,
} from '../label-layout';
import type { LabelRect, PointCircle } from '../label-layout';
import { measureLegendText } from '../utils/legend-constants';
import { TITLE_FONT_SIZE, TITLE_Y } from '../utils/title-constants';
import { makeDgmoError } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { BoundaryTopology } from './data/types';
import type {
  MapData,
  ResolvedMap,
  ResolvedPoi,
  ResolvedEdge,
  ProjectionFamily,
} from './resolved-types';
import { resolveSurfaceBow } from './surface-route';
import { placeContextLabels } from './context-labels';
import type { CountryCandidate } from './context-labels';
import type { DecodedFeature } from './geo';

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
// WCAG ratio below which a region label needs a halo to read on its own fill.
// 4.5 = AA for normal text; mid-tone choropleth fills fall below this and get
// the rescue halo, while saturated/pastel fills (Texas, light land) clear it.
const REGION_LABEL_HALO_RATIO = 4.5;
const COLO_EPS = 1.5; // px: POIs closer than this are "co-located"
// % palette-green of bg for unscored land — a VERY faded green so every map
// (plain reference OR data-coloured) wears the same subtle dress and the green
// never competes with saturated tag/score tints. Dark lifts a touch off the
// near-black surface so the faint green stays legible.
const LAND_TINT_LIGHT = 12;
const LAND_TINT_DARK = 24;
// Categorical (tag) region fill: a flat, fairly saturated tint of the tag
// colour so a tagged region reads as its CATEGORY against the tinted land base
// — the generic 25% shape tint washes out and lets the olive land dominate.
const TAG_TINT_LIGHT = 60;
const TAG_TINT_DARK = 68;
// % palette-blue of bg for the ocean / backdrop — a VERY faded blue, matching
// the land's subtlety so the whole basemap reads as a quiet dress under the data.
const WATER_TINT_LIGHT = 13;
const WATER_TINT_DARK = 14;
const RIVER_WIDTH = 1.3; // px stroke width for river lines
// Relief (mountain-range shading). A projected range below this px² area is
// dropped (no confetti slivers at world zoom).
const RELIEF_MIN_AREA = 12; // px²
// Each projected bbox side must clear this — drop near-degenerate slivers.
const RELIEF_MIN_DIM = 2; // px
// Relief = horizontal hachure lines clipped to each range: a subtle
// dark-on-light / light-on-dark texture that reads as "mountains here". Spacing
// is SCREEN-space so density is constant regardless of zoom (geo-space spacing
// would collapse a small range to 1–2 lines and read as a glitch). Kept FAINT:
// thin sub-pixel lines drawn with a non-scaling stroke (constant device width at
// any zoom/DPR) and low-contrast colour. NOT crispEdges — that snaps the stroke
// to a solid ~1px in WebKit and reads far too heavy; plain AA keeps them whisper-thin.
const RELIEF_HATCH_SPACING = 2; // px between lines
const RELIEF_HATCH_WIDTH = 0.15; // px stroke
// % of the DARK reference (palette.bg on dark themes, palette.text on light)
// blended into the land colour — so the lines read DARKER than the land in both
// themes (palette.text alone flips to light on dark themes).
const RELIEF_HATCH_STRENGTH = 32;
// Coastline water-lines (opt-in `coastline`, §24B.2). N equal-width coast-parallel
// rings on the water side, evenly spaced and FADING seaward — the antique
// nautical-chart depth-contour look. Offshore distances + thickness are
// SCREEN-space FRACTIONS of min(w,h) so the rings stay a constant fraction of the
// canvas at ANY export size and ANY geographic extent (a decorative screen-space
// cue, not a geographic offset — ADR-3). Tuned faint, water-toned, low-contrast.
// minExtent = per-subpath island floor (drop tiny islands; bounds the stroke cost
// on world maps — R5/R11).
// INVARIANT (load-bearing): COASTLINE_STEP > COASTLINE_THICKNESS — i.e. every
// ring's d_k + thickness < d_(k+1). The renderer draws outer→inner; ring k's
// colour band reaches radius d_k+thickness and its flat-water overdraw reaches
// d_k. If a ring's band reached the next ring out, the inner overdraw would erase
// it. Keep step > thickness; a layout test pins it (map-layout.test.ts).
const COASTLINE_RING_COUNT = 5; // discrete coast-parallel rings
const COASTLINE_D0 = 0.0016; // innermost ring offshore distance (frac of min dim)
const COASTLINE_STEP = 0.0028; // spacing between rings (frac of min dim)
const COASTLINE_THICKNESS = 0.0014; // ring width — SAME for every ring (frac)
const COASTLINE_OPACITY_NEAR = 0.5; // innermost ring opacity
const COASTLINE_OPACITY_FAR = 0.1; // outermost ring opacity (gradual fade)
const COASTLINE_MIN_EXTENT = 0.004; // ring bbox extent floor (frac of min dim)
const COASTLINE_MIN_EXTENT_GLOBAL = 0.006; // tighter floor at world zoom
// Water-line tone: mix regionStroke into water. LESS water than `lakeStroke`
// (mix 45) so the offshore lines carry a touch MORE contrast than the existing
// coast stroke and stay distinguishable from it (R10/F14).
const COASTLINE_STROKE_MIX = 32;
// % palette-gray of bg for non-US neighbour land. Higher on dark so it reads as
// a clear gray rather than sinking into the dark background.
const FOREIGN_TINT_LIGHT = 30;
const FOREIGN_TINT_DARK = 62;
// MUTED basemap — used when a colouring dimension (score ramp or a tag group) is
// active. The subject water + land are ALWAYS the same faded blue/green dress
// (WATER_TINT_* / LAND_TINT_*); muted only pushes NEIGHBOUR land to a recessive
// gray so the subject country reads as the subject and the data fills own the
// saturation. Plain reference maps keep neighbour land at the fuller gray tint.
const MUTED_FOREIGN_LIGHT = 28; // neighbour land — recessive gray, not green
const MUTED_FOREIGN_DARK = 16;
const COLO_R = 9; // spiderfy radius
const GOLDEN_ANGLE = 2.399963229728653; // rad (137.5deg) -- even spiral, no random
const FAN_STEP = 16; // px perpendicular offset between parallel edges
const ARC_CURVE_FRAC = 0.18; // default arc bow as a fraction of leg length

export interface MapLayoutRegion {
  readonly id: string; // iso
  readonly d: string; // SVG path data
  readonly fill: string;
  readonly stroke: string;
  readonly label?: string;
  readonly lineNumber: number;
  readonly layer: 'base' | 'country' | 'us-state';
  /** The region's value (if any) — emitted as `data-value` so the app can
   *  highlight by gradient-scrub proximity. */
  readonly value?: number;
  /** The region's tag values keyed by group (lowercased) — emitted as
   *  `data-tag-<group>` so the app can highlight on legend-entry hover. */
  readonly tags?: Readonly<Record<string, string>>;
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
  /** The FITTED inset projection (fit to this frame's screen box inside
   *  `placeInset`). Load-bearing for pixel↔lonLat over the AK/HI insets: the
   *  un-fitted `alaskaProjection()`/`hawaiiProjection()` factories would invert
   *  to garbage, so the geo-query inverts against THIS instance. */
  readonly projection: GeoProjection;
}

/** Post-projection non-uniform stretch applied to GLOBAL fits (fill-the-canvas).
 *  `null` for regional fits. The geo-query applies the forward form when
 *  projecting and the inverse before `projection.invert`. Mirrors the `stretch`
 *  closure used for the path stream:  px = ox + (x - bx0) * sx. */
export interface MapLayoutStretch {
  readonly sx: number;
  readonly sy: number;
  readonly ox: number;
  readonly oy: number;
  readonly bx0: number;
  readonly by0: number;
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
  /** Tag values keyed by lowercased group name — emitted as `data-tag-<group>`
   *  so the app can spotlight markers on legend-entry hover (mirrors regions). */
  readonly tags?: Readonly<Record<string, string>>;
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
  /** Text colour for the label — contrast-picked against the background fill the
   *  label sits on (the choropleth/tag region under it, or land/water), so a
   *  freight tag over a dark scored country reads light, over pale land reads
   *  dark. Absent ⇒ renderer falls back to the muted default. */
  readonly labelColor?: string;
  /** Whether the label needs a halo. Only set when the chosen text colour's
   *  contrast against the underlying fill is marginal (mid-tone fills); clear
   *  fills get no ghost. */
  readonly labelHalo?: boolean;
  /** Halo colour (opposite lightness of `labelColor`) when {@link labelHalo}. */
  readonly labelHaloColor?: string;
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
  readonly leader?: { x1: number; y1: number; x2: number; y2: number };
  /** Leader-line colour — the POI's own marker colour, so a called-out label
   *  reads as belonging to its dot. Falls back to a neutral grey when absent. */
  readonly leaderColor?: string;
  /** The POI this label belongs to (POI labels only) — emitted as `data-poi` on
   *  the label + leader so the app can spotlight the dot on label hover. */
  readonly poiId?: string;
  /** Cartographic italic (context-label water names, §24B). Default upright. */
  readonly italic?: boolean;
  /** Cartographic letter-spacing in px (context-label water names). Default 0. */
  readonly letterSpacing?: number;
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
}

/** A drawn river centerline — an open stroked path (no fill). */
export interface MapLayoutRiver {
  readonly d: string;
  readonly color: string;
  readonly width: number;
}

/** A drawn mountain-range relief shape — a projected polygon path. The renderer
 *  unions these into one clip and rules horizontal hachure lines through them. */
export interface MapLayoutRelief {
  readonly d: string;
}

/** The shared hachure style for the relief lines. `null` when relief is off or
 *  no range survives the gates. */
export interface MapLayoutReliefHatch {
  /** Line stroke — palette.text mixed into the land colour (so it's dark-on-
   *  light and light-on-dark automatically as palette.text flips with theme). */
  readonly color: string;
  /** Vertical gap between lines in SCREEN px (constant density, zoom-stable). */
  readonly spacing: number;
  readonly width: number;
}

/** Style object for the opt-in coastline water-lines (`coastline`, §24B.2).
 *  `null` when the flag is off. Carries only STYLE — no geometry; the renderer
 *  buffers the existing region paths (`layout.regions[].d`) and masks them to the
 *  water side. `d`/`thickness` are absolute SCREEN px (already resolved from a
 *  fraction of the fitted canvas, so they stay proportional across export sizes —
 *  ADR-3). */
export interface MapLayoutCoastlineStyle {
  /** Water-toned line colour (a touch more contrast than `lakeStroke`). */
  readonly color: string;
  /** The 2 coast-parallel lines, inner→outer. `d` = offshore distance,
   *  `thickness` = ring width (both screen px), `opacity` fades seaward. */
  readonly lines: ReadonlyArray<{
    readonly d: number;
    readonly thickness: number;
    readonly opacity: number;
  }>;
  /** Per-subpath bbox-extent floor (screen px): rings smaller than this are
   *  dropped (de-noise tiny islands, bound the stroke cost — R5/R11). */
  readonly minExtent: number;
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
  /** Mountain-range relief shapes (empty unless `relief` is on + the asset is
   *  present); the renderer clips horizontal hachure lines to their union,
   *  drawn over base land, under rivers/POIs/data fills. */
  readonly relief: readonly MapLayoutRelief[];
  /** Hachure style for the relief lines (null = relief off / none survived). */
  readonly reliefHatch: MapLayoutReliefHatch | null;
  /** Style for the opt-in coastline water-lines (null = `coastline` off). The
   *  renderer buffers `regions[]`/`insetRegions[]` paths against this style and
   *  masks them to the water side. */
  readonly coastlineStyle: MapLayoutCoastlineStyle | null;
  readonly legs: readonly MapLayoutLeg[];
  readonly pois: readonly MapLayoutPoi[];
  readonly labels: readonly PlacedLabel[];
  readonly legend: MapLayoutLegend | null;
  /** Framed AK/HI inset cutouts (albers-usa only; empty otherwise). */
  readonly insets: readonly MapLayoutInset[];
  /** AK/HI region paths drawn inside the inset boxes (foreground, over an
   *  opaque ocean fill). Paired positionally with `insets`. */
  readonly insetRegions: readonly MapLayoutRegion[];
  /** The fitted MAIN projection (the conus conic for albers-usa). Exposed for
   *  the geo-query's pixel↔lonLat inversion — the app NEVER reconstructs it from
   *  metadata; it binds to this exact instance. */
  readonly projection: GeoProjection;
  /** Non-uniform stretch applied for GLOBAL fits (null for regional fits). */
  readonly stretch: MapLayoutStretch | null;
  /** Diagnostics raised during layout — currently only best-effort surface-route
   *  warnings (W_MAP_SURFACE_UNSATISFIED). Empty when nothing fired. Callers
   *  merge these with the resolver's diagnostics for the editor lint channel. */
  readonly diagnostics: readonly DgmoError[];
}

export interface LayoutOptions {
  readonly palette: PaletteColors;
  readonly isDark: boolean;
  /** Live override of the active colouring group (the score ramp or a tag
   *  group). Highest priority — beats the `active-tag` directive. The app's
   *  interactive legend flip passes this; `'score'` (or the metric label)
   *  selects the choropleth ramp, a tag-group name selects that group, `'none'`
   *  / `null` clears it. `undefined` = not provided (use the directive/default). */
  readonly activeGroup?: string | null;
  /** Export-only: when true, suppress the global stretch-fill and contain-fit
   *  (letterbox) instead. Set by `mapExportDimensions` when it clamps/floors the
   *  canvas away from the content aspect, so the off-aspect canvas doesn't
   *  re-distort. The in-app preview pane leaves this unset (keeps stretch-fill). */
  readonly preferContain?: boolean;
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

// Cache the (expensive) topojson→GeoJSON decode by topology object identity. The
// MapData topology objects are stable within a session, so the same layer is
// decoded once even though the export path now builds the projection twice (once
// for dimension sizing, once for layout). Keyed by object identity (WeakMap), so
// it never holds stale data across a data reload. CALLERS MUST TREAT THE RESULT AS
// IMMUTABLE — `buildMapProjection` copies the world layer before its crisp-upgrade
// `.set()` so the cached map is never mutated.
const decodeCache = new WeakMap<BoundaryTopology, Map<string, GeoFeature>>();

/** Decode every feature of a topology into GeoJSON, keyed by ISO id. Memoized by
 *  topology identity — the returned map is shared, so do NOT mutate it (copy first
 *  if you need to). */
function decodeLayer(topo: BoundaryTopology): Map<string, GeoFeature> {
  const cached = decodeCache.get(topo);
  if (cached) return cached;
  const out = new Map<string, GeoFeature>();
  for (const g of geomObject(topo).geometries) {
    const f = feature(topo as never, g as never) as unknown as GeoFeature;
    out.set(g.id, { ...f, id: g.id });
  }
  decodeCache.set(topo, out);
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
      return geoNaturalEarth1();
    case 'equirectangular':
    default:
      // Plate carrée: x = λ, y = -φ. Cylindrical, so the extent's four CORNERS
      // are its projected extremes — fitExtent frames it edge-to-edge with no
      // bulge overflow (unlike naturalEarth, whose curved sides overrun a
      // corner fit and clip the continents). Fills the rectangle: no rounded
      // gray corners, no split landmass at the frame edge.
      return geoEquirectangular();
  }
}

/** US state ISO codes that render as insets (drawn off the conus). */
const INSET_STATES = new Set(['US-AK', 'US-HI']);
// Rough bboxes deciding whether a point sits in Alaska / Hawaii — the AK/HI
// insets render only when the map references that state (§24B.2). Alaska's
// Aleutians cross the antimeridian, so its longitude test is two-sided.
const inAlaska = (lon: number, lat: number): boolean =>
  lat >= 51 && (lon <= -129 || lon >= 172);
const inHawaii = (lon: number, lat: number): boolean =>
  lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154;
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
 *  match it (so letterbox gaps around the SVG don't show a stray band). Always a
 *  VERY faded blue — uniform whether or not a colouring dimension is active — so
 *  it reads as water without competing with saturated blue/green data hues.
 *  `_dataActive` is retained for signature stability (the sea no longer changes
 *  with data; only neighbour land recedes — see layout's `foreignFill`). */
export function mapBackgroundColor(
  palette: PaletteColors,
  isDark = false,
  _dataActive = false
): string {
  return mix(
    palette.colors.blue,
    palette.bg,
    isDark ? WATER_TINT_DARK : WATER_TINT_LIGHT
  );
}

/** The map's neutral (unscored/untagged) LAND colour — the base every region
 *  blends from. Exported so a host can DIM a region to plain land (rather than
 *  lowering opacity, which would let the water show through and make the shape
 *  read as ocean). Matches the layout's `neutralFill`. Always a VERY faded green
 *  — uniform whether or not data is active — so saturated tag/score tints read
 *  clearly against it. `_dataActive` is retained for signature stability. */
export function mapNeutralLandColor(
  palette: PaletteColors,
  isDark: boolean,
  _dataActive = false
): string {
  return mix(
    palette.colors.green,
    palette.bg,
    isDark ? LAND_TINT_DARK : LAND_TINT_LIGHT
  );
}

/** Result of {@link buildMapProjection}: the (fresh, un-fitted) projection, fit
 *  target, global/regional classification, and decoded basemap layers — all
 *  derived from `(resolved, data)` alone (NOT canvas-size dependent). `layoutMap`
 *  consumes these then does the size-dependent `fitExtent` + stretch/clip;
 *  `mapContentAspect` consumes `projection`/`fitTarget` (+ the layers, for the
 *  contain-fit ink bounds). MUST be rebuilt per call — d3 projections are mutated
 *  in place by `fitExtent`/`clipExtent`, so the instance is never shared. */
export interface MapProjectionBuild {
  readonly projection: GeoProjection;
  readonly fitTarget: GeoFC;
  /** ≥270° lon or ≥130° lat span ⇒ global (stretch-fill) vs regional (contain). */
  readonly fitIsGlobal: boolean;
  readonly worldLayer: Map<string, GeoFeature>;
  readonly usLayer: Map<string, GeoFeature> | null;
  readonly usCrisp: boolean;
  readonly wantsUsStates: boolean;
}

/** Build the projection, fit target, and decoded basemap layers for a resolved
 *  map. Extracted from `layoutMap` so the export-dimension helper
 *  (`mapContentAspect`) frames the canvas with the IDENTICAL projection + fit
 *  target the renderer draws with — divergence here would mismatch the canvas
 *  aspect against the geometry. The returned projection has `.rotate` applied but
 *  NOT `.fitExtent` (that is canvas-size dependent and stays in `layoutMap`). */
export function buildMapProjection(
  resolved: ResolvedMap,
  data: MapData
): MapProjectionBuild {
  // -- Basemap decode --
  const wantsUsStates = resolved.basemaps.subdivisions.includes('us-states');
  // In a US (albers-usa + us-states) view the surrounding land was world-atlas
  // 50m/110m — visibly coarser than the 10m states. When the NA-clipped 10m
  // assets are present, swap them in so neighbours (Canada/Mexico) and the Great
  // Lakes match the states' resolution. Falls back to the world tiers otherwise.
  const usCrisp =
    resolved.projection === 'albers-usa' && wantsUsStates && !!data.naLand;
  // Base world layer. In a US view use the DETAIL tier (full global coverage) so
  // distant context — South America, northern Canada, etc. — is present and can
  // draw when it falls inside the frame.
  const worldTopo = usCrisp
    ? data.worldDetail
    : resolved.basemaps.world === 'detail'
      ? data.worldDetail
      : data.worldCoarse;
  // Copy the cached decode — the crisp-upgrade below mutates `worldLayer` via
  // `.set()`, which must not poison the shared `decodeLayer` cache.
  const worldLayer = new Map(decodeLayer(worldTopo));
  // Crisp upgrade: swap a country's geometry to the 10m `naLand` version ONLY
  // when its full (base) bounds lie inside the NA clip box.
  if (usCrisp && data.naLand) {
    const [nbW, nbS, nbE, nbN] = [-140, 10, -52, 66];
    const crisp = decodeLayer(data.naLand);
    for (const [iso, cf] of crisp) {
      const base = worldLayer.get(iso);
      if (!base) continue; // crisp-only id with no base → skip (avoid orphans)
      const [[bw, bs], [be, bn]] = geoBounds(base as never);
      if (bw >= nbW && be <= nbE && bs >= nbS && bn <= nbN)
        worldLayer.set(iso, cf);
    }
  }
  const usLayer = wantsUsStates ? decodeLayer(data.usStates) : null;

  // -- Projection + fit (AR2) --
  // The extent outline sampled as a MultiPoint (NOT a Polygon — a hand-built
  // lat/lon rectangle's spherical winding is ambiguous to d3-geo). Sampled ALONG
  // the four edges so a curved projection (natural-earth) is framed at its bulge.
  const extentOutline = (): GeoFeature => {
    const [[w, s], [e, n]] = resolved.extent;
    const N = 16;
    const coords: Array<[number, number]> = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const lon = w + (e - w) * t;
      const lat = s + (n - s) * t;
      coords.push([lon, s], [lon, n], [w, lat], [e, lat]);
    }
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPoint', coordinates: coords },
    };
  };

  let fitFeatures: GeoFeature[];
  if (resolved.projection === 'albers-usa' && usLayer) {
    // Frame the contiguous 48 + DC (insets/territories excluded). The conic
    // projects everything else around it.
    fitFeatures = [...usLayer.entries()]
      .filter(([iso]) => !US_NON_CONUS.has(iso))
      .map(([, f]) => f);
    // Expand the frame to include referenced Canada/Mexico content so a
    // near-border neighbour (e.g. Toronto) is visible rather than bleeding off
    // the canvas edge. Only CA/MX content can reach this branch (the resolver's
    // NA rule), so the frame can only grow toward those neighbours. AK/HI POIs
    // stay insets — excluded here. Content-driven: a neighbour POI adds only its
    // point (US barely shrinks); a neighbour country fill adds its full geometry.
    const neighborPoints: Array<[number, number]> = resolved.pois
      .filter((p) => !inAlaska(p.lon, p.lat) && !inHawaii(p.lon, p.lat))
      .map((p) => [p.lon, p.lat]);
    if (neighborPoints.length > 0) {
      fitFeatures.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPoint', coordinates: neighborPoints },
      });
    }
    for (const r of resolved.regions) {
      if (r.layer === 'country' && (r.iso === 'CA' || r.iso === 'MX')) {
        const cf = worldLayer.get(r.iso);
        if (cf) fitFeatures.push(cf);
      }
    }
  } else {
    fitFeatures = [extentOutline()];
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

  // Global vs regional classification (drives stretch-fill vs contain-fit).
  const fitGB = geoBounds(fitTarget as never) as [
    [number, number],
    [number, number],
  ];
  const fitIsGlobal =
    fitGB[1][0] - fitGB[0][0] >= 270 || fitGB[1][1] - fitGB[0][1] >= 130;

  return {
    projection,
    fitTarget,
    fitIsGlobal,
    worldLayer,
    usLayer,
    usCrisp,
    wantsUsStates,
  };
}

/** Split a projected geoPath `d` into its subpath rings (point arrays). geoPath
 *  emits polygons as straight `M`/`L`/`Z` segments (no curves), so a flat parse
 *  is exact. Each ring is one subpath (an outer boundary OR a hole); classify
 *  outer-vs-hole downstream (e.g. via containment depth or signed area). Used by
 *  fill hit-testing here and by the renderer's coastline water-lines. */
export function parsePathRings(d: string): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  const re = /([MLZ])([^MLZ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[1] === 'Z') {
      if (cur.length) rings.push(cur);
      cur = [];
      continue;
    }
    if (m[1] === 'M' && cur.length) {
      rings.push(cur);
      cur = [];
    }
    const nums = m[2]!.split(/[ ,]+/).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i]!;
      const y = nums[i + 1]!;
      if (Number.isFinite(x) && Number.isFinite(y)) cur.push([x, y]);
    }
  }
  if (cur.length) rings.push(cur);
  return rings;
}

export function layoutMap(
  resolved: ResolvedMap,
  data: MapData,
  size: Size,
  opts: LayoutOptions
): MapLayout {
  const { palette, isDark } = opts;
  const { width, height } = size;

  // -- Projection, fit target & basemap decode (shared with mapContentAspect so
  // the export canvas aspect matches the drawn geometry — see buildMapProjection).
  // The projection here has .rotate applied but NOT .fitExtent (done below, as it
  // depends on canvas width/height). --
  const { projection, fitTarget, fitIsGlobal, worldLayer, usLayer, usCrisp } =
    buildMapProjection(resolved, data);

  const usContext = usLayer !== null;
  // Basemap fills (`water` / `neutralFill` / `foreignFill`) depend on whether a
  // colouring dimension is active — defined below, once `activeGroup` is known.
  // Region borders: a clearly dark outline in BOTH themes. palette.text flips
  // (dark on light, light on dark), so mix toward whichever of text/bg is the
  // dark one — never a light hairline over the land fills.
  const regionStroke = isDark
    ? mix(palette.bg, palette.text, 78) // dark theme: near-bg dark outline
    : mix(palette.text, palette.bg, 78); // light theme: near-text dark outline
  // Lake shoreline. Lakes are painted as water OVER the land and the region
  // borders, so without an edge they read as a featureless patch that simply
  // erases whatever state/country border ran beneath them (worst in muted/data
  // mode, where the water is a pale gray barely distinct from the land). A soft
  // coastline — between the border colour and the water, not a hard black line —
  // gives the lake a defined edge; that edge legitimately REPLACES the border
  // running through it (real choropleths carve lakes out of the land, so the
  // shoreline IS the boundary at the water). Defined here; `water` is below.

  // -- Region fill model (choropleth + categorical; AR4/AR6) --
  const values = resolved.regions
    .filter((r) => r.value !== undefined)
    .map((r) => r.value!);
  const scaleOverride = resolved.directives.scale;
  const rampMin = scaleOverride ? scaleOverride.min : Math.min(...values);
  const rampMax = scaleOverride ? scaleOverride.max : Math.max(...values);
  // Value ramp defaults to red so valued regions stand out against the blue
  // water (palette.primary is a blue in most palettes and would blend in). A
  // trailing color on `region-metric` (§24B.3) overrides the hue idiomatically.
  const rampHue =
    resolveColor(resolved.directives.regionMetricColor ?? '', palette) ??
    palette.colors.red;
  const hasRamp = values.length > 0;

  // Colouring dimension (AR4, bivariate): the value ramp and each tag group are
  // mutually-exclusive selectable groups. `VALUE_NAME` is the ramp's group name
  // (the region-metric label, or "Value"). Exactly one dimension is active and
  // drives every region's fill. The value ramp is the default-active dimension
  // whenever any region has a value (the old `active-tag score` token is gone —
  // there is nothing to force; selecting a tag group is what `active-tag` does).
  const VALUE_NAME = hasRamp
    ? resolved.directives.regionMetric?.trim() || 'Value'
    : null;
  const matchColorGroup = (v: string): string | null => {
    const lv = v.trim().toLowerCase();
    if (lv === 'none') return null;
    if (lv === VALUE_NAME?.toLowerCase()) return VALUE_NAME;
    const tg = resolved.tagGroups.find((g) => g.name.toLowerCase() === lv);
    return tg ? tg.name : v; // unknown name passes through → renders neutral
  };
  const override = opts.activeGroup; // string | null | undefined
  let activeGroup: string | null;
  if (override !== undefined) {
    activeGroup = override === null ? null : matchColorGroup(override);
  } else if (resolved.directives.activeTag !== undefined) {
    activeGroup = matchColorGroup(resolved.directives.activeTag);
  } else {
    // Default: colour by the value ramp when values exist, else the first
    // declared tag group.
    activeGroup =
      VALUE_NAME ??
      (resolved.tagGroups.length > 0 ? resolved.tagGroups[0]!.name : null);
  }
  const activeIsScore = VALUE_NAME !== null && activeGroup === VALUE_NAME;

  // Basemap dress (fixed automatic aesthetic — no directive). Subject water +
  // land always wear the SAME faded blue/green dress (subtle enough that
  // saturated tag/score tints never blend into it), so every map looks
  // consistent. `mutedBasemap` governs only the NEIGHBOUR land: when a colouring
  // dimension is active the surrounding world recedes to a paler gray so the
  // subject + its data fills dominate; a plain reference map keeps neighbour
  // land at the fuller gray.
  const mutedBasemap = activeGroup !== null;
  const neutralFill = mapNeutralLandColor(palette, isDark, mutedBasemap);
  const water = mapBackgroundColor(palette, isDark, mutedBasemap);
  const lakeStroke = mix(regionStroke, water, 45); // soft coastline (see above)
  const foreignFill = mix(
    palette.colors.gray,
    palette.bg,
    mutedBasemap
      ? isDark
        ? MUTED_FOREIGN_DARK
        : MUTED_FOREIGN_LIGHT
      : isDark
        ? FOREIGN_TINT_DARK
        : FOREIGN_TINT_LIGHT
  );

  // Score ramp base: a NEUTRAL tint of the page, NOT the (green) land colour —
  // blending red toward green produced muddy brown mid-tones that blurred into
  // the unscored land. Anchored to a neutral, the ramp is a clean single-hue red
  // scale (light → deep) distinct from the green base. On dark, lift the anchor
  // off the near-black surface so the lowest scores read as a clear muted red
  // rather than sinking to maroon-black.
  const rampBase = isDark ? mix(palette.surface, palette.text, 28) : palette.bg;
  const fillForValue = (s: number): string => {
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
    // Flat saturated tint (NOT the 25% shape default) so the category reads
    // clearly over the tinted land — see TAG_TINT_*.
    return mix(
      entry.color,
      palette.bg,
      isDark ? TAG_TINT_DARK : TAG_TINT_LIGHT
    );
  };

  /** A §1.5 trailing-token color on a region/POI → flat categorical fill, the
   *  same saturated tint a tag entry gets (so direct colors and tag colors read
   *  alike). Resolves the NAME against the active palette; null if unrecognized. */
  const directFill = (name: string | undefined): string | null => {
    const hex = name ? resolveColor(name, palette) : null;
    if (!hex) return null;
    return mix(hex, palette.bg, isDark ? TAG_TINT_DARK : TAG_TINT_LIGHT);
  };

  /** A region's fill. A direct trailing color (§24B.4) is a flat override that
   *  paints regardless of the active dimension (no legend entry). Otherwise the
   *  ACTIVE colouring dimension (AR4, bivariate): value-active → ramp for valued
   *  regions, neutral otherwise; a tag group active → that group's tag colour,
   *  neutral otherwise (value ignored). */
  const regionFill = (r: {
    value?: number;
    color?: string;
    tags: Readonly<Record<string, string>>;
  }): string => {
    const direct = directFill(r.color);
    if (direct) return direct;
    if (activeIsScore) {
      return r.value !== undefined ? fillForValue(r.value) : neutralFill;
    }
    return tagFill(r.tags, activeGroup) ?? neutralFill;
  };

  const regionById = new Map(resolved.regions.map((r) => [r.iso, r]));

  // -- Fit the projection to the canvas (size-dependent; the projection + fit
  // target themselves came from buildMapProjection above). --
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

  // Global views stretch-fill the canvas. A whole-world map is ~2:1 but the
  // preview pane is often near-square, so the honest contain-fit letterboxes it
  // with large water bands. For GLOBAL extents we stretch the PROJECTED geometry
  // non-uniformly to fill both axes — countries distort (a deliberate trade for
  // a full canvas), but POI radii + label font sizes are applied in the renderer
  // (NOT here), so markers stay round and text stays un-squashed. Regional views
  // keep contain-fit: no distortion, neighbour land not cropped.
  //
  // `preferContain` (set by the export-dimension helper when it clamps/floors the
  // canvas away from the content aspect) suppresses the stretch even for a global
  // extent: the canvas was intentionally sized off-aspect, so stretching would
  // re-introduce the very distortion the content-aware sizing removes. We then
  // contain-fit (letterbox over water) instead. The in-app preview pane never
  // sets preferContain, so it keeps stretch-filling the pane. (`fitIsGlobal` comes
  // from buildMapProjection.)
  let path: GeoPath;
  let project: (lon: number, lat: number) => [number, number] | null;
  // Captured for the geo-query (null unless this is a global stretch fit).
  let stretchParams: MapLayoutStretch | null = null;
  if (fitIsGlobal && !opts.preferContain) {
    const cb = geoPath(projection).bounds(fitTarget as never);
    const bx0 = cb[0][0];
    const by0 = cb[0][1];
    const cw = cb[1][0] - bx0;
    const ch = cb[1][1] - by0;
    const ox = fitBox[0][0];
    const oy = fitBox[0][1];
    const sx = cw > 0 ? (fitBox[1][0] - ox) / cw : 1;
    const sy = ch > 0 ? (fitBox[1][1] - oy) / ch : 1;
    stretchParams = { sx, sy, ox, oy, bx0, by0 };
    const stretch = (x: number, y: number): [number, number] => [
      ox + (x - bx0) * sx,
      oy + (y - by0) * sy,
    ];
    const baseProjection = projection;
    // Post-projection non-uniform scale: baseProjection.stream projects each
    // point, then this transform stretches it before it reaches the path sink.
    const tx = geoTransform({
      point(x: number, y: number) {
        const [px, py] = stretch(x, y);
        (
          this as unknown as { stream: { point(x: number, y: number): void } }
        ).stream.point(px, py);
      },
    });
    path = geoPath({
      stream: (s: never) =>
        baseProjection.stream(
          (tx as unknown as { stream: (d: never) => never }).stream(s)
        ),
    } as never);
    project = (lon, lat) => {
      const p = baseProjection([lon, lat]);
      return p ? stretch(p[0], p[1]) : null;
    };
  } else {
    // Clip the projected geometry to the canvas. fitExtent frames the focus
    // region, but the rest of the world mesh still projects to coordinates far
    // off-canvas — invisible under our viewBox, but they bloat the SVG and,
    // critically, blow up any downstream getBBox()/bbox recompute (remark-dgmo
    // embeddings tighten the viewBox to real content bounds, which would
    // otherwise shrink the map to a dot). clipExtent trims the path `d` data to
    // the viewport so drawn content == frame. Point projection (POIs/edges,
    // albers-usa coast sampling) ignores clipExtent so positions are unaffected,
    // and the AK/HI insets use their own dedicated projection — both safe.
    projection.clipExtent([
      [0, 0],
      [width, height],
    ]);
    path = geoPath(projection);
    project = (lon, lat) => projection([lon, lat]) ?? null;
  }

  // -- Alaska & Hawaii insets (our own, replacing geoAlbersUsa's fixed boxes) --
  // The conus conic projects AK/HI to their real positions (far off-frame), so
  // they're culled from the main layer; instead each is drawn in its own framed
  // box in the lower-left with a dedicated projection fit to that box. Inset
  // region paths (computed here, in inset-projection screen coords) are appended
  // to `regions` so the renderer draws them like any other region.
  const insets: MapLayoutInset[] = [];
  const insetRegions: MapLayoutRegion[] = [];
  // Seeds for AK/HI labels (centroid in inset-projection coords) — turned into
  // PlacedLabels in the labels section so they share the region-label styling.
  const insetLabelSeeds: {
    x: number;
    y: number;
    iso: string;
    name: string;
    lineNumber: number;
  }[] = [];
  // AK/HI insets are inferred (no directive): draw a state's inset only when the
  // map references it (a valued/tagged state or a POI inside it). An all-US map
  // that names neither frames the contiguous states alone (§24B.2).
  const akRef =
    resolved.regions.some((r) => r.iso === 'US-AK') ||
    resolved.pois.some((p) => inAlaska(p.lon, p.lat));
  const hiRef =
    resolved.regions.some((r) => r.iso === 'US-HI') ||
    resolved.pois.some((p) => inHawaii(p.lon, p.lat));
  if (resolved.projection === 'albers-usa' && usLayer && (akRef || hiRef)) {
    const PAD = 8;
    const GAP = 12; // px the top edge rides below the coast
    const yB = height - FIT_PAD; // lowest a box may reach (canvas bottom pad)
    // Southern-coast profile sampled from the conus polygon VERTICES: the lowest
    // (max-y) projected vertex per x-bucket. Accurate everywhere — including
    // Texas's diagonal Rio Grande border, which a bounding box would misread.
    // Open-ocean columns (no vertex) impose NO constraint, so a box may sit there
    // freely; that lets the insets live anywhere in the lower water (no need to
    // dodge Texas) and is what keeps both boxes placeable in any aspect ratio.
    const BW = 8; // x-bucket width (px)
    const coast = new Map<number, number>();
    const addPt = (lon: number, lat: number): void => {
      const p = projection([lon, lat]);
      if (!p) return;
      const bi = Math.floor(p[0] / BW);
      const cur = coast.get(bi);
      if (cur === undefined || p[1] > cur) coast.set(bi, p[1]);
    };
    const walk = (co: unknown): void => {
      if (Array.isArray(co) && typeof co[0] === 'number')
        addPt(co[0] as number, co[1] as number);
      else if (Array.isArray(co)) for (const c of co) walk(c);
    };
    for (const [iso, f] of usLayer) {
      if (US_NON_CONUS.has(iso)) continue;
      walk((f.geometry as { coordinates?: unknown }).coordinates);
    }
    // Coast y at x, or -Infinity over open ocean (no land above → no constraint).
    const at = (x: number): number => {
      const bi = Math.floor(x / BW);
      let y = -Infinity;
      for (let k = bi - 1; k <= bi + 1; k++) {
        const v = coast.get(k);
        if (v !== undefined && v > y) y = v;
      }
      return y;
    };
    // Lowest the coast reaches across [x0, xr], or -Infinity over open ocean.
    const coastFloor = (x0: number, xr: number): number => {
      const n = 24;
      let maxY = -Infinity;
      for (let i = 0; i <= n; i++) {
        const y = at(x0 + ((xr - x0) * i) / n);
        if (y > maxY) maxY = y;
      }
      return maxY;
    };
    // A snug floating box that just contains the state, tucked up under the coast
    // with a flat top sitting GAP below the lowest the coast reaches over its
    // span. `iwReq` is the requested inner width. Returns the box's right edge so
    // the next inset can sit beside it.
    const placeInset = (
      iso: string,
      proj: GeoProjection,
      boxX: number,
      iwReq: number
    ): number => {
      const f = usLayer.get(iso);
      if (!f) return boxX;
      const x0 = boxX;
      // Clamp the width to the remaining canvas so the box can't run off-frame.
      const iw = Math.min(iwReq, width - FIT_PAD - x0 - 2 * PAD);
      if (iw < 24) return boxX; // canvas truly too narrow for another inset
      const xr = x0 + iw + 2 * PAD;
      const floor = coastFloor(x0, xr);
      const topGuess = floor > -Infinity ? floor + GAP : yB - height * 0.42;
      // Learn the state's height at this width, then size the box to just hold it.
      proj.fitWidth(iw, f as never);
      const bb = geoPath(proj).bounds(f as never);
      const sh = Number.isFinite(bb[0][0]) ? bb[1][1] - bb[0][1] : iw;
      // Flat top sits just under the coast. If the coast runs so low the state
      // wouldn't fit above yB, raise the top (it stays over ocean) — the box must
      // never collapse and vanish.
      const needH = sh + 2 * PAD;
      let topFit = topGuess;
      const bottom = Math.min(topFit + needH, yB);
      if (bottom - topFit < needH) topFit = bottom - needH;
      proj.fitExtent(
        [
          [x0 + PAD, topFit + PAD],
          [xr - PAD, bottom - PAD],
        ],
        f as never
      );
      const d = geoPath(proj)(f as never) ?? '';
      if (!d) return xr;
      const r = regionById.get(iso);
      let fill = neutralFill;
      let lineNumber = -1;
      if (r?.layer === 'us-state') {
        fill = regionFill(r);
        lineNumber = r.lineNumber;
      }
      insets.push({
        x: x0,
        y: topFit,
        w: xr - x0,
        h: bottom - topFit,
        points: [
          [x0, topFit],
          [xr, topFit],
          [xr, bottom],
          [x0, bottom],
        ],
        // The FITTED inset projection (just fit to this box) — captured so the
        // geo-query can invert pixels inside the frame back to AK/HI coords.
        projection: proj,
      });
      insetRegions.push({
        id: iso,
        d,
        fill,
        stroke: regionStroke,
        lineNumber,
        layer: 'us-state',
        ...(r?.value !== undefined && { value: r.value }),
        ...(r && Object.keys(r.tags).length > 0 && { tags: r.tags }),
      });
      const ctr = geoPath(proj).centroid(f as never);
      if (Number.isFinite(ctr[0])) {
        const name = (f.properties as { name?: string } | null)?.name ?? iso;
        insetLabelSeeds.push({ x: ctr[0], y: ctr[1], iso, name, lineNumber });
      }
      return xr;
    };
    // AK is the larger state; HI a small island group tucked to its right.
    // Each draws only when referenced; HI slides left to FIT_PAD if AK is absent.
    let akRight = FIT_PAD;
    if (akRef)
      akRight = placeInset('US-AK', alaskaProjection(), FIT_PAD, width * 0.15);
    if (hiRef)
      placeInset(
        'US-HI',
        hawaiiProjection(),
        akRef ? akRight + 24 : FIT_PAD,
        width * 0.1
      );
  }

  // -- Basemap culling --
  // At a regional zoom (e.g. a Caribbean route) far-away land — especially the
  // poles and antimeridian-spanning countries (Antarctica, Russia, Canada) —
  // projects to frame-filling garbage whose fill covers the whole viewport,
  // painting "sea" as land. Only draw features whose geographic bounds overlap
  // the (padded) visible extent. A near-global view draws everything.
  // In an albers-usa + us-states view the projection frames the ENTIRE
  // contiguous 48 (it fits to `fitTarget` = the conus states, NOT the POI
  // extent), so the cull box must be the CONUS bounds. Culling by
  // resolved.extent — which is the POI cluster, often a single metro — would
  // drop every in-frame state outside that cluster, leaving gray gaps where
  // land should be. Far countries are still culled (to the conus box) so the
  // unclipped conic doesn't paint frame-filling garbage; the us-states layer
  // itself is never culled (every conus state is in frame by construction).
  const conusFit = resolved.projection === 'albers-usa' && !!usLayer;
  // Extent used only to classify a near-global view (draw everything) vs a
  // regional one (cull to the canvas). For an albers fit that's the CONUS bounds;
  // else the resolved data extent.
  const classifyExtent = conusFit
    ? (geoBounds(fitTarget as never) as [[number, number], [number, number]])
    : resolved.extent;
  const dLonSpan = classifyExtent[1][0] - classifyExtent[0][0];
  const dLatSpan = classifyExtent[1][1] - classifyExtent[0][1];
  // A near-global view draws everything; a regional one culls each ring to what
  // actually projects onto the canvas (see ringOverlapsView — projection-based,
  // so it's correct for the US conic and for route maps alike).
  const isGlobalView = dLonSpan >= 270 || dLatSpan >= 130;
  // Pacific-crossing extents use extended longitudes (e.g. 247 = 113°W), but ring
  // vertices are in [-180,180]. Normalize each ring lon into the view's frame so
  // the circumpolar / antimeridian-sliver guards compare like-for-like.
  const vLonCenter = (classifyExtent[0][0] + classifyExtent[1][0]) / 2;
  const normLon = (lon: number): number => {
    let L = lon;
    while (L < vLonCenter - 180) L += 360;
    while (L > vLonCenter + 180) L -= 360;
    return L;
  };
  // True if an outer ring should be drawn in a regional view. Visibility is
  // decided by the PROJECTION, not a lat/lon box: the ring is kept iff its
  // projected screen bbox intersects the canvas (the projection's clipExtent then
  // trims it to the viewport). A lat/lon box can't model what a conic actually
  // shows — under the US Albers conic, Panama/Colombia land on-canvas at a tall
  // aspect yet sit outside any tidy CONUS-ish box. Two geometry guards still drop
  // the antimeridian/circumpolar rings that would otherwise project to a
  // frame-filling garbage fill (their projected bbox spuriously covers the
  // canvas): a near-circumpolar ring (>270° span) and an antimeridian sliver
  // (raw span >180° but a small normalized arc, e.g. Fiji).
  type Ring = ReadonlyArray<readonly [number, number]>;
  const ringOverlapsView = (ring: Ring): boolean => {
    let loMin = Infinity,
      loMax = -Infinity,
      rawMin = Infinity,
      rawMax = -Infinity;
    for (const [rawLon] of ring) {
      const lon = normLon(rawLon);
      if (lon < loMin) loMin = lon;
      if (lon > loMax) loMax = lon;
      if (rawLon < rawMin) rawMin = rawLon;
      if (rawLon > rawMax) rawMax = rawLon;
    }
    if (loMax - loMin > 270) return false; // circumpolar/polar-wrap garbage
    if (rawMax - rawMin > 180 && loMax - loMin < 90) return false; // seam sliver
    // Projected-bbox ∩ canvas. project() honours the active projection (and
    // ignores clipExtent, so positions are true), so this is exactly "does any
    // of this ring fall on the canvas".
    let px0 = Infinity,
      py0 = Infinity,
      px1 = -Infinity,
      py1 = -Infinity,
      anyFinite = false;
    for (const [lon, lat] of ring) {
      const p = project(lon, lat);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      anyFinite = true;
      if (p[0] < px0) px0 = p[0];
      if (p[0] > px1) px1 = p[0];
      if (p[1] < py0) py0 = p[1];
      if (p[1] > py1) py1 = p[1];
    }
    if (!anyFinite) return false;
    return !(px1 < 0 || px0 > width || py1 < 0 || py0 > height);
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

  // View-INDEPENDENT frame-fill guard. An antimeridian-crossing ring whose true
  // occupied longitude arc is small (e.g. Fiji: islands at 177°E and 178°W, a
  // ~5° arc straddling the seam) projects under equirectangular to two slivers
  // at opposite frame edges; the fill between them inverts to paint the WHOLE
  // ocean as land. `cullFeatureToView` drops these in a regional view, but a
  // global/world view skips culling — so they must be dropped here regardless.
  // Distinguishes a real seam-crosser (Russia ≈170° arc, kept) from a sliver
  // (Fiji ≈5° arc, dropped) by the occupied-arc width, computed from the ring's
  // own longitudes (no view frame), so it's correct at any projection centre.
  const SEAM_SLIVER_MAX_SPAN = 100; // ° — wider seam-crossers are real, kept
  const ringIsFrameFiller = (ring: Ring): boolean => {
    const lons = ring.map(([lon]) => lon).sort((a, b) => a - b);
    if (lons.length < 2) return false;
    let maxGap = -1;
    let gapIdx = 0;
    for (let i = 1; i < lons.length; i++) {
      const g = lons[i]! - lons[i - 1]!;
      if (g > maxGap) {
        maxGap = g;
        gapIdx = i;
      }
    }
    const wrapGap = lons[0]! + 360 - lons[lons.length - 1]!;
    // Occupied arc = complement of the largest empty gap. If the gap straddles
    // the seam the data is contiguous in [−180,180] (no inversion); otherwise
    // the occupied arc wraps the seam (east > 180).
    if (wrapGap >= maxGap) return false; // contiguous, doesn't cross the seam
    const span = 360 - maxGap;
    const east = lons[gapIdx - 1]! + 360;
    return east > 180 && span < SEAM_SLIVER_MAX_SPAN;
  };
  // Drop a feature's seam-sliver sub-polygons (always, even in a global view).
  const dropFrameFillers = (f: GeoFeature): GeoFeature | null => {
    const g = f.geometry as {
      type: string;
      coordinates: number[][][] | number[][][][];
    } | null;
    if (!g) return f;
    if (g.type === 'Polygon') {
      const ring = (g.coordinates as number[][][])[0] as unknown as Ring;
      return ringIsFrameFiller(ring) ? null : f;
    }
    if (g.type === 'MultiPolygon') {
      const polys = g.coordinates as number[][][][];
      const keep = polys.filter(
        (p) => !ringIsFrameFiller(p[0] as unknown as Ring)
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
      // Only albers-usa relocates them to insets; on a world/regional projection
      // they have no inset and must draw in place from the us-states layer.
      if (
        layerKind === 'us-state' &&
        usContext &&
        resolved.projection === 'albers-usa' &&
        INSET_STATES.has(iso)
      )
        continue;
      // In a US view the us-states layer paints the whole country — drop the
      // redundant US country polygon underneath it (it only adds a coarser base
      // and a doubled outline).
      if (layerKind === 'country' && usContext && iso === 'US') continue;
      // Antarctica is omitted from the world basemap. The natural-earth world
      // frame is clamped to ~-58°N and global views take the stretch path (no
      // clipExtent), so AQ's -90° geometry projects below the frame and spills
      // out the bottom of the canvas as a distorted strip. Data world maps omit
      // Antarctica by convention anyway. Keep it only if explicitly referenced.
      if (layerKind === 'country' && iso === 'AQ' && !regionById.has('AQ'))
        continue;
      const r = regionById.get(iso);
      // Cull off-view land in a regional view; in a global view keep all land
      // but still drop antimeridian frame-fillers (Fiji et al.).
      const viewF = shouldCull ? cullFeatureToView(f) : dropFrameFillers(f);
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
        // Fill by the ACTIVE colouring dimension (score ramp or tag group).
        fill = regionFill(r);
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
        ...(isThisLayer && r.value !== undefined && { value: r.value }),
        ...(isThisLayer && Object.keys(r.tags).length > 0 && { tags: r.tags }),
      });
    }
  };
  // World/foreign layer: cull by the visible extent (unless near-global) so far
  // countries don't project to frame-filling garbage under albers-usa. In a
  // conus fit the cull box is the whole-CONUS bounds (above), so neighbour land
  // around the US survives and only truly-distant countries drop.
  pushRegionLayer(worldLayer, 'country', !isGlobalView);
  // US-states layer: NEVER culled in a conus fit — every contiguous state is in
  // frame by construction, and culling by a tight POI extent would blank most of
  // them. AK/HI are handled as insets above. Outside a conus fit, cull off-view.
  if (usLayer) pushRegionLayer(usLayer, 'us-state', !conusFit && !isGlobalView);
  // NOTE: insetRegions (AK/HI) are returned SEPARATELY so the renderer can draw
  // them in the foreground over an opaque box — drawn inline here they'd sit
  // behind neighbour land (Mexico) showing through the inset.

  // Lakes (Great Lakes etc.) painted as water OVER the land so they don't read
  // as land — the coarse country polygons don't carve them out. Drawn last so
  // they sit above both neighbour land and US states; culled like the world
  // layer, and far lakes null-project away under albers-usa.
  const lakesTopo = usCrisp && data.naLakes ? data.naLakes : data.lakes;
  if (lakesTopo) {
    for (const [, f] of decodeLayer(lakesTopo)) {
      const viewF = isGlobalView ? dropFrameFillers(f) : cullFeatureToView(f);
      if (!viewF) continue;
      const d = path(viewF as never) ?? '';
      if (!d) continue;
      regions.push({
        id: 'lake',
        d,
        fill: water,
        stroke: lakeStroke,
        lineNumber: -1,
        layer: 'base',
      });
    }
  }

  // -- Background-fill hit-testing (for connector-label contrast) --
  // A freight/edge label floats over whatever region the route crosses — a dark
  // scored country, pale land, or open water. To pick a legible text shade (and
  // skip the ghost halo when not needed) we need the fill UNDER the label point.
  // Test in SCREEN space against the already-drawn region paths: that sidesteps
  // every projection wrinkle (global stretch, antimeridian, AK/HI insets) because
  // the geometry is already projected (see module-level `parsePathRings`).
  // Even-odd ray cast across ALL of a feature's rings at once, so polygons with
  // holes (a ring inside a ring) toggle correctly.
  const pointInRings = (
    px: number,
    py: number,
    rings: Array<Array<[number, number]>>
  ): boolean => {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (
          yi > py !== yj > py &&
          px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        )
          inside = !inside;
      }
    }
    return inside;
  };
  // Precompute hit targets once (regions are drawn in array order, so the LAST
  // containing one is topmost). Insets paint over neighbour land in their own box.
  const fillHitTargets = [...regions, ...insetRegions].map((r) => ({
    fill: r.fill,
    rings: parsePathRings(r.d),
  }));
  const fillAt = (x: number, y: number): string => {
    let hit = water; // open ocean / canvas backdrop when over no land
    for (const t of fillHitTargets)
      if (pointInRings(x, y, t.rings)) hit = t.fill;
    return hit;
  };
  // Contrast-pick text colour for a label sitting ON `fill` (shared by region
  // labels and connector labels): the genuinely higher-contrast of the palette's
  // light/dark on-fill text, with a halo only when that contrast is marginal
  // (mid-tone fills), so clear fills carry no ghost.
  const labelOnFill = (
    fill: string
  ): { color: string; halo: boolean; haloColor: string } => {
    const color =
      contrastRatio(fill, palette.textOnFillDark) >=
      contrastRatio(fill, palette.textOnFillLight)
        ? palette.textOnFillDark
        : palette.textOnFillLight;
    const haloColor =
      color === palette.textOnFillLight
        ? palette.textOnFillDark
        : palette.textOnFillLight;
    return {
      color,
      halo: contrastRatio(fill, color) < REGION_LABEL_HALO_RATIO,
      haloColor,
    };
  };

  // Relief (notable mountain ranges) — horizontal hachure lines clipped to each
  // range, drawn over the base land and under rivers/POIs/data fills. Opt-in via
  // the `relief` flag; needs the optional `mountainRanges` asset. Each surviving
  // range is projected to a polygon path; the renderer unions them into a clip
  // and rules screen-spaced horizontal lines through it — a distinct texture
  // that reads as "mountains here" without elevation data. Ranges below a min
  // projected area/dimension are dropped (no slivers). Data-region suppression
  // (ADR-2) is handled at the RENDER clip — relief is clipped to land MINUS the
  // data-coloured regions, so a range that crosses a valued state still shows on
  // the un-valued land around it (a bbox drop here would nuke the whole range).
  const relief: MapLayoutRelief[] = [];
  let reliefHatch: MapLayoutReliefHatch | null = null;
  if (resolved.directives.relief === true && data.mountainRanges) {
    for (const [, f] of decodeLayer(data.mountainRanges)) {
      const viewF = isGlobalView ? dropFrameFillers(f) : cullFeatureToView(f);
      if (!viewF) continue;
      const area = path.area(viewF as never);
      if (!Number.isFinite(area) || area < RELIEF_MIN_AREA) continue;
      const box = path.bounds(viewF as never) as [
        [number, number],
        [number, number],
      ];
      if (
        box[1][0] - box[0][0] < RELIEF_MIN_DIM ||
        box[1][1] - box[0][1] < RELIEF_MIN_DIM
      )
        continue;
      const d = path(viewF as never) ?? '';
      if (!d) continue;
      relief.push({ d });
    }
    if (relief.length) {
      // Prefer DARK hachure (blend land toward the dark tone — bg on dark
      // themes, text on light). But on a muted/data map the un-valued land is
      // already near-black, so darkness can't show: if the dark tone barely
      // differs from the land, flip to the light tone so the lines stay visible.
      const darkTone = isDark ? palette.bg : palette.text;
      const lightTone = isDark ? palette.text : palette.bg;
      const landLum = relativeLuminance(neutralFill);
      const tone =
        Math.abs(landLum - relativeLuminance(darkTone)) > 0.04
          ? darkTone
          : lightTone;
      reliefHatch = {
        color: mix(tone, neutralFill, RELIEF_HATCH_STRENGTH),
        spacing: RELIEF_HATCH_SPACING,
        width: RELIEF_HATCH_WIDTH,
      };
    }
  }

  // Coastline water-lines style (opt-in `coastline`, §24B.2). No geometry/asset:
  // the renderer derives the lines from the already-drawn region paths and masks
  // them to the water side. We only resolve the proportional screen-space style
  // here (fractions of min(w,h) → absolute px, so the offshore distance stays a
  // constant fraction of the canvas at any export size — ADR-3). Differs from
  // relief: a touch more contrast than `lakeStroke` so the offshore lines read as
  // distinct from the coast stroke (R10/F14).
  let coastlineStyle: MapLayoutCoastlineStyle | null = null;
  if (resolved.directives.coastline === true) {
    const minDim = Math.min(width, height);
    coastlineStyle = {
      color: mix(regionStroke, water, COASTLINE_STROKE_MIX),
      // N equal-width rings: distance steps outward by COASTLINE_STEP; opacity
      // fades linearly from NEAR (innermost) to FAR (outermost).
      lines: Array.from({ length: COASTLINE_RING_COUNT }, (_, k) => ({
        d: (COASTLINE_D0 + k * COASTLINE_STEP) * minDim,
        thickness: COASTLINE_THICKNESS * minDim,
        opacity:
          COASTLINE_OPACITY_NEAR +
          ((COASTLINE_OPACITY_FAR - COASTLINE_OPACITY_NEAR) * k) /
            (COASTLINE_RING_COUNT - 1),
      })),
      minExtent:
        (isGlobalView ? COASTLINE_MIN_EXTENT_GLOBAL : COASTLINE_MIN_EXTENT) *
        minDim,
    };
  }

  // Rivers (Amazon, Nile, Mississippi, …) as thin water lines over the land.
  // Nudged slightly toward the border tone (off flat `water`) so the line reads
  // as a deliberate water course rather than a gap where it crosses a border —
  // in muted/data mode flat water is a pale gray that just looks like a broken
  // boundary. Open paths: stroked, no fill; under POIs/edges/labels.
  const riverColor = mix(water, regionStroke, 16);
  const rivers: MapLayoutRiver[] = [];
  if (data.rivers) {
    for (const [, f] of decodeLayer(data.rivers)) {
      const viewF = isGlobalView ? dropFrameFillers(f) : cullFeatureToView(f);
      if (!viewF) continue;
      const d = path(viewF as never) ?? '';
      if (!d) continue;
      rivers.push({ d, color: riverColor, width: RIVER_WIDTH });
    }
  }

  // -- POIs: project, value→size-scale, co-located spiderfy --
  const sizeVals = resolved.pois
    .map((p) => Number(p.meta['value']))
    .filter((n) => Number.isFinite(n) && n > 0);
  const sizeMin = sizeVals.length ? Math.min(...sizeVals) : 0;
  const sizeMax = sizeVals.length ? Math.max(...sizeVals) : 0;
  const radiusFor = (p: ResolvedPoi): number => {
    const v = Number(p.meta['value']);
    if (!Number.isFinite(v) || v <= 0 || sizeMax <= 0) return R_DEFAULT;
    // sqrt so AREA encodes the value
    const t =
      sizeMax > sizeMin
        ? (Math.sqrt(v) - Math.sqrt(sizeMin)) /
          (Math.sqrt(sizeMax) - Math.sqrt(sizeMin))
        : 1;
    return R_MIN + Math.max(0, Math.min(1, t)) * (R_MAX - R_MIN);
  };

  // POI fill precedence (§24B.5): a direct §1.5 trailing color wins, then the
  // FIRST declared tag group for which the POI has a value (AR4), then orange.
  const poiFill = (p: ResolvedPoi): { fill: string; stroke: string } => {
    const directHex = p.color ? resolveColor(p.color, palette) : null;
    if (directHex)
      return { fill: directHex, stroke: mix(directHex, palette.text, 18) };
    for (const group of resolved.tagGroups) {
      const val = p.tags[group.name.toLowerCase()];
      if (!val) continue;
      const entry = group.entries.find(
        (e) => e.value.toLowerCase() === val.toLowerCase()
      );
      const hex = entry?.color; // already hex (parser-resolved)
      if (hex) return { fill: hex, stroke: mix(hex, palette.text, 18) };
    }
    // Untagged markers default to orange — a warm hue that contrasts with BOTH
    // the green land and the blue water/lakes/rivers. `palette.accent` is a
    // blue-ish tone in some palettes (e.g. nord) and vanished against the ocean.
    return {
      fill: palette.colors.orange,
      stroke: mix(palette.colors.orange, palette.text, 18),
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

  const poiScreen = new Map<string, { cx: number; cy: number; r: number }>();
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
      poiScreen.set(e.p.id, { cx, cy, r: radiusFor(e.p) });
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
        ...(Object.keys(e.p.tags).length > 0 && { tags: e.p.tags }),
      });
    });
  }

  // -- Connectors: routes + edges (with parallel fan-out) --
  const legs: MapLayoutLeg[] = [];
  // Gap between a leg's endpoint and the POI rim, so the line/arrow touches the
  // circle edge rather than burying its tip at the centre dot.
  const RIM_GAP = 1.5;
  const legPath = (
    a: { cx: number; cy: number; r: number },
    b: { cx: number; cy: number; r: number },
    curved: boolean,
    offset: number
  ): string => {
    const mx = (a.cx + b.cx) / 2;
    const my = (a.cy + b.cy) / 2;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    // Trim each end back to its POI rim, but never cross past the midpoint when
    // the circles nearly touch (keeps a hair of line rather than inverting).
    const trimA = Math.min(a.r + RIM_GAP, len * 0.45);
    const trimB = Math.min(b.r + RIM_GAP, len * 0.45);
    if (!curved && offset === 0) {
      const ux = dx / len;
      const uy = dy / len;
      const ax = a.cx + ux * trimA;
      const ay = a.cy + uy * trimA;
      const bx = b.cx - ux * trimB;
      const by = b.cy - uy * trimB;
      return `M${ax},${ay}L${bx},${by}`;
    }
    const nx = -dy / len;
    const ny = dx / len;
    const bow = offset !== 0 ? offset : len * ARC_CURVE_FRAC;
    const px = mx + nx * bow;
    const py = my + ny * bow;
    // Tangent at each end of the quadratic Q is toward/from the control point.
    const ta = Math.hypot(px - a.cx, py - a.cy) || 1;
    const tb = Math.hypot(b.cx - px, b.cy - py) || 1;
    const ax = a.cx + ((px - a.cx) / ta) * trimA;
    const ay = a.cy + ((py - a.cy) / ta) * trimA;
    const bx = b.cx - ((b.cx - px) / tb) * trimB;
    const by = b.cy - ((b.cy - py) / tb) * trimB;
    return `M${ax},${ay}Q${px},${py} ${bx},${by}`;
  };

  // Routes: each leg is an edge (fromId → toId) carrying its own label,
  // value→thickness, and arc shape. Loop-closing legs are explicit in `rt.legs`;
  // the origin is never double-marked because `stopIds` is unique.
  const routeLegVals = resolved.routes
    .flatMap((rt) => rt.legs)
    .map((l) => Number(l.value))
    .filter((n) => Number.isFinite(n) && n > 0);
  const rlMin = routeLegVals.length ? Math.min(...routeLegVals) : 0;
  const rlMax = routeLegVals.length ? Math.max(...routeLegVals) : 0;
  const routeWidthFor = (v: number): number => {
    if (!Number.isFinite(v) || v <= 0 || rlMax <= 0) return W_MIN;
    const t = rlMax > rlMin ? (v - rlMin) / (rlMax - rlMin) : 1;
    return W_MIN + t * (W_MAX - W_MIN);
  };
  // -- Surface-route avoidance (§24B.6) shared setup --
  // Best-effort land/water-avoiding bow for legs/edges that set `surface:`. The
  // helper samples in geo space (it needs each endpoint's lon/lat + the decoded
  // country land), forward-projects through the SAME `project` closure used for
  // POIs (F1), and returns a single screen-space `offset` for `legPath`.
  const surfaceDiagnostics: DgmoError[] = [];
  const poiLonLat = new Map<string, [number, number]>();
  for (const p of resolved.pois) poiLonLat.set(p.id, [p.lon, p.lat]);
  // Country polygons = land; open ocean is outside them all (v1; lakes deferred).
  const landFeatures = [...worldLayer.values()] as unknown as DecodedFeature[];
  // F7: albers-usa composes non-geographic AK/HI gutters, so a geo-space bow test
  // is nonsensical there — disable surface mode (with a diagnostic) in v1.
  const surfaceDisabled = resolved.projection === 'albers-usa';
  // The albers-usa skip applies to the whole map for the same reason, so emit
  // that warning ONCE (on the first surface leg) rather than once per leg.
  let albersWarned = false;
  /** Resolve a leg/edge's `surface` into legPath bow params (+ label apex). */
  const resolveLegSurface = (
    surface: 'water' | 'land',
    a: { cx: number; cy: number },
    b: { cx: number; cy: number },
    fromId: string,
    toId: string,
    fanDelta: number,
    lineNumber: number,
    fallback: {
      curved: boolean;
      offset: number;
      labelX: number;
      labelY: number;
    }
  ): { curved: boolean; offset: number; labelX: number; labelY: number } => {
    if (surfaceDisabled) {
      if (!albersWarned) {
        albersWarned = true;
        surfaceDiagnostics.push(
          makeDgmoError(
            lineNumber,
            `surface: ${surface} is not supported under the albers-usa projection (non-geographic insets) — drawn as a plain arc.`,
            'warning',
            'W_MAP_SURFACE_UNSATISFIED'
          )
        );
      }
      return fallback;
    }
    const lonLatA = poiLonLat.get(fromId);
    const lonLatB = poiLonLat.get(toId);
    if (!lonLatA || !lonLatB) return fallback;
    const r = resolveSurfaceBow({
      a,
      b,
      lonLatA,
      lonLatB,
      surface,
      project,
      landFeatures,
      fanDelta,
      lineNumber,
    });
    if (r.diagnostic)
      surfaceDiagnostics.push(
        makeDgmoError(
          r.diagnostic.line,
          r.diagnostic.message,
          'warning',
          r.diagnostic.code
        )
      );
    return {
      curved: r.curved,
      offset: r.offset,
      labelX: r.apex[0],
      labelY: r.apex[1] - 4,
    };
  };

  for (const rt of resolved.routes) {
    for (const leg of rt.legs) {
      const a = poiScreen.get(leg.fromId);
      const b = poiScreen.get(leg.toId);
      if (!a || !b) continue;
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      let bow = {
        curved: leg.style === 'arc',
        offset: 0,
        labelX: mx,
        labelY: my - 4,
      };
      if (leg.surface)
        bow = resolveLegSurface(
          leg.surface,
          a,
          b,
          leg.fromId,
          leg.toId,
          0,
          leg.lineNumber,
          bow
        );
      const routeLabelStyle =
        leg.label !== undefined
          ? labelOnFill(fillAt(bow.labelX, bow.labelY))
          : undefined;
      legs.push({
        d: legPath(a, b, bow.curved, bow.offset),
        width: routeWidthFor(Number(leg.value)),
        color: mix(palette.text, palette.bg, 72),
        arrow: true,
        lineNumber: leg.lineNumber,
        ...(leg.label !== undefined && {
          label: leg.label,
          labelX: bow.labelX,
          labelY: bow.labelY,
          labelColor: routeLabelStyle!.color,
          labelHalo: routeLabelStyle!.halo,
          labelHaloColor: routeLabelStyle!.haloColor,
        }),
      });
    }
  }

  // Edges: group by unordered endpoint pair for deterministic fan-out (AR9).
  const weightVals = resolved.edges
    .map((e) => Number(e.meta['value']))
    .filter((n) => Number.isFinite(n) && n > 0);
  const wMin = weightVals.length ? Math.min(...weightVals) : 0;
  const wMax = weightVals.length ? Math.max(...weightVals) : 0;
  const widthFor = (e: ResolvedEdge): number => {
    const v = Number(e.meta['value']);
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
      const fanOffset = n > 1 ? (i - (n - 1) / 2) * FAN_STEP : 0;
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      let bow = {
        curved: e.style === 'arc' || n > 1,
        offset: fanOffset,
        labelX: mx,
        labelY: my - 4,
      };
      if (e.surface)
        // Pass the fan offset as fanDelta so parallel surface edges stay spread (F12).
        bow = resolveLegSurface(
          e.surface,
          a,
          b,
          e.fromId,
          e.toId,
          fanOffset,
          e.lineNumber,
          bow
        );
      const edgeLabelStyle =
        e.label !== undefined
          ? labelOnFill(fillAt(bow.labelX, bow.labelY))
          : undefined;
      legs.push({
        d: legPath(a, b, bow.curved, bow.offset),
        width: widthFor(e),
        color: mix(palette.text, palette.bg, 66),
        arrow: e.directed,
        lineNumber: e.lineNumber,
        ...(e.label !== undefined && {
          label: e.label,
          labelX: bow.labelX,
          labelY: bow.labelY,
          labelColor: edgeLabelStyle!.color,
          labelHalo: edgeLabelStyle!.halo,
          labelHaloColor: edgeLabelStyle!.haloColor,
        }),
      });
    });
  }

  // -- Labels: regions + POIs with escalation (AR5) --
  const labels: PlacedLabel[] = [];
  const obstacles: LabelRect[] = [];
  const markers: PointCircle[] = pois.map((p) => ({
    cx: p.cx,
    cy: p.cy,
    r: p.r,
  }));
  // Sample every drawn leg into straight segments so POI labels can dodge the
  // connector lines (not just markers + other labels) — otherwise a hub POI's
  // label lands on top of the fan of edges leaving it (e.g. Los Angeles).
  const legSegments: Array<[number, number, number, number]> = [];
  for (const leg of legs) {
    const m =
      /^M(-?[\d.]+),(-?[\d.]+)(?:L(-?[\d.]+),(-?[\d.]+)|Q(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+))$/.exec(
        leg.d
      );
    if (!m) continue;
    const x0 = +m[1]!;
    const y0 = +m[2]!;
    if (m[3] !== undefined) {
      legSegments.push([x0, y0, +m[3]!, +m[4]!]);
    } else {
      const cx = +m[5]!;
      const cy = +m[6]!;
      const ex = +m[7]!;
      const ey = +m[8]!;
      const N = 8;
      let px = x0;
      let py = y0;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const u = 1 - t;
        const qx = u * u * x0 + 2 * u * t * cx + t * t * ex;
        const qy = u * u * y0 + 2 * u * t * cy + t * t * ey;
        legSegments.push([px, py, qx, qy]);
        px = qx;
        py = qy;
      }
    }
  }
  const collides = (rect: LabelRect): boolean =>
    markers.some((m) => rectCircleOverlap(rect, m)) ||
    obstacles.some((o) => rectsOverlap(rect, o)) ||
    legSegments.some((s) => segmentRectOverlap(s[0], s[1], s[2], s[3], rect));

  // Region labels (default off). Rendered as plain text — NO pill, NO halo — so
  // the choropleth fill (which encodes the data) stays fully visible. The text
  // colour is contrast-picked against each region's OWN fill (dark on
  // pastel/unscored land, light on saturated fills). A label is shown only when
  // its (padded) footprint fits inside the region, so it always sits on that
  // fill (no halo needed) and small states like the NE cluster auto-hide rather
  // than overlap / spill onto the ocean.
  const regionLabelMode = resolved.directives.regionLabels ?? 'off';
  const LABEL_PADX = 6;
  const LABEL_PADY = 3;
  const labelW = (text: string): number =>
    measureLegendText(text, FONT) + 2 * LABEL_PADX;
  const labelH = FONT + 2 * LABEL_PADY;
  const pushRegionLabel = (
    x: number,
    y: number,
    text: string,
    fill: string,
    lineNumber: number
  ): void => {
    // Pick the genuinely higher-contrast text for legibility ON the fill (see
    // labelOnFill): max-contrast light/dark on-fill text, with a halo only on
    // mid-tone fills where neither reads strongly — clear fills carry no ghost.
    const { color, halo, haloColor } = labelOnFill(fill);
    labels.push({
      x,
      y,
      text,
      anchor: 'middle',
      color,
      halo,
      haloColor,
      lineNumber,
    });
  };
  // A few countries have far-flung territory that drags the area-weighted
  // centroid off the mainland (US → Alaska pulls it up into Canada). Anchor
  // their world-layer label to a mainland [lon, lat] instead.
  const WORLD_LABEL_ANCHORS: Record<string, [number, number]> = {
    US: [-98.5, 39.5], // CONUS geographic centre (near Lebanon, Kansas)
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
      // Hide if the label wouldn't fit inside the region's footprint.
      if (labelW(text) > x1 - x0 || labelH > y1 - y0) continue;
      const anchor =
        r.layer !== 'us-state' ? WORLD_LABEL_ANCHORS[r.id] : undefined;
      const c = anchor
        ? project(anchor[0], anchor[1])
        : path.centroid(f as never);
      if (!c || !Number.isFinite(c[0])) continue;
      pushRegionLabel(c[0], c[1], text, r.fill, r.lineNumber);
    }
    // AK/HI labels live in their insets (own projection centroids).
    for (const seed of insetLabelSeeds) {
      const text =
        regionLabelMode === 'abbrev' ? seed.iso.replace(/^US-/, '') : seed.name;
      const src = regionById.get(seed.iso);
      pushRegionLabel(
        seed.x,
        seed.y,
        text,
        src ? regionFill(src) : neutralFill,
        seed.lineNumber
      );
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
    const poiLabH = FONT * 1.25;
    const labelInfo = (p: MapLayoutPoi): { text: string; w: number } => {
      const text = labelText(p);
      return { text, w: measureLegendText(text, FONT) };
    };
    // Candidate inline placements around a marker, in escalation order: the two
    // horizontal sides first (most legible), then above/below for a hub whose
    // edges all leave sideways and block both flanks (e.g. a POI fed by routes
    // from the east AND west — Boulder in the route-cluster gauntlet).
    type Side = 'right' | 'left' | 'above' | 'below';
    const GAP = 3;
    const inlineRect = (p: MapLayoutPoi, w: number, side: Side): LabelRect => {
      switch (side) {
        case 'right':
          return { x: p.cx + p.r + GAP, y: p.cy - poiLabH / 2, w, h: poiLabH };
        case 'left':
          return {
            x: p.cx - p.r - GAP - w,
            y: p.cy - poiLabH / 2,
            w,
            h: poiLabH,
          };
        case 'above':
          return {
            x: p.cx - w / 2,
            y: p.cy - p.r - GAP - poiLabH,
            w,
            h: poiLabH,
          };
        case 'below':
          return { x: p.cx - w / 2, y: p.cy + p.r + GAP, w, h: poiLabH };
      }
    };
    const pushInline = (
      p: MapLayoutPoi,
      text: string,
      w: number,
      side: Side
    ): void => {
      const rect = inlineRect(p, w, side);
      obstacles.push(rect);
      const anchor =
        side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle';
      const x = side === 'right' ? rect.x : side === 'left' ? rect.x + w : p.cx;
      labels.push({
        x,
        y: rect.y + poiLabH / 2 + FONT / 3,
        text,
        anchor,
        color: palette.text,
        halo: true,
        haloColor: palette.bg,
        poiId: p.id,
        lineNumber: p.lineNumber,
      });
    };
    const inlineFits = (p: MapLayoutPoi, w: number, side: Side): boolean => {
      const rect = inlineRect(p, w, side);
      return (
        rect.x >= 0 &&
        rect.x + rect.w <= width &&
        rect.y >= 0 &&
        rect.y + rect.h <= height &&
        !collides(rect)
      );
    };

    // Pre-group POIs by proximity. A tight cluster (offshore platforms, a metro
    // of offices) gets ONE tidy callout column so its labels never pile up; an
    // isolated POI gets a normal inline label. This keeps the whole cluster's
    // labels together rather than seating a lucky few inline and stacking the
    // rest.
    const GROUP_R = 30; // px: POIs within this are one cluster
    const groups: MapLayoutPoi[][] = [];
    for (const p of ordered) {
      const near = groups.find((g) =>
        g.some((q) => Math.hypot(q.cx - p.cx, q.cy - p.cy) < GROUP_R)
      );
      if (near) near.push(p);
      else groups.push([p]);
    }

    // Tidy callout column: stack a cluster's labels beside it (collision-free by
    // row spacing), each row leader-lined back to its dot in the dot's colour.
    const ROW_GAP = 3;
    const step = poiLabH + ROW_GAP;
    const COL_GAP = 16;
    const placeColumn = (group: MapLayoutPoi[]): void => {
      const items = group
        .map((p) => ({ p, ...labelInfo(p) }))
        .sort((a, b) => a.p.cy - b.p.cy || (a.text < b.text ? -1 : 1));
      const left = Math.min(...items.map((o) => o.p.cx - o.p.r));
      const right = Math.max(...items.map((o) => o.p.cx + o.p.r));
      const cyMid =
        (Math.min(...items.map((o) => o.p.cy)) +
          Math.max(...items.map((o) => o.p.cy))) /
        2;
      const maxW = Math.max(...items.map((o) => o.w));
      // Prefer the right of the cluster; fall to the left if it runs off-canvas.
      const side: 'right' | 'left' =
        right + COL_GAP + maxW <= width - 2 ? 'right' : 'left';
      const colX = side === 'right' ? right + COL_GAP : left - COL_GAP;
      const totalH = items.length * step;
      let startY = cyMid - totalH / 2;
      startY = Math.max(2, Math.min(startY, height - totalH - 2));
      items.forEach((o, i) => {
        const rowCy = startY + i * step + step / 2;
        obstacles.push({
          x: side === 'right' ? colX : colX - o.w,
          y: rowCy - poiLabH / 2,
          w: o.w,
          h: poiLabH,
        });
        labels.push({
          x: colX,
          y: rowCy + FONT / 3,
          text: o.text,
          anchor: side === 'right' ? 'start' : 'end',
          color: palette.text,
          halo: true,
          haloColor: palette.bg,
          leader: {
            x1: o.p.cx,
            y1: o.p.cy,
            x2: side === 'right' ? colX - 2 : colX + 2,
            y2: rowCy,
          },
          leaderColor: o.p.fill,
          poiId: o.p.id,
          lineNumber: o.p.lineNumber,
        });
      });
    };

    for (const g of groups) {
      // Singleton that fits inline → inline; everything else → callout column
      // (the whole cluster, or a lone POI boxed in by legs/edges).
      if (g.length === 1) {
        const p = g[0]!;
        const { text, w } = labelInfo(p);
        const side = (['right', 'left', 'above', 'below'] as const).find((s) =>
          inlineFits(p, w, s)
        );
        if (side) {
          pushInline(p, text, w, side);
          continue;
        }
      }
      placeColumn(g);
    }
  }

  // -- Context labels (orientation backdrop, §24B). Placed DEAD LAST so they
  // only fill leftover space and never displace a data/region/POI label
  // (Decision 7). Off by default; gated on the directive so it costs nothing. --
  if (resolved.directives.contextLabels) {
    // F1: context labels must dodge EVERY committed label (region/inset/POI/
    // route), not just the POI-label rects already in `obstacles`. Region
    // labels go into `labels` but never into `obstacles`, so add a footprint
    // rect for each committed label here (POI rects are already present —
    // duplicates are harmless). This upholds Decision 7's "never displace a
    // data/region/POI label" against the live `collides` closure.
    for (const l of labels) {
      const w = labelW(l.text);
      const x =
        l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
      obstacles.push({ x, y: l.y - labelH / 2, w, h: labelH });
    }
    // Under albers-usa the AK/HI inset frames occupy the lower-left; a context
    // label must never sit on one (the original Decision 8 hazard). Feed each
    // inset box into the collision set so the placement dodges them.
    for (const box of insets)
      obstacles.push({ x: box.x, y: box.y, w: box.w, h: box.h });
    // Unreferenced notable countries: the FULL decoded country set (worldLayer
    // holds every country in the chosen tier — crisp `.set()` upgrades never
    // delete), minus any already labelled by region-labels (Decision 1). Geo
    // work (bbox/anchor) stays here; area-rank + fit + collision live in the
    // pure module so the strict density invariants (AC7) are unit-testable.
    const countryCandidates: CountryCandidate[] = [];
    for (const f of worldLayer.values()) {
      const iso = typeof f.id === 'string' ? f.id : String(f.id ?? '');
      if (!iso || regionById.has(iso)) continue;
      // F3: skip a country whose SUBDIVISIONS are the referenced data (e.g. a
      // US-states choropleth on a world projection) — the states ARE the data,
      // so don't slap a redundant "United States" context label over them.
      let hasReferencedSub = false;
      for (const k of regionById.keys())
        if (k.startsWith(iso + '-')) {
          hasReferencedSub = true;
          break;
        }
      if (hasReferencedSub) continue;
      const b = path.bounds(f as never) as [[number, number], [number, number]];
      const [x0, y0] = b[0];
      const [x1, y1] = b[1];
      if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
      const anchorLngLat = WORLD_LABEL_ANCHORS[iso];
      const a = anchorLngLat
        ? project(anchorLngLat[0], anchorLngLat[1])
        : (path.centroid(f as never) as [number, number]);
      countryCandidates.push({
        iso,
        name: (f.properties as { name?: string } | undefined)?.name ?? iso,
        bbox: [x0, y0, x1, y1],
        anchor: a && Number.isFinite(a[0]) ? [a[0], a[1]] : null,
      });
    }
    const contextLabels = placeContextLabels({
      projection: resolved.projection,
      dLonSpan,
      dLatSpan,
      width,
      height,
      waterBodies: data.waterBodies,
      countries: countryCandidates,
      regionLabels: regionLabelMode,
      palette,
      project,
      collides,
      // Water labels must stay over open water — `fillAt` returns the ocean
      // backdrop colour off-land and a region fill on-land (lakes/states count
      // as land here, which is the safe side for an ocean name).
      overLand: (x, y) => fillAt(x, y) !== water,
    });
    labels.push(...contextLabels);
  }

  // -- Legend model (AR1: categorical via renderer's renderLegendD3) --
  let legend: MapLayoutLegend | null = null;
  if (!resolved.directives.noLegend) {
    const tagGroups = resolved.tagGroups.map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
    }));
    // Only the colouring dimensions (value ramp + tag groups) get a legend.
    // POI size and edge thickness are self-evident from the marker/line scale and
    // intentionally carry no key (the poi-metric/flow-metric labels are captured
    // for future use but not rendered as legend keys in v1).
    if (tagGroups.length > 0 || hasRamp) {
      legend = {
        tagGroups,
        activeGroup,
        ...(hasRamp && {
          ramp: {
            ...(resolved.directives.regionMetric !== undefined && {
              metric: resolved.directives.regionMetric,
            }),
            min: rampMin,
            max: rampMax,
            hue: rampHue,
            base: rampBase,
          },
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
    relief,
    reliefHatch,
    coastlineStyle,
    legs,
    pois,
    labels,
    legend,
    insets,
    insetRegions,
    projection,
    stretch: stretchParams,
    diagnostics: surfaceDiagnostics,
  };
}
