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
  /** Recognized color NAME for the choropleth ramp HIGH endpoint, peeled off the
   *  `region-metric` trailing token (§24B.3). Defaults to red when absent. */
  regionMetricColor?: string;
  /** Recognized color NAME for the choropleth ramp LOW endpoint (the second,
   *  left-of-two trailing colors on `region-metric`, §24B.3). Absent ⇒ the low
   *  end is the implied floored neutral (today's single-colour behaviour). */
  regionMetricLowColor?: string;
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
  /** `no-title` — suppress the title banner (the subtitle/caption, if any, still
   *  render). Mirrors the `no-title` directive across the other chart types. */
  noTitle?: boolean;
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
  /** `no-region-value` — suppress the metric VALUE shown under each data region's
   *  name on a `region-metric` choropleth (default-on). The region NAME still
   *  renders (governed by `no-region-labels`); only the numeric value line goes. */
  noRegionValue?: boolean;
  /** `no-poi-labels` — suppress POI labels (default-on, collision-managed auto). */
  noPoiLabels?: boolean;
  /** `no-colorize` — force the plain green-land reference dress even when regions
   *  are referenced (regions are auto-coloured by default; §24B colorize). A
   *  no-op under data — the basemap is already gray there. */
  noColorize?: boolean;
  /** `no-cities` — suppress the subtle gazetteer city dots scattered across the
   *  basemap for geographic orientation (default-on; population-ranked, spacing-
   *  thinned so density adapts to zoom). Explicit POIs always draw regardless. */
  noCities?: boolean;
  /** `no-cluster-pois` — never collapse coincident POI markers into a count badge
   *  (clustering/spiderfy is default-on in the interactive preview). With this set
   *  the markers always render fanned out with their legs — the same as a static
   *  export — so a dense map reads the same on screen as on paper. No-op for
   *  export (already always expanded). */
  noClusterPois?: boolean;
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
 *  the indented edge arrow idiom (same as sitemap) — in-arrow text = leg label,
 *  `value:` = leg thickness, the arrow glyph = shape (`-…->` straight, `~…~>`
 *  arc). A tag on the leg line colours the LINE (§24B.6); `label:`/`as` still
 *  name the DESTINATION stop. The arrow is required — a bare destination errors. */
export interface MapRouteLeg {
  readonly label?: string; // in-arrow leg label
  readonly style: 'straight' | 'arc'; // from the leg's own arrow glyph
  readonly value?: string; // leg thickness (numeric string, like an edge)
  readonly dest: PoiPos;
  readonly destAlias?: string;
  readonly destLabel?: string;
  /** Tag(s) on the leg line → colour the LINE itself. To categorise a STOP,
   *  tag its own `poi` line. */
  readonly tags: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

/** An ordered, auto-numbered route (§24B.6): `route <origin>` + a sequence of
 *  indented arrow legs, each continuing from the previous stop. Leg shape is
 *  per-leg (the arrow glyph) — there is no header-level shape option. Repeat the
 *  origin as a leg's destination to close a loop. */
export interface MapRoute {
  readonly origin: PoiPos;
  readonly originAlias?: string;
  readonly originLabel?: string;
  readonly originValue?: string; // header value → origin marker size
  readonly originTags: Readonly<Record<string, string>>;
  readonly legs: readonly MapRouteLeg[];
  readonly lineNumber: number;
}

/** A connector (§24B.6). Endpoints are RAW identifier strings (name or alias);
 *  binding to POIs/regions is the resolver's job. Token = arrowhead iff it ends
 *  in `>`, arc iff it starts with `~`: `->` straight, `~>` arc, `--`/`-label-`
 *  undirected straight, `~~`/`~label~` undirected arc. */
export interface MapEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly directed: boolean;
  readonly style: 'straight' | 'arc';
  readonly meta: Readonly<Record<string, string>>;
  /** Tag(s) on the edge line → colour the LINE itself (§24B.6). */
  readonly tags: Readonly<Record<string, string>>;
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

/** Legend descriptor for a rendered map (a layout-stage output, re-exported from
 *  `layout.ts`). It lives here so the `legend-band` helper can consume it without
 *  importing `layout` — `layout` already value-imports `mapLegendBand`, so the
 *  reverse type import would form a layout↔legend-band cycle. */
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
    /** Resolved hex of the LOW (t=0) endpoint — the explicit low colour, or the
     *  floored neutral the single-colour fills blend up from. */
    low: string;
    /** Resolved hex of the HIGH (t=1) endpoint (the named ramp hue). */
    high: string;
  };
}
