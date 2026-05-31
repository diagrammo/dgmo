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
import { mix, contrastText } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes/types';
import {
  rectsOverlap,
  rectCircleOverlap,
  segmentRectOverlap,
} from '../label-layout';
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
const COLO_EPS = 1.5; // px: POIs closer than this are "co-located"
// % palette-yellow of bg for unscored land. Higher on dark so the soft palette
// yellow reads as yellow rather than muddying toward tan against the dark bg.
const LAND_TINT_LIGHT = 58;
const LAND_TINT_DARK = 75;
// Categorical (tag) region fill: a flat, fairly saturated tint of the tag
// colour so a tagged region reads as its CATEGORY against the tinted land base
// — the generic 25% shape tint washes out and lets the olive land dominate.
const TAG_TINT_LIGHT = 60;
const TAG_TINT_DARK = 68;
const WATER_TINT = 55; // % palette-blue of bg for the ocean / backdrop
const RIVER_WIDTH = 1.3; // px stroke width for river lines
// % palette-gray of bg for non-US neighbour land. Higher on dark so it reads as
// a clear gray rather than sinking into the dark background.
const FOREIGN_TINT_LIGHT = 30;
const FOREIGN_TINT_DARK = 62;
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
  /** The region's score (if any) — emitted as `data-score` so the app can
   *  highlight by gradient-scrub proximity. */
  readonly score?: number;
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
  readonly leader?: { x1: number; y1: number; x2: number; y2: number };
  /** Leader-line colour — the POI's own marker colour, so a called-out label
   *  reads as belonging to its dot. Falls back to a neutral grey when absent. */
  readonly leaderColor?: string;
  /** The POI this label belongs to (POI labels only) — emitted as `data-poi` on
   *  the label + leader so the app can spotlight the dot on label hover. */
  readonly poiId?: string;
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
  /** Live override of the active colouring group (the score ramp or a tag
   *  group). Highest priority — beats the `active-tag` directive. The app's
   *  interactive legend flip passes this; `'score'` (or the metric label)
   *  selects the choropleth ramp, a tag-group name selects that group, `'none'`
   *  / `null` clears it. `undefined` = not provided (use the directive/default). */
  readonly activeGroup?: string | null;
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

/** The map's neutral (unscored/untagged) LAND colour — the green base every
 *  region blends from. Exported so a host can DIM a region to plain land
 *  (rather than lowering opacity, which would let the blue water show through
 *  and make the shape read as ocean). Matches the layout's `neutralFill`. */
export function mapNeutralLandColor(
  palette: PaletteColors,
  isDark: boolean
): string {
  return mix(
    palette.colors.green,
    palette.bg,
    isDark ? LAND_TINT_DARK : LAND_TINT_LIGHT
  );
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
  const wantsUsStates = resolved.basemaps.subdivisions.includes('us-states');
  // In a US (albers-usa + us-states) view the surrounding land was world-atlas
  // 50m/110m — visibly coarser than the 10m states. When the NA-clipped 10m
  // assets are present, swap them in so neighbours (Canada/Mexico) and the Great
  // Lakes match the states' resolution. Falls back to the world tiers otherwise.
  const usCrisp =
    resolved.projection === 'albers-usa' && wantsUsStates && !!data.naLand;
  // Base world layer. In a US view use the DETAIL tier (full global coverage) so
  // distant context — South America, northern Canada, etc. — is present and can
  // draw when it falls inside the frame. (`naLand` alone is bbox-clipped to lon
  // -140..-52 / lat 10..66, so it has no S. America and a truncated Canada; using
  // it as the base would leave ocean where that land belongs.)
  const worldTopo = usCrisp
    ? data.worldDetail
    : resolved.basemaps.world === 'detail'
      ? data.worldDetail
      : data.worldCoarse;
  const worldLayer = decodeLayer(worldTopo);
  // Crisp upgrade: `naLand` is 10m country land (vs the base's 50m) but clipped to
  // a North-America bbox. Swap a country's geometry to the crisp version ONLY when
  // its full (base) bounds lie inside that clip box — so contained neighbours
  // (Mexico, Central America, the Caribbean) sharpen to match the 10m states,
  // while countries the clip would truncate (Canada, Greenland) keep their full
  // base shape. Coast off-frame still bleeds; nothing is lost.
  if (usCrisp && data.naLand) {
    // NA clip bbox from the data build (scripts/build-map-data.mjs NA_BBOX).
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

  // Colouring dimension (AR4, bivariate): the score ramp and each tag group are
  // mutually-exclusive selectable groups. `SCORE_NAME` is the ramp's group name
  // (the metric label, or "Score"); the reserved token `score` also selects it.
  // Exactly one dimension is active and drives every region's fill.
  const SCORE_NAME = hasRamp
    ? resolved.directives.metric?.trim() || 'Score'
    : null;
  const matchColorGroup = (v: string): string | null => {
    const lv = v.trim().toLowerCase();
    if (lv === 'none') return null;
    if (SCORE_NAME && (lv === 'score' || lv === SCORE_NAME.toLowerCase()))
      return SCORE_NAME;
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
    // Default: colour by score when scores exist (preserves the historical
    // "score wins" default), else the first declared tag group.
    activeGroup =
      SCORE_NAME ??
      (resolved.tagGroups.length > 0 ? resolved.tagGroups[0]!.name : null);
  }
  const activeIsScore = SCORE_NAME !== null && activeGroup === SCORE_NAME;

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
    // Flat saturated tint (NOT the 25% shape default) so the category reads
    // clearly over the tinted land — see TAG_TINT_*.
    return mix(
      entry.color,
      palette.bg,
      isDark ? TAG_TINT_DARK : TAG_TINT_LIGHT
    );
  };

  /** A region's fill under the ACTIVE colouring dimension (AR4, bivariate):
   *  score-active → ramp for scored regions, neutral otherwise; a tag group
   *  active → that group's tag colour, neutral otherwise (score ignored). */
  const regionFill = (r: {
    score?: number;
    tags: Readonly<Record<string, string>>;
  }): string => {
    if (activeIsScore) {
      return r.score !== undefined ? fillForScore(r.score) : neutralFill;
    }
    return tagFill(r.tags, activeGroup) ?? neutralFill;
  };

  const regionById = new Map(resolved.regions.map((r) => [r.iso, r]));

  // -- Projection + fit (AR2, refined) --
  // For world projections we fit to the resolver's (padded, never-degenerate)
  // extent box — fitting to raw drawn points would collapse to a zero-size
  // target (single/coincident POIs → Infinity scale → NaN). albers-usa fits to
  // its own conus features (below).
  //
  // The extent outline sampled as a MultiPoint — NOT a Polygon. A hand-built
  // lat/lon rectangle's spherical winding is ambiguous to d3-geo, which can
  // read it as the whole-globe complement (→ tiny content framed on a world
  // map). Points have no interior/winding ambiguity, so fitExtent frames the
  // box exactly. We sample ALONG the four edges (not just the corners) because
  // a curved projection (natural-earth) bulges between corners — its widest x
  // is at the equator and its lowest/highest y at the central meridian, neither
  // of which is a corner. Fitting only corners under-frames the curve, so the
  // continents at the frame's top/bottom/sides spill off and clip (S. Africa,
  // Argentina, N. Russia). Equirectangular/mercator are linear, so the extra
  // samples are redundant-but-harmless there.
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
    // projects everything else — Canada, Mexico — around it, bleeding off the
    // canvas edges so there's no empty water band and no hard clip line.
    fitFeatures = [...usLayer.entries()]
      .filter(([iso]) => !US_NON_CONUS.has(iso))
      .map(([, f]) => f);
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
  const fitGB = geoBounds(fitTarget as never) as [
    [number, number],
    [number, number],
  ];
  const fitIsGlobal =
    fitGB[1][0] - fitGB[0][0] >= 270 || fitGB[1][1] - fitGB[0][1] >= 130;
  let path: GeoPath;
  let project: (lon: number, lat: number) => [number, number] | null;
  if (fitIsGlobal) {
    const cb = geoPath(projection).bounds(fitTarget as never);
    const bx0 = cb[0][0];
    const by0 = cb[0][1];
    const cw = cb[1][0] - bx0;
    const ch = cb[1][1] - by0;
    const ox = fitBox[0][0];
    const oy = fitBox[0][1];
    const sx = cw > 0 ? (fitBox[1][0] - ox) / cw : 1;
    const sy = ch > 0 ? (fitBox[1][1] - oy) / ch : 1;
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
  if (resolved.projection === 'albers-usa' && usLayer) {
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
    // Top edge for a box over [x0, xr]: a straight line PARALLEL to the local
    // coast (least-squares over the land samples), pushed down so it clears every
    // land sample by GAP. Parallel → uniform, maximal clearance for how close it
    // sits, tilting the way the coast tilts. Open-ocean samples are skipped, so a
    // box reaching past the coast isn't dragged down by water. Falls back to a
    // flat line just under the lowest land if the fit is underdetermined.
    const coastTop = (x0: number, xr: number): ((x: number) => number) => {
      const n = 24;
      const pts: Array<[number, number]> = [];
      let maxY = -Infinity;
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((xr - x0) * i) / n;
        const y = at(x);
        if (y > -Infinity) {
          pts.push([x, y]);
          if (y > maxY) maxY = y;
        }
      }
      if (pts.length === 0) return () => yB - height * 0.42; // all ocean
      let m = 0;
      if (pts.length >= 2) {
        let sx = 0,
          sy = 0,
          sxx = 0,
          sxy = 0;
        for (const [x, y] of pts) {
          sx += x;
          sy += y;
          sxx += x * x;
          sxy += x * y;
        }
        const den = pts.length * sxx - sx * sx;
        if (den !== 0) m = (pts.length * sxy - sx * sy) / den;
      }
      // Cap the tilt so a steep coast (e.g. California's) doesn't turn the box
      // into a tall triangle — keep it a compact, gently-angled quad.
      m = Math.max(-0.35, Math.min(0.35, m));
      let c = -Infinity; // raise the line until it clears every land sample + GAP
      for (const [x, y] of pts) {
        const need = y - m * x + GAP;
        if (need > c) c = need;
      }
      return (x: number) => m * x + c;
    };
    // A snug floating box that just contains the state, tucked up under the coast
    // with a coast-parallel slanted top. `iwReq` is the requested inner width.
    // Returns the box's right edge so the next inset can sit beside it.
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
      const top = coastTop(x0, xr);
      const yL = top(x0);
      const yR = top(xr);
      // Learn the state's height at this width, then size the box to just hold it.
      proj.fitWidth(iw, f as never);
      const bb = geoPath(proj).bounds(f as never);
      const sh = Number.isFinite(bb[0][0]) ? bb[1][1] - bb[0][1] : iw;
      // State sits below the lower top corner. If the coast runs so low the state
      // wouldn't fit above yB, raise the top (the corner stays over ocean) — the
      // box must never collapse and vanish.
      const needH = sh + 2 * PAD;
      let topFit = Math.max(yL, yR);
      const bottom = Math.min(topFit + needH, yB);
      if (bottom - topFit < needH) topFit = bottom - needH;
      const lift = topFit - Math.max(yL, yR); // keep the slanted top straight
      const topL = yL + lift;
      const topR = yR + lift;
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
        y: Math.min(topL, topR),
        w: xr - x0,
        h: bottom - Math.min(topL, topR),
        points: [
          [x0, topL],
          [xr, topR],
          [xr, bottom],
          [x0, bottom],
        ],
      });
      insetRegions.push({
        id: iso,
        d,
        fill,
        stroke: regionStroke,
        lineNumber,
        layer: 'us-state',
        ...(r?.score !== undefined && { score: r.score }),
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
    const akRight = placeInset(
      'US-AK',
      alaskaProjection(),
      FIT_PAD,
      width * 0.15
    );
    placeInset('US-HI', hawaiiProjection(), akRight + 24, width * 0.1);
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
  // Base cull box: the conus bounds for an albers fit (it frames all 48 states,
  // not the POI cluster), else the resolved data extent.
  const dataCullExtent = conusFit
    ? (geoBounds(fitTarget as never) as [[number, number], [number, number]])
    : resolved.extent;
  const dLonSpan = dataCullExtent[1][0] - dataCullExtent[0][0];
  const dLatSpan = dataCullExtent[1][1] - dataCullExtent[0][1];
  // A near-global view draws everything. (albers-usa is handled per-layer at the
  // pushRegionLayer calls: the world layer IS culled by the contiguous-US extent
  // so far countries don't project to frame-filling garbage, while the us-states
  // layer is NEVER culled so Alaska & Hawaii — far outside that extent — survive.)
  const isGlobalView = dLonSpan >= 270 || dLatSpan >= 130;
  // For a regional view, cull to what the canvas actually shows, not to the tight
  // data extent — so neighbour land that's on-screen but outside the data cluster
  // (Mexico, Central America, the Caribbean, southern Canada, …) still draws. The
  // visible geographic window is found by inverse-projecting a grid of screen
  // points. This applies to the albers-usa conus fit TOO: geoAlbersUsa projects
  // (and its own clipExtent trims) neighbour land continuously around the CONUS,
  // so the only thing keeping it off-canvas was the tight conus cull box. The
  // composite's invert returns sane lon/lat for the conus frame (and the AK/HI
  // inset corners invert to those states — harmless: they only widen the box, and
  // anything not actually visible is dropped by the per-ring overlap test or the
  // projection's clipExtent).
  let cullExtent = dataCullExtent;
  const invertFn = (
    projection as unknown as {
      invert?: (p: [number, number]) => [number, number] | null;
    }
  ).invert;
  if (!isGlobalView && invertFn) {
    let fW = Infinity,
      fE = -Infinity,
      fS = Infinity,
      fN = -Infinity,
      ok = 0;
    const N = 16;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = invertFn([(i / N) * width, (j / N) * height]);
        if (!p) continue;
        const [lon, lat] = p;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        ok++;
        if (lon < fW) fW = lon;
        if (lon > fE) fE = lon;
        if (lat < fS) fS = lat;
        if (lat > fN) fN = lat;
      }
    }
    // Use the frame only when enough samples inverted AND it's a sane regional
    // window (not a wrapped/near-global blow-up). Union with the base cull box so
    // the cluster / whole CONUS is always covered even if sampling under-covers it.
    if (ok >= 8 && fE - fW < 270 && fN - fS < 200) {
      cullExtent = [
        [
          Math.min(fW, dataCullExtent[0][0]),
          Math.min(fS, dataCullExtent[0][1]),
        ],
        [
          Math.max(fE, dataCullExtent[1][0]),
          Math.max(fN, dataCullExtent[1][1]),
        ],
      ];
    }
  }
  const usingFrameCull = cullExtent !== dataCullExtent;
  const [[exW, exS], [exE, exN]] = cullExtent;
  const lonSpan = exE - exW;
  const latSpan = exN - exS;
  // The frame box already bounds visibility, so it needs only a hairline pad; the
  // data/conus box still pads generously to admit edge-clipping coastlines.
  const padLon = usingFrameCull ? 2 : Math.max(8, lonSpan * 0.35);
  const padLat = usingFrameCull ? 2 : Math.max(8, latSpan * 0.35);
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
      if (layerKind === 'us-state' && usContext && INSET_STATES.has(iso))
        continue;
      // In a US view the us-states layer paints the whole country — drop the
      // redundant US country polygon underneath it (it only adds a coarser base
      // and a doubled outline).
      if (layerKind === 'country' && usContext && iso === 'US') continue;
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
        ...(isThisLayer && r.score !== undefined && { score: r.score }),
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
        stroke: 'none',
        lineNumber: -1,
        layer: 'base',
      });
    }
  }

  // Rivers (Amazon, Nile, Mississippi, …) as thin water lines over the land,
  // the SAME blue as the ocean/lakes so a river reads as continuous with the
  // water it drains into. Open paths: stroked, no fill; under POIs/edges/labels.
  const riverColor = water;
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
        color: mix(palette.text, palette.bg, 72),
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
        color: mix(palette.text, palette.bg, 66),
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

  // Region labels (default off). Rendered as haloed text — NO pill — so the
  // choropleth fill (which encodes the data) stays fully visible. The text
  // colour is contrast-picked against each region's OWN fill (dark on
  // pastel/unscored land, light on saturated fills) with an opposite-lightness
  // paint-order halo, the same convention POI labels use. A label is shown only
  // when its (padded) footprint fits inside the region, so small states like the
  // NE cluster auto-hide rather than overlap / spill onto the ocean.
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
    const color = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    const haloColor =
      color === palette.textOnFillLight
        ? palette.textOnFillDark
        : palette.textOnFillLight;
    labels.push({
      x,
      y,
      text,
      anchor: 'middle',
      color,
      halo: true,
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

  // -- Legend model (AR1: categorical via renderer's renderLegendD3) --
  let legend: MapLayoutLegend | null = null;
  if (!resolved.directives.noLegend) {
    const tagGroups = resolved.tagGroups.map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
    }));
    // Only the colouring dimensions (score ramp + tag groups) get a legend.
    // POI size and edge weight are self-evident from the marker/line scale and
    // intentionally carry no key.
    if (tagGroups.length > 0 || hasRamp) {
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
    legend,
    insets,
    insetRegions,
  };
}
