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

/** One-shot directives (§24B.2/.7). Values are raw strings unless typed.
 *
 *  COSMETIC DEFAULTS ARE ON. Every basemap feature renders by default; the only
 *  control is a bare `no-*` opt-out flag that sets the matching `noXxx` boolean.
 *  Absent (undefined) = feature ON — so render gates test `!== true`, never
 *  `=== true`. There are NO positive opt-in cosmetic flags (§24B.2). */
export interface MapDirectives {
  /** Legend label for the region value ramp (`region-metric <label>`). */
  regionMetric?: string;
  /** Recognized color NAME for the choropleth ramp hue, peeled off the
   *  `region-metric` trailing token (§24B.3). Defaults to red when absent. */
  regionMetricColor?: string;
  /** Legend label for the POI value (marker size) channel (`poi-metric`). */
  poiMetric?: string;
  /** Legend label for the edge/leg value (thickness) channel (`flow-metric`). */
  flowMetric?: string;
  /** Default ISO scope for bare-name resolution (§24B.8): a 3166-1 country
   *  (`locale US`) or 3166-2 subdivision (`locale US-GA`). The country part
   *  biases ambiguous bare cities to that nation; the subdivision part further
   *  prefers that state. Inferred from content; explicit only to steer a guess. */
  locale?: string;
  activeTag?: string;
  caption?: string;
  /** `no-legend` — suppress the legend (default-on). */
  noLegend?: boolean;
  /** `no-coastline` — suppress the faint nautical-chart water-lines along
   *  coasts/shorelines (default-on; geometry derived from drawn region paths). */
  noCoastline?: boolean;
  /** `no-relief` — suppress mountain-range relief hachures. Relief is default-on
   *  but auto-gated to dataless reference maps at continent/world zoom (§24B.2). */
  noRelief?: boolean;
  /** `no-context-labels` — suppress the orientation backdrop (water-body names +
   *  unreferenced notable country names), distinct from `region-labels`. */
  noContextLabels?: boolean;
  /** `no-region-labels` — suppress region labels (default-on, full→abbrev→hide). */
  noRegionLabels?: boolean;
  /** `no-poi-labels` — suppress POI labels (default-on, collision-managed auto). */
  noPoiLabels?: boolean;
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
  /** §1.5 trailing-token color NAME → flat categorical override fill (§24B.4);
   *  painted regardless of the active colouring dimension, no legend entry. */
  readonly color?: string;
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
  /** §1.5 trailing-token color NAME → flat marker fill (§24B.5); wins over a
   *  tag color and the default orange. */
  readonly color?: string;
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
