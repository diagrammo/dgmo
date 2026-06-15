/**
 * Compact view state schema (ADR-6).
 * All fields optional. Only non-default values are encoded.
 * `tag: null` means "user chose none"; absent `tag` means "use DSL default" (ADR-5).
 */
interface CompactViewState {
    tag?: string | null;
    cs?: number[];
    cg?: string[];
    swim?: string | null;
    cl?: string[];
    cc?: string[];
    rm?: string;
    htv?: Record<string, string[]>;
    ha?: string[];
    sem?: boolean;
    cm?: boolean;
    c4l?: string;
    c4s?: string;
    c4c?: string;
    rps?: number;
    spd?: number;
    io?: Record<string, number>;
    hd?: boolean;
    cbd?: boolean;
    rq?: string;
    an?: boolean;
    fl?: boolean;
}

type DgmoSeverity = 'error' | 'warning';
interface DgmoError {
    line: number;
    column?: number;
    message: string;
    severity: DgmoSeverity;
    /**
     * Optional stable diagnostic code (e.g. 'E_ARROW_SUBSTRING_IN_LABEL').
     * Additive; pre-existing diagnostics omit this field and existing
     * substring-on-`.message` assertions keep working unchanged.
     */
    code?: string;
}
declare function formatDgmoError(err: DgmoError): string;

/**
 * Parse DGMO content and return diagnostics without rendering.
 * Useful for the CLI and editor to surface all errors before attempting render.
 */
declare function parseDgmo(content: string): {
    diagnostics: DgmoError[];
    chartType: string | null;
};

/**
 * Color definitions for a single mode (light or dark).
 * 10 semantic UI colors + 9 named accent colors = 19 total.
 *
 * `readonly` on every field (and the nested `colors` map) by design —
 * palettes flow from the registry into every renderer; nothing in the
 * pipeline should ever mutate a palette in place.
 */
interface PaletteColors {
    /** Main background (#eceff4 light / #2e3440 dark for Nord) */
    readonly bg: string;
    /** Cards, panels (#e5e9f0 / #3b4252) */
    readonly surface: string;
    /** Popovers, dropdowns (#e5e9f0 / #434c5e) */
    readonly overlay: string;
    /** Borders, dividers, muted (#d8dee9 / #4c566a) */
    readonly border: string;
    /** Primary text (#2e3440 / #eceff4) */
    readonly text: string;
    /** Secondary/diminished text (#4c566a / #d8dee9) */
    readonly textMuted: string;
    /**
     * Light-mode arg for `contrastText()` when text is rendered on a
     * tinted shape fill (e.g. `shapeFill()` output). Must guarantee
     * ≥ 4.5:1 WCAG AA against any `shapeFill()` the palette can produce.
     * Distinct from `colors.white` because palette-aesthetic anchors don't
     * always meet contrast requirements (TD-5).
     */
    readonly textOnFillLight: string;
    /** Dark-mode counterpart to `textOnFillLight`. */
    readonly textOnFillDark: string;
    /** Primary accent — buttons, links */
    readonly primary: string;
    /** Secondary accent */
    readonly secondary: string;
    /** Tertiary accent */
    readonly accent: string;
    /** Error/danger */
    readonly destructive: string;
    /**
     * Used for: inline annotations (red), pie charts, cScale,
     * series rotation, journey actors, Gantt tasks.
     */
    readonly colors: {
        readonly red: string;
        readonly orange: string;
        readonly yellow: string;
        readonly green: string;
        readonly blue: string;
        readonly purple: string;
        readonly teal: string;
        readonly cyan: string;
        readonly gray: string;
        readonly black: string;
        readonly white: string;
    };
}
/**
 * Complete palette definition. One object per color scheme.
 * This is what palette authors create — the single artifact for NFR1.
 *
 * Palettes are immutable from the consumer's perspective; the registry
 * hands out the same frozen-shape object on every `getPalette(id)`.
 */
interface PaletteConfig {
    /** Registry key: 'nord', 'slate', 'catppuccin' */
    readonly id: string;
    /** Display name: 'Nord', 'Slate', 'Catppuccin' */
    readonly name: string;
    /** Light mode color definitions */
    readonly light: PaletteColors;
    /** Dark mode color definitions */
    readonly dark: PaletteColors;
}

/**
 * Theme — render mode flag. Selects which palette variant the renderer uses
 * for background and text:
 *  - 'light'       → palette.light colors
 *  - 'dark'        → palette.dark colors
 *  - 'transparent' → no background fill (for embedding in colored containers)
 */
type Theme = 'light' | 'dark' | 'transparent';
/**
 * `themes` namespace — use with render() options for a typed handle:
 *
 *   await render(text, { theme: themes.dark });
 *
 * Passing the raw string `'dark'` also works (the underlying type is the
 * string-literal union); the namespace is the conventional path.
 */
declare const themes: {
    readonly light: "light";
    readonly dark: "dark";
    readonly transparent: "transparent";
};

/** Get palette by id. Silently returns the default palette if id is unrecognized. */
declare function getPalette(id: string): PaletteConfig;
/**
 * Resolve a palette by id, falling back to the default palette when the id is
 * unregistered. If a `warn` callback is supplied, it is invoked once with a
 * human-readable fallback message on a miss — the single place the "resolve,
 * fall back, warn" policy lives, so each host can surface it its own way
 * (console.warn, Obsidian Notice, MCP response). Silent when the id resolves or
 * when no callback is passed.
 */
declare function resolvePaletteOrFallback(id: string, warn?: (message: string) => void): PaletteConfig;

/**
 * All built-in palettes, keyed by camelCase id. Use directly with render():
 *
 *   await render(text, { palette: palettes.catppuccin });
 *
 * For preference/settings storage, the `.id` field of each entry is the
 * canonical string (e.g. `'tokyo-night'`, `'nord'`) — that's the wire format
 * used by share URLs and the CLI `--palette` flag.
 */
declare const palettes: {
    readonly atlas: PaletteConfig;
    readonly blueprint: PaletteConfig;
    readonly slate: PaletteConfig;
    readonly tidewater: PaletteConfig;
    readonly nord: PaletteConfig;
    readonly catppuccin: PaletteConfig;
    readonly tokyoNight: PaletteConfig;
};

declare function getMinDimensions(content: string): {
    width: number;
    height: number;
};

/**
 * Make an SVG produced by `@diagrammo/dgmo`'s static `render()` suitable for
 * responsive inline embedding in any host (Obsidian, remark/markdown, web
 * pages):
 *
 * - dgmo renders diagrams inside a fixed export canvas (e.g.
 *   `viewBox="0 0 1200 800"`), with content often occupying only a fraction
 *   of it. We compute a tight content bounding box from element coordinates
 *   and set the root `viewBox` to bbox+padding, so the diagram's intrinsic
 *   aspect ratio matches its CONTENT — no dead space above/below or beside it.
 * - Ensure the root `<svg>` has a `viewBox` so it scales responsively.
 * - Strip fixed `width="N"` / `height="N"` so CSS (e.g. `width:100%;
 *   height:auto`, or an aspect-ratio derived from the tight viewBox) controls
 *   sizing.
 * - Remove any inline `background:` from the root style so the page
 *   background shows through.
 *
 * This is intentionally a string transform, not a DOM `getBBox()` step: dgmo
 * can dual-render light/dark SVGs where one is hidden by color-mode CSS, and
 * `getBBox()` returns 0 for the hidden copy. Parsing coordinates from the
 * markup measures both copies reliably and works server-side (Node).
 */
declare function normalizeSvgForEmbed(input: string): string;
/**
 * Parse the content bounding box of a normalized embed SVG, if one can be
 * derived. Returns `null` when no usable coordinates are found (e.g. an empty
 * diagram). Useful for hosts that want to set an explicit `aspect-ratio` from
 * the tight viewBox.
 */
declare function getEmbedSvgViewBox(svg: string): {
    x: number;
    y: number;
    width: number;
    height: number;
} | null;

/** A TopoJSON topology (world-coarse/world-detail keyed by ISO 3166-1 alpha-2;
 *  us-states keyed by ISO 3166-2). Geometry feature `id` is the ISO code;
 *  `properties.name` is the display string. Kept loose to avoid a topojson dep. */
interface BoundaryTopology {
    type: 'Topology';
    objects: Record<string, {
        type: string;
        geometries: BoundaryGeometry[];
    }>;
    arcs: number[][][];
    transform?: {
        scale: [number, number];
        translate: [number, number];
    };
    bbox?: number[];
}
interface BoundaryGeometry {
    type: string;
    /** ISO code: alpha-2 (countries) or 3166-2 `US-XX` (states). */
    id: string;
    properties: {
        name: string;
    };
    arcs?: unknown;
}
/**
 * A gazetteer city entry: `[lat, lon, iso, pop, name, sub?]`.
 * - `lat`/`lon` — rounded to 3 decimals.
 * - `iso` — ISO 3166-1 alpha-2 country code.
 * - `pop` — population.
 * - `name` — canonical display name (case/accents preserved).
 * - `sub` — ISO 3166-2 subdivision (US cities only in v1, e.g. `US-OR`); absent otherwise.
 */
type GazetteerEntry = [
    lat: number,
    lon: number,
    iso: string,
    pop: number,
    name: string,
    sub?: string
];
interface Gazetteer {
    /** Every city, stored once. `byName`/`alt` reference cities by array index
     *  (normalized — no tuple duplication; geonameid is a build-time-only linker). */
    cities: GazetteerEntry[];
    /** Folded (NFD, diacritic-stripped, lowercased) name → indices into `cities`.
     *  Always an array; length > 1 for same-named cities (Portland US-OR / US-ME). */
    byName: Record<string, number[]>;
    /** Folded alias → index into `cities`. Never collides with a `byName` key. */
    alt: Record<string, number>;
}
/**
 * IATA-coded airport index (a SEPARATE optional asset — `airports.json`; ADR-1).
 * Lets memorized airport codes resolve to coordinates through the resolver's
 * existing fold→lookup path (`poi JFK`, `route JFK -> LAX`) — no parser change.
 *
 * - `airports` — `GazetteerEntry` tuples `[lat, lon, iso, 0, name]`. `pop` is
 *   always 0 (OurAirports has no enplanement column); `name` is the full airport
 *   name, used for COMPLETION DISPLAY only — airports resolve by IATA code, never
 *   by name. Coords are rounded to 2 decimals (~1km; sub-pixel at map scale).
 * - `airportIata` — folded 3-letter IATA code → index into `airports`. Consulted
 *   LAST in resolution (after city `byName` + `alt`), so a real city always wins
 *   a shared token (ADR-2). Airports never enter `cities[]`, so the city-scatter
 *   and reverse-geocode layers never see them.
 */
interface AirportData {
    readonly airports: GazetteerEntry[];
    readonly airportIata: Record<string, number>;
}
/** Water-feature class (Natural Earth `featurecla`, rivers/reefs excluded). */
type WaterKind = 'ocean' | 'sea' | 'gulf' | 'bay' | 'strait' | 'channel' | 'sound';
/**
 * A water-body label entry: `[lat, lon, name, tier, kind, alt?]`.
 * - `lat`/`lon` — label anchor (Natural Earth inner point), rounded to 3 decimals.
 * - `name` — full display name (no abbreviation exists for water bodies).
 * - `tier` — Natural Earth `scalerank` (0 = most prominent → orientation priority).
 * - `kind` — feature class (drives styling/priority bucketing).
 * - `alt` — optional extra anchor points `[lat, lon][]`; the layout picks the
 *   one nearest the viewport center (Decision 5 multi-anchor seam). Absent today.
 */
type WaterBodyEntry = [
    lat: number,
    lon: number,
    name: string,
    tier: number,
    kind: WaterKind,
    alt?: ReadonlyArray<readonly [number, number]>
];
interface WaterBodies {
    /** Deterministically ordered (tier, then name). Generated from Natural Earth
     *  marine polys by scripts/build-map-data.mjs into `water-bodies.json`. */
    readonly entries: readonly WaterBodyEntry[];
}
/** A fill-able region (country or US state) — the display name + its ISO id +
 *  layer. Powers region-name autocomplete (completion-only; the renderer derives
 *  names from the topology directly). Extracted from the topologies by
 *  scripts/build-map-data.mjs into `region-names.json`. */
interface RegionName {
    /** Display name (original casing), e.g. `California` / `Germany`. */
    readonly name: string;
    /** ISO 3166-1 alpha-2 (country) or 3166-2 `US-XX` (state). */
    readonly iso: string;
    readonly layer: 'country' | 'us-state';
}
interface RegionNames {
    /** Deterministically ordered (layer, then name). */
    readonly regions: readonly RegionName[];
}

interface MapPlaceCompletion {
    /** Canonical display name (original casing), e.g. `Portland`. */
    readonly name: string;
    /** Text to insert. ISO-qualified (`Portland US-OR`) iff the name is
     *  ambiguous in the gazetteer; bare otherwise (disambiguate-once, §24B.8). */
    readonly insert: string;
    /** Menu label (`Portland — US-OR` when ambiguous, else `Portland`). */
    readonly label: string;
    /** Secondary detail, e.g. `US-OR · 652,503`. */
    readonly detail: string;
    readonly iso: string;
    readonly sub?: string;
    readonly pop: number;
    /** `'airport'` for IATA-code entries (icon/grouping affordance); absent or
     *  `'city'` for gazetteer cities. Cities rank above airports for a shared
     *  prefix so ~1500 codes never bury city names (ADR-5). */
    readonly kind?: 'city' | 'airport';
}
interface MapCompletionOptions {
    /** Max results (default 12). */
    readonly limit?: number;
    /** IATA-coded airports (`airports.json`). When supplied, airport codes
     *  matching the prefix are offered as a second (post-city) group. Optional —
     *  absent (old DI bundles / no asset) just yields city-only completions. */
    readonly airports?: AirportData;
    /** Resolver-inferred map scope (country `US` or subdivision `US-CA`). Biases
     *  airport ranking so in-region airports sort above out-of-region same-prefix
     *  ones (ADR-6). Pure rank, never a filter — cross-region airports still
     *  appear. App passes the document's inferred scope in (Slice 2). */
    readonly scopeISO?: string;
}
/**
 * Prefix-match city names + alternate-name aliases against the gazetteer,
 * rank by population (desc; stable tie-break by gazetteer index), and emit
 * ISO-qualified insert text only for ambiguous (same-named) places.
 *
 * Pure + deterministic. Empty/blank query → `[]` (the caller gates min length).
 */
declare function completeMapPlaces(query: string, gazetteer: Gazetteer, opts?: MapCompletionOptions): MapPlaceCompletion[];
interface MapRegionCompletion {
    /** Display name = insert text (the resolver disambiguates cross-layer
     *  collisions like Georgia by map scope, §24B.8). */
    readonly name: string;
    /** ISO 3166-1/3166-2 id. */
    readonly iso: string;
    readonly layer: 'country' | 'us-state';
    /** Secondary detail, e.g. `US state · US-CA` or `Country · DE`. */
    readonly detail: string;
}
/**
 * Prefix-match fill-able region names (countries + US states) for region-fill
 * lines. Matches the folded display name OR the ISO code; deterministic
 * (alphabetical by name, then layer). Pure. Empty query → `[]`.
 *
 * `regions` is injected (the `region-names.json` asset, shipped in dist/map-data
 * alongside the gazetteer). Cross-layer same-name (Georgia: country GE + state
 * US-GA) yields both entries, distinguished by `detail`.
 */
declare function completeMapRegions(query: string, regions: readonly RegionName[], opts?: MapCompletionOptions): MapRegionCompletion[];

interface ChartTypeMeta {
    readonly id: string;
    readonly description: string;
    readonly fallback?: true;
}
declare const chartTypes: readonly ChartTypeMeta[];

/** The four static assets, injected into the pure resolver (DI). */
interface MapData {
    worldCoarse: BoundaryTopology;
    worldDetail: BoundaryTopology;
    usStates: BoundaryTopology;
    /** Major lakes (Natural Earth 110m) drawn as water over land — e.g. the Great
     *  Lakes. Optional so hand-built test fixtures need not supply it. */
    lakes?: BoundaryTopology;
    /** Major river centerlines (Natural Earth 110m) drawn as thin water lines over
     *  land — e.g. the Amazon, Nile, Mississippi. Optional, like `lakes`. */
    rivers?: BoundaryTopology;
    /** Notable mountain-range polygons (Natural Earth 50m geography regions) drawn
     *  as a subtle gradient relief cue over base land when the `relief` directive
     *  is on — e.g. the Rockies, Andes, Himalayas. Optional, like `lakes`. */
    mountainRanges?: BoundaryTopology;
    /** North-America-clipped 10m country land, used as crisp neighbour context
     *  under the albers-usa US view so Canada/Mexico match the 10m states instead
     *  of the coarser world tiers. Optional, like `lakes`. */
    naLand?: BoundaryTopology;
    /** North-America-clipped 10m major lakes (Great Lakes etc.), used in place of
     *  the coarse `lakes` under the albers-usa US view. Optional. */
    naLakes?: BoundaryTopology;
    /** Water-body orientation labels (Natural Earth marine polys) drawn when the
     *  `context-labels` directive is on — oceans/seas/gulfs/bays/etc. Optional, so
     *  hand-built test fixtures and older bundles need not supply it. */
    waterBodies?: WaterBodies;
    /** IATA-coded airports (`airports.json`) — lets `poi JFK` / `route JFK -> LAX`
     *  resolve. Optional so hand-built fixtures and older DI bundles need not supply
     *  it; the resolver guards `data.airports?.…` everywhere. */
    airports?: AirportData;
    gazetteer: Gazetteer;
}

interface RenderOptions {
    theme?: Theme;
    palette?: PaletteConfig;
    /**
     * How to handle parse errors:
     *   'svg'    — render an inline error SVG (default)
     *   'silent' — return empty svg + diagnostics; caller handles UI
     *   'throw'  — throw an Error with the diagnostics
     */
    onError?: 'svg' | 'silent' | 'throw';
    /**
     * Pre-applied interactive view state — collapsed sections/columns,
     * active swimlane tag-group, etc. Used to render a specific view
     * non-interactively (server-side render, share-link decode).
     */
    viewState?: CompactViewState;
}
interface RenderResult {
    svg: string;
    diagnostics: DgmoError[];
}
/**
 * Render DGMO source to an SVG string.
 *
 * @example
 * ```ts
 * import { render, palettes, themes } from '@diagrammo/dgmo';
 *
 * const { svg } = await render(text, {
 *   palette: palettes.catppuccin,
 *   theme: themes.dark,
 * });
 * document.getElementById('chart').innerHTML = svg;
 * ```
 */
declare function render(text: string, options?: RenderOptions): Promise<RenderResult>;

interface EncodeDiagramUrlOptions {
    baseUrl?: string;
    palette?: PaletteConfig;
    theme?: Theme;
    filename?: string;
    /**
     * Initial view state to embed in the URL — re-applied when the link is
     * decoded so recipients open the diagram in the same configuration.
     */
    viewState?: CompactViewState;
}
/**
 * Encode DGMO text into a shareable URL. Returns null if the compressed
 * payload exceeds the 8 KB URL limit.
 */
declare function encodeDiagramUrl(text: string, options?: EncodeDiagramUrlOptions): string | null;
interface DecodedDiagramUrl {
    text: string;
    palette?: PaletteConfig;
    theme?: Theme;
    filename?: string;
}
/**
 * Decode a share URL back into DGMO text plus optional palette/theme/filename.
 * Returns null if the URL contains no valid DGMO payload.
 */
declare function decodeDiagramUrl(url: string): DecodedDiagramUrl | null;

export { type ChartTypeMeta, type CompactViewState, type DecodedDiagramUrl, type DgmoError, type DgmoSeverity, type EncodeDiagramUrlOptions, type Gazetteer, type GazetteerEntry, type MapCompletionOptions, type MapData, type MapPlaceCompletion, type MapRegionCompletion, type PaletteColors, type PaletteConfig, type RegionName, type RegionNames, type RenderOptions, type RenderResult, type Theme, chartTypes, completeMapPlaces, completeMapRegions, decodeDiagramUrl, encodeDiagramUrl, formatDgmoError, getEmbedSvgViewBox, getMinDimensions, getPalette, normalizeSvgForEmbed, palettes, render, resolvePaletteOrFallback, themes, parseDgmo as validate };
