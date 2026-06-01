// AST for the `map` chart type, produced by parseMap (src/map/parser.ts).
// RAW + un-resolved: region/POI/edge names are verbatim strings; geocoding,
// ISO/GeoNames validation, did-you-mean, dedup, and basemap/extent inference
// are the resolver's job (step 3). Rendering is step 4. See spec §24B.
import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

/** A POI / route-stop position: gazetteer name (+ optional ISO scope) or coords. */
export type PoiPos =
  | { readonly kind: 'coords'; readonly lat: number; readonly lon: number }
  | { readonly kind: 'name'; readonly name: string; readonly scope?: string };

/** `scale <min> <max> [center <n>]` (center reserved for the diverging seam, §24B.12). */
export interface MapScale {
  readonly min: number;
  readonly max: number;
  readonly center?: number;
}

/** One-shot directives (§24B.2/.7). Values are raw strings unless typed. */
export interface MapDirectives {
  region?: string;
  projection?: string;
  /** Legend label for the region value ramp (`region-metric <label>`). */
  regionMetric?: string;
  /** Legend label for the POI value (marker size) channel (`poi-metric`). */
  poiMetric?: string;
  /** Legend label for the edge/leg value (thickness) channel (`flow-metric`). */
  flowMetric?: string;
  scale?: MapScale;
  regionLabels?: string; // full | abbrev | off
  poiLabels?: string; // off | auto | all
  defaultCountry?: string;
  defaultState?: string;
  activeTag?: string;
  noLegend?: boolean;
  /** Suppress the Alaska & Hawaii inset boxes drawn under the `albers-usa`
   *  projection (bare flag `no-insets`). Only meaningful for the US states
   *  basemap; silently ignored under any other projection. */
  noInsets?: boolean;
  subtitle?: string;
  caption?: string;
  /** Basemap dress override (bare flags `muted` / `natural`). Forces the
   *  land/water styling regardless of whether a colouring dimension is active —
   *  `muted` recedes to neutral grays, `natural` keeps the green/blue reference
   *  dress. Absent → auto (muted iff a score/tag dimension is active). Lets two
   *  maps in one deck share a look. */
  basemapStyle?: 'muted' | 'natural';
}

/** A region-fill: a subdivision name with an optional score and/or tag values
 *  (§24B.3/.4 — BOTH may be present; bivariate seam). */
export interface MapRegion {
  readonly name: string;
  /** Optional trailing ISO scope qualifier (§24B.8) — a 3166-1 country code
   *  (`Georgia US` → US context) or 3166-2 subdivision (`Georgia US-GA`).
   *  Forces the country-vs-state interpretation and silences the ambiguity warning. */
  readonly scope?: string;
  /** Numeric value → choropleth shade (§24B.3). Lifted out of `meta`. */
  readonly value?: number;
  /** Tag values keyed by lowercased tag GROUP name (alias is resolved away). */
  readonly tags: Readonly<Record<string, string>>;
  /** Any remaining reserved keys captured verbatim (`label`/`style`/…). */
  readonly meta: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

/** A point of interest (§24B.5). `meta` holds the numeric `value` (→ marker
 *  size) and `style` verbatim; `label` is lifted out. */
export interface MapPoi {
  readonly pos: PoiPos;
  readonly alias?: string;
  readonly label?: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

/** One leg of a route (§24B.6): an edge from the previous stop to `dest`. Reuses
 *  the edge arrow idiom — in-arrow text = leg label, `value:` = leg thickness,
 *  `->`/`~>` (or the header `style: arc`) = shape. Stop-targeted keys on the leg
 *  line (`tag`, `label:`) decorate the DESTINATION point. */
export interface MapRouteLeg {
  readonly label?: string; // in-arrow leg label
  readonly style: 'straight' | 'arc';
  readonly value?: string; // leg thickness (numeric string, like an edge)
  readonly dest: PoiPos;
  readonly destAlias?: string;
  readonly destLabel?: string;
  readonly destTags: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

/** An ordered, auto-numbered route (§24B.6): `route <origin> [style: arc]` + a
 *  sequence of indented arrow legs, each continuing from the previous stop.
 *  Repeat the origin as a leg's destination to close a loop. */
export interface MapRoute {
  readonly origin: PoiPos;
  readonly originAlias?: string;
  readonly originLabel?: string;
  readonly originValue?: string; // header value → origin marker size
  readonly originTags: Readonly<Record<string, string>>;
  readonly style: 'straight' | 'arc'; // header default leg shape
  readonly legs: readonly MapRouteLeg[];
  readonly lineNumber: number;
}

/** A connector (§24B.6). Endpoints are RAW identifier strings (name or alias);
 *  binding to POIs/regions is the resolver's job. `~>`→arc; `--`→directed:false. */
export interface MapEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly directed: boolean;
  readonly style: 'straight' | 'arc';
  readonly meta: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

export interface ParsedMap {
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly directives: MapDirectives;
  readonly tagGroups: readonly TagGroup[];
  readonly regions: readonly MapRegion[];
  readonly pois: readonly MapPoi[];
  readonly routes: readonly MapRoute[];
  readonly edges: readonly MapEdge[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
