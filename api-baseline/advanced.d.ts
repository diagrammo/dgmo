import { D as DgmoError, P as PaletteConfig, T as TagGroup, a as PaletteColors, C as CompactViewState, g as TagEntry } from './tag-groups-BoJg3lFV.js';
export { h as DecodedDiagramUrl, c as DgmoSeverity, i as EncodeDiagramUrlOptions, j as EncodeDiagramUrlResult, k as autoTagColorCycle, l as decodeDiagramUrl, m as decodeViewState, n as encodeDiagramUrl, o as encodeViewState, f as formatDgmoError, p as makeDgmoError, r as resolveActiveTagGroup, q as resolveTagColor, t as tagAttrKey } from './tag-groups-BoJg3lFV.js';
import { M as MapDataSource, P as ParsedMap, b as MapData, d as ResolvedMap, e as MapLayoutLegend, f as GeoExtent } from './d3-CQT5bwpb.js';
export { A as AirportData, B as BoundaryTopology, G as Gazetteer, a as GazetteerEntry, g as MapDirectives, h as MapEdge, i as MapPoi, j as MapRegion, k as MapRoute, l as PoiPos, m as ProjectionFamily, R as RegionName, c as RegionNames, n as ResolvedEdge, o as ResolvedPoi, p as ResolvedRegion, q as ResolvedRoute, r as renderForExport } from './d3-CQT5bwpb.js';
export { b as CHART_TYPE_DESCRIPTIONS, C as ChartTypeId, a as ChartTypeMeta, R as RenderCategory, d as chartTypeParsers, c as chartTypes, e as getAllChartTypes, f as getAvailablePalettes, g as getPalette, h as getRenderCategory, i as isExtendedChartType, j as isValidHex, k as knownChartTypeIds, p as parseDgmo, l as parseDgmoChartType, m as registerPalette, p as validate } from './dgmo-router-C9CsswPZ.js';
import { Selection } from 'd3-selection';
import * as d3Scale from 'd3-scale';
import { P as ParsedOrg, F as FillMode, R as RaciMarker, a as ParsedRaci, b as RaciVariant, c as RaciTask } from './chart-meta-BKN2ORkc.js';
export { A as ALL_CHART_TYPES, I as ImportSource, O as OrgNode, d as RaciPhase, e as RaciRoleAssignment, f as ReadFileFn, g as ResolveImportsResult, h as contrastText, i as findOrgNodeIdByName, j as getSeriesColors, k as hexToHSL, l as hexToHSLString, m as hslToHex, n as mix, o as normalizePertSourceForShare, p as parseFirstLine, q as parseOrg, r as parseRaci, s as resolveOrgImports, t as shade, u as shapeFill, v as tint } from './chart-meta-BKN2ORkc.js';
import { GeoProjection } from 'd3-geo';
export { M as MapCompletionOptions, a as MapLocationMatch, b as MapPlaceCompletion, c as MapRegionCompletion, T as Theme, d as completeMapPlaces, e as completeMapRegions, p as palettes, s as searchMapLocations, t as themes } from './themes-CXYnNA4e.js';

/**
 * Stable diagnostic codes for in-arrow label parsing errors.
 *
 * **Active codes** — emitted by the parser pipeline today:
 *   - `ARROW_SUBSTRING_IN_LABEL` (TD-13)
 *   - `CONTROL_CHAR_IN_LABEL` (TD-14)
 *
 * See `docs/dgmo-language-spec-decisions.md` → TD-16 for the rationale.
 */
declare const ARROW_DIAGNOSTIC_CODES: {
    /** Active: label contains `->` or `~>` substring (TD-13). */
    readonly ARROW_SUBSTRING_IN_LABEL: "E_ARROW_SUBSTRING_IN_LABEL";
    /** Active: label contains a forbidden control character (TD-14). */
    readonly CONTROL_CHAR_IN_LABEL: "E_CONTROL_CHAR_IN_LABEL";
};
/**
 * Validate an in-arrow label against the TD-13 and TD-14 character-set
 * contract. Returns diagnostics (possibly empty). Does NOT mutate the label —
 * callers that want a normalized label should trim before calling.
 *
 * TD-13: label must not contain the substrings "->" or "~>".
 * TD-14: label must not contain C0 control chars other than tab, and no DEL.
 */
declare function validateLabelCharacters(label: string, lineNumber: number): DgmoError[];
interface ParseInArrowLabelResult {
    /** Cleaned label (trimmed; `undefined` if empty after trim per TD-10). */
    label: string | undefined;
    diagnostics: DgmoError[];
}
/**
 * Normalize and validate a raw in-arrow label.
 *
 * Behavior:
 *   - Trims leading/trailing whitespace (TD-8: internal whitespace preserved).
 *   - Empty-after-trim → `{ label: undefined }` (TD-10 normalization).
 *   - TD-13: emits `E_ARROW_SUBSTRING_IN_LABEL` if `->` or `~>` is present.
 *   - TD-14: emits `E_CONTROL_CHAR_IN_LABEL` for forbidden control chars.
 *
 * This helper is intentionally chart-agnostic: it operates on an already
 * extracted label string, leaving each chart's existing arrow-finding
 * tokenization in place. Edges no longer have a color slot on any chart
 * type (see spec §1.7 "Edge color is not a feature"); arrow content is
 * pure label text.
 */
declare function parseInArrowLabel(rawLabel: string, lineNumber: number): ParseInArrowLabelResult;

/**
 * Tag a primitive type `T` with a phantom brand `B`. The brand
 * exists only in the type system — `Brand<string, 'X'>` is a `string`
 * at runtime, but TypeScript treats it as nominally distinct from
 * plain `string` and from any other `Brand<string, ...>`.
 */
type Brand<T, B extends string> = T & {
    readonly __brand: B;
};

declare const atlasPalette: PaletteConfig;

declare const blueprintPalette: PaletteConfig;

declare const catppuccinPalette: PaletteConfig;

declare const nordPalette: PaletteConfig;

declare const slatePalette: PaletteConfig;

declare const tidewaterPalette: PaletteConfig;

declare const tokyoNightPalette: PaletteConfig;

type TimelineSort = 'time' | 'group' | 'tag';
interface TimelineEvent {
    date: string;
    endDate: string | null;
    label: string;
    group: string | null;
    metadata: Record<string, string>;
    lineNumber: number;
    uncertain?: boolean;
}
interface TimelineGroup {
    name: string;
    color: string | null;
    metadata: Record<string, string>;
    lineNumber: number;
}
interface TimelineEra {
    startDate: string;
    endDate: string;
    label: string;
    color: string | null;
    lineNumber: number;
}
interface TimelineMarker {
    date: string;
    label: string;
    color: string | null;
    lineNumber: number;
}

interface D3ExportDimensions {
    width?: number;
    height?: number;
    /** Map-only: when true, the map renderer suppresses its global stretch-fill and
     *  contain-fits (letterbox) instead. Set by `mapExportDimensions` when the export
     *  canvas was clamped/floored away from the map's content aspect, so the
     *  off-aspect canvas doesn't re-distort. Ignored by all non-map renderers. */
    preferContain?: boolean;
}

type VisualizationType = 'slope' | 'wordcloud' | 'arc' | 'timeline' | 'venn' | 'quadrant' | 'sequence' | 'tech-radar' | 'cycle' | 'pyramid' | 'ring';
interface D3DataItem {
    label: string;
    values: number[];
    color: string | null;
    lineNumber: number;
}
interface WordCloudWord {
    text: string;
    weight: number;
    lineNumber: number;
}
type WordCloudRotate = 'none' | 'mixed' | 'angled';
interface WordCloudOptions {
    rotate: WordCloudRotate;
    max: number;
    minSize: number;
    maxSize: number;
}
interface ArcLink {
    source: string;
    target: string;
    value: number;
    color: string | null;
    lineNumber: number;
}
type ArcOrder = 'appearance' | 'name' | 'group' | 'degree';
interface ArcNodeGroup {
    name: string;
    nodes: string[];
    color: string | null;
    lineNumber: number;
}
interface VennSet {
    name: string;
    alias: string | null;
    color: string | null;
    lineNumber: number;
}
interface VennOverlap {
    sets: string[];
    label: string | null;
    lineNumber: number;
}
interface QuadrantLabel {
    text: string;
    color: string | null;
    lineNumber: number;
}
interface QuadrantPoint {
    label: string;
    x: number;
    y: number;
    lineNumber: number;
}
interface QuadrantLabels {
    topRight: QuadrantLabel | null;
    topLeft: QuadrantLabel | null;
    bottomLeft: QuadrantLabel | null;
    bottomRight: QuadrantLabel | null;
}
/** Fields every visualization shares. */
interface ParsedVizBase {
    title: string | null;
    titleLineNumber: number | null;
    /** When true, the renderer suppresses the chart title. */
    noTitle?: boolean;
    /**
     * §1.9 fill family — `'solid'` renders filled marks at full intent
     * saturation, `'outline'` drops the fill to the theme background (color on
     * the stroke). Honored by renderers with a fillable surface (e.g. venn set
     * circles); a no-op for line/point types. Absent ⇒ canonical muted tint.
     */
    fillMode?: 'solid' | 'outline';
    diagnostics: DgmoError[];
    error: string | null;
}
interface ParsedSlope extends ParsedVizBase {
    type: 'slope';
    periods: string[];
    data: D3DataItem[];
    noName?: boolean;
    noValue?: boolean;
    noPercent?: boolean;
}
interface ParsedArc extends ParsedVizBase {
    type: 'arc';
    orientation: 'horizontal' | 'vertical';
    links: ArcLink[];
    arcOrder: ArcOrder;
    arcNodeGroups: ArcNodeGroup[];
    noName?: boolean;
    noValue?: boolean;
    noPercent?: boolean;
    /** `layout arc|chord` override (#26). `chord` re-renders the same edges as a
     *  circular chord; absent ⇒ the `arc` linear preset. */
    layout?: 'arc' | 'chord';
}
interface ParsedTimeline extends ParsedVizBase {
    type: 'timeline';
    orientation: 'horizontal' | 'vertical';
    timelineEvents: TimelineEvent[];
    timelineGroups: TimelineGroup[];
    timelineEras: TimelineEra[];
    timelineMarkers: TimelineMarker[];
    timelineTagGroups: TagGroup[];
    timelineSort: TimelineSort | null;
    timelineDefaultSwimlaneTG?: string;
    timelineScale: boolean;
    timelineSwimlanes: boolean;
    /** Authored `active-tag <group|none|metric>` directive (§15.6); resolved at render. */
    timelineActiveTag?: string;
    /** §1.9 fill family (`'solid'` | `'outline'`); absent ⇒ 25% tint. */
    fillMode?: 'solid' | 'outline';
    /** When true, the renderer suppresses the tag legend and the vertical band
     *  it would occupy (#48). */
    noLegend?: boolean;
}
interface ParsedWordcloud extends ParsedVizBase {
    type: 'wordcloud';
    words: WordCloudWord[];
    cloudOptions: WordCloudOptions;
}
interface ParsedVenn extends ParsedVizBase {
    type: 'venn';
    vennSets: VennSet[];
    vennOverlaps: VennOverlap[];
    noName?: boolean;
    noValue?: boolean;
    noPercent?: boolean;
}
interface ParsedQuadrant extends ParsedVizBase {
    type: 'quadrant';
    quadrantLabels: QuadrantLabels;
    quadrantPoints: QuadrantPoint[];
    quadrantXAxis: [string, string] | null;
    quadrantXAxisLineNumber: number | null;
    quadrantYAxis: [string, string] | null;
    quadrantYAxisLineNumber: number | null;
    quadrantTitleLineNumber: number | null;
}
/**
 * `sequence` (rendered by its own parser) or an unsupported/empty parse result
 * (`type: null`). Carries only the base fields — callers branch on `error`.
 */
interface ParsedVizEmpty extends ParsedVizBase {
    type: 'sequence' | null;
}
/** What `parseVisualization` returns: discriminated on `type`. */
type ParsedVisualization = ParsedSlope | ParsedArc | ParsedTimeline | ParsedWordcloud | ParsedVenn | ParsedQuadrant | ParsedVizEmpty;

/**
 * Parses D3 chart text format into structured data. Returns the discriminated
 * {@link ParsedVisualization} union; internally the single state machine fills a
 * fat {@link ParsedVizFull} accumulator, which is a structural superset of every
 * variant, so the narrowing is sound and runtime-identical.
 */
declare function parseVisualization(content: string, palette?: PaletteColors): ParsedVisualization;

type TimelineDurationUnit = 'd' | 'w' | 'm' | 'y' | 'h' | 'min' | 's';
declare function addDurationToDate(startDate: string, amount: number, unit: TimelineDurationUnit): string;
declare function parseTimelineDate(s: string): number;

/**
 * Renders a slope chart into the given container using D3.
 */
declare function renderSlopeChart(container: HTMLDivElement, parsed: ParsedSlope, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;

declare function orderArcNodes(links: ArcLink[], order: ArcOrder, groups: ArcNodeGroup[]): string[];
/**
 * Renders an arc diagram into the given container using D3.
 */
declare function renderArcDiagram(container: HTMLDivElement, parsed: ParsedArc, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;

/**
 * Converts a DSL date string to a human-readable label.
 *   '1718'                 → '1718'
 *   '1718-05'              → 'May 1718'
 *   '1718-05-22'           → 'May 22, 1718'
 *   '2024-06-15 14:30'     → 'Jun 15, 2024 14:30'
 *   '2024-06-15 14:30:45'  → 'Jun 15, 2024 14:30:45'
 *   '-753'                 → '753 BCE'  (BCE years stored signed)
 *   '-0044-03'             → 'Mar 44 BCE'
 */
declare function formatDateLabel(dateStr: string): string;
declare function renderTimeline(container: HTMLDivElement, parsed: ParsedTimeline, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions, activeTagGroup?: string | null, swimlaneTagGroup?: string | null, onTagStateChange?: (activeTagGroup: string | null, swimlaneTagGroup: string | null) => void, viewMode?: boolean, exportMode?: boolean): void;

/**
 * Renders a word cloud into the given container using d3-cloud.
 */
declare function renderWordCloud(container: HTMLDivElement, parsed: ParsedWordcloud, palette: PaletteColors, _isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;

declare function renderVenn(container: HTMLDivElement, parsed: ParsedVenn, palette: PaletteColors, _isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;

/**
 * Renders a quadrant chart using D3.
 * Displays 4 colored quadrant regions, axis labels, quadrant labels, and data points.
 */
declare function renderQuadrant(container: HTMLDivElement, parsed: ParsedQuadrant, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;

/**
 * Render DGMO source to an SVG string.
 *
 * Automatically detects the chart type, selects the appropriate renderer,
 * and returns a complete SVG document string.
 *
 * @param content - DGMO source text
 * @param options - Optional theme and palette settings
 * @returns Object with `svg` (SVG string, empty on error) and `diagnostics` (parse errors/warnings)
 *
 * @example
 * ```ts
 * import { render } from '@diagrammo/dgmo';
 *
 * const { svg, diagnostics } = await render(`pie Languages
 * TypeScript: 45
 * Python: 30
 * Rust: 25`);
 * ```
 */
declare function render(content: string, options?: {
    theme?: 'light' | 'dark' | 'transparent';
    palette?: string;
    c4Level?: 'context' | 'containers' | 'components' | 'deployment';
    c4System?: string;
    c4Container?: string;
    tagGroup?: string;
    /** Legend state for export — controls which tag group is shown in exported SVG. */
    legendState?: {
        activeGroup?: string;
        hiddenAttributes?: string[];
    };
    /** View state for export — controls interactive state (collapse, swimlanes, etc.) */
    viewState?: CompactViewState;
    /**
     * Basemap assets for `map` charts — the data itself, or a loader returning
     * it. `render()` reads nothing from the filesystem or the network on its
     * own, so this is the only way a map obtains a basemap, and its presence
     * here is what tells a caller whether a render can touch the environment.
     *
     * - Node / CLI / SSR: pass the `loadMapData` loader from
     *   `@diagrammo/dgmo/advanced`. It is called only when the content really
     *   is a map, so a non-map render never pays for it.
     * - Browser / Worker / Obsidian: pass your bundled `MapData`.
     *
     * Omit it and a map renders empty with an `E_MAP_DATA_NOT_SUPPLIED`
     * diagnostic. Every other chart type ignores this option.
     */
    mapData?: MapDataSource;
    /** Bake pure-CSS hover into the exported SVG (no JS). Default ON — embeds
     *  (Obsidian, doc-site wrappers) get hover feedback for free. The desktop
     *  app renders its live preview through direct renderer calls (not this
     *  entry), so it keeps its JS emphasis; pass `false` to opt out. */
    bakeHover?: boolean;
    /**
     * Canvas to draw onto, in px. Defaults to the 1200x800 export sheet.
     *
     * Fitting that sheet to a narrow column inherits its ASPECT, which is how a
     * one-line goal meter ends up taller than the card holding it. A caller
     * that knows the shape it wants passes it here.
     */
    width?: number;
    height?: number;
}): Promise<{
    svg: string;
    diagnostics: DgmoError[];
    /** Detected chart type (e.g. `map`, `clock`), or undefined when inference
     *  failed. Embed callers use it to pick the default embed background. */
    chartType: string | undefined;
}>;

type ChartType$1 = 'bar' | 'line' | 'pie' | 'polar-area' | 'radar';
interface ChartDataPoint {
    label: string;
    value: number;
    extraValues?: number[];
    color?: string;
    lineNumber: number;
}
interface ChartEra {
    start: string;
    end: string;
    label: string;
    color: string | null;
    lineNumber: number;
}

interface ParsedChart {
    type: ChartType$1;
    title?: string;
    titleLineNumber?: number;
    series?: string;
    seriesLineNumber?: number;
    xlabel?: string;
    xlabelLineNumber?: number;
    ylabel?: string;
    ylabelLineNumber?: number;
    /** Right (secondary) y-axis label — set by a `y-right-label` option or a
     *  grouped-series axis header (§15.1 dual-axis line charts). */
    yrlabel?: string;
    yrlabelLineNumber?: number;
    seriesNames?: string[];
    seriesNameLineNumbers?: number[];
    seriesNameColors?: (string | undefined)[];
    /** Per-series axis assignment, parallel to seriesNames. Present only when the
     *  series block uses the grouped (dual-axis) form; absent ⇒ all left. */
    seriesAxes?: ('left' | 'right')[];
    /** Bar multi-series layout, set by a `stack` or `group` block header
     *  (consolidation #24). Absent ⇒ single-series bar. Drives stacked vs
     *  clustered rendering in `charts-d3/bar.ts`. */
    barLayout?: 'stack' | 'group';
    /** Pie hole inner-radius ratio (0–0.9), set by a `hole` directive
     *  (bare ⇒ default). Absent ⇒ solid pie. (#23) */
    hole?: number;
    /** Suppress the pie center total (bare `no-center-total`). The total
     *  shows by default whenever a hole is present. (#23) */
    noCenterTotal?: boolean;
    /** Render a line chart filled, i.e. as an area (bare `fill`). (#25) */
    fill?: boolean;
    orientation?: 'horizontal' | 'vertical';
    color?: string;
    label?: string;
    noName?: boolean;
    noValue?: boolean;
    noPercent?: boolean;
    /** §1.9 fill family: `'solid'` = full intent saturation, `'outline'` =
     *  theme-background fill with color on the stroke. Absent ⇒ 25% tint. */
    fillMode?: 'solid' | 'outline';
    /** Cross-chart-type: when true, the renderer suppresses the chart title. */
    noTitle?: boolean;
    /** Cross-chart-type: when true, the renderer suppresses the legend and the
     *  vertical band it would occupy (#48). */
    noLegend?: boolean;
    /** §1.9 `legend-inline`: render the title and the series legend on one line
     *  (title left, legend right) instead of stacking the legend below a centered
     *  title — reclaims a header row. Honoured by the top-center-legend data
     *  charts (bar/line/radar/scatter/function); a no-op elsewhere. Auto-falls
     *  back to the stacked header when the legend can't fit beside the title on a
     *  single row (decision #50). */
    legendInline?: boolean;
    /** Line only: opt out of the data-driven y-axis auto-fit and anchor the
     *  baseline at 0 (magnitude honesty / old ECharts-parity behavior). By
     *  default a line chart fits a padded data-min→max window (§15.1). */
    noAutoY?: boolean;
    data: ChartDataPoint[];
    eras?: ChartEra[];
    diagnostics: DgmoError[];
    error: string | null;
}

/**
 * Parses the simple chart text format into a structured object.
 *
 * Format (colon-free):
 * ```
 * bar My Chart
 * series Revenue
 *
 * Jan 120
 * Feb 200
 * Mar 150
 * ```
 */
declare function parseChart(content: string, palette?: PaletteColors): ParsedChart;
/**
 * Parse a data row line: everything before the last numeric token(s) is the label,
 * numeric tokens at the end are the values. Values are space-separated.
 *
 * Examples:
 *   "Jan 120"             → { label: "Jan", values: [120] }
 *   "North America 250"   → { label: "North America", values: [250] }
 *   "Q1 10 20 30"         → { label: "Q1", values: [10, 20, 30] }
 *   "Revenue 1_000"       → { label: "Revenue", values: [1000] }
 *   '"Wi-Fi 6" 70 80'     → { label: "Wi-Fi 6", values: [70, 80], quotedLabel: true }
 *
 * A fully-quoted leading label is taken verbatim (quotes stripped) and is never
 * eligible for value peeling — the escape hatch for labels that end in a digit
 * (`"Wi-Fi 6"`, `"Layer 3"`), mirroring the treemap leaf rule.
 *
 * `trailingNumericCount` reports how many consecutive numeric tokens the row
 * actually ends with, which may exceed `values.length` when `expectedValues`
 * caps the walk. Callers use it to flag an over-long row instead of silently
 * absorbing the surplus numbers into the label.
 *
 * Returns null if the line has no numeric value at the end.
 */
declare function parseDataRowValues(line: string, options?: {
    multiValue?: boolean;
    expectedValues?: number;
}): {
    label: string;
    values: number[];
    /** Label prefix with every trailing numeric token removed (diagnostics use
     *  this so the message names "Armor", not the corrupted "Armor 50 60"). */
    bareLabel: string;
    trailingNumericCount: number;
    quotedLabel: boolean;
} | null;

interface LegendState {
    activeGroup: string | null;
    hiddenAttributes?: Set<string>;
    controlsExpanded?: boolean;
}
interface LegendCallbacks {
    onGroupToggle?: (groupName: string) => void;
    onVisibilityToggle?: (attribute: string) => void;
    onStateChange?: (newState: LegendState) => void;
    /** Called when an entry is hovered. Chart renderers can use this for cross-element highlighting. */
    onEntryHover?: (groupName: string, entryValue: string | null) => void;
    /** Called after each group <g> is rendered — lets chart renderers inject custom elements (swimlane icons, etc.) */
    onGroupRendered?: (groupName: string, groupEl: D3Sel, isActive: boolean) => void;
    /** Called when the controls group gear pill is clicked (expand/collapse) */
    onControlsExpand?: () => void;
    /** Called when a controls group toggle entry is clicked */
    onControlsToggle?: (toggleId: string, active: boolean) => void;
}
interface LegendPosition {
    placement: 'top-center';
    titleRelation: 'below-title' | 'inline-with-title';
}
type LegendMode = 'preview' | 'export';
type LegendControlExportBehavior = 'include' | 'strip' | 'static';
interface LegendControl {
    id: string;
    /** SVG markup for the control icon, or a string label */
    icon: string;
    label?: string;
    exportBehavior: LegendControlExportBehavior;
    onClick?: () => void;
    children?: LegendControlEntry[];
}
interface LegendControlEntry {
    id: string;
    label: string;
    isActive?: boolean;
    onClick?: () => void;
}
interface ControlsGroupToggle {
    id: string;
    /** Only 'toggle' is implemented in v1. 'select' and 'action' future-proof for Infra playback etc. */
    type: 'toggle' | 'select' | 'action';
    label: string;
    active: boolean;
    onToggle: (active: boolean) => void;
}
interface ControlsGroupConfig {
    toggles: ControlsGroupToggle[];
}
interface LegendGroupData {
    readonly name: string;
    readonly entries: ReadonlyArray<{
        readonly value: string;
        readonly color: string;
    }>;
    /** Continuous (choropleth) groups carry a gradient ramp instead of discrete
     *  entries — its active capsule renders `min ▭gradient▭ max` rather than dots.
     *  Additive: only the map sets it; every other caller omits it and renders
     *  unchanged. When set, `entries` is empty. */
    readonly gradient?: {
        readonly min: number;
        readonly max: number;
        /** Resolved hex of the LOW (t=0) endpoint. For a single-colour ramp this is
         *  the floored neutral (`mix(hue, base, RAMP_FLOOR)`); for an explicit
         *  two-colour ramp it is the user's low colour. */
        readonly low: string;
        /** Resolved hex of the HIGH (t=1) endpoint (the named hue). */
        readonly high: string;
    };
}
interface LegendConfig {
    groups: readonly LegendGroupData[];
    position: LegendPosition;
    controls?: LegendControl[];
    controlsGroup?: ControlsGroupConfig;
    mode: LegendMode;
    /** Title width in pixels — used for inline-with-title computation */
    titleWidth?: number;
    /** Extra width (px) reserved after the pill inside an active capsule (e.g. for eye icon addon). Entries start after this offset. */
    capsulePillAddonWidth?: number;
    /**
     * Extra width (px) reserved AFTER the last entry, still inside the active
     * capsule. The counterpart of `capsulePillAddonWidth` at the other end of the
     * row, and reserved during packing rather than added afterwards — so it never
     * competes with an entry for the same pixels, and on a group that wraps it
     * cannot be the thing pushed past `LEGEND_MAX_ENTRY_ROWS` and dropped.
     *
     * Added 2026-08-26 for the app's live sketch canvas, where the legend is the
     * AUTHORING surface and `add a value` has to sit on the same rhythm as the
     * values rather than beside the capsule (diagrammo/diagrammo#514). Nothing
     * else sets it; omitted, the layout is byte-identical to before.
     *
     * Where it landed comes back as `LegendCapsuleLayout.trailingAddon`.
     */
    capsuleTrailingAddonWidth?: number;
    /** When true, groups with no entries are still rendered as collapsed pills. Default: false (empty groups hidden). */
    showEmptyGroups?: boolean;
    /** When true, INACTIVE sibling groups still render as collapsed pills next to
     *  the active capsule (preview only — export still shows just the active
     *  group). Lets the user click a sibling to switch the active group. Default
     *  false (legacy: when one group is active the others are hidden). */
    showInactivePills?: boolean;
    /** Where the controlsGroup is hosted. Default (undefined / 'inline') renders
     *  the in-SVG gear exactly as before — every non-app consumer (Obsidian,
     *  site, remark-family, CLI) is unaffected. When 'app', the controlsGroup is
     *  dropped entirely (no gear, no reserved row): the app overlay strip owns the
     *  controls, pinned to the top edge of the preview. App preview only; never
     *  set on the export path. */
    controlsHost?: 'app' | 'inline';
}
interface LegendPalette {
    bg: string;
    surface: string;
    text: string;
    textMuted: string;
    primary?: string;
}
interface LegendPillLayout {
    groupName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    isActive: boolean;
}
interface LegendEntryLayout {
    value: string;
    color: string;
    x: number;
    y: number;
    dotCx: number;
    dotCy: number;
    textX: number;
    textY: number;
    displayValue?: string;
    /** Full entry advance width (dot + gap + text + trail). Consumers draw a
     *  transparent hit-rect of this width so the whole pill is hoverable, not
     *  just the dot/text glyphs (legend-hover emphasis needs a filled target). */
    width?: number;
}
interface LegendCapsuleLayout {
    groupName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    pill: LegendPillLayout;
    entries: LegendEntryLayout[];
    /** Overflow indicator when entries exceed max rows */
    moreCount?: number;
    /** X offset where addon content (e.g. eye icon) can be placed — after pill, before entries */
    addonX?: number;
    /** Where `capsuleTrailingAddonWidth` came to rest — after the last entry, on
     *  whatever row that entry ended on. Capsule-relative, like `entries`. */
    trailingAddon?: {
        x: number;
        y: number;
        width: number;
    };
    /** Continuous-ramp swatch (choropleth groups) drawn in place of entry dots:
     *  `minText` | gradient rect | `maxText`, all vertically centred. */
    gradient?: {
        rampX: number;
        rampY: number;
        rampW: number;
        rampH: number;
        /** Raw numeric ends (for the app's gradient-scrub: x → value). */
        min: number;
        max: number;
        minText: string;
        minX: number;
        maxText: string;
        maxX: number;
        textY: number;
        /** Resolved hex endpoints (low = t0, high = t1); the renderer samples the
         *  ramp between them via `valueRampStops`. */
        low: string;
        high: string;
    };
}
interface LegendControlLayout {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    icon: string;
    label?: string;
    exportBehavior: LegendControlExportBehavior;
    children?: Array<{
        id: string;
        label: string;
        x: number;
        y: number;
        width: number;
        isActive?: boolean;
    }>;
}
interface ControlsGroupToggleLayout {
    id: string;
    label: string;
    active: boolean;
    dotCx: number;
    dotCy: number;
    textX: number;
    textY: number;
}
interface ControlsGroupLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    expanded: boolean;
    /** The gear pill layout (collapsed or inside capsule) */
    pill: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Toggle entries (only present when expanded) */
    toggles: ControlsGroupToggleLayout[];
}
interface LegendRowLayout {
    y: number;
    items: Array<LegendPillLayout | LegendCapsuleLayout | LegendControlLayout>;
}
interface LegendLayout {
    /** Total computed height including all rows */
    height: number;
    /** Total computed width */
    width: number;
    /** Rows of legend elements (pills wrap to new rows on overflow) */
    rows: LegendRowLayout[];
    /** Active capsule layout (if any group is active) */
    activeCapsule?: LegendCapsuleLayout;
    /** Control layouts (right-aligned) */
    controls: LegendControlLayout[];
    /** All pill layouts (collapsed groups) */
    pills: LegendPillLayout[];
    /** Controls group layout (gear pill / capsule) */
    controlsGroup?: ControlsGroupLayout;
}
interface LegendHandle {
    setState: (state: LegendState) => void;
    destroy: () => void;
    getHeight: () => number;
    getLayout: () => LegendLayout;
}
type D3Sel = Selection<any, unknown, any, unknown>;

/** A parsed emphasis directive: which dual, and the names it lists. */
interface EmphasisDirective {
    readonly kind: 'highlight' | 'dim';
    readonly names: readonly string[];
    /**
     * True when the author used no comma, so `names` is a *guess* — `dim Ship
     * Provisions` is one two-word element far more often than two one-word ones.
     * Resolution tries the whole phrase first and only falls back to these
     * tokens, which means a comma is never required for the common single-name
     * case but always disambiguates when an author wants several.
     */
    readonly ambiguous: boolean;
    /** The directive's argument text, verbatim — the whole-phrase candidate. */
    readonly raw: string;
    readonly lineNumber: number;
}

type ExtendedChartType = 'sankey' | 'chord' | 'function' | 'scatter' | 'heatmap' | 'funnel';
interface ExtendedChartDataPoint {
    label: string;
    value: number;
    color?: string;
    lineNumber: number;
}
interface ParsedSankeyLink {
    source: string;
    target: string;
    value: number;
    color?: string;
    directed?: boolean;
    lineNumber: number;
}
interface ParsedFunction {
    name: string;
    expression: string;
    color?: string;
    lineNumber: number;
}
interface ParsedScatterPoint {
    name: string;
    x: number;
    y: number;
    size?: number;
    color?: string;
    category?: string;
    lineNumber: number;
}
interface ParsedHeatmapRow {
    label: string;
    values: number[];
    lineNumber: number;
}

/** Fields shared by every extended data-chart. */
interface ParsedExtendedBase {
    title?: string;
    titleLineNumber?: number;
    series?: string;
    seriesLineNumber?: number;
    seriesNames?: string[];
    seriesNameLineNumbers?: number[];
    seriesNameColors?: (string | undefined)[];
    data: ExtendedChartDataPoint[];
    xlabel?: string;
    xlabelLineNumber?: number;
    ylabel?: string;
    ylabelLineNumber?: number;
    /** X-axis range — read by both function plots and scatter. */
    xRange?: {
        min: number;
        max: number;
    };
    noName?: boolean;
    noValue?: boolean;
    noPercent?: boolean;
    /** `fill` directive — shade the area below each curve (function charts),
     *  parity with the `line` chart's bare `fill`. Opacity follows `fillMode`. */
    fill?: boolean;
    /** §1.9 fill family: `'solid'` = full intent saturation, `'outline'` =
     *  theme-background fill with color on the stroke. Absent ⇒ 25% tint. */
    fillMode?: 'solid' | 'outline';
    /** Cross-chart-type: when true, the renderer suppresses the chart title. */
    noTitle?: boolean;
    /** Cross-chart-type: when true, the renderer suppresses the legend and the
     *  vertical band it would occupy (#48). */
    noLegend?: boolean;
    /** §1.9 `legend-inline`: title + series legend on one line (see ParsedChart).
     *  Honoured by scatter/function among the extended charts (decision #50). */
    legendInline?: boolean;
    /** §1.11 emphasis family: `highlight <Name>…` / `dim <Name>…`. Chart-level,
     *  mutually exclusive, last-one-wins. Resolved against real element names at
     *  render time via `resolveEmphasis`. */
    emphasis?: EmphasisDirective;
    categoryColors?: Record<string, string>;
    categoryLineNumbers?: Record<string, number>;
    nodeColors?: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}
interface ParsedSankey extends ParsedExtendedBase {
    type: 'sankey';
    links?: ParsedSankeyLink[];
}
interface ParsedChord extends ParsedExtendedBase {
    type: 'chord';
    links?: ParsedSankeyLink[];
    /** `layout arc|chord` override (#26). `arc` re-renders the same edges as a
     *  linear arc; absent ⇒ the `chord` circular preset. */
    layout?: 'arc' | 'chord';
}
interface ParsedFunctionChart extends ParsedExtendedBase {
    type: 'function';
    functions?: ParsedFunction[];
}
interface ParsedScatter extends ParsedExtendedBase {
    type: 'scatter';
    scatterPoints?: ParsedScatterPoint[];
    sizelabel?: string;
}
interface ParsedHeatmap extends ParsedExtendedBase {
    type: 'heatmap';
    heatmapRows?: ParsedHeatmapRow[];
    columns?: string[];
    rows?: string[];
}
interface ParsedFunnel extends ParsedExtendedBase {
    type: 'funnel';
}
/** What `parseExtendedChart` returns: discriminated on `type`. */
type ParsedExtendedChart = ParsedSankey | ParsedChord | ParsedFunctionChart | ParsedScatter | ParsedHeatmap | ParsedFunnel;
/**
 * Parses extended chart content into a structured object.
 *
 * Format (colon-free):
 * ```
 * scatter My Chart
 * xlabel Weight
 *
 * Alice 165, 60
 * Bob 180, 85
 * ```
 */
declare function parseExtendedChart(content: string, palette?: PaletteColors): ParsedExtendedChart;
/**
 * Extracts legend group data from standard chart types (multi-series line/bar).
 * Returns empty array if chart has no multi-series legend.
 */
declare function getSimpleChartLegendGroups(parsed: ParsedChart, colors: string[]): LegendGroupData[];
/**
 * Extracts legend group data from extended chart types.
 * Supports scatter (categories), chord (nodes), and function (series).
 */
declare function getExtendedChartLegendGroups(parsed: ParsedExtendedChart, colors: string[]): LegendGroupData[];

/**
 * Generates adaptive tick marks along a time axis.
 * Picks the right granularity (years, months, weeks, days, hours, minutes)
 * based on the domain span.
 *
 * Optional boundary parameters add ticks at exact data start/end:
 * - boundaryStart/boundaryEnd: numeric date values
 * - boundaryStartLabel/boundaryEndLabel: formatted labels for those dates
 */
declare function computeTimeTicks(domainMin: number, domainMax: number, scale: d3Scale.ScaleLinear<number, number>, boundaryStart?: number, boundaryEnd?: number, boundaryStartLabel?: string, boundaryEndLabel?: string): {
    pos: number;
    label: string;
}[];

/**
 * Participant types that can be declared via "Name is a type" syntax.
 *
 * The 0.16.0 trim retained only the types whose shapes carry semantic
 * weight at a glance: stick figure (actor), cylinder (database),
 * dashed cylinder (cache), horizontal pipe (queue), plus the default
 * rectangle. Any other type word falls back to `default`.
 */
type ParticipantType = 'default' | 'database' | 'actor' | 'queue' | 'cache';
/**
 * Branded participant identifier — a normalized name string that has
 * been minted through `addParticipant` and registered in the parser's
 * `participantMap`. Distinct from a raw display label or any other
 * `string`, so the type system catches "passed label where id expected"
 * at compile time.
 */
type ParticipantId = Brand<string, 'ParticipantId'>;
/**
 * A declared or inferred participant in the sequence diagram.
 */
interface SequenceParticipant {
    /** Internal identifier (e.g. "AuthService") */
    readonly id: ParticipantId;
    /** Display label — first-seen casing/spacing of the name */
    readonly label: string;
    /** Participant shape type */
    readonly type: ParticipantType;
    /** Source line number (1-based) */
    readonly lineNumber: number;
    /** Explicit layout position override (0-based from left, negative from right) */
    readonly position?: number;
    /** Pipe-delimited tag metadata (e.g. `| role: Gateway`) */
    readonly metadata?: Readonly<Record<string, string>>;
}
/**
 * A message between two participants.
 *
 * `kind: 'message'` is the discriminator for the SequenceElement union.
 * Pre-1.0 type addition — Epic 105 Story 105.17.
 */
interface SequenceMessage {
    readonly kind: 'message';
    readonly from: ParticipantId;
    readonly to: ParticipantId;
    readonly label: string;
    readonly lineNumber: number;
    readonly async?: boolean;
    /** Pipe-delimited tag metadata (e.g. `| c: Caching`) */
    readonly metadata?: Readonly<Record<string, string>>;
}
/**
 * A conditional or loop block in the sequence diagram.
 */
interface ElseIfBranch {
    readonly label: string;
    readonly children: readonly SequenceElement[];
    readonly lineNumber: number;
}
interface SequenceBlock {
    readonly kind: 'block';
    readonly type: 'if' | 'loop' | 'parallel';
    readonly label: string;
    readonly children: readonly SequenceElement[];
    readonly elseChildren: readonly SequenceElement[];
    readonly elseIfBranches?: readonly ElseIfBranch[];
    readonly elseLineNumber?: number;
    readonly lineNumber: number;
}
/**
 * A labeled horizontal divider between message phases.
 */
interface SequenceSection {
    readonly kind: 'section';
    readonly label: string;
    readonly lineNumber: number;
}
/**
 * An annotation attached to a message, rendered as a folded-corner box.
 */
interface SequenceNote {
    readonly kind: 'note';
    readonly text: string;
    readonly position: 'right' | 'left';
    readonly participantId: ParticipantId;
    readonly lineNumber: number;
    readonly endLineNumber: number;
}
type SequenceElement = SequenceMessage | SequenceBlock | SequenceSection | SequenceNote;
declare function isSequenceBlock(el: SequenceElement): el is SequenceBlock;
declare function isSequenceNote(el: SequenceElement): el is SequenceNote;
/**
 * A named group of participants rendered as a labeled box.
 */
interface SequenceGroup {
    readonly name: string;
    readonly participantIds: readonly ParticipantId[];
    readonly lineNumber: number;
    /** Pipe-delimited tag metadata (e.g. `[Backend | t: Product]`) */
    readonly metadata?: Readonly<Record<string, string>>;
    /** Whether this group is collapsed by default */
    readonly collapsed?: boolean;
}
/**
 * Parsed result from a .dgmo sequence diagram.
 */
interface ParsedSequenceDgmo {
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly participants: readonly SequenceParticipant[];
    readonly messages: readonly SequenceMessage[];
    readonly elements: readonly SequenceElement[];
    readonly groups: readonly SequenceGroup[];
    readonly sections: readonly SequenceSection[];
    readonly tagGroups: readonly TagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}
/**
 * Parse a .dgmo file with `chart: sequence` into a structured representation.
 */
declare function parseSequenceDgmo(content: string, palette?: PaletteColors): ParsedSequenceDgmo;
/**
 * Detect whether raw content looks like a sequence diagram.
 * Used by the chart type inference logic.
 */
declare function looksLikeSequence(content: string): boolean;

/**
 * Infer participant type from a name using the ordered rules table.
 * Returns 'default' if no rule matches.
 */
declare function inferParticipantType(name: string): ParticipantType;
/**
 * Number of rules in the table. Exported for test assertions.
 */
declare const RULE_COUNT: number;

interface DiagramNote {
    /** Author-typed node id/label the note attaches to. */
    readonly ref: string;
    /** Body text (inline + indented lines, joined with `\n`). */
    readonly body: string;
    /** Resolved hex accent (border + faded fill); default yellow if absent. */
    readonly color?: string;
    readonly lineNumber: number;
    readonly endLineNumber: number;
}

type GraphShape = 'terminal' | 'process' | 'decision' | 'io' | 'subroutine' | 'document' | 'state' | 'pseudostate';
type GraphDirection = 'TB' | 'LR';
interface GraphNode {
    readonly id: string;
    readonly label: string;
    readonly shape: GraphShape;
    readonly color?: string;
    readonly group?: string;
    readonly lineNumber: number;
    /**
     * §1.4 tag metadata keyed by `tagAttrKey(group.name)` (state only —
     * decision #48). Absent on flowchart nodes and on state nodes in
     * diagrams that declare no tag groups.
     */
    readonly metadata?: Readonly<Record<string, string>>;
}
interface GraphEdge {
    readonly source: string;
    readonly target: string;
    readonly label?: string;
    readonly color?: string;
    readonly lineNumber: number;
}
interface GraphGroup {
    readonly id: string;
    readonly label: string;
    readonly color?: string;
    readonly nodeIds: readonly string[];
    readonly lineNumber: number;
    readonly collapsed?: boolean;
}

type GraphNote = DiagramNote;

interface ParsedGraph {
    readonly type: 'flowchart' | 'state';
    readonly title?: string;
    readonly titleLineNumber?: number;
    readonly direction: GraphDirection;
    readonly nodes: readonly GraphNode[];
    readonly edges: readonly GraphEdge[];
    readonly groups?: readonly GraphGroup[];
    readonly notes?: readonly GraphNote[];
    /**
     * Declared tag groups (state only — decision #48). Optional so the
     * flowchart parser, which has no tag channel, keeps its shape.
     */
    readonly tagGroups?: readonly TagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

type ChartType = string;
interface DiagramSymbols {
    kind: ChartType;
    entities: string[];
    /**
     * Map of alias-literal → canonical entity name, collected from
     * `Name as <alias>` declarations in the document. Editor surfaces
     * both forms in autocomplete; selecting an alias inserts the alias
     * literal (the alias is input convenience, not a display name).
     */
    aliases?: Record<string, string>;
}

declare function parseFlowchart(content: string, palette?: PaletteColors): ParsedGraph;
/**
 * Detect if content looks like a flowchart (without explicit `chart: flowchart` header).
 * Checks for shape delimiters combined with `->` arrows.
 * Avoids false-positives on sequence diagrams (which use bare names with `->`)
 */
declare function looksLikeFlowchart(content: string): boolean;

/**
 * Extract node IDs (entities) from flowchart document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
declare function extractSymbols$3(docText: string): DiagramSymbols;

declare function parseState(content: string, palette?: PaletteColors): ParsedGraph;
/**
 * Detect if content looks like a state diagram (without explicit `chart: state` header).
 * Only matches if `[*]` token is present — too ambiguous to infer from bare names alone.
 */
declare function looksLikeState(content: string): boolean;

/**
 * One rendered description line. `kind` controls horizontal placement and
 * whether the renderer draws a bullet glyph:
 *  - `plain`        — flush left at the description's left edge
 *  - `bullet-first` — "•" drawn at the left edge, body text at the bullet column
 *  - `bullet-cont`  — body continuation at the bullet column (no glyph)
 *
 * Splitting first-line bullet rendering into separate text elements lets
 * continuation lines align exactly under the first word past the bullet,
 * regardless of font-width estimation drift.
 */
interface WrappedDescLine {
    text: string;
    kind: 'plain' | 'bullet-first' | 'bullet-cont';
}

type NoteSide$1 = 'above' | 'below' | 'left' | 'right';
/** A note box positioned relative to its anchor node's center. */
interface NoteLayout {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Which side of the node the box sits on (drives the connector). */
    readonly side: NoteSide$1;
    /** Resolved hex accent (border + faded fill); default yellow if absent. */
    readonly color?: string;
    readonly lines: readonly WrappedDescLine[];
    readonly lineNumber: number;
    readonly endLineNumber: number;
    /**
     * When true the note is collapsed: the renderer draws a small badge at
     * the node corner instead of the floated box, and `x/y/width/height/side/
     * lines` are unused. Collapsed notes reserve no layout space.
     */
    readonly collapsed?: boolean;
}
interface LayoutNode {
    readonly id: string;
    readonly label: string;
    readonly shape: GraphShape;
    readonly color?: string;
    readonly group?: string;
    /** §1.4 tag metadata carried through from the parsed node (state only). */
    readonly metadata?: Readonly<Record<string, string>>;
    readonly lineNumber: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /**
     * A note floated beside this node. The shape keeps its natural dagre
     * position and dimensions (so its edges stay connected) — the note is
     * placed in adjacent space and the canvas bounds are expanded to fit
     * it. Absent on un-annotated nodes.
     */
    readonly note?: NoteLayout;
}
interface LayoutEdge {
    readonly source: string;
    readonly target: string;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
    readonly label?: string;
    readonly lineNumber: number;
}
interface LayoutGroup {
    readonly id: string;
    readonly label: string;
    readonly color?: string;
    readonly lineNumber: number;
    readonly collapsed?: boolean;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
interface LayoutOptions$1 {
    /** Map of group ID → number of child nodes (for collapsed groups) */
    collapsedChildCounts?: Map<string, number>;
    /** Original groups before collapse (includes collapsed ones) */
    originalGroups?: readonly GraphGroup[];
    /**
     * 1-based source line numbers of notes the user has collapsed. A
     * collapsed note renders as a corner badge and reserves no space.
     */
    collapsedNotes?: ReadonlySet<number>;
}
interface LayoutResult$1 {
    readonly nodes: readonly LayoutNode[];
    readonly edges: readonly LayoutEdge[];
    readonly groups: readonly LayoutGroup[];
    readonly width: number;
    readonly height: number;
}
declare function layoutGraph(graph: ParsedGraph, options?: LayoutOptions$1): LayoutResult$1;

declare function renderState(container: HTMLDivElement, graph: ParsedGraph, layout: LayoutResult$1, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}): void;
declare function renderStateForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

interface StateCollapseResult {
    parsed: ParsedGraph;
    collapsedChildCounts: Map<string, number>;
    originalGroups: readonly GraphGroup[];
}
/**
 * Pure transform: returns a new ParsedGraph with collapsed groups
 * removed from the diagram content.
 *
 * - Children of collapsed groups removed from nodes
 * - Edges redirected: endpoints in collapsed groups → group ID
 * - Internal edges (both in same collapsed group) dropped
 * - Duplicate edges (same source, target, label) deduplicated
 * - Collapsed groups removed from groups[] (layout handles as nodes)
 */
declare function collapseStateGroups(parsed: ParsedGraph, collapsedGroups: Set<string>): StateCollapseResult;

type NoteSide = 'above' | 'below' | 'left' | 'right';

/** A resolved, placed note ready for the note-box drawer. */
interface PlacedNote {
    /** Box left, LOCAL to the node center (add node.x). Unused if collapsed. */
    readonly x: number;
    /** Box top, LOCAL to the node center (add node.y). Unused if collapsed. */
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly side: NoteSide;
    /** Resolved hex accent (border + faded fill); default yellow if absent. */
    readonly color?: string;
    readonly lines: readonly WrappedDescLine[];
    readonly lineNumber: number;
    readonly endLineNumber: number;
    /** Collapsed → renderer draws a corner badge; box geometry is unused. */
    readonly collapsed?: boolean;
}

type ClassModifier = 'abstract' | 'interface' | 'enum';
type MemberVisibility = 'public' | 'private' | 'protected';
type RelationshipType = 'extends' | 'implements' | 'composes' | 'aggregates' | 'depends' | 'associates';
interface ClassMember {
    readonly name: string;
    readonly type?: string;
    readonly params?: string;
    readonly visibility: MemberVisibility;
    readonly isStatic: boolean;
    readonly isMethod: boolean;
    readonly lineNumber: number;
}
interface ClassNode {
    readonly id: string;
    readonly name: string;
    readonly modifier?: ClassModifier;
    readonly color?: string;
    readonly members: readonly ClassMember[];
    readonly lineNumber: number;
}
interface ClassRelationship {
    readonly source: string;
    readonly target: string;
    readonly type: RelationshipType;
    readonly label?: string;
    readonly lineNumber: number;
}

interface ParsedClassDiagram {
    readonly type: 'class';
    readonly title?: string;
    readonly titleLineNumber?: number;
    readonly classes: readonly ClassNode[];
    readonly relationships: readonly ClassRelationship[];
    readonly options: Readonly<Record<string, string>>;
    /** Generic node notes (`note <ClassName> …`); resolved in layout. */
    readonly notes?: readonly DiagramNote[];
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseClassDiagram(content: string, palette?: PaletteColors): ParsedClassDiagram;
/**
 * Detect if content looks like a class diagram without explicit `chart: class`.
 * Requires class-like patterns (capitalized names with modifiers or UML relationships).
 * Must not false-positive on flowcharts.
 */
declare function looksLikeClassDiagram(content: string): boolean;

/**
 * Extract class names (entities) from class diagram document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
declare function extractSymbols$2(docText: string): DiagramSymbols;

interface ClassLayoutNode extends ClassNode {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly headerHeight: number;
    readonly fieldsHeight: number;
    readonly methodsHeight: number;
    /** A note floated beside this class (never moves the box). */
    readonly note?: PlacedNote;
}
interface ClassLayoutOptions {
    /**
     * 1-based source line numbers of notes the user has collapsed. A
     * collapsed note renders as a corner badge and reserves no space.
     */
    collapsedNotes?: ReadonlySet<number>;
}
interface ClassLayoutEdge {
    readonly source: string;
    readonly target: string;
    readonly type: RelationshipType;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
    readonly label?: string;
    readonly lineNumber: number;
}
interface ClassLayoutResult {
    readonly nodes: readonly ClassLayoutNode[];
    readonly edges: readonly ClassLayoutEdge[];
    readonly width: number;
    readonly height: number;
}
declare function layoutClassDiagram(parsed: ParsedClassDiagram, options?: ClassLayoutOptions): ClassLayoutResult;

declare function renderClassDiagram(container: HTMLDivElement, parsed: ParsedClassDiagram, layout: ClassLayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, legendActive?: boolean | null, exportMode?: boolean): void;
declare function renderClassDiagramForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

type ERConstraint = 'pk' | 'fk' | 'unique' | 'nullable';
type ERCardinality = '1' | '*' | '?';
interface ERColumn {
    readonly name: string;
    readonly type?: string;
    readonly constraints: readonly ERConstraint[];
    readonly lineNumber: number;
}
interface ERTable {
    readonly id: string;
    readonly name: string;
    readonly color?: string;
    readonly columns: readonly ERColumn[];
    readonly metadata: Readonly<Record<string, string>>;
    readonly lineNumber: number;
}
interface ERRelationship {
    readonly source: string;
    readonly target: string;
    readonly cardinality: {
        readonly from: ERCardinality;
        readonly to: ERCardinality;
    };
    readonly label?: string;
    readonly lineNumber: number;
}

interface ParsedERDiagram {
    readonly type: 'er';
    readonly title?: string;
    readonly titleLineNumber?: number;
    readonly options: Readonly<Record<string, string>>;
    readonly tables: readonly ERTable[];
    readonly relationships: readonly ERRelationship[];
    readonly tagGroups: readonly TagGroup[];
    /** Generic node notes (`note <Table> …`); resolved in layout. */
    readonly notes?: readonly DiagramNote[];
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseERDiagram(content: string, palette?: PaletteColors): ParsedERDiagram;
/**
 * Detect if content looks like an ER diagram without explicit `er` first line.
 * Looks for indented lines with pk or fk constraint keywords.
 */
declare function looksLikeERDiagram(content: string): boolean;

/**
 * Extract table names (entities) and ER keywords from document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
declare function extractSymbols$1(docText: string): DiagramSymbols;

interface ERLayoutNode extends ERTable {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly headerHeight: number;
    readonly columnsHeight: number;
    /** A note floated beside this table (never moves the box). */
    readonly note?: PlacedNote;
}
interface ERLayoutOptions {
    /** 1-based source lines of notes the user collapsed (corner badge). */
    collapsedNotes?: ReadonlySet<number>;
}
interface ERLayoutEdge {
    readonly source: string;
    readonly target: string;
    readonly cardinality: {
        readonly from: string;
        readonly to: string;
    };
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
    readonly label?: string;
    readonly lineNumber: number;
}
interface ERLayoutResult {
    readonly nodes: readonly ERLayoutNode[];
    readonly edges: readonly ERLayoutEdge[];
    readonly width: number;
    readonly height: number;
}
declare function layoutERDiagram(parsed: ParsedERDiagram, options?: ERLayoutOptions): ERLayoutResult;

declare function renderERDiagram(container: HTMLDivElement, parsed: ParsedERDiagram, layout: ERLayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, activeTagGroup?: string | null, 
/** When false, semantic role colors are suppressed and entities use a neutral color. */
semanticColorsActive?: boolean, exportMode?: boolean): void;
declare function renderERDiagramForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

interface InlineSpan {
    text: string;
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    href?: string;
}
declare function parseInlineMarkdown(text: string): InlineSpan[];
declare function truncateBareUrl(url: string): string;

/**
 * Reduce a name to its canonical key for equality comparison.
 *
 * Idempotent: `normalizeName(normalizeName(x)) === normalizeName(x)`.
 *
 * The returned key is for equality only — never display it. Callers
 * that need to render a name should use the `displayLabel` field of
 * the `NameEntry` returned by `getOrCreateName`.
 */
declare function normalizeName(input: string): string;
/**
 * Reduce a name to its display form: NFC normalize and trim only.
 *
 * Casing AND internal whitespace are preserved verbatim — the spec
 * says "first-seen casing/spacing wins for display" (ADR-002), so a
 * double space typed by the user survives into the rendered label.
 * Renderers may collapse it for layout, but the source-of-truth is
 * what the user typed.
 *
 * Two inputs that share the same `normalizeName(...)` key but have
 * different `displayName(...)` values are a "merge" — surfaced via
 * the `NAME_MERGED` diagnostic.
 */
declare function displayName(input: string): string;
/**
 * One entity, identified by its normalized key.
 *
 * Parsers either use this shape directly in their entity Map or
 * compose it into a richer per-chart node type. Equality MUST use
 * only `normalizedKey`; rendering MUST use only `displayLabel`.
 */
interface NameEntry {
    /** Output of `normalizeName(input)` — the lookup key. */
    normalizedKey: string;
    /** First-seen casing/spacing — what gets rendered. */
    displayLabel: string;
    /** 1-based source line where the name was first declared. */
    declaredLine: number;
}
/**
 * Result of an entity insertion attempt.
 *
 * `created` is true on first sighting. `merged` is present iff the
 * input collided with an existing entry AND the displayed forms
 * differ — that is the case worth reporting via `NAME_MERGED`.
 * Identical re-declarations produce neither `created` nor `merged`.
 */
interface GetOrCreateNameResult {
    entry: NameEntry;
    created: boolean;
    merged?: {
        existingLine: number;
        existingDisplay: string;
        incomingDisplay: string;
    };
}
/**
 * Insert-or-fetch helper for `Map<normalizedKey, NameEntry>` stores.
 *
 * Parsers that need a richer node type (e.g. flowchart's `Node`
 * carries shape + edges) should wrap this helper: call it for the
 * normalization + merge-detection bookkeeping, then store the result
 * in their own `Map<normalizedKey, RichNode>`.
 *
 * When an `aliasStore` is provided, alias resolution runs FIRST: an
 * exact-match (case-sensitive) hit returns the bound canonical entry
 * untouched (the alias literal does NOT contribute to display or
 * merge bookkeeping). Misses fall through to UNH normalization.
 */
declare function getOrCreateName(input: string, store: Map<string, NameEntry>, lineNumber: number, aliasStore?: AliasMap): GetOrCreateNameResult;
/** alias literal → bound canonical entry. Exact-match, case-sensitive. */
type AliasMap = Map<string, NameEntry>;

interface OrgLayoutNode {
    readonly id: string;
    readonly label: string;
    readonly metadata: Readonly<Record<string, string>>;
    /** Original (unfiltered) metadata — used for tag-based hover dimming even when the group is hidden */
    readonly tagMetadata: Readonly<Record<string, string>>;
    readonly isContainer: boolean;
    readonly lineNumber: number;
    readonly color?: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Count of hidden descendants when this node is collapsed */
    readonly hiddenCount?: number;
    /** True if node has children (expanded or collapsed) — drives toggle UI */
    readonly hasChildren?: boolean;
}
interface OrgLayoutEdge {
    readonly sourceId: string;
    readonly targetId: string;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
}
interface OrgContainerBounds {
    readonly nodeId: string;
    readonly label: string;
    readonly lineNumber: number;
    readonly color?: string;
    readonly metadata: Readonly<Record<string, string>>;
    /** Original (unfiltered) metadata — used for tag-based hover dimming even when the group is hidden */
    readonly tagMetadata: Readonly<Record<string, string>>;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly labelHeight: number;
    /** Count of hidden descendants when this container is collapsed */
    readonly hiddenCount?: number;
    /** True if container has children (expanded or collapsed) — drives toggle UI */
    readonly hasChildren?: boolean;
}
interface OrgLegendEntry {
    readonly value: string;
    readonly color: string;
}
interface OrgLegendGroup {
    readonly name: string;
    readonly alias?: string;
    readonly entries: readonly OrgLegendEntry[];
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly minifiedWidth: number;
    readonly minifiedHeight: number;
}
interface OrgLayoutResult {
    readonly nodes: readonly OrgLayoutNode[];
    readonly edges: readonly OrgLayoutEdge[];
    readonly containers: readonly OrgContainerBounds[];
    readonly legend: readonly OrgLegendGroup[];
    readonly width: number;
    readonly height: number;
    /**
     * How far every node, container and edge point was pushed DOWN to leave room
     * for a legend row drawn inside the diagram — 0 when no group is visible.
     * A renderer that draws the legend somewhere else (the app pins it above the
     * scaled diagram at native size) takes this back, so it must read the shift
     * that was actually applied rather than assume one (#325).
     */
    readonly legendShift: number;
}
declare function layoutOrg(parsed: ParsedOrg, hiddenCounts?: Map<string, number>, activeTagGroup?: string | null, hiddenAttributes?: Set<string>, expandAllLegend?: boolean): OrgLayoutResult;

interface CollapsedOrgResult {
    /** ParsedOrg with collapsed subtrees pruned (deep-cloned, never mutates original) */
    parsed: ParsedOrg;
    /** nodeId → count of hidden descendants */
    hiddenCounts: Map<string, number>;
}
interface AncestorInfo {
    id: string;
    label: string;
    lineNumber: number;
    color?: string;
    metadata: Record<string, string>;
    isContainer: boolean;
}
interface FocusOrgResult {
    /** ParsedOrg with only the focused subtree as the single root */
    parsed: ParsedOrg;
    /** Ancestor path from original root → parent of focused node (top-down order) */
    ancestorPath: AncestorInfo[];
}
declare function collapseOrgTree(original: ParsedOrg, collapsedIds: Set<string>): CollapsedOrgResult;
/**
 * Extract a subtree rooted at `focusNodeId`, returning the focused tree
 * and the ancestor breadcrumb path. Returns null if the node is not found.
 */
declare function focusOrgTree(original: ParsedOrg, focusNodeId: string): FocusOrgResult | null;

declare function renderOrg(container: HTMLDivElement, parsed: ParsedOrg, layout: OrgLayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, activeTagGroup?: string | null, hiddenAttributes?: Set<string>, ancestorPath?: AncestorInfo[], exportMode?: boolean): void;
declare function renderOrgForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

/** @deprecated Use `TagEntry` from `utils/tag-groups` */
type KanbanTagEntry = TagEntry;
/** @deprecated Use `TagGroup` from `utils/tag-groups` */
type KanbanTagGroup = TagGroup;
interface KanbanCard {
    readonly id: string;
    readonly title: string;
    readonly tags: Readonly<Record<string, string>>;
    readonly details: readonly string[];
    readonly lineNumber: number;
    readonly endLineNumber: number;
    readonly color?: string;
}
interface KanbanColumn {
    readonly id: string;
    readonly name: string;
    readonly wipLimit?: number;
    readonly color?: string;
    readonly collapsed?: boolean;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly cards: readonly KanbanCard[];
    readonly lineNumber: number;
}
interface ParsedKanban {
    readonly type: 'kanban';
    readonly title?: string;
    readonly titleLineNumber?: number;
    readonly columns: readonly KanbanColumn[];
    readonly tagGroups: readonly KanbanTagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseKanban(content: string, palette?: PaletteColors): ParsedKanban;

/**
 * Compute new file content after moving a card to a different position.
 *
 * @param content     - original file content string
 * @param parsed      - parsed kanban board
 * @param cardId      - id of the card to move
 * @param targetColumnId - id of the destination column
 * @param targetIndex - position within target column (0 = first card)
 * @returns new content string, or null if move is invalid
 */
declare function computeCardMove(content: string, parsed: ParsedKanban, cardId: string, targetColumnId: string, targetIndex: number): string | null;
/**
 * Move a card to the Archive section at the end of the file.
 * Creates `== Archive ==` if it doesn't exist.
 *
 * @returns new content string, or null if the card is not found
 */
declare function computeCardArchive(content: string, parsed: ParsedKanban, cardId: string): string | null;
/** Check if a column name is the archive column (case-insensitive). */
declare function isArchiveColumn(name: string): boolean;

interface KanbanInteractiveOptions {
    onNavigateToLine?: (line: number) => void;
    exportDims?: {
        width: number;
        height: number;
    };
    activeTagGroup?: string | null;
    currentSwimlaneGroup?: string | null;
    onSwimlaneChange?: (group: string | null) => void;
    collapsedLanes?: Set<string>;
    collapsedColumns?: Set<string>;
    compactMeta?: boolean;
    exportMode?: boolean;
}
declare function renderKanban(container: HTMLElement, parsed: ParsedKanban, palette: PaletteColors, isDark: boolean, options?: KanbanInteractiveOptions): void;
declare function renderKanbanForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

/** @deprecated Use `TagEntry` from `utils/tag-groups` */
type C4TagEntry = TagEntry;
/** @deprecated Use `TagGroup` from `utils/tag-groups` */
type C4TagGroup = TagGroup;
type C4ElementType = 'person' | 'system' | 'container' | 'component';
type C4Shape = 'default' | 'database' | 'cache' | 'queue' | 'cloud' | 'external';
type C4ArrowType = 'sync' | 'async' | 'bidirectional' | 'bidirectional-async';
interface C4Relationship {
    readonly target: string;
    readonly label?: string;
    readonly technology?: string;
    readonly arrowType: C4ArrowType;
    readonly lineNumber: number;
}
interface C4Group {
    readonly name: string;
    readonly children: readonly C4Element[];
    /**
     * Authored collapse marker (§1.8, decision #48): bare trailing
     * `collapsed` flag on the `[Group]` line (legacy: `collapsed: true`).
     * Parsed and exposed for consumers; the c4 layout does not yet fold
     * group boundaries.
     */
    readonly collapsed?: boolean;
    readonly lineNumber: number;
}
interface C4Element {
    readonly name: string;
    readonly type: C4ElementType;
    readonly shape: C4Shape;
    readonly metadata: Readonly<Record<string, string>>;
    readonly description?: readonly string[];
    readonly children: readonly C4Element[];
    readonly groups: readonly C4Group[];
    readonly relationships: readonly C4Relationship[];
    readonly importPath?: string;
    readonly lineNumber: number;
    readonly sectionHeader?: 'containers' | 'components';
    readonly sectionHeaderLineNumber?: number;
}
interface C4DeploymentNode {
    readonly name: string;
    readonly metadata: Readonly<Record<string, string>>;
    readonly shape: C4Shape;
    readonly children: readonly C4DeploymentNode[];
    readonly containerRefs: readonly string[];
    readonly lineNumber: number;
}
interface ParsedC4 {
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly options: Readonly<Record<string, string>>;
    /**
     * Resolved layout direction (§8.7). `direction-lr` / `direction-tb` are a
     * mutually-exclusive boolean pair (§1.9, last one wins). Defaults to 'TB',
     * which is the orientation C4 views have always rendered.
     */
    readonly direction: 'LR' | 'TB';
    readonly tagGroups: readonly TagGroup[];
    readonly elements: readonly C4Element[];
    readonly relationships: readonly C4Relationship[];
    readonly deployment: readonly C4DeploymentNode[];
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseC4(content: string, palette?: PaletteColors): ParsedC4;

interface C4LayoutNode {
    readonly id: string;
    readonly name: string;
    readonly type: 'person' | 'system' | 'container' | 'component';
    readonly description?: string;
    readonly metadata: Readonly<Record<string, string>>;
    readonly lineNumber: number;
    readonly color?: string;
    readonly shape?: C4Shape;
    readonly technology?: string;
    readonly drillable?: boolean;
    readonly importPath?: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
interface C4LayoutEdge {
    readonly source: string;
    readonly target: string;
    readonly arrowType: C4ArrowType;
    readonly label?: string;
    readonly technology?: string;
    readonly lineNumber: number;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
}
interface C4LegendEntry {
    readonly value: string;
    readonly color: string;
}
interface C4LegendGroup {
    readonly name: string;
    readonly entries: readonly C4LegendEntry[];
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
interface C4LayoutBoundary {
    readonly label: string;
    readonly typeLabel: string;
    readonly lineNumber: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
interface C4LayoutResult {
    readonly nodes: readonly C4LayoutNode[];
    readonly edges: readonly C4LayoutEdge[];
    readonly legend: readonly C4LegendGroup[];
    readonly boundary?: C4LayoutBoundary;
    readonly groupBoundaries: readonly C4LayoutBoundary[];
    readonly width: number;
    readonly height: number;
}
interface ContextRelationship {
    sourceName: string;
    targetName: string;
    label?: string;
    technology?: string;
    arrowType: C4ArrowType;
    lineNumber: number;
}
/**
 * Roll up container/component-level relationships to system-to-system edges.
 * - Skips internal relationships (same top-level ancestor).
 * - Deduplicates: same source→target pair keeps only one (first seen).
 * - Explicit system-level relationships override rolled-up ones.
 */
declare function rollUpContextRelationships(parsed: ParsedC4): ContextRelationship[];
declare function layoutC4Context(parsed: ParsedC4, activeTagGroup?: string | null): C4LayoutResult;
/**
 * Layout containers within a specific system, plus external elements
 * that have relationships with those containers.
 */
declare function layoutC4Containers(parsed: ParsedC4, systemName: string, activeTagGroup?: string | null): C4LayoutResult;
/**
 * Layout components within a specific container, plus external elements
 * that have relationships with those components.
 */
declare function layoutC4Components(parsed: ParsedC4, systemName: string, containerName: string, activeTagGroup?: string | null): C4LayoutResult;
/**
 * Layout a C4 deployment diagram.
 *
 * Infrastructure nodes become boundary boxes (nested).
 * Container refs inside them become cards.
 * Edges are drawn between referenced containers that have relationships.
 */
declare function layoutC4Deployment(parsed: ParsedC4, activeTagGroup?: string | null): C4LayoutResult;

declare function renderC4Context(container: HTMLDivElement, parsed: ParsedC4, layout: C4LayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, activeTagGroup?: string | null, exportMode?: boolean): void;
declare function renderC4ContextForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;
/**
 * Render a C4 container-level diagram showing containers inside a system boundary
 * with external elements outside.
 */
declare function renderC4Containers(container: HTMLDivElement, parsed: ParsedC4, layout: C4LayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, activeTagGroup?: string | null, exportMode?: boolean): void;
declare function renderC4ContainersForExport(content: string, systemName: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;
declare function renderC4ComponentsForExport(content: string, systemName: string, containerName: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;
/**
 * Render a C4 deployment diagram interactively.
 * Reuses the container renderer — infrastructure boundaries are rendered
 * as group boundaries and container refs as cards (same visual pattern).
 */
declare function renderC4Deployment(container: HTMLDivElement, parsed: ParsedC4, layout: C4LayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, activeTagGroup?: string | null, exportMode?: boolean): void;
/**
 * Export convenience function for deployment diagrams.
 */
declare function renderC4DeploymentForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

interface BLNode {
    readonly label: string;
    readonly lineNumber: number;
    readonly metadata: Readonly<Record<string, string>>;
    readonly description?: readonly string[];
    /** Numeric measure lifted from `heat: X` metadata (mirror of map's
     *  `region.value`). Drives the heat ramp / choropleth tinting. */
    readonly value?: number;
}
interface BLEdge {
    readonly source: string;
    readonly target: string;
    readonly label?: string;
    readonly bidirectional: boolean;
    readonly lineNumber: number;
    readonly metadata: Readonly<Record<string, string>>;
}
interface BLGroup {
    readonly label: string;
    readonly children: readonly string[];
    readonly lineNumber: number;
    readonly metadata: Readonly<Record<string, string>>;
    readonly parentGroup?: string;
}
interface ParsedBoxesAndLines {
    readonly type: 'boxes-and-lines';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly nodes: readonly BLNode[];
    readonly edges: readonly BLEdge[];
    readonly groups: readonly BLGroup[];
    readonly tagGroups: readonly TagGroup[];
    readonly options: Readonly<Record<string, string>>;
    /** Generic node notes (`note <Box> …`); resolved in layout. */
    readonly notes?: readonly DiagramNote[];
    readonly initialHiddenTagValues: ReadonlyMap<string, ReadonlySet<string>>;
    readonly direction: 'LR' | 'TB';
    /** `heat <label> [low] [high]` — names the value-ramp dimension and
     *  optionally sets its endpoint colours. One color = high hue over a neutral
     *  low; two = explicit `low high`. Mirror of map's `region-heat`. */
    readonly boxMetric?: string;
    /** Recognized color NAME for the ramp HIGH endpoint. */
    readonly boxMetricColor?: string;
    /** Recognized color NAME for the ramp LOW endpoint (two-colour form). */
    readonly boxMetricLowColor?: string;
    /**
     * Box numeric value labels. Default ON (decision #48) — `no-value` sets
     * `false`; legacy `show-values` sets `true` (a no-op). `undefined` = on.
     */
    readonly showValues?: boolean;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseBoxesAndLines(content: string, palette?: PaletteColors): ParsedBoxesAndLines;

interface BLLayoutNode {
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** A note floated beside this box (never moves the box). */
    readonly note?: PlacedNote;
}
interface BLLayoutEdge {
    readonly source: string;
    readonly target: string;
    readonly label?: string;
    readonly bidirectional: boolean;
    readonly lineNumber: number;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
    /** Centre of the label box (set by label-placement). */
    readonly labelX?: number;
    readonly labelY?: number;
    /** Wrapped label box dimensions + lines (set by label-placement; the renderer
     *  draws the halo + tspans straight from these). */
    readonly labelWidth?: number;
    readonly labelHeight?: number;
    readonly labelLines?: readonly string[];
    readonly yOffset: number;
    readonly parallelCount: number;
    readonly metadata: Readonly<Record<string, string>>;
    /** Marker for renderer: draw with linear curve, not curveBasis (ELK gives
     * us orthogonal polylines and curveBasis would smooth corners into waves) */
    readonly deferred?: boolean;
}
interface BLLayoutGroup {
    readonly label: string;
    readonly lineNumber: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly collapsed: boolean;
    readonly childCount?: number;
}
interface BLLayoutResult {
    readonly nodes: readonly BLLayoutNode[];
    readonly edges: readonly BLLayoutEdge[];
    readonly groups: readonly BLLayoutGroup[];
    readonly width: number;
    readonly height: number;
}
declare function layoutBoxesAndLines(parsed: ParsedBoxesAndLines, collapseInfo?: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: readonly BLGroup[];
}, layoutOptions?: {
    hideDescriptions?: boolean;
    collapsedNotes?: ReadonlySet<number>;
    /** Previous node positions (label → {x,y}) for layout stability —
     *  minimizes node drift on edit/collapse. */
    previousPositions?: ReadonlyMap<string, {
        x: number;
        y: number;
    }>;
    /** Interactive collapse stability: freeze surviving nodes, anchor the
     *  collapsed pill at its members' previous bounding-box centre, and close
     *  the vacated gap — instead of re-running the placement search. Requires
     *  `previousPositions`; falls back to the search when coverage is
     *  incomplete. */
    stableCollapse?: boolean;
    /** Progress hook (interactive path). When set, the search yields between
     *  candidates so the UI can paint a "trying X of Y" indicator. */
    onProgress?: (done: number, total: number, phase: string) => void;
}): Promise<BLLayoutResult>;

interface BLRenderOptions {
    onClickItem?: (lineNumber: number) => void;
    exportDims?: {
        width?: number;
        height?: number;
    };
    activeTagGroup?: string | null;
    hiddenTagValues?: Map<string, Set<string>>;
    hideDescriptions?: boolean;
    controlsExpanded?: boolean;
    onToggleDescriptions?: (active: boolean) => void;
    onToggleControlsExpand?: () => void;
    exportMode?: boolean;
    /** When 'app', the description toggle is hosted by the app overlay strip
     *  (inline gear suppressed, controls row + anchor reserved). */
    controlsHost?: 'app' | 'inline';
    /** Explicit value-ramp domain override. When provided, the choropleth ramp
     *  uses these endpoints instead of computing min/max from `parsed.nodes`.
     *  Focus mode passes the GLOBAL (pre-filter) domain so neighbor colours stay
     *  stable when only a subset is rendered (Decision 20 / FM1). */
    rampDomain?: {
        min: number;
        max: number;
    };
}
declare function renderBoxesAndLines(container: HTMLDivElement, parsed: ParsedBoxesAndLines, layout: BLLayoutResult, palette: PaletteColors, isDark: boolean, options?: BLRenderOptions): void;
declare function renderBoxesAndLinesForExport(container: HTMLDivElement, parsed: ParsedBoxesAndLines, layout: BLLayoutResult, palette: PaletteColors, isDark: boolean, options?: {
    exportDims?: {
        width: number;
        height: number;
    };
    activeTagGroup?: string | null;
    hiddenTagValues?: Map<string, Set<string>>;
    exportMode?: boolean;
}): void;

interface BLCollapseResult {
    parsed: ParsedBoxesAndLines;
    collapsedChildCounts: Map<string, number>;
    originalGroups: readonly BLGroup[];
}
/**
 * Pure transform: returns a new ParsedBoxesAndLines with collapsed groups
 * removed from the diagram content.
 *
 * - Children of collapsed groups removed from nodes
 * - Edges redirected: endpoints in collapsed groups → group ID
 * - Internal edges (both in same collapsed group) dropped
 * - Duplicate edges (same source, target, label) deduplicated
 * - Collapsed groups removed from groups[] (layout handles as nodes)
 */
declare function collapseBoxesAndLines(parsed: ParsedBoxesAndLines, collapsedGroups: Set<string>): BLCollapseResult;

/** Closed shape lexicon — rectangle is the default and never written. */
declare const SKETCH_SHAPE_KINDS: readonly ["rectangle", "database", "queue", "person", "document", "note"];
type SketchShapeKind = (typeof SKETCH_SHAPE_KINDS)[number];
/** Half-slot lattice position (spec §31.3). Box children are box-relative. */
interface SketchAt {
    readonly c: number;
    readonly r: number;
}
interface SketchNode {
    /** Synthetic stable id (parse-order); use alias/label indexes to resolve. */
    readonly id: string;
    readonly label: string;
    readonly alias?: string;
    readonly shape: SketchShapeKind;
    /** null → flow auto-place at layout */
    readonly at: SketchAt | null;
    /** tag metadata only (shape/at/alias are lifted out) */
    readonly metadata: Record<string, string>;
    /** Free-text markdown description (indented `>` lines under the shape).
     *  Newline-joined; a small markdown subset renders in the card body. */
    readonly description?: string;
    /** owning box label (undefined = root) */
    readonly boxLabel?: string;
    readonly lineNumber: number;
}
type SketchEdgeHeads = 'one' | 'both' | 'none';
interface SketchEdge {
    readonly sourceId: string;
    readonly targetId: string;
    readonly label?: string;
    readonly heads: SketchEdgeHeads;
    /** dashed = "secondary", NOT async (spec §31.4 divergence note) */
    readonly dashed: boolean;
    readonly metadata: Record<string, string>;
    readonly lineNumber: number;
}
interface SketchBox {
    /** `[<normalized label>]` — the infra group-id scheme */
    readonly id: string;
    readonly label: string;
    readonly alias?: string;
    readonly at: SketchAt | null;
    readonly metadata: Record<string, string>;
    readonly collapsed: boolean;
    /** child node ids, declaration order */
    readonly children: readonly string[];
    /**
     * Child BOX ids, declaration order (decision #58 — sketch nests to depth 2,
     * matching boxes-and-lines §14). Empty on an inner box: depth 2 is the bound.
     */
    readonly childBoxes: readonly string[];
    /**
     * The box this box sits inside, or null at the top level. Membership lives on
     * the CHILD, the same shape `boxes-and-lines` uses (`parentGroup`) and the one
     * the sketch rebuild's canvas model arrived at independently — a tree cannot
     * express double membership, so this cannot either.
     */
    readonly parentBoxId: string | null;
    readonly lineNumber: number;
}
interface SketchOptions {
    readonly noLegend: boolean;
    /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
    readonly legendInline?: boolean;
    /** §1.9 fill family; undefined ⇒ canonical 25% tint. */
    readonly fillMode: 'solid' | 'outline' | undefined;
    /** `no-descriptions` directive (mindmap `hd` standard): hide the card
     *  metadata rows so each card is just its name. */
    readonly noDescriptions: boolean;
}
interface ParsedSketch {
    readonly type: 'sketch';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly nodes: readonly SketchNode[];
    readonly edges: readonly SketchEdge[];
    readonly boxes: readonly SketchBox[];
    readonly tagGroups: readonly TagGroup[];
    readonly options: SketchOptions;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}
declare function isSketchShapeKind(value: string): value is SketchShapeKind;

declare function parseSketch(content: string, palette?: PaletteColors): ParsedSketch;

/**
 * Emit DGMO source for a parsed sketch.
 *
 * The output re-parses to an equivalent scene (`sameSketch`) and raises no
 * diagnostics. It is not pretty-printed: this is the correctness emitter, whose
 * only reader is the parser. Presentation — stable aliases, ordering,
 * whitespace — is a separate job.
 */
declare function emitSketch(parsed: ParsedSketch): string;
interface CanonicalScene {
    title: string | null;
    options: string;
    tags: string;
    nodes: string[];
    boxes: string[];
    edges: string[];
}
/**
 * A scene reduced to what the PICTURE says, so two scenes that draw the same
 * thing compare equal. Ids and line numbers are dropped (they are parse
 * artifacts), sets are sorted (declaration order is not meaning), and edges are
 * keyed by resolved endpoint names rather than ids.
 */
declare function canonicalSketch(parsed: ParsedSketch): CanonicalScene;
/** True when two parses describe the same picture. */
declare function sameSketch(a: ParsedSketch, b: ParsedSketch): boolean;

interface SketchLayoutNode {
    readonly id: string;
    readonly label: string;
    readonly shape: SketchShapeKind;
    readonly metadata: Record<string, string>;
    readonly description?: string;
    readonly boxLabel?: string;
    readonly lineNumber: number;
    /** resolved ABSOLUTE half-slot origin */
    readonly slot: {
        c: number;
        r: number;
    };
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    /** set when this card is a folded box (draws the collapse-bar) */
    readonly isCollapsedBox?: boolean;
    readonly childCount?: number;
}
interface SketchLayoutBox {
    readonly id: string;
    readonly label: string;
    readonly metadata: Record<string, string>;
    readonly lineNumber: number;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly bandH: number;
}
interface SketchLayout {
    readonly nodes: readonly SketchLayoutNode[];
    readonly boxes: readonly SketchLayoutBox[];
    readonly edges: readonly SketchEdge[];
    readonly width: number;
    readonly height: number;
    /** layout-time warnings (overlap auto-resolution) */
    readonly diagnostics: readonly DgmoError[];
    /**
     * Half-slot origin actually subtracted to map slots → px. With
     * `normalizeOrigin` on this is the live min corner; with it off (frozen
     * origin) callers capture this on first layout and feed it back as
     * `frozenOrigin` so later edits don't re-shift the whole diagram.
     */
    readonly origin: {
        c: number;
        r: number;
    };
}
interface SketchLayoutOptions {
    /** Box labels to fold; defaults to the authored `collapsed` flags. */
    readonly collapsedBoxes?: ReadonlySet<string>;
    /**
     * Auto-layout stage switches. Every flag defaults to `true` (current
     * behavior) when omitted — turning one off makes the authored `at:`
     * coordinate more authoritative. Wired to the app's dev "Auto-layout"
     * drawer so a drag can be observed with each stage on or off.
     */
    readonly autoLayout?: SketchAutoLayoutFlags;
    /**
     * Stable origin (half-slots) to subtract when `normalizeOrigin` is off.
     * Never lets content go negative: the effective origin is
     * `min(frozenOrigin, liveMin)`, so a node dragged left of the frozen corner
     * simply expands it rather than escaping the viewport. Ignored when
     * `normalizeOrigin` is on. See `SketchLayout.origin`.
     */
    readonly frozenOrigin?: {
        c: number;
        r: number;
    };
}
interface SketchAutoLayoutFlags {
    /**
     * M1 — re-anchor the whole diagram to the min corner every render.
     * Off (the default) is the WYSIWYG frozen-origin behaviour; without a
     * `frozenOrigin` it still anchors to the live min, so stateless callers
     * render identically either way.
     */
    readonly normalizeOrigin?: boolean;
    /**
     * M2 — order root placement by declaration line. Off (the default) is
     * geometry-stable: authored-`at` units place in coordinate order
     * (row-major), flow units in reading order after them.
     */
    readonly sortRootsBySource?: boolean;
    /** M3 — bump a colliding authored slot to the nearest free slot. */
    readonly resolveOverlap?: boolean;
    /** M3 — treat a group as one collision rectangle (else its origin cell). */
    readonly groupCollisionAsRect?: boolean;
    /** Flow-place nodes that have no `at:` (root + box children). */
    readonly flowPlaceUnpositioned?: boolean;
    /**
     * M5 — nudge a FLOW-PLACED shape off any non-incident edge it crosses.
     * Authored-`at` shapes are always exempt: authored position wins over edge
     * aesthetics.
     */
    readonly avoidEdges?: boolean;
}
/**
 * The one set of defaults every caller shares — the WYSIWYG behaviour the
 * editor ships (frozen origin, geometry-stable root order). The app's dev
 * drawer reads this rather than keeping its own copy, so the two cannot
 * drift apart again (issue #174).
 */
declare const SKETCH_AUTO_LAYOUT_DEFAULTS: Required<SketchAutoLayoutFlags>;
declare function layoutSketch(parsed: Pick<ParsedSketch, 'nodes' | 'edges' | 'boxes'>, options?: SketchLayoutOptions): SketchLayout;

interface SketchRenderOptions {
    exportDims?: {
        width?: number;
        height?: number;
    };
    activeTagGroup?: string | null;
    exportMode?: boolean;
    onClickItem?: (lineNumber: number) => void;
    /** View-state `hd` (hide descriptions): drop each card's description so it
     *  is just its header/name — the standard mindmap toggle, shelf-driven. */
    hideDescriptions?: boolean;
    /** Render these cards with the header + empty-body split even without a
     *  description — the app's selected-card state, so the description area is
     *  visible to type into. */
    splitCardIds?: readonly string[];
}
declare function renderSketch(container: HTMLDivElement, parsed: ParsedSketch, layout: SketchLayout, palette: PaletteColors, isDark: boolean, options?: SketchRenderOptions): void;
interface SketchEdgeGeometry {
    sourceId: string;
    targetId: string;
    /** Pure cubic path — parsed as one cubic by label/bounds/hit-test consumers. */
    d: string;
    mid: {
        x: number;
        y: number;
    };
    /** Visible stroke path WITH crossing-hops, when this edge hops another. The
     *  renderer draws this if present; everything else still uses `d`. */
    dRender?: string;
}
/**
 * The full edge-routing pipeline (side assignment + curved paths + group-port
 * snapping) as a pure function, so the renderer AND the app`s live-drag preview
 * draw edges with IDENTICAL geometry. `offsets` shifts individual nodes/boxes
 * by live pixel deltas (a dragged shape and its box children) — pass none for
 * the committed layout.
 */
declare function sketchEdgeGeometry(layout: SketchLayout, offsets?: ReadonlyMap<string, {
    dx: number;
    dy: number;
}>): Array<SketchEdgeGeometry | null>;
/** Export wrapper — the b&l precedent (thin spread). */
declare function renderSketchForExport(container: HTMLDivElement, parsed: ParsedSketch, layout: SketchLayout, palette: PaletteColors, isDark: boolean, options?: {
    exportDims?: {
        width: number;
        height: number;
    };
    activeTagGroup?: string | null;
    exportMode?: boolean;
    hideDescriptions?: boolean;
}): void;

interface SketchCollapseResult {
    /** Visible shapes (collapsed boxes' children removed). */
    readonly nodes: readonly SketchNode[];
    /** Boxes still rendered as frames (the expanded ones). */
    readonly boxes: readonly SketchBox[];
    /** Collapsed boxes — each renders as one virtual node card. */
    readonly virtualBoxes: readonly SketchBox[];
    /** Edges with endpoints re-targeted to virtual boxes; deduped. */
    readonly edges: readonly SketchEdge[];
    /** box label → immediate child count (for the collapse-bar affordance). */
    readonly collapsedChildCounts: ReadonlyMap<string, number>;
}
/**
 * @param collapsedLabels box LABELS to fold. Defaults to the authored
 *   `collapsed` flags; the app/viewState passes an explicit set instead
 *   (interactive-vs-export split — options win when supplied).
 */
declare function collapseSketch(parsed: Pick<ParsedSketch, 'nodes' | 'edges' | 'boxes'>, collapsedLabels?: ReadonlySet<string>): SketchCollapseResult;

declare const SKETCH_GEOMETRY: {
    /** px per grid cell (the dot-grid pitch) */
    readonly cellPx: 16;
    /** universal footprint width, in grid cells */
    readonly footprintCellsW: 8;
    /**
     * Legacy — the gap is now a derived half-unit (footprint/2 per axis), not
     * these cell counts. Kept only so the shape of SKETCH_GEOMETRY is stable.
     */
    readonly gapCellsX: 4;
    readonly gapCellsY: 4;
    /** box reserved top band, px (spec decision 12) */
    readonly bandPx: 28;
    /** box frame padding around the children bbox, px */
    readonly boxPadPx: 16;
    /** edge-ring (connect hook) width as a fraction of footprint height */
    readonly ringFrac: 0.22;
};
/** Footprint width, px — 128 at the default cell (`cellPx` 16 x `footprintCellsW` 8). */
declare const SKETCH_FOOT_W: number;
/**
 * Footprint height, px — the ONE universal size (spec §31.2). Every shape is a
 * golden-ratio landscape box: height ≈ width / φ, forced EVEN so half the
 * height is a whole pixel (the vertical half-unit). At the default cell,
 * 128/φ = 79.1 → 80 (ratio 1.6). Uniform: every shape draws to exactly
 * SKETCH_FOOT_W × SKETCH_FOOT_H. The org-card body (header + rule + ~4 rows)
 * fits within it.
 *
 * ⚠️ The figures here follow `cellPx`, so they are pinned by
 * `tests/sketch-geometry-constants.test.ts` rather than trusted — this docblock
 * described a 208 × 128 footprint until 2026-08-29, long after the cell
 * changed, and that stale figure was copied into the app and the tech spec.
 */
declare const SKETCH_FOOT_H: number;
/**
 * Horizontal half-unit pitch, px: HALF a footprint (64 at the default cell).
 * This is the dot grid, and it is what ONE AUTHORED `at:` UNIT IS WORTH here —
 * `sketchSlotToPx` and `layout.ts` both multiply by it. A footprint is 2 of
 * these wide, so its left/right edges both land on dots.
 *
 * 🔴 The desktop canvas agrees, as of 2026-08-30 (#571). It read one unit as
 * half a SLOT (96) for four days, so the same `at:` value meant different
 * pixels in the two and a canvas-authored file laid out here with
 * `W_SKETCH_OVERLAP_RESOLVED` — invisibly, because the resolver's "nearest free
 * slot" happens to land where the canvas intended on a plain row. Its
 * `AT_UNIT_X` is this constant now, and its `slotToPx` calls `sketchSlotToPx`
 * rather than restating the multiplication, so a future divergence is a change
 * to this file that both sides compile against.
 */
declare const SKETCH_HALF_SLOT_X: number;
/** Vertical half-unit pitch, px: half a footprint (40 at the default cell). */
declare const SKETCH_HALF_SLOT_Y: number;
/**
 * Minimum origin separation in half-units. A footprint spans 2 half-units and
 * the mandatory gap adds 1 more, so each shape claims a SEP×SEP (3×3) collision
 * block (unitRect in layout.ts); two shapes collide when their blocks overlap.
 * At exactly SEP apart the gap between footprints == one half-unit.
 */
declare const SKETCH_SEP = 3;
/**
 * Full-slot pitch, px: footprint + gap (== SKETCH_SEP half-units). The
 * origin-to-origin distance between two edge-adjacent shapes — 192 × 120 at
 * the default cell, leaving 64 × 40 of clear air between two footprints.
 *
 * That clear air is what `JOIN_REACH` in the canvas is (#560), which is why it
 * is a lattice quantity rather than a tuned number.
 */
declare const SKETCH_SLOT_X: number;
declare const SKETCH_SLOT_Y: number;
/** Slot → px (origin of the footprint), before any canvas padding. */
declare function sketchSlotToPx(c: number, r: number): {
    x: number;
    y: number;
};

interface FocusTarget {
    readonly kind: 'box' | 'group';
    /** Canonical endpoint key the parser uses for edges: a node label for a box,
     *  or `__group_<label>` for a group. */
    readonly id: string;
}
interface FocusResult {
    /** Filtered model to lay out + render (neighbour groups already collapsed via
     *  `collapseBoxesAndLines`). */
    readonly parsed: ParsedBoxesAndLines;
    /** Canonical keys of the 1-hop neighbours kept in view (box labels +
     *  `__group_<label>` for neighbour groups). */
    readonly neighborIds: Set<string>;
    /** Group LABELS of neighbours rendered collapsed. */
    readonly collapsedNeighborGroupIds: Set<string>;
    /** GLOBAL value-ramp domain computed from the ORIGINAL model before filtering
     *  (Decision 20 / FM1); null when the diagram has no `heat:` data. */
    readonly rampDomain: {
        min: number;
        max: number;
    } | null;
    /** Collapse metadata for `layoutBoxesAndLines` so neighbour groups materialise
     *  as collapsed boxes — mirrors the manual-collapse path's `collapseInfo`. */
    readonly collapseInfo: {
        collapsedChildCounts: Map<string, number>;
        originalGroups: readonly BLGroup[];
    };
}
/**
 * Filter `parsed` to the focused element + its 1-hop neighbours.
 *
 * Pure, synchronous, no I/O. Tolerant of dangling/alias endpoints (skips them,
 * never throws). For an edge-less target it returns the lone element (the app
 * decides the "no connections" affordance, Decision 19).
 */
declare function focusBoxesAndLines(parsed: ParsedBoxesAndLines, target: FocusTarget): FocusResult;

/**
 * v1 node vocabulary (closed). Inclusive (`<o>`) and event-based (`<*>`)
 * gateways are fast-follow — they parse to an `E_SWIMLANE_UNSUPPORTED`
 * diagnostic, never to a shape here.
 */
type SwimShape = 'task' | 'exclusive' | 'parallel' | 'terminal' | 'subprocess';
/**
 * v1 terminal/event typing (closed). Timer/message/signal are fast-follow and
 * emit `E_SWIMLANE_UNSUPPORTED`.
 */
type SwimEvent = 'none' | 'error' | 'success' | 'terminate';
type SwimDirection = 'LR' | 'TB';
/** A declared lane (row in LR / column in TB), occupant-neutral. */
interface SwimLane {
    readonly id: string;
    readonly label: string;
    /** Resolved hex color (from the trailing §1.5 color token), if any. */
    readonly color?: string;
    readonly lineNumber: number;
}
/** A declared phase column (`[Phase]`). */
interface SwimPhase {
    readonly id: string;
    readonly label: string;
    readonly lineNumber: number;
}
interface SwimNode {
    /** Canonical (display) name — globally unique. */
    readonly id: string;
    readonly label: string;
    readonly shape: SwimShape;
    /** Lane id this node belongs to. */
    readonly lane: string;
    /** Phase id, if declared under a `[Phase]`. */
    readonly phase?: string;
    /** Terminal/event type (only meaningful for `terminal` shapes). */
    readonly event: SwimEvent;
    /** Explicit trailing color token, if any (raw recognized name). */
    readonly color?: string;
    /** Same-line `key: value` metadata (tag-group values). */
    readonly tags: Readonly<Record<string, string>>;
    readonly lineNumber: number;
}
interface SwimEdge {
    readonly source: string;
    readonly target: string;
    /** In-arrow label (`-invalid->`), if any. */
    readonly label?: string;
    readonly lineNumber: number;
}
interface ParsedSwimlane {
    readonly title?: string;
    readonly titleLineNumber?: number;
    readonly direction: SwimDirection;
    /** Lanes in declaration order. */
    readonly lanes: readonly SwimLane[];
    /** Phases in declaration order (empty for a 2-deep, phase-less diagram). */
    readonly phases: readonly SwimPhase[];
    readonly nodes: readonly SwimNode[];
    readonly edges: readonly SwimEdge[];
    readonly tagGroups: readonly TagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error?: string | null;
}
/**
 * A laid-out band (lane or phase). Top-left origin (mirrors `LayoutGroup`),
 * NOT center origin.
 */
interface LayoutBand {
    readonly id: string;
    readonly label: string;
    /** Resolved hex color (lanes only); phases are neutral. */
    readonly color?: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /**
     * Thickness of the label gutter (left for lanes, top for phases, in LR;
     * transposed in TB). The renderer reserves this for the band label.
     */
    readonly headerSize: number;
    readonly lineNumber: number;
}
interface SwimLayoutNode {
    readonly id: string;
    readonly label: string;
    readonly shape: SwimShape;
    readonly event: SwimEvent;
    readonly lane: string;
    readonly phase?: string;
    readonly color?: string;
    readonly tags: Readonly<Record<string, string>>;
    /** Center coordinates. */
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly lineNumber: number;
}
interface SwimLayoutEdge {
    readonly source: string;
    readonly target: string;
    readonly label?: string;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
    /** True for a routed loop / back-edge (drawn dashed). */
    readonly back: boolean;
    readonly lineNumber: number;
}
interface SwimlaneLayoutResult {
    readonly nodes: readonly SwimLayoutNode[];
    readonly edges: readonly SwimLayoutEdge[];
    readonly lanes: readonly LayoutBand[];
    readonly phases: readonly LayoutBand[];
    readonly width: number;
    readonly height: number;
}

declare function parseSwimlane(content: string, palette?: PaletteColors): ParsedSwimlane;

declare function layoutSwimlane(parsed: ParsedSwimlane): SwimlaneLayoutResult;

interface SwimlaneRenderOptions {
    exportDims?: {
        width: number;
        height: number;
    };
    activeTagGroup?: string | null;
    exportMode?: boolean;
}
declare function renderSwimlaneForExport(container: HTMLElement, parsed: ParsedSwimlane, layout: SwimlaneLayoutResult, palette: PaletteColors, isDark: boolean, opts?: SwimlaneRenderOptions): void;

/** Recognized sex values (drives node color). `unknown` = no `sex:` key. */
type FamilySex = 'm' | 'f' | 'unknown';
/**
 * A person — identity is the normalized name. Declared standalone (with full
 * metadata) or first seen inside a union / as a child; later mentions merge
 * into the same person. Metadata lives ONLY on person lines (never per-side on
 * a union line — that form is unsupported).
 */
interface FamilyPerson {
    /** Canonical (display) name — globally unique after name-normalization. */
    readonly id: string;
    readonly label: string;
    /** Resolved from the `sex:` key (`unknown` when unset). */
    readonly sex: FamilySex;
    /** Fixed-key metadata in declaration order (b, d, bp, dp, occupation, …). */
    readonly metadata: Readonly<Record<string, string>>;
    /** Explicit trailing/inline color (raw recognized name), if any — overrides sex color. */
    readonly color?: string;
    /** Tag-group values applied to this person (`{ concern: 'royal' }`). */
    readonly tagMetadata: Readonly<Record<string, string>>;
    /** True when this person is an anonymous `?` placeholder (unmerged, muted card). */
    readonly placeholder?: boolean;
    readonly lineNumber: number;
}
/** One child of a union / single parent. */
interface FamilyChild {
    /** Person id of the child. */
    readonly personId: string;
    /** True when the child line carried the bare `adopted` token (dashed edge). */
    readonly adopted: boolean;
}
/**
 * A union — a couple (1 or 2 parents) whose children are declared indented
 * beneath. A single parent is a union with exactly one parent. `metadata.m`
 * holds the marriage year (there is NO separate `marriageYear` field).
 */
interface FamilyUnion {
    /** Stable synthetic id (declaration order). */
    readonly id: string;
    /** 1–2 parent person ids. */
    readonly parents: readonly string[];
    /** Union-level metadata — only `m` (marriage year) is recognized. */
    readonly metadata: Readonly<Record<string, string>>;
    readonly children: readonly FamilyChild[];
    /** True when the union line carried the bare `divorced` token (dashed bar). */
    readonly divorced?: boolean;
    readonly lineNumber: number;
}
interface ParsedFamily {
    readonly title?: string;
    readonly titleLineNumber?: number;
    /** Persons keyed by normalized id, in first-seen declaration order via `.values()`. */
    readonly persons: ReadonlyMap<string, FamilyPerson>;
    readonly unions: readonly FamilyUnion[];
    readonly tagGroups: readonly TagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    /** Set (fatal) on an ancestry cycle — the renderer bails before layout. */
    readonly error?: string | null;
}
/** A laid-out person card. Top-left origin (mirrors org's `LayoutNode`). */
interface FamilyLayoutNode {
    readonly id: string;
    readonly label: string;
    readonly sex: FamilySex;
    readonly metadata: Readonly<Record<string, string>>;
    readonly color?: string;
    readonly tagMetadata: Readonly<Record<string, string>>;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Assigned generation row (0 = top). */
    readonly row: number;
    /** Anonymous `?` placeholder — renderer draws a faint, solid-bordered, name-only card. */
    readonly placeholder?: boolean;
    /** Outside the `highlight` person's bloodline — renderer draws it faded. */
    readonly dimmed?: boolean;
    readonly lineNumber: number;
}
/** A horizontal marriage bar joining two spouse cards on one row. */
interface FamilyMarriageBar {
    readonly unionId: string;
    /** Bar endpoints (always horizontal — spouses share a row). */
    readonly x1: number;
    readonly x2: number;
    readonly y: number;
    /** Midpoint (child bus drops from here). */
    readonly midX: number;
    /** Center of the visible gap between the cards — where the `m.` label sits
     * (offset from midX when the two cards differ in width, so the label never
     * tucks under the wider card). */
    readonly labelX: number;
    /** Marriage year (`metadata.m`), if any — drawn at the label position. */
    readonly year?: string;
    /** Dissolved union (`divorced` token) — renderer draws a dashed bar. */
    readonly divorced?: boolean;
    /** Outside the `highlight` bloodline — renderer draws it faded. */
    readonly dimmed?: boolean;
    readonly lineNumber: number;
}
/** A child drop edge (org bus-edge pattern: trunk + bar + per-child drops). */
interface FamilyChildEdge {
    readonly unionId: string;
    readonly childId: string;
    /** Polyline points from the union anchor to the child card top. */
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
    /** Adopted children render a dashed drop. */
    readonly adopted: boolean;
    /** Outside the `highlight` bloodline — renderer draws it faded. */
    readonly dimmed?: boolean;
}
/** A collapsed ancestor shown as a small labeled dot above the focused card. */
interface FamilyAncestorDot {
    readonly id: string;
    readonly label: string;
    readonly sex: FamilySex;
    readonly color?: string;
    readonly x: number;
    readonly y: number;
}
interface FamilyLayoutResult {
    readonly nodes: readonly FamilyLayoutNode[];
    readonly bars: readonly FamilyMarriageBar[];
    readonly edges: readonly FamilyChildEdge[];
    /** Focus mode: the focused person's parents, drawn as dots above their card. */
    readonly ancestors: readonly FamilyAncestorDot[];
    /** Top-center of the focused card, for the ancestor-trail connector. */
    readonly focusAnchor?: {
        readonly x: number;
        readonly y: number;
    };
    /** Per-occupied-row bands (for the `generations` gutter labels). */
    readonly rows: readonly {
        readonly row: number;
        readonly y: number;
        readonly height: number;
    }[];
    readonly width: number;
    readonly height: number;
}

declare function parseFamily(content: string, palette?: PaletteColors): ParsedFamily;

declare function layoutFamily(parsed: ParsedFamily, focusId?: string | null): FamilyLayoutResult;

interface FamilyRenderOptions {
    exportDims?: {
        width: number;
        height: number;
    };
    /**
     * App-preview display size (px). When set, the diagram is scaled to fit while
     * the title + legend stay at NATIVE size (always legible). Omit for export.
     */
    fit?: {
        width: number;
        height: number;
    };
    activeTagGroup?: string | null;
    exportMode?: boolean;
}
declare function renderFamilyForExport(container: HTMLElement, parsed: ParsedFamily, layout: FamilyLayoutResult, palette: PaletteColors, isDark: boolean, opts?: FamilyRenderOptions): void;
/** App-preview entry: scales the diagram to fit the container. */
declare function renderFamily(container: HTMLElement, parsed: ParsedFamily, layout: FamilyLayoutResult, palette: PaletteColors, isDark: boolean, opts?: FamilyRenderOptions): void;

interface SitemapNode {
    readonly id: string;
    readonly label: string;
    readonly metadata: Readonly<Record<string, string>>;
    readonly children: readonly SitemapNode[];
    readonly parentId: string | null;
    readonly description?: readonly string[];
    /** True for [Group Name] container nodes */
    readonly isContainer: boolean;
    readonly lineNumber: number;
    readonly color?: string;
}
interface SitemapEdge {
    readonly sourceId: string;
    readonly targetId: string;
    readonly label?: string;
    readonly lineNumber: number;
}
type SitemapDirection = 'TB' | 'LR';
interface ParsedSitemap {
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly direction: SitemapDirection;
    /** Top-level nodes (roots of the hierarchy) */
    readonly roots: readonly SitemapNode[];
    /** All cross-link edges */
    readonly edges: readonly SitemapEdge[];
    readonly tagGroups: readonly TagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

/**
 * Returns true if content looks like a sitemap diagram.
 * Heuristic: has `->` arrows AND `[Group]` containers but does NOT have
 * flowchart shape delimiters ((...), <...>, /.../) adjacent to arrows.
 */
declare function looksLikeSitemap(content: string): boolean;
declare function parseSitemap(content: string, palette?: PaletteColors): ParsedSitemap;

interface SitemapLayoutNode {
    readonly id: string;
    readonly label: string;
    readonly metadata: Readonly<Record<string, string>>;
    /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
    readonly tagMetadata: Readonly<Record<string, string>>;
    readonly description?: readonly string[];
    readonly isContainer: boolean;
    readonly lineNumber: number;
    readonly color?: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Count of hidden descendants when collapsed */
    readonly hiddenCount?: number;
    /** True if node has children (expanded or collapsed) — drives toggle UI */
    readonly hasChildren?: boolean;
}
interface SitemapLayoutEdge {
    readonly sourceId: string;
    readonly targetId: string;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
    readonly label?: string;
    readonly lineNumber: number;
    /** True for edges deferred from dagre (container endpoints) — use linear curve */
    readonly deferred?: boolean;
}
interface SitemapContainerBounds {
    readonly nodeId: string;
    readonly label: string;
    readonly lineNumber: number;
    readonly color?: string;
    readonly metadata: Readonly<Record<string, string>>;
    /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
    readonly tagMetadata: Readonly<Record<string, string>>;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly labelHeight: number;
    /** Count of hidden descendants when collapsed */
    readonly hiddenCount?: number;
    /** True if container has children (expanded or collapsed) */
    readonly hasChildren?: boolean;
}
interface SitemapLegendEntry {
    readonly value: string;
    readonly color: string;
}
interface SitemapLegendGroup {
    readonly name: string;
    readonly alias?: string;
    readonly entries: readonly SitemapLegendEntry[];
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly minifiedWidth: number;
    readonly minifiedHeight: number;
}
interface SitemapLayoutResult {
    readonly nodes: readonly SitemapLayoutNode[];
    readonly edges: readonly SitemapLayoutEdge[];
    readonly containers: readonly SitemapContainerBounds[];
    readonly legend: readonly SitemapLegendGroup[];
    readonly width: number;
    readonly height: number;
}
declare function layoutSitemap(parsed: ParsedSitemap, hiddenCounts?: Map<string, number>, activeTagGroup?: string | null, hiddenAttributes?: Set<string>, expandAllLegend?: boolean): SitemapLayoutResult;

declare function renderSitemap(container: HTMLDivElement, parsed: ParsedSitemap, layout: SitemapLayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, activeTagGroup?: string | null, hiddenAttributes?: Set<string>, exportMode?: boolean): void;
declare function renderSitemapForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette?: PaletteColors): Promise<string>;

interface CollapsedSitemapResult {
    /** ParsedSitemap with collapsed subtrees pruned (deep-cloned, never mutates original) */
    parsed: ParsedSitemap;
    /** nodeId → count of hidden descendants */
    hiddenCounts: Map<string, number>;
}
declare function collapseSitemapTree(original: ParsedSitemap, collapsedIds: Set<string>): CollapsedSitemapResult;

/** Namespaced behavior property keys recognized by the parser. */
type InfraBehaviorKey = 'cache-hit' | 'firewall-block' | 'ratelimit-rps' | 'latency-ms' | 'uptime' | 'instances' | 'max-rps' | 'cb-error-threshold' | 'cb-latency-threshold-ms' | 'concurrency' | 'duration-ms' | 'cold-start-ms' | 'buffer' | 'drain-rate' | 'retention-hours' | 'partitions';
/**
 * All recognized property keys (behavior + structural). Derived from the
 * single-source directives registry — do NOT re-list literals here.
 */
declare const INFRA_BEHAVIOR_KEYS: ReadonlySet<string>;
interface InfraProperty {
    readonly key: string;
    readonly value: string | number;
    readonly lineNumber: number;
}
interface InfraNode {
    readonly id: string;
    readonly label: string;
    readonly properties: readonly InfraProperty[];
    readonly groupId: string | null;
    readonly tags: Readonly<Record<string, string>>;
    readonly isEdge: boolean;
    readonly description?: readonly string[];
    readonly lineNumber: number;
}
interface InfraEdge {
    readonly sourceId: string;
    readonly targetId: string;
    readonly label: string;
    readonly async: boolean;
    readonly split: number | null;
    readonly fanout: number | null;
    readonly lineNumber: number;
}
interface InfraGroup {
    readonly id: string;
    readonly label: string;
    /** Number of instances (or auto-scaling range "N-M") of this group as a unit. */
    readonly instances?: number | string;
    /** Whether this group should be collapsed by default in the source. */
    readonly collapsed?: boolean;
    /** Pipe metadata on the group header, cascaded to children. */
    readonly metadata?: Readonly<Record<string, string>>;
    readonly lineNumber: number;
}
interface InfraTagValue {
    readonly name: string;
    readonly color?: string;
}
interface InfraTagGroup {
    readonly name: string;
    readonly alias: string | null;
    readonly values: readonly InfraTagValue[];
    /** Value of the entry marked `default` (nodes without this tag get it automatically). */
    readonly defaultValue?: string;
    readonly lineNumber: number;
}
interface ParsedInfra {
    readonly type: 'infra';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly direction: 'LR' | 'TB';
    readonly nodes: readonly InfraNode[];
    readonly edges: readonly InfraEdge[];
    readonly groups: readonly InfraGroup[];
    readonly tagGroups: readonly InfraTagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}
interface InfraComputeParams {
    rps?: number;
    instanceOverrides?: Record<string, number>;
    /** Per-node property overrides: nodeId -> { propertyKey: numericValue }. */
    propertyOverrides?: Record<string, Record<string, number>>;
    /** Set of group IDs that should be treated as collapsed (virtual nodes). */
    collapsedGroups?: Set<string>;
}
type InfraCbState = 'closed' | 'open' | 'half-open';
interface ComputedInfraNode {
    id: string;
    label: string;
    groupId: string | null;
    isEdge: boolean;
    computedRps: number;
    overloaded: boolean;
    /** True when inbound RPS exceeds the node's ratelimit-rps and traffic is being shed. */
    rateLimited: boolean;
    /** Cumulative latency from edge to this node (ms). */
    computedLatencyMs: number;
    /** Latency percentiles from this node through all downstream paths (ms). */
    computedLatencyPercentiles: InfraLatencyPercentiles;
    /** Component uptime (product of uptimes along path, 0-1). */
    computedUptime: number;
    /** Local availability at this node (0-1), factoring in uptime, overload shed, and rate-limit reject. */
    computedAvailability: number;
    /** Availability percentiles through all downstream paths from this node (0-1 fractions). */
    computedAvailabilityPercentiles: InfraAvailabilityPercentiles;
    /** Circuit breaker state. */
    computedCbState: InfraCbState;
    /** Computed instance count for auto-scaling (min-max) ranges. */
    computedInstances: number;
    /** For serverless nodes: estimated concurrent invocations (Little's Law: RPS × duration_ms / 1000). */
    computedConcurrentInvocations: number;
    /** For collapsed group virtual nodes: worst health state of any child.
     *  'overloaded' > 'warning' > 'normal'. Undefined for regular nodes. */
    childHealthState?: 'normal' | 'warning' | 'overloaded';
    /** Queue metrics — only present when buffer property exists. */
    queueMetrics?: {
        /** Messages per second filling the buffer (inbound - drain-rate, clamped to 0). */
        fillRate: number;
        /** Seconds until buffer overflow at sustained fill rate. Infinity if not filling. */
        timeToOverflow: number;
        /** Queue wait time in ms (pending_messages / drain_rate * 1000). */
        waitTimeMs: number;
    };
    properties: InfraProperty[];
    tags: Record<string, string>;
    description?: string[];
    lineNumber: number;
}
interface ComputedInfraEdge {
    sourceId: string;
    targetId: string;
    label: string;
    async: boolean;
    computedRps: number;
    split: number;
    fanout: number | null;
    lineNumber: number;
}
interface InfraDiagnostic {
    type: 'SPLIT_SUM' | 'CYCLE' | 'OVERLOAD' | 'RATE_LIMITED' | 'ORPHAN' | 'SYNTAX' | 'UPTIME';
    line: number;
    message: string;
}
interface InfraLatencyPercentiles {
    p50: number;
    p90: number;
    p99: number;
}
interface InfraAvailabilityPercentiles {
    p50: number;
    p90: number;
    p99: number;
}
interface ComputedInfraModel {
    nodes: ComputedInfraNode[];
    edges: ComputedInfraEdge[];
    groups: InfraGroup[];
    tagGroups: InfraTagGroup[];
    title: string | null;
    direction: 'LR' | 'TB';
    /** Diagram-level options (e.g., default-latency-ms, default-uptime). */
    options: Record<string, string>;
    /** Latency percentiles at the edge entry point (weighted by traffic probability). */
    edgeLatency: InfraLatencyPercentiles;
    /** System uptime at edge (weighted average across all paths). */
    systemUptime: number;
    /** System availability at edge (weighted average of compound availability across all paths). */
    systemAvailability: number;
    diagnostics: InfraDiagnostic[];
}

declare function parseInfra(content: string): ParsedInfra;

declare function extractSymbols(docText: string): DiagramSymbols;

declare function computeInfra(parsed: ParsedInfra, params?: InfraComputeParams): ComputedInfraModel;

declare function validateInfra(parsed: ParsedInfra): InfraDiagnostic[];
/**
 * Validate computed model (post-computation warnings).
 * Call after computeInfra() to get uptime/SLA warnings.
 */
declare function validateComputed(computed: ComputedInfraModel): InfraDiagnostic[];

interface InfraLayoutNode {
    readonly id: string;
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly computedRps: number;
    readonly overloaded: boolean;
    readonly rateLimited: boolean;
    readonly isEdge: boolean;
    readonly groupId: string | null;
    readonly computedLatencyMs: number;
    readonly computedLatencyPercentiles: ComputedInfraNode['computedLatencyPercentiles'];
    readonly computedUptime: number;
    readonly computedAvailability: number;
    readonly computedAvailabilityPercentiles: ComputedInfraNode['computedAvailabilityPercentiles'];
    readonly computedInstances: number;
    readonly computedConcurrentInvocations: number;
    readonly computedCbState: ComputedInfraNode['computedCbState'];
    readonly childHealthState?: ComputedInfraNode['childHealthState'];
    readonly properties: ComputedInfraNode['properties'];
    readonly queueMetrics?: ComputedInfraNode['queueMetrics'];
    readonly tags: Readonly<Record<string, string>>;
    readonly description?: readonly string[];
    readonly lineNumber: number;
}
interface InfraLayoutEdge {
    readonly sourceId: string;
    readonly targetId: string;
    readonly label: string;
    readonly async: boolean;
    readonly computedRps: number;
    readonly split: number;
    readonly fanout: number | null;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
    readonly lineNumber: number;
}
interface InfraLayoutGroup {
    readonly id: string;
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly instances?: number | string;
    readonly lineNumber: number;
}
interface InfraLayoutResult {
    readonly nodes: readonly InfraLayoutNode[];
    readonly edges: readonly InfraLayoutEdge[];
    readonly groups: readonly InfraLayoutGroup[];
    /** Diagram-level options (e.g., default-latency-ms, default-uptime). */
    readonly options: Readonly<Record<string, string>>;
    readonly direction: 'LR' | 'TB';
    readonly width: number;
    readonly height: number;
}
declare function layoutInfra(computed: ComputedInfraModel, expandedNodeIds?: Set<string> | null, collapsedNodes?: Set<string> | null): InfraLayoutResult;

/** Semantic palette slot a role's badge is painted from. */
type RoleColorToken = keyof PaletteColors['colors'];
interface InfraRole {
    name: string;
    /**
     * Palette slot, NOT a hex. These were eight raw Tailwind hues until
     * 2026-08-28, so a role dot kept its own colours under every palette and
     * in dark mode. The renderer resolves the token against the live palette.
     */
    colorToken: RoleColorToken;
}
/**
 * Infer roles from a component's properties.
 * A component can have multiple roles (e.g., Cache + Rate Limiter).
 */
declare function inferRoles(properties: InfraProperty[]): InfraRole[];
/**
 * Collect all unique roles present in the diagram (for legend).
 */
declare function collectDiagramRoles(allProperties: InfraProperty[][]): InfraRole[];

interface InfraLegendEntry {
    value: string;
    color: string;
    /** For role: kebab-case role name. For tag: lowercase tag value. */
    key: string;
}
interface InfraLegendGroup {
    name: string;
    type: 'role' | 'tag';
    /** For tag groups: the key used in data-tag-* attributes (alias or name). */
    tagKey?: string;
    entries: InfraLegendEntry[];
    width: number;
    minifiedWidth: number;
}
/** Build legend groups from roles + tags. */
declare function computeInfraLegendGroups(nodes: readonly InfraLayoutNode[], tagGroups: readonly InfraTagGroup[], palette: PaletteColors, edges?: readonly InfraLayoutEdge[]): InfraLegendGroup[];
interface InfraPlaybackState {
    expanded: boolean;
    paused: boolean;
    speed: number;
    speedOptions: readonly number[];
}
declare function renderInfra(container: HTMLDivElement, layout: InfraLayoutResult, palette: PaletteColors, isDark: boolean, title: string | null, titleLineNumber: number | null, tagGroups?: readonly InfraTagGroup[], activeGroup?: string | null, animate?: boolean, playback?: InfraPlaybackState | null, expandedNodeIds?: Set<string> | null, exportMode?: boolean, collapsedNodes?: Set<string> | null, 
/** When 'app', the playback pill is suppressed and a controls row + anchor are
 *  reserved for the app overlay strip (play/pause + speed live there). */
controlsHost?: 'app' | 'inline'): void;
declare function parseAndLayoutInfra(content: string): {
    parsed: ParsedInfra;
    computed: null;
    layout: null;
} | {
    parsed: ParsedInfra;
    computed: ComputedInfraModel;
    layout: InfraLayoutResult;
};

/** Calendar units: d (days), w (weeks), m (months), q (quarters), y (years), h (hours), min (minutes). bd = business days. s = sprints. */
type DurationUnit = 'd' | 'bd' | 'w' | 'm' | 'q' | 'y' | 'h' | 'min' | 's';
interface Duration {
    amount: number;
    unit: DurationUnit;
}
interface Offset {
    duration: Duration;
    direction: 1 | -1;
}
interface GanttDependency {
    readonly targetName: string;
    readonly label?: string;
    readonly offset?: Offset;
    readonly lineNumber: number;
}
interface GanttTask {
    readonly id: string;
    readonly label: string;
    readonly duration: Duration | null;
    readonly explicitStart?: string;
    readonly uncertain: boolean;
    readonly progress: number | null;
    readonly offset?: Offset;
    readonly isDefinition: boolean;
    readonly dependencies: readonly GanttDependency[];
    readonly metadata: Readonly<Record<string, string>>;
    readonly lineNumber: number;
    readonly groupPath: readonly string[];
    readonly comment?: string;
}
interface GanttGroup {
    readonly name: string;
    readonly color: string | null;
    readonly metadata: Readonly<Record<string, string>>;
    readonly offset?: Offset;
    readonly collapsed?: boolean;
    readonly lineNumber: number;
    readonly children: readonly GanttNode[];
}
interface GanttParallelBlock {
    readonly kind: 'parallel';
    readonly lineNumber: number;
    readonly children: readonly GanttNode[];
}
/** A node in the gantt tree: either a task, group, or parallel block. */
type GanttNode = ({
    kind: 'task';
} & GanttTask) | ({
    kind: 'group';
} & GanttGroup) | GanttParallelBlock;
type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
interface HolidayDate {
    readonly date: string;
    readonly label: string;
    readonly lineNumber: number;
}
interface HolidayRange {
    readonly startDate: string;
    readonly endDate: string;
    readonly label: string;
    readonly lineNumber: number;
}
interface GanttHolidays {
    readonly dates: readonly HolidayDate[];
    readonly ranges: readonly HolidayRange[];
    readonly workweek: readonly Weekday[];
}
interface GanttEra {
    readonly startDate: string;
    readonly endDate: string;
    readonly label: string;
    readonly color: string | null;
    readonly lineNumber: number;
    readonly offsetStart?: Offset;
    readonly offsetEnd?: Offset;
}
interface GanttMarker {
    readonly date: string;
    readonly label: string;
    readonly color: string | null;
    readonly lineNumber: number;
    readonly offsetDate?: Offset;
}
interface GanttOptions {
    start: string | null;
    title: string | null;
    titleLineNumber: number | null;
    todayMarker: 'off' | 'on' | string;
    criticalPath: boolean;
    dependencies: boolean;
    sort: 'default' | 'tag';
    defaultSwimlaneGroup: string | null;
    activeTag: string | null;
    /** Line numbers for option/block keywords — maps key to source line */
    optionLineNumbers: Record<string, number>;
    holidaysLineNumber: number | null;
    sprintLength: Duration | null;
    sprintNumber: number | null;
    sprintStart: string | null;
    sprintMode: 'auto' | 'explicit' | null;
    /** When true, render bars at full intent saturation instead of the canonical 25% tint. */
    /** §1.9 fill family; undefined ⇒ canonical 25% tint. */
    fillMode: 'solid' | 'outline' | undefined;
    /** When true, the renderer suppresses the chart banner title. */
    noTitle: boolean;
    /** §1.9 `no-legend` — suppress the tag legend and collapse its reserved band. */
    noLegend: boolean;
    /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
    legendInline?: boolean;
}
interface ParsedGantt {
    readonly nodes: readonly GanttNode[];
    readonly holidays: GanttHolidays;
    readonly tagGroups: readonly TagGroup[];
    readonly eras: readonly GanttEra[];
    readonly markers: readonly GanttMarker[];
    readonly options: GanttOptions;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
    readonly syntaxMode: 'new' | 'legacy';
}
interface ResolvedTask {
    task: GanttTask;
    startDate: Date;
    endDate: Date;
    isCriticalPath: boolean;
    isUncertain: boolean;
    isMilestone: boolean;
    groupPath: string[];
    effectiveMetadata: Record<string, string>;
}
interface ResolvedGroup$1 {
    name: string;
    color: string | null;
    metadata: Record<string, string>;
    startDate: Date;
    endDate: Date;
    progress: number | null;
    lineNumber: number;
    depth: number;
    collapsed?: boolean;
}
interface ResolvedSprint {
    number: number;
    startDate: Date;
    endDate: Date;
}
interface ResolvedSchedule {
    tasks: ResolvedTask[];
    groups: ResolvedGroup$1[];
    startDate: Date;
    endDate: Date;
    holidays: GanttHolidays;
    tagGroups: TagGroup[];
    eras: GanttEra[];
    markers: GanttMarker[];
    sprints: ResolvedSprint[];
    options: GanttOptions;
    diagnostics: DgmoError[];
    error: string | null;
}

declare function parseGantt(content: string, palette?: PaletteColors): ParsedGantt;

declare function calculateSchedule(parsed: ParsedGantt): ResolvedSchedule;

interface GanttInteractiveOptions {
    onClickItem?: (lineNumber: number) => void;
    collapsedGroups?: Set<string>;
    onToggleGroup?: (groupName: string) => void;
    currentSwimlaneGroup?: string | null;
    onSwimlaneChange?: (group: string | null) => void;
    currentActiveGroup?: string | null;
    onActiveGroupChange?: (group: string | null) => void;
    collapsedLanes?: Set<string>;
    onToggleLane?: (laneName: string) => void;
    viewMode?: boolean;
    exportMode?: boolean;
    /**
     * Where the Critical Path / Dependencies controls are hosted. Default
     * `'inline'` draws the gear pill inside the SVG legend. `'app'` suppresses
     * the inline gear so the desktop app can surface the same toggles in its
     * unified ControlsStrip ("settings pull-down tab"); the toggle state is then
     * driven by `criticalPathActive`/`dependenciesActive` below (re-render on
     * change), matching every other ControlsStrip-hosted chart type.
     */
    controlsHost?: 'app' | 'inline';
    /** Initial Critical Path highlight state (used when `controlsHost` is `'app'`). */
    criticalPathActive?: boolean;
    /** Initial Dependencies-arrow visibility (used when `controlsHost` is `'app'`). */
    dependenciesActive?: boolean;
}
declare function renderGantt(container: HTMLDivElement, resolved: ResolvedSchedule, palette: PaletteColors, isDark: boolean, options?: GanttInteractiveOptions, exportDims?: D3ExportDimensions): void;
type GroupRow = {
    type: 'group';
    group: ResolvedGroup$1;
};
type TaskRow = {
    type: 'task';
    task: ResolvedTask;
};
type LaneHeaderRow = {
    type: 'lane-header';
    laneName: string;
    laneColor: string;
    aggregateProgress: number | null;
    tagKey: string;
    isCollapsed: boolean;
    laneStartDate: Date | null;
    laneEndDate: Date | null;
};
type Row = GroupRow | TaskRow | LaneHeaderRow;

declare function buildTagLaneRowList(resolved: ResolvedSchedule, swimlaneGroup: string, collapsedLanes?: Set<string>): Row[] | null;

interface ResolverMatch {
    task: GanttTask;
}
interface ResolverError {
    kind: 'not_found' | 'ambiguous';
    message: string;
}
type ResolverResult = ResolverMatch | ResolverError;
/**
 * Collect all tasks from a tree of GanttNodes, annotating each with its
 * fully qualified group path (e.g., ["Backend", "API"]).
 */
declare function collectTasks(nodes: readonly GanttNode[]): GanttTask[];
declare function resolveTaskName(name: string, allTasks: GanttTask[]): ResolverResult;

/**
 * A three-point duration estimate. Each component is a parsed
 * `Duration { amount, unit }` so mixed units (`1w 2w 3m`) are
 * preserved; the analyzer normalizes to `options.timeUnit` for
 * arithmetic.
 */
interface DurationEstimate {
    o: Duration;
    m: Duration;
    p: Duration;
    /**
     * When true, only an M token was given on the source line and the
     * analyzer must expand O/P from confidence factors. When false, the
     * user wrote an explicit O M P triple (even when all three values
     * are equal — zero-variance is a valid, deterministic estimate).
     */
    mOnly: boolean;
}
/**
 * Per-activity layout-overrides shape — the diagrammo-app holds expansion
 * state in its own store and passes overrides to `relayoutPert`.
 */
type LayoutOverrides = Record<string, {
    width: number;
    height: number;
}>;

/** Layout direction. `LR` is the default; `TB` for tall chains. */
type PertDirection = 'LR' | 'TB';
/** `node-detail` directive value. */
type NodeDetail = 'compact' | 'full';
/**
 * Project schedule anchor. Mutually-exclusive at parse time:
 *   - `forward`  — `start-date YYYY-MM-DD` anchors source-activity ES.
 *   - `backward` — `end-date YYYY-MM-DD` anchors sink-activity LF.
 *   - `null`     — no anchor; ES/EF/LS/LF render as numeric offsets.
 */
type Anchor = {
    kind: 'forward';
    date: string;
} | {
    kind: 'backward';
    date: string;
} | null;
/** Diagram-level options collected by the parser. */
interface PertOptions {
    /** Time unit for μ/σ/ES/EF formatting and M-only heuristics. */
    timeUnit: Duration['unit'];
    /** `direction` directive. Defaults to `LR`. */
    direction: PertDirection;
    /** `node-detail` directive. Defaults to `compact`. */
    nodeDetail: NodeDetail;
    /**
     * Global confidence used to fill O/P from M-only durations.
     * Stored verbatim — analyzer applies `resolveConfidence()` to expand
     * named levels (`high`/`medium`/`low`) or `O/P` factor pairs.
     */
    confidence: string;
    /** Monte-Carlo trials for the canonical run (default 10000). */
    trials: number;
    /** Monte-Carlo seed; deterministic across machines via mulberry32. */
    seed: number;
    /** Fast-MC trials for the live duration scrubber (default 300, floor 100). */
    scrubberTrials: number;
    /**
     * Date anchor — discriminated union enforces mutual exclusion.
     * `null` when no `start-date`/`end-date` directive was authored.
     */
    anchor: Anchor;
    /** When true, the renderer suppresses the diagram banner title. */
    noTitle?: boolean;
    /** §1.9 `no-legend` — suppress the tag legend and collapse its reserved band. */
    noLegend?: boolean;
    /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
    legendInline?: boolean;
    /**
     * §1.9 fill family — `fill-solid` renders node/group card fills at full intent
     * saturation instead of the canonical 25% tint (via `shapeFill`).
     */
    fillMode?: 'solid' | 'outline';
    /**
     * `no-analysis` directive — suppresses the analysis layer (tornado +
     * S-curve). The layer renders by default whenever Monte Carlo ran;
     * this bare flag turns it off (mirrors `no-title`). An explicit
     * `viewState.an` (desktop-app toggle / share link) overrides it.
     */
    noAnalysis?: boolean;
    /**
     * `active-tag <name>` directive — selects which declared tag group
     * drives node fill via `resolveTagColor()`. `'none'` (case-insensitive)
     * suppresses tag coloring; `undefined` lets `resolveActiveTagGroup()`
     * auto-activate the first declared group.
     */
    activeTag?: string;
    /**
     * Sprint mode (mirrors Gantt's surface). Activated automatically when
     * `time-unit s` is set, or explicitly when any `sprint-*` directive
     * appears. Schedule cells render as `S<n>` instead of numeric offsets
     * or ISO dates.
     */
    sprintLength: Duration | null;
    sprintNumber: number | null;
    sprintStart: string | null;
    sprintMode: 'auto' | 'explicit' | null;
    /**
     * "Today" baked in at parse time (ISO YYYY-MM-DD). Same source as
     * `start-date now`, captured for every parse regardless of whether
     * `now` was authored. The renderer reads it in `buildScurveData` to
     * flag past latest-safe starts in backward mode — a dashed reference
     * line with a `(past)` label. Nothing prints the captured date itself
     * since the Summary card was deleted (#455). Empty string when the
     * parser was given no `now` and no `start-date now` directive (legacy
     * fixtures pre-dating this field) — consumers treat empty as
     * "no today known" and skip past-flagging.
     */
    today: string;
}
/**
 * A PERT activity (node). Activities have either a three-point estimate,
 * an M-only estimate (parser fills O/P from confidence factors), or no
 * estimate at all (TBD — analyzer null-poisons descendants).
 */
interface PertActivity {
    /** Stable id — alias if `as` was given, otherwise normalized name. */
    readonly id: string;
    /** Human-readable label as written in source. */
    readonly name: string;
    /** Optional alias from `<name> <durs> as <id>`. */
    readonly alias?: string;
    /**
     * Activity duration estimate.
     * - `null` → TBD (no estimate); analyzer poisons descendants with `null`.
     */
    readonly duration: DurationEstimate | null;
    /**
     * Per-activity confidence override from pipe metadata (`| confidence: low`).
     * When unset, analyzer uses `options.confidence`.
     */
    readonly confidence?: string;
    /** Group id this activity belongs to (post-resolve). */
    readonly groupId?: string;
    /** Source line of the declaration site (1-based). */
    readonly lineNumber: number;
    /** True for `milestone <name>` primitives (zero-duration, diamond shape). */
    readonly isMilestone: boolean;
    /**
     * Resolved tag-group metadata from pipe-metadata aliases. Keys are
     * lowercased tag-group names (e.g. `priority`, `team`); values are the
     * authored tag entry names. Drives node fill via `resolveTagColor()`
     * when an `active-tag` group is set. Empty when no tag groups are
     * declared or the activity carried no tag metadata.
     */
    readonly tags?: Readonly<Record<string, string>>;
}
/**
 * Forward-style milestone shorthand. Stored as a `PertActivity` with
 * `isMilestone: true` and a zero-duration estimate, but kept here as a
 * distinct exported alias for callers that want to filter by kind.
 */
type PertMilestone = PertActivity & {
    isMilestone: true;
};
/**
 * Dependency type — defaults to FS (Finish-to-Start), the dominant case.
 * - FS: `B.ES ≥ A.EF + lag` (most edges)
 * - SS: `B.ES ≥ A.ES + lag` (parallel start)
 * - FF: `B.EF ≥ A.EF + lag` (synchronized finish)
 * - SF: `B.EF ≥ A.ES + lag` (rare; included for completeness)
 */
type EdgeType = 'FS' | 'SS' | 'FF' | 'SF';
/**
 * Directed dependency edge from `source` activity to `target`.
 * `type` defaults to FS, `lag` to null (zero offset). Lag amount may be
 * negative (a lead — predecessor and successor overlap).
 */
interface PertEdge {
    readonly source: string;
    readonly target: string;
    readonly lineNumber: number;
    readonly type: EdgeType;
    readonly lag: Duration | null;
}
/** Group declared via `[group-name] | metadata`. */
interface PertGroup {
    readonly id: string;
    readonly name: string;
    /** Activity ids belonging to this group, populated in Pass 2. */
    readonly activityIds: readonly string[];
    /** Whether the user authored `| collapsed: true`. */
    readonly collapsed: boolean;
    /** Source line of the `[group-name]` header (1-based). */
    readonly lineNumber: number;
    /**
     * Resolved tag-group metadata for the cluster header — same shape as
     * `PertActivity.tags`. Currently informational; default-tag injection
     * skips groups (containers) so they appear "untagged" unless the user
     * authors an explicit value via pipe metadata.
     */
    readonly tags?: Readonly<Record<string, string>>;
    /**
     * Auto-detected group topology (Pass 2 result).
     * - `hammock`: single entry + single exit — collapses to a super-edge.
     * - `cluster`: multi-entry or multi-exit — collapses to a bounding rect.
     */
    readonly classification?: 'hammock' | 'cluster';
}
/** Output of `parsePert(content)`. */
interface ParsedPert {
    /** Optional title parsed from `pert <title>`. */
    readonly title: string | null;
    readonly options: PertOptions;
    readonly activities: readonly PertActivity[];
    readonly edges: readonly PertEdge[];
    readonly groups: readonly PertGroup[];
    /**
     * Tag groups declared at the top of the diagram (`tag Priority as p
     * High red, Low green`). Drive node fill via `resolveTagColor()`.
     * Empty when no `tag` blocks are declared.
     */
    readonly tagGroups: readonly TagGroup[];
    /**
     * Map alias-or-name → canonical activity id. Useful for the analyzer
     * and for editor autocomplete; also populated in Pass 2.
     */
    readonly idMap: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    /** First fatal error message; `null` when parse succeeded. */
    readonly error: string | null;
}
/**
 * Fully-resolved per-activity analysis output. ES/EF/LS/LF/slack are
 * `null` for any activity downstream of a TBD (poison-propagation per
 * AC2.3).
 */
interface ResolvedActivity {
    activity: PertActivity;
    /** Earliest start (forward pass). `null` if upstream TBD. */
    es: number | null;
    /** Earliest finish. */
    ef: number | null;
    /** Latest start (backward pass). */
    ls: number | null;
    /** Latest finish. */
    lf: number | null;
    /** Slack = LS − ES (or LF − EF). 0 = on critical path. `null` if poisoned. */
    slack: number | null;
    /** True iff the M-world critical path passes through this activity. */
    isCriticalPath: boolean;
    /** Resolved μ in `options.timeUnit` (numeric mean of o/m/p). */
    mu: number | null;
    /** Resolved σ in `options.timeUnit` (Beta-PERT std dev). */
    sigma: number | null;
    /**
     * Criticality index from Monte Carlo (0–1). `null` when MC is off or
     * when this activity is downstream of a TBD.
     */
    criticality: number | null;
    /**
     * True iff the source declared an explicit O/M/P triple. M-only,
     * TBD, and milestone activities all report `false`.
     */
    isAuthored: boolean;
}
/** Resolved hammock/cluster group. */
interface ResolvedGroup {
    group: PertGroup;
    /** Aggregate μ/σ along the group's internal critical path. */
    rolledMu: number | null;
    rolledSigma: number | null;
    /** Group entry/exit ids derived in Pass 2. */
    entries: string[];
    exits: string[];
    /**
     * Rolled-up schedule envelope across member activities.
     *   ES = min member.es
     *   EF = max member.ef
     *   LS = min member.ls
     *   LF = max member.lf
     *   slack = LS − ES
     *   criticality = max member.criticality (when MC is on)
     * Each is `null` when no member has a non-null value (e.g. all-TBD group).
     */
    es: number | null;
    ef: number | null;
    ls: number | null;
    lf: number | null;
    slack: number | null;
    criticality: number | null;
}
/**
 * Bare shape for a Monte-Carlo simulation result; Phase 2 fills it.
 * Keeping the shape exported in v1 means analyzer consumers don't break
 * when MC support lands.
 */
interface MonteCarloResult {
    /** Trials run (canonical or fast). */
    trials: number;
    /** Seed used for deterministic reproduction. */
    seed: number;
    /** Project-completion percentiles. */
    p50: number;
    p80: number;
    p95: number;
    /**
     * Central ~68% band — empirical equivalent of a ±1σ window. Used by
     * the S-curve to draw a "where the project most likely lands" shaded
     * region without assuming the finish-time distribution is normal.
     */
    p16: number;
    p84: number;
    /**
     * Empirical lower bound — minimum trial duration in canonical days.
     * Used by the S-curve to anchor its x-axis at the actually-observed
     * span rather than an analytical extrapolation. Backward-mode reads
     * this through `end_date − max` to land the left edge of the
     * candidate-start axis.
     */
    minDurationDays: number;
    /**
     * Empirical upper bound — maximum trial duration in canonical days.
     * Symmetric counterpart to `minDurationDays`. Backward-mode reads
     * this as the latest candidate start that still has a chance of
     * hitting the deadline.
     */
    maxDurationDays: number;
    /** Per-activity criticality index, keyed by activity id. */
    criticalityByActivity: Record<string, number>;
    /** Modal-longest-path tuple (activity ids). */
    modalCriticalPath: string[];
    /**
     * Per-activity tornado swings — how much the project end-date
     * moves when this activity comes in at its optimistic (O) or
     * pessimistic (P) extreme while every other activity stays at
     * its mean (μ). Sorted descending by total swing.
     *
     * `lowSwing` and `highSwing` are in canonical days (≥ 0).
     * Renderer converts to display unit.
     */
    tornadoSwings: TornadoSwing[];
}
/**
 * One row of a true two-sided tornado: the project end-date moves
 * lowSwing days earlier when the activity is at its optimistic
 * extreme, and highSwing days later when at its pessimistic extreme.
 * All other activities held at their μ.
 */
interface TornadoSwing {
    id: string;
    name: string;
    /** Days the project finishes EARLIER when this activity ≈ O. */
    lowSwing: number;
    /** Days the project finishes LATER when this activity ≈ P. */
    highSwing: number;
    /** Per-activity MC criticality index, used by the renderer for bar color. */
    criticality: number | null;
}
/**
 * Per-activity (O, M, P) in canonical days — the analyzer's
 * expanded-estimate cache, populated for every activity that has an
 * estimate (TBDs are omitted). Workers re-running Monte Carlo on an
 * already-resolved PERT can read this directly instead of re-parsing
 * + re-expanding from source.
 */
interface PertExpandedActivity {
    id: string;
    o: number;
    m: number;
    p: number;
}
interface ResolvedPert {
    options: PertOptions;
    activities: ResolvedActivity[];
    edges: PertEdge[];
    groups: ResolvedGroup[];
    /**
     * Tag groups copied from the parsed source. The renderer reads this
     * + `options.activeTag` to drive node fill via `resolveTagColor()`
     * and to render the legend.
     */
    tagGroups: TagGroup[];
    /**
     * Analysis mode auto-derived from data: `monte-carlo` when at least
     * one non-milestone activity carries an O/M/P triple AND `trials >= 100`,
     * otherwise `analytical`.
     */
    mode: 'monte-carlo' | 'analytical';
    /**
     * One-line project summary rendered as a subtitle under the diagram title.
     * Shape per mode (see §13A.7):
     *   - Forward:    `Expected finish: <date> · ≈ <μ> <unit> of work (± <σ>)`
     *   - Backward:   `Expected start: <date> · ≈ <μ> <unit> lead time (± <σ>)`
     *   - Unanchored: `≈ <μ> <unit> (± <σ>)`
     * Null when analysis bails out before producing any output.
     */
    projectSubtitle: string | null;
    /** μ along the M-world critical path (max EF over all activities). */
    projectMu: number | null;
    /** σ along the M-world critical path (sqrt of variance sum). */
    projectSigma: number | null;
    /** Critical-path activity ids in topological order. */
    criticalPath: string[];
    /**
     * Anchored mode: the date all four schedule labels (ES/EF/LS/LF) are
     * computed off. Forward = start-date; backward = end-date − projectMu;
     * null otherwise (no anchor, or backward + TBD upstream).
     */
    projectStart: string | null;
    /** Populated when `mode === 'monte-carlo'`. */
    monteCarloResult: MonteCarloResult | null;
    /**
     * Per-activity (O, M, P) in canonical days. Always populated; used
     * by Phase 3b Worker / scrubber so the simulator can re-run on a
     * postMessage-cloned ResolvedPert without needing the original
     * ParsedPert or analyzer state.
     */
    expandedActivities: PertExpandedActivity[];
    diagnostics: DgmoError[];
    error: string | null;
}
interface PertLayoutNode {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
interface PertLayoutEdge {
    readonly source: string;
    readonly target: string;
    readonly points: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
}
interface PertLayoutGroup {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly classification: 'hammock' | 'cluster';
    /**
     * True when the group is currently collapsed. Layout sized this rect
     * as a single rolled-up node and hid the group's member activities
     * from `nodes` / re-routed external edges to land on this rect.
     */
    readonly collapsed?: boolean;
}
interface LayoutResult {
    readonly nodes: readonly PertLayoutNode[];
    readonly edges: readonly PertLayoutEdge[];
    readonly groups: readonly PertLayoutGroup[];
    readonly width: number;
    readonly height: number;
}

interface ParsePertOptions {
    /**
     * "Today" reference for `start-date now` and `options.today`. Defaults
     * to `new Date()` at call time; tests inject a fixed date for
     * deterministic snapshots and past-row assertions.
     */
    now?: Date;
    /**
     * Active palette — used when resolving color names on `tag` entries
     * (e.g. `High red` → palette.colors.red). Optional; when omitted the
     * universal default color map is used.
     */
    palette?: PaletteColors;
}
declare function parsePert(content: string, parseOpts?: ParsePertOptions): ParsedPert;
declare function extractPertSymbols(docText: string): DiagramSymbols;
/**
 * Returns true when content lacks an explicit chart type but reads as a
 * PERT diagram. Per spec § Implementation Decisions: drop the
 * "three-number durations" heuristic (too generic) — require any of:
 *   (a) literal `pert` chart-type line (already handled by parseFirstLine)
 *   (b) an `analysis monte-carlo` directive
 *
 * This function is for case (b) inference — case (a) is handled upstream.
 */
declare function looksLikePert(content: string): boolean;

declare function analyzePert(parsed: ParsedPert): ResolvedPert;

declare function layoutPert(resolved: ResolvedPert): LayoutResult;
declare function relayoutPert(resolved: ResolvedPert, overrides: LayoutOverrides, collapsedGroupIds?: ReadonlySet<string>): LayoutResult;

/**
 * mulberry32: 32-bit seedable PRNG. Portable, deterministic, ~10 lines.
 * Returns a function that yields [0, 1).
 */
declare function mulberry32(seed: number): () => number;
/**
 * Sample one duration from a Beta-PERT distribution defined by (O, M, P).
 * Zero-variance case (O = M = P) bypasses sampling deterministically.
 */
declare function sampleBetaPert(o: number, m: number, p: number, rng: () => number): number;
interface ExpandedActivity {
    id: string;
    o: number;
    m: number;
    p: number;
}
interface SimulateOptions {
    trials: number;
    seed: number;
}
/**
 * Build a runnable simulation context from a `ResolvedPert`. The
 * analyzer will call this then invoke `simulateCanonical` /
 * `simulateFast` on the result.
 */
declare function buildSimulationContext(resolved: ResolvedPert): {
    predecessors: Map<string, string[]>;
    successors: Map<string, string[]>;
    topo: string[];
    terminals: string[];
    poisoned: Set<string>;
};
/**
 * Canonical simulation — N=10000 by default. Used for static export
 * and the "computing…" Worker job in the app.
 */
declare function simulateCanonical(resolved: ResolvedPert, expanded: ExpandedActivity[], opts: SimulateOptions): MonteCarloResult;
/**
 * Fast simulation — N=300 by default. Used by the duration scrubber for
 * sub-100ms re-analysis on each rAF tick.
 */
declare function simulateFast(resolved: ResolvedPert, expanded: ExpandedActivity[], opts: SimulateOptions): MonteCarloResult;

interface PertRenderOptions {
    /** Optional title rendered above the diagram. */
    title?: string | null;
    /**
     * Optional one-line project subtitle rendered under the title (or in
     * the title slot when the title is suppressed via `no-title`). Carries
     * the project-level μ ± σ + anchor-derived date(s) so the duration
     * stays visible even when the Analysis row is toggled off. Pass `null`
     * to suppress (the desktop preview does this — it draws an HTML
     * subtitle below the React `<h1>` instead). Typically wired from
     * `resolved.projectSubtitle`.
     */
    subtitle?: string | null;
    /** Optional callback for click → editor sync. */
    onClickItem?: (lineNumber: number) => void;
    /**
     * Override container dimensions during export. Treated as a hint:
     * the renderer will expand height/width if needed to fit chrome
     * (title + subtitle + diagram body + tag legend + analysis row) so
     * the diagram never clips. Pass `undefined` (or omit) to use the
     * auto-computed natural size.
     */
    exportDims?: {
        width?: number;
        height?: number;
    };
    /**
     * Group ids that should render as a single collapsed surface.
     * When set, the renderer:
     *   - draws the group rect with a solid fill and the rolled-up
     *     attribute body (μ / σ / slack / ES·EF / LS·LF / criticality)
     *   - skips every activity node whose `groupId` is in this set
     *   - skips every edge whose source AND target are both inside a
     *     collapsed group (i.e. internal-only edges)
     */
    collapsedGroupIds?: readonly string[];
    /**
     * Render the 3×2 field-reference mini-card beside the analysis
     * charts. Helps presenters explain what each schedule cell
     * (ES / dur / EF / LS / slack / LF) means while reviewing the
     * diagram. Off by default; the desktop app turns it on with the
     * "Field labels" toggle.
     */
    showFieldLegend?: boolean;
    /**
     * Render the tag-group legend inside the SVG, between the title and
     * the diagram. Defaults to true so CLI exports and share-link images
     * include it; the desktop preview flips it off and renders the legend
     * in a sibling native-pixel SVG instead, so the pill text stays at
     * intended size even when the diagram SVG gets scale-to-fit'd into the
     * panel.
     */
    showLegend?: boolean;
    /**
     * Render the Tornado sensitivity chart below the diagram. Reads
     * existing Monte-Carlo output (criticality + per-activity sigma)
     * and ranks activities by Schedule Sensitivity Index. Off by
     * default; the desktop app exposes it as a cog toggle.
     * When MC didn't run (analytical mode), the widget renders nothing.
     */
    showTornado?: boolean;
    /**
     * Render the S-curve (cumulative completion probability) below the
     * diagram. Reads the empirical CDF of Monte-Carlo trial finish times
     * — gives readers the full distribution shape, not just three
     * percentile dates. Off by default. Silently omits when MC didn't
     * run.
     */
    showScurve?: boolean;
    /**
     * Programmatic override for the active tag group — wins over
     * `options.activeTag` from the parsed source. Used by the desktop
     * preview when the user clicks a tag-legend pill: that interaction
     * sets the override (without mutating the parsed source) and
     * triggers a re-render with the new coloring. Pass `null` (or
     * `'none'`) to explicitly suppress tag coloring; omit to fall
     * through to the parsed `active-tag` directive.
     */
    activeTagOverride?: string | null;
    /** True when rendering for export — strips collapsed pills and cog from legend. */
    exportMode?: boolean;
    containerWidth?: number;
}
declare function renderPert(container: HTMLDivElement, resolved: ResolvedPert, layout: LayoutResult, palette: PaletteColors, isDark: boolean, options?: PertRenderOptions): void;
declare function renderPertForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors, 
/**
 * Optional parse-time "today" override. Threads through to
 * `parsePert({ now })` so the analyzer's backward-mode past-date
 * check stays deterministic. Test snapshots pin this; production code
 * omits it.
 */
now?: Date): string;
/**
 * Measure (without painting) the natural dimensions the analysis layer
 * would consume at the given width. Used by callers that need to lay
 * out the analysis SVG alongside other content — most importantly the
 * desktop preview, which fits diagram + analysis into a fixed panel
 * height by scaling proportionally when natural sizes overflow.
 */
declare function measurePertAnalysisBlock(resolved: ResolvedPert, width: number, options: {
    showTornado?: boolean;
    showScurve?: boolean;
    showFieldLegend?: boolean;
}): {
    width: number;
    height: number;
};
/**
 * Render the PERT analysis layer (Summary + Tornado + S-curve + Field
 * labels) into its own sibling SVG at native pixel size. Used by the
 * desktop preview so the analysis text stays at intended size even when
 * the main diagram SVG is scale-to-fit'd into the panel.
 */
declare function renderPertAnalysisBlock(container: HTMLDivElement, resolved: ResolvedPert, palette: PaletteColors, isDark: boolean, options: {
    width: number;
    showTornado?: boolean;
    showScurve?: boolean;
    showFieldLegend?: boolean;
}): void;

interface MindmapNode {
    readonly id: string;
    readonly label: string;
    readonly description?: readonly string[];
    readonly metadata: Readonly<Record<string, string>>;
    readonly children: readonly MindmapNode[];
    readonly parentId: string | null;
    readonly lineNumber: number;
    readonly color?: string;
    readonly collapsed?: boolean;
}
interface ParsedMindmap {
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly roots: readonly MindmapNode[];
    readonly tagGroups: readonly TagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}
interface MindmapLayoutNode {
    readonly id: string;
    readonly label: string;
    readonly description?: readonly string[];
    readonly metadata: Readonly<Record<string, string>>;
    readonly lineNumber: number;
    readonly color?: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly angle: number;
    readonly radius: number;
    readonly hiddenCount?: number;
    readonly hasChildren?: boolean;
}
interface MindmapLayoutEdge {
    readonly sourceId: string;
    readonly targetId: string;
    readonly path: string;
}
interface MindmapLayoutResult {
    readonly nodes: readonly MindmapLayoutNode[];
    readonly edges: readonly MindmapLayoutEdge[];
    readonly width: number;
    readonly height: number;
}

declare function parseMindmap(content: string, palette?: PaletteColors): ParsedMindmap;

declare class ScaleContext {
    readonly factor: number;
    readonly isBelowFloor: boolean;
    private constructor();
    static from(containerSize: number, idealSize: number, minScaleFactor?: number): ScaleContext;
    /**
     * Fit content into a bounding box, scaling by whichever dimension is more
     * constraining (the smaller of the width- and height-fit ratios) so the
     * diagram never overflows the canvas in either axis. Like {@link from}, the
     * factor is clamped to `[minScaleFactor, 1]` (content is never enlarged, and
     * never shrunk past the readability floor).
     */
    static fromBox(containerWidth: number, idealWidth: number, containerHeight: number, idealHeight: number, minScaleFactor?: number): ScaleContext;
    /**
     * Build a context from an explicit raw factor (clamped to
     * `[minScaleFactor, 1]`). Used to refine a fit iteratively: layout scaling is
     * non-linear (gaps shrink faster than floored text), so the first-pass factor
     * can still overflow — re-measure the laid-out result and tighten.
     */
    static fromFactor(rawFactor: number, minScaleFactor?: number): ScaleContext;
    static identity(): ScaleContext;
    aesthetic(value: number): number;
    structural(value: number): number;
    text(fontSize: number, floor?: number): number;
}

declare function layoutMindmap(parsed: ParsedMindmap, _palette: PaletteColors, options?: {
    interactive?: boolean;
    hiddenCounts?: Map<string, number>;
    activeTagGroup?: string | null;
    hideDescriptions?: boolean;
    ctx?: ScaleContext;
}): MindmapLayoutResult;

declare function renderMindmap(container: HTMLDivElement, parsed: ParsedMindmap, layout: MindmapLayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, onToggleNode?: (nodeId: string) => void, hideDescriptions?: boolean, activeTagGroup?: string | null, options?: {
    colorByDepth?: boolean;
    onToggleColorByDepth?: (active: boolean) => void;
    onToggleDescriptions?: (active: boolean) => void;
    controlsExpanded?: boolean;
    onToggleControlsExpand?: () => void;
    exportMode?: boolean;
    /** When 'app', controls (Descriptions / Depth Colors) are hosted by the app
     *  overlay strip — inline gear suppressed, controls row + anchor reserved. */
    controlsHost?: 'app' | 'inline';
}): void;
declare function renderMindmapForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

interface CollapsedMindmapResult {
    /** Roots with collapsed subtrees pruned (deep-cloned, never mutates original) */
    roots: MindmapNode[];
    /** nodeId → count of hidden descendants */
    hiddenCounts: Map<string, number>;
}
declare function collapseMindmapTree(roots: readonly MindmapNode[], collapsedIds: Set<string>): CollapsedMindmapResult;

/**
 * All wireframe element types.
 * Visual-mnemonic elements are inferred from bracket syntax;
 * keyword elements use a small vocabulary (9 keywords).
 */
type WireframeElementType = 'group' | 'textInput' | 'button' | 'dropdown' | 'checkbox' | 'radio' | 'heading' | 'divider' | 'text' | 'listItem' | 'nav' | 'tabs' | 'table' | 'image' | 'modal' | 'skeleton' | 'alert' | 'progress' | 'chart';
/**
 * Single flat interface for all wireframe elements (ADR-8).
 * No separate WireframeGroup — all elements carry group fields
 * with sensible defaults (isContainer=false, orientation='vertical', isSkeleton=false).
 */
interface WireframeElement {
    readonly id: string;
    readonly type: WireframeElementType;
    /** Display label / placeholder text / heading text */
    readonly label: string;
    /** Child elements (non-empty only when isContainer=true) */
    readonly children: readonly WireframeElement[];
    /** Pipe metadata key-value pairs */
    readonly metadata: Readonly<Record<string, string>>;
    /** State keywords: disabled, active, ghost, destructive, etc. */
    readonly states: readonly string[];
    /** Free-text annotations from pipe metadata */
    readonly annotations: readonly string[];
    /** 1-based line number in source */
    readonly lineNumber: number;
    /** Measured indentation (column) */
    readonly indent: number;
    /** True when element has children (set during parse via indent stack) */
    readonly isContainer: boolean;
    /** Stacking direction for group children */
    readonly orientation: 'vertical' | 'horizontal';
    /** True when inside a skeleton block */
    readonly isSkeleton: boolean;
    /** Heading level: 1 for `#`, 2 for `##` */
    readonly headingLevel?: number;
    /** Dropdown options (for type='dropdown') */
    readonly options?: readonly string[];
    /** Checked state (for type='checkbox') */
    readonly checked?: boolean;
    /** Selected state (for type='radio') */
    readonly selected?: boolean;
    /** Image hint: 'default' | 'round' | 'wide' */
    readonly imageHint?: 'default' | 'round' | 'wide';
    /** Progress value 0-100 (for type='progress') */
    readonly progressValue?: number;
    /** Chart hint: 'line' | 'bar' | 'pie' */
    readonly chartHint?: 'line' | 'bar' | 'pie';
    /** Table dimensions for skeleton shorthand (for type='table') */
    readonly tableRows?: number;
    readonly tableCols?: number;
    /** Table header row labels (for type='table') */
    readonly tableHeaders?: readonly string[];
    /** Table data rows — each row is an array of cell content strings (for type='table') */
    readonly tableData?: ReadonlyArray<readonly string[]>;
    /** Inline elements on the same line (multi-element line) */
    readonly inlineElements?: readonly WireframeElement[];
    /** Label element for label-field pairing */
    readonly labelFor?: WireframeElement;
    /** Color from tag system */
    readonly color?: string;
    /** Field variant: password, textarea */
    readonly fieldVariant?: 'password' | 'textarea';
}
/** Form factor / layout mode */
type WireframeFormFactor = 'desktop' | 'mobile';
interface ParsedWireframe {
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly formFactor: WireframeFormFactor;
    /** Top-level elements (roots of the hierarchy) */
    readonly roots: readonly WireframeElement[];
    /** Modal elements (rendered separately below main) */
    readonly modals: readonly WireframeElement[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseWireframe(content: string): ParsedWireframe;

interface WireframeLayoutNode {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly element: WireframeElement;
    readonly children: readonly WireframeLayoutNode[];
    /** For label-field pairs: the x offset where fields align */
    readonly fieldAlignX?: number;
}
interface WireframeLayout {
    readonly width: number;
    readonly height: number;
    readonly titleHeight: number;
    readonly nodes: readonly WireframeLayoutNode[];
    readonly modalNodes: readonly WireframeLayoutNode[];
}
declare function layoutWireframe(parsed: ParsedWireframe, _options?: Record<string, string>, overrideWidth?: number, showGroupLabels?: boolean): WireframeLayout;

interface WireframeRenderOptions {
    exportDims?: {
        width?: number;
        height?: number;
    };
    theme?: string;
    onClickItem?: (lineNumber: number) => void;
    /** Controls group state */
    controlsExpanded?: boolean;
    fitWidth?: boolean;
    showGroupLabels?: boolean;
    onControlsExpand?: () => void;
    onControlsToggle?: (id: string, active: boolean) => void;
}
declare function renderWireframe(container: HTMLDivElement, parsed: ParsedWireframe, layout: WireframeLayout, palette: PaletteColors, isDark: boolean, _onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, theme?: string, options?: WireframeRenderOptions): void;

type QuadrantPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type BlipTrend = 'new' | 'up' | 'down' | 'stable';
interface TechRadarRing {
    readonly name: string;
    readonly alias: string | null;
    readonly lineNumber: number;
}
interface TechRadarBlip {
    readonly name: string;
    readonly ring: string;
    readonly trend: BlipTrend | null;
    readonly description: readonly string[];
    readonly lineNumber: number;
    /** Assigned after parsing — global numbering across all quadrants. */
    readonly globalNumber: number;
}
interface TechRadarQuadrant {
    readonly name: string;
    readonly position: QuadrantPosition;
    readonly color: string | null;
    readonly lineNumber: number;
    readonly blips: readonly TechRadarBlip[];
}
interface ParsedTechRadar {
    readonly type: 'tech-radar';
    readonly title: string;
    readonly titleLineNumber: number;
    readonly rings: readonly TechRadarRing[];
    readonly quadrants: readonly TechRadarQuadrant[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}
interface TechRadarLayoutPoint {
    blip: TechRadarBlip;
    x: number;
    y: number;
    quadrantIndex: number;
    ringIndex: number;
}
interface TechRadarRenderOptions {
    /** Whether the blip listing is visible. Default: true for export, false for interactive. */
    showListing?: boolean;
    /** Callback when the listing toggle is clicked. */
    onToggleListing?: (show: boolean) => void;
    /** Whether the controls legend capsule is expanded. */
    controlsExpanded?: boolean;
    /** Callback when the controls gear pill is clicked (expand/collapse). */
    onToggleControlsExpand?: () => void;
    /** Active legend group name (e.g. 'Trends'). */
    activeLegendGroup?: string | null;
    /** Callback when a legend group pill is toggled. */
    onLegendGroupToggle?: (groupName: string) => void;
    /** Active line from the editor cursor — triggers popover/expansion for that blip. */
    activeLine?: number | null;
    /** True when rendering for export (PNG/SVG/PDF) — controls whether collapsed legend pills and cog are stripped. */
    exportMode?: boolean;
    /** When 'app', the Blip Legend toggle is hosted by the app overlay strip
     *  (inline gear suppressed, controls row + anchor reserved). */
    controlsHost?: 'app' | 'inline';
}

declare function parseTechRadar(content: string): ParsedTechRadar;

/**
 * Compute deterministic, non-overlapping blip positions for a tech radar.
 *
 * Each blip is positioned within its ring+quadrant slice using polar coordinates,
 * then converted to cartesian. The algorithm is:
 * - Stable: changes in one slice don't affect other slices
 * - Deterministic: same input always produces same output
 * - Collision-avoiding: nudges overlapping blips radially within their ring band
 */
declare function computeRadarLayout(parsed: ParsedTechRadar, width: number, height: number, ctx?: ScaleContext): TechRadarLayoutPoint[];
/**
 * Get the center and max radius for a radar at the given dimensions.
 * Useful for renderers that need these values independently.
 */
declare function getRadarGeometry(width: number, height: number, ringCount: number): {
    cx: number;
    cy: number;
    maxRadius: number;
    ringBandWidth: number;
};

declare function renderTechRadar(container: HTMLDivElement, parsed: ParsedTechRadar, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions, viewState?: CompactViewState, options?: TechRadarRenderOptions): void;
declare function renderTechRadarForExport(container: HTMLDivElement, parsed: ParsedTechRadar, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, viewState?: CompactViewState, exportMode?: boolean): void;

declare function renderQuadrantFocus(container: HTMLDivElement, parsed: ParsedTechRadar, quadrantPosition: QuadrantPosition, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions, _options?: TechRadarRenderOptions): void;
declare function renderQuadrantFocusForExport(container: HTMLDivElement, parsed: ParsedTechRadar, quadrantPosition: QuadrantPosition, palette: PaletteColors, isDark: boolean, exportDims: {
    width: number;
    height: number;
}): void;

interface CycleNode {
    readonly label: string;
    readonly lineNumber: number;
    readonly color?: string;
    readonly span: number;
    readonly description: readonly string[];
    readonly metadata: Readonly<Record<string, string>>;
}
interface CycleEdge {
    readonly sourceIndex: number;
    readonly targetIndex: number;
    readonly label?: string;
    readonly color?: string;
    readonly width?: number;
    readonly description: readonly string[];
    readonly lineNumber?: number;
    readonly metadata: Readonly<Record<string, string>>;
}
interface ParsedCycle {
    readonly type: 'cycle';
    readonly title: string;
    readonly titleLineNumber: number;
    readonly nodes: readonly CycleNode[];
    readonly edges: readonly CycleEdge[];
    readonly direction: 'clockwise' | 'counterclockwise';
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

interface CycleLayoutNode {
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly angle: number;
    readonly width: number;
    readonly height: number;
    /** Pre-wrapped description lines (fit to node width). Empty if no descriptions. */
    readonly wrappedDesc: readonly WrappedDescLine[];
    /** Whether this node should be rendered as a circle. */
    readonly isCircle: boolean;
}
interface CycleLayoutEdge {
    readonly sourceIndex: number;
    readonly targetIndex: number;
    readonly path: string;
    readonly labelX: number;
    readonly labelY: number;
    /** Angle of the label position on the circle (radians), for text-anchor. */
    readonly labelAngle: number;
    readonly label?: string;
}
interface CycleLayoutResult {
    readonly nodes: readonly CycleLayoutNode[];
    readonly edges: readonly CycleLayoutEdge[];
    readonly cx: number;
    readonly cy: number;
    readonly radius: number;
    readonly width: number;
    readonly height: number;
    /** Scale factor applied to nodes (1 = no scaling, <1 = shrunk to fit). */
    readonly scale: number;
}

/**
 * Parse a `.dgmo` cycle diagram document.
 *
 * Syntax (§1.4 unified metadata grammar):
 * ```
 * cycle Title
 *
 * direction-counterclockwise
 *
 * NodeLabel color: blue, span: 3
 *   Description line (indented under node)
 *   -Label-> color: red, width: 6
 *     Edge description (indented under edge)
 * ```
 */
declare function parseCycle(content: string): ParsedCycle;

/**
 * Compute cycle diagram layout: positions nodes equidistant (or span-weighted)
 * on a circle, and generates curved edge paths between consecutive nodes.
 */
declare function computeCycleLayout(parsed: ParsedCycle, options?: {
    width?: number;
    height?: number;
    hideDescriptions?: boolean;
}): CycleLayoutResult;

interface CycleRenderOptions {
    onClickItem?: (lineNumber: number) => void;
    exportDims?: D3ExportDimensions;
    viewState?: CompactViewState;
    hideDescriptions?: boolean;
    controlsExpanded?: boolean;
    onToggleDescriptions?: (active: boolean) => void;
    onToggleControlsExpand?: () => void;
    exportMode?: boolean;
    /** When 'app', the description toggle is hosted by the app overlay strip:
     *  the inline gear is suppressed and a controls row + anchor are reserved.
     *  Default (inline) renders the gear as before. */
    controlsHost?: 'app' | 'inline';
}
/**
 * Render a cycle diagram into the given container.
 */
declare function renderCycle(container: HTMLDivElement, parsed: ParsedCycle, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions, viewState?: CompactViewState, renderOptions?: CycleRenderOptions): void;
/**
 * Render for CLI/export (no click handlers).
 */
declare function renderCycleForExport(container: HTMLDivElement, parsed: ParsedCycle, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, viewState?: CompactViewState, exportMode?: boolean): void;

interface JourneyMapAnnotation {
    readonly type: 'pain' | 'opportunity' | 'thought';
    readonly text: string;
}
interface JourneyMapStep {
    readonly id: string;
    readonly title: string;
    readonly score?: number;
    readonly emotionLabel?: string;
    readonly tags: Readonly<Record<string, string>>;
    readonly annotations: readonly JourneyMapAnnotation[];
    readonly description?: string;
    readonly lineNumber: number;
    readonly endLineNumber: number;
}
interface JourneyMapPhase {
    readonly id: string;
    readonly name: string;
    readonly steps: readonly JourneyMapStep[];
    readonly lineNumber: number;
}
interface JourneyMapPersona {
    readonly name: string;
    readonly description?: string;
    readonly color?: string;
    readonly lineNumber: number;
}
interface ParsedJourneyMap {
    readonly type: 'journey-map';
    readonly title?: string;
    readonly titleLineNumber?: number;
    readonly persona?: JourneyMapPersona;
    readonly phases: readonly JourneyMapPhase[];
    /** Flat-mode steps (not inside any phase) */
    readonly steps: readonly JourneyMapStep[];
    readonly tagGroups: readonly TagGroup[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseJourneyMap(content: string, palette?: PaletteColors): ParsedJourneyMap;

interface CurvePoint {
    x: number;
    y: number;
    score: number;
    emotionLabel?: string;
    stepIndex: number;
}
interface StepLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    step: JourneyMapStep;
    color: string;
}
interface PhaseLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    phase: JourneyMapPhase;
    headerColor: string;
    stepLayouts: StepLayout[];
}
interface JourneyMapLayout {
    phases: PhaseLayout[];
    flatStepLayouts: StepLayout[];
    curvePoints: CurvePoint[];
    totalWidth: number;
    totalHeight: number;
    curveAreaTop: number;
    curveAreaBottom: number;
    cardAreaTop: number;
    personaHeight: number;
    titleHeight: number;
    /** Whether any step has thought annotations */
    hasThoughts: boolean;
}
declare function layoutJourneyMap(parsed: ParsedJourneyMap, palette: PaletteColors, options?: {
    exportDims?: {
        width: number;
        height: number;
    };
    collapsedPhases?: Set<string>;
    isDark?: boolean;
}): JourneyMapLayout;

interface JourneyMapInteractiveOptions {
    onNavigateToLine?: (line: number) => void;
    exportDims?: {
        width: number;
        height: number;
    };
    activeTagGroup?: string | null;
    onActiveTagGroupChange?: (group: string | null) => void;
    /** Current editor cursor line — highlights the matching face + card, dims the rest */
    currentLine?: number | null;
    /** Set of collapsed phase names */
    collapsedPhases?: Set<string>;
    /** Called when a phase is toggled */
    onPhaseToggle?: (phaseName: string) => void;
    exportMode?: boolean;
}
declare function renderJourneyMap(container: HTMLElement, parsed: ParsedJourneyMap, palette: PaletteColors, isDark: boolean, options?: JourneyMapInteractiveOptions): void;
declare function renderJourneyMapForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

interface PyramidLayer {
    readonly label: string;
    readonly lineNumber: number;
    /** Optional palette color name (red/green/blue/…). */
    readonly color?: string;
    /** Description lines — from bare pipe shorthand or indented body. */
    readonly description: readonly string[];
    /** Unconsumed pipe metadata (reserved for future use). */
    readonly metadata: Readonly<Record<string, string>>;
}
interface ParsedPyramid {
    readonly type: 'pyramid';
    readonly title: string;
    readonly titleLineNumber: number;
    readonly layers: readonly PyramidLayer[];
    /** When true, apex points down instead of up. */
    readonly inverted: boolean;
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

/**
 * Parse a `.dgmo` pyramid diagram document.
 *
 * Top of file = apex of pyramid (reads top-down).
 *
 * Syntax:
 * ```
 * pyramid Maslow's Hierarchy of Needs
 *
 * inverted                               // optional — flips apex to bottom
 *
 * Self-Actualization                     // indented body = description
 *   Achieving one's full potential.
 *
 * Esteem | Respect, recognition          // bare pipe shorthand = description
 *
 * Love & Belonging | color: blue         // structured metadata
 *   Friendship, intimacy, family.
 *
 * Physiological | Food, water, rest
 * ```
 */
declare function parsePyramid(content: string): ParsedPyramid;

/**
 * Render a pyramid diagram into the given container.
 */
declare function renderPyramid(container: HTMLDivElement, parsed: ParsedPyramid, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;
/**
 * Render for CLI/export (no click handlers).
 */
declare function renderPyramidForExport(container: HTMLDivElement, parsed: ParsedPyramid, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

interface EventLineEvent {
    readonly label: string;
    readonly lineNumber: number;
    /** ISO date as written (verbatim caption), or null when the event has no date. */
    readonly date: string | null;
    /** Numeric date value (timeline scale) for to-scale positioning, or null. */
    readonly dateValue: number | null;
    /** True when the date was written as `TBD` — a not-yet-scheduled FUTURE event.
     *  Its `date` caption is `'TBD'`; `dateValue` is inferred from source-order
     *  dated neighbors so the to-scale axis still positions it (see `futureSpan`). */
    readonly future: boolean;
    /** For a `future` event, the dateValue gap it is interpolated WITHIN
     *  (`[lo, hi]`) — present when a dated event follows it. `null` for a trailing
     *  TBD (no dated event after it): the open horizon, drawn as a dashed spine
     *  tail. Distinguishes bracketed vs trailing placement; always null for
     *  non-future events. */
    readonly futureSpan: readonly [number, number] | null;
    /** Tag/metadata — keys are `tagAttrKey(group)` (e.g. `{ genre: 'Pop' }`). */
    readonly metadata: Readonly<Record<string, string>>;
    /** Bare-body description lines (markdown-light; `- ` normalized to `• `). */
    readonly description: readonly string[];
    /** Name of the enclosing era (`[Name]` run delimiter, §28.6a), or null. */
    readonly era: string | null;
}
/**
 * An **era** — a `[Name]` run delimiter (§28.6a) that brackets a contiguous run
 * of events into a labeled section of the spine. Not an indentation container:
 * events stay at indent 0 and belong to the most-recently opened era. Drawn as a
 * horizontal `]` bracket on the side opposite the cards; `collapsed` folds the
 * run into one event-like summary card (bulleted member list) while the bracket
 * stays on the spine.
 */
interface EventLineEra {
    readonly name: string;
    /** Resolved color token (palette name) tinting the bracket/label, or null. */
    readonly color: string | null;
    /** Authored default collapse state (the export/CLI state; the app toggles live). */
    readonly collapsed: boolean;
    readonly lineNumber: number;
}
/**
 * A **now marker** (§28.6b) — a "grounded pin" at "today": a palette-red
 * (`palette.destructive`) diamond planted on the spine with a short stem to a
 * labeled tab, slotted into a card-free lane, plus a dotted "today line" that
 * fades out within the leader gap (full-height only on hover, preview).
 * `now` alone is *computed* (resolved to the render-time date);
 * `now <date>` *pins* it to an explicit ISO date (deterministic, snapshot-safe).
 * A trailing named color (`now blue`, `now 2023-06-01 Today blue`) overrides
 * the red, for timelines whose tags already claim it.
 * Only drawn on a to-scale axis (every event dated); ignored under `no-scale`.
 */
interface EventLineNow {
    /** True for bare `now` (date resolved at render time); false when pinned. */
    readonly computed: boolean;
    /** Pinned ISO date as written, or null when computed. */
    readonly date: string | null;
    /** Numeric value for the pinned date (timeline scale), or null when computed. */
    readonly dateValue: number | null;
    /**
     * Author-supplied tab caption, or null to caption the tab with the marker's
     * own resolved date (the default — a tab reading `now` cannot tell a diagram
     * redrawn today from one exported two years ago).
     */
    readonly label: string | null;
    /**
     * Named palette color for the pin, or null for the default `destructive`
     * red. An escape hatch for a timeline whose own tags already use red, where
     * the today-line convention would read as just another category.
     */
    readonly color: string | null;
    readonly lineNumber: number;
}
interface EventLineOptions {
    /** False when `no-scale` — events are spaced evenly instead of by date. */
    readonly scale: boolean;
    /** Card placement: `alternate` (default) or all on one `above`/`below` side. */
    readonly side: 'alternate' | 'above' | 'below';
    /** True when `no-title`. */
    readonly noTitle: boolean;
    /** True when `no-box` — render a card-less label + date on a soft tag-tinted
     *  shelf (with a colored leader-landing edge) + description (slides). */
    readonly noBox: boolean;
    /** True when `no-legend` — hide the tag legend. */
    readonly noLegend: boolean;
    /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
    readonly legendInline?: boolean;
    /** §1.9 fill family: 'solid' | 'outline'; undefined ⇒ canonical soft tint. */
    readonly fillMode: 'solid' | 'outline' | undefined;
}
interface ParsedEventLine {
    readonly type: 'event-line';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly events: readonly EventLineEvent[];
    readonly eras: readonly EventLineEra[];
    /** The `now` marker (§28.6b), or null when the directive is absent. */
    readonly now: EventLineNow | null;
    readonly tagGroups: readonly TagGroup[];
    readonly options: EventLineOptions;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseEventLine(content: string, palette?: PaletteColors): ParsedEventLine;

declare function renderEventLine(container: HTMLDivElement, parsed: ParsedEventLine, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions, tagOverride?: string, 
/** Injectable clock for the computed `now` marker (§28.6b). Defaults to the
 *  live wall-clock; tests/snapshots pass a fixed date for determinism. */
nowDate?: Date): void;
/** A focus target: a single event (by its `data-evt` id, = source line), an era
 *  (by name), or a tag value (a legend category). `null` clears the focus. */
type EventLineFocus = {
    readonly kind: 'event';
    readonly id: string;
} | {
    readonly kind: 'era';
    readonly name: string;
} | {
    readonly kind: 'tag';
    readonly group: string;
    readonly value: string;
};
/**
 * Clear the preview-only legend-muted tag set persisted on a container (the
 * collapsed-to-dot categories from §28.5). View state is per-document, so a host
 * resets it when the source changes (switching files / edits) — the same
 * contract the app uses for live era collapse toggles. No-op if nothing is set.
 */
declare function clearEventLineMuted(container: HTMLElement): void;
/**
 * Pin a persistent focus on a rendered event-line — e.g. driven by the editor
 * cursor — dimming everything except the target, exactly like hover. Hovering
 * temporarily overrides the pin; leaving the diagram reverts to it. Pass `null`
 * to clear. No-op when the container holds no event-line SVG.
 */
declare function focusEventLine(container: HTMLElement, spec: EventLineFocus | null): void;
declare function renderEventLineForExport(container: HTMLDivElement, parsed: ParsedEventLine, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, tagOverride?: string, nowDate?: Date): void;

/** A resolved recurrence rule. Built by the parser, re-read by the ticker. */
interface RecurRule {
    /** How `on` binds to the cadence. */
    readonly kind: 'month-day' | 'nth-weekday' | 'last-weekday' | 'weekly' | 'interval';
    /** month-day: 0-11. */
    readonly month?: number | undefined;
    /** month-day: 1-31. */
    readonly day?: number | undefined;
    /** nth-weekday: 1-5. */
    readonly nth?: number | undefined;
    /** nth/last/weekly: 0 (Sun) – 6 (Sat). */
    readonly weekday?: number | undefined;
    /** time-of-day hour 0-23 (default 0). */
    readonly hour: number;
    /** time-of-day minute 0-59 (default 0). */
    readonly minute: number;
    /** No `at` time given → the occurrence is the whole DAY (see resolveNext). */
    readonly allDay: boolean;
    /** interval cadence unit. */
    readonly intervalUnit?: 'day' | 'week' | 'month' | undefined;
    /** interval multiplier (>= 1). */
    readonly intervalN?: number | undefined;
    /** interval anchor epoch ms (from `from <date>`). */
    readonly anchorMs?: number | undefined;
    /** IANA zone the anchor's wall-clock resolves in; undefined → viewer-local. */
    readonly tz?: string | undefined;
}
type CountUnits = 'human' | 'days' | 'full' | 'clock' | 'weeks' | 'words' | 'compound';
type RoundMode = 'up' | 'down' | 'nearest';
/** Which `full`-mode segments show. */
type Field = 'd' | 'h' | 'm' | 's';

interface ParsedCountdown {
    readonly type: 'countdown';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    /**
     * Canonical one-shot target string emitted verbatim into `data-dgmo-countdown`.
     * A bare `YYYY-MM-DD` stays a date (ticker resolves it to viewer-local
     * midnight); a datetime keeps its authored form; `now` resolves to a fixed
     * render-time instant. Null for recurring blocks.
     */
    readonly target: string | null;
    /**
     * The one-shot target resolved to absolute epoch ms (bare date → local
     * midnight; `now` → the render-time instant). Null for recurring blocks or an
     * unparseable target. For one-shot blocks this equals `resolvedMs`.
     */
    readonly targetMs: number | null;
    /** The recurrence rule, or null for one-shot blocks. */
    readonly rule: RecurRule | null;
    /**
     * The resolved next instant (epoch ms). For one-shot == the target; for
     * recurring == `resolveNext(rule, renderTime)`. Null when unresolvable.
     */
    readonly resolvedMs: number | null;
    /** Whether the resolved instant carries a meaningful time-of-day (drives footer). */
    readonly hasTime: boolean;
    /**
     * The recurrence anchor — the origin instant every calendar field is derived
     * from (epoch ms), or null for a one-shot `target` block. Also the ordinal's
     * zero point: the anchor occurrence is the 0th (decision #56).
     */
    readonly sinceMs: number | null;
    /**
     * Eyebrow template: `Nth` → ordinal word, `N` → the number. Null → NO eyebrow.
     * The ordinal is opt-in, because `since` is now mandatory on every recurring
     * block and numbering a standing meeting nobody asked to number is noise.
     */
    readonly sinceLabel: string | null;
    /**
     * IANA zone (`America/New_York`) the authored wall-clock times resolve in, so
     * a bare date / offset-free datetime / recurring `at` pins to an absolute
     * instant instead of drifting with the viewer's OS clock (spec §36 tz slot).
     * Null → viewer-local (v1 default). An explicit ISO offset always wins.
     */
    readonly tz: string | null;
    readonly units: CountUnits;
    readonly round: RoundMode;
    readonly fields: readonly Field[];
    readonly lang: string;
    /** Text shown on the occurrence day (recurring only). */
    readonly onDay: string | null;
    /** Explicit text shown once a one-shot target passes; null → count UP ("N ago"). */
    readonly expired: string | null;
    /**
     * Free-text note under the ancillary line — inline (`note buy flowers`) or a
     * `note` header + indented body lines. Simple markdown (**bold** / *italic* /
     * `code` / links / `- ` bullets), like `goal`'s caption.
     */
    readonly note: string | null;
    /**
     * Suppress the "you-are-here → event" calendar band. The band is **default-on**
     * for every date-bearing countdown (the renderer auto-picks the tier from the
     * span to the target — §36.6); `no-visual` collapses the chart to the header.
     */
    readonly noVisual: boolean;
    /**
     * Resolved trailing-token / `color:` hex, if any. Sets the gradient's HOT
     * endpoint (the target color); defaults to red when unset.
     */
    readonly color?: string;
    /**
     * §1.9 fill family (`fill-solid` / `fill-outline`; absent ⇒ the legacy
     * saturated chips). Restyles the calendar-band chips only — the final-day
     * ring gauges are meters and stay saturated in every mode (§36.6).
     */
    readonly fillMode?: FillMode;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

/**
 * Resolve a one-shot target string to absolute epoch ms, or null if unparseable.
 * Thin back-compat wrapper over the canonical (tz-aware) `targetToMs` in
 * `./resolve` — a bare `YYYY-MM-DD` counts to `tz`-midnight (viewer-local when
 * `tz` is null); an ISO offset is always honored as an absolute instant.
 */
declare function targetToMs(target: string, tz?: string | null): number | null;
declare function parseCountdown(content: string, palette?: PaletteColors): ParsedCountdown;

declare function renderCountdown(container: HTMLDivElement, parsed: ParsedCountdown, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;
declare function renderCountdownForExport(container: HTMLDivElement, parsed: ParsedCountdown, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

/** Run one update pass over every countdown node inside `root`. */
declare function tickCountdowns(root?: ParentNode): void;
/**
 * Update `root` immediately, then (once per page) register a single 1s interval
 * that re-scans the whole document. Idempotent — safe to call on every render /
 * route change (mirrors remark's `clickHandlerBound` guard). No-op with no DOM.
 */
declare function startCountdowns(root?: ParentNode): void;

/** Which clock face the whole board renders. EITHER/OR — never both. */
type ClockFace = 'analog' | 'digital';
/**
 * What dimension drives each zone's color (`color-by <dimension>`). Time + label
 * render in the resolved solid color; the lane/column gets a soft wash of it. A
 * hand-set per-zone shade ("defined") always overrides the dimension for that
 * zone — `color-by` only fills the zones you did not color yourself.
 *   • `place`    — a distinct palette accent per place (identity, default)
 *   • `work`     — green in-hours / amber closing / grey off (needs `hours`)
 *   • `daylight` — warm sun-up / cool sun-down
 *   • `time`     — continuous dawn→dusk→night ramp by local hour
 *   • `none`     — neutral greyscale (`color-by none`)
 */
type ClockColorBy = 'place' | 'work' | 'daylight' | 'time' | 'none';
/** A resolved working window, applied in each row's OWN zone-local time. */
interface WorkWindow {
    /** Minutes past midnight the window opens (e.g. 9:00 → 540). */
    readonly startMin: number;
    /** Minutes past midnight the window closes (e.g. 17:00 → 1020). */
    readonly endMin: number;
    /**
     * Working days as a set keyed by the 3-letter weekday abbreviation the
     * `Intl` short weekday emits (`Mon`,`Tue`,…,`Sun`). A day maps to `true` when
     * it is a working day. Defaults to Mon–Fri when `hours` is given without
     * `days`.
     */
    readonly days: Record<string, boolean>;
}
/**
 * How a row's zone was named (§37.3). `iana` — a real, DST-aware zone reached by
 * a city name, an alias, or an explicit IANA id. `fixed` — a raw `UTC±HH:MM`
 * offset that never observes daylight saving (rendered with a "no DST" marker).
 */
type ClockZoneKind = 'iana' | 'fixed';
/** One place/person row on the board. */
interface ClockEntry {
    /** Whether the zone is a real IANA zone or a fixed UTC offset. */
    readonly kind: ClockZoneKind;
    /** The canonical display city ("New York"), or the offset label for a fixed row. */
    readonly place: string;
    /** The IANA zone ("America/New_York"), or the offset label ("UTC+5:30") when fixed. */
    readonly zone: string;
    /** Minutes east of UTC for a `fixed` row; null for an `iana` row. */
    readonly fixedOffsetMin: number | null;
    /** The display alias (`as <label>`), defaulting to `place`. */
    readonly label: string;
    /** Representative latitude for sundown math, or null when unknown. */
    readonly lat: number | null;
    /** Representative longitude for sundown math, or null when unknown. */
    readonly lon: number | null;
    /** Resolved trailing palette color (a faint row tint), or null. */
    readonly color: string | null;
    /** 1-based source line the entry was authored on. */
    readonly lineNumber: number;
}
interface ParsedClock {
    readonly type: 'clock';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    /** Board-level face. Default `digital`. */
    readonly face: ClockFace;
    /** 12-hour am/pm display when true (default), 24-hour when false (`time-24`). */
    readonly hours12: boolean;
    /** Whether the sundown/sunrise line is drawn (default on; `sun false` to hide). */
    readonly sun: boolean;
    /** `no-title` directive — suppress the title AND the working-window summary. */
    readonly noTitle: boolean;
    /** `direction lr` lays entries out as vertical columns (time on top); default rows. */
    readonly columns: boolean;
    /** What drives each zone's color. Default `place`; disable via `color-by none`. */
    readonly colorBy: ClockColorBy;
    /**
     * §1.9 fill family (`fill-solid` / `fill-outline`; absent ⇒ canonical tint).
     * Restyles only DECORATIVE surface tints (card, identity lane washes, dial
     * faces) — state-encoding fills (day/night, work status) keep their fills.
     */
    readonly fillMode?: FillMode;
    /** The working window, or null when no `hours` directive was given. */
    readonly work: WorkWindow | null;
    readonly entries: readonly ClockEntry[];
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseClock(content: string, palette?: PaletteColors): ParsedClock;

declare function renderClock(container: HTMLDivElement, parsed: ParsedClock, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;
declare function renderClockForExport(container: HTMLDivElement, parsed: ParsedClock, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

/** Run one update pass over every clock row inside `root`. */
declare function tickClocks(root?: ParentNode): void;
/**
 * Update `root` immediately, then (once per page) register a single 1s interval
 * that re-scans the whole document. Idempotent — safe to call on every render /
 * route change. No-op with no DOM.
 */
declare function startClocks(root?: ParentNode): void;

/**
 * A `UTC`/`GMT` fixed-offset token → minutes east of UTC, or null when it is not
 * one. Accepts bare `UTC`/`GMT` (→ 0), `UTC+1`, `UTC-7`, `UTC+5:30`, and the
 * unpunctuated `UTC+0530`. `GMT` is treated as an exact synonym of `UTC`. The
 * range is clamped to the real-world span (−12:00 … +14:00); anything outside is
 * rejected (returns null) so a typo like `UTC+99` falls through to an error
 * rather than rendering a nonsense clock.
 */
declare function parseFixedOffset(token: string): number | null;
/** A fixed offset (minutes east of UTC) → its canonical label (`UTC+5:30`, `UTC−7`, `UTC`). */
declare function formatOffsetLabel(offsetMin: number): string;

/** One resolvable place: a canonical display city and the IANA zone it maps to. */
interface GazetteerEntry {
    /** Canonical display city, e.g. "New York". */
    readonly city: string;
    /** IANA zone, e.g. "America/New_York". */
    readonly zone: string;
}
/** Normalize a name for matching: lowercase, fold accents, collapse whitespace. */
declare function normalizePlace(name: string): string;
/** The outcome of resolving a bare place name against the gazetteer. */
type PlaceResolution = {
    readonly kind: 'ok';
    readonly zone: string;
    readonly city: string;
} | {
    readonly kind: 'ambiguous';
    readonly candidates: readonly GazetteerEntry[];
} | {
    readonly kind: 'unknown';
    readonly suggestion: string | null;
};
/**
 * Resolve a bare place name (NOT an IANA id or UTC offset — the parser handles
 * those first) to a zone. Exact/alias hit → `ok`; a name mapping to multiple
 * zones → `ambiguous` with the candidates; nothing close → `unknown` with an
 * optional did-you-mean.
 */
declare function resolvePlace(name: string): PlaceResolution;
/** One autocomplete suggestion: a city, the zone it resolves to, and its live offset. */
interface ZoneSuggestion {
    readonly city: string;
    readonly zone: string;
    /** Current UTC offset label (`UTC+1`), computed live at `nowMs`. */
    readonly offsetLabel: string;
}
/**
 * Search the gazetteer for editor autocomplete. Matches `query` against city
 * names, aliases, and raw IANA text; ranks exact → prefix → substring, then
 * alphabetically. Offsets are computed live at `nowMs` so the dropdown shows the
 * current UTC offset next to each candidate. Returns up to `limit` results.
 */
declare function searchZones(query: string, nowMs: number, limit?: number): ZoneSuggestion[];

/** A named part annotation (`chest e: Primary` + bare-body notes). */
interface BodyPart {
    /** Canonical part name as written (label text). */
    readonly name: string;
    /** Tag metadata — keys are `tagAttrKey(group)` (e.g. `{ effort: 'Primary' }`). */
    readonly metadata: Readonly<Record<string, string>>;
    /** Bare indented body lines (markdown-light; `- ` bullets normalized). */
    readonly notes: readonly string[];
    readonly lineNumber: number;
    /**
     * Optional anatomical side (patient's own left/right) from a `left `/`right `
     * prefix, e.g. `right pec`. Aims the leader at just that side's component.
     */
    readonly side?: 'left' | 'right';
}
type BodyView = 'front' | 'back';
type BodySex = 'male' | 'female';
interface BodyOptions {
    /** Figure form: `muscle` (default) · `skin` · `skeletal` (reserved). */
    readonly form: 'muscle' | 'skin' | 'skeletal';
    /** `male` (default) · `female`. */
    readonly sex: BodySex;
    /** Requested views in declaration order — `['front']` default; both when the
     *  diagram names `front` and `back` (rendered side by side). */
    readonly views: readonly BodyView[];
    /** True when `no-legend` — hide the tag legend. */
    readonly noLegend: boolean;
    /** True when `no-title` — hide the diagram title. */
    readonly noTitle: boolean;
    /** §1.9 fill family (`fill-solid` / `fill-outline`); absent ⇒ default fill. */
    readonly fillMode?: FillMode;
}
interface ParsedBody {
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly options: BodyOptions;
    readonly tagGroups: readonly TagGroup[];
    readonly parts: readonly BodyPart[];
    readonly diagnostics: readonly DgmoError[];
    readonly error?: DgmoError;
}
/** A resolvable catalog entry: its path geometry + a baked leader anchor. */
interface BodyPartGeometry {
    readonly paths: readonly string[];
    /** Union centroid — used for gutter side (L/R) + vertical ordering. */
    readonly anchor: {
        readonly x: number;
        readonly y: number;
    };
    /**
     * Centroids of each disjoint muscle component (e.g. left + right pec). The
     * renderer aims a leader at whichever component sits nearest the label, so a
     * bilateral muscle connects to the side it's labelled on — not the midline.
     */
    readonly centers?: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
    }>;
}
/** One figure: silhouette + muscle geometry + catalog lookup. */
interface BodyFigure {
    /** SVG viewBox, e.g. `"0 0 724 1448"`. */
    readonly viewBox: string;
    /** True visible extent of the figure (outline + head + hair) in viewBox
     *  coords — used to align/scale figures by real body size, not the padded
     *  viewBox, so front/back line up exactly. */
    readonly contentBox: {
        readonly x: number;
        readonly y: number;
        readonly w: number;
        readonly h: number;
    };
    /** Silhouette outline path `d`. */
    readonly outline: string;
    /** Every muscle path `d` (gray base fill). */
    readonly base: readonly string[];
    /** Head silhouette path(s) — excluded from `outline`; used by skin form. */
    readonly headPaths: readonly string[];
    /** Hair path(s) — drawn atop the head in skin form. */
    readonly hairPaths: readonly string[];
    /** Catalog: canonical name (fine or slug-group) → geometry + anchor. */
    readonly parts: Readonly<Record<string, BodyPartGeometry>>;
}

declare function parseBody(content: string, palette?: PaletteColors): ParsedBody;

declare function renderBody(container: HTMLDivElement, parsed: ParsedBody, palette: PaletteColors, _isDark: boolean, _onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions, tagOverride?: string): void;
declare function renderBodyForExport(container: HTMLDivElement, parsed: ParsedBody, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, tagOverride?: string): void;

interface ParsedLiveLink {
    readonly type: 'live-link';
    /**
     * The headline. `null` for the shorthand form (`live-link <id>`), where the
     * title slot carries the target instead of a name — see §38.3.
     */
    readonly title: string | null;
    readonly titleLineNumber: number;
    /**
     * The diagram id, resolved through the shared reference parser. `null` when
     * absent or unparseable. We store the ID and not the URL on purpose:
     * everything downstream fetches by id, and keeping the raw string too would
     * give two representations of one fact.
     */
    readonly id: string | null;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseLiveLink(content: string): ParsedLiveLink;

/**
 * The reference card for one pointer.
 *
 * Two forms (§38.3), and the difference is not cosmetic: the shorthand has no
 * title, so the ID becomes the headline. A card whose headline is blank reads
 * as broken rather than brief.
 */
declare function renderLiveLinkCard(parsed: ParsedLiveLink, palette: PaletteColors, theme: 'light' | 'dark' | 'transparent'): string;

/** Render face. `bar` is the default (no mode flag). */
type GoalMode = 'bar' | 'thermometer' | 'gauge';
interface GoalOptions {
    /** Hide the `%` label. */
    readonly noPercent: boolean;
    /** Hide the raw `now / target` label. */
    readonly noValue: boolean;
    /** Full-saturation fill instead of the 25% tint. */
    /** §1.9 fill family; undefined ⇒ canonical 25% tint. */
    readonly fillMode: 'solid' | 'outline' | undefined;
    /** Hide the banner title. */
    readonly noTitle: boolean;
    /** Disable auto traffic-light fill color (fall back to the palette color). */
    readonly noAutoColor: boolean;
    /** Suppress the `note` description block even when one is present. */
    readonly noNote: boolean;
}
interface ParsedGoal {
    readonly type: 'goal';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    /** Optional free-text caption shown under the value (via `note <text>`). */
    readonly description: string | null;
    readonly mode: GoalMode;
    /** Current value (raw; may be negative or exceed target). */
    readonly now: number;
    /** Goal value. `0` when missing/invalid — the renderer draws a 0% shell. */
    readonly target: number;
    /** False when `target` was missing or ≤ 0 (an error was emitted). */
    readonly hasTarget: boolean;
    /** Resolved trailing-token / `color:` hex, if any. */
    readonly color?: string;
    readonly options: GoalOptions;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseGoal(content: string, palette?: PaletteColors): ParsedGoal;

declare function renderGoal(container: HTMLDivElement, parsed: ParsedGoal, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;
declare function renderGoalForExport(container: HTMLDivElement, parsed: ParsedGoal, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

type BracketMode = 'single-elim' | 'double-elim';
/** One authored match line. `p1` is left of the keyword (= winner if decided). */
interface RawMatch {
    /** Left operand — the winner for a `beats` line. */
    readonly p1: string;
    /** Right operand — the loser for a `beats` line. */
    readonly p2: string;
    /** True for `beats` (decided); false for `vs` (pending). */
    readonly decided: boolean;
    /** Cosmetic score text (`2-1`), if present. Never changes the winner (§3). */
    readonly score: string | null;
    /** Owning side label, or null for an indent-0 championship / single ladder. */
    readonly side: string | null;
    /** Home competitor for this match (`@ Name`), or null. */
    readonly home: string | null;
    /** Prose commentary lines indented under the match (`- ` → •, inline md). */
    readonly commentary: readonly string[];
    readonly lineNumber: number;
}
/** A `seed N Name` declaration (seeded mode only). */
interface RawSeed {
    readonly seed: number;
    readonly name: string;
    readonly side: string | null;
    readonly lineNumber: number;
}
interface BracketSide {
    readonly label: string;
    /** Resolved trailing-token color for the side, if any. */
    readonly color?: string;
}
/** A round/column: its name plus an optional color (tints the label + column). */
interface RoundDef {
    readonly name: string;
    readonly color?: string;
}
interface ParsedBracket {
    readonly type: 'bracket';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly mode: BracketMode;
    /** True when any `seed` line was present → full-skeleton (day-0) rendering. */
    readonly seeded: boolean;
    /** Column definitions from `rounds` (entry round → inner), each colorable. */
    readonly roundNames: readonly RoundDef[];
    readonly sides: readonly BracketSide[];
    readonly matches: readonly RawMatch[];
    readonly seeds: readonly RawSeed[];
    /** Tag groups (block/org idiom) — a competitor's tag colors its box outline. */
    readonly tagGroups: readonly TagGroup[];
    /** competitor name → its metadata (`{ tk: 'MLB Ballpark' }`). */
    readonly competitorMeta: ReadonlyMap<string, Record<string, string>>;
    /** Resolved active tag group name (drives outline color + legend), or null. */
    readonly activeTag: string | null;
    /** Hide the tag legend. */
    readonly noLegend: boolean;
    /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
    readonly legendInline?: boolean;
    /** Suppress round/column labels (`no-round`). */
    readonly noRounds: boolean;
    /**
     * Winner accent color override; default blue. Set by a trailing color token
     * on the title line (§1.5, canonical) or the legacy `accent <color>`
     * directive — the title-line token wins on conflict.
     */
    readonly accentColor?: string;
    /** §1.9 fill family (`fill-solid` / `fill-outline`); absent ⇒ 25% tint. */
    readonly fillMode?: FillMode;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseBracket(content: string, palette?: PaletteColors): ParsedBracket;

declare function renderBracket(container: HTMLDivElement, parsed: ParsedBracket, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;
declare function renderBracketForExport(container: HTMLDivElement, parsed: ParsedBracket, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

interface ConnectorPoint {
    readonly x: number;
    /** Origin y. For a decided child this is the winner box; for an undecided
     *  child `yA`/`yB` are its two boxes (renderer draws a `]` merge). */
    readonly y: number;
    readonly yA: number;
    readonly yB: number;
}
interface LaidMatch {
    readonly round: number;
    readonly side: string | null;
    /** Center x of this match's two boxes. */
    readonly x: number;
    /** Center y between the two boxes. */
    readonly y: number;
    readonly top: string | null;
    readonly bot: string | null;
    readonly winner: 'top' | 'bot' | null;
    readonly score: string | null;
    /** Both participants known but undecided (`vs`). */
    readonly pending: boolean;
    readonly isChampionship: boolean;
    /** Origin point of the connector into the top box (child winner), or null. */
    readonly topFrom: ConnectorPoint | null;
    readonly botFrom: ConnectorPoint | null;
    /** Prose commentary lines rendered under the match. */
    readonly commentary: readonly string[];
    /** Explicit home competitor (`@ Name`), or null. */
    readonly home: string | null;
    readonly lineNumber: number | null;
}
interface ColumnLabel {
    readonly x: number;
    readonly label: string;
    /** Round color — tints the label and shades the column. */
    readonly color?: string;
}
interface BracketLayout {
    readonly matches: readonly LaidMatch[];
    readonly columns: readonly ColumnLabel[];
    readonly sideLabels: readonly {
        x0: number;
        x1: number;
        label: string;
        color?: string;
    }[];
    readonly width: number;
    readonly height: number;
    readonly champion: string | null;
    readonly diagnostics: readonly DgmoError[];
}
declare function layoutBracket(parsed: ParsedBracket): BracketLayout;

type VCNodeKind = 'commit' | 'merge' | 'cherry';
type VCCommitType = 'normal' | 'highlight' | 'reverse';
type VCDirection = 'LR' | 'TB';
/** A node on the commit DAG (commit / merge / cherry-pick). */
interface VCNode {
    readonly key: number;
    readonly branch: string;
    /** Lane index (the branch's row/column). */
    lane: number;
    /** Topological position along the time axis. */
    readonly seq: number;
    readonly kind: VCNodeKind;
    /** Commit message (the bare line text), or null for an empty/dotless commit. */
    readonly message: string | null;
    readonly type: VCCommitType;
    /** Short SHA — shown only when authored via `id:` (else null). */
    readonly id: string | null;
    /** Release/ref tag rendered as a pill badge. */
    readonly tag: string | null;
    readonly lineNumber: number;
    /** Previous node on the same branch (straight lane segment). */
    prev: number | null;
    /** Branch-point parent (rounded elbow into the first commit of a new branch). */
    parent: number | null;
    /** Merge source tip. */
    mergeFrom: number | null;
    /** Cherry-pick source. */
    cherryFrom: number | null;
    /** Reverted commit (dashed link, reverse styling). */
    revertFrom: number | null;
    /** Squash source tip (dashed link; source commits ghosted). */
    squashFrom: number | null;
    /** Rebase: the solid copy this (faded) original was replayed to. */
    movedTo: number | null;
    /** Faded/dashed abandoned commit (rebase original / reset orphan / squash source). */
    ghost: boolean;
}
interface VCAheadBehind {
    readonly ahead: number;
    readonly behind: number;
}
interface VCBranch {
    readonly name: string;
    readonly lane: number;
    /** Named color token (§1.5), or null → auto by lane order. */
    readonly colorToken: string | null;
    /** Explicit `order:` override, or null → declaration order. */
    readonly order: number | null;
    /** Key of the branch's current tip node, or null if empty. */
    tip: number | null;
    /** Ahead/behind vs an `origin/<name>` ref, or null. */
    ab: VCAheadBehind | null;
}
interface VCRef {
    readonly name: string;
    /** Node the pointer sits on, or null if unresolved. */
    readonly atKey: number | null;
    /** Remote-tracking (origin/…) → ghosted pill. */
    readonly remote: boolean;
    /** HEAD pointer. */
    readonly head: boolean;
    readonly lineNumber: number;
}
interface VCNote {
    readonly num: number;
    readonly anchorKey: number | null;
    readonly text: string;
    readonly lineNumber: number;
}
interface VCOptions {
    readonly direction: VCDirection;
    readonly noLabels: boolean;
    readonly noLanes: boolean;
    readonly noHead: boolean;
}
interface ParsedVersionControl {
    readonly type: 'version-control';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly nodes: readonly VCNode[];
    readonly branches: readonly VCBranch[];
    readonly refs: readonly VCRef[];
    readonly notes: readonly VCNote[];
    readonly options: VCOptions;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

declare function parseVersionControl(content: string, palette?: PaletteColors): ParsedVersionControl;

declare function renderVersionControl(container: HTMLDivElement, parsed: ParsedVersionControl, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;
declare function renderVersionControlForExport(container: HTMLDivElement, parsed: ParsedVersionControl, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

interface RingLayer {
    readonly label: string;
    readonly lineNumber: number;
    /** Optional palette color name (red/green/blue/…). */
    readonly color?: string;
    /** Description lines — from bare pipe shorthand or indented body. */
    readonly description: readonly string[];
    /** Unconsumed pipe metadata (reserved for future use). */
    readonly metadata: Readonly<Record<string, string>>;
}
interface ParsedRing {
    readonly type: 'ring';
    readonly title: string;
    readonly titleLineNumber: number;
    /** Source order: layers[0] = innermost (filled disc); last = outermost ring. */
    readonly layers: readonly RingLayer[];
    readonly options: Readonly<Record<string, string>>;
    readonly diagnostics: readonly DgmoError[];
    readonly error: string | null;
}

/**
 * Parse a `.dgmo` ring diagram document.
 *
 * Top of file = innermost ring (rendered as a filled disc).
 * Last layer in source = outermost ring.
 */
declare function parseRing(content: string): ParsedRing;

/**
 * Render a ring diagram into the given container.
 */
declare function renderRing(container: HTMLDivElement, parsed: ParsedRing, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;
/**
 * Render for CLI/export (no click handlers).
 */
declare function renderRingForExport(container: HTMLDivElement, parsed: ParsedRing, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

/** Runtime color mode for a treemap. Default resolved from source; the app's
 *  legend/settings switcher overrides it live without editing source. */
type TreemapColorMode = 'tag' | 'heat' | 'branch';
interface TreemapNode {
    readonly id: string;
    readonly label: string;
    /**
     * Leaf size = the bare trailing number. `undefined` for branches (the layout
     * auto-sums descendants) and for value-less leaves (treated as 0 + a warning).
     */
    value?: number;
    /** Optional per-node heat metric (`heat:`), drives the color-by-value ramp. */
    heat?: number;
    readonly metadata: Record<string, string>;
    readonly children: TreemapNode[];
    readonly lineNumber: number;
}
interface TreemapOptions {
    /** Label for the heat ramp (`heat <Label> …`). */
    heatLabel?: string;
    /** Explicit ramp colors peeled from the `heat` directive (0–2, named only). */
    readonly heatColors: string[];
    /** `depth N` — render budget (interactive only); undefined = unlimited. */
    maxDepth?: number;
    noValues: boolean;
    noPercent: boolean;
    noHeaders: boolean;
    noLegend: boolean;
    /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
    legendInline?: boolean;
    /** §1.9 fill family; undefined ⇒ canonical 25% tint. */
    fillMode: 'solid' | 'outline' | undefined;
    /** `radial` — render as a sunburst (concentric rings) instead of rectangles. */
    radial: boolean;
}
interface ParsedTreemap {
    readonly type: 'treemap';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    readonly roots: TreemapNode[];
    readonly tagGroups: TagGroup[];
    /** True when any `heat:` value or a `heat` directive was declared. */
    readonly hasHeat: boolean;
    /** Raw `active-tag` directive value (§24C.6) — source-level pre-selection of
     *  the resting color dimension. `undefined` = directive absent. */
    activeTag?: string;
    /** Line of the `active-tag` directive (diagnostics anchor). */
    activeTagLineNumber?: number;
    /** Source-declared default color mode. Resolution (decision #48): the
     *  `active-tag` directive when it names a known dimension, else the
     *  universal heat > tag > branch precedence (map §24B.4 / b&l §13.9). */
    readonly defaultColorMode: TreemapColorMode;
    readonly options: TreemapOptions;
    readonly diagnostics: DgmoError[];
    readonly error: string | null;
}

declare function parseTreemap(content: string, palette?: PaletteColors): ParsedTreemap;

interface TreemapRenderOptions {
    /** Color mode override (app's runtime switcher). Defaults to source. */
    colorMode?: TreemapColorMode;
    /** Render budget (interactive only). Export omits it → full tree. */
    maxDepth?: number;
    /** Shift the branch-hue index so a drilled-into view keeps the color it had
     *  when expanded (the re-rooted node would otherwise become index 0 = the
     *  first hue). Set to the drilled branch's original top-level index. */
    colorOffset?: number;
    /** Click handler for drillable cells (app interactivity). */
    onClickItem?: (lineNumber: number) => void;
    /** Color-mode switch fired when a legend pill is clicked (app interactivity).
     *  The mode switcher is baked into the legend (clickable group pills), so the
     *  app no longer renders a separate overlay control. */
    onSelectMode?: (mode: TreemapColorMode) => void;
    exportMode?: boolean;
}
/** Render for CLI/export (full tree, no drill chrome). */
declare function renderTreemapForExport(container: HTMLDivElement, parsed: ParsedTreemap, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, options?: TreemapRenderOptions): void;
declare function renderTreemap(container: HTMLDivElement, parsed: ParsedTreemap, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, options?: TreemapRenderOptions): void;

interface TreemapRadialRenderOptions {
    /** Color mode override (app's runtime switcher). Defaults to source. */
    colorMode?: TreemapColorMode;
    /** Interactive render budget. Export omits it → full tree. */
    maxDepth?: number;
    /** Shift the branch-hue index (drilled-into view keeps its expanded hue). */
    colorOffset?: number;
    exportMode?: boolean;
}
/** Render for CLI/export (full tree, no interactive chrome). */
declare function renderTreemapRadialForExport(container: HTMLDivElement, parsed: ParsedTreemap, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, options?: TreemapRadialRenderOptions): void;
declare function renderTreemapRadial(container: HTMLDivElement, parsed: ParsedTreemap, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, options?: TreemapRadialRenderOptions): void;

interface TreemapCell {
    /** Original parsed node, or null for the synthetic root. */
    readonly node: TreemapNode | null;
    readonly label: string;
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
    /** 1-based depth within the laid-out (post-drill) tree. */
    readonly depth: number;
    /** Summed value (d3 rollup). */
    readonly value: number;
    /** Has children AND is drawn as a container (depth below the cap). */
    readonly isContainer: boolean;
    /** Has children but sits AT the depth cap — a solid drillable block. */
    readonly isCollapsed: boolean;
    /** Index of the top-level ancestor (drives branch-mode hue). */
    readonly topIndex: number;
    readonly pctOfRoot: number;
    readonly pctOfParent: number;
    /** Own heat, else the mean of descendant leaf heats; undefined if none. */
    readonly heat?: number;
    /** Path of labels from the laid-out root (for tooltips / data-node-path). */
    readonly path: readonly string[];
    readonly lineNumber?: number;
}
interface TreemapLayoutResult {
    readonly cells: readonly TreemapCell[];
    readonly total: number;
}
interface TreemapLayoutOptions {
    readonly width: number;
    readonly height: number;
    /** Top gutter reserved for parent header bars (0 when headers off). */
    readonly headerH: number;
    readonly paddingInner?: number;
    readonly paddingOuter?: number;
    /** Render budget; nodes at this depth collapse to solid blocks. */
    readonly maxDepth?: number;
}
declare function layoutTreemap(roots: readonly TreemapNode[], opts: TreemapLayoutOptions): TreemapLayoutResult;

/** A positioned sunburst arc. Reuses every geometry-NEUTRAL field of
 *  `TreemapCell`, swapping the 4 rect coords for polar `{start/endAngle,
 *  inner/outerR}`. */
interface RadialCell {
    /** Original parsed node, or null for the synthetic root. */
    readonly node: TreemapNode | null;
    readonly label: string;
    /** Radians, clockwise, 0 = 12 o'clock (d3.arc convention). */
    readonly startAngle: number;
    readonly endAngle: number;
    readonly innerR: number;
    readonly outerR: number;
    /** 1-based depth (ring index; depth 1 = first ring outward from the disc). */
    readonly depth: number;
    readonly value: number;
    /** Has children (drawn as an inner ring with its own outer rings). */
    readonly isContainer: boolean;
    /** Always false for static export (full tree); kept for TreemapCell parity. */
    readonly isCollapsed: boolean;
    /** Index of the top-level ancestor (drives branch-mode hue). */
    readonly topIndex: number;
    readonly pctOfRoot: number;
    readonly pctOfParent: number;
    /** Own heat, else the mean of descendant leaf heats; undefined if none. */
    readonly heat?: number;
    /** Path of labels from the laid-out root (for tooltips / data-node-path). */
    readonly path: readonly string[];
    readonly lineNumber?: number;
}
interface RadialLayoutResult {
    readonly cells: readonly RadialCell[];
    /** Grand total (sum of all leaf values). */
    readonly total: number;
    /** Radius of the center disc (title + total holder). */
    readonly discRadius: number;
    /** Deepest ring depth actually present (0 when empty). */
    readonly maxDepthReached: number;
    /** True when `roots` exist but the grand total is 0 (all-zero leaves) —
     *  the renderer draws an empty-state marker in the disc, no arcs. */
    readonly isEmpty: boolean;
}
interface RadialLayoutOptions {
    /** Outer radius available for the whole sunburst (disc + rings). */
    readonly radius: number;
    /** Center disc radius; defaults to a sensible fraction of `radius`. */
    readonly discRadius?: number;
    /** Interactive render budget; static export leaves it Infinity (full tree). */
    readonly maxDepth?: number;
}
declare function layoutTreemapRadial(roots: readonly TreemapNode[], opts: RadialLayoutOptions): RadialLayoutResult;

/** A single block. Becomes a container when `grid` is present. */
interface BlockNode {
    readonly id: string;
    readonly label: string;
    /** Column span (≥ 1). Resolved/clamped during the layout-inference pass. */
    span: number;
    /** Authored `collapsed` flag — container starts folded (collapse-bar). */
    collapsed: boolean;
    readonly metadata: Record<string, string>;
    readonly lineNumber: number;
    /** Present iff this block is a container (has an indented sub-grid). */
    grid?: BlockGrid;
}
/** A deliberate empty cell (`_`), reserving grid space with no block. */
interface EmptyCell {
    readonly empty: true;
    span: number;
}
type BlockCell = BlockNode | EmptyCell;
interface BlockGrid {
    /** Explicit `columns N`, or null until the inference pass resolves it from
     *  the widest row. After parse this is always a positive integer. */
    cols: number | null;
    readonly rows: BlockCell[][];
}
interface BlockOptions {
    /** `no-legend` — hide the tag legend. */
    noLegend: boolean;
    /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
    legendInline?: boolean;
    /** §1.9 fill family: 'solid' | 'outline'; absent ⇒ canonical 25% tint. */
    fillMode?: 'solid' | 'outline';
}
interface ParsedBlock {
    readonly type: 'block';
    readonly title: string | null;
    readonly titleLineNumber: number | null;
    /** The top-level grid (rows of cells; containers nest their own grids). */
    readonly top: BlockGrid;
    readonly tagGroups: TagGroup[];
    readonly options: BlockOptions;
    readonly diagnostics: DgmoError[];
    readonly error: string | null;
}

declare function parseBlock(content: string, palette?: PaletteColors): ParsedBlock;

interface BlockRenderOptions {
    /** Block ids to render folded (app runtime collapse on top of authored). */
    collapsed?: ReadonlySet<string>;
    /** Click handler for a container header (app collapse/expand). */
    onToggle?: (id: string, lineNumber: number) => void;
    exportMode?: boolean;
}
declare function renderBlockForExport(container: HTMLDivElement, parsed: ParsedBlock, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, options?: BlockRenderOptions): void;
declare function renderBlock(container: HTMLDivElement, parsed: ParsedBlock, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions, options?: BlockRenderOptions): void;
/** The ids of containers authored with the `collapsed` flag — the app seeds its
 *  live collapsed set from this so authored folds are the initial state yet stay
 *  user-toggleable. */
declare function authoredCollapsedIds(parsed: ParsedBlock): Set<string>;

interface BlockLayoutItem {
    type: 'leaf' | 'container' | 'collapsed' | 'empty';
    x: number;
    y: number;
    w: number;
    h: number;
    label?: string;
    node?: BlockNode;
    lineNumber?: number;
    /** Container children (a nested layout). */
    inner?: BlockLayoutItem[];
}
interface BlockLayoutResult {
    width: number;
    height: number;
    items: BlockLayoutItem[];
}
interface BlockLayoutOptions {
    /** Block ids rendered folded (authored `collapsed` + app runtime toggles). */
    collapsed?: ReadonlySet<string>;
}
declare function layoutBlock(grid: BlockGrid, opts?: BlockLayoutOptions): BlockLayoutResult;

/** True when the first non-blank/non-comment line declares `map`. */
declare function looksLikeMap(content: string): boolean;
declare function parseMap(content: string, palette?: PaletteColors): ParsedMap;

declare function resolveMap(parsed: ParsedMap, data: MapData): ResolvedMap;

/** Load + memoize the four map assets (Node). Throws if none of the candidate
 *  locations contain them, or if a loaded asset fails shape validation. A
 *  rejected load is NOT cached (#7): the memo is cleared on failure so a later
 *  call can retry rather than inheriting a poisoned promise. */
declare function loadMapData(): Promise<MapData>;

/** A subtle gazetteer city dot for basemap orientation (§24B `no-cities`). Just
 *  a position + radius; the renderer paints it muted/low-opacity. No label, no
 *  interactivity — purely decorative context. */
interface MapLayoutCityDot {
    readonly cx: number;
    readonly cy: number;
    readonly r: number;
}

interface MapLayoutRegion {
    readonly id: string;
    readonly d: string;
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
interface MapLayoutInset {
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
    readonly contextLand?: {
        readonly d: string;
        readonly fill: string;
    };
}
/** Post-projection non-uniform stretch applied to GLOBAL fits (fill-the-canvas).
 *  `null` for regional fits. The geo-query applies the forward form when
 *  projecting and the inverse before `projection.invert`. Mirrors the `stretch`
 *  closure used for the path stream:  px = ox + (x - bx0) * sx. */
interface MapLayoutStretch {
    readonly sx: number;
    readonly sy: number;
    readonly ox: number;
    readonly oy: number;
    readonly bx0: number;
    readonly by0: number;
}
interface MapLayoutPoi {
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
    readonly isOrigin: boolean;
    readonly routeNumber?: number;
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
interface MapLayoutCluster {
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
interface MapLayoutLeg {
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
interface PlacedLabel {
    readonly x: number;
    readonly y: number;
    readonly text: string;
    readonly anchor: 'start' | 'middle' | 'end';
    readonly color: string;
    readonly halo: boolean;
    /** Halo/outline colour — the OPPOSITE lightness of `color`, so the text reads
     *  whether it sits on its fill or overflows onto a different-coloured area. */
    readonly haloColor: string;
    readonly leader?: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    };
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
    readonly calloutDot?: {
        x: number;
        y: number;
        color: string;
    };
    readonly lineNumber: number;
}

/** A drawn river centerline — an open stroked path (no fill). */
interface MapLayoutRiver {
    readonly d: string;
    readonly color: string;
    readonly width: number;
}
/** A drawn mountain-range relief shape — a projected polygon path. The renderer
 *  unions these into one clip and rules horizontal hachure lines through them. */
interface MapLayoutRelief {
    readonly d: string;
}
/** The shared hachure style for the relief lines. `null` when relief is off or
 *  no range survives the gates. */
interface MapLayoutReliefHatch {
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
interface MapLayoutCoastlineStyle {
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
interface MapLayout {
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
interface LayoutOptions {
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
/** The map's water / backdrop colour for a palette — the single source of truth
 *  shared by the renderer's `<rect>` fill and any host wrapper that needs to
 *  match it (so letterbox gaps around the SVG don't show a stray band). Always a
 *  VERY faded blue — uniform whether or not a colouring dimension is active — so
 *  it reads as water without competing with saturated blue/green data hues.
 *  `_dataActive` is retained for signature stability (the sea no longer changes
 *  with data; only neighbour land recedes — see layout's `foreignFill`). */
declare function mapBackgroundColor(palette: PaletteColors, isDark?: boolean, _dataActive?: boolean): string;
/** The map's neutral (unscored/untagged) LAND colour — the base every region
 *  blends from. Exported so a host can DIM a region to plain land (rather than
 *  lowering opacity, which would let the water show through and make the shape
 *  read as ocean). Matches the layout's `neutralFill`. Always a VERY faded green
 *  — uniform whether or not data is active — so saturated tag/score tints read
 *  clearly against it. `_dataActive` is retained for signature stability. */
declare function mapNeutralLandColor(palette: PaletteColors, isDark: boolean, _dataActive?: boolean): string;
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
declare function albersSkewFallback(resolved: ResolvedMap, data: MapData, width: number, height: number): boolean;
declare function layoutMap(resolvedIn: ResolvedMap, data: MapData, size: Size, opts: LayoutOptions): MapLayout;

/** Render a resolved map into `container` (d3-selection appends an `<svg>`). */
declare function renderMap(container: HTMLDivElement, resolved: ResolvedMap, data: MapData, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions, 
/** Live override of the active colouring group (interactive legend flip). */
activeGroupOverride?: string | null): void;
/** Export wrapper (no click handler) — matches the structured-renderer contract. */
declare function renderMapForExport(container: HTMLDivElement, resolved: ResolvedMap, data: MapData, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

/** The map's intrinsic projected aspect (width / height) for a resolved map.
 *
 *  Measured by fitting the projection + fit target (the SAME `buildMapProjection`
 *  output the renderer draws with) into a square reference box and reading the
 *  projected bounds of the fit target. `fitSize` scales uniformly, so the ratio is
 *  independent of the box size (see the reference-box invariance test).
 *
 *  Returns {@link FALLBACK_ASPECT} (3:2) if the result is non-finite or ≤ 0 — the
 *  helper never emits a NaN/0/Infinity aspect. */
declare function mapContentAspect(resolved: ResolvedMap, data: MapData, 
/** Square reference box for the measurement. Uniform `fitSize` scaling makes the
 *  result invariant to this value; exposed only so tests can assert that. */
ref?: number): number;
/** Content-aware export dimensions for a map: `width` fixed at `baseWidth`,
 *  `height` derived from the clamped intrinsic aspect, with a minimum-map-band
 *  floor for very wide extents. `preferContain` is true when the clamp or floor
 *  forced the canvas off the content aspect — the renderer then contain-fits
 *  (letterbox) instead of stretching, so the off-aspect canvas doesn't re-distort. */
interface MapExportDimensions {
    readonly width: number;
    readonly height: number;
    readonly preferContain: boolean;
}
declare function mapExportDimensions(resolved: ResolvedMap, data: MapData, baseWidth?: number, 
/** WYSIWYG override (app export): the live preview pane's displayed aspect
 *  (width / height). When provided, the canvas adopts it verbatim and
 *  stretch-fills (no clamp, no contain) so the PNG matches exactly what's on
 *  screen. Omitted by every headless consumer (CLI / MCP / SSG / Obsidian),
 *  which keep the intrinsic-aspect sizing below. */
aspectOverride?: number): MapExportDimensions;

/** Nearest gazetteer city to a point: the real haversine distance, plus the
 *  canonical name + ISO + (US-only) subdivision for token shaping. `lon`/`lat`
 *  are the city's own gazetteer coordinates (so callers can mark it on the map,
 *  distinct from the inspected point). */
interface NearestCity {
    readonly name: string;
    readonly iso: string;
    readonly sub?: string;
    readonly distanceKm: number;
    readonly lon: number;
    readonly lat: number;
}
/** A region declaration with its canonical/primary form plus bare alternates
 *  (behind the card's "other forms" expander). */
interface RegionToken {
    /** Explicit scoped form, shown first (`Florida US-FL` / `France FR`). */
    readonly primary: string;
    /** Bare forms (bare ISO, bare code, bare name). */
    readonly alternates: string[];
}
/** Paste-ready DGMO tokens for one inspected point — each round-trips through the
 *  map parser with zero diagnostics (the app inserts verbatim, never synthesizes
 *  syntax). */
interface ResultTokens {
    /** Positional POI line, e.g. `poi 40.7608 -111.891` (NEVER `@lat,lon`). */
    readonly coordPoiLine: string;
    /** US-state region tokens — null when the click isn't in a US state. */
    readonly state: RegionToken | null;
    /** Country region tokens — null over open ocean (no country). */
    readonly country: RegionToken | null;
    /** Scoped city token (`New York US-NY` / `Paris FR`), or a bare ambiguous name. */
    readonly city: {
        readonly token: string;
        readonly ambiguous: boolean;
    } | null;
}
/** The single unified Inspect result. */
interface ResultCard {
    readonly lonLat: [number, number];
    readonly country: {
        iso: string;
        name: string;
    } | null;
    readonly state: {
        iso: string;
        name: string;
    } | null;
    readonly nearestCity: NearestCity | null;
    readonly tokens: ResultTokens;
}
/** A gazetteer city projected to screen pixels for the all-cities overlay. */
interface ProjectedCity {
    readonly name: string;
    readonly iso: string;
    readonly sub?: string;
    readonly lon: number;
    readonly lat: number;
    readonly px: number;
    readonly py: number;
    readonly pop: number;
}
interface MapGeoQuery {
    /** Pixel → `[lon,lat]`, or null for an out-of-domain pixel. */
    invert(px: number, py: number): [number, number] | null;
    /** `[lon,lat]` → pixel, or null if it projects nowhere. */
    project(lonLat: readonly [number, number]): [number, number] | null;
    /** One click → the unified result card, or null if the pixel inverts to
     *  nothing (graceful "no location"). */
    locate(px: number, py: number): ResultCard | null;
    /** Culled + projected cities for the all-cities layer (population-primary). */
    cities(extent?: GeoExtent): ProjectedCity[];
    /** Layout-time, dimension-dependent diagnostics. They live on the geo-query
     *  (bound to the rendered layout) rather than the resolver. Callers merge them
     *  with `resolved.diagnostics`. (No producers currently — always empty.) */
    readonly diagnostics: readonly DgmoError[];
}
interface CreateMapGeoQueryOptions {
    readonly content: string;
    readonly width: number;
    readonly height: number;
    /** Injected map assets — same `MapData` the app passes to `renderMap`. */
    readonly data: MapData;
    /** Same palette/isDark the app renders with (geometry is palette-independent,
     *  but `layoutMap` mandates them). */
    readonly palette: PaletteColors;
    readonly isDark: boolean;
}
/** Construct a geo-query handle bound to the layout for `(content, width,
 *  height, data, palette, isDark)`. Deterministic: identical inputs ⇒ the same
 *  fitted projection the rendered SVG used, so inverted clicks align.
 *
 *  INVARIANT: this is the PREVIEW path — it never passes `preferContain`, so its
 *  layout matches the in-app preview (stretch-fill), where geo-query is used. It is
 *  NOT valid against a content-aware EXPORT canvas (which may set `preferContain` →
 *  contain-fit): the inverted positions would not match that export's pixels. If
 *  geo-query is ever pointed at an export canvas, thread `preferContain` through
 *  `CreateMapGeoQueryOptions` to keep the projection in sync. */
declare function createMapGeoQuery(opts: CreateMapGeoQueryOptions): MapGeoQuery;

/** Drag-source identity passed to `onMarkerDragStart`. */
type RaciDragSource = {
    kind: 'legend';
    marker: RaciMarker;
} | {
    kind: 'cell';
    marker: RaciMarker;
    taskId: string;
    roleId: string;
};
interface RaciInteractionHandlers {
    onClickLine?: (lineNumber: number) => void;
    /** Fires on `pointerdown` of a legend chip OR an in-cell marker slice. */
    onMarkerDragStart?: (source: RaciDragSource, event: PointerEvent) => void;
    /**
     * Suppress the in-SVG legend strip. The app overlays an HTML legend
     * for native HTML5 drag — SVG `<g> draggable=true` is unreliable.
     * PNG/SVG export keeps the legend by default.
     */
    hideLegend?: boolean;
    /**
     * Phase ids whose tasks should be hidden. The phase header still
     * renders with a "collapsed" chevron so the user can re-expand.
     */
    collapsedPhases?: ReadonlySet<string>;
    /**
     * Suppress the in-SVG title. The app paints its own HTML title
     * above the HTML legend bar so the visual order is title → legend
     * → matrix. PNG/SVG export keeps the title by default.
     */
    hideTitle?: boolean;
}
/**
 * Render a RACI / RASCI / DACI matrix into the given DOM container.
 * Layout is computed once and laid out as SVG; no animation.
 */
declare function renderRaci(container: HTMLDivElement, parsed: ParsedRaci, palette: PaletteColors, isDark: boolean, handlers?: RaciInteractionHandlers | ((lineNumber: number) => void), exportDims?: D3ExportDimensions): void;
declare function renderRaciForExport(container: HTMLDivElement, parsed: ParsedRaci, palette: PaletteColors, isDark: boolean, exportDims?: D3ExportDimensions): void;

/**
 * Set the markers on a cell to exactly `[marker]`, replacing whatever
 * was there. If `marker` is `null`, the cell is cleared (the role
 * assignment line is removed if it was the only marker; otherwise the
 * line stays with its other markers untouched — see `cellRemove` for
 * specific-marker removal semantics).
 *
 * Insertion point when the role assignment doesn't exist:
 *   - After the last existing role assignment under the task, OR
 *   - After the task's description block, OR
 *   - Immediately after the task line.
 *
 * Returns `null` for no-ops (the cell already contains `[marker]`).
 */
declare function cellReplace(content: string, parsed: ParsedRaci, taskId: string, roleId: string, marker: RaciMarker | null): string | null;
/**
 * Append `marker` to the cell, producing a combined-marker string
 * like `A R`. Idempotent — if `marker` is already present, returns
 * `null`. If the cell is empty (no existing role assignment line),
 * behaves like `cellReplace(content, ..., marker)`.
 */
declare function cellAppendMarker(content: string, parsed: ParsedRaci, taskId: string, roleId: string, marker: RaciMarker): string | null;
/**
 * Remove a single `marker` from the cell, OR all markers when
 * `marker` is `undefined`. If the cell becomes empty as a result,
 * the entire role-assignment line is dropped.
 *
 * Returns `null` for no-ops (e.g. removing a marker that wasn't
 * there).
 */
declare function cellRemove(content: string, parsed: ParsedRaci, taskId: string, roleId: string, marker?: RaciMarker): string | null;
/**
 * Cycle the cell's marker through the variant alphabet. Used by the
 * click-to-cycle interaction in `RACIPreview`. Cycle order:
 *
 *   blank → alphabet[0] → alphabet[1] → … → alphabet[n-1] → blank → …
 *
 * If the cell currently has multiple markers (e.g. `A R`), cycling
 * collapses to a single marker chosen as the *next* one after the
 * first existing marker — interpretation: "cycle from the dominant
 * marker." This keeps the affordance simple; combined-markers stay
 * the territory of drag-from-palette (per TD #10).
 */
declare function cellCycle(content: string, parsed: ParsedRaci, taskId: string, roleId: string, alphabet: ReadonlyArray<RaciMarker>): string | null;

/** Codes for variant-defining structural errors (always fire). */
declare const RACI_ERROR_CODES: {
    readonly MULTI_ACCOUNTABLE: "E_RACI_MULTI_ACCOUNTABLE";
    readonly DACI_MULTI_DRIVER: "E_DACI_MULTI_DRIVER";
    readonly DACI_MULTI_ACCOUNTABLE: "E_DACI_MULTI_ACCOUNTABLE";
    readonly INVALID_MARKER: "E_RACI_INVALID_MARKER";
    readonly UNEXPECTED_LINE: "E_RACI_UNEXPECTED_LINE";
    readonly MIXED_VARIANTS: "E_RACI_MIXED_VARIANTS";
};
/** Codes for warnings (suppressible chart-wide by the `no-rule-enforcement` directive). */
declare const RACI_WARNING_CODES: {
    readonly MISSING_ACCOUNTABLE: "W_RACI_MISSING_ACCOUNTABLE";
    readonly MISSING_RESPONSIBLE: "W_RACI_MISSING_RESPONSIBLE";
    readonly DACI_MISSING_DRIVER: "W_DACI_MISSING_DRIVER";
    readonly DACI_MISSING_ACCOUNTABLE: "W_DACI_MISSING_ACCOUNTABLE";
    readonly UNKNOWN_ROLE: "W_RACI_UNKNOWN_ROLE";
    readonly EMPTY_TASK: "W_RACI_EMPTY_TASK";
    readonly CONFLICTING_MARKERS: "W_RACI_CONFLICTING_MARKERS";
    readonly TOO_MANY_RESPONSIBLE: "W_RACI_TOO_MANY_RESPONSIBLE";
    readonly ORPHAN_ROLE: "W_RACI_ORPHAN_ROLE";
};
/** A constraint rule produces zero or more diagnostics for a single task. */
type ConstraintRule = (task: RaciTask) => DgmoError[];
interface VariantRuleSet {
    alphabet: ReadonlyArray<RaciMarker>;
    /**
     * Structural errors. Fire whenever `no-rule-enforcement` is off, like
     * the warning rules — kept as a separate bucket so callers (e.g. the
     * editor diagnostics panel) can style them with error severity.
     */
    errorRules: ConstraintRule[];
    /** Hygiene warnings — same suppression as errors. */
    warningRules: ConstraintRule[];
}
declare const VARIANTS: Readonly<Record<RaciVariant, VariantRuleSet>>;

declare function renderFlowchart(container: HTMLDivElement, graph: ParsedGraph, layout: LayoutResult$1, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}): void;
declare function renderFlowchartForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

interface LegendRenderOptions {
    palette: {
        bg: string;
        surface: string;
        text: string;
        textMuted: string;
    };
    isDark: boolean;
    /**
     * Width to wrap entries against (entries flow onto new rows past this).
     * Pass 0 when the caller CSS-centers a natural-width legend; a generous
     * fallback budget is used so a single row still fits on one line.
     */
    containerWidth: number;
    activeGroup?: string | null;
    className?: string;
    /**
     * Row alignment within `containerWidth`. `'center'` (default) matches the
     * historic top-center legend; `'left'` left-origins the row at x=0 so the
     * caller can translate it beside a left-aligned title (§1.9 `legend-inline`).
     */
    align?: 'center' | 'left';
}
interface LegendRenderResult {
    svg: string;
    height: number;
    /** Natural content width (px). Callers can use this for CSS-based centering. */
    width: number;
}
declare function renderLegendSvg(groups: readonly LegendGroupData[], options: LegendRenderOptions): LegendRenderResult;
declare function renderLegendSvgFromConfig(config: LegendConfig, state: LegendState, palette: LegendPalette & {
    isDark: boolean;
}, containerWidth: number): LegendRenderResult;

declare const SKETCH_VISUALS: {
    /** Air round the whole diagram. */
    readonly diagramPadding: 20;
    readonly titleY: 30;
    readonly titleFontSize: 20;
    readonly titleFontWeight: number;
    readonly nodeStrokeWidth: 1.5;
    readonly edgeStrokeWidth: 1.5;
    readonly arrowheadW: 10;
    readonly arrowheadH: 7;
    readonly dash: "6 3";
    /** A card's name. Shared, and it fits DOWN to `nodeLabelFontSizeMin` before
     *  it wraps — it used to be allowed up to 30 on a card with no rows, which is
     *  more than twice what any other chart type prints. */
    readonly nodeLabelFontSize: 13;
    readonly nodeLabelFontSizeMin: 11;
    /** A card's description rows. */
    readonly cardMetaFontSize: 11;
    /** A card's header band. */
    readonly cardHeaderHeight: 28;
    readonly bandLabelFontSize: 13;
    readonly bandLabelFontWeight: number;
    readonly bandLabelOpacity: 1;
    /** 11 — what boxes-and-lines prints. It was 12, the only edge label in the
     *  product at that size. */
    readonly edgeLabelFontSize: 11;
    /** The `palette.bg` halo painted under an edge label so the connector cannot
     *  cross its glyphs. Stroke, with `paint-order: stroke`. */
    readonly edgeLabelHaloWidth: 3;
    readonly cardRadius: 6;
    readonly containerRadius: 8;
};

interface SketchNodeColors {
    readonly fill: string;
    readonly stroke: string;
    readonly text: string;
}
/** How a sketch fills its shapes — the `fill-mode` option, verbatim. */
type SketchFillMode = 'solid' | 'outline' | undefined;
/**
 * 🔴 Containers are painted at this, over an opaque node fill. dgmo's own
 * number (`renderer.ts`), here so the app cannot pick a different one — it had
 * 0.12 against this 0.4, which is most of why a group read as a wash rather
 * than a frame.
 */
declare const CONTAINER_FILL_OPACITY = 1;
/** A container's outline, which is far softer than a node's — `boxes-and-lines`
 *  gives the same object exactly this. */
declare const CONTAINER_STROKE_OPACITY = 0.35;
/** And its stroke width: a plain 1, not a node's. */
declare const CONTAINER_STROKE_WIDTH = 1;
/**
 * A container's surface. 🔴 NEUTRAL, and never the group's tag colour.
 *
 * Sketch used to paint a whole group in its own tag at 0.4 — so a tagged group
 * was a wash of colour with everything inside it swimming in that wash, and a
 * sketch put beside a `boxes-and-lines` chart of the same content did not read
 * as the same product (reported 2026-08-27). `boxes-and-lines` never tints a
 * group; this is its expression, verbatim.
 *
 * ⚠️ What that costs: a container's OWN tag no longer shows in its fill. It is
 * still in the source, still cascades to the children inside it, and still
 * colours them — what is gone is the group-level wash.
 */
declare function sketchContainerFill(palette: PaletteColors, _isDark: boolean): string;
/**
 * Untagged shapes still read as filled cards, not empty outlines: a slight gray
 * tint (muted mixed into the bg) — subtle on light, a touch lighter than the bg
 * on dark.
 */
declare function sketchNeutralFill(palette: PaletteColors, isDark: boolean, fillMode: SketchFillMode): string;
/**
 * The colours one thing on a sketch wears, given what it carries.
 *
 * Returns a function rather than a value because every node on a board asks the
 * same question against the same active group, and resolving that group once is
 * the whole point.
 */
declare function sketchColors(opts: {
    readonly palette: PaletteColors;
    readonly isDark: boolean;
    readonly tagGroups: readonly TagGroup[];
    /** The group the legend says is active, or undefined to let dgmo choose. */
    readonly activeTagGroup?: string | null | undefined;
    readonly fillMode: SketchFillMode;
}): (metadata: Record<string, string>, isContainer?: boolean) => SketchNodeColors;

declare const FONT_FAMILY = "Inter, system-ui, Avenir, Helvetica, Arial, sans-serif";
declare const DEFAULT_FONT_NAME = "Inter";

/**
 * Which of the two shipped faces a run of text is drawn in.
 *
 * Only 400 and 700 exist — `fonts/` ships `Inter-Regular.ttf` and
 * `Inter-Bold.ttf`, and the app declares exactly those two `@font-face`
 * weights. An intermediate weight is therefore not an intermediate width: it
 * lands on one of the two faces, and which one is NOT simply "the nearest".
 * CSS font matching walks *upward* first for any weight above 500, so
 *
 *     400, 500        → the Regular face
 *     600, 700, 800   → the Bold face
 *
 * Verified by rasterising the same string at all four weights through resvg
 * with only these two TTFs loaded: the PNGs come out identical in exactly
 * those two groups. 600 is the most common emphasis weight in this codebase,
 * and reading it as regular is what left ~20 sites mis-measured after the
 * first sweep (issues 167, 168).
 *
 * Pass `bold` wherever the run is drawn at 600 or above — and only there.
 */
interface MeasureOpts {
    bold?: boolean;
}
/** Estimate rendered text width using Inter's proportional advance widths. */
declare function measureText(text: string, fontSize: number, opts?: MeasureOpts): number;
/**
 * Truncate text with a trailing ellipsis to fit within maxWidth.
 * Returns the original text if it already fits, or '' if even the
 * ellipsis alone won't fit.
 */
declare function truncateText(text: string, fontSize: number, maxWidth: number, opts?: MeasureOpts): string;

declare const LEGEND_HEIGHT = 28;
declare const LEGEND_PILL_PAD = 16;
declare const LEGEND_PILL_FONT_SIZE = 11;
declare const LEGEND_CAPSULE_PAD = 4;
declare const LEGEND_DOT_R = 4;
declare const LEGEND_ENTRY_FONT_SIZE = 10;
declare const LEGEND_ENTRY_DOT_GAP = 4;
declare const LEGEND_ENTRY_TRAIL = 8;
declare const LEGEND_GROUP_GAP = 12;
declare const LEGEND_MAX_ENTRY_ROWS = 3;
declare const LEGEND_GEAR_PILL_W: number;

declare function renderLegendD3(container: D3Sel, config: LegendConfig, state: LegendState, palette: LegendPalette, isDark: boolean, callbacks?: LegendCallbacks, containerWidth?: number): LegendHandle;

/**
 * The full advance width of one legend entry — dot, gap, label and trail.
 *
 * Public because a caller sizing `capsuleTrailingAddonWidth` has to reserve
 * room for something that will be DRAWN as an entry, and measuring it any other
 * way is a second implementation of `measureLegendText` plus four constants.
 */
declare function legendEntryWidth(value: string): number;
declare function controlsGroupCapsuleWidth(toggles: Array<{
    label: string;
}>): number;
declare function computeLegendLayout(config: LegendConfig, state: LegendState, containerWidth: number): LegendLayout;
declare function getLegendReservedHeight(config: LegendConfig, state: LegendState, containerWidth: number): number;

interface SectionMessageGroup {
    section: SequenceSection;
    messageIndices: number[];
}
interface SequenceRenderOptions {
    collapsedSections?: Set<number>;
    collapsedGroups?: Set<number>;
    exportWidth?: number;
    activeTagGroup?: string | null;
}
/**
 * Group messages by the top-level section that precedes them.
 * Messages before the first section are ungrouped (always visible).
 * Only top-level sections are collapsible — sections inside blocks are excluded.
 */
declare function groupMessagesBySection(elements: readonly SequenceElement[], messages: readonly SequenceMessage[]): SectionMessageGroup[];
interface RenderStep {
    type: 'call' | 'return';
    from: string;
    to: string;
    label: string;
    messageIndex: number;
    async?: boolean;
}
/**
 * Build an ordered render sequence from flat messages.
 * Uses a call stack to infer where returns should be placed:
 * returns appear after all nested sub-calls complete.
 */
declare function buildRenderSequence(messages: readonly SequenceMessage[]): RenderStep[];
interface Activation {
    participantId: string;
    startStep: number;
    endStep: number;
    depth: number;
}
/**
 * Compute activation rectangles from render steps.
 * Each call pushes onto the callee's stack; each return pops it.
 */
declare function computeActivations(steps: RenderStep[]): Activation[];
/**
 * Reorder participants based on explicit `position` overrides.
 * Positive positions are 0-based from the left; negative positions count from the right (-1 = last).
 * Unpositioned participants maintain their relative order, filling remaining slots.
 */
declare function applyPositionOverrides(participants: readonly SequenceParticipant[]): SequenceParticipant[];
/**
 * Order participants by first appearance in messages, then pull grouped
 * members adjacent.
 *
 * The baseline is first-occurrence order (spec §2.2 priority 3): the first
 * participant referenced by a message gets the leftmost column, regardless of
 * declaration order. A bare declaration line assigns a tag/type only — it does
 * NOT pin a column. Participants that never appear in any message fall back to
 * declaration order (priority 4) and are appended after the message-referenced
 * ones.
 *
 * When spatial `[Group]` boxes exist (priority 2), each group's members are
 * pulled adjacent at the group's first-appearance anchor, overriding their
 * individual appearance slots. With no groups this reduces to pure
 * appearance order.
 *
 * Explicit `position` overrides (priority 1) are handled separately by
 * `applyPositionOverrides`, which runs after this pass.
 */
declare function applyGroupOrdering(participants: readonly SequenceParticipant[], groups: readonly SequenceGroup[], messages?: readonly SequenceMessage[]): SequenceParticipant[];
/**
 * Render a sequence diagram into the given container element.
 */
declare function renderSequenceDiagram(container: HTMLDivElement, parsed: ParsedSequenceDgmo, palette: PaletteColors, isDark: boolean, _onNavigateToLine?: (line: number) => void, options?: SequenceRenderOptions): void;
/**
 * Build a mapping from each note's lineNumber to the lineNumber of its
 * associated message (the last message before the note in document order).
 * Used by the app to highlight the associated message when cursor is on a note.
 */
declare function buildNoteMessageMap(elements: readonly SequenceElement[]): Map<number, number>;

interface CollapsedView {
    participants: readonly SequenceParticipant[];
    messages: readonly SequenceMessage[];
    elements: readonly SequenceElement[];
    groups: readonly SequenceGroup[];
    /** Maps member participant ID → collapsed group name (as a virtual ParticipantId). */
    collapsedGroupIds: Map<ParticipantId, ParticipantId>;
}
/**
 * Project a parsed sequence diagram into a collapsed view.
 *
 * @param parsed - The immutable parsed sequence diagram
 * @param collapsedGroups - Set of group lineNumbers that should be collapsed
 * @returns A new CollapsedView with remapped participants, messages, elements, and groups
 */
declare function applyCollapseProjection(parsed: ParsedSequenceDgmo, collapsedGroups: Set<number>): CollapsedView;

/** Complete 16-entry Nord palette. */
declare const nord: {
    nord0: string;
    nord1: string;
    nord2: string;
    nord3: string;
    nord4: string;
    nord5: string;
    nord6: string;
    nord7: string;
    nord8: string;
    nord9: string;
    nord10: string;
    nord11: string;
    nord12: string;
    nord13: string;
    nord14: string;
    nord15: string;
};
/** Color name → Nord hex for inline `(color)` annotations. */
declare const colorNames: Record<string, string>;
/**
 * The canonical, closed set of color names accepted by the DGMO language.
 * See `docs/dgmo-language-spec.md` §1.5. Users cannot extend this list —
 * palettes only provide the per-theme hex values for these names.
 */
declare const RECOGNIZED_COLOR_NAMES: readonly ["red", "orange", "yellow", "green", "blue", "purple", "teal", "cyan", "gray", "black", "white"];
/**
 * Returns true iff `name` is one of the 11 recognized DGMO color names.
 */
declare function isRecognizedColorName(name: string): boolean;
/**
 * Resolves a recognized color name to its hex value for the active palette
 * (falling back to the built-in Nord defaults). Returns `null` for any
 * unrecognized input — including hex codes, CSS keywords like `pink`,
 * and typos. Callers MUST treat `null` as a parse error and emit a
 * diagnostic; do not silently fall back to the raw input.
 */
declare function resolveColor(color: string, palette?: {
    colors: Record<string, string>;
}): string | null;

/**
 * Stable diagnostic code for "this token is not one of the 11 named palette
 * colors" — covers both hex/CSS literals (emitted as `error`) and unrecognized
 * bare words like `crimson` (emitted as `warning`). Consumers that want to
 * HARD-BLOCK invalid colors regardless of severity (e.g. the MCP render gate)
 * filter on this code rather than re-deriving the rule.
 */
declare const INVALID_COLOR_CODE = "E_INVALID_COLOR";
/**
 * CSS / X11 color names that are NOT one of DGMO's 11 — mapped to their hex so
 * a "nearest valid color" hint can be computed. This is the blocklist that lets
 * the trailing-token rule tell an *intended-but-invalid* color (`pink`,
 * `crimson`, `navy`) apart from an ordinary label word (`Zinfandel`, `Blanc`):
 * a lowercase trailing token found here is flagged, anything else stays label
 * text. Our 11 valid names are deliberately excluded. Extend freely — it only
 * sharpens detection. (Case-sensitive lowercase, matching the §1.5 color rule.)
 */
declare const INVALID_CSS_COLOR_HEX: Readonly<Record<string, string>>;
/**
 * Best-effort nearest recognized color NAME for an unsupported hex value.
 * Matches by HUE (with a low-saturation cutoff routing to black/white/gray),
 * NOT raw RGB distance to the muted palette hexes — vivid LLM colors like a
 * `#3cb44b` green would otherwise snap to `gray` against a desaturated sage.
 * Returns null for non-hex input (CSS function/keyword colors, no RGB to read).
 * Used ONLY to enrich a diagnostic — never to silently accept the value.
 */
declare function nearestNamedColor(input: string): string | null;
/**
 * True iff `token` is an INTENDED-but-invalid color: a hex/`rgb()`/`hsl()`
 * literal, or a known CSS color name that isn't one of DGMO's 11. Lets the
 * trailing-token rule flag `Rosé pink` / `Foo #e6194b` while leaving genuine
 * label words (`Zinfandel`) untouched.
 */
declare function isInvalidColorToken(token: string): boolean;
/**
 * Build an `E_INVALID_COLOR` diagnostic for an intended-but-invalid trailing
 * color token, or return null if `token` isn't color-like (so it stays label
 * text). Severity is `warning` so the library degrades gracefully (the value
 * just keeps the word); the MCP render gate blocks on the code regardless.
 * Used by `extractColor` to close the trailing-token "silent swallow" gap.
 */
declare function invalidColorDiagnostic(token: string, line: number): DgmoError | null;
/**
 * Resolves a color name and pushes a warning diagnostic on failure.
 * Returns the hex string for valid names, or `undefined` for unknown
 * input (after pushing a diagnostic). Use this from parsers that have
 * a diagnostics array and a line number in scope.
 */
declare function resolveColorWithDiagnostic(color: string, line: number, diagnostics: DgmoError[], palette?: {
    colors: Record<string, string>;
}): string | undefined;
/** @deprecated Use getSeriesColors(palette) from '@/lib/palettes' instead. */
declare const seriesColors: string[];

/**
 * Which characters the bundled Inter cannot draw.
 *
 * Inter covers Latin, Greek and Cyrillic. It has no CJK, Devanagari, Tamil,
 * Arabic, Hebrew or Thai — and never did, upstream included. In a browser that
 * is harmless: `FONT_FAMILY` ends in `system-ui, …, sans-serif` and the browser
 * walks that chain per character, so a Japanese reader sees Japanese.
 *
 * 🔴 When rasterising it is not harmless. resvg resolves the whole family chain
 * against the fonts it was given, so text in a script the bundled font lacks
 * falls back to whatever system fonts resvg loaded — and if it loaded none, it
 * draws NOTHING. Not a .notdef box: nothing, silently, exit code 0. Measured
 * 2026-08-07 on `@diagrammo/dgmo-cli` 0.62.3 — a bar chart labelled 日本語
 * rasterised to pixels identical to one labelled with a Private Use codepoint
 * that exists in no font at all.
 *
 * That is why `loadSystemFonts` is now always on at both rasterising call sites.
 * This module covers what that fix cannot: a machine with no font for the script
 * — a bare CI container, most Docker images — still draws nothing, and the
 * output is silently wrong rather than loudly broken. So a diagram carrying
 * characters outside the bundled coverage is a PORTABILITY warning: it renders
 * here because this machine happens to have a font, and may not render there.
 *
 * Coverage is read from `fonts/coverage.json`, generated by
 * `scripts/build-fonts.mjs` from the real subset output — never hand-written,
 * so it cannot drift from the bytes actually shipped.
 */
/** A closed codepoint range, `[start, end]` inclusive. */
type CodepointRange = readonly [number, number];
/** What `fonts/coverage.json` holds. */
interface FontCoverage {
    /** Ranges the built TTF actually contains, ascending and non-overlapping. */
    readonly ranges: readonly CodepointRange[];
}
/** One run of characters the bundled font cannot draw. */
interface UncoveredRun {
    /** The characters themselves, deduplicated, in first-seen order. */
    readonly characters: string;
    /** A human-readable guess at the script, for the message. */
    readonly script: string;
    /** How many distinct codepoints in this run. */
    readonly count: number;
}
/**
 * Pull the drawable text out of a rendered SVG.
 *
 * Reads `<text>` and `<tspan>` content rather than the diagram source, because
 * the source also holds directives, colour names and chart-type keywords that
 * are never drawn — warning about a character in a line nobody sees would be
 * noise. Entities are decoded, since `&amp;` reaches the font as `&`.
 */
declare function textFromSvg(svg: string): string;
/**
 * Group the characters of `text` that the bundled font cannot draw, by script.
 *
 * Control characters and whitespace are ignored — they are never drawn and a
 * newline is not a coverage gap.
 */
declare function uncoveredCharacters(text: string, coverage: FontCoverage): readonly UncoveredRun[];
/**
 * The warning a rasterising caller should print, or `undefined` when every
 * character is covered.
 *
 * Phrased as portability rather than failure, because with system fonts loaded
 * it usually HAS rendered on this machine — the risk is the next machine. It
 * never says "will not render", which would be wrong here and ignored there.
 */
declare function fontPortabilityWarning(runs: readonly UncoveredRun[]): string | undefined;

export { ARROW_DIAGNOSTIC_CODES, type Activation, type AncestorInfo, type ArcLink, type ArcNodeGroup, type BLCollapseResult, type BLEdge, type BLGroup, type BLLayoutEdge, type BLLayoutGroup, type BLLayoutNode, type BLLayoutResult, type BLNode, type BlipTrend, type BlockCell, type BlockGrid, type BlockLayoutItem, type BlockLayoutResult, type BlockNode, type BlockOptions, type BodyFigure, type BodyOptions, type BodyPart, type BracketMode, type BracketSide, type C4ArrowType, type C4DeploymentNode, type C4Element, type C4ElementType, type C4Group, type C4LayoutBoundary, type C4LayoutEdge, type C4LayoutNode, type C4LayoutResult, type C4LegendEntry, type C4LegendGroup, type C4Relationship, type C4Shape, type C4TagEntry, type C4TagGroup, CONTAINER_FILL_OPACITY, CONTAINER_STROKE_OPACITY, CONTAINER_STROKE_WIDTH, type ChartDataPoint, type ChartEra, type ChartType$1 as ChartType, type ClassLayoutEdge, type ClassLayoutNode, type ClassLayoutResult, type ClassMember, type ClassModifier, type ClassNode, type ClassRelationship, type ClockEntry, type ClockFace, type ClockZoneKind, type CodepointRange, type CollapsedMindmapResult, type CollapsedOrgResult, type CollapsedSitemapResult, type CollapsedView, CompactViewState, type ComputedInfraEdge, type ComputedInfraModel, type ComputedInfraNode, type ContextRelationship, type CountUnits, type CreateMapGeoQueryOptions, type CycleEdge, type CycleLayoutEdge, type CycleLayoutNode, type CycleLayoutResult, type CycleNode, type CycleRenderOptions, type D3ExportDimensions, DEFAULT_FONT_NAME, DgmoError, type DiagramSymbols, type Duration, type DurationUnit, type ERCardinality, type ERColumn, type ERConstraint, type ERLayoutEdge, type ERLayoutNode, type ERLayoutResult, type ERRelationship, type ERTable, type ElseIfBranch, type EventLineEra, type EventLineEvent, type EventLineFocus, type EventLineOptions, type ExpandedActivity, type ExtendedChartType, FONT_FAMILY, type FamilyChild, type FamilyChildEdge, type FamilyLayoutNode, type FamilyLayoutResult, type FamilyMarriageBar, type FamilyPerson, type FamilySex, type FamilyUnion, type FocusOrgResult, type FocusResult, type FocusTarget, type FontCoverage, type GanttDependency, type GanttEra, type GanttGroup, type GroupRow as GanttGroupRow, type GanttHolidays, type GanttInteractiveOptions, type LaneHeaderRow as GanttLaneHeaderRow, type GanttMarker, type GanttNode, type GanttOptions, type Row as GanttRow, type GanttTask, type TaskRow as GanttTaskRow, GeoExtent, type GetOrCreateNameResult, type GoalMode, type GoalOptions, type GraphDirection, type GraphEdge, type GraphGroup, type GraphNode, type GraphShape, INFRA_BEHAVIOR_KEYS, INVALID_COLOR_CODE, INVALID_CSS_COLOR_HEX, type InfraAvailabilityPercentiles, type InfraBehaviorKey, type InfraCbState, type InfraComputeParams, type InfraDiagnostic, type InfraEdge, type InfraGroup, type InfraLatencyPercentiles, type InfraLayoutEdge, type InfraLayoutGroup, type InfraLayoutNode, type InfraLayoutResult, type InfraLegendGroup, type InfraNode, type InfraPlaybackState, type InfraProperty, type InfraRole, type InfraTagGroup, type InlineSpan, type JourneyMapAnnotation, type JourneyMapInteractiveOptions, type JourneyMapLayout, type JourneyMapPersona, type JourneyMapPhase, type JourneyMapStep, type KanbanCard, type KanbanColumn, type KanbanTagEntry, type KanbanTagGroup, LEGEND_CAPSULE_PAD, LEGEND_DOT_R, LEGEND_ENTRY_DOT_GAP, LEGEND_ENTRY_FONT_SIZE, LEGEND_ENTRY_TRAIL, LEGEND_GEAR_PILL_W, LEGEND_GROUP_GAP, LEGEND_HEIGHT, LEGEND_MAX_ENTRY_ROWS, LEGEND_PILL_FONT_SIZE, LEGEND_PILL_PAD, type LayoutEdge, type LayoutGroup, type LayoutNode, type LayoutOptions$1 as LayoutOptions, type LayoutResult$1 as LayoutResult, type LegendCallbacks, type LegendConfig, type LegendControl, type LegendGroupData, type LegendHandle, type LegendLayout, type LegendMode, type LegendPalette, type LegendPosition, type LegendState, MapData, type MapExportDimensions, type MapGeoQuery, type MapLayout, type MapLayoutInset, type MapLayoutLeg, MapLayoutLegend, type MapLayoutPoi, type MapLayoutRegion, type MapLayoutStretch, type MemberVisibility, type MindmapLayoutEdge, type MindmapLayoutNode, type MindmapLayoutResult, type MindmapNode, type MonteCarloResult, type NameEntry, type NearestCity, type NodeDetail, type OrgContainerBounds, type OrgLayoutEdge, type OrgLayoutNode, type OrgLayoutResult, PaletteColors, PaletteConfig, type ParseInArrowLabelResult, type ParsedBlock, type ParsedBody, type ParsedBoxesAndLines, type ParsedBracket, type ParsedC4, type ParsedChart, type ParsedClassDiagram, type ParsedClock, type ParsedCountdown, type ParsedCycle, type ParsedERDiagram, type ParsedEventLine, type ParsedExtendedChart, type ParsedFamily, type ParsedGantt, type ParsedGoal, type ParsedGraph, type ParsedInfra, type ParsedJourneyMap, type ParsedKanban, type ParsedLiveLink, ParsedMap, type ParsedMindmap, ParsedOrg, type ParsedPert, type ParsedPyramid, ParsedRaci, type ParsedRing, type ParsedSequenceDgmo, type ParsedSitemap, type ParsedSketch, type ParsedSwimlane, type ParsedTechRadar, type ParsedTreemap, type ParsedVersionControl, type ParsedVisualization, type ParsedWireframe, type ParticipantType, type PertActivity, type Anchor as PertAnchor, type PertDirection, type PertEdge, type PertGroup, type PertLayoutEdge, type PertLayoutGroup, type PertLayoutNode, type LayoutOverrides as PertLayoutOverrides, type LayoutResult as PertLayoutResult, type PertMilestone, type PertOptions, type PertRenderOptions, type PlaceResolution, type PlacedLabel, type ProjectedCity, type PyramidLayer, type QuadrantPosition, RACI_ERROR_CODES, VARIANTS as RACI_VARIANTS, RACI_WARNING_CODES, RECOGNIZED_COLOR_NAMES, RULE_COUNT, type RaciDragSource, type RaciInteractionHandlers, RaciMarker, RaciTask, RaciVariant, type RadialCell, type RadialLayoutResult, type RawMatch, type RawSeed, type RecurRule, type RegionToken, type RelationshipType, type RenderStep, type ResolvedActivity, type ResolvedGroup$1 as ResolvedGroup, ResolvedMap, type ResolvedPert, type ResolvedGroup as ResolvedPertGroup, type ResolvedSchedule, type ResolvedTask, type ResultCard, type ResultTokens, type RingLayer, type RoundMode, SKETCH_AUTO_LAYOUT_DEFAULTS, SKETCH_FOOT_H, SKETCH_FOOT_W, SKETCH_GEOMETRY, SKETCH_HALF_SLOT_X, SKETCH_HALF_SLOT_Y, SKETCH_SEP, SKETCH_SHAPE_KINDS, SKETCH_SLOT_X, SKETCH_SLOT_Y, SKETCH_VISUALS, ScaleContext, type SectionMessageGroup, type SequenceBlock, type SequenceElement, type SequenceGroup, type SequenceMessage, type SequenceNote, type SequenceParticipant, type SequenceRenderOptions, type SequenceSection, type SimulateOptions, type SitemapContainerBounds, type SitemapDirection, type SitemapEdge, type SitemapLayoutEdge, type SitemapLayoutNode, type SitemapLayoutResult, type SitemapLegendEntry, type SitemapLegendGroup, type SitemapNode, type SketchAt, type SketchAutoLayoutFlags, type SketchBox, type SketchCollapseResult, type SketchEdge, type SketchEdgeGeometry, type SketchEdgeHeads, type SketchFillMode, type SketchLayout, type SketchLayoutBox, type SketchLayoutNode, type SketchLayoutOptions, type SketchNode, type SketchNodeColors, type SketchOptions, type SketchRenderOptions, type SketchShapeKind, type StateCollapseResult, type SwimEdge, type SwimEvent, type SwimLane, type SwimNode, type SwimPhase, type SwimShape, type LayoutBand as SwimlaneLayoutBand, type SwimlaneLayoutResult, TagEntry, TagGroup, type TechRadarBlip, type TechRadarLayoutPoint, type TechRadarQuadrant, type TechRadarRing, type TreemapCell, type TreemapColorMode, type TreemapLayoutResult, type TreemapNode, type TreemapOptions, type UncoveredRun, type VCBranch, type VCNode, type VCNote, type VCOptions, type VCRef, type VisualizationType, type WireframeElement, type WireframeElementType, type WireframeFormFactor, type WireframeLayout, type WireframeLayoutNode, type WorkWindow, type ZoneSuggestion, addDurationToDate, albersSkewFallback, analyzePert, applyCollapseProjection, applyGroupOrdering, applyPositionOverrides, atlasPalette, authoredCollapsedIds, blueprintPalette, buildNoteMessageMap, buildRenderSequence, buildSimulationContext, buildTagLaneRowList, calculateSchedule, canonicalSketch, catppuccinPalette, clearEventLineMuted, collapseBoxesAndLines, collapseMindmapTree, collapseOrgTree, collapseSitemapTree, collapseSketch, collapseStateGroups, collectDiagramRoles, collectTasks, colorNames, computeActivations, computeCardArchive, computeCardMove, computeCycleLayout, computeInfra, computeInfraLegendGroups, computeLegendLayout, computeRadarLayout, computeTimeTicks, controlsGroupCapsuleWidth, createMapGeoQuery, displayName, emitSketch, extractSymbols$2 as extractClassSymbols, extractSymbols$1 as extractErSymbols, extractSymbols$3 as extractFlowchartSymbols, extractSymbols as extractInfraSymbols, extractPertSymbols, focusBoxesAndLines, focusEventLine, focusOrgTree, fontPortabilityWarning, formatDateLabel, formatOffsetLabel, getExtendedChartLegendGroups, getLegendReservedHeight, getOrCreateName, getRadarGeometry, getSimpleChartLegendGroups, groupMessagesBySection, inferParticipantType, inferRoles, invalidColorDiagnostic, isArchiveColumn, isInvalidColorToken, isRecognizedColorName, isSequenceBlock, isSequenceNote, isSketchShapeKind, layoutBlock, layoutBoxesAndLines, layoutBracket, layoutC4Components, layoutC4Containers, layoutC4Context, layoutC4Deployment, layoutClassDiagram, layoutERDiagram, layoutFamily, layoutGraph, layoutInfra, layoutJourneyMap, layoutMap, layoutMindmap, layoutOrg, layoutPert, layoutSitemap, layoutSketch, layoutSwimlane, layoutTreemap, layoutTreemapRadial, layoutWireframe, legendEntryWidth, loadMapData, looksLikeClassDiagram, looksLikeERDiagram, looksLikeFlowchart, looksLikeMap, looksLikePert, looksLikeSequence, looksLikeSitemap, looksLikeState, mapBackgroundColor, mapContentAspect, mapExportDimensions, mapNeutralLandColor, measurePertAnalysisBlock, measureText, mulberry32, nearestNamedColor, nord, nordPalette, normalizeName, normalizePlace, orderArcNodes, parseAndLayoutInfra, parseBlock, parseBody, parseBoxesAndLines, parseBracket, parseC4, parseChart, parseClassDiagram, parseClock, parseCountdown, parseCycle, parseDataRowValues, parseERDiagram, parseEventLine, parseExtendedChart, parseFamily, parseFixedOffset, parseFlowchart, parseGantt, parseGoal, parseInArrowLabel, parseInfra, parseInlineMarkdown, parseJourneyMap, parseKanban, parseLiveLink, parseMap, parseMindmap, parsePert, parsePyramid, parseRing, parseSequenceDgmo, parseSequenceDgmo as parseSequenceDiagram, parseSitemap, parseSketch, parseState, parseSwimlane, parseTechRadar, parseTimelineDate, parseTreemap, parseVersionControl, parseVisualization, parseWireframe, cellAppendMarker as raciCellAppendMarker, cellCycle as raciCellCycle, cellRemove as raciCellRemove, cellReplace as raciCellReplace, relayoutPert, render, renderArcDiagram, renderBlock, renderBlockForExport, renderBody, renderBodyForExport, renderBoxesAndLines, renderBoxesAndLinesForExport, renderBracket, renderBracketForExport, renderC4ComponentsForExport, renderC4Containers, renderC4ContainersForExport, renderC4Context, renderC4ContextForExport, renderC4Deployment, renderC4DeploymentForExport, renderClassDiagram, renderClassDiagramForExport, renderClock, renderClockForExport, renderCountdown, renderCountdownForExport, renderCycle, renderCycleForExport, renderERDiagram, renderERDiagramForExport, renderEventLine, renderEventLineForExport, renderFamily, renderFamilyForExport, renderFlowchart, renderFlowchartForExport, renderGantt, renderGoal, renderGoalForExport, renderInfra, renderJourneyMap, renderJourneyMapForExport, renderKanban, renderKanbanForExport, renderLegendD3, renderLegendSvg, renderLegendSvgFromConfig, renderLiveLinkCard, renderMap, renderMapForExport, renderMindmap, renderMindmapForExport, renderOrg, renderOrgForExport, renderPert, renderPertAnalysisBlock, renderPertForExport, renderPyramid, renderPyramidForExport, renderQuadrant, renderQuadrantFocus, renderQuadrantFocusForExport, renderRaci, renderRaciForExport, renderRing, renderRingForExport, renderSequenceDiagram, renderSitemap, renderSitemapForExport, renderSketch, renderSketchForExport, renderSlopeChart, renderState, renderStateForExport, renderSwimlaneForExport, renderTechRadar, renderTechRadarForExport, renderTimeline, renderTreemap, renderTreemapForExport, renderTreemapRadial, renderTreemapRadialForExport, renderVenn, renderVersionControl, renderVersionControlForExport, renderWireframe, renderWordCloud, resolveColor, resolveColorWithDiagnostic, resolveMap, resolvePlace, resolveTaskName, rollUpContextRelationships, sameSketch, sampleBetaPert, searchZones, seriesColors, simulateCanonical, simulateFast, sketchColors, sketchContainerFill, sketchEdgeGeometry, sketchNeutralFill, sketchSlotToPx, slatePalette, startClocks, startCountdowns, targetToMs, textFromSvg, tickClocks, tickCountdowns, tidewaterPalette, tokyoNightPalette, truncateBareUrl, truncateText, uncoveredCharacters, validateComputed, validateInfra, validateLabelCharacters };
