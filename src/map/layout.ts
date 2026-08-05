// Layout (step 4, part 1): ResolvedMap + MapData -> MapLayout. PURE + SYNC +
// DETERMINISTIC -- no DOM, no Math.random/Date. Decodes the basemap topology,
// builds the d3-geo projection chosen by the resolver, fits it to the screen,
// projects POIs/routes/edges, computes choropleth + categorical fills, scales
// POI radii + edge widths, and places labels with per-cluster collision
// escalation. The SVG emission is renderer.ts (it only draws what we compute).
// See spec section 24B.3-.7/.11 + the tech-spec Adversarial Review Resolutions AR1-AR9.
import { tagAttrKey } from '../utils/tag-groups';
import {
  geoPath,
  geoNaturalEarth1,
  geoEqualEarth,
  geoEquirectangular,
  geoConicEqualArea,
  geoMercator,
  geoBounds,
  geoTransform,
  type GeoProjection,
  type GeoPath,
} from 'd3-geo';
import { feature } from 'topojson-client';
import {
  mix,
  contrastRatio,
  relativeLuminance,
  politicalTints,
  valueRampColor,
} from '../palettes/color-utils';
import { buildAdjacency, featureBboxPrimary, pointInGeometry } from './geo';
import { assignColors } from './colorize';
import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes/types';
import {
  rectsOverlap,
  rectCircleOverlap,
  segmentRectOverlap,
  createLabelPlacement,
} from '../label-layout';
import type { LabelRect, PointCircle, Leader } from '../label-layout';
import { measureLegendText } from '../utils/legend-constants';
import { compactNumber } from '../utils/number-format';
import { TITLE_FONT_SIZE, TITLE_Y } from '../utils/title-constants';
import type { LegendMode } from '../utils/legend-types';
import { mapLegendBand, mapLegendBox } from './legend-band';
import type { MapLayoutLegend } from './types';
import type { DgmoError } from '../diagnostics';
import type { BoundaryTopology } from './data/types';
import type {
  MapData,
  ResolvedMap,
  ResolvedPoi,
  ResolvedEdge,
  ProjectionFamily,
  GeoExtent,
} from './resolved-types';
import {
  placeContextLabels,
  tierBand,
  labelBudget,
  MAX_COUNTRY_POSITIONS,
  COUNTRY_POS_GRID,
  COUNTRY_POS_TOPN_MARGIN,
} from './context-labels';
import type { CountryCandidate } from './context-labels';
import { layoutCityDots } from './city-dots';
import type { MapLayoutCityDot } from './city-dots';

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
// Fractional digits for projected path `d` coordinates. d3-geo defaults to 3
// (sub-micropixel at our canvas scale) — full-world detail geometry then emits
// multi-MB SVGs that bloat the page and overflow downstream HTML reparsers.
// One decimal is 0.1px: visually identical, ~half the coordinate bytes.
const PATH_DIGITS = 1;

// Screen-space vertex tolerance for thinning (px). Projected points within this
// distance of the previously kept point are dropped. Sub-pixel, so invisible.
const THIN_TOL = 0.6;

// albers-usa skew tolerance (canvas-aspect ÷ CONUS-projected-aspect, taken as the
// larger of the ratio and its reciprocal). The US national composite elides
// Alaska/Hawaii from the basemap and only re-adds them as corner insets when the
// map references them. When the render canvas aspect is close to CONUS's own
// projected aspect, that composite reads as a clean US map. But when a host forces
// an off-aspect canvas (the app preview pane), contain-fitting CONUS opens margins
// where the elided AK/HI used to sit — bare ocean painted exactly over Alaska's
// real landmass, a lie. Past this skew an unreferenced-AK/HI map falls back to a
// geographic conic (see albersSkewFallback). 1.25 keeps the national snap for
// roughly-CONUS-shaped canvases (incl. the headless 1.81:1 intrinsic export) and
// trips on the squarer/taller/wider panes that expose the gap.
const ALBERS_SKEW_MAX = 1.25;

interface ThinStream {
  stream: {
    point(x: number, y: number): void;
    lineStart(): void;
    lineEnd(): void;
  };
  _has?: boolean;
  _pending?: boolean;
  _ex?: number;
  _ey?: number;
  _lx?: number;
  _ly?: number;
}

/**
 * A geoTransform that thins projected vertices in screen space: it forwards a
 * point only when it lies more than THIN_TOL px from the last forwarded point.
 * Inserted just before the path serializer so it sees final screen coordinates,
 * it is scale-aware by construction — at world scale the dense 50m coastline
 * collapses to a few px-spaced vertices (the multi-MB bloat that overflows the
 * SSG HTML reparse), while a regional zoom spreads the same coastline over many
 * px so almost nothing is dropped (full detail preserved). The last vertex of
 * every ring is always emitted so polygon fills stay gap-free.
 */
function geoThin(): ReturnType<typeof geoTransform> {
  const tol2 = THIN_TOL * THIN_TOL;
  return geoTransform({
    lineStart(this: unknown) {
      const t = this as ThinStream;
      t._has = false;
      t._pending = false;
      t.stream.lineStart();
    },
    point(this: unknown, x: number, y: number) {
      const t = this as ThinStream;
      t._lx = x;
      t._ly = y;
      if (t._has) {
        const dx = x - (t._ex as number);
        const dy = y - (t._ey as number);
        if (dx * dx + dy * dy < tol2) {
          t._pending = true;
          return;
        }
      }
      t.stream.point(x, y);
      t._ex = x;
      t._ey = y;
      t._has = true;
      t._pending = false;
    },
    lineEnd(this: unknown) {
      const t = this as ThinStream;
      if (t._pending) t.stream.point(t._lx as number, t._ly as number);
      t._pending = false;
      t.stream.lineEnd();
    },
  });
}
const RAMP_FLOOR = 15; // % tint floor so min still reads as "low, present" (24B.3)
const R_DEFAULT = 6; // POI radius without size:
const R_MIN = 4;
const R_MAX = 22;
// Larger POIs fade their FILL so big bubbles read as light/airy instead of heavy
// solid slabs (overlaps stay legible); the stroke stays fully opaque so every
// marker keeps a crisp edge regardless of size. Gentle so the largest (= most
// important) marker still reads. Linear in radius over [R_MIN, R_MAX].
const POI_FILL_OPACITY_MAX = 0.92; // at R_MIN (smallest)
const POI_FILL_OPACITY_MIN = 0.55; // at R_MAX (largest)
const W_MIN = 1.25; // edge stroke width
const W_MAX = 8;
const FONT = 11; // on-map label font px

// A few countries have far-flung territory that drags the area-weighted centroid
// off the mainland (US → Alaska pulls it up into Canada). Anchor their world-layer
// label/hover point to a mainland [lon, lat] instead. Antimeridian crossers whose
// body dominates by area (Russia) are NOT listed — their area-weighted centroid
// already lands on the mainland; only the naive bounding-box centre (which the app
// previously used for hover) mistook the wrapped sliver for half the shape.
const WORLD_LABEL_ANCHORS: Record<string, [number, number]> = {
  US: [-98.5, 39.5], // CONUS geographic centre (near Lebanon, Kansas)
  // Russia crosses the antimeridian (Chukotka at ~170°W), so on a non-global
  // (e.g. Europe) projection its geometry smears across the whole frame and the
  // area-weighted centroid lands mid-map (over Europe) — useless as a label
  // anchor. Pin it to European Russia (~Volga) so a Europe view labels visible
  // western Russia on its eastern margin; on a world view this still sits over
  // Russian land. (See the curated-anchor smear-gate bypass in context-labels.)
  RU: [45, 58],
};
// POI-cluster hover-only gate (Decision #1). A ≥2-member cluster's callout
// column falls back to hover-only labels when it would sprawl or overflow:
//  - MAX_CLUSTER_EXTENT_FACTOR × min(width,height) = the px diagonal beyond which
//    a cluster is a sprawling chain (its leaders would fan across the map), not a
//    tight blob. Resolution-relative so the decision is stable across zoom — the
//    px threshold is computed per-render, NOT a constant.
//  - MAX_COLUMN_ROWS = the most rows a single column can stack readably.
// Exported for tests to drive the boundaries directly.
export const MAX_CLUSTER_EXTENT_FACTOR = 0.18;
export const MAX_COLUMN_ROWS = 7;
// WCAG ratio below which a region label needs a halo to read on its own fill.
// 4.5 = AA for normal text; mid-tone choropleth fills fall below this and get
// the rescue halo, while saturated/pastel fills (Texas, light land) clear it.
const REGION_LABEL_HALO_RATIO = 4.5;
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
// % palette-blue of bg for the ocean / backdrop — a faded blue, kept light
// enough not to compete with saturated blue/green data hues but distinctly
// bluer than the land so the sea reads as water rather than blank canvas.
const WATER_TINT_LIGHT = 24;
const WATER_TINT_DARK = 24;
const RIVER_WIDTH = 1.3; // px stroke width for river lines
// Compact breakpoint (decision D2): below this effective render width a wide
// extent reads as zoomed-out — prefer abbreviated region labels and suppress
// relief, regardless of geographic extent.
const COMPACT_WIDTH_PX = 480;
// Relief (mountain-range shading). A projected range below this px² area is
// dropped (no confetti slivers at world zoom).
const RELIEF_MIN_AREA = 12; // px²
// Each projected bbox side must clear this — drop near-degenerate slivers.
const RELIEF_MIN_DIM = 2; // px
// Relief = horizontal hachure lines clipped to each range: a subtle
// dark-on-light / light-on-dark texture that reads as "mountains here". Spacing
// is SCREEN-space so density is constant regardless of zoom (geo-space spacing
// would collapse a small range to 1–2 lines and read as a glitch). Drawn with a
// non-scaling stroke (constant device width at any zoom/DPR) and a low-contrast
// colour so it reads as faint, fine terrain hachure — dense thin lines that are
// almost indistinguishable as individual strokes (a whisper of texture, not
// stripes). NOT crispEdges — that snaps the stroke to a solid ~1px in WebKit and
// reads too heavy; plain AA keeps the lines soft. The width is kept just ABOVE
// sub-pixel: at ~0.15px the AA fuzz spreads each line to ~1px and tight spacing
// merges them into a flat grey wash (a "blob"). 0.25px every 1.5px stays a fine,
// faint hatch on both zoomed-out world maps and zoomed-in regional views.
const RELIEF_HATCH_SPACING = 1.5; // px between lines
const RELIEF_HATCH_WIDTH = 0.2; // px stroke
// % of the DARK reference (palette.bg on dark themes, palette.text on light)
// blended into the land colour — so the lines read DARKER than the land in both
// themes (palette.text alone flips to light on dark themes).
const RELIEF_HATCH_STRENGTH = 26;
// Coastline water-lines (opt-in `coastline`, §24B.2). N equal-width coast-parallel
// rings on the water side, evenly spaced and FADING seaward — the antique
// nautical-chart depth-contour look. Offshore distances + thickness are
// SCREEN-space FRACTIONS of min(w,h) so the rings stay a constant fraction of the
// canvas at ANY export size and ANY geographic extent (a decorative screen-space
// cue, not a geographic offset — ADR-3). Tuned faint, water-toned, low-contrast.
// minExtent = per-subpath degenerate-ring floor. Kept just above zero so EVERY
// island — down to the smallest specks — grows coast rings; it only drops
// sub-pixel/degenerate subpaths that would render nothing (R11). (Earlier it
// culled small islands to de-noise world maps, but every island should carry the
// nautical hashing, so the floor is now a bare degenerate guard.)
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
const COASTLINE_MIN_EXTENT = 0.0006; // degenerate-ring floor (frac of min dim)
const COASTLINE_MIN_EXTENT_GLOBAL = 0.0006; // same at world zoom — ring every island
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
const COLO_R = 9; // spiderfy ring radius floor (px)
const GOLDEN_ANGLE = 2.399963229728653; // rad (137.5deg) -- even spiral, no random
// Coincident-POI spiderfy (stacks): two dots "stack" when their centre distance is
// below (rA+rB)*STACK_OVERLAP — i.e. the markers visibly overlap. A ≥2-member stack
// collapses to a single ringed `+N` badge at rest and fans out on click; export
// renders the expanded fan directly (all labels visible). Distinct-but-dense
// clusters (centres farther than combined radii) are untouched — current behavior.
const STACK_OVERLAP = 1.0; // overlap factor for the coincidence threshold
const STACK_RING_MAX = 8; // ≤ this many → even circle; more → golden-angle spiral
const STACK_RING_GAP = 4; // px min gap between adjacent expanded dots
const FAN_STEP = 16; // px perpendicular offset between parallel edges
const ARC_CURVE_FRAC = 0.18; // default arc bow as a fraction of leg length

export interface MapLayoutRegion {
  readonly id: string; // iso
  readonly d: string; // SVG path data
  readonly fill: string;
  readonly stroke: string;
  /** Human-readable display name (e.g. "France", "California"). Set for EVERY
   *  region — authored and base/context alike — and emitted as
   *  `data-region-name` so the app can show it on hover. */
  readonly label?: string;
  readonly lineNumber: number;
  readonly layer: 'base' | 'country' | 'us-state';
  /** The region's value (if any) — emitted as `data-value` so the app can
   *  highlight by gradient-scrub proximity. */
  readonly value?: number;
  /** The region's tag values keyed by group (lowercased) — emitted as
   *  `data-tag-<group>` so the app can highlight on legend-entry hover. */
  readonly tags?: Readonly<Record<string, string>>;
  /** Area-weighted screen centroid (px) of the DRAWN geometry — emitted as
   *  `data-label-x`/`data-label-y` so the app can anchor the hover label here
   *  instead of the path's bounding-box centre. The bbox centre breaks for
   *  antimeridian crossers (Russia's wrapped Chukotka sliver pins the box's left
   *  edge to the far side of the map, dropping the centre into the Atlantic); the
   *  area-weighted centroid stays on the body. Honours WORLD_LABEL_ANCHORS. */
  readonly labelX?: number;
  readonly labelY?: number;
  /** Screen-space bounding box `[minX, minY, maxX, maxY]` of the drawn path,
   *  computed once in `layoutMap` (reusing the `fillAt` hit-target parse) so the
   *  renderer's per-POI-label region cull doesn't re-parse every path string per
   *  label blob. Absent only if the layout was built before this field existed —
   *  the renderer falls back to parsing `d`. */
  bbox?: readonly [number, number, number, number];
  /** Parsed screen-space rings of `d`, computed once in `layoutMap` (the same
   *  `fillAt` hit-target parse as `bbox`) so the renderer's coastline buffering
   *  doesn't re-parse every region path on every render. Absent only for layouts
   *  predating this field — callers fall back to `parsePathRings(d)`. */
  rings?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
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
  /** Neighbour land (e.g. Canada beside Alaska) projected with this inset's
   *  fitted projection and clipped to the box — drawn BEHIND the state so a land
   *  border reads as land, not coast. Without it the state's outer ring buffers
   *  outward over open box-ocean and the land border sprouts coastline rings.
   *  `undefined` when no neighbour land falls inside the box. */
  readonly contextLand?: { readonly d: string; readonly fill: string };
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
  /** Fill opacity scaled by radius — larger bubbles fade so they read as light
   *  rather than heavy. Stroke stays fully opaque (crisp edge at every size). */
  readonly fillOpacity: number;
  readonly stroke: string;
  readonly lineNumber: number;
  readonly implicit: boolean;
  readonly isOrigin: boolean; // route origin -> distinct marker
  readonly routeNumber?: number; // route stop badge
  /** Tag values keyed by lowercased group name — emitted as `data-tag-<group>`
   *  so the app can spotlight markers on legend-entry hover (mirrors regions). */
  readonly tags?: Readonly<Record<string, string>>;
  /** Set when this marker is a member of a coincident stack (spiderfy). Its
   *  `cx/cy` is the EXPANDED ring position (the source-of-truth used by export +
   *  the no-JS default); the app collapses the stack to a single badge at rest
   *  via `data-cluster-member`. */
  readonly clusterId?: string;
}

/** A coincident POI stack (≥2 markers whose dots overlap). Laid out EXPANDED
 *  (members fanned onto a ring/spiral with legs to the centroid) — that geometry
 *  is the source of truth: a static export shows every member + label with no
 *  special-casing. The renderer ALSO emits a collapsed `+N`-style badge (a neutral
 *  dot ringed with the bare count) at the centroid, hidden by default; the app
 *  collapses each stack at rest (hide members, show badge) and expands on click. */
export interface MapLayoutCluster {
  /** Stable id (the first member's POI id). Mirrored on member dots/labels/legs as
   *  `data-cluster-member` and on the badge as `data-cluster`. */
  readonly id: string;
  /** Centroid (collapsed badge position + spider-leg hub). */
  readonly cx: number;
  readonly cy: number;
  /** Member count = badge text (bare `N`, RQ1). */
  readonly count: number;
  /** Radius of the transparent pointer hit-area centred on the centroid — covers
   *  the collapsed badge AND the expanded dot ring so a hover/click anywhere over
   *  the stack drives the spiderfy controller. */
  readonly hitR: number;
  /** Spider legs: centroid → each expanded member dot (member's own colour). */
  readonly legs: ReadonlyArray<{
    readonly x2: number;
    readonly y2: number;
    readonly color: string;
  }>;
}

/** A drawn connector -- an edge or a route leg (same geometry contract). */
export interface MapLayoutLeg {
  readonly d: string;
  readonly width: number;
  readonly color: string;
  readonly arrow: boolean;
  /** Endpoint POI ids (resolved `fromId`/`toId`), emitted as `data-from-id` /
   *  `data-to-id`. Lets an interactive preview co-highlight a leg's two endpoint
   *  POIs when the leg is focused (§17 sync). */
  readonly fromId: string;
  readonly toId: string;
  /** Tag values (keyed by lowercased group name) — emitted as `data-tag-*`, like
   *  POI markers, so a legend-entry hover spotlights only the matching lines
   *  (§24B.6). Omitted when the leg carries no tag. */
  readonly tags?: Readonly<Record<string, string>>;
  readonly label?: string;
  /** The leg's numeric weight (the `width:` metadata) when present and positive.
   *  Drives {@link width}, but kept here verbatim so the renderer can surface it
   *  on hover (a `<title>` tooltip) — the width alone is lossy. */
  readonly value?: number;
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
  /** Per-label font size in px. Set on context COUNTRY labels, which scale up with
   *  their projected footprint (a big country reads as a faded backdrop name, a
   *  small one stays at the base label font). Absent ⇒ the renderer's default
   *  LABEL_FONT, so every other label type renders byte-identically. */
  readonly fontSize?: number;
  /** Cartographic italic (context-label water names, §24B). Default upright. */
  readonly italic?: boolean;
  /** Cartographic letter-spacing in px (context-label water names). Default 0. */
  readonly letterSpacing?: number;
  /** Pre-wrapped display lines (context-label water names — §24B). When present
   *  the renderer stacks these as centred tspans instead of `text`; `text` keeps
   *  the single-string form for hit-testing/measurement. Absent ⇒ single line. */
  readonly lines?: readonly string[];
  /** Hover-only label: emitted invisible (opacity 0 + `data-poi-hidden`) in the
   *  preview and revealed on POI/label hover; OMITTED entirely from static
   *  export. Set when a POI cluster can't place its labels cleanly (see the
   *  extent/count/clean gate in the POI-label block). Default-undefined =
   *  visible. Hidden labels are NOT pushed into `obstacles`. */
  readonly hidden?: boolean;
  /** Set when this label belongs to a coincident-stack member (spiderfy). Emitted
   *  visible (export + expanded view) but tagged `data-cluster-member` so the app
   *  hides it when the stack is collapsed to its badge. */
  readonly clusterMember?: string;
  /** A choropleth region's metric VALUE (already compact-formatted, e.g. `39.5M`),
   *  drawn as a smaller, dimmer second line UNDER `text` (the region name). Set
   *  only on region labels of a `region-heat` map when `no-region-heat-value` is off.
   *  The renderer stacks it as a sub-line; absent ⇒ single name line. */
  readonly valueLine?: string;
  /** A region too small to carry its name+value stack in place gets a leader-lined
   *  callout in a margin column; this marks the region's true centroid so the
   *  renderer draws a small anchor dot there (the leader runs dot → chip). The
   *  colour is the region's fill, tying the dot/leader/chip together. */
  readonly calloutDot?: { x: number; y: number; color: string };
  readonly lineNumber: number;
}

// MapLayoutLegend now lives in ./types (imported for local use + re-exported
// below) so that ./legend-band can consume the type without importing this
// module, which would re-introduce the layout↔legend-band cycle (this module
// value-imports mapLegendBand from ./legend-band).
export type { MapLayoutLegend };

export type { MapLayoutCityDot };

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
  /** Subtle gazetteer city dots for orientation (empty when `no-cities` or no
   *  cities fall on-canvas). Drawn over the basemap, under connectors/POIs. */
  readonly cityDots: readonly MapLayoutCityDot[];
  /** Coincident POI stacks (spiderfy). Empty when no ≥2-member overlap exists.
   *  The renderer draws a collapsed badge per stack; the app collapses/expands. */
  readonly clusters: readonly MapLayoutCluster[];
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
  /** Generic layout-time diagnostics channel — currently has no producers, so it
   *  is always empty. Kept wired up because callers merge it with the resolver's
   *  diagnostics for the editor lint channel. */
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
  /** Which legend variant gets drawn — `'export'` shows only the active group,
   *  `'preview'` keeps inactive pills. Used to size the reserved legend band so
   *  the projected land starts below the legend. Defaults to `'preview'`. */
  readonly legendMode?: LegendMode;
  /** INTERNAL (set by layoutMap's own second pass — do not pass in). When tiny
   *  valued regions need margin callouts, the first pass measures them and
   *  re-runs with reserved bands: the projection fits into the canvas MINUS these
   *  bands so the data shrinks/shifts inward, opening label room. A cluster on
   *  EACH side reserves its own band (px), so tiny regions on both coasts each get
   *  a column. An absent side reserves nothing there. Also carries the POI
   *  edge-clearance bands (any of the four sides) measured by the POI-label pass
   *  (same fit-box mechanism). Region callouts only ever set left/right. */
  readonly _calloutReserve?: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
  /** INTERNAL (set by layoutMap's own POI-clearance pass — do not pass in). After
   *  POI-label placement, any POI dot/label crossing the edge-clearance band
   *  triggers a re-fit that ADDS the residual intrusion to the reserved band on
   *  that side, sliding the data inward. Re-measured each pass and accumulated
   *  until nothing intrudes (or the pass cap), so a tight cluster on a small canvas
   *  converges instead of giving up after one under-shoot. This counts the passes
   *  taken to bound the recursion. */
  readonly _poiClearancePass?: number;
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

/** Combine two decoded features that share an ISO id into one MultiPolygon — so a
 *  country split across multiple topology geometries (e.g. na-land's `FR`) draws
 *  all its parts rather than only the last. Polygon/MultiPolygon coordinates are
 *  flattened into a single MultiPolygon ring list; a feature whose geometry is
 *  neither is returned unchanged (nothing sensible to merge). */
function mergeFeatures(a: GeoFeature, b: GeoFeature): GeoFeature {
  const polysOf = (f: GeoFeature): number[][][][] | null => {
    const g = f.geometry as { type?: string; coordinates?: unknown } | null;
    if (!g) return null;
    if (g.type === 'Polygon') return [g.coordinates as number[][][]];
    if (g.type === 'MultiPolygon') return g.coordinates as number[][][][];
    return null;
  };
  const pa = polysOf(a);
  const pb = polysOf(b);
  if (!pa || !pb) return a; // can't merge non-polygonal geometry — keep the first
  return {
    ...a,
    geometry: { type: 'MultiPolygon', coordinates: [...pa, ...pb] },
  };
}

/** Decode every feature of a topology into GeoJSON, keyed by ISO id. Memoized by
 *  topology identity — the returned map is shared, so do NOT mutate it (copy first
 *  if you need to). Natural-Earth source carries hazards this guards against: a
 *  null-geometry sovereignty stub tagged with a real ISO code (e.g. "Ashmore and
 *  Cartier Is." shares `AU` with Australia) would otherwise CLOBBER the real
 *  country's geometry — `set` keeps the last write. So null geometries are
 *  skipped, and a genuine duplicate id (two real geometries, e.g. na-land `FR`)
 *  is MERGED into one MultiPolygon instead of one part overwriting the other. */
function decodeLayer(topo: BoundaryTopology): Map<string, GeoFeature> {
  const cached = decodeCache.get(topo);
  if (cached) return cached;
  const out = new Map<string, GeoFeature>();
  for (const g of geomObject(topo).geometries) {
    const f = feature(topo as never, g as never) as unknown as GeoFeature;
    if (!f.geometry) continue; // null-geometry stub — never renders, must not clobber
    const tagged = { ...f, id: g.id };
    const existing = out.get(g.id);
    out.set(g.id, existing ? mergeFeatures(existing, tagged) : tagged);
  }
  decodeCache.set(topo, out);
  return out;
}

/** Generate ordered interior label positions for a country, screen-projected and
 *  best-first, so its context label can DODGE a colliding data cluster onto open
 *  ground on its own land (map-context-neighbor-labels, Opt F). PURE +
 *  DETERMINISTIC — the geo work that the pure context-labels module must not do.
 *
 *  Algorithm (D8/D9): lay a `COUNTRY_POS_GRID²` lon/lat grid over the feature's
 *  geographic bbox; keep cells that are (a) on the country's OWN rendered geometry
 *  (`pointInGeometry` — holes-aware, so neighbours AND enclaves are rejected) and
 *  (b) project to a finite point inside the viewport (its visible lobe). Order the
 *  kept cells: the most-interior cell (most on-land 8-grid-neighbours, tie-broken
 *  by proximity to the visible centroid) leads, then a greedy max-min spread of the
 *  rest so fallbacks actually dodge. A `curated` lon/lat (WORLD_LABEL_ANCHORS) is
 *  forced to slot 0 with grid cells filling the rest (D13).
 *
 *  Returns `{ lonLat, screen }[]` (≤ MAX_COUNTRY_POSITIONS), or `[]` when the
 *  geometry yields no valid in-frame position (caller falls back to the single
 *  centroid anchor, D11). The `lonLat` is exposed so tests can verify on-own-land
 *  containment with an INDEPENDENT oracle (not a re-call of the acceptance test). */
export function countryLabelPositions(args: {
  geometry: unknown;
  bounds: readonly [readonly [number, number], readonly [number, number]];
  project: (lon: number, lat: number) => [number, number] | null;
  width: number;
  height: number;
  curated?: readonly [number, number] | null;
}): { lonLat: [number, number]; screen: [number, number] }[] {
  const { geometry, bounds, project, width, height, curated } = args;
  const w0 = bounds[0][0];
  const s0 = bounds[0][1];
  const e0 = bounds[1][0];
  const n0 = bounds[1][1];
  // Bail on non-finite, antimeridian-wrapping (e0 < w0 — NE crossers ship seam-split,
  // but a feature whose own bbox still wraps falls back to the single anchor), or
  // degenerate (zero-span) bboxes — the grid math needs a positive lon/lat span. `<=`
  // makes the zero-span case explicit rather than relying on downstream emptiness
  // (D9/D11).
  if (![w0, s0, e0, n0].every(Number.isFinite) || e0 <= w0 || n0 <= s0) {
    return mkCurated(curated, project);
  }
  const N = COUNTRY_POS_GRID;
  // onLand[i][j]: cell centre is on the country's own geometry (for interiorness).
  const onLand: boolean[][] = [];
  type Cell = {
    i: number;
    j: number;
    lon: number;
    lat: number;
    sx: number;
    sy: number;
  };
  const kept: Cell[] = [];
  for (let i = 0; i < N; i++) {
    onLand[i] = [];
    const lon = w0 + ((i + 0.5) / N) * (e0 - w0);
    for (let j = 0; j < N; j++) {
      const lat = s0 + ((j + 0.5) / N) * (n0 - s0);
      const land = pointInGeometry(geometry, lon, lat);
      onLand[i]![j] = land;
      if (!land) continue;
      const p = project(lon, lat);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      // Only the visible lobe: an off-frame cell can never host a fitting label.
      if (p[0] < 0 || p[0] > width || p[1] < 0 || p[1] > height) continue;
      kept.push({ i, j, lon, lat, sx: p[0], sy: p[1] });
    }
  }
  if (!kept.length) return mkCurated(curated, project);
  // Visible centroid (mean of kept screen points) — tie-breaks interiorness toward
  // the country's in-frame mass.
  const cx = kept.reduce((s, c) => s + c.sx, 0) / kept.length;
  const cy = kept.reduce((s, c) => s + c.sy, 0) / kept.length;
  const interiorness = (c: Cell): number => {
    let n = 0;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        const ni = c.i + di;
        const nj = c.j + dj;
        if (ni >= 0 && ni < N && nj >= 0 && nj < N && onLand[ni]![nj]) n++;
      }
    return n;
  };
  const dist2ToCentre = (c: Cell): number =>
    (c.sx - cx) ** 2 + (c.sy - cy) ** 2;
  // Center on the visible region FIRST (what a human does): the label's home is
  // the centroid of the country's in-frame land. The caller tries positions in
  // order and commits the first that clears every obstacle, so a well-centred
  // anchor that's clear wins outright, and only an awkward case (a POI or the
  // legend sitting on the centroid) falls back to the on-land grid cells — which
  // are interior-first, NOT scattered to far corners. The centroid leads ONLY
  // when it actually sits on the country's own land (so the on-land invariant
  // holds); a concave country whose centroid lands off its body falls straight
  // to the grid.
  const centreLon = kept.reduce((s, c) => s + c.lon, 0) / kept.length;
  const centreLat = kept.reduce((s, c) => s + c.lat, 0) / kept.length;
  const centreScreen = project(centreLon, centreLat);
  const lead =
    pointInGeometry(geometry, centreLon, centreLat) &&
    centreScreen &&
    Number.isFinite(centreScreen[0]) &&
    Number.isFinite(centreScreen[1]) &&
    centreScreen[0] >= 0 &&
    centreScreen[0] <= width &&
    centreScreen[1] >= 0 &&
    centreScreen[1] <= height
      ? [
          {
            lonLat: [centreLon, centreLat] as [number, number],
            screen: [centreScreen[0], centreScreen[1]] as [number, number],
          },
        ]
      : [];
  // On-land grid cells, most-interior first (tie → nearest the visible centroid).
  const grid = [...kept]
    .sort(
      (a, b) =>
        interiorness(b) - interiorness(a) || dist2ToCentre(a) - dist2ToCentre(b)
    )
    .map((c) => ({
      lonLat: [c.lon, c.lat] as [number, number],
      screen: [c.sx, c.sy] as [number, number],
    }));
  // Curated anchor (D13): forced to slot 0 when present (a trusted mainland
  // point, e.g. Russia → European Russia).
  const curatedPos = curated
    ? mkCurated(curated, project)
    : ([] as { lonLat: [number, number]; screen: [number, number] }[]);
  return [...curatedPos, ...lead, ...grid].slice(0, MAX_COUNTRY_POSITIONS);
}

/** Project a single curated lon/lat into the position-list shape (or [] when it
 *  doesn't project finitely). Helper for `countryLabelPositions`. */
function mkCurated(
  curated: readonly [number, number] | null | undefined,
  project: (lon: number, lat: number) => [number, number] | null
): { lonLat: [number, number]; screen: [number, number] }[] {
  if (!curated) return [];
  const p = project(curated[0], curated[1]);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return [];
  return [{ lonLat: [curated[0], curated[1]], screen: [p[0], p[1]] }];
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

function projectionFor(
  family: ProjectionFamily,
  extent: GeoExtent
): GeoProjection {
  switch (family) {
    case 'albers-usa':
      return usConusProjection();
    case 'conic-equal-area': {
      // Albers for a single continent: standard parallels at 1/6 and 5/6 of the
      // extent's latitude band (distortion-minimizing), centered on the band's
      // mid-latitude. Longitude centering is handled by the shared .rotate below.
      const s = extent[0][1];
      const n = extent[1][1];
      return geoConicEqualArea()
        .parallels([s + (n - s) / 6, s + ((n - s) * 5) / 6])
        .center([0, (s + n) / 2]);
    }
    case 'mercator':
      return geoMercator();
    case 'equal-earth':
      // Equal-area pseudocylindrical: areas stay honest so a choropleth's shading
      // isn't distorted by projection (the default for *data* world maps).
      return geoEqualEarth();
    case 'equirectangular':
      // Plate carrée: straight lat/lon grid, fully rectangular frame. The default
      // for dataless *reference* world maps — a clean conventional wall-map look.
      return geoEquirectangular();
    case 'natural-earth':
      // Curved pseudocylindrical compromise. Retained for completeness; areas are
      // only approximately preserved.
      return geoNaturalEarth1();
    default:
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
/** US states that visually abut a foreign country (Canada `CA` / Mexico `MX`) in
 *  the drawn map — a fixed, extent-independent geographic fact. Used ONLY by the
 *  colorize pass to bridge the US-states and world topologies (which share no
 *  TopoJSON arcs) so a border state never shares a hue with the country it touches
 *  (§24B colorize). Great-Lakes water-gap states (OH/PA) are excluded — they don't
 *  visually touch Canada's drawn polygon. */
const FOREIGN_BORDER: Readonly<Record<string, readonly string[]>> = {
  CA: [
    'US-AK',
    'US-WA',
    'US-ID',
    'US-MT',
    'US-ND',
    'US-MN',
    'US-MI',
    'US-NY',
    'US-VT',
    'US-NH',
    'US-ME',
  ],
  MX: ['US-CA', 'US-AZ', 'US-NM', 'US-TX'],
};

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
  /** The RAW world topology `worldLayer` derives from (coarse vs detail). Carried
   *  out so the colorize pass can build arc-adjacency on the same source the
   *  drawn countries came from — memoized on this stable asset object. */
  readonly worldTopo: BoundaryTopology;
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
  // Crisp NA assets apply to BOTH the national albers-usa view AND a regional US
  // mercator view (POI-only region framing — e.g. a single state — OR a compact
  // region/choropleth that auto-zooms; map-us-subnational-zoom, both mercator). A
  // US-oriented mercator frame is sub-world and entirely within North America by
  // construction, so the NA-clipped 10m land/lakes fit it; the bbox guard below
  // still keeps non-NA countries on world geometry. Excludes equirectangular
  // (a world US-states choropleth) where the NA clip would crop the globe.
  const usCrisp =
    (resolved.projection === 'albers-usa' ||
      resolved.projection === 'mercator') &&
    wantsUsStates &&
    !!data.naLand;
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
      // Keep the base feature's `properties` (the country name) — the crisp
      // `naLand` geometry carries none, and the context-label layer reads the
      // name from here. Without this the label falls back to the bare ISO code.
      if (bw >= nbW && be <= nbE && bs >= nbS && bn <= nbN)
        worldLayer.set(iso, { ...cf, properties: base.properties });
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

  const projection = projectionFor(resolved.projection, resolved.extent);
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
    worldTopo,
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

/** Drop antimeridian wrap-slivers from a GLOBAL-view region path. A landmass that
 *  crosses ±180° (Russia's Chukotka, the western Aleutians, Fiji…) is clipped into
 *  fragments; the far one is a small sliver pinned to the OPPOSITE vertical frame
 *  edge — it reads as a stray island floating beside its true continent (e.g. the
 *  "island left of Alaska"). We drop any ring that (a) has an edge collinear with
 *  the LEFT or RIGHT canvas edge AND (b) is small AND (c) isn't the region's
 *  largest ring. The mainland (large, on its own edge) and interior islands (not
 *  frame-cut) are kept. Vertical edges only — a ring cut by the top/bottom lat
 *  crop is real content, not a wrap. Global-only: regional clipExtent cuts ARE
 *  real land at the viewport edge and must survive. */
function dropAntimeridianWrapSlivers(
  d: string,
  width: number,
  height: number
): string {
  const rings = parsePathRings(d);
  if (rings.length <= 1) return d;
  const eps = 0.75;
  const minArea = 0.003 * width * height; // 0.3% of canvas
  const ringArea = (r: ReadonlyArray<[number, number]>): number => {
    let s = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  };
  const areas = rings.map(ringArea);
  const maxArea = Math.max(...areas);
  const onVEdge = (
    a: readonly [number, number],
    b: readonly [number, number]
  ): boolean =>
    (Math.abs(a[0]) <= eps && Math.abs(b[0]) <= eps) ||
    (Math.abs(a[0] - width) <= eps && Math.abs(b[0] - width) <= eps);
  let dropped = false;
  const kept = rings.filter((r, idx) => {
    if (areas[idx]! >= maxArea || areas[idx]! >= minArea) return true;
    const touches = r.some((p, i) => onVEdge(p, r[(i + 1) % r.length]!));
    if (touches) {
      dropped = true;
      return false;
    }
    return true;
  });
  if (!dropped) return d;
  return kept
    .map(
      (r) => r.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join('') + 'Z'
    )
    .join('');
}

/** True when an `albers-usa` map should fall back to a geographic conic for this
 *  canvas: the map references neither Alaska nor Hawaii (so the composite draws no
 *  inset for them) AND the canvas aspect is skewed far enough from CONUS's own
 *  projected aspect that contain-fitting CONUS would expose bare ocean where the
 *  elided AK/HI landmass projects — the "water where Alaska is" lie. conic-equal-
 *  area (framed on the data extent) instead draws every landmass in true position,
 *  so Alaska is honestly off-frame rather than faked as sea. Referenced AK/HI keep
 *  albers-usa (its inset boxes are the right tool); near-CONUS aspects keep the
 *  national snap. Aspect comparison is chrome-free (raw width/height vs raw CONUS
 *  bounds) so the headless intrinsic export — sized AT the CONUS aspect — never
 *  trips. Exported for unit tests. */
export function albersSkewFallback(
  resolved: ResolvedMap,
  data: MapData,
  width: number,
  height: number
): boolean {
  if (resolved.projection !== 'albers-usa') return false;
  if (!resolved.basemaps.subdivisions.includes('us-states')) return false;
  if (!(width > 0) || !(height > 0)) return false;
  const akRef =
    resolved.regions.some((r) => r.iso === 'US-AK') ||
    resolved.pois.some((p) => inAlaska(p.lon, p.lat));
  const hiRef =
    resolved.regions.some((r) => r.iso === 'US-HI') ||
    resolved.pois.some((p) => inHawaii(p.lon, p.lat));
  if (akRef || hiRef) return false;
  const { projection, fitTarget, usLayer } = buildMapProjection(resolved, data);
  // The lie only exists when a real CONUS basemap is drawn and elides AK/HI. With
  // no contiguous state geometry there's nothing to elide (and no CONUS aspect to
  // measure meaningfully), so leave the projection alone.
  if (!usLayer || ![...usLayer.keys()].some((iso) => !US_NON_CONUS.has(iso)))
    return false;
  // Project the CONUS fit target to a unit square and read its bounds aspect. This
  // throwaway projection is discarded — layoutMap fits its own afresh.
  projection.fitSize([1000, 1000], fitTarget as never);
  const b = geoPath(projection).bounds(fitTarget as never);
  const conusAspect = (b[1][0] - b[0][0]) / (b[1][1] - b[0][1]);
  if (!(conusAspect > 0)) return false;
  const canvasAspect = width / height;
  const skew = Math.max(canvasAspect / conusAspect, conusAspect / canvasAspect);
  return skew > ALBERS_SKEW_MAX;
}

// ── Region-geometry memo (recolor fast-path) ──────────────────────────────
// The projected region path + label centroid depend ONLY on the fit and the
// source feature — never on palette, theme, or the active colouring group. The
// app re-runs `layoutMap` on every recolor (theme toggle, legend flip), which
// otherwise re-projects ~700 country/state polygons (the single dominant layout
// cost, ~14ms on a world map). This memo reuses that geometry when the fit is
// unchanged.
//
// Correctness hinges on the key: it is the ACTUAL post-fit projection transform
// (sampled via probe points pushed through the same `project` closure the
// geometry uses), NOT the render options. So a recolor that leaves the fit
// alone hits; a flip that resizes the legend → moves `topPad` → re-fits the
// projection produces different probes → misses and recomputes. The internal
// callout-reserve passes (which re-fit, then recurse) each get their own key and
// reproduce identically on the next render. Keyed by the ORIGINAL `resolvedIn`
// reference (the app `useMemo`s it on content, so it is stable across recolor
// and replaced on edit), so a content edit is a fresh bucket and the old one is
// GC'd. One-shot callers (CLI/MCP/SSG) populate but never re-read — negligible.
type CachedRegionGeo = {
  d: string;
  cx: number | undefined;
  cy: number | undefined;
};
const REGION_GEO_MEMO = new WeakMap<
  ResolvedMap,
  Map<string, Map<string, CachedRegionGeo | null>>
>();
// Bound per-map growth (each distinct fit — resize step, reserve pass — is a key).
const REGION_GEO_MAX_FITS = 8;
function regionGeoBucket(
  resolved: ResolvedMap,
  projKey: string
): Map<string, CachedRegionGeo | null> {
  let byFit = REGION_GEO_MEMO.get(resolved);
  if (!byFit) {
    byFit = new Map();
    REGION_GEO_MEMO.set(resolved, byFit);
  }
  let bucket = byFit.get(projKey);
  if (!bucket) {
    bucket = new Map();
    byFit.set(projKey, bucket);
    if (byFit.size > REGION_GEO_MAX_FITS) {
      const oldest = byFit.keys().next().value; // insertion order → FIFO evict
      if (oldest !== undefined) byFit.delete(oldest);
    }
  }
  return bucket;
}

export function layoutMap(
  resolvedIn: ResolvedMap,
  data: MapData,
  size: Size,
  opts: LayoutOptions
): MapLayout {
  const { palette, isDark } = opts;
  const { width, height } = size;
  // §24B.2 addendum — swap the US national composite for a geographic conic when
  // the canvas skew would otherwise paint ocean over Alaska's real position. All
  // downstream branches key off `resolved.projection`, so reassigning the local
  // here (the renderer never reads `resolved.projection`) flips the whole pipeline
  // to the honest projection in one place.
  let resolved = resolvedIn;
  if (albersSkewFallback(resolved, data, width, height)) {
    resolved = { ...resolved, projection: 'conic-equal-area' };
  }

  // -- Projection, fit target & basemap decode (shared with mapContentAspect so
  // the export canvas aspect matches the drawn geometry — see buildMapProjection).
  // The projection here has .rotate applied but NOT .fitExtent (done below, as it
  // depends on canvas width/height). --
  const {
    projection,
    fitTarget,
    fitIsGlobal,
    worldLayer,
    usLayer,
    usCrisp,
    worldTopo,
  } = buildMapProjection(resolved, data);

  const usContext = usLayer !== null;
  // Basemap fills (`water` / `neutralFill` / `foreignFill`) depend on whether a
  // colouring dimension is active — defined below, once `activeGroup` is known.
  // Region borders. Light theme: a near-text dark outline (a dark hairline
  // reads well over the pale ground). Dark theme: a near-bg dark outline
  // vanishes against the deep ground, so instead lean on the palette's
  // dedicated `border` grid-line token (tuned to pop against that ground) and
  // nudge it toward `text` for a touch more lift — a visible boundary that
  // still reads as a line, not a glaring white seam over the land fills.
  const regionStroke = isDark
    ? mix(palette.border, palette.text, 65) // dark theme: lifted grid-line
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
  // Ramp auto-fits (the `scale` directive is gone) to data-min→data-max — the
  // low end anchors at the lowest value, not 0. This maximises within-map
  // dynamic range and matches the size/thickness metric ramps (poi-size,
  // flow-width), which already floor at their data minimum. Cross-map low-end
  // comparability (the old 0-anchor, "decision C") is intentionally dropped: a
  // shared baseline only helped side-by-side maps and flattened single-map
  // contrast. Equal-value data (rampMin === rampMax) falls back to t = 1 below.
  const rampMin = values.length > 0 ? Math.min(...values) : 0;
  const rampMax = Math.max(...values);
  // Value ramp defaults to red so valued regions stand out against the blue
  // water (palette.primary is a blue in most palettes and would blend in). A
  // trailing color on `region-heat` (§24B.3) overrides the hue idiomatically.
  const rampHue =
    resolveColor(resolved.directives.regionMetricColor ?? '', palette) ??
    palette.colors.red;
  // Explicit LOW endpoint (`region-heat Sales green red`). Only the 11
  // recognized names peel, so resolveColor always succeeds when a name is
  // present; absent ⇒ single-colour behaviour (neutral low). §24B.3.
  const rampLow = resolved.directives.regionMetricLowColor
    ? (resolveColor(resolved.directives.regionMetricLowColor, palette) ??
      undefined)
    : undefined;
  const hasRamp = values.length > 0;

  // Colouring dimension (AR4, bivariate): the value ramp and each tag group are
  // mutually-exclusive selectable groups. `VALUE_NAME` is the ramp's group name
  // (the region-heat label, or "Value"). Exactly one dimension is active and
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
  // A tag group is a "fill group" only if its alias actually lands on a region
  // or a POI. A group used solely on connector lines (§24B.6) colours edges,
  // never the basemap — so it must not drive the region/active-tag dress or
  // suppress colorize.
  const fillGroupNames = new Set<string>();
  for (const g of resolved.tagGroups) {
    const k = g.name.toLowerCase();
    if (
      resolved.regions.some((r) => r.tags[k]) ||
      resolved.pois.some((p) => p.tags[k])
    )
      fillGroupNames.add(g.name);
  }
  const firstFillGroup =
    resolved.tagGroups.find((g) => fillGroupNames.has(g.name))?.name ?? null;
  const override = opts.activeGroup; // string | null | undefined
  let activeGroup: string | null;
  if (override !== undefined) {
    activeGroup = override === null ? null : matchColorGroup(override);
  } else if (resolved.directives.activeTag !== undefined) {
    activeGroup = matchColorGroup(resolved.directives.activeTag);
  } else {
    // Default: colour by the value ramp when values exist, else the first
    // declared tag group that fills a region/POI. When the only groups are
    // edge/leg groups (no fill group), fall back to the first declared group so
    // the legend still renders it as a line-colour KEY — but it won't mute the
    // basemap (see mutedBasemap below) since it fills no region.
    activeGroup =
      VALUE_NAME ?? firstFillGroup ?? resolved.tagGroups[0]?.name ?? null;
  }
  const activeIsScore = VALUE_NAME !== null && activeGroup === VALUE_NAME;

  // Basemap dress (fixed automatic aesthetic — no directive). Subject water +
  // land always wear the SAME faded blue/green dress (subtle enough that
  // saturated tag/score tints never blend into it), so every map looks
  // consistent. `mutedBasemap` governs only the NEIGHBOUR land: when a REGION-
  // filling dimension is active the surrounding world recedes to a paler gray so
  // the subject + its data fills dominate; a plain reference map — or one whose
  // only tag group colours connector LINES (§24B.6), not regions — keeps
  // neighbour land at the fuller gray.
  const mutedBasemap =
    activeIsScore || (activeGroup !== null && fillGroupNames.has(activeGroup));
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

  // One muted, contrast-floored tone for every BACKDROP place name — orientation
  // regions (Minnesota, Texas) AND unreferenced context countries (Canada) — plus
  // one for water. Subordination is by MUTING (start from textMuted / a muted
  // blue-gray), never by lowering contrast: blend toward palette.text until the
  // tone clears the WCAG-AA floor against the substrate it sits on, so a backdrop
  // name is always legible WITHOUT a halo. This replaces the old fade-toward-bg,
  // which washed a grown name to ~background (Minnesota rendered at ~#dddfe0 over
  // ~#e9ece9 land — contrast ≈ 1).
  // Floored against EVERY light substrate a backdrop name may touch — its own
  // neutral land AND open water — so the no-halo label stays legible even where a
  // big country name (Florida, Chile) spills off its coast onto the sea. (The
  // placement gate below still keeps these names off the only substrate the tone
  // can't clear: a saturated foreign DATA fill.)
  const contrastFloorTone = (tone: string, ...substrates: string[]): string => {
    const clears = (t: string): boolean =>
      substrates.every((s) => contrastRatio(t, s) >= REGION_LABEL_HALO_RATIO);
    if (clears(tone)) return tone;
    for (let s = 10; s <= 100; s += 10) {
      const t = mix(palette.text, tone, s);
      if (clears(t)) return t;
    }
    return palette.text;
  };
  const backdropLandTone = contrastFloorTone(
    palette.textMuted,
    neutralFill,
    water
  );
  const backdropWaterTone = contrastFloorTone(
    mix(palette.colors.blue, palette.textMuted, 50),
    water,
    neutralFill
  );

  // -- Colorize: content-inferred distinct political fills (§24B) --
  // Colorize is the DEFAULT dress for any map that is NOT colouring regions by
  // data. The things that turn it off: (1) a data dimension exists on a
  // region (any `heat:` or tag group) — data owns the saturation, so the basemap
  // recedes to the gray choropleth/categorical dress; (2) any region carries a
  // direct trailing color (`Japan red`) — that's explicit authoring intent, so
  // auto-political-tinting would only fight the hand-picked colours; or (3) the
  // `no-colorize` opt-out. Everything else — bare `map`, POI/route-only maps,
  // named regions without data or direct colours — gets distinct political
  // pastels (markers/routes draw on top). Data EXISTENCE (not which dimension is
  // *active*) is the discriminator, so a tag map viewed with `active-tag none`
  // still keeps its neutral data dress; and the live-preview `California` →
  // `California heat: 92` edit transitions colorized → choropleth cleanly.
  const hasDirectColor = resolved.regions.some((r) => r.color !== undefined);
  const colorizeActive =
    resolved.directives.noColorize !== true &&
    !hasRamp &&
    !hasDirectColor &&
    fillGroupNames.size === 0;
  // Hue per ISO over ONE UNIFIED graph spanning every drawn topology, so no two
  // bordering regions share a hue — INCLUDING across the international seam. The
  // world and us-states topologies share no TopoJSON arcs, so neighbors() is blind
  // to the US↔Canada/Mexico border; those edges are fixed geographic facts (FOREIGN
  // _BORDER) added explicitly. Coloring is global (whole topologies, not the drawn
  // subset) and country codes sort before `US-XX`, so a country's colour is decided
  // before any state is visited → extent-independent (France identical at any width
  // and in an inset; AC10) and the same whether or not states are drawn. Every drawn
  // ISO is in the graph, so the lookup never misses → no green leak (F14).
  const colorByIso = new Map<string, string>();
  if (colorizeActive) {
    const adjacency = new Map<string, string[]>();
    const addEdges = (src: ReadonlyMap<string, readonly string[]>): void => {
      for (const [iso, ns] of src) {
        const cur = adjacency.get(iso);
        if (cur) cur.push(...ns);
        else adjacency.set(iso, [...ns]);
      }
    };
    addEdges(buildAdjacency(worldTopo)); // countries
    if (usLayer) {
      addEdges(buildAdjacency(data.usStates)); // US states
      // International border seam (US states ↔ Canada/Mexico), both directions —
      // the two topologies don't share arcs, so this is the only place the seam
      // is expressible. Skip any endpoint not in the graph (defensive).
      for (const [country, states] of Object.entries(FOREIGN_BORDER)) {
        const cn = adjacency.get(country);
        if (!cn) continue;
        for (const st of states) {
          const sn = adjacency.get(st);
          if (!sn) continue;
          cn.push(st);
          sn.push(country);
        }
      }
    }
    const { byIso, huesNeeded } = assignColors(
      [...adjacency.keys()],
      adjacency
    );
    const tints = politicalTints(palette, huesNeeded, isDark);
    for (const [iso, idx] of byIso) colorByIso.set(iso, tints[idx]!);
  }
  /** Per-region boundary stroke under colorize. Distinct FILLS aren't enough —
   *  the boundary sells the separation (F10). Darken per-region toward the
   *  palette text so the outline tracks each pastel; width stays the renderer
   *  constant (the darker tone, not weight, does the work — AC12). */
  const colorizeStroke = (fill: string): string => mix(fill, palette.text, 35);

  // Score ramp base: a NEUTRAL tint of the page, NOT the (green) land colour —
  // blending red toward green produced muddy brown mid-tones that blurred into
  // the unscored land. Anchored to a neutral, the ramp is a clean single-hue red
  // scale (light → deep) distinct from the green base. On dark, lift the anchor
  // off the near-black surface so the lowest scores read as a clear muted red
  // rather than sinking to maroon-black.
  const rampBase = isDark ? mix(palette.surface, palette.text, 28) : palette.bg;
  // Floored neutral the single-colour ramp blends up from — also the LOW
  // endpoint the legend shows when no explicit low colour was given.
  const rampLowFloor = mix(rampHue, rampBase, RAMP_FLOOR);
  const fillForValue = (s: number): string => {
    const t = rampMax > rampMin ? (s - rampMin) / (rampMax - rampMin) : 1;
    // Two-colour ramp: shared low→high interpolation (direct or via midpoint).
    if (rampLow !== undefined)
      return valueRampColor(rampLow, rampHue, t, { isDark });
    // Single/zero-colour ramp: byte-identical to pre-change output — feed `mix`
    // the SAME numeric pct (NO float round-trip, which could drift a channel).
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
    const val = tags[tagAttrKey(group.name)] ?? group.defaultValue;
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
    iso?: string;
    value?: number;
    color?: string;
    tags: Readonly<Record<string, string>>;
  }): string => {
    const direct = directFill(r.color);
    if (direct) return direct; // §24B.4 direct color wins over colorize (F4)
    if (activeIsScore) {
      return r.value !== undefined ? fillForValue(r.value) : neutralFill;
    }
    // Under colorize (activeGroup === null ⇒ not score) the terminal neutralFill
    // is replaced by the region's political pastel; the value-path above is dead
    // here (activeIsScore is false). Data/tag maps are untouched.
    if (colorizeActive) return (r.iso && colorByIso.get(r.iso)) ?? neutralFill;
    return tagFill(r.tags, activeGroup) ?? neutralFill;
  };

  const regionById = new Map(resolved.regions.map((r) => [r.iso, r]));

  // -- Legend model (AR1: categorical via renderer's renderLegendD3). Built here
  // (before the fit) so the fit can reserve a band for it. Only the colouring
  // dimensions (value ramp + tag groups) get a legend; POI size and edge
  // thickness are self-evident from the marker/line scale and carry no key. --
  let legend: MapLayoutLegend | null = null;
  if (!resolved.directives.noLegend) {
    const legendTagGroups = resolved.tagGroups.map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
    }));
    if (legendTagGroups.length > 0 || hasRamp) {
      legend = {
        tagGroups: legendTagGroups,
        activeGroup,
        ...(hasRamp && {
          ramp: {
            ...(resolved.directives.regionMetric !== undefined && {
              metric: resolved.directives.regionMetric,
            }),
            min: rampMin,
            max: rampMax,
            low: rampLow ?? rampLowFloor,
            high: rampHue,
          },
        }),
      };
    }
  }

  // -- Fit the projection to the canvas (size-dependent; the projection + fit
  // target themselves came from buildMapProjection above). --
  // Reserve top padding for the title/subtitle banner ONLY when there are POIs,
  // so their markers/labels don't project up under the title (which renders in
  // the foreground). A POI-less choropleth needs no reserve — the land fills to
  // the top and the title simply overlays it, so neighbour land (e.g. Canada)
  // isn't cut short by a band of empty water above it.
  // `no-title` suppresses the banner entirely — drop it from layout so the title
  // reserves no top band and the renderer's `if (layout.title)` skips it.
  const shownTitle = resolved.directives.noTitle ? null : resolved.title;
  const TITLE_GAP = 16;
  let topPad = FIT_PAD;
  if (shownTitle && resolved.pois.length > 0) {
    const bannerBottom =
      (resolved.subtitle ? TITLE_Y + TITLE_FONT_SIZE : TITLE_Y) +
      TITLE_FONT_SIZE / 2;
    topPad = Math.max(FIT_PAD, bannerBottom + TITLE_GAP);
  }
  // Reserve a band for the top-center legend so the projected land starts BELOW
  // it (the legend is a foreground overlay — without this it covers land, e.g.
  // Europe on a world map). The band is measured from the SAME groups/config the
  // renderer draws (mode-aware: export shows only the active group), so the
  // reserve matches the rendered legend exactly.
  const legendBand = mapLegendBand(legend, {
    width,
    mode: opts.legendMode ?? 'preview',
    hasTitle: Boolean(shownTitle),
    hasSubtitle: Boolean(resolved.subtitle),
  });
  if (legendBand > topPad) topPad = legendBand;
  // The title and legend are foreground overlays in the top band. Capture their
  // actual centred boxes so EVERY on-map label (region, data, context) treats
  // them as obstacles and dodges to clear space — otherwise a neighbour name
  // creeps up under the title (Canada on a US map). These are centred boxes, NOT
  // the full-width band, so a label can still sit in a clear top corner (a water
  // name, or Canada beside the title) rather than being shoved off its own land.
  const topReserved: LabelRect[] = [];
  if (shownTitle) {
    const lines = resolved.subtitle ? 2 : 1;
    const tw =
      Math.max(
        measureLegendText(shownTitle, TITLE_FONT_SIZE),
        resolved.subtitle
          ? measureLegendText(resolved.subtitle, TITLE_FONT_SIZE)
          : 0
      ) +
      2 * TITLE_FONT_SIZE; // breathing room around the centred banner
    topReserved.push({
      x: width / 2 - tw / 2,
      y: TITLE_Y - TITLE_FONT_SIZE,
      w: tw,
      h: TITLE_FONT_SIZE * (lines + 0.5),
    });
  }
  const legendBox = mapLegendBox(legend, {
    width,
    mode: opts.legendMode ?? 'preview',
    hasTitle: Boolean(shownTitle),
    hasSubtitle: Boolean(resolved.subtitle),
  });
  if (legendBox)
    topReserved.push({
      x: legendBox.x,
      y: legendBox.y,
      w: legendBox.width,
      h: legendBox.height,
    });
  // Reserve a side band for margin callouts (second pass only): the projection
  // fits into the canvas MINUS this band, so the data shrinks and slides away
  // from that edge, opening room for the callout chips + leaders.
  const reserve = opts._calloutReserve;
  const fitLeft = FIT_PAD + (reserve?.left ?? 0);
  const fitRight = width - FIT_PAD - (reserve?.right ?? 0);
  const fitTop = topPad + (reserve?.top ?? 0);
  const fitBottom = height - FIT_PAD - (reserve?.bottom ?? 0);
  const fitBox: [[number, number], [number, number]] = [
    [fitLeft, fitTop],
    [Math.max(fitLeft + 1, fitRight), Math.max(fitTop + 1, fitBottom)],
  ];
  projection.fitExtent(fitBox, fitTarget as never);

  // Data-centered vertical fit (regional region-maps only). `fitExtent` centers
  // the EXTENT rectangle in the box; when a choropleth's data clusters away from
  // that rectangle's vertical center it lands off-center — e.g. a Europe map's
  // colored countries are mostly central/southern, but Sweden drags the extent's
  // north edge into empty Arctic, so the data sits low under a band of ocean.
  // Shift the projection vertically so the data's vertical SPAN is centered in the
  // fit box, CLAMPED so the data still fits inside the box (we never push a colored
  // region off-frame). The span comes from each region's PRIMARY landmass bbox
  // (featureBboxPrimary) — NOT the full feature, whose detached overseas
  // territories (French Guiana, the Canaries, the Dutch Caribbean) would project
  // far off-frame and wreck the bounds. POI-only regional frames are already
  // cluster-centered (container + zoom floor) and the albers-usa composite frames
  // the nation itself — both skip this.
  if (
    !fitIsGlobal &&
    resolved.projection !== 'albers-usa' &&
    resolved.regions.length > 0
  ) {
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const r of resolved.regions) {
      const bb = r.iso ? featureBboxPrimary(data.worldCoarse, r.iso) : null;
      if (!bb) continue;
      for (const lon of [bb[0][0], bb[1][0]]) {
        for (const lat of [bb[0][1], bb[1][1]]) {
          const p = projection([lon, lat]);
          if (p && Number.isFinite(p[1])) {
            if (p[1] < yMin) yMin = p[1];
            if (p[1] > yMax) yMax = p[1];
          }
        }
      }
    }
    if (yMin < yMax) {
      const boxTop = fitTop;
      const boxBottom = fitBottom;
      // Center the data's vertical span; the bbox midpoint balances the northern
      // and southern extremes evenly (an area-weighted centroid would skew toward
      // the larger landmasses and over-shoot the frame).
      let dy = (boxTop + boxBottom) / 2 - (yMin + yMax) / 2;
      // Clamp so the data span stays within [boxTop, boxBottom]; if it is taller
      // than the box, the midpoint target already gives symmetric overflow.
      const minDy = boxTop - yMin;
      const maxDy = boxBottom - yMax;
      if (minDy <= maxDy) dy = Math.max(minDy, Math.min(maxDy, dy));
      const [tx, ty] = projection.translate();
      projection.translate([tx, ty + dy]);
    }
  }

  // Tall-pane CONUS nudge (albers-usa). `fitExtent` centers CONUS in the box, so
  // an off-aspect (tall) app pane splits the vertical slack evenly — half empty
  // above the nation, half below. Re-bias the slack so the area of interest rides
  // UP: the top gap shrinks to ~30% of the slack and ~70% opens below, where the
  // AK/HI inset boxes (bottom-aligned) + neighbour land (Mexico) now live. On a
  // near-CONUS-aspect canvas the slack is ~0, so the shift is ~0 — wide gallery /
  // export renders are untouched. CONUS never rides above the box top (gap ≥ 0)
  // nor off the bottom (we only reduce the top gap, raising the southern coast).
  if (!fitIsGlobal && resolved.projection === 'albers-usa') {
    const cb = geoPath(projection).bounds(fitTarget as never);
    if (Number.isFinite(cb[0][1])) {
      const slack = fitBottom - fitTop - (cb[1][1] - cb[0][1]);
      if (slack > 0) {
        const currentTopGap = cb[0][1] - fitTop; // == slack/2 after centering
        const dy = slack * 0.3 - currentTopGap; // negative → moves CONUS up
        const [tx, ty] = projection.translate();
        projection.translate([tx, ty + dy]);
      }
    }
  }

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
    // A global stretch-fill runs the world to EVERY edge of the canvas — no
    // FIT_PAD inset. The equirectangular rectangle is the map, so its edges ARE
    // the render-area edges (the antimeridian sits exactly on the left/right
    // edge, not 24px short of it with a coastline ringing the gap). The title
    // overlays the top; we reserve a top band only when POIs are present (so
    // their markers don't project up under the foreground title banner).
    const topReserve =
      (resolved.title && resolved.pois.length > 0) || legendBand > 0
        ? topPad
        : 0;
    const ox = 0;
    const oy = topReserve;
    const sx = cw > 0 ? width / cw : 1;
    const sy = ch > 0 ? (height - topReserve) / ch : 1;
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
    const thin = geoThin();
    path = geoPath({
      stream: (s: never) =>
        baseProjection.stream(
          (tx as unknown as { stream: (d: never) => never }).stream(
            (thin as unknown as { stream: (d: never) => never }).stream(s)
          )
        ),
    } as never).digits(PATH_DIGITS);
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
    const thin = geoThin();
    path = geoPath({
      stream: (s: never) =>
        projection.stream(
          (thin as unknown as { stream: (d: never) => never }).stream(s)
        ),
    } as never).digits(PATH_DIGITS);
    project = (lon, lat) => projection([lon, lat]) ?? null;
  }

  // The main projection is now fully fitted (no further scale/translate/clip
  // mutation below — insets use their own projection). Sample it at fixed probe
  // points to fingerprint the exact transform, including the global-view stretch
  // that `projection.scale()/translate()` alone don't capture. This is the
  // region-geometry memo key (see REGION_GEO_MEMO): identical probes ⇒ identical
  // projected paths ⇒ a recolor can reuse the cached geometry. World + US probes
  // so both equirectangular and albers-usa fits discriminate.
  const regionGeo = regionGeoBucket(
    resolvedIn,
    JSON.stringify([
      width,
      height,
      (
        [
          [-100, 40],
          [-120, 37],
          [-80, 40],
          [0, 0],
          [60, 30],
          [-60, -30],
          [150, 60],
          [-150, -60],
          [100, -40],
          [-30, 50],
        ] as Array<[number, number]>
      ).map(([lo, la]) => project(lo, la)),
    ])
  );

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
      // Flat top sits just under the coast (GAP below the lowest the coast reaches
      // over the box span) so the inset stays tucked close to CONUS — its SW corner,
      // not stranded at the far canvas bottom. Over open ocean (no coast) a soft
      // default keeps it in the lower band.
      const topGuess = floor > -Infinity ? floor + GAP : yB - height * 0.42;
      // Learn the state's height at this width, then size the box to just hold it.
      proj.fitWidth(iw, f as never);
      const bb = geoPath(proj).bounds(f as never);
      const sh = Number.isFinite(bb[0][0]) ? bb[1][1] - bb[0][1] : iw;
      // If the coast runs so low the state wouldn't fit above yB, raise the top (it
      // stays over ocean) — the box must never collapse and vanish.
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
      const insetPath = geoPath(proj).digits(PATH_DIGITS);
      const d = insetPath(f as never) ?? '';
      if (!d) return xr;
      // Neighbour land projected with this same fitted projection, clipped to the
      // box. Alaska's only land neighbour is Canada; drawing it behind AK turns
      // the eastern AK/Canada border into a land boundary so it grows no coastline
      // rings (and fills the box's upper-right corner with recessive context).
      let contextLand: { d: string; fill: string } | undefined;
      if (iso === 'US-AK') {
        const can = worldLayer.get('CA');
        const cd = can ? (insetPath(can as never) ?? '') : '';
        if (cd)
          contextLand = {
            d: cd,
            fill: colorizeActive
              ? (colorByIso.get('CA') ?? foreignFill)
              : foreignFill,
          };
      }
      const r = regionById.get(iso);
      // Inset land reads the SAME colorByIso as the main frame → AK/HI identical
      // to their main-frame colour (extent-independent; AC10/AC11).
      let fill = colorizeActive
        ? (colorByIso.get(iso) ?? neutralFill)
        : neutralFill;
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
        ...(contextLand && { contextLand }),
      });
      insetRegions.push({
        id: iso,
        d,
        fill,
        stroke: colorizeActive ? colorizeStroke(fill) : regionStroke,
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
      akRight = placeInset('US-AK', alaskaProjection(), FIT_PAD, width * 0.18);
    if (hiRef)
      placeInset(
        'US-HI',
        hawaiiProjection(),
        akRef ? akRight + 24 : FIT_PAD,
        width * 0.12
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
    const lons: number[] = [];
    for (const [rawLon] of ring) {
      const lon = normLon(rawLon);
      lons.push(lon);
      if (lon < loMin) loMin = lon;
      if (lon > loMax) loMax = lon;
      if (rawLon < rawMin) rawMin = rawLon;
      if (rawLon > rawMax) rawMax = rawLon;
    }
    // OCCUPIED longitude arc (complement of the largest empty gap), NOT the raw
    // min→max span: a landmass crossing the antimeridian (Russia: points near
    // −180° AND +180° via Chukotka) has a ~360° min→max span but only a ~171°
    // occupied arc. The naive `loMax−loMin > 270` test mistook Russia for
    // circumpolar garbage and dropped all of mainland Russia from regional views.
    // A truly pole-wrapping ring occupies ~360° (no large gap) and is still
    // dropped. (#russia-cull)
    lons.sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < lons.length; i++)
      maxGap = Math.max(maxGap, lons[i]! - lons[i - 1]!);
    if (lons.length > 1)
      maxGap = Math.max(maxGap, lons[0]! + 360 - lons[lons.length - 1]!);
    const occupiedArc = 360 - maxGap;
    if (occupiedArc > 270) return false; // circumpolar/polar-wrap garbage
    if (rawMax - rawMin > 180 && occupiedArc < 90) return false; // seam sliver
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
  // ~5° arc straddling the seam) projects under a world projection to two slivers
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
      // Projected path + label centroid: reuse the memo when this fit already
      // produced them (recolor fast-path; see REGION_GEO_MEMO). `null` memoizes a
      // region the cull dropped so a recolor skips it without re-streaming. Both
      // the centroid anchor and the cull/sliver geometry are fit-only, never
      // palette/active-group dependent — safe to cache under `regionGeo`.
      const geoK = layerKind + ':' + iso;
      let geo = regionGeo.get(geoK);
      if (geo === undefined) {
        // Cull off-view land in a regional view; in a global view keep all land
        // but still drop antimeridian frame-fillers (Fiji et al.).
        const viewF = shouldCull ? cullFeatureToView(f) : dropFrameFillers(f);
        if (!viewF) {
          regionGeo.set(geoK, null);
          continue;
        }
        const raw = path(viewF as never) ?? '';
        // Global views: strip the wrap-sliver a crossing landmass leaves pinned
        // to the far edge (Russia's Chukotka beside Alaska). Regional cuts real.
        const d0 = fitIsGlobal
          ? dropAntimeridianWrapSlivers(raw, width, height)
          : raw;
        if (!d0) {
          regionGeo.set(geoK, null);
          continue;
        }
        // Label/hover anchor: a hardcoded mainland anchor when far-flung
        // territory would skew it, else the area-weighted screen centroid of the
        // drawn shape (survives antimeridian crossers, unlike a bbox centre).
        const anchor = WORLD_LABEL_ANCHORS[iso];
        const cc = anchor
          ? project(anchor[0], anchor[1])
          : path.centroid(viewF as never);
        const ok =
          cc != null && Number.isFinite(cc[0]) && Number.isFinite(cc[1]);
        geo = { d: d0, cx: ok ? cc[0] : undefined, cy: ok ? cc[1] : undefined };
        regionGeo.set(geoK, geo);
      } else if (geo === null) {
        continue;
      }
      const d = geo.d;
      const hasCentroid = geo.cx !== undefined && geo.cy !== undefined;
      const isThisLayer = r?.layer === layerKind;
      // Non-US neighbour land in a US view is gray context, not yellow land.
      const isForeign = layerKind === 'country' && usContext && iso !== 'US';
      // Under colorize EVERY drawn political region — referenced, context, or
      // neighbour — gets its pastel, so the whole visible set reads as one map
      // (foreignFill/neutralFill bypassed; F9). The referenced branch below routes
      // through regionFill (direct color still wins).
      const baseFill = isForeign ? foreignFill : neutralFill;
      let fill = colorizeActive ? (colorByIso.get(iso) ?? baseFill) : baseFill;
      let label: string | undefined;
      let lineNumber = -1;
      let layer: MapLayoutRegion['layer'] = 'base';
      if (isThisLayer) {
        // Fill by the ACTIVE colouring dimension (score ramp or tag group).
        fill = regionFill(r);
        lineNumber = r.lineNumber;
        layer = layerKind;
        label = r.name;
      } else {
        // Base/context land (not authored): still carry the display name so the
        // app can show it on hover. Names live on the geo feature's properties
        // (the same source the resolver/inset/context-label layers read).
        label = (f.properties as { name?: string } | null)?.name;
      }
      regions.push({
        id: iso,
        d,
        fill,
        stroke: colorizeActive ? colorizeStroke(fill) : regionStroke,
        lineNumber,
        layer,
        ...(label !== undefined && { label }),
        ...(hasCentroid && { labelX: geo.cx!, labelY: geo.cy! }),
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
  // Each target carries its screen-space bounding box so `fillAt` can reject the
  // vast majority of targets with four comparisons before paying for the full
  // even-odd ray cast — on a world map this is the dominant layout cost (label
  // placement samples `fillAt` hundreds of times, each otherwise looping every
  // vertex of every region). bbox containment is a NECESSARY condition for ring
  // containment, so the pre-filter is provably result-identical.
  const fillHitTargets = [...regions, ...insetRegions].map((r) => {
    const rings = parsePathRings(r.d);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const ring of rings)
      for (const p of ring) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
    // Stash the bbox + parsed rings on the region so the renderer's per-POI-label
    // cull (bbox) and coastline buffering (rings) reuse this parse instead of
    // re-parsing `d` (roadmap #2/#4).
    (
      r as {
        bbox?: readonly [number, number, number, number];
        rings?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
      }
    ).bbox = [minX, minY, maxX, maxY];
    (
      r as {
        rings?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
      }
    ).rings = rings;
    return { fill: r.fill, rings, minX, minY, maxX, maxY };
  });
  const fillAt = (x: number, y: number): string => {
    let hit = water; // open ocean / canvas backdrop when over no land
    for (const t of fillHitTargets) {
      if (x < t.minX || x > t.maxX || y < t.minY || y > t.maxY) continue;
      if (pointInRings(x, y, t.rings)) hit = t.fill;
    }
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
  // Relief is ALWAYS on; only the `no-relief` directive turns it off. It renders
  // on data maps too (the renderer lays the hachure ATOP the choropleth/tag fills
  // and the hatch tone flips to stay visible over muted land), at every zoom, and
  // at every width. The only remaining filters are per-range quality guards below
  // (sub-min-area / sub-min-dimension slivers are skipped so a range never draws
  // as a sub-pixel smudge) — those drop individual ranges, never the feature.
  const reliefAllowed = resolved.directives.noRelief !== true;
  const relief: MapLayoutRelief[] = [];
  let reliefHatch: MapLayoutReliefHatch | null = null;
  if (reliefAllowed && data.mountainRanges) {
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
      // Relief is ONE global clipped layer with a single colour (renderer.ts) —
      // a per-region hatch tone over varied pastels would need a renderer
      // rearchitecture (out of scope; v2). Under colorize the political tints are
      // pale washes sitting near the surface/bg, so referencing that base picks a
      // fixed mid-contrast hatch tone that reads over all of them (AC15/G2).
      const reliefLandRef = colorizeActive
        ? isDark
          ? palette.surface
          : palette.bg
        : neutralFill;
      const landLum = relativeLuminance(reliefLandRef);
      const tone =
        Math.abs(landLum - relativeLuminance(darkTone)) > 0.04
          ? darkTone
          : lightTone;
      reliefHatch = {
        color: mix(tone, reliefLandRef, RELIEF_HATCH_STRENGTH),
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
  if (resolved.directives.noCoastline !== true) {
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
  // A deliberate water-blue — a more saturated cousin of the body-of-water
  // `water` tone (which is a very faded blue, §mapBackgroundColor) so the line
  // reads clearly as a water course, not a dark gap where it crosses a border.
  // Mixing toward the border tone instead reads as a broken boundary in
  // muted/data mode. Open paths: stroked, no fill; under POIs/edges/labels.
  const riverColor = mix(palette.colors.blue, water, 32);
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

  // -- POIs: project, size→radius-scale, co-located spiderfy (the `size:` channel) --
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
  // Fade the fill as the bubble grows (stroke handled separately at render).
  const fillOpacityFor = (r: number): number => {
    const t = Math.max(0, Math.min(1, (r - R_MIN) / (R_MAX - R_MIN)));
    return (
      POI_FILL_OPACITY_MAX - t * (POI_FILL_OPACITY_MAX - POI_FILL_OPACITY_MIN)
    );
  };

  // POI fill precedence (§24B.5): a direct §1.5 trailing color wins, then the
  // FIRST declared tag group for which the POI has a value (AR4), then orange.
  const poiFill = (p: ResolvedPoi): { fill: string; stroke: string } => {
    const directHex = p.color ? resolveColor(p.color, palette) : null;
    if (directHex)
      return { fill: directHex, stroke: mix(directHex, palette.text, 18) };
    for (const group of resolved.tagGroups) {
      const val = p.tags[tagAttrKey(group.name)];
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

  // Connector colour (§24B.6): a tag on the edge/leg LINE colours the line. Walk
  // the declared tag groups (first match wins, like poiFill) and return its hex,
  // or null → caller falls back to the neutral connector mix.
  const lineColor = (tags: Readonly<Record<string, string>>): string | null => {
    for (const group of resolved.tagGroups) {
      const val = tags[tagAttrKey(group.name)];
      if (!val) continue;
      const entry = group.entries.find(
        (e) => e.value.toLowerCase() === val.toLowerCase()
      );
      if (entry?.color) return entry.color; // already hex (parser-resolved)
    }
    return null;
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
  const placePoi = (
    e: Proj,
    cx: number,
    cy: number,
    clusterId?: string
  ): void => {
    const { fill, stroke } = poiFill(e.p);
    const r = radiusFor(e.p);
    poiScreen.set(e.p.id, { cx, cy, r });
    const num = routeNumberById.get(e.p.id);
    pois.push({
      id: e.p.id,
      cx,
      cy,
      r,
      fill,
      fillOpacity: fillOpacityFor(r),
      stroke,
      lineNumber: e.p.lineNumber,
      implicit: !!e.p.implicit,
      isOrigin: originIds.has(e.p.id),
      ...(num !== undefined && { routeNumber: num }),
      ...(Object.keys(e.p.tags).length > 0 && { tags: e.p.tags }),
      ...(clusterId !== undefined && { clusterId }),
    });
  };

  // -- Coincident-POI spiderfy (stacks). Two dots "stack" when they visibly
  // overlap (centre distance < combined radii × STACK_OVERLAP). A ≥2-member stack
  // is laid out EXPANDED — members fanned onto a ring (golden-angle spiral past
  // STACK_RING_MAX), legs back to the centroid — which is the source of truth for
  // export + the no-JS default; the app collapses it to one ringed `+N` badge at
  // rest and expands on click. POIs that anchor an edge or route leg are EXCLUDED
  // (kept at true position; collapsing a connector endpoint is out of v1 scope).
  // Distinct-but-dense clusters never overlap at the combined-radii threshold, so
  // they keep today's true-position + leader/column behavior.
  const clusters: MapLayoutCluster[] = [];
  const connected = new Set<string>();
  for (const e of resolved.edges) {
    connected.add(e.fromId);
    connected.add(e.toId);
  }
  for (const rt of resolved.routes) {
    rt.stopIds.forEach((id) => connected.add(id));
  }
  const radiusOf = (e: Proj): number => radiusFor(e.p);
  // Connected endpoints: always true position.
  for (const e of projected) {
    if (connected.has(e.p.id)) placePoi(e, e.xy[0], e.xy[1]);
  }
  // Distance-based transitive grouping among stackable POIs (first-matching-group
  // heuristic, matching the GROUP_R label-column grouping below).
  const groups: Proj[][] = [];
  for (const e of projected) {
    if (connected.has(e.p.id)) continue;
    const r = radiusOf(e);
    const near = groups.find((g) =>
      g.some(
        (q) =>
          Math.hypot(q.xy[0] - e.xy[0], q.xy[1] - e.xy[1]) <
          (r + radiusOf(q)) * STACK_OVERLAP
      )
    );
    if (near) near.push(e);
    else groups.push([e]);
  }
  for (const g of groups) {
    if (g.length === 1) {
      placePoi(g[0]!, g[0]!.xy[0], g[0]!.xy[1]);
      continue;
    }
    const clusterId = g[0]!.p.id; // line-number-ordered first member → stable
    const cx0 = g.reduce((s, e) => s + e.xy[0], 0) / g.length;
    const cy0 = g.reduce((s, e) => s + e.xy[1], 0) / g.length;
    const maxR = Math.max(...g.map(radiusOf));
    // Ring radius so adjacent expanded dots clear each other by STACK_RING_GAP.
    const sep = 2 * maxR + STACK_RING_GAP;
    const ringR = Math.max(
      COLO_R,
      sep / (2 * Math.sin(Math.PI / Math.max(g.length, 2)))
    );
    const positions = g.map((e, i) => {
      if (g.length <= STACK_RING_MAX) {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / g.length;
        return {
          e,
          mx: cx0 + Math.cos(ang) * ringR,
          my: cy0 + Math.sin(ang) * ringR,
        };
      }
      const ang = i * GOLDEN_ANGLE;
      const rr = ringR * Math.sqrt((i + 1) / g.length);
      return { e, mx: cx0 + Math.cos(ang) * rr, my: cy0 + Math.sin(ang) * rr };
    });
    // Off-canvas guard: translate the whole fan (centroid + members together) so
    // every DOT stays on-canvas. A pure shift preserves the spider geometry AND
    // keeps the collapsed badge honest — the ring is small, so the badge barely
    // moves off the true centroid. (Labels are NOT folded into this box: a label
    // is wide enough that shifting to fit it would drag the badge far from the
    // real location — a geographic lie. Instead the label block below flips each
    // member's radial label to the side that fits and clamps it to the frame.)
    let minX = cx0 - maxR;
    let maxX = cx0 + maxR;
    let minY = cy0 - maxR;
    let maxY = cy0 + maxR;
    for (const { mx, my, e } of positions) {
      const r = radiusOf(e);
      minX = Math.min(minX, mx - r);
      maxX = Math.max(maxX, mx + r);
      minY = Math.min(minY, my - r);
      maxY = Math.max(maxY, my + r);
    }
    let dx = 0;
    let dy = 0;
    if (minX + dx < 2) dx = 2 - minX;
    if (maxX + dx > width - 2) dx = width - 2 - maxX;
    if (minY + dy < 2) dy = 2 - minY;
    if (maxY + dy > height - 2) dy = height - 2 - maxY;
    const legsOut: Array<{ x2: number; y2: number; color: string }> = [];
    for (const { e, mx, my } of positions) {
      const fx = mx + dx;
      const fy = my + dy;
      placePoi(e, fx, fy, clusterId);
      legsOut.push({ x2: fx, y2: fy, color: poiFill(e.p).fill });
    }
    clusters.push({
      id: clusterId,
      cx: cx0 + dx,
      cy: cy0 + dy,
      count: g.length,
      hitR: ringR + maxR + 6,
      legs: legsOut,
    });
  }

  // -- Connectors: routes + edges (with parallel fan-out) --
  const legs: MapLayoutLeg[] = [];
  // Gap between a leg's endpoint and the POI rim, so the line/arrow touches the
  // circle edge rather than burying its tip at the centre dot.
  const RIM_GAP = 1.5;
  // Signed bow amount along the chord normal (nx,ny). A fanned edge keeps its
  // explicit offset (sign separates parallels). A lone arc bows by the default
  // fraction; when an `away` point is given (a route's centroid), the sign is
  // flipped so the control point lands on the FAR side of that point — i.e. the
  // arc bulges OUTWARD relative to the polygon the route traces, never inward
  // across its interior.
  const bowMagnitude = (
    mx: number,
    my: number,
    nx: number,
    ny: number,
    offset: number,
    len: number,
    away?: { x: number; y: number }
  ): number => {
    if (offset !== 0) return offset;
    const base = len * ARC_CURVE_FRAC;
    if (!away) return base;
    const dot = nx * (mx - away.x) + ny * (my - away.y);
    return dot < 0 ? -base : base;
  };
  const legPath = (
    a: { cx: number; cy: number; r: number },
    b: { cx: number; cy: number; r: number },
    curved: boolean,
    offset: number,
    away?: { x: number; y: number }
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
    const bow = bowMagnitude(mx, my, nx, ny, offset, len, away);
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
  // Where a leg's label sits: the MIDPOINT OF THE DRAWN PATH, nudged a few px to
  // the bow side so the text rides just off the line. A straight leg's midpoint is
  // the chord midpoint; an arc is a quadratic Q whose t=0.5 point is
  // chord-mid + ½·normal·bow — so a long bowed arc (a trans-Atlantic route) must
  // follow the CURVE, else the label floats in open space far below the line.
  const legLabelPoint = (
    a: { cx: number; cy: number; r: number },
    b: { cx: number; cy: number; r: number },
    curved: boolean,
    offset: number,
    away?: { x: number; y: number }
  ): { x: number; y: number } => {
    const mx = (a.cx + b.cx) / 2;
    const my = (a.cy + b.cy) / 2;
    if (!curved && offset === 0) return { x: mx, y: my - 4 };
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bow = bowMagnitude(mx, my, nx, ny, offset, len, away);
    // arc apex (½·bow) + a small lift further out so the text clears the stroke.
    const off = bow * 0.5 + Math.sign(bow || 1) * 8;
    return { x: mx + nx * off, y: my + ny * off };
  };

  // -- Arc avoidance --
  // A lone arc's default left-normal bow can run straight through an unrelated
  // POI or ride on top of another leg (a DEN dot sitting on the LGA→LAX chord).
  // Before emitting each arc, try a small candidate set of bows — default side,
  // flipped side, and wider versions of each — and keep the first with the
  // lowest penalty. Penalty = passing within clearance of a non-endpoint POI,
  // hugging an already-placed leg, or leaving the canvas. Greedy in emit order
  // (routes then edges, source order), so later legs dodge earlier ones; every
  // leg (straight or fanned too) registers as an obstacle. The default bow is
  // candidate 0 and wins ties, so an uncontested map renders exactly as before.
  const LEG_SAMPLES = 25;
  const POI_CLEARANCE = 10; // px beyond a POI's radius an arc must keep
  const LEG_CLEARANCE = 7; // px between two legs before they read as one line
  const SHARED_END_RADIUS = 36; // px around a shared endpoint where converging is inevitable
  const placedLegSamples: Array<{
    fromId: string;
    toId: string;
    pts: Array<{ x: number; y: number }>;
  }> = [];
  const sampleLeg = (
    a: { cx: number; cy: number },
    b: { cx: number; cy: number },
    curved: boolean,
    bow: number
  ): Array<{ x: number; y: number }> => {
    const pts: Array<{ x: number; y: number }> = [];
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const px = (a.cx + b.cx) / 2 + (-dy / len) * bow;
    const py = (a.cy + b.cy) / 2 + (dx / len) * bow;
    for (let i = 0; i < LEG_SAMPLES; i++) {
      const t = i / (LEG_SAMPLES - 1);
      if (!curved && bow === 0) {
        pts.push({ x: a.cx + dx * t, y: a.cy + dy * t });
      } else {
        const u = 1 - t;
        pts.push({
          x: u * u * a.cx + 2 * u * t * px + t * t * b.cx,
          y: u * u * a.cy + 2 * u * t * py + t * t * b.cy,
        });
      }
    }
    return pts;
  };
  const legPenalty = (
    pts: Array<{ x: number; y: number }>,
    fromId: string,
    toId: string
  ): number => {
    let pen = 0;
    for (const [id, p] of poiScreen) {
      if (id === fromId || id === toId) continue;
      let dmin = Infinity;
      for (const s of pts) {
        const d = Math.hypot(s.x - p.cx, s.y - p.cy);
        if (d < dmin) dmin = d;
      }
      const clear = p.r + POI_CLEARANCE;
      if (dmin < clear) pen += (clear - dmin) * 12;
    }
    for (const other of placedLegSamples) {
      const shared = [fromId, toId]
        .filter((id) => id === other.fromId || id === other.toId)
        .map((id) => poiScreen.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p);
      for (const s of pts) {
        if (
          shared.some(
            (sp) => Math.hypot(s.x - sp.cx, s.y - sp.cy) < SHARED_END_RADIUS
          )
        ) {
          continue;
        }
        let dmin = Infinity;
        for (const o of other.pts) {
          const d = Math.hypot(s.x - o.x, s.y - o.y);
          if (d < dmin) dmin = d;
        }
        if (dmin < LEG_CLEARANCE) pen += 6;
      }
    }
    for (const s of pts) {
      if (s.x < 0 || s.x > width || s.y < 0 || s.y > height) pen += 20;
    }
    return pen;
  };
  const chooseArcBow = (
    a: { cx: number; cy: number },
    b: { cx: number; cy: number },
    fromId: string,
    toId: string,
    away?: { x: number; y: number }
  ): number => {
    const mx = (a.cx + b.cx) / 2;
    const my = (a.cy + b.cy) / 2;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const def = bowMagnitude(mx, my, nx, ny, 0, len, away);
    const candidates = [
      def,
      -def,
      def * 1.6,
      -def * 1.6,
      def * 2.2,
      -def * 2.2,
    ];
    let best = def;
    let bestPen = Infinity;
    for (const c of candidates) {
      const pen = legPenalty(sampleLeg(a, b, true, c), fromId, toId);
      if (pen < bestPen - 1e-6) {
        best = c;
        bestPen = pen;
      }
      if (bestPen === 0) break;
    }
    return best;
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
  for (const rt of resolved.routes) {
    // Centroid of the route's stops — the "inside" of the polygon it traces.
    // Arc legs bow AWAY from this so a multi-stop loop reads as a rounded ring
    // (arcs bulging outward) instead of crossing chords through the middle. A
    // route needs ≥3 distinct stops to enclose anything; below that there's no
    // interior and the default (consistent left-normal) bow is kept.
    const stopPts = rt.stopIds
      .map((id) => poiScreen.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    const center =
      stopPts.length >= 3
        ? {
            x: stopPts.reduce((s, p) => s + p.cx, 0) / stopPts.length,
            y: stopPts.reduce((s, p) => s + p.cy, 0) / stopPts.length,
          }
        : undefined;
    for (const leg of rt.legs) {
      const a = poiScreen.get(leg.fromId);
      const b = poiScreen.get(leg.toId);
      if (!a || !b) continue;
      const curvedLeg = leg.style === 'arc';
      // Avoidance-chosen bow rides the explicit-offset channel (bowMagnitude
      // returns a non-zero offset verbatim), so path + label stay in sync.
      const chosenBow = curvedLeg
        ? chooseArcBow(a, b, leg.fromId, leg.toId, center)
        : 0;
      const lp = legLabelPoint(a, b, curvedLeg, chosenBow, center);
      const bow = {
        curved: curvedLeg,
        offset: chosenBow,
        center,
        labelX: lp.x,
        labelY: lp.y,
      };
      placedLegSamples.push({
        fromId: leg.fromId,
        toId: leg.toId,
        pts: sampleLeg(a, b, curvedLeg, chosenBow),
      });
      const routeLabelStyle =
        leg.label !== undefined
          ? labelOnFill(fillAt(bow.labelX, bow.labelY))
          : undefined;
      const routeVal = Number(leg.value);
      legs.push({
        d: legPath(a, b, bow.curved, bow.offset, bow.center),
        width: routeWidthFor(routeVal),
        color: lineColor(leg.tags) ?? mix(palette.text, palette.bg, 72),
        arrow: true,
        fromId: leg.fromId,
        toId: leg.toId,
        ...(Number.isFinite(routeVal) && routeVal > 0 && { value: routeVal }),
        ...(Object.keys(leg.tags).length > 0 && { tags: leg.tags }),
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
  // Edge thickness rides on the `width:` channel (§24B.6).
  const weightVals = resolved.edges
    .map((e) => Number(e.meta['width']))
    .filter((n) => Number.isFinite(n) && n > 0);
  const wMin = weightVals.length ? Math.min(...weightVals) : 0;
  const wMax = weightVals.length ? Math.max(...weightVals) : 0;
  const widthFor = (e: ResolvedEdge): number => {
    const v = Number(e.meta['width']);
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
      const curved = e.style === 'arc' || n > 1;
      // Lone arcs get avoidance; fanned parallels keep their fixed offsets
      // (the fan itself is the separation) and straight edges stay straight.
      const edgeBow =
        curved && n === 1 ? chooseArcBow(a, b, e.fromId, e.toId) : fanOffset;
      const lp = legLabelPoint(a, b, curved, edgeBow);
      const bow = {
        curved,
        offset: edgeBow,
        labelX: lp.x,
        labelY: lp.y,
      };
      placedLegSamples.push({
        fromId: e.fromId,
        toId: e.toId,
        pts: sampleLeg(a, b, curved, edgeBow),
      });
      const edgeLabelStyle =
        e.label !== undefined
          ? labelOnFill(fillAt(bow.labelX, bow.labelY))
          : undefined;
      const edgeVal = Number(e.meta['width']);
      legs.push({
        d: legPath(a, b, bow.curved, bow.offset),
        width: widthFor(e),
        color: lineColor(e.tags) ?? mix(palette.text, palette.bg, 66),
        arrow: e.directed,
        fromId: e.fromId,
        toId: e.toId,
        ...(Number.isFinite(edgeVal) && edgeVal > 0 && { value: edgeVal }),
        ...(Object.keys(e.tags).length > 0 && { tags: e.tags }),
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
  // Seed with the title + legend boxes so every label (region, POI, context)
  // collides against them and never lands under the title/legend overlay.
  const obstacles: LabelRect[] = [...topReserved];
  // Region/orientation labels are the frame; POI labels are the subject. The
  // region pass runs first (can't yet see where POI labels land), so each region
  // label registers a guard here; after POI placement any guard a POI label
  // overlaps yields — the region label is removed rather than crammed.
  const regionLabelGuards: Array<{ label: PlacedLabel; rect: LabelRect }> = [];
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

  // Region labels (default ON; `no-region-labels` suppresses). Rendered as plain
  // text — NO pill, NO halo — so the choropleth fill (which encodes the data)
  // stays fully visible. The text colour is contrast-picked against each region's
  // OWN fill. Auto-fit cascade full → abbrev → hide (decision A): the full name
  // shows when it fits its footprint; otherwise a US-state 2-letter abbreviation
  // is tried (countries have no abbrev source, so they degrade full → hide); if
  // nothing fits the label is hidden rather than overlapping / spilling onto the
  // ocean. At the compact breakpoint (decision D2) the abbreviation is preferred
  // FIRST for US states.
  const showRegionLabels = resolved.directives.noRegionLabels !== true;
  // Ids of regions that won a static on-map label in the region pass. The
  // unreferenced-country / framed-state context pass below excludes these so a
  // region named once is never named twice: the layout `regions` list carries
  // auto-added poiFrameContainers (e.g. Canada framing northern POIs) that are
  // NOT in `regionById` (which holds only user-referenced `resolved.regions`),
  // so `regionById.has(iso)` alone misses them and the context pass would
  // re-label the same country at a different anchor (the "double-Canada" bug).
  const labeledRegionIds = new Set<string>();
  // Metric value shown UNDER each data region's name (`no-region-heat-value` opts out).
  // The value line is rendered smaller + dimmer than the name; see the renderer.
  // Scoped to a `region-heat` choropleth: only when the SCORE ramp is the active
  // colouring dimension (not a tag-coloured / categorical map) is the numeric
  // value the data on display, so that's the only case it's surfaced.
  const showRegionValues =
    resolved.directives.noRegionValue !== true && activeIsScore;
  // Compact value string for a region, or undefined when there's nothing to show
  // (no value, or the feature is off). Shared formatter so it matches the legend.
  const regionValueStr = (value: number | undefined): string | undefined =>
    showRegionValues && value !== undefined ? compactNumber(value) : undefined;
  const isCompact = width < COMPACT_WIDTH_PX;
  // Zoomed sub-national US choropleth (map-us-subnational-zoom): a US-states
  // mercator view with the score ramp active. Here a cramped state (NH, RI, CT,
  // NJ, DE) should NOT degrade to its 2-letter abbreviation — the user reads the
  // abbreviation poorly and a stray hover-name then steps on it. Instead it keeps
  // its FULL name and, if that won't fit in place, takes a leader-lined margin
  // callout (full name + value). Only a handful of states are in frame at this
  // zoom, so the callout column stays short. National (albers) maps keep the
  // abbreviation cascade — 50 full-name callouts would be unreadable.
  const usChoroplethZoom =
    resolved.projection === 'mercator' &&
    resolved.basemaps.subdivisions.includes('us-states') &&
    activeIsScore;
  const LABEL_PADX = 6;
  const LABEL_PADY = 3;
  // The value line is ~0.82× the name size; a hair of vertical gap separates them.
  const VALUE_GAP = 1;
  const labelW = (text: string, font: number = FONT): number =>
    measureLegendText(text, font) + 2 * LABEL_PADX;
  const labelH = FONT + 2 * LABEL_PADY;
  // Footprint of a name (+optional value) stack used for the box-fit cascade.
  // `font` defaults to the base size (every existing call is byte-identical);
  // the post-placement growth pass passes a larger size to test an upscaled fit.
  const stackW = (
    text: string,
    valueText?: string,
    font: number = FONT
  ): number =>
    Math.max(
      labelW(text, font),
      valueText
        ? measureLegendText(valueText, Math.round(font * 0.82)) + 2 * LABEL_PADX
        : 0
    );
  const stackH = (hasValue: boolean, font: number = FONT): number => {
    const lh = font + 2 * LABEL_PADY;
    return hasValue ? lh + VALUE_GAP + Math.round(font * 0.82) : lh;
  };
  // Footprint-driven label growth (size-up + fade), gradual + resolution-free.
  // Applies to ORIENTATION backdrop names ONLY (neighbour land / frame
  // containers with no data value): a big one reads as a large, gently-faded
  // backdrop, a small one stays at the base font. DATA labels are deliberately
  // EXCLUDED — fading a choropleth value washes it lighter than its own fill and
  // a loose bbox overran irregular regions. Size scales with the region's
  // projected footprint as a fraction of the canvas's linear extent. Growth runs
  // AFTER the base-font fit cascade picks the text+anchor, and only while the
  // larger glyphs still fit the box, clear neighbours/POIs, and stay inside the
  // region's own fill.
  const REGION_FONT_MAX_ORIENT = 22; // px ceiling, backdrop names
  const REGION_SIZE_FRAC_MIN = 0.06; // footprint linear-frac at base font
  const REGION_SIZE_FRAC_MAX = 0.32; // footprint linear-frac at max font
  // A valueless SUBJECT (referenced, no metric) grows up to this ceiling in-shape;
  // if it can't host its name at least at the prominence FLOOR inside its own fill
  // (a thin ribbon like Chile), it leaders into the open space instead.
  const SUBJECT_FONT_MAX = 18; // px ceiling for a prominent in-shape subject name
  const SUBJECT_MIN_PROMINENCE = 13; // px floor below which a subject leaders out
  const SUBJECT_LEADER_FONT = 15; // px for a leadered subject chip (Chile in the sea)
  const canvasLinear = Math.sqrt(Math.max(1, width * height));
  const sizeT = (boxW: number, boxH: number): number => {
    const frac = Math.sqrt(Math.max(0, boxW * boxH)) / canvasLinear;
    return Math.min(
      1,
      Math.max(
        0,
        (frac - REGION_SIZE_FRAC_MIN) /
          (REGION_SIZE_FRAC_MAX - REGION_SIZE_FRAC_MIN)
      )
    );
  };
  const pushRegionLabel = (
    x: number,
    y: number,
    text: string,
    fill: string,
    lineNumber: number,
    valueLine?: string,
    fontSize: number = FONT,
    colorOverride?: string
  ): void => {
    // Colour is contrast-picked against the region's own fill (see labelOnFill).
    // The halo, though, is gated by CONTAINMENT — not fill tone. A label that
    // sits wholly within its own fill reads against a single known colour, so
    // the picked shade suffices and a halo is just noise (big states: TX, CA).
    // But when the glyphs spill past the region — a narrow shape (FL peninsula),
    // a tiny state (MD), or a small inset island (HI) — the text crosses onto
    // ocean / neighbour land whose tone we can't predict, so it needs the halo
    // to stay legible. Sample the label's screen footprint against the drawn
    // fills: if any extreme lands on a fill other than the region's own, the
    // label overflows and earns a halo.
    const { color: baseColor, haloColor } = labelOnFill(fill);
    // A backdrop label passes an explicit muted, contrast-floored tone
    // (`backdropLandTone`); subordination is by muting, NOT by fading toward bg
    // (which destroyed contrast — the old REGION_FADE_ORIENT washed Minnesota to
    // ~background). Data labels pass no override and keep the contrast-picked-
    // vs-fill colour.
    const color = colorOverride ?? baseColor;
    // Widest of name / value drives the overflow sample (the value line can be
    // the wider of the two, e.g. a short name over a long number). Scales with
    // the actual (possibly grown) font so the halo gate matches what's drawn.
    const vf = Math.round(fontSize * 0.82);
    const halfW =
      Math.max(
        measureLegendText(text, fontSize),
        valueLine ? measureLegendText(valueLine, vf) : 0
      ) / 2;
    const overflows = [y - fontSize * 0.55, y - fontSize * 0.1].some(
      (sy) => fillAt(x - halfW, sy) !== fill || fillAt(x + halfW, sy) !== fill
    );
    labels.push({
      x,
      y,
      text,
      anchor: 'middle',
      color,
      // A backdrop label (colorOverride) NEVER haloes: the placement gate above
      // guarantees it sits on a floored-readable substrate (own fill, neutral
      // land, foreign land, or water), so a halo is pure noise. Data labels keep
      // the containment-gated halo until the role-tier pass (Phase 3).
      halo: colorOverride ? false : overflows,
      haloColor,
      ...(fontSize !== FONT && { fontSize }),
      ...(valueLine !== undefined && { valueLine }),
      lineNumber,
    });
  };
  // A region label's screen footprint, middle-anchored on its centroid, used to
  // keep two region labels from overlapping (a small gap adds breathing room).
  // With a value line the box grows to the taller two-line stack.
  const REGION_LABEL_GAP = 2;
  const regionLabelRect = (
    cx: number,
    cy: number,
    text: string,
    valueText?: string,
    font: number = FONT
  ): LabelRect => {
    const vf = Math.round(font * 0.82);
    const w =
      Math.max(
        measureLegendText(text, font),
        valueText ? measureLegendText(valueText, vf) : 0
      ) +
      2 * REGION_LABEL_GAP;
    const h = valueText ? font + VALUE_GAP + vf : font;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  };
  if (showRegionLabels) {
    // Gather the placeable region labels, then commit them largest-footprint
    // first. Two adjacent regions can sit too close to both carry a label at the
    // current scale (Spain + Portugal on a whole-world view collapse to ~32px
    // apart). Rather than overlap, the bigger region keeps its label and the
    // smaller one yields; zoom in and the footprints separate, no collision
    // fires, and both labels show. Order is by projected box AREA (visual claim)
    // so the result is scale-driven, not source-order-driven.
    // POI-only region framing: the region(s) CONTAINING the POIs are labelled
    // prominently even though they carry no data (layer 'base'). Neighbour land
    // gets the muted context-label treatment further down.
    const frameContainers = new Set(resolved.poiFrameContainers);
    const entries = regions
      .map((r) => {
        const isContainer = frameContainers.has(r.id);
        if ((r.layer === 'base' && !isContainer) || r.label === undefined)
          return null;
        // A container state carries layer 'base', so key off the id shape too.
        const isUsState = r.layer === 'us-state' || r.id.startsWith('US-');
        const f = isUsState ? usLayer?.get(r.id) : worldLayer.get(r.id);
        if (!f) return null;
        const [[x0, y0], [x1, y1]] = path.bounds(f as never);
        const boxW = x1 - x0;
        const boxH = y1 - y0;
        // full → abbrev → hide. Abbrev exists only for US states; at the compact
        // breakpoint abbrev is tried first. A POI-frame CONTAINER (e.g. the
        // "California" framing a US cloud-regions map) never degrades to the
        // 2-letter code to squeeze past its own POIs — it stays full or yields
        // entirely (the post-POI guard below hides it on collision).
        // On a zoomed US choropleth, drop the abbreviation entirely (full name or
        // a leader callout — never "NH"). Elsewhere the full → abbrev → hide
        // cascade stands (compact tries abbrev first; a POI container never
        // abbreviates).
        const abbrev =
          isUsState && !usChoroplethZoom ? r.id.replace(/^US-/, '') : undefined;
        const candidates =
          abbrev !== undefined
            ? isCompact
              ? [abbrev, r.label]
              : isContainer
                ? [r.label]
                : [r.label, abbrev]
            : [r.label];
        const anchor = !isUsState ? WORLD_LABEL_ANCHORS[r.id] : undefined;
        const c = anchor
          ? project(anchor[0], anchor[1])
          : path.centroid(f as never);
        if (!c || !Number.isFinite(c[0])) return null;
        return { r, c, boxW, boxH, area: boxW * boxH, candidates };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => b.area - a.area || a.r.lineNumber - b.r.lineNumber);
    // Every guard and every commit in this pass runs through `placement`, which
    // owns what has been placed and which leaders have been drawn. Those two
    // used to be bare arrays the loop had to remember to push onto — miss one
    // and the next iteration silently reads a stale world. `commit()` is the
    // single call that cannot be half-done.
    //
    // Seeded with the title + legend boxes so region/data labels dodge the
    // overlay the same way context labels do. A new short-hop leader that would
    // cross one already drawn is rejected — crossing leaders read as spaghetti,
    // so the label is dropped instead (the shading + legend + hover carry the
    // region).
    // "Empty" screen space a short-hop callout chip may sit on: open water or
    // un-valued base/foreign land (Canada, Mexico, neighbour states with no
    // metric). A chip must NEVER cover another VALUED region's choropleth fill —
    // that's the data, and a label box on top of it is worse than no label. On a
    // region-heat map valued regions take `fillForValue` (never water / neutral
    // / foreign), so testing the fill at a point cleanly separates data from
    // empty. (Colorize mode — which recolours base land — is mutually exclusive
    // with the score ramp that gates callouts, so this stays sound.)
    const isEmptyFill = (f: string): boolean =>
      f === water || f === neutralFill || f === foreignFill;
    // POI markers are obstacles for region labels: a region whose centroid sits on
    // a POI (e.g. Colorado's centroid under the "Core POP" dot in Denver) must NOT
    // stamp its name there — the POI's own label owns that spot, and two names by
    // one dot is ambiguous. The dot rect is padded to also keep the region name
    // clear of the POI's adjacent label. Region labels with no nearby POI (a
    // container whose POIs cluster in one corner, or an empty neighbour state) are
    // unaffected. POI markers are positioned above; their labels place further
    // down, so dot-proximity is the signal available here.
    const POI_LABEL_PAD = 14; // px — rough room for the POI's own hugging label
    const poiObstacles: LabelRect[] = pois.map((p) => ({
      x: p.cx - p.r - POI_LABEL_PAD,
      y: p.cy - p.r - POI_LABEL_PAD,
      w: 2 * (p.r + POI_LABEL_PAD),
      h: 2 * (p.r + POI_LABEL_PAD),
    }));
    const placement = createLabelPlacement({
      reserved: topReserved,
      obstacles: poiObstacles,
      markers,
    });
    // ── Short-hop callout into adjacent empty space ────────────────────────
    // A valued region whose name won't fit in place (even abbreviated) may nudge
    // its full name+value chip a SHORT hop into the open space right next to it —
    // north into Canada, south into Mexico, out into the ocean — joined by a tiny
    // leader + centroid dot. This is deliberately LOCAL: the hop is capped well
    // under a map-width, so a chip always hugs its own region. If no cardinal
    // direction has clean adjacent space within reach — the chip would land on
    // another valued region, run off-canvas, collide with a placed label/POI, or
    // its leader would cross an existing leader — the region gets NO label and the
    // choropleth shading speaks for it (hover still reveals the name+value). That
    // "give up cleanly" rule is the whole point: a readable blank beats a tangle
    // of crossing leaders and overlapping chips.
    const SHORT_HOP_MAX = Math.max(46, Math.min(width, height) * 0.11);
    const STEP = 4; // px probe granularity walking out of the region
    const HOP_GAP = 9; // px clearance between region edge and chip
    // How OPEN is the space a chip projects into? Measured on the chip's OUTWARD
    // hemisphere (the side facing away from its region): cast a fan of rays and
    // return the distance to the nearest land or canvas edge. A chip wedged in a
    // crowded inlet (the Gulf of Mexico, hemmed by Florida + the Caribbean)
    // scores low; one sitting in open water (the empty Pacific off Mexico's west
    // coast) saturates the cap. Callout scoring MAXIMISES this, using leader
    // length only as a tie-break — so a region leaders toward the open sea, not
    // into whichever coast happens to be the shortest hop away. We only probe the
    // outward hemisphere because the inward side always hits the region's own
    // fill immediately (the chip hugs its border), which would flatten every spot.
    const CLEAR_STEP = 6; // px granularity of the openness probe
    const CLEAR_MAX = SHORT_HOP_MAX * 3; // saturation — beyond this it's "open"
    const CLEAR_TOL = CLEAR_STEP; // openness within a probe step counts as a tie
    const clearanceAt = (
      px: number,
      py: number,
      ox: number, // outward unit dir (away from the region)
      oy: number
    ): number => {
      const baseAng = Math.atan2(oy, ox);
      let minClear = CLEAR_MAX;
      // 5 rays spanning the outward hemisphere (baseAng ± 90° in 45° steps).
      for (let k = -2; k <= 2; k++) {
        const a = baseAng + (k * Math.PI) / 4;
        const rx = Math.cos(a);
        const ry = Math.sin(a);
        let d = CLEAR_STEP;
        for (; d <= CLEAR_MAX; d += CLEAR_STEP) {
          const qx = px + rx * d;
          const qy = py + ry * d;
          if (
            qx < FIT_PAD ||
            qy < topPad ||
            qx > width - FIT_PAD ||
            qy > height - FIT_PAD
          )
            break; // ran into the frame — that edge bounds the openness
          if (fillAt(qx, qy) !== water) break; // hit land of any kind
        }
        if (d < minClear) minClear = d;
      }
      return minClear;
    };
    // Try to seat `name`(+`value`) as a short-hop chip for a region centred at
    // (cx,cy) on fill `fill`. Returns the placement (chip rect + leader) or null.
    const tryShortHopCallout = (
      cx: number,
      cy: number,
      fill: string,
      name: string,
      value: string | undefined,
      font: number = FONT,
      gap: number = HOP_GAP,
      maxLen: number = SHORT_HOP_MAX
    ): {
      x: number;
      y: number;
      rect: LabelRect;
      leader: [number, number, number, number];
    } | null => {
      const chipW = stackW(name, value, font);
      const chipH = stackH(value !== undefined, font);
      // Unit vectors — 4 cardinals + 4 diagonals. Diagonals matter: open water
      // often sits off-axis (Mexico's empty sea is WSW), and a pure-cardinal
      // scheme can only aim due-N/S/E/W. Magnitude 1 keeps each walk step = STEP px.
      const D = Math.SQRT1_2; // 0.7071…
      const dirs: Array<[number, number]> = [
        [0, -1], // north
        [0, 1], // south
        [1, 0], // east
        [-1, 0], // west
        [D, -D], // NE
        [D, D], // SE
        [-D, -D], // NW
        [-D, D], // SW
      ];
      let best: {
        x: number;
        y: number;
        rect: LabelRect;
        leader: Leader;
        len: number;
        clear: number;
      } | null = null;
      for (const [dx, dy] of dirs) {
        // Walk from the centroid outward until we leave the region's own fill —
        // that exit point is the border the chip will sit just beyond.
        let ex = cx;
        let ey = cy;
        let steps = 0;
        const maxSteps = Math.ceil(maxLen / STEP) + 1;
        while (steps < maxSteps && fillAt(ex, ey) === fill) {
          ex += dx * STEP;
          ey += dy * STEP;
          steps++;
        }
        if (fillAt(ex, ey) === fill) continue; // never left the region in reach
        // Chip centre sits a gap + half-extent beyond the border along the dir.
        const halfAlong = (Math.abs(dx) * chipW + Math.abs(dy) * chipH) / 2;
        const ccx = ex + dx * (gap + halfAlong);
        const ccy = ey + dy * (gap + halfAlong);
        const rect: LabelRect = {
          x: ccx - chipW / 2,
          y: ccy - chipH / 2,
          w: chipW,
          h: chipH,
        };
        // On-canvas (respect the title band at the top).
        if (
          rect.x < FIT_PAD ||
          rect.y < topPad ||
          rect.x + rect.w > width - FIT_PAD ||
          rect.y + rect.h > height - FIT_PAD
        )
          continue;
        // Every sampled point of the chip must be on EMPTY space (no covering a
        // valued region's data fill). Sample the four corners + centre + edge mids.
        const sx = [rect.x + 2, ccx, rect.x + rect.w - 2];
        const sy = [rect.y + 2, ccy, rect.y + rect.h - 2];
        let onEmpty = true;
        for (const px of sx)
          for (const py of sy)
            if (!isEmptyFill(fillAt(px, py))) {
              onEmpty = false;
              break;
            }
        if (!onEmpty) continue;
        // Clear every already-placed region label / chip, and every POI.
        if (placement.hitsPlaced(rect)) continue;
        if (placement.hitsObstacle(rect)) continue;
        if (placement.hitsMarker(rect)) continue;
        // Leader runs centroid → chip inner edge; cap its length and forbid it
        // from crossing any leader already drawn or any placed label box.
        const innerX = ccx - dx * (chipW / 2);
        const innerY = ccy - dy * (chipH / 2);
        const len = Math.hypot(innerX - cx, innerY - cy);
        if (len > maxLen) continue;
        const leader: Leader = [cx, cy, innerX, innerY];
        if (placement.leaderCrosses(leader)) continue;
        if (placement.leaderHitsPlaced(leader)) continue;
        // Prefer the MOST OPEN spot; fall back to the shortest leader only when
        // two candidates are about equally open (e.g. several open-water spots
        // that all saturate the clearance cap). This is what redirects a label
        // away from a cramped-but-close coast toward the empty sea.
        const clear = clearanceAt(ccx, ccy, dx, dy);
        const better =
          best === null ||
          clear > best.clear + CLEAR_TOL ||
          (clear >= best.clear - CLEAR_TOL && len < best.len);
        if (better)
          best = {
            x: ccx,
            y: ccy,
            rect,
            leader,
            len,
            clear,
          };
      }
      return best
        ? { x: best.x, y: best.y, rect: best.rect, leader: best.leader }
        : null;
    };
    for (const { r, c, boxW, boxH, candidates } of entries) {
      const valStr = regionValueStr(r.value);
      // vs other placed REGION labels (full stack) / vs POI obstacles (name only)
      // — defined up here so the subject pre-pass below can reuse them.
      const fitsRegions = (rect: LabelRect): boolean =>
        !placement.hitsPlaced(rect);
      const fitsPois = (rect: LabelRect): boolean =>
        !placement.hitsObstacle(rect);
      // A SUBJECT is a user-referenced region (the thing the map is ABOUT —
      // `regionById` holds only `resolved.regions`, so an auto-added
      // poiFrameContainer is NOT a subject). A subject must read prominently and
      // NEVER drop: a thin ribbon (Chile) whose centroid sits on a sliver doesn't
      // stamp a cramped name there — it leaders into the open space beside it.
      const isSubject = regionById.has(r.id);
      // Both horizontal extremes of `text` (centred at ax,ay, base font) land on
      // the region's own fill — true in-shape containment. Gates a DATA label's
      // in-place placement so a name that would spill off its own choropleth fill
      // onto a neighbour (where its fill-picked colour is illegible) leaders out
      // instead — which is what lets the data label drop its halo (it can no
      // longer overflow, so `overflows` is false and no rescue stroke is drawn).
      const extremesOnFill = (
        ax: number,
        ay: number,
        text: string
      ): boolean => {
        const halfW = measureLegendText(text, FONT) / 2;
        return (
          fillAt(ax - halfW, ay) === r.fill && fillAt(ax + halfW, ay) === r.fill
        );
      };
      // ── Valueless SUBJECT: prominent in-shape, else leader (the Chile case) ──
      // A user-referenced region with no metric is the map's point and must read
      // PROMINENTLY. Find the largest font (up to a cap) whose full name sits
      // wholly inside the region's own fill at the centroid AND clears every
      // obstacle (other labels, POI markers, route arcs). If that best size meets
      // the prominence floor, place it there in full contrast. If the shape is too
      // thin/small to host a prominent name even at the floor — a ribbon like Chile
      // whose centroid is a sliver — fall through to a leader that carries the
      // full name into the open space beside it. A subject NEVER drops.
      if (isSubject && valStr === undefined && r.label !== undefined) {
        const name = candidates[0]!; // subjects use the full name, never an abbrev
        let best = -1;
        for (let f = SUBJECT_FONT_MAX; f >= FONT; f--) {
          if (measureLegendText(name, f) > boxW || f + 2 * LABEL_PADY > boxH)
            continue;
          const rect = regionLabelRect(c[0], c[1], name, undefined, f);
          if (!fitsRegions(rect) || !fitsPois(rect) || collides(rect)) continue;
          const halfW = measureLegendText(name, f) / 2;
          if (
            fillAt(c[0] - halfW, c[1]) !== r.fill ||
            fillAt(c[0] + halfW, c[1]) !== r.fill
          )
            continue;
          best = f;
          break;
        }
        if (best >= SUBJECT_MIN_PROMINENCE) {
          const rect = regionLabelRect(c[0], c[1], name, undefined, best);
          placement.commit(rect);
          pushRegionLabel(
            c[0],
            c[1],
            name,
            r.fill,
            r.lineNumber,
            undefined,
            best
          );
          labeledRegionIds.add(r.id);
          regionLabelGuards.push({ label: labels[labels.length - 1]!, rect });
        } else {
          // The shape can't host a prominent name (Chile's ribbon) → leader the
          // name into the open space beside it at a PROMINENT size, pushed well
          // clear of the coast (a larger gap + reach) so it reads as the subject,
          // not a cramped afterthought.
          const hop = tryShortHopCallout(
            c[0],
            c[1],
            r.fill,
            r.label,
            undefined,
            SUBJECT_LEADER_FONT,
            HOP_GAP + SUBJECT_LEADER_FONT,
            SHORT_HOP_MAX * 2.2
          );
          if (hop) {
            placement.commit(hop.rect, hop.leader);
            const dark = mix(r.fill, palette.text, 60);
            labels.push({
              x: hop.x,
              y: hop.y,
              text: r.label,
              anchor: 'middle',
              color: palette.text,
              halo: false,
              haloColor: palette.bg,
              fontSize: SUBJECT_LEADER_FONT,
              leader: {
                x1: hop.leader[0],
                y1: hop.leader[1],
                x2: hop.leader[2],
                y2: hop.leader[3],
              },
              leaderColor: dark,
              calloutDot: { x: c[0], y: c[1], color: dark },
              lineNumber: r.lineNumber,
            });
            labeledRegionIds.add(r.id);
          }
        }
        continue;
      }
      // The first candidate that BOTH fits its own footprint AND clears every
      // already-placed region label AND every POI marker wins; none qualifies →
      // the label is hidden (a country has no abbrev, so it degrades full → hide;
      // a US state may fall back to its 2-letter code before hiding).
      // When the region carries a metric value, the name+value STACK is tried
      // first; if the stack won't fit (a smaller state), it degrades to the bare
      // name (today's behaviour) so adding values never costs an existing label.
      //
      // Two collision tests, deliberately different footprints:
      //  - vs other REGION labels: use the FULL stack rect (two stacks must not
      //    overlap).
      //  - vs POI obstacles: use only the NAME rect. A POI obstacle exists to keep
      //    the region NAME off a POI's dot/label; the (shorter, dimmer) value line
      //    hanging below a name that already clears the dot is fine. Testing the
      //    taller stack here made a region with a nearby POI (Texas under the big
      //    Dallas marker) silently drop its value even though the name fit.
      // Try the centroid first (existing placement — unchanged when it fits),
      // then a ring of offsets WITHIN the region's box so a label blocked at the
      // centroid (typically a POI marker sitting on it — Dallas on Texas) is
      // re-seated on open land of the SAME region rather than exiled to a far
      // callout column. Off-centroid anchors are kept on the region's own fill
      // (fillAt) so the label never drifts onto a neighbour or the sea.
      // Centroid is always tried. The off-centroid re-seat ring is added ONLY for
      // a region that carries a value — the point of seeking is to not lose the
      // region's VALUE to a POI on its centroid. A valueless frame container
      // (e.g. the state hosting a POI hub) keeps the old behaviour: it yields the
      // spot to the POI rather than sprouting a re-seated name near the hub.
      const seekAnchors: Array<{ x: number; y: number; guard: boolean }> = [
        { x: c[0], y: c[1], guard: false },
      ];
      if (valStr) {
        seekAnchors.push(
          { x: c[0], y: c[1] + boxH * 0.26, guard: true },
          { x: c[0], y: c[1] - boxH * 0.26, guard: true },
          { x: c[0] + boxW * 0.26, y: c[1], guard: true },
          { x: c[0] - boxW * 0.26, y: c[1], guard: true },
          { x: c[0] + boxW * 0.22, y: c[1] + boxH * 0.22, guard: true },
          { x: c[0] - boxW * 0.22, y: c[1] + boxH * 0.22, guard: true },
          { x: c[0] + boxW * 0.22, y: c[1] - boxH * 0.22, guard: true },
          { x: c[0] - boxW * 0.22, y: c[1] - boxH * 0.22, guard: true }
        );
      }
      let chosen:
        | { text: string; valueLine?: string; ax: number; ay: number }
        | undefined;
      for (const a of seekAnchors) {
        if (a.guard && fillAt(a.x, a.y) !== r.fill) continue;
        for (const t of candidates) {
          const nameRect = regionLabelRect(a.x, a.y, t);
          if (valStr && stackW(t, valStr) <= boxW && stackH(true) <= boxH) {
            const stackRect = regionLabelRect(a.x, a.y, t, valStr);
            if (
              fitsRegions(stackRect) &&
              fitsPois(nameRect) &&
              extremesOnFill(a.x, a.y, t)
            ) {
              chosen = { text: t, valueLine: valStr, ax: a.x, ay: a.y };
              break;
            }
          }
          if (labelW(t) <= boxW && labelH <= boxH) {
            // A data label must sit inside its own choropleth fill (so it can drop
            // the halo); a context/container label keeps the looser bbox fit.
            if (
              fitsRegions(nameRect) &&
              fitsPois(nameRect) &&
              (valStr === undefined || extremesOnFill(a.x, a.y, t))
            ) {
              chosen = { text: t, ax: a.x, ay: a.y };
              break;
            }
          }
        }
        if (chosen) break;
      }
      if (chosen === undefined && r.label !== undefined && isSubject) {
        // A SUBJECT whose name won't sit inside its own shape — a thin ribbon
        // (Chile) or a small valued region crowded by a POI. Rather than overflow
        // onto neighbours (illegible) or fire a long leader to a margin column
        // (spaghetti), nudge the FULL name(+value) chip a short hop into the open
        // space right beside it — out to sea, north over Canada, south over Mexico
        // — joined by a tiny non-crossing leader. A subject is the map's point, so
        // it gets this leader whether or not it carries a value. If no direction
        // has clean adjacent room within reach, the region gets no static label
        // (the shading/legend + hover carry it); a readable blank beats a tangle.
        const hop = tryShortHopCallout(c[0], c[1], r.fill, r.label, valStr);
        if (hop) {
          placement.commit(hop.rect, hop.leader);
          // Chip sits on empty land / water (the callout only seats on isEmptyFill)
          // → palette text, NO halo (full-contrast dark/light text reads cleanly on
          // the light basemap; the leader + dot tie the line back to the region).
          const dark = mix(r.fill, palette.text, 60);
          labels.push({
            x: hop.x,
            y: hop.y,
            text: r.label,
            anchor: 'middle',
            color: palette.text,
            halo: false,
            haloColor: palette.bg,
            ...(valStr !== undefined && { valueLine: valStr }),
            leader: {
              x1: hop.leader[0],
              y1: hop.leader[1],
              x2: hop.leader[2],
              y2: hop.leader[3],
            },
            leaderColor: dark,
            calloutDot: { x: c[0], y: c[1], color: dark },
            lineNumber: r.lineNumber,
          });
          labeledRegionIds.add(r.id);
        }
        continue;
      }
      // Nothing placed (a valueless region that didn't fit, or a valued region
      // with no clean adjacent space) → drop, leaving the map clean.
      if (chosen === undefined) continue;
      // Footprint-driven growth applies ONLY to orientation backdrop names — a
      // data-less neighbour/frame region (Canada framing a POI, foreign land).
      // DATA labels (a choropleth value) keep the base font + full contrast and
      // the existing fit-inside cascade UNCHANGED: fading a value washed it
      // lighter than its own region fill, and a loose bbox let a wide name
      // ("United States of America") spill past its region. Orientation names sit
      // on neutral basemap land where a larger, gently-faded backdrop reads well.
      const isOrient = r.value === undefined && r.layer === 'base';
      let font = FONT;
      if (isOrient) {
        const growT = sizeT(boxW, boxH);
        const desiredFont = Math.round(
          FONT + growT * (REGION_FONT_MAX_ORIENT - FONT)
        );
        const hasVal = chosen.valueLine !== undefined;
        // A backdrop name carries NO halo, so it must sit cleanly at whatever size
        // it takes. Try the desired (footprint-grown) size DOWN TO the base font;
        // at each, the name must fit the box, clear neighbours/POIs/route arcs
        // (`collides` adds the arc segments `fitsPois` misses), AND have both
        // horizontal extremes on a floored-readable substrate — its own fill, or
        // empty land/water (neutral/foreign/sea). The only thing it must NOT cross
        // is a saturated foreign DATA fill, where the muted floored tone is
        // illegible and there's no halo to rescue it. If nothing — not even the
        // base font — sits clean, the label is DROPPED (the basemap shading +
        // hover carry the region); a readable blank beats an unreadable name.
        const extremesClean = (f: number): boolean => {
          const halfW = measureLegendText(chosen.text, f) / 2;
          return [chosen.ax - halfW, chosen.ax + halfW].every((sx) => {
            const fAt = fillAt(sx, chosen.ay);
            return fAt === r.fill || isEmptyFill(fAt);
          });
        };
        let fit = -1;
        for (let f = desiredFont; f >= FONT; f--) {
          if (
            stackW(chosen.text, chosen.valueLine, f) > boxW ||
            stackH(hasVal, f) > boxH
          )
            continue;
          const gRect = regionLabelRect(
            chosen.ax,
            chosen.ay,
            chosen.text,
            chosen.valueLine,
            f
          );
          const gName = regionLabelRect(
            chosen.ax,
            chosen.ay,
            chosen.text,
            undefined,
            f
          );
          if (!fitsRegions(gRect) || !fitsPois(gName) || collides(gName))
            continue;
          if (!extremesClean(f)) continue;
          fit = f;
          break;
        }
        if (fit < 0) {
          // A POI-frame CONTAINER is the map's subject (its headline name) — it
          // must never drop, so it falls back to the base font even when no size
          // sits perfectly clean (the floored tone keeps it legible). A mere
          // backdrop NEIGHBOUR with no clean placement is dropped: the basemap
          // shading + hover carry it, and a readable blank beats a name crammed
          // onto an arc or a foreign data fill.
          if (!frameContainers.has(r.id)) continue;
          font = FONT;
        } else {
          font = fit;
        }
      }
      const rRect = regionLabelRect(
        chosen.ax,
        chosen.ay,
        chosen.text,
        chosen.valueLine,
        font
      );
      placement.commit(rRect);
      pushRegionLabel(
        chosen.ax,
        chosen.ay,
        chosen.text,
        r.fill,
        r.lineNumber,
        chosen.valueLine,
        font,
        isOrient ? backdropLandTone : undefined
      );
      labeledRegionIds.add(r.id);
      // Guard so a POI label landing here later makes this label yield (below).
      regionLabelGuards.push({
        label: labels[labels.length - 1]!,
        rect: rRect,
      });
    }
    // AK/HI labels live in their insets (own projection centroids). Insets are
    // tiny, so prefer the abbreviation when the canvas is compact.
    for (const seed of insetLabelSeeds) {
      const text = isCompact ? seed.iso.replace(/^US-/, '') : seed.name;
      const src = regionById.get(seed.iso);
      const valStr = regionValueStr(src?.value);
      pushRegionLabel(
        seed.x,
        seed.y,
        text,
        src ? regionFill(src) : neutralFill,
        seed.lineNumber,
        valStr
      );
      labeledRegionIds.add(seed.iso);
      regionLabelGuards.push({
        label: labels[labels.length - 1]!,
        rect: regionLabelRect(seed.x, seed.y, text, valStr),
      });
    }
  }

  // POI labels: default-on, collision-managed auto. `no-poi-labels` suppresses.
  if (resolved.directives.noPoiLabels !== true) {
    // Cluster (stack) members are laid out + labelled by the spiderfy block; keep
    // them out of the singleton/proximity-column placement here.
    const ordered = [...pois]
      .filter((p) => p.clusterId === undefined)
      .sort((a, b) => a.lineNumber - b.lineNumber || (a.id < b.id ? -1 : 1));
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
    // Candidate inline placements around a marker, in escalation order: the four
    // cardinal sides first (most legible — horizontal flanks, then above/below for
    // a hub whose edges leave sideways and block both flanks, e.g. a POI fed by
    // routes from the east AND west). The four DIAGONAL corners are a fallback tier
    // (standard 8-position cartographic placement): a route hub fed from several
    // cardinal directions leaves the diagonal gaps open, so a corner label clears
    // the arrows + neighbour dots instead of being dumped on top of them.
    type Side =
      | 'right'
      | 'left'
      | 'above'
      | 'below'
      | 'below-right'
      | 'below-left'
      | 'above-right'
      | 'above-left';
    const GAP = 3;
    // Comfort buffer between any dot/label and the canvas edge — canvas-proportional
    // (≈3% of the shorter axis, floored) so a big preview pane breathes more than a
    // thumbnail. Used BOTH by the leader-column clamp (so a column never seats hard
    // against the frame) and by the edge-clearance re-fit below (dots + inline
    // labels). Keeping the two in sync is what stops the re-fit from fighting a
    // column that would otherwise re-clamp to the edge each pass.
    const POI_EDGE_CLEAR = Math.max(
      20,
      Math.round(Math.min(width, height) * 0.03)
    );
    // Coincident-stack members (spiderfy) are labelled via a tidy leader-lined
    // COLUMN beside the cluster (see the cluster-column pass after the column
    // helpers below) — NOT radial inline labels, which pile up unreadably when
    // the ring is tight. Group the members here; the pass commits them once the
    // column machinery is defined.
    const clusterMembersById = new Map<string, MapLayoutPoi[]>();
    for (const p of pois) {
      if (p.clusterId === undefined) continue;
      const arr = clusterMembersById.get(p.clusterId);
      if (arr) arr.push(p);
      else clusterMembersById.set(p.clusterId, [p]);
    }
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
        // Diagonal corners: offset both axes by (r+GAP)/√2 so the box's near
        // corner clears the dot rim by the same gap as a cardinal side.
        case 'below-right': {
          const d = (p.r + GAP) * 0.7071;
          return { x: p.cx + d, y: p.cy + d, w, h: poiLabH };
        }
        case 'below-left': {
          const d = (p.r + GAP) * 0.7071;
          return { x: p.cx - d - w, y: p.cy + d, w, h: poiLabH };
        }
        case 'above-right': {
          const d = (p.r + GAP) * 0.7071;
          return { x: p.cx + d, y: p.cy - d - poiLabH, w, h: poiLabH };
        }
        case 'above-left': {
          const d = (p.r + GAP) * 0.7071;
          return { x: p.cx - d - w, y: p.cy - d - poiLabH, w, h: poiLabH };
        }
      }
    };
    const pushInline = (
      p: MapLayoutPoi,
      text: string,
      w: number,
      side: Side,
      clusterId?: string
    ): void => {
      const rect = inlineRect(p, w, side);
      obstacles.push(rect);
      // Right-anchored (text grows rightward): the right flank + the two right
      // corners. Left-anchored: the left flank + the two left corners. above/below
      // stay centred.
      const startSide =
        side === 'right' || side === 'below-right' || side === 'above-right';
      const endSide =
        side === 'left' || side === 'below-left' || side === 'above-left';
      const anchor = startSide ? 'start' : endSide ? 'end' : 'middle';
      const x = startSide ? rect.x : endSide ? rect.x + w : p.cx;
      labels.push({
        x,
        y: rect.y + poiLabH / 2 + FONT / 3,
        text,
        anchor,
        color: palette.text,
        halo: false,
        haloColor: palette.bg,
        poiId: p.id,
        lineNumber: p.lineNumber,
        ...(clusterId !== undefined && { clusterMember: clusterId }),
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
    type ColItem = { p: MapLayoutPoi; text: string; w: number };
    const makeItems = (group: MapLayoutPoi[]): ColItem[] =>
      group
        .map((p) => ({ p, ...labelInfo(p) }))
        .sort((a, b) => a.p.cy - b.p.cy || (a.text < b.text ? -1 : 1));
    // The column's per-row layout (side, colX, clamped startY, each row's rect).
    // Shared by the clean-check gate and the commit path so they never diverge.
    const columnRows = (
      items: ColItem[],
      side: 'right' | 'left'
    ): Array<{ o: ColItem; colX: number; rowCy: number; rect: LabelRect }> => {
      const left = Math.min(...items.map((o) => o.p.cx - o.p.r));
      const right = Math.max(...items.map((o) => o.p.cx + o.p.r));
      const maxW = Math.max(...items.map((o) => o.w));
      const cyMid =
        (Math.min(...items.map((o) => o.p.cy)) +
          Math.max(...items.map((o) => o.p.cy))) /
        2;
      // Column anchor x, clamped so the widest row's text box stays on-canvas.
      // (No-op for the clean callers; matters when a fallback column — e.g. a
      // second spider cluster boxed out of its preferred side — would otherwise
      // run a label off the frame.) A right column anchors its text start at
      // colX; a left column anchors its end at colX (text spans colX-maxW..colX).
      const colX =
        side === 'right'
          ? Math.min(right + COL_GAP, width - POI_EDGE_CLEAR - maxW)
          : Math.max(left - COL_GAP, POI_EDGE_CLEAR + maxW);
      const totalH = items.length * step;
      let startY = cyMid - totalH / 2;
      startY = Math.max(
        POI_EDGE_CLEAR,
        Math.min(startY, height - totalH - POI_EDGE_CLEAR)
      );
      return items.map((o, i) => {
        const rowCy = startY + i * step + step / 2;
        return {
          o,
          colX,
          rowCy,
          rect: {
            x: side === 'right' ? colX : colX - o.w,
            y: rowCy - poiLabH / 2,
            w: o.w,
            h: poiLabH,
          },
        };
      });
    };
    // Pure gate (NO mutation): every row on-canvas AND collision-free, at the
    // post-startY-clamp positions the commit path will use.
    const wouldColumnBeClean = (
      items: ColItem[],
      side: 'right' | 'left'
    ): boolean =>
      columnRows(items, side).every(
        ({ rect }) =>
          rect.x >= 0 &&
          rect.x + rect.w <= width &&
          rect.y >= 0 &&
          rect.y + rect.h <= height &&
          !collides(rect)
      );
    // Open-space score for a candidate label rect (higher = better). Cartographic
    // convention: a coastal point throws its label out over the water, never back
    // across the land it sits on. So a side whose label footprint lands over open
    // water dominates; among equally-wet (or equally-dry) sides, the one with more
    // clearance to the canvas edge wins. Sampled at a fixed 3×2 grid → deterministic.
    const WATER_PREF = 1000; // a water-facing side beats any land-facing side
    const openness = (rect: LabelRect): number => {
      const xs = [
        rect.x + rect.w * 0.15,
        rect.x + rect.w * 0.5,
        rect.x + rect.w * 0.85,
      ];
      const ys = [rect.y + rect.h * 0.25, rect.y + rect.h * 0.75];
      let waterHits = 0;
      for (const x of xs)
        for (const y of ys) if (fillAt(x, y) === water) waterHits++;
      const waterFrac = waterHits / (xs.length * ys.length);
      const edgeClear = Math.max(
        0,
        Math.min(
          rect.x,
          width - (rect.x + rect.w),
          rect.y,
          height - (rect.y + rect.h)
        )
      );
      // edgeClear scaled to ~0..30 so it only breaks ties, never overrides water.
      return WATER_PREF * waterFrac + edgeClear * 0.1;
    };
    // A column side's openness = mean openness over its rows' label rects.
    const columnSideScore = (
      items: ColItem[],
      side: 'right' | 'left'
    ): number => {
      const rows = columnRows(items, side);
      if (rows.length === 0) return -Infinity;
      return rows.reduce((s, { rect }) => s + openness(rect), 0) / rows.length;
    };
    // Side heuristic for ungated callouts: prefer the more open (water-facing,
    // then roomier) flank rather than blindly seating the column on the right.
    const defaultColumnSide = (items: ColItem[]): 'right' | 'left' =>
      columnSideScore(items, 'right') >= columnSideScore(items, 'left')
        ? 'right'
        : 'left';
    // Commit a visible callout column on the GIVEN side (no re-deriving the
    // side — the caller has already validated it). When `clusterId` is set the
    // rows are tagged `clusterMember` so the app shows/hides them (text AND
    // leader) with the collapsed-stack badge.
    const commitColumn = (
      items: ColItem[],
      side: 'right' | 'left',
      clusterId?: string
    ): void => {
      for (const { o, colX, rowCy, rect } of columnRows(items, side)) {
        obstacles.push(rect);
        labels.push({
          x: colX,
          y: rowCy + FONT / 3,
          text: o.text,
          anchor: side === 'right' ? 'start' : 'end',
          color: palette.text,
          halo: false,
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
          ...(clusterId !== undefined && { clusterMember: clusterId }),
        });
      }
    };
    // Hover-only fallback: a single inline label beside the dot (no leader),
    // emitted invisible and revealed on hover. NOT added to obstacles (it's
    // invisible and must not displace visible labels). y is clamped on-canvas
    // because we skip the inlineFits four-edge check (F8).
    const pushHidden = (p: MapLayoutPoi): void => {
      const { text, w } = labelInfo(p);
      let x = p.cx + p.r + GAP;
      let anchor: 'start' | 'end' = 'start';
      if (x + w > width) {
        x = p.cx - p.r - GAP - w;
        anchor = 'end';
      }
      const y = Math.max(0, Math.min(p.cy - poiLabH / 2, height - poiLabH));
      labels.push({
        x: anchor === 'start' ? x : x + w,
        y: y + poiLabH / 2 + FONT / 3,
        text,
        anchor,
        color: palette.text,
        halo: false,
        haloColor: palette.bg,
        poiId: p.id,
        hidden: true,
        lineNumber: p.lineNumber,
      });
    };

    // A small coincident stack reads best with each member's label hugging its
    // OWN fanned dot on the side it fans toward — the fan already seats the dots
    // radially (member 0 due North, the next due South for a pair, …), so a top
    // dot takes its label ABOVE and a bottom dot takes it BELOW. Compact and
    // symmetric, and — unlike a one-sided leader column — it never overruns the
    // frame when the stack sits hard against a coast (the San Jose case). The
    // labels carry `clusterMember` so the app still toggles them with the badge.
    const STACK_RADIAL_MAX = 4; // above/below/left/right — one slot per member
    const radialSide = (p: MapLayoutPoi, cx: number, cy: number): Side => {
      const dx = p.cx - cx;
      const dy = p.cy - cy;
      return Math.abs(dy) >= Math.abs(dx)
        ? dy <= 0
          ? 'above'
          : 'below'
        : dx < 0
          ? 'left'
          : 'right';
    };
    // Seat every member radially (preferred side first, then the rest), each new
    // label blocking the next. All-or-nothing: if any member can't seat on-canvas
    // and clean, bail so the caller falls back to the leader-lined column.
    const tryStackRadial = (items: ColItem[], clusterId: string): boolean => {
      const cluster = clusters.find((c) => c.id === clusterId);
      if (!cluster || items.length > STACK_RADIAL_MAX) return false;
      const temp: LabelRect[] = [];
      const seated: Array<{
        p: MapLayoutPoi;
        text: string;
        w: number;
        side: Side;
      }> = [];
      for (const { p, text, w } of items) {
        const pref = radialSide(p, cluster.cx, cluster.cy);
        const order: Side[] = [
          pref,
          ...(['above', 'below', 'right', 'left'] as Side[]).filter(
            (s) => s !== pref
          ),
        ];
        const side = order.find((s) => {
          const rect = inlineRect(p, w, s);
          return (
            rect.x >= 0 &&
            rect.x + rect.w <= width &&
            rect.y >= 0 &&
            rect.y + rect.h <= height &&
            !collides(rect) &&
            !temp.some((t) => rectsOverlap(t, rect))
          );
        });
        if (side === undefined) return false;
        temp.push(inlineRect(p, w, side));
        seated.push({ p, text, w, side });
      }
      for (const { p, text, w, side } of seated)
        pushInline(p, text, w, side, clusterId);
      return true;
    };
    // Spiderfy clusters: committed FIRST so the singleton/group passes route
    // around them. Try the compact radial layout; only a stack too big (or too
    // boxed-in) for cardinal slots falls back to a tidy leader-lined column,
    // thrown to the cleaner/seaward flank.
    for (const [clusterId, members] of clusterMembersById) {
      if (members.length === 0) continue;
      const items = makeItems(members);
      if (tryStackRadial(items, clusterId)) continue;
      const cleanR = wouldColumnBeClean(items, 'right');
      const cleanL = wouldColumnBeClean(items, 'left');
      const side =
        cleanR && cleanL
          ? defaultColumnSide(items)
          : cleanR
            ? 'right'
            : cleanL
              ? 'left'
              : defaultColumnSide(items);
      commitColumn(items, side, clusterId);
    }

    // Placement quality for a singleton's inline label. Beyond the hard collision
    // veto (inlineFits already drops any slot that overlaps a dot/label/arrow), we
    // rank the SURVIVING candidates so the label takes the roomiest slot, not just
    // the first clean cardinal flank. Three terms:
    //   • clearance (PRIMARY) — how far the slot sits from the NEAREST other POI
    //     dot and the nearest connector arrow (capped). This is what makes a hub
    //     run its label out into the open AWAY from a neighbour cluster + the legs,
    //     rather than hugging them on a technically-clean flank.
    //   • openness (secondary tiebreaker) — water-facing + canvas-edge clearance
    //     (existing helper), down-weighted so a roomy slot beats a cramped one even
    //     when the cramped slot sits over slightly more open water.
    //   • legibility (tertiary) — a mild prior: horizontal flanks read best, then
    //     above/below, then the diagonal corners. Breaks near-ties toward the
    //     conventional layout without overriding a clearly roomier slot.
    const CLEAR_CAP = 48; // px past which a slot already reads as wide-open
    const CLEAR_W = 8; // weight on clearance (CLEAR_CAP·W ≈ 384 — the dominant term)
    const WATER_W = 0.25; // down-weight the openness term to a tiebreaker (≤ ~250)
    const ptSegDist = (
      px: number,
      py: number,
      ax: number,
      ay: number,
      bx: number,
      by: number
    ): number => {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };
    const clearanceOf = (rect: LabelRect, ownId: string): number => {
      const cxL = rect.x + rect.w / 2;
      const cyL = rect.y + rect.h / 2;
      let d = CLEAR_CAP;
      for (const q of pois) {
        if (q.id === ownId) continue; // its own dot is meant to be adjacent
        d = Math.min(d, Math.hypot(q.cx - cxL, q.cy - cyL) - q.r);
      }
      for (const s of legSegments)
        d = Math.min(d, ptSegDist(cxL, cyL, s[0], s[1], s[2], s[3]));
      return Math.max(0, d);
    };
    const LEGIBILITY: Record<Side, number> = {
      right: 160,
      left: 160,
      above: 100,
      below: 100,
      'below-right': 0,
      'below-left': 0,
      'above-right': 0,
      'above-left': 0,
    };
    const ALL_SIDES = Object.keys(LEGIBILITY) as Side[];
    const placementScore = (p: MapLayoutPoi, w: number, side: Side): number => {
      const rect = inlineRect(p, w, side);
      return (
        CLEAR_W * clearanceOf(rect, p.id) +
        WATER_W * openness(rect) +
        LEGIBILITY[side]
      );
    };

    // Per-render extent threshold (resolution-relative; Decision #1, F9).
    const maxExtent = MAX_CLUSTER_EXTENT_FACTOR * Math.min(width, height);
    // Pass 1: place singletons (unchanged); for ≥2 clusters resolve gate
    // (a)/(a2) — sprawl/overflow → hover-only. These hides push NOTHING to
    // obstacles, so doing them first decouples the gate-(b) clean-checks below
    // from commit order (F4). Surviving clusters defer to pass 2.
    const clusterPending: ColItem[][] = [];
    for (const g of groups) {
      const items = makeItems(g);
      if (g.length === 1) {
        // Singleton: inline if it fits, else today's single-row callout —
        // always placed, never hover-only (Decision #2 / AC9).
        const { p, text, w } = items[0]!;
        // Score every clean candidate (4 cardinal + 4 diagonal) and take the
        // roomiest — see placementScore. A route hub blocked on every side falls
        // to the always-placed leader column (a singleton is never hover-only).
        const scored = ALL_SIDES.filter((s) => inlineFits(p, w, s)).map(
          (s) => ({
            s,
            v: placementScore(p, w, s),
          })
        );
        if (scored.length === 0) {
          commitColumn(items, defaultColumnSide(items));
          continue;
        }
        const side = scored.reduce((b, c) => (c.v > b.v ? c : b)).s;
        pushInline(p, text, w, side);
        continue;
      }
      // Gate (a): bounding-box diagonal over marker extents — a sprawling chain
      // whose column leaders would fan across the map. Gate (a2): too many rows
      // to stack readably. Either → whole cluster hover-only.
      const left = Math.min(...items.map((o) => o.p.cx - o.p.r));
      const right = Math.max(...items.map((o) => o.p.cx + o.p.r));
      const minCy = Math.min(...items.map((o) => o.p.cy));
      const maxCy = Math.max(...items.map((o) => o.p.cy));
      const diag = Math.hypot(right - left, maxCy - minCy);
      if (diag > maxExtent || items.length > MAX_COLUMN_ROWS) {
        items.forEach((o) => pushHidden(o.p));
      } else {
        clusterPending.push(items);
      }
    }
    // Pass 2: gate (b) — a surviving cluster shows its column only if a right-
    // or left-side column places fully clean; commit on that exact side, else
    // the whole cluster goes hover-only.
    for (const items of clusterPending) {
      const cleanSides = (['right', 'left'] as const).filter((s) =>
        wouldColumnBeClean(items, s)
      );
      const side =
        cleanSides.length > 1
          ? defaultColumnSide(items) // both clean → most open flank
          : cleanSides[0];
      if (side) commitColumn(items, side);
      else items.forEach((o) => pushHidden(o.p));
    }

    // ── Edge clearance (re-fit, first pass → re-run) ──
    // The tight fit (FIT_PAD = 24px) can seat a POI — or its label (inline OR
    // leader column) — hard against a side, off-canvas, or demoted to hover-only.
    // Measure how far every POI dot AND every POI label crosses a comfort
    // clearance line on each of the four sides, reserve the deepest intrusion per
    // side as a band, and re-fit the whole map into the canvas MINUS those bands —
    // the data (dots and labels together) slides inward so nothing hugs the frame.
    // The clearance scales with the canvas (≈3% of the shorter axis, floored) so a
    // big preview pane gets proportionally more breathing room than a thumbnail.
    // Asymmetric and "just enough": only the crowded sides zoom out, the rest stay
    // tight. A committed label's box is reconstructed from its baseline/anchor; a
    // still-hidden (hover-only) label is measured at its IDEAL seaward position
    // (its stored rect is clamped on-canvas and would read as no intrusion).
    // Re-measured and accumulated each pass until nothing intrudes, capped at
    // `MAX_CLEARANCE_PASSES` so a pathologically small canvas can't loop forever.
    const clearancePass = opts._poiClearancePass ?? 0;
    const MAX_CLEARANCE_PASSES = 4;
    if (clearancePass < MAX_CLEARANCE_PASSES && pois.length > 0) {
      const EDGE_CLEAR = POI_EDGE_CLEAR; // shared with the leader-column clamp
      const capH = Math.floor(width * 0.3); // never starve the map for one wide name
      const capV = Math.floor(height * 0.3);
      const poiById2 = new Map(pois.map((p) => [p.id, p]));
      let needLeft = 0;
      let needRight = 0;
      let needTop = 0;
      let needBottom = 0;
      // Dots first: a marker itself must clear every edge by the buffer, so a
      // corner cluster is pulled bodily inward (its labels ride along).
      // Top is measured against the canvas edge (y=0), NOT topPad: the title band
      // (topPad) already separates content from the top, so a dot/label just under
      // it is not "hugging the edge" — referencing topPad would shove every POI map
      // down by the buffer for no reason.
      for (const p of pois) {
        needLeft = Math.max(needLeft, EDGE_CLEAR - (p.cx - p.r));
        needRight = Math.max(needRight, p.cx + p.r + EDGE_CLEAR - width);
        needTop = Math.max(needTop, EDGE_CLEAR - (p.cy - p.r));
        needBottom = Math.max(needBottom, p.cy + p.r + EDGE_CLEAR - height);
      }
      for (const l of labels) {
        if (l.poiId === undefined) continue;
        const p = poiById2.get(l.poiId);
        if (!p) continue;
        // A leader-lined COLUMN (visible) or a hover-only HIDDEN label both want a
        // seaward column beside the dot. Measuring their CLAMPED rect is useless —
        // a column self-clamps to the edge (so it reads as no intrusion yet sits on
        // the dots), and a hidden label's stored rect is clamped too. Instead
        // reserve from the DOT so the column fits at its NATURAL seat (dot edge +
        // COL_GAP + label width + buffer). This is dot-based, so it CONVERGES as
        // the data slides in — unlike measuring the self-clamped label, which would
        // never move off the edge. The column then seats beside the dots (no clamp,
        // no overlap) and shows. COL_GAP matches the column layout's own gap.
        if (l.hidden || l.leader) {
          const lw = l.hidden
            ? labelInfo(p).w
            : measureLegendText(l.text, FONT);
          const reach = p.r + COL_GAP + lw + EDGE_CLEAR;
          if (p.cx >= width / 2)
            needRight = Math.max(needRight, p.cx + reach - width);
          else needLeft = Math.max(needLeft, reach - p.cx);
          continue;
        }
        // Visible inline label: reconstruct its box from baseline + anchor and
        // measure how far it crosses each clearance line (negative = inside).
        const w = measureLegendText(l.text, FONT);
        const boxLeft =
          l.anchor === 'start'
            ? l.x
            : l.anchor === 'end'
              ? l.x - w
              : l.x - w / 2;
        const boxTop = l.y - FONT / 3 - poiLabH / 2;
        const boxRight = boxLeft + w;
        const boxBottom = boxTop + poiLabH;
        needLeft = Math.max(needLeft, EDGE_CLEAR - boxLeft);
        needRight = Math.max(needRight, boxRight + EDGE_CLEAR - width);
        needTop = Math.max(needTop, EDGE_CLEAR - boxTop);
        needBottom = Math.max(needBottom, boxBottom + EDGE_CLEAR - height);
      }
      needLeft = Math.min(Math.max(0, Math.ceil(needLeft)), capH);
      needRight = Math.min(Math.max(0, Math.ceil(needRight)), capH);
      needTop = Math.min(Math.max(0, Math.ceil(needTop)), capV);
      needBottom = Math.min(Math.max(0, Math.ceil(needBottom)), capV);
      if (needLeft >= 1 || needRight >= 1 || needTop >= 1 || needBottom >= 1) {
        // ADD the residual intrusion to the band already reserved (the measured
        // positions already reflect prior bands, so `need` is what's still over the
        // line) and re-fit. Accumulating — not max — is what makes a too-tight
        // first shift converge on the next pass instead of stalling.
        const prev = opts._calloutReserve;
        const left = Math.min((prev?.left ?? 0) + needLeft, capH);
        const right = Math.min((prev?.right ?? 0) + needRight, capH);
        const top = Math.min((prev?.top ?? 0) + needTop, capV);
        const bottom = Math.min((prev?.bottom ?? 0) + needBottom, capV);
        return layoutMap(resolved, data, size, {
          ...opts,
          _poiClearancePass: clearancePass + 1,
          _calloutReserve: {
            ...(left > 0 && { left }),
            ...(right > 0 && { right }),
            ...(top > 0 && { top }),
            ...(bottom > 0 && { bottom }),
          },
        });
      }
    }
  }

  // Region/orientation labels yield to POI labels (the subject). A region label
  // whose footprint a visible POI label now overlaps is removed — the POI data
  // owns that spot, and the region label is orientation that reads fine absent
  // here (vs. crammed atop a dot). Done after POI placement because the region
  // pass runs first and couldn't see where the POI labels would land. POI label
  // rects are padded a touch so a near-touch also triggers the yield.
  if (regionLabelGuards.length > 0) {
    const PAD = 2;
    const poiRects = labels
      .filter((l) => l.poiId !== undefined && l.hidden !== true)
      .map((l) => {
        const w = measureLegendText(l.text, FONT);
        const x =
          l.anchor === 'start'
            ? l.x
            : l.anchor === 'end'
              ? l.x - w
              : l.x - w / 2;
        return {
          x: x - PAD,
          y: l.y - FONT,
          w: w + 2 * PAD,
          h: FONT * 1.4 + 2 * PAD,
        };
      });
    for (const g of regionLabelGuards) {
      if (poiRects.some((pr) => rectsOverlap(pr, g.rect))) {
        const i = labels.indexOf(g.label);
        if (i >= 0) labels.splice(i, 1);
      }
    }
  }

  // -- Edge/leg labels: dodge POI dots + committed labels --
  // A connector's label (a freight weight, a pact name) rides its line midpoint by
  // default. Nudge it ALONG the chord — then a small perpendicular hop — to the
  // first slot that clears every POI dot and every committed region/POI label, so a
  // label crossing a busy port stops sitting on top of it. The line itself is NOT
  // an obstacle (a label is meant to ride its own line); falls back to the midpoint
  // if no slot is clean. Chosen rects also feed `obstacles` so the context-label
  // pass below dodges them too. Runs on the settled layout (after the POI-clearance
  // re-fit has converged), so dot/label positions are final.
  if (legs.some((lg) => lg.label !== undefined)) {
    const committedBoxes: LabelRect[] = labels
      .filter((l) => !l.hidden)
      .map((l) => {
        const w = labelW(l.text);
        const x =
          l.anchor === 'start'
            ? l.x
            : l.anchor === 'end'
              ? l.x - w
              : l.x - w / 2;
        return { x, y: l.y - labelH / 2, w, h: labelH };
      });
    const placedEdge: LabelRect[] = [];
    const T_LIST = [0.5, 0.42, 0.58, 0.34, 0.66, 0.28, 0.72];
    for (let i = 0; i < legs.length; i++) {
      const lg = legs[i]!;
      if (lg.label === undefined) continue;
      const a = poiScreen.get(lg.fromId);
      const b = poiScreen.get(lg.toId);
      if (!a || !b) continue;
      const w = labelW(lg.label);
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len; // unit normal to the chord
      const perp = labelH + 2;
      // A label rides ON its line by default (off=0 first) — a hairline under
      // the text reads fine and looks intentional. But a HEAVY weighted leg
      // (value→width up to W_MAX) draws a thick dark stroke, and text centred on
      // it is unreadable (dark-on-dark, no contrast). For those, lead with a
      // perpendicular hop that clears the stroke's half-width + the label's own
      // half-height + a gap, so the text sits just BESIDE the line on open
      // ground (both sides tried; the first clean one — typically the open-water
      // side — wins). Thin legs keep the ride-on default untouched.
      const stroke = lg.width ?? W_MIN;
      const clearW = stroke / 2 + labelH / 2 + 3;
      const offList =
        stroke >= 4
          ? [clearW, -clearW, clearW + perp, -(clearW + perp), 0]
          : [0, perp, -perp, 2 * perp, -2 * perp];
      // Walk the ACTUAL DRAWN PATH, not the chord: parse the leg's `d` (the
      // trimmed `M…Q…` arc or `M…L…` line) and sample the curve at each t, so a
      // label rides its own bowed line instead of floating at the chord midpoint
      // out in open space (the trans-Atlantic arc case). The perpendicular hop
      // uses the chord normal, which is close enough to nudge a label clear.
      const pm =
        /^M(-?[\d.]+),(-?[\d.]+)(?:L(-?[\d.]+),(-?[\d.]+)|Q(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+))$/.exec(
          lg.d
        );
      const pointAt = (t: number): [number, number] => {
        if (pm?.[5] !== undefined) {
          const u = 1 - t;
          return [
            u * u * +pm[1]! + 2 * u * t * +pm[5]! + t * t * +pm[7]!,
            u * u * +pm[2]! + 2 * u * t * +pm[6]! + t * t * +pm[8]!,
          ];
        }
        if (pm?.[3] !== undefined)
          return [
            +pm[1]! + (+pm[3]! - +pm[1]!) * t,
            +pm[2]! + (+pm[4]! - +pm[2]!) * t,
          ];
        return [a.cx + dx * t, a.cy + dy * t];
      };
      // Stay ON the line first (slide along it), then escalate to a perpendicular
      // hop — growing — so a label on a SHORT leg between two close dots (where
      // every on-line slot straddles an endpoint) can still escape above or below.
      const candidates: Array<[number, number]> = [];
      for (const off of offList)
        for (const t of T_LIST) {
          const [bx, by] = pointAt(t);
          candidates.push([bx + nx * off, by + ny * off - 4]);
        }
      const clean = ([cx, cy]: [number, number]): boolean => {
        const rect = { x: cx - w / 2, y: cy - labelH / 2, w, h: labelH };
        if (
          rect.x < 0 ||
          rect.x + w > width ||
          rect.y < 0 ||
          rect.y + rect.h > height
        )
          return false;
        if (markers.some((m) => rectCircleOverlap(rect, m))) return false;
        if (committedBoxes.some((o) => rectsOverlap(o, rect))) return false;
        if (placedEdge.some((o) => rectsOverlap(o, rect))) return false;
        return true;
      };
      const mid = pointAt(0.5);
      const [cx, cy] = candidates.find(clean) ?? [mid[0], mid[1] - 4];
      const style = labelOnFill(fillAt(cx, cy));
      // MapLayoutLeg fields are readonly — replace the entry with an updated copy.
      legs[i] = {
        ...lg,
        labelX: cx,
        labelY: cy,
        labelColor: style.color,
        labelHalo: style.halo,
        labelHaloColor: style.haloColor,
      };
      const rect = { x: cx - w / 2, y: cy - labelH / 2, w, h: labelH };
      placedEdge.push(rect);
      obstacles.push(rect);
    }
  }

  // -- Context labels (orientation backdrop, §24B). Placed DEAD LAST so they
  // only fill leftover space and never displace a data/region/POI label
  // (Decision 7). Off by default; gated on the directive so it costs nothing. --
  if (resolved.directives.noContextLabels !== true) {
    // F1: context labels must dodge EVERY committed label (region/inset/POI/
    // route), not just the POI-label rects already in `obstacles`. Region
    // labels go into `labels` but never into `obstacles`, so add a footprint
    // rect for each committed label here (POI rects are already present —
    // duplicates are harmless). This upholds Decision 7's "never displace a
    // data/region/POI label" against the live `collides` closure.
    for (const l of labels) {
      // Hidden (hover-only) labels are invisible — context labels must not
      // reserve space around them (Decision #7).
      if (l.hidden) continue;
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
    // Pass 1: collect the raw country records (feature + screen bbox/anchor),
    // carrying `f` so pass 2 can generate dodge positions from the SAME rendered
    // geometry (D14 — no re-decode).
    type RawCountry = {
      f: GeoFeature;
      iso: string;
      name: string;
      bbox: [number, number, number, number];
      anchor: [number, number] | null;
      curatedLngLat: readonly [number, number] | null;
      area: number;
    };
    const rawCountries: RawCountry[] = [];
    for (const f of worldLayer.values()) {
      const iso = typeof f.id === 'string' ? f.id : String(f.id ?? '');
      if (!iso || regionById.has(iso) || labeledRegionIds.has(iso)) continue;
      // In a US view the us-states layer paints AND labels the country, so the
      // redundant "United States" nation label is dropped (mirrors the basemap
      // drop of the US polygon at draw time).
      if (usContext && iso === 'US') continue;
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
      rawCountries.push({
        f,
        iso,
        name: (f.properties as { name?: string } | undefined)?.name ?? iso,
        bbox: [x0, y0, x1, y1],
        anchor: a && Number.isFinite(a[0]) ? [a[0], a[1]] : null,
        curatedLngLat: anchorLngLat ?? null,
        area: (x1 - x0) * (y1 - y0),
      });
    }
    // Pass 2: generate multi-position dodge candidates EAGERLY for the top
    // `budget + margin` area-ranked countries only — only that many can win a slot,
    // so generating for all ~45 in-view countries is wasted PiP work (D15). The
    // band/budget helpers live in the pure module; compute them here since layout
    // doesn't otherwise hold them. Positions[0] becomes the anchor so the
    // single-anchor `anchor === positions[0]` invariant (D12) holds.
    const cBand = tierBand(Math.max(dLonSpan, dLatSpan));
    const cBudget = labelBudget(width, height, cBand);
    // A nation touching the viewport is labeled UNCONDITIONALLY (Option A symmetric
    // orientation — Canada AND Mexico together) EXCEPT on a world view, where every
    // country would flood the frame; there nations fall back to the budgeted,
    // area-ranked path. Passed through as `bordering` on each nation candidate.
    const nationsUnconditional = cBand !== 'world';
    // Generate dodge positions for the top `budget + margin` countries by AREA (the
    // same deterministic order placeContextLabels commits in — no proximity knob).
    // Generating for all ~45 in-view countries on a world map is wasted PiP work
    // (D15); the +MARGIN slack covers the module's extra fit/viewport filtering so
    // the eventual winner still carries dodge positions.
    const topN = cBudget + COUNTRY_POS_TOPN_MARGIN;
    const rankOrder = rawCountries
      .map((r, idx) => ({ idx, area: r.area }))
      .filter((r) => Number.isFinite(r.area) && r.area > 0)
      .sort((a, b) => b.area - a.area)
      .slice(0, topN);
    const genIdx = new Set(rankOrder.map((r) => r.idx));
    for (let i = 0; i < rawCountries.length; i++) {
      const r = rawCountries[i]!;
      let anchor = r.anchor;
      let positions: readonly (readonly [number, number])[] | undefined;
      if (genIdx.has(i) && anchor) {
        const gb = geoBounds(r.f as never) as [
          [number, number],
          [number, number],
        ];
        const gen = countryLabelPositions({
          geometry: r.f.geometry,
          bounds: gb,
          project,
          width,
          height,
          curated: r.curatedLngLat,
        });
        if (gen.length) {
          positions = gen.map((p) => p.screen);
          anchor = positions[0] as [number, number]; // D12: anchor === positions[0]
        }
      }
      countryCandidates.push({
        name: r.name,
        bbox: r.bbox,
        anchor,
        curatedAnchor: !!r.curatedLngLat,
        bordering: nationsUnconditional,
        ...(positions ? { positions } : {}),
      });
    }
    // Framed US states (POI-only region framing): when the frame is snapped to a
    // US-state container (e.g. California), label the focus state AND the
    // surrounding in-frame states (Nevada, Oregon, Arizona…) in the muted context
    // style for orientation. None are data (the region-label pass skipped them).
    // Anchor each to the centroid of its VISIBLE (culled) geometry so a state only
    // partly in frame (a sliver of Oregon at the top) still anchors on-screen
    // rather than at an off-frame centroid that `insideViewport` would reject.
    // The focus container IS included (gives the map its headline name) — only a
    // data-referenced state is skipped, to avoid double-labelling what
    // region-labels already named.
    const framedStateContainers = (resolved.poiFrameContainers ?? []).some(
      (id) => id.startsWith('US-')
    );
    if (usLayer && framedStateContainers) {
      for (const [iso, f] of usLayer) {
        if (regionById.has(iso) || labeledRegionIds.has(iso)) continue;
        const viewF = cullFeatureToView(f);
        if (!viewF) continue; // not in frame
        const b = path.bounds(viewF as never) as [
          [number, number],
          [number, number],
        ];
        const [x0, y0] = b[0];
        const [x1, y1] = b[1];
        if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
        const a = path.centroid(viewF as never) as [number, number];
        countryCandidates.push({
          name: (f.properties as { name?: string } | undefined)?.name ?? iso,
          bbox: [x0, y0, x1, y1],
          anchor: a && Number.isFinite(a[0]) ? [a[0], a[1]] : null,
        });
      }
    }
    const contextLabels = placeContextLabels({
      projection: resolved.projection,
      dLonSpan,
      dLatSpan,
      width,
      height,
      waterBodies: data.waterBodies,
      countries: countryCandidates,
      palette,
      // One muted, contrast-floored tone shared with the orientation backdrop
      // (region pass) so a context country (Canada) and an orientation region
      // (Minnesota) read identically — never below the WCAG-AA floor, no fade.
      countryTone: backdropLandTone,
      waterTone: backdropWaterTone,
      project,
      collides,
      // Water labels must stay over open water — `fillAt` returns the ocean
      // backdrop colour off-land and a region fill on-land (lakes/states count
      // as land here, which is the safe side for an ocean name).
      overLand: (x, y) => fillAt(x, y) !== water,
    });
    labels.push(...contextLabels);
  }

  // ── Subtle city dots (basemap orientation, §24B `no-cities`) ──
  // Runs after POI placement so the dots can dodge the markers; see
  // `layoutCityDots` for why the cull is a projected-pixel test and not an
  // extent box.
  const cityDots =
    resolved.directives.noCities !== true
      ? layoutCityDots({
          cities: data.gazetteer.cities,
          occupied: pois.map((p) => ({ x: p.cx, y: p.cy })),
          project,
          width,
          height,
        })
      : [];

  return {
    width,
    height,
    background: water,
    title: shownTitle,
    ...(resolved.subtitle !== undefined && { subtitle: resolved.subtitle }),
    ...(resolved.caption !== undefined && { caption: resolved.caption }),
    regions,
    rivers,
    relief,
    reliefHatch,
    coastlineStyle,
    legs,
    pois,
    cityDots,
    clusters,
    labels,
    legend,
    insets,
    insetRegions,
    projection,
    stretch: stretchParams,
    diagnostics: [],
  };
}
