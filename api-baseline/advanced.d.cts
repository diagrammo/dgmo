import { EChartsOption } from 'echarts';
import * as d3Selection from 'd3-selection';
import { Selection } from 'd3-selection';
import * as d3Scale from 'd3-scale';

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
declare function makeDgmoError(line: number, message: string, severity?: DgmoSeverity, code?: string): DgmoError;
declare function formatDgmoError(err: DgmoError): string;

/**
 * Stable diagnostic codes for in-arrow label parsing errors.
 *
 * **Active codes** — emitted by the parser pipeline today:
 *   - `ARROW_SUBSTRING_IN_LABEL` (TD-13)
 *   - `CONTROL_CHAR_IN_LABEL` (TD-14)
 *
 * **Reserved codes** — declared but NOT currently emitted. These are
 * placeholders for future tightening of the arrow-tokenization rules
 * described in TD-9. Today's chart parsers catch these cases through
 * their own regex machinery with different diagnostics. A follow-up
 * spec that introduces a dedicated tokenizer can start emitting them
 * without changing the public code shape:
 *   - `TRAILING_ARROW_TEXT` — extra `->`/`~>` after the primary arrow
 *   - `MIXED_ARROW_DELIMITERS` — opening delim type doesn't match arrow
 *
 * See `docs/dgmo-language-spec-decisions.md` → TD-16 for the rationale.
 */
declare const ARROW_DIAGNOSTIC_CODES: {
    /** Active: label contains `->` or `~>` substring (TD-13). */
    readonly ARROW_SUBSTRING_IN_LABEL: "E_ARROW_SUBSTRING_IN_LABEL";
    /** Active: label contains a forbidden control character (TD-14). */
    readonly CONTROL_CHAR_IN_LABEL: "E_CONTROL_CHAR_IN_LABEL";
    /** Reserved: not currently emitted by any parser. See JSDoc above. */
    readonly TRAILING_ARROW_TEXT: "E_TRAILING_ARROW_TEXT";
    /** Reserved: not currently emitted by any parser. See JSDoc above. */
    readonly MIXED_ARROW_DELIMITERS: "E_MIXED_ARROW_DELIMITERS";
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
interface DecodedDiagramUrl {
    dsl: string;
    viewState: CompactViewState;
    palette?: string;
    theme?: 'light' | 'dark';
    filename?: string;
}
interface EncodeDiagramUrlOptions {
    baseUrl?: string;
    viewState?: CompactViewState;
    palette?: string;
    theme?: 'light' | 'dark';
    filename?: string;
}
type EncodeDiagramUrlResult = {
    url: string;
    error?: undefined;
} | {
    url?: undefined;
    error: 'too-large';
    compressedSize: number;
    limit: number;
};
/**
 * Encode a CompactViewState to a compressed string for URL embedding.
 * Returns empty string if state has no keys (ADR-4).
 */
declare function encodeViewState(state: CompactViewState): string;
/**
 * Decode a compressed view state string back to CompactViewState.
 * Returns empty object on failure (no crash).
 */
declare function decodeViewState(encoded: string): CompactViewState;
/**
 * Compress a DGMO DSL string into a shareable URL.
 * Returns `{ url }` on success, or `{ error: 'too-large', compressedSize, limit }` if the
 * compressed payload exceeds the 8 KB limit.
 */
declare function encodeDiagramUrl(dsl: string, options?: EncodeDiagramUrlOptions): EncodeDiagramUrlResult;
/**
 * Decode a DGMO DSL string and view state from a URL query string or hash.
 * Accepts any of:
 *   - `?dgmo=<payload>&vs=<state>`
 *   - `#dgmo=<payload>&vs=<state>` (backwards compat)
 *   - `dgmo=<payload>`
 *   - `<bare payload>`
 *
 * Returns `{ dsl, viewState }`. The DSL is empty string on invalid input.
 */
declare function decodeDiagramUrl(hash: string): DecodedDiagramUrl;

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
}): Promise<{
    svg: string;
    diagnostics: DgmoError[];
}>;

interface ChartTypeMeta {
    readonly id: string;
    readonly description: string;
    readonly triggers: readonly string[];
    readonly fallback?: true;
}
declare const chartTypes: readonly ChartTypeMeta[];

/** Normalize a string to lowercase ASCII-ish tokens for matching. */
declare function normalize(s: string): string[];
/**
 * True if `triggerTokens` appears as a contiguous slice of `promptTokens`.
 * Token-based (not substring) — prevents "scatter plot" matching "scattered
 * the plot", "ER diagram" matching "water diagram", and similar traps.
 */
declare function matchesContiguously(promptTokens: readonly string[], triggerTokens: readonly string[]): boolean;
interface ChartTypeScore {
    readonly type: ChartTypeMeta;
    readonly score: number;
    readonly matched: string[];
}
/**
 * Score a single chart type against a prompt.
 *
 * Primary signal: contiguous trigger-phrase matches weighted by token count
 * (longer phrases beat shorter ones). Secondary signal: description-word
 * overlap at 0.25× weight — a tiebreak-only hint that rescues prompts which
 * miss every trigger but touch description vocabulary. Triggers always win
 * over descriptions because any trigger match is ≥1.0 and descriptions
 * contribute ≤0.25 per token.
 */
declare function scoreChartType(prompt: string, type: ChartTypeMeta): {
    score: number;
    matched: string[];
};
/**
 * Minimum trigger-based score for a confident match. A result below this
 * floor means no actual trigger fired — only description-rescue tokens
 * contributed — so the caller should drop to the fallback list instead of
 * returning a confident-looking wrong answer.
 *
 * 1.0 is the weight of a single-token trigger. Anything less came entirely
 * from 0.25× description hits.
 */
declare const MIN_PRIMARY_SCORE = 1;
/**
 * Minimum absolute score gap required before calling a match
 * non-ambiguous. 0.5 ≈ two description-rescue tokens' worth, or half a
 * trigger-token difference. Below this, the cliff between "medium" and
 * "ambiguous" is effectively noise.
 */
declare const AMBIGUITY_THRESHOLD = 0.5;
type Confidence = 'high' | 'medium' | 'ambiguous';
/**
 * Confidence from the top two scores. Rules:
 *   1. top < MIN_PRIMARY_SCORE → ambiguous (no real trigger matched)
 *   2. second === 0            → high      (nothing competes)
 *   3. top ≥ 2 × second        → high      (top dominates)
 *   4. top − second < AMBIGUITY_THRESHOLD → ambiguous (gap is noise)
 *   5. otherwise               → medium
 */
declare function confidence(top: number, second: number): Confidence;
interface SuggestionResult {
    readonly ranked: readonly ChartTypeScore[];
    readonly fallback: readonly ChartTypeMeta[];
    readonly confidence: Confidence;
    readonly fellBack: boolean;
}
/**
 * Score every chart type against `prompt` and return a ranked suggestion
 * bundle. Types with score 0 are filtered out. When the top score is below
 * `MIN_PRIMARY_SCORE` (no real trigger fired), the caller should present
 * the fallback list — `fellBack` is set to true in that case.
 *
 * Array order is preserved: scoring iterates `chartTypes` in source order
 * and `.sort` is stable in V8, so ties go to the earlier entry — specialized
 * types beat generic catch-alls by construction.
 */
declare function suggestChartTypes(prompt: string): SuggestionResult;

/**
 * Extracts the chart type from raw file content.
 * First tries the first non-empty, non-comment line as a bare chart type name
 * (e.g., `gantt Product Launch`).
 * Falls back to inference when no explicit chart type is found.
 */
declare function parseDgmoChartType(content: string): string | null;
/** User-visible rendering category for dispatch and routing. */
type RenderCategory = 'data-chart' | 'visualization' | 'diagram';
/**
 * Returns the render category for a given chart type, or `null` if unknown.
 * Use this instead of the internal framework map for dispatch in consumers.
 */
declare function getRenderCategory(chartType: string): RenderCategory | null;
/**
 * Returns true if the chart type is an extended chart type
 * handled by parseExtendedChart (scatter, sankey, chord, function, heatmap, funnel).
 * Returns false for standard chart types and all other types.
 */
declare function isExtendedChartType(chartType: string): boolean;
/**
 * Returns all supported chart type identifiers in canonical (tier) order,
 * derived from `chartTypes`. Consumers that need alphabetical order should
 * call `.sort()` explicitly.
 */
declare function getAllChartTypes(): string[];
/**
 * Canonical descriptions for every supported chart type. Derived from
 * `chartTypes` so there is exactly one place to update when adding a new
 * type. Consumed by the CLI `--chart-types` flag, the editor autocomplete
 * popup, and the MCP `list_chart_types` tool.
 */
declare const CHART_TYPE_DESCRIPTIONS: Record<string, string>;
type ParseResult = {
    diagnostics: DgmoError[];
};
type ParseFn = (content: string) => ParseResult;
/**
 * Maps every chart-type id to the parser that handles it. Adding a new
 * chart type means:
 *   1. Add an entry here.
 *   2. Add an entry to `chartTypes` in `chart-types.ts`.
 *
 * The `chart-types.test.ts` cross-check asserts both sets are identical;
 * forgetting either side trips the test.
 */
declare const chartTypeParsers: ReadonlyArray<readonly [string, ParseFn]>;
/** Ids in the same order as `chartTypeParsers`; used for cross-checks. */
declare const knownChartTypeIds: readonly string[];
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
 */
interface PaletteColors {
    /** Main background (#eceff4 light / #2e3440 dark for Nord) */
    bg: string;
    /** Cards, panels (#e5e9f0 / #3b4252) */
    surface: string;
    /** Popovers, dropdowns (#e5e9f0 / #434c5e) */
    overlay: string;
    /** Borders, dividers, muted (#d8dee9 / #4c566a) */
    border: string;
    /** Primary text (#2e3440 / #eceff4) */
    text: string;
    /** Secondary/diminished text (#4c566a / #d8dee9) */
    textMuted: string;
    /**
     * Light-mode arg for `contrastText()` when text is rendered on a
     * tinted shape fill (e.g. `shapeFill()` output). Must guarantee
     * ≥ 4.5:1 WCAG AA against any `shapeFill()` the palette can produce.
     * Distinct from `colors.white` because palette-aesthetic anchors don't
     * always meet contrast requirements (TD-5).
     */
    textOnFillLight: string;
    /** Dark-mode counterpart to `textOnFillLight`. */
    textOnFillDark: string;
    /** Primary accent — buttons, links */
    primary: string;
    /** Secondary accent */
    secondary: string;
    /** Tertiary accent */
    accent: string;
    /** Error/danger */
    destructive: string;
    /**
     * Used for: inline annotations (red), pie charts, cScale,
     * series rotation, journey actors, Gantt tasks.
     */
    colors: {
        red: string;
        orange: string;
        yellow: string;
        green: string;
        blue: string;
        purple: string;
        teal: string;
        cyan: string;
        gray: string;
        black: string;
        white: string;
    };
}
/**
 * Complete palette definition. One object per color scheme.
 * This is what palette authors create — the single artifact for NFR1.
 */
interface PaletteConfig {
    /** Registry key: 'nord', 'solarized', 'catppuccin' */
    id: string;
    /** Display name: 'Nord', 'Solarized', 'Catppuccin' */
    name: string;
    /** Light mode color definitions */
    light: PaletteColors;
    /** Dark mode color definitions */
    dark: PaletteColors;
}

/** Validate that a hex string is well-formed (#RGB or #RRGGBB). */
declare function isValidHex(value: string): boolean;
/**
 * Register a palette. Called at module initialization.
 * Validates that all 19 color fields per mode are present and valid hex.
 * Throws on malformed palettes to catch errors at startup, not at render time.
 */
declare function registerPalette(palette: PaletteConfig): void;
/** Get palette by id. Returns Nord if id is unrecognized (FR10). */
declare function getPalette(id: string): PaletteConfig;
/** List all registered palettes alphabetically (for the selector UI). */
declare function getAvailablePalettes(): PaletteConfig[];

/** Convert hex (#RRGGBB or #RGB) to { h, s, l } with h in degrees, s/l as percentages. */
declare function hexToHSL(hex: string): {
    h: number;
    s: number;
    l: number;
};
/** Convert { h (degrees), s (%), l (%) } back to #RRGGBB hex string. */
declare function hslToHex(h: number, s: number, l: number): string;
/** Convert hex to "H S% L%" string for CSS custom properties. */
declare function hexToHSLString(hex: string): string;
/**
 * Blend a color toward white (light mode quadrant fills).
 * amount: 0 = original, 1 = white
 */
declare function tint(hex: string, amount: number): string;
/**
 * Blend a color toward a dark base (dark mode quadrant fills).
 * amount: 0 = original, 1 = base
 */
declare function shade(hex: string, base: string, amount: number): string;
/**
 * Blend two hex colors by percentage.
 * `pct` = 0 → 100% of `b`, `pct` = 100 → 100% of `a`.
 *
 * Used by all renderers for tinted fills and strokes.
 */
declare function mix(a: string, b: string, pct: number): string;
/**
 * Pick `lightText` or `darkText` for placement on top of `bg`.
 *
 * Three-tier decision:
 *  1. **High-luminance fill (luminance > 0.55)** → `darkText`. Yellows, peaches,
 *     light cyans — dark text reads better and a light cream on light yellow is
 *     unreadable.
 *  2. **Pastel fill (min RGB channel ≥ 100, luminance ≤ 0.55)** → defer to WCAG
 *     ratio. Pastels have no near-zero channel and tend to read as "soft" —
 *     dark text usually wins by ratio (catppuccin dark mauve `#cba6f7` min 166,
 *     ratio 9.35:1; tokyo-night dark red `#f7768e` min 118, ratio 7.86:1; and
 *     tokyo-night green `#9ece6a` min 106, ratio 11.4:1 all correctly pick dark).
 *  3. **Saturated fill (min RGB < 100, luminance ≤ 0.55)** → `lightText`. At least
 *     one channel near zero signals true saturation — gruvbox dark green
 *     `#b8bb26` (min 38), one-dark blue `#4078f2` (min 64), bold red/blue
 *     (min 0), solarized blue `#268bd2` (min 38). The user consistently
 *     prefers light text on these for visual punch.
 *
 * `min RGB` discriminates pastel-vs-saturated more reliably than `max-min`
 * (vibrance): tokyo-night and catppuccin dark are pastels with high max RGB,
 * so vibrance alone misclassifies them as "saturated."
 *
 * Tinted fills (luminance ~0.7+ in light themes / ~0.02–0.14 in dark themes)
 * are unambiguous in either branch; only solid-fill output shifts here.
 */
declare function contrastText(bg: string, lightText: string, darkText: string): string;
/**
 * Canonical tinted shape fill: 25% intent color + 75% surface.
 * Use for any "tinted intent shape" — graph nodes, kanban cards,
 * journey-map shapes, infra severity, ECharts pie/funnel/bar/etc.
 *
 * NOT for subtle-neutral shapes (use the existing 5-10% inline formula
 * for "recede when no intent" cases — infra normal-state, untagged
 * boxes, no-color sequence participants).
 *
 * Sankey is the only documented exception (75/45% custom desaturation).
 *
 * `opts.solid` (per `option solid-fill`): bypass the 25% tint and return
 * the raw intent. Opt-in only; default behavior unchanged.
 */
declare function shapeFill(palette: PaletteColors, intent: string, isDark: boolean, opts?: {
    solid?: boolean;
}): string;
/** Derive the 8-color series rotation from a palette's named colors. */
declare function getSeriesColors(palette: PaletteColors): string[];

declare const boldPalette: PaletteConfig;

declare const catppuccinPalette: PaletteConfig;

declare const gruvboxPalette: PaletteConfig;

declare const nordPalette: PaletteConfig;

declare const oneDarkPalette: PaletteConfig;

declare const rosePinePalette: PaletteConfig;

declare const solarizedPalette: PaletteConfig;

declare const tokyoNightPalette: PaletteConfig;

declare const draculaPalette: PaletteConfig;

declare const monokaiPalette: PaletteConfig;

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
    readonly nord: PaletteConfig;
    readonly catppuccin: PaletteConfig;
    readonly solarized: PaletteConfig;
    readonly gruvbox: PaletteConfig;
    readonly tokyoNight: PaletteConfig;
    readonly oneDark: PaletteConfig;
    readonly rosePine: PaletteConfig;
    readonly dracula: PaletteConfig;
    readonly monokai: PaletteConfig;
    readonly bold: PaletteConfig;
};

type ChartType$1 = 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'polar-area' | 'radar' | 'bar-stacked';
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
    seriesNames?: string[];
    seriesNameLineNumbers?: number[];
    seriesNameColors?: (string | undefined)[];
    orientation?: 'horizontal' | 'vertical';
    color?: string;
    label?: string;
    noName?: boolean;
    noValue?: boolean;
    noPercent?: boolean;
    /** Render with full intent saturation instead of the canonical 25% tint. */
    solidFill?: boolean;
    /** Cross-chart-type: when true, the renderer suppresses the chart title. */
    noTitle?: boolean;
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
 * numeric tokens at the end are the values. Supports comma-separated multi-values,
 * space-separated multi-values, and comma-grouped numbers (e.g., "1,087").
 *
 * Examples:
 *   "Jan 120"             → { label: "Jan", values: [120] }
 *   "North America 250"   → { label: "North America", values: [250] }
 *   "Q1 10, 20, 30"       → { label: "Q1", values: [10, 20, 30] }
 *   "Q1 10 20 30"         → { label: "Q1", values: [10, 20, 30] }
 *   "Revenue 1,200"       → { label: "Revenue", values: [1200] }
 *   "Revenue 3,984,078.65"→ { label: "Revenue", values: [3984078.65] }
 *
 * Returns null if the line has no numeric value at the end.
 */
declare function parseDataRowValues(line: string, options?: {
    multiValue?: boolean;
    expectedValues?: number;
}): {
    label: string;
    values: number[];
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
interface LegendConfig {
    groups: LegendGroupData[];
    position: LegendPosition;
    controls?: LegendControl[];
    controlsGroup?: ControlsGroupConfig;
    mode: LegendMode;
    /** Title width in pixels — used for inline-with-title computation */
    titleWidth?: number;
    /** Extra width (px) reserved after the pill inside an active capsule (e.g. for eye icon addon). Entries start after this offset. */
    capsulePillAddonWidth?: number;
    /** When true, groups with no entries are still rendered as collapsed pills. Default: false (empty groups hidden). */
    showEmptyGroups?: boolean;
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

interface LegendGroupData {
    name: string;
    entries: Array<{
        value: string;
        color: string;
    }>;
}
interface LegendRenderOptions {
    palette: {
        bg: string;
        surface: string;
        text: string;
        textMuted: string;
    };
    isDark: boolean;
    containerWidth: number;
    /** Grid left offset as percentage (e.g. 12 for '12%'). Centers legend over plot area. */
    gridLeftPct?: number;
    /** Grid right offset as percentage (e.g. 4 for '4%'). Centers legend over plot area. */
    gridRightPct?: number;
    activeGroup?: string | null;
    className?: string;
}
interface LegendRenderResult {
    svg: string;
    height: number;
    /** Natural content width (px). Callers can use this for CSS-based centering. */
    width: number;
}
declare function renderLegendSvg(groups: LegendGroupData[], options: LegendRenderOptions): LegendRenderResult;
declare function renderLegendSvgFromConfig(config: LegendConfig, state: LegendState, palette: LegendPalette & {
    isDark: boolean;
}, containerWidth: number): LegendRenderResult;

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

interface ParsedExtendedChart {
    type: ExtendedChartType;
    title?: string;
    titleLineNumber?: number;
    series?: string;
    seriesLineNumber?: number;
    seriesNames?: string[];
    seriesNameLineNumbers?: number[];
    seriesNameColors?: (string | undefined)[];
    data: ExtendedChartDataPoint[];
    links?: ParsedSankeyLink[];
    functions?: ParsedFunction[];
    scatterPoints?: ParsedScatterPoint[];
    heatmapRows?: ParsedHeatmapRow[];
    columns?: string[];
    rows?: string[];
    xRange?: {
        min: number;
        max: number;
    };
    xlabel?: string;
    xlabelLineNumber?: number;
    ylabel?: string;
    ylabelLineNumber?: number;
    sizelabel?: string;
    noName?: boolean;
    noValue?: boolean;
    noPercent?: boolean;
    shade?: boolean;
    /** Render with full intent saturation instead of the canonical 25% tint. */
    solidFill?: boolean;
    /** Cross-chart-type: when true, the renderer suppresses the chart title. */
    noTitle?: boolean;
    categoryColors?: Record<string, string>;
    categoryLineNumbers?: Record<string, number>;
    nodeColors?: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}

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
 * Converts a ParsedExtendedChart into an EChartsOption.
 * Handles extended chart types: scatter, sankey, chord, function, heatmap, funnel.
 * @param parsed - Result of parseExtendedChart()
 */
declare function buildExtendedChartOption(parsed: ParsedExtendedChart, palette: PaletteColors, isDark: boolean): EChartsOption;
/**
 * Extracts legend group data from standard chart types (multi-line, bar-stacked).
 * Returns empty array if chart has no multi-series legend.
 */
declare function getSimpleChartLegendGroups(parsed: ParsedChart, colors: string[]): LegendGroupData[];
/**
 * Extracts legend group data from extended chart types.
 * Supports scatter (categories), chord (nodes), and function (series).
 */
declare function getExtendedChartLegendGroups(parsed: ParsedExtendedChart, colors: string[]): LegendGroupData[];
interface ScatterLabelPoint {
    name: string;
    px: number;
    py: number;
    color: string;
    size?: number;
}
/**
 * Greedy label placement for scatter charts.
 * Returns ECharts `graphic` elements (text + background rects + optional connector lines).
 * Pure function — no ECharts instance dependency.
 *
 * @param bg - chart background color, used for label background rects that mask connector lines
 */
declare function computeScatterLabelGraphics(points: ScatterLabelPoint[], chartBounds: {
    top: number;
    bottom: number;
}, fontSize: number, symbolSize: number, bg?: string): Record<string, unknown>[];
/**
 * Converts a ParsedChart into an EChartsOption.
 * Handles standard chart types: bar, line, area, pie, doughnut, radar, polar-area, bar-stacked, multi-line.
 * @param parsed - Result of parseChart()
 */
declare function buildSimpleChartOption(parsed: ParsedChart, palette: PaletteColors, isDark: boolean, chartWidth?: number): EChartsOption;
/**
 * Renders an extended chart (scatter, sankey, chord, function, heatmap, funnel) to SVG using server-side rendering.
 * Mirrors the `renderForExport` API — returns an SVG string or empty string on failure.
 */
declare function renderExtendedChartForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette?: PaletteColors): Promise<string>;

interface D3ExportDimensions {
    width?: number;
    height?: number;
}

/** A single entry inside a tag group: `Value color` */
interface TagEntry {
    value: string;
    color: string;
    lineNumber: number;
}
/** A tag group block: heading + entries */
interface TagGroup {
    name: string;
    alias?: string;
    entries: TagEntry[];
    /** Default value for nodes without explicit metadata. First entry unless another is marked `default`. */
    defaultValue?: string;
    lineNumber: number;
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

interface ParsedVisualization {
    type: VisualizationType | null;
    title: string | null;
    titleLineNumber: number | null;
    orientation: 'horizontal' | 'vertical';
    periods: string[];
    data: D3DataItem[];
    words: WordCloudWord[];
    cloudOptions: WordCloudOptions;
    links: ArcLink[];
    arcOrder: ArcOrder;
    arcNodeGroups: ArcNodeGroup[];
    timelineEvents: TimelineEvent[];
    timelineGroups: TimelineGroup[];
    timelineEras: TimelineEra[];
    timelineMarkers: TimelineMarker[];
    timelineTagGroups: TagGroup[];
    timelineSort: TimelineSort;
    timelineDefaultSwimlaneTG?: string;
    timelineScale: boolean;
    timelineSwimlanes: boolean;
    vennSets: VennSet[];
    vennOverlaps: VennOverlap[];
    quadrantLabels: QuadrantLabels;
    quadrantPoints: QuadrantPoint[];
    quadrantXAxis: [string, string] | null;
    quadrantXAxisLineNumber: number | null;
    quadrantYAxis: [string, string] | null;
    quadrantYAxisLineNumber: number | null;
    quadrantTitleLineNumber: number | null;
    noName?: boolean;
    noValue?: boolean;
    noPercent?: boolean;
    /** Render with full intent saturation instead of the canonical 25% tint. */
    solidFill?: boolean;
    /** Cross-chart-type: when true, the renderer suppresses the chart title. */
    noTitle?: boolean;
    diagnostics: DgmoError[];
    error: string | null;
}

/**
 * Converts a date string (YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DD HH:MM) to a fractional year number.
 */
declare function parseTimelineDate(s: string): number;
/**
 * Adds a duration to a date string and returns the resulting date string.
 * Supports: d (days), w (weeks), m (months), y (years), h (hours), min (minutes)
 * Supports decimals up to 2 places (e.g., 1.25y = 1 year 3 months)
 * Preserves the precision of the input date (YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DD HH:MM).
 */
declare function addDurationToDate(startDate: string, amount: number, unit: 'd' | 'w' | 'm' | 'y' | 'h' | 'min'): string;
/**
 * Parses D3 chart text format into structured data.
 */
declare function parseVisualization(content: string, palette?: PaletteColors): ParsedVisualization;
/**
 * Renders a slope chart into the given container using D3.
 */
declare function renderSlopeChart(container: HTMLDivElement, parsed: ParsedVisualization, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;
/**
 * Orders arc diagram nodes based on the selected ordering strategy.
 */
declare function orderArcNodes(links: ArcLink[], order: ArcOrder, groups: ArcNodeGroup[]): string[];
/**
 * Renders an arc diagram into the given container using D3.
 */
declare function renderArcDiagram(container: HTMLDivElement, parsed: ParsedVisualization, palette: PaletteColors, _isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;
/**
 * Converts a DSL date string (YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DD HH:MM) to a human-readable label.
 *   '1718'              → '1718'
 *   '1718-05'           → 'May 1718'
 *   '1718-05-22'        → 'May 22, 1718'
 *   '2024-06-15 14:30'  → 'Jun 15, 2024 14:30'
 */
declare function formatDateLabel(dateStr: string): string;
/**
 * Renders a timeline chart into the given container using D3.
 * Supports horizontal (default) and vertical orientation.
 */
declare function renderTimeline(container: HTMLDivElement, parsed: ParsedVisualization, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions, activeTagGroup?: string | null, swimlaneTagGroup?: string | null, onTagStateChange?: (activeTagGroup: string | null, swimlaneTagGroup: string | null) => void, viewMode?: boolean, exportMode?: boolean): void;
/**
 * Renders a word cloud into the given container using d3-cloud.
 */
declare function renderWordCloud(container: HTMLDivElement, parsed: ParsedVisualization, palette: PaletteColors, _isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;
declare function renderVenn(container: HTMLDivElement, parsed: ParsedVisualization, palette: PaletteColors, _isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;
/**
 * Renders a quadrant chart using D3.
 * Displays 4 colored quadrant regions, axis labels, quadrant labels, and data points.
 */
declare function renderQuadrant(container: HTMLDivElement, parsed: ParsedVisualization, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: D3ExportDimensions): void;
/**
 * Renders a D3 chart to an SVG string for export.
 * Creates a detached DOM element, renders into it, extracts the SVG, then cleans up.
 */
declare function renderForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette?: PaletteColors, viewState?: CompactViewState, options?: {
    c4Level?: 'context' | 'containers' | 'components' | 'deployment';
    c4System?: string;
    c4Container?: string;
    tagGroup?: string;
    exportMode?: boolean;
}): Promise<string>;

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
 */
type ParticipantType = 'default' | 'service' | 'database' | 'actor' | 'queue' | 'cache' | 'gateway' | 'external' | 'networking' | 'frontend';
/**
 * A declared or inferred participant in the sequence diagram.
 */
interface SequenceParticipant {
    /** Internal identifier (e.g. "AuthService") */
    id: string;
    /** Display label — first-seen casing/spacing of the name */
    label: string;
    /** Participant shape type */
    type: ParticipantType;
    /** Source line number (1-based) */
    lineNumber: number;
    /** Explicit layout position override (0-based from left, negative from right) */
    position?: number;
    /** Pipe-delimited tag metadata (e.g. `| role: Gateway`) */
    metadata?: Record<string, string>;
}
/**
 * A message between two participants.
 */
interface SequenceMessage {
    from: string;
    to: string;
    label: string;
    lineNumber: number;
    async?: boolean;
    /** Pipe-delimited tag metadata (e.g. `| c: Caching`) */
    metadata?: Record<string, string>;
}
/**
 * A conditional or loop block in the sequence diagram.
 */
interface ElseIfBranch {
    label: string;
    children: SequenceElement[];
    lineNumber: number;
}
interface SequenceBlock {
    kind: 'block';
    type: 'if' | 'loop' | 'parallel';
    label: string;
    children: SequenceElement[];
    elseChildren: SequenceElement[];
    elseIfBranches?: ElseIfBranch[];
    elseLineNumber?: number;
    lineNumber: number;
}
/**
 * A labeled horizontal divider between message phases.
 */
interface SequenceSection {
    kind: 'section';
    label: string;
    lineNumber: number;
}
/**
 * An annotation attached to a message, rendered as a folded-corner box.
 */
interface SequenceNote {
    kind: 'note';
    text: string;
    position: 'right' | 'left';
    participantId: string;
    lineNumber: number;
    endLineNumber: number;
}
type SequenceElement = SequenceMessage | SequenceBlock | SequenceSection | SequenceNote;
declare function isSequenceBlock(el: SequenceElement): el is SequenceBlock;
declare function isSequenceNote(el: SequenceElement): el is SequenceNote;
/**
 * A named group of participants rendered as a labeled box.
 */
interface SequenceGroup {
    name: string;
    participantIds: string[];
    lineNumber: number;
    /** Pipe-delimited tag metadata (e.g. `[Backend | t: Product]`) */
    metadata?: Record<string, string>;
    /** Whether this group is collapsed by default */
    collapsed?: boolean;
}
/**
 * Parsed result from a .dgmo sequence diagram.
 */
interface ParsedSequenceDgmo {
    title: string | null;
    titleLineNumber: number | null;
    participants: SequenceParticipant[];
    messages: SequenceMessage[];
    elements: SequenceElement[];
    groups: SequenceGroup[];
    sections: SequenceSection[];
    tagGroups: TagGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}
/**
 * Parse a .dgmo file with `chart: sequence` into a structured representation.
 */
declare function parseSequenceDgmo(content: string): ParsedSequenceDgmo;
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

type GraphShape = 'terminal' | 'process' | 'decision' | 'io' | 'subroutine' | 'document' | 'state' | 'pseudostate';
type GraphDirection = 'TB' | 'LR';
interface GraphNode {
    id: string;
    label: string;
    shape: GraphShape;
    color?: string;
    group?: string;
    lineNumber: number;
}
interface GraphEdge {
    source: string;
    target: string;
    label?: string;
    color?: string;
    lineNumber: number;
}
interface GraphGroup {
    id: string;
    label: string;
    color?: string;
    nodeIds: string[];
    lineNumber: number;
}

interface ParsedGraph {
    type: 'flowchart' | 'state';
    title?: string;
    titleLineNumber?: number;
    direction: GraphDirection;
    nodes: GraphNode[];
    edges: GraphEdge[];
    groups?: GraphGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}

type ChartType = string;
interface DiagramSymbols {
    kind: ChartType;
    entities: string[];
    keywords: string[];
    /**
     * Map of alias-literal → canonical entity name, collected from
     * `Name as <alias>` declarations in the document. Editor surfaces
     * both forms in autocomplete; selecting an alias inserts the alias
     * literal (the alias is input convenience, not a display name).
     */
    aliases?: Record<string, string>;
}
type ExtractFn = (docText: string) => DiagramSymbols;

declare function parseFlowchart(content: string, palette?: PaletteColors): ParsedGraph;
/**
 * Detect if content looks like a flowchart (without explicit `chart: flowchart` header).
 * Checks for shape delimiters combined with `->` arrows.
 * Avoids false-positives on sequence diagrams (which use bare names with `->`)
 */
declare function looksLikeFlowchart(content: string): boolean;

declare function parseState(content: string, palette?: PaletteColors): ParsedGraph;
/**
 * Detect if content looks like a state diagram (without explicit `chart: state` header).
 * Only matches if `[*]` token is present — too ambiguous to infer from bare names alone.
 */
declare function looksLikeState(content: string): boolean;

interface LayoutNode {
    id: string;
    label: string;
    shape: GraphShape;
    color?: string;
    group?: string;
    lineNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface LayoutEdge {
    source: string;
    target: string;
    points: {
        x: number;
        y: number;
    }[];
    label?: string;
    lineNumber: number;
}
interface LayoutGroup {
    id: string;
    label: string;
    color?: string;
    lineNumber: number;
    collapsed?: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface LayoutOptions {
    /** Map of group ID → number of child nodes (for collapsed groups) */
    collapsedChildCounts?: Map<string, number>;
    /** Original groups before collapse (includes collapsed ones) */
    originalGroups?: GraphGroup[];
}
interface LayoutResult$1 {
    nodes: LayoutNode[];
    edges: LayoutEdge[];
    groups: LayoutGroup[];
    width: number;
    height: number;
}
declare function layoutGraph(graph: ParsedGraph, options?: LayoutOptions): LayoutResult$1;

declare function renderState(container: HTMLDivElement, graph: ParsedGraph, layout: LayoutResult$1, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}): void;
declare function renderStateForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

interface StateCollapseResult {
    parsed: ParsedGraph;
    collapsedChildCounts: Map<string, number>;
    originalGroups: GraphGroup[];
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

type ClassModifier = 'abstract' | 'interface' | 'enum';
type MemberVisibility = 'public' | 'private' | 'protected';
type RelationshipType = 'extends' | 'implements' | 'composes' | 'aggregates' | 'depends' | 'associates';
interface ClassMember {
    name: string;
    type?: string;
    params?: string;
    visibility: MemberVisibility;
    isStatic: boolean;
    isMethod: boolean;
    lineNumber: number;
}
interface ClassNode {
    id: string;
    name: string;
    modifier?: ClassModifier;
    color?: string;
    members: ClassMember[];
    lineNumber: number;
}
interface ClassRelationship {
    source: string;
    target: string;
    type: RelationshipType;
    label?: string;
    lineNumber: number;
}

interface ParsedClassDiagram {
    type: 'class';
    title?: string;
    titleLineNumber?: number;
    classes: ClassNode[];
    relationships: ClassRelationship[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}

declare function parseClassDiagram(content: string, palette?: PaletteColors): ParsedClassDiagram;
/**
 * Detect if content looks like a class diagram without explicit `chart: class`.
 * Requires class-like patterns (capitalized names with modifiers or UML relationships).
 * Must not false-positive on flowcharts.
 */
declare function looksLikeClassDiagram(content: string): boolean;

interface ClassLayoutNode extends ClassNode {
    x: number;
    y: number;
    width: number;
    height: number;
    headerHeight: number;
    fieldsHeight: number;
    methodsHeight: number;
}
interface ClassLayoutEdge {
    source: string;
    target: string;
    type: RelationshipType;
    points: {
        x: number;
        y: number;
    }[];
    label?: string;
    lineNumber: number;
}
interface ClassLayoutResult {
    nodes: ClassLayoutNode[];
    edges: ClassLayoutEdge[];
    width: number;
    height: number;
}
declare function layoutClassDiagram(parsed: ParsedClassDiagram): ClassLayoutResult;

declare function renderClassDiagram(container: HTMLDivElement, parsed: ParsedClassDiagram, layout: ClassLayoutResult, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}, legendActive?: boolean | null, exportMode?: boolean): void;
declare function renderClassDiagramForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

type ERConstraint = 'pk' | 'fk' | 'unique' | 'nullable';
type ERCardinality = '1' | '*' | '?';
interface ERColumn {
    name: string;
    type?: string;
    constraints: ERConstraint[];
    lineNumber: number;
}
interface ERTable {
    id: string;
    name: string;
    color?: string;
    columns: ERColumn[];
    metadata: Record<string, string>;
    lineNumber: number;
}
interface ERRelationship {
    source: string;
    target: string;
    cardinality: {
        from: ERCardinality;
        to: ERCardinality;
    };
    label?: string;
    lineNumber: number;
}

interface ParsedERDiagram {
    type: 'er';
    title?: string;
    titleLineNumber?: number;
    options: Record<string, string>;
    tables: ERTable[];
    relationships: ERRelationship[];
    tagGroups: TagGroup[];
    diagnostics: DgmoError[];
    error: string | null;
}

declare function parseERDiagram(content: string, palette?: PaletteColors): ParsedERDiagram;
/**
 * Detect if content looks like an ER diagram without explicit `er` first line.
 * Looks for indented lines with pk or fk constraint keywords.
 */
declare function looksLikeERDiagram(content: string): boolean;

interface ERLayoutNode extends ERTable {
    x: number;
    y: number;
    width: number;
    height: number;
    headerHeight: number;
    columnsHeight: number;
}
interface ERLayoutEdge {
    source: string;
    target: string;
    cardinality: {
        from: string;
        to: string;
    };
    points: {
        x: number;
        y: number;
    }[];
    label?: string;
    lineNumber: number;
}
interface ERLayoutResult {
    nodes: ERLayoutNode[];
    edges: ERLayoutEdge[];
    width: number;
    height: number;
}
declare function layoutERDiagram(parsed: ParsedERDiagram): ERLayoutResult;

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

interface OrgNode {
    id: string;
    label: string;
    metadata: Record<string, string>;
    children: OrgNode[];
    parentId: string | null;
    isContainer: boolean;
    lineNumber: number;
    color?: string;
}
interface ParsedOrg {
    title: string | null;
    titleLineNumber: number | null;
    roots: OrgNode[];
    tagGroups: TagGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}
declare function parseOrg(content: string, palette?: PaletteColors): ParsedOrg;

interface OrgLayoutNode {
    id: string;
    label: string;
    metadata: Record<string, string>;
    /** Original (unfiltered) metadata — used for tag-based hover dimming even when the group is hidden */
    tagMetadata: Record<string, string>;
    isContainer: boolean;
    lineNumber: number;
    color?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Count of hidden descendants when this node is collapsed */
    hiddenCount?: number;
    /** True if node has children (expanded or collapsed) — drives toggle UI */
    hasChildren?: boolean;
}
interface OrgLayoutEdge {
    sourceId: string;
    targetId: string;
    points: {
        x: number;
        y: number;
    }[];
}
interface OrgContainerBounds {
    nodeId: string;
    label: string;
    lineNumber: number;
    color?: string;
    metadata: Record<string, string>;
    /** Original (unfiltered) metadata — used for tag-based hover dimming even when the group is hidden */
    tagMetadata: Record<string, string>;
    x: number;
    y: number;
    width: number;
    height: number;
    labelHeight: number;
    /** Count of hidden descendants when this container is collapsed */
    hiddenCount?: number;
    /** True if container has children (expanded or collapsed) — drives toggle UI */
    hasChildren?: boolean;
}
interface OrgLegendEntry {
    value: string;
    color: string;
}
interface OrgLegendGroup {
    name: string;
    alias?: string;
    entries: OrgLegendEntry[];
    x: number;
    y: number;
    width: number;
    height: number;
    minifiedWidth: number;
    minifiedHeight: number;
}
interface OrgLayoutResult {
    nodes: OrgLayoutNode[];
    edges: OrgLayoutEdge[];
    containers: OrgContainerBounds[];
    legend: OrgLegendGroup[];
    width: number;
    height: number;
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
    id: string;
    title: string;
    tags: Record<string, string>;
    details: string[];
    lineNumber: number;
    endLineNumber: number;
    color?: string;
}
interface KanbanColumn {
    id: string;
    name: string;
    wipLimit?: number;
    color?: string;
    metadata?: Record<string, string>;
    cards: KanbanCard[];
    lineNumber: number;
}
interface ParsedKanban {
    type: 'kanban';
    title?: string;
    titleLineNumber?: number;
    columns: KanbanColumn[];
    tagGroups: KanbanTagGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
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
    target: string;
    label?: string;
    technology?: string;
    arrowType: C4ArrowType;
    lineNumber: number;
}
interface C4Group {
    name: string;
    children: C4Element[];
    lineNumber: number;
}
interface C4Element {
    name: string;
    type: C4ElementType;
    shape: C4Shape;
    metadata: Record<string, string>;
    description?: string[];
    children: C4Element[];
    groups: C4Group[];
    relationships: C4Relationship[];
    importPath?: string;
    lineNumber: number;
    sectionHeader?: 'containers' | 'components';
    sectionHeaderLineNumber?: number;
}
interface C4DeploymentNode {
    name: string;
    metadata: Record<string, string>;
    shape: C4Shape;
    children: C4DeploymentNode[];
    containerRefs: string[];
    lineNumber: number;
}
interface ParsedC4 {
    title: string | null;
    titleLineNumber: number | null;
    options: Record<string, string>;
    tagGroups: TagGroup[];
    elements: C4Element[];
    relationships: C4Relationship[];
    deployment: C4DeploymentNode[];
    diagnostics: DgmoError[];
    error: string | null;
}

declare function parseC4(content: string, palette?: PaletteColors): ParsedC4;

interface C4LayoutNode {
    id: string;
    name: string;
    type: 'person' | 'system' | 'container' | 'component';
    description?: string;
    metadata: Record<string, string>;
    lineNumber: number;
    color?: string;
    shape?: C4Shape;
    technology?: string;
    drillable?: boolean;
    importPath?: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface C4LayoutEdge {
    source: string;
    target: string;
    arrowType: C4ArrowType;
    label?: string;
    technology?: string;
    lineNumber: number;
    points: {
        x: number;
        y: number;
    }[];
}
interface C4LegendEntry {
    value: string;
    color: string;
}
interface C4LegendGroup {
    name: string;
    entries: C4LegendEntry[];
    x: number;
    y: number;
    width: number;
    height: number;
}
interface C4LayoutBoundary {
    label: string;
    typeLabel: string;
    lineNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface C4LayoutResult {
    nodes: C4LayoutNode[];
    edges: C4LayoutEdge[];
    legend: C4LegendGroup[];
    boundary?: C4LayoutBoundary;
    groupBoundaries: C4LayoutBoundary[];
    width: number;
    height: number;
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
    label: string;
    lineNumber: number;
    metadata: Record<string, string>;
    description?: string[];
}
interface BLEdge {
    source: string;
    target: string;
    label?: string;
    bidirectional: boolean;
    lineNumber: number;
    metadata: Record<string, string>;
}
interface BLGroup {
    label: string;
    children: string[];
    lineNumber: number;
    metadata: Record<string, string>;
    parentGroup?: string;
}
interface ParsedBoxesAndLines {
    type: 'boxes-and-lines';
    title: string | null;
    titleLineNumber: number | null;
    nodes: BLNode[];
    edges: BLEdge[];
    groups: BLGroup[];
    tagGroups: TagGroup[];
    options: Record<string, string>;
    initialHiddenTagValues: Map<string, Set<string>>;
    direction: 'LR' | 'TB';
    diagnostics: DgmoError[];
    error: string | null;
}

declare function parseBoxesAndLines(content: string): ParsedBoxesAndLines;

interface BLLayoutNode {
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface BLLayoutEdge {
    source: string;
    target: string;
    label?: string;
    bidirectional: boolean;
    lineNumber: number;
    points: {
        x: number;
        y: number;
    }[];
    labelX?: number;
    labelY?: number;
    yOffset: number;
    parallelCount: number;
    metadata: Record<string, string>;
    /** Marker for renderer: draw with linear curve, not curveBasis (ELK gives
     * us orthogonal polylines and curveBasis would smooth corners into waves) */
    deferred?: boolean;
}
interface BLLayoutGroup {
    label: string;
    lineNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
    collapsed: boolean;
    childCount?: number;
}
interface BLLayoutResult {
    nodes: BLLayoutNode[];
    edges: BLLayoutEdge[];
    groups: BLLayoutGroup[];
    width: number;
    height: number;
}
declare function layoutBoxesAndLines(parsed: ParsedBoxesAndLines, collapseInfo?: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: BLGroup[];
}, layoutOptions?: {
    hideDescriptions?: boolean;
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
    originalGroups: BLGroup[];
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

interface SitemapNode {
    id: string;
    label: string;
    metadata: Record<string, string>;
    children: SitemapNode[];
    parentId: string | null;
    description?: string[];
    /** True for [Group Name] container nodes */
    isContainer: boolean;
    lineNumber: number;
    color?: string;
}
interface SitemapEdge {
    sourceId: string;
    targetId: string;
    label?: string;
    lineNumber: number;
}
type SitemapDirection = 'TB' | 'LR';
interface ParsedSitemap {
    title: string | null;
    titleLineNumber: number | null;
    direction: SitemapDirection;
    /** Top-level nodes (roots of the hierarchy) */
    roots: SitemapNode[];
    /** All cross-link edges */
    edges: SitemapEdge[];
    tagGroups: TagGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}

/**
 * Returns true if content looks like a sitemap diagram.
 * Heuristic: has `->` arrows AND `[Group]` containers but does NOT have
 * flowchart shape delimiters ((...), <...>, /.../) adjacent to arrows.
 */
declare function looksLikeSitemap(content: string): boolean;
declare function parseSitemap(content: string, palette?: PaletteColors): ParsedSitemap;

interface SitemapLayoutNode {
    id: string;
    label: string;
    metadata: Record<string, string>;
    /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
    tagMetadata: Record<string, string>;
    description?: string[];
    isContainer: boolean;
    lineNumber: number;
    color?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Count of hidden descendants when collapsed */
    hiddenCount?: number;
    /** True if node has children (expanded or collapsed) — drives toggle UI */
    hasChildren?: boolean;
}
interface SitemapLayoutEdge {
    sourceId: string;
    targetId: string;
    points: {
        x: number;
        y: number;
    }[];
    label?: string;
    lineNumber: number;
    /** True for edges deferred from dagre (container endpoints) — use linear curve */
    deferred?: boolean;
}
interface SitemapContainerBounds {
    nodeId: string;
    label: string;
    lineNumber: number;
    color?: string;
    metadata: Record<string, string>;
    /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
    tagMetadata: Record<string, string>;
    x: number;
    y: number;
    width: number;
    height: number;
    labelHeight: number;
    /** Count of hidden descendants when collapsed */
    hiddenCount?: number;
    /** True if container has children (expanded or collapsed) */
    hasChildren?: boolean;
}
interface SitemapLegendEntry {
    value: string;
    color: string;
}
interface SitemapLegendGroup {
    name: string;
    alias?: string;
    entries: SitemapLegendEntry[];
    x: number;
    y: number;
    width: number;
    height: number;
    minifiedWidth: number;
    minifiedHeight: number;
}
interface SitemapLayoutResult {
    nodes: SitemapLayoutNode[];
    edges: SitemapLayoutEdge[];
    containers: SitemapContainerBounds[];
    legend: SitemapLegendGroup[];
    width: number;
    height: number;
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
/** All recognized property keys (behavior + structural). */
declare const INFRA_BEHAVIOR_KEYS: Set<string>;
interface InfraProperty {
    key: string;
    value: string | number;
    lineNumber: number;
}
interface InfraNode {
    id: string;
    label: string;
    properties: InfraProperty[];
    groupId: string | null;
    tags: Record<string, string>;
    isEdge: boolean;
    description?: string[];
    lineNumber: number;
}
interface InfraEdge {
    sourceId: string;
    targetId: string;
    label: string;
    async: boolean;
    split: number | null;
    fanout: number | null;
    lineNumber: number;
}
interface InfraGroup {
    id: string;
    label: string;
    /** Number of instances (or auto-scaling range "N-M") of this group as a unit. */
    instances?: number | string;
    /** Whether this group should be collapsed by default in the source. */
    collapsed?: boolean;
    /** Pipe metadata on the group header, cascaded to children. */
    metadata?: Record<string, string>;
    lineNumber: number;
}
interface InfraTagValue {
    name: string;
    color?: string;
}
interface InfraTagGroup {
    name: string;
    alias: string | null;
    values: InfraTagValue[];
    /** Value of the entry marked `default` (nodes without this tag get it automatically). */
    defaultValue?: string;
    lineNumber: number;
}
interface ParsedInfra {
    type: 'infra';
    title: string | null;
    titleLineNumber: number | null;
    direction: 'LR' | 'TB';
    nodes: InfraNode[];
    edges: InfraEdge[];
    groups: InfraGroup[];
    tagGroups: InfraTagGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
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

declare function computeInfra(parsed: ParsedInfra, params?: InfraComputeParams): ComputedInfraModel;

declare function validateInfra(parsed: ParsedInfra): InfraDiagnostic[];
/**
 * Validate computed model (post-computation warnings).
 * Call after computeInfra() to get uptime/SLA warnings.
 */
declare function validateComputed(computed: ComputedInfraModel): InfraDiagnostic[];

interface InfraLayoutNode {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    computedRps: number;
    overloaded: boolean;
    rateLimited: boolean;
    isEdge: boolean;
    groupId: string | null;
    computedLatencyMs: number;
    computedLatencyPercentiles: ComputedInfraNode['computedLatencyPercentiles'];
    computedUptime: number;
    computedAvailability: number;
    computedAvailabilityPercentiles: ComputedInfraNode['computedAvailabilityPercentiles'];
    computedInstances: number;
    computedConcurrentInvocations: number;
    computedCbState: ComputedInfraNode['computedCbState'];
    childHealthState?: ComputedInfraNode['childHealthState'];
    properties: ComputedInfraNode['properties'];
    queueMetrics?: ComputedInfraNode['queueMetrics'];
    tags: Record<string, string>;
    description?: string[];
    lineNumber: number;
}
interface InfraLayoutEdge {
    sourceId: string;
    targetId: string;
    label: string;
    async: boolean;
    computedRps: number;
    split: number;
    fanout: number | null;
    points: {
        x: number;
        y: number;
    }[];
    lineNumber: number;
}
interface InfraLayoutGroup {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    instances?: number | string;
    lineNumber: number;
}
interface InfraLayoutResult {
    nodes: InfraLayoutNode[];
    edges: InfraLayoutEdge[];
    groups: InfraLayoutGroup[];
    /** Diagram-level options (e.g., default-latency-ms, default-uptime). */
    options: Record<string, string>;
    direction: 'LR' | 'TB';
    width: number;
    height: number;
}
declare function layoutInfra(computed: ComputedInfraModel, expandedNodeIds?: Set<string> | null, collapsedNodes?: Set<string> | null): InfraLayoutResult;

interface InfraRole {
    name: string;
    color: string;
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
declare function computeInfraLegendGroups(nodes: InfraLayoutNode[], tagGroups: InfraTagGroup[], palette: PaletteColors, edges?: InfraLayoutEdge[]): InfraLegendGroup[];
interface InfraPlaybackState {
    expanded: boolean;
    paused: boolean;
    speed: number;
    speedOptions: readonly number[];
}
declare function renderInfra(container: HTMLDivElement, layout: InfraLayoutResult, palette: PaletteColors, isDark: boolean, title: string | null, titleLineNumber: number | null, tagGroups?: InfraTagGroup[], activeGroup?: string | null, animate?: boolean, playback?: InfraPlaybackState | null, expandedNodeIds?: Set<string> | null, exportMode?: boolean, collapsedNodes?: Set<string> | null): void;
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
    targetName: string;
    label?: string;
    offset?: Offset;
    lineNumber: number;
}
interface GanttTask {
    id: string;
    label: string;
    duration: Duration | null;
    explicitStart?: string;
    uncertain: boolean;
    progress: number | null;
    offset?: Offset;
    dependencies: GanttDependency[];
    metadata: Record<string, string>;
    lineNumber: number;
    groupPath: string[];
    comment?: string;
}
interface GanttGroup {
    name: string;
    color: string | null;
    metadata: Record<string, string>;
    lineNumber: number;
    children: GanttNode[];
}
interface GanttParallelBlock {
    kind: 'parallel';
    lineNumber: number;
    children: GanttNode[];
}
/** A node in the gantt tree: either a task, group, or parallel block. */
type GanttNode = ({
    kind: 'task';
} & GanttTask) | ({
    kind: 'group';
} & GanttGroup) | GanttParallelBlock;
type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
interface HolidayDate {
    date: string;
    label: string;
    lineNumber: number;
}
interface HolidayRange {
    startDate: string;
    endDate: string;
    label: string;
    lineNumber: number;
}
interface GanttHolidays {
    dates: HolidayDate[];
    ranges: HolidayRange[];
    workweek: Weekday[];
}
interface GanttEra {
    startDate: string;
    endDate: string;
    label: string;
    color: string | null;
    lineNumber: number;
}
interface GanttMarker {
    date: string;
    label: string;
    color: string | null;
    lineNumber: number;
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
    solidFill: boolean;
    /** When true, the renderer suppresses the chart banner title. */
    noTitle: boolean;
}
interface ParsedGantt {
    nodes: GanttNode[];
    holidays: GanttHolidays;
    tagGroups: TagGroup[];
    eras: GanttEra[];
    markers: GanttMarker[];
    options: GanttOptions;
    diagnostics: DgmoError[];
    error: string | null;
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
declare function collectTasks(nodes: GanttNode[]): GanttTask[];
/**
 * Resolve a dependency target name to a task.
 *
 * Resolution strategy (greedy right-to-left):
 * 1. Try the full string as an exact task label match
 * 2. If no match, split at the last dot → group prefix + task label
 * 3. Recurse for deeper paths
 *
 * Returns a match or an error with helpful suggestions.
 */
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
/**
 * One row of the project-stats caption. Replaces the previous
 * `\n`-joined `summaryText` string with a structured shape so the
 * renderer doesn't have to recover bullet structure by splitting on
 * `\n` / `. ` and tests can assert on `isPast` directly instead of
 * matching the trailing `(latest-safe start has passed)` suffix.
 */
interface CaptionRow {
    /** Pre-formatted caption text for this row (no leading bullet glyph). */
    text: string;
    /** 0 = top-level row; 1 = sub-row (indented under the previous level-0 row). */
    level: 0 | 1;
    /** When true, renderer paints the text italic. */
    italic?: boolean;
    /**
     * Backward-mode flag — true when the row reports a latest-safe-start
     * date that precedes `options.today`. The text already carries a
     * `(latest-safe start has passed)` suffix; the flag is for downstream
     * styling/test assertions.
     */
    isPast?: boolean;
}
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
     * `now` was authored. Analyzer reads this to flag past latest-safe
     * starts in backward mode; renderer surfaces it in the
     * `(as of YYYY-MM-DD)` anchor annotation. Empty string when the
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
    id: string;
    /** Human-readable label as written in source. */
    name: string;
    /** Optional alias from `<name> <durs> as <id>`. */
    alias?: string;
    /**
     * Activity duration estimate.
     * - `null` → TBD (no estimate); analyzer poisons descendants with `null`.
     */
    duration: DurationEstimate | null;
    /**
     * Per-activity confidence override from pipe metadata (`| confidence: low`).
     * When unset, analyzer uses `options.confidence`.
     */
    confidence?: string;
    /** Group id this activity belongs to (post-resolve). */
    groupId?: string;
    /** Source line of the declaration site (1-based). */
    lineNumber: number;
    /** True for `milestone <name>` primitives (zero-duration, diamond shape). */
    isMilestone: boolean;
    /**
     * Resolved tag-group metadata from pipe-metadata aliases. Keys are
     * lowercased tag-group names (e.g. `priority`, `team`); values are the
     * authored tag entry names. Drives node fill via `resolveTagColor()`
     * when an `active-tag` group is set. Empty when no tag groups are
     * declared or the activity carried no tag metadata.
     */
    tags?: Record<string, string>;
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
    source: string;
    target: string;
    lineNumber: number;
    type: EdgeType;
    lag: Duration | null;
}
/** Group declared via `[group-name] | metadata`. */
interface PertGroup {
    id: string;
    name: string;
    /** Activity ids belonging to this group, populated in Pass 2. */
    activityIds: string[];
    /** Whether the user authored `| collapsed: true`. */
    collapsed: boolean;
    /** Source line of the `[group-name]` header (1-based). */
    lineNumber: number;
    /**
     * Resolved tag-group metadata for the cluster header — same shape as
     * `PertActivity.tags`. Currently informational; default-tag injection
     * skips groups (containers) so they appear "untagged" unless the user
     * authors an explicit value via pipe metadata.
     */
    tags?: Record<string, string>;
    /**
     * Auto-detected group topology (Pass 2 result).
     * - `hammock`: single entry + single exit — collapses to a super-edge.
     * - `cluster`: multi-entry or multi-exit — collapses to a bounding rect.
     */
    classification?: 'hammock' | 'cluster';
}
/** Output of `parsePert(content)`. */
interface ParsedPert {
    /** Optional title parsed from `pert <title>`. */
    title: string | null;
    options: PertOptions;
    activities: PertActivity[];
    edges: PertEdge[];
    groups: PertGroup[];
    /**
     * Tag groups declared at the top of the diagram (`tag Priority as p
     * High red, Low green`). Drive node fill via `resolveTagColor()`.
     * Empty when no `tag` blocks are declared.
     */
    tagGroups: TagGroup[];
    /**
     * Map alias-or-name → canonical activity id. Useful for the analyzer
     * and for editor autocomplete; also populated in Pass 2.
     */
    idMap: Record<string, string>;
    diagnostics: DgmoError[];
    /** First fatal error message; `null` when parse succeeded. */
    error: string | null;
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
     * Project-stats caption rows. Each row is one bullet in the rendered
     * caption box; level-1 rows render indented under the preceding
     * level-0 row. Null only when analysis bails out before producing
     * any output (e.g. cycle detection); non-null in every successful
     * analyze() run.
     */
    summaryRows: CaptionRow[] | null;
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
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface PertLayoutEdge {
    source: string;
    target: string;
    points: {
        x: number;
        y: number;
    }[];
}
interface PertLayoutGroup {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    classification: 'hammock' | 'cluster';
    /**
     * True when the group is currently collapsed. Layout sized this rect
     * as a single rolled-up node and hid the group's member activities
     * from `nodes` / re-routed external edges to land on this rect.
     */
    collapsed?: boolean;
}
interface LayoutResult {
    nodes: PertLayoutNode[];
    edges: PertLayoutEdge[];
    groups: PertLayoutGroup[];
    width: number;
    height: number;
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
 * Substitute `start-date now` with the host-local resolved date.
 * Pass the result to `encodeDiagramUrl` so the share-link captures
 * the resolved date, not the literal token.
 *
 * Lines without `start-date now` (explicit-date lines, comments,
 * other directives, activity lines containing the word "now") pass
 * through verbatim.
 */
declare function normalizePertSourceForShare(dsl: string): string;

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
     * (title + backward-anchor annotation + diagram body + caption
     * block) so the diagram never clips. Pass `undefined` (or omit) to
     * use the auto-computed natural size.
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
     * Render the 3×2 field-reference mini-card to the right of the
     * Summary box. Helps presenters explain what each schedule cell
     * (ES / dur / EF / LS / slack / LF) means while reviewing the
     * diagram. Off by default; the desktop app turns it on with the
     * "Field labels" toggle.
     */
    showFieldLegend?: boolean;
    /**
     * Render the top legend (Critical Path / Anchor / Milestone pills)
     * inside the SVG, between the title and the diagram. Defaults to
     * true so CLI exports and share-link images include the legend; the
     * desktop preview flips it off and renders the legend in a sibling
     * native-pixel SVG instead, so the pill text stays at intended size
     * even when the diagram SVG gets scale-to-fit'd into the panel.
     */
    showTopLegend?: boolean;
    /**
     * Render the project-stats Summary box below the diagram. Defaults
     * to true so CLI exports / share-link images keep showing it; the
     * desktop app's cog has a "Summary" toggle that flips this off when
     * readers want a cleaner chart.
     */
    showSummary?: boolean;
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
}
declare function renderPert(container: HTMLDivElement, resolved: ResolvedPert, layout: LayoutResult, palette: PaletteColors, isDark: boolean, options?: PertRenderOptions): void;
declare function renderPertForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors, 
/**
 * Optional parse-time "today" override. Threads through to
 * `parsePert({ now })` so the analyzer's backward-mode past-date
 * check + the anchor annotation's "(as of YYYY-MM-DD)" suffix stay
 * deterministic. Test snapshots pin this; production code omits it.
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
    showSummary?: boolean;
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
    showSummary?: boolean;
    showTornado?: boolean;
    showScurve?: boolean;
    showFieldLegend?: boolean;
}): void;
/**
 * Fade everything in the diagram that doesn't belong to the given
 * legend set (`'critical'`, `'anchor'`, or `'milestone'`). Auto-detects
 * MC vs analytical mode for the critical-path rule.
 *
 * No-op when nothing qualifies (e.g. hovering Anchor on a diagram with
 * no anchor — shouldn't happen because the pill wouldn't render, but
 * defensive). The React layer is responsible for resetting via
 * `resetPertHighlight` when hover/click goes away.
 */
declare function highlightPertSet(container: Element, kind: LegendKind): void;
/**
 * Critical-path-specific shorthand for `highlightPertSet(container,
 * 'critical')`. Kept for backwards compatibility with existing callers.
 */
declare function highlightPertCriticalPath(container: Element): void;
/**
 * Reset opacities applied by `highlightPertSet`. Safe to call when no
 * highlight is active.
 */
declare function resetPertHighlight(container: Element): void;
/**
 * Backwards-compatible alias for `resetPertHighlight`.
 */
declare function resetPertCriticalPath(container: Element): void;
/**
 * Render the 3×2 PERT-field reference card. A neutral-tinted rounded
 * rect with a "Activity card fields" header band on top (mirroring the
 * Summary's typographic idiom) and a 3×2 grid of labeled definitions
 * below — so the cells map 1-to-1 to the schedule cells of every
 * activity card without pretending to be a node themselves.
 *
 * The cell content is vertically centered inside each row, so the
 * legend looks balanced whether it's sized to a tall Summary (lots of
 * bullets) or its compact default height.
 *
 * Cell order follows `drawTextbookCard`:
 *   top:    [ Early Start | Duration | Early Finish ]
 *   bottom: [ Late Start  | Slack    | Late Finish  ]
 */
type LegendKind = 'critical' | 'anchor' | 'milestone';
interface LegendEntry {
    kind: LegendKind;
    label: string;
}
/**
 * Returns the PERT-specific legend entries (Critical Path / Anchor /
 * Milestone). Tag groups are rendered separately via the shared
 * `renderLegendD3` helper so they get the standard collapsible-capsule
 * treatment used by org / kanban / gantt.
 */
declare function pertLegendEntries(resolved: ResolvedPert): LegendEntry[];
interface LegendBlockArgs {
    x: number;
    y: number;
    width: number;
    palette: PaletteColors;
    isDark: boolean;
}
/**
 * Render the top-legend pill row. Each pill carries
 * `data-legend-entry="critical|anchor|milestone"` so the React layer
 * can attach hover/click wiring to fade the matching set.
 *
 * Visual style mirrors the shared `renderLegendD3` pill convention so
 * PERT looks consistent with Cycle / Mindmap / BoxesAndLines: 28px tall,
 * fully-rounded rx, mix-fill against surface, no stroke, 11pt label.
 */
declare const PERT_LEGEND_PILL_HEIGHT = 28;
declare function pertLegendBlockWidth(entries: LegendEntry[]): number;
declare function renderLegendBlock(svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>, entries: LegendEntry[], args: LegendBlockArgs): void;

interface MindmapNode {
    id: string;
    label: string;
    description?: string[];
    metadata: Record<string, string>;
    children: MindmapNode[];
    parentId: string | null;
    lineNumber: number;
    color?: string;
    collapsed?: boolean;
}
interface ParsedMindmap {
    title: string | null;
    titleLineNumber: number | null;
    roots: MindmapNode[];
    tagGroups: TagGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}
interface MindmapLayoutNode {
    id: string;
    label: string;
    description?: string[];
    metadata: Record<string, string>;
    lineNumber: number;
    color?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
    angle: number;
    radius: number;
    hiddenCount?: number;
    hasChildren?: boolean;
}
interface MindmapLayoutEdge {
    sourceId: string;
    targetId: string;
    path: string;
}
interface MindmapLayoutResult {
    nodes: MindmapLayoutNode[];
    edges: MindmapLayoutEdge[];
    width: number;
    height: number;
}

declare function parseMindmap(content: string, palette?: PaletteColors): ParsedMindmap;

declare function layoutMindmap(parsed: ParsedMindmap, _palette: PaletteColors, options?: {
    interactive?: boolean;
    hiddenCounts?: Map<string, number>;
    activeTagGroup?: string | null;
    hideDescriptions?: boolean;
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
}): void;
declare function renderMindmapForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

interface CollapsedMindmapResult {
    /** Roots with collapsed subtrees pruned (deep-cloned, never mutates original) */
    roots: MindmapNode[];
    /** nodeId → count of hidden descendants */
    hiddenCounts: Map<string, number>;
}
declare function collapseMindmapTree(roots: MindmapNode[], collapsedIds: Set<string>): CollapsedMindmapResult;

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
    id: string;
    type: WireframeElementType;
    /** Display label / placeholder text / heading text */
    label: string;
    /** Child elements (non-empty only when isContainer=true) */
    children: WireframeElement[];
    /** Pipe metadata key-value pairs */
    metadata: Record<string, string>;
    /** State keywords: disabled, active, ghost, destructive, etc. */
    states: string[];
    /** Free-text annotations from pipe metadata */
    annotations: string[];
    /** 1-based line number in source */
    lineNumber: number;
    /** Measured indentation (column) */
    indent: number;
    /** True when element has children (set during parse via indent stack) */
    isContainer: boolean;
    /** Stacking direction for group children */
    orientation: 'vertical' | 'horizontal';
    /** True when inside a skeleton block */
    isSkeleton: boolean;
    /** Heading level: 1 for `#`, 2 for `##` */
    headingLevel?: number;
    /** Dropdown options (for type='dropdown') */
    options?: string[];
    /** Checked state (for type='checkbox') */
    checked?: boolean;
    /** Selected state (for type='radio') */
    selected?: boolean;
    /** Image hint: 'default' | 'round' | 'wide' */
    imageHint?: 'default' | 'round' | 'wide';
    /** Progress value 0-100 (for type='progress') */
    progressValue?: number;
    /** Chart hint: 'line' | 'bar' | 'pie' */
    chartHint?: 'line' | 'bar' | 'pie';
    /** Table dimensions for skeleton shorthand (for type='table') */
    tableRows?: number;
    tableCols?: number;
    /** Table header row labels (for type='table') */
    tableHeaders?: string[];
    /** Table data rows — each row is an array of cell content strings (for type='table') */
    tableData?: string[][];
    /** Inline elements on the same line (multi-element line) */
    inlineElements?: WireframeElement[];
    /** Label element for label-field pairing */
    labelFor?: WireframeElement;
    /** Color from tag system */
    color?: string;
    /** Field variant: password, textarea */
    fieldVariant?: 'password' | 'textarea';
}
/** Form factor / layout mode */
type WireframeFormFactor = 'desktop' | 'mobile';
interface ParsedWireframe {
    title: string | null;
    titleLineNumber: number | null;
    formFactor: WireframeFormFactor;
    /** Top-level elements (roots of the hierarchy) */
    roots: WireframeElement[];
    /** Modal elements (rendered separately below main) */
    modals: WireframeElement[];
    tagGroups: TagGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}

declare function parseWireframe(content: string): ParsedWireframe;

interface WireframeLayoutNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    element: WireframeElement;
    children: WireframeLayoutNode[];
    /** For label-field pairs: the x offset where fields align */
    fieldAlignX?: number;
}
interface WireframeLayout {
    width: number;
    height: number;
    titleHeight: number;
    nodes: WireframeLayoutNode[];
    modalNodes: WireframeLayoutNode[];
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
    name: string;
    alias: string | null;
    lineNumber: number;
}
interface TechRadarBlip {
    name: string;
    ring: string;
    trend: BlipTrend | null;
    description: string[];
    lineNumber: number;
    /** Assigned after parsing — global numbering across all quadrants. */
    globalNumber: number;
}
interface TechRadarQuadrant {
    name: string;
    position: QuadrantPosition;
    color: string | null;
    lineNumber: number;
    blips: TechRadarBlip[];
}
interface ParsedTechRadar {
    type: 'tech-radar';
    title: string;
    titleLineNumber: number;
    rings: TechRadarRing[];
    quadrants: TechRadarQuadrant[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
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
declare function computeRadarLayout(parsed: ParsedTechRadar, width: number, height: number): TechRadarLayoutPoint[];
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

interface CycleNode {
    label: string;
    lineNumber: number;
    color?: string;
    span: number;
    description: string[];
    metadata: Record<string, string>;
}
interface CycleEdge {
    sourceIndex: number;
    targetIndex: number;
    label?: string;
    color?: string;
    width?: number;
    description: string[];
    lineNumber?: number;
    metadata: Record<string, string>;
}
interface ParsedCycle {
    type: 'cycle';
    title: string;
    titleLineNumber: number;
    nodes: CycleNode[];
    edges: CycleEdge[];
    direction: 'clockwise' | 'counterclockwise';
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}

interface CycleLayoutNode {
    label: string;
    x: number;
    y: number;
    angle: number;
    width: number;
    height: number;
    /** Pre-wrapped description lines (fit to node width). Empty if no descriptions. */
    wrappedDesc: WrappedDescLine[];
    /** Whether this node should be rendered as a circle. */
    isCircle: boolean;
}
interface CycleLayoutEdge {
    sourceIndex: number;
    targetIndex: number;
    path: string;
    labelX: number;
    labelY: number;
    /** Angle of the label position on the circle (radians), for text-anchor. */
    labelAngle: number;
    label?: string;
}
interface CycleLayoutResult {
    nodes: CycleLayoutNode[];
    edges: CycleLayoutEdge[];
    cx: number;
    cy: number;
    radius: number;
    width: number;
    height: number;
    /** Scale factor applied to nodes (1 = no scaling, <1 = shrunk to fit). */
    scale: number;
}

/**
 * Parse a `.dgmo` cycle diagram document.
 *
 * Syntax:
 * ```
 * cycle Title
 *
 * direction-counterclockwise
 *
 * NodeLabel | color: blue, span: 3
 *   Description line (indented under node)
 *   -Label-> | color: red, width: 6
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
    type: 'pain' | 'opportunity' | 'thought';
    text: string;
}
interface JourneyMapStep {
    id: string;
    title: string;
    score?: number;
    emotionLabel?: string;
    tags: Record<string, string>;
    annotations: JourneyMapAnnotation[];
    description?: string;
    lineNumber: number;
    endLineNumber: number;
}
interface JourneyMapPhase {
    id: string;
    name: string;
    steps: JourneyMapStep[];
    lineNumber: number;
}
interface JourneyMapPersona {
    name: string;
    description?: string;
    color?: string;
    lineNumber: number;
}
interface ParsedJourneyMap {
    type: 'journey-map';
    title?: string;
    titleLineNumber?: number;
    persona?: JourneyMapPersona;
    phases: JourneyMapPhase[];
    /** Flat-mode steps (not inside any phase) */
    steps: JourneyMapStep[];
    tagGroups: TagGroup[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
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
    label: string;
    lineNumber: number;
    /** Optional palette color name (red/green/blue/…). */
    color?: string;
    /** Description lines — from bare pipe shorthand or indented body. */
    description: string[];
    /** Unconsumed pipe metadata (reserved for future use). */
    metadata: Record<string, string>;
}
interface ParsedPyramid {
    type: 'pyramid';
    title: string;
    titleLineNumber: number;
    layers: PyramidLayer[];
    /** When true, apex points down instead of up. */
    inverted: boolean;
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
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

interface RingLayer {
    label: string;
    lineNumber: number;
    /** Optional palette color name (red/green/blue/…). */
    color?: string;
    /** Description lines — from bare pipe shorthand or indented body. */
    description: string[];
    /** Unconsumed pipe metadata (reserved for future use). */
    metadata: Record<string, string>;
}
interface ParsedRing {
    type: 'ring';
    title: string;
    titleLineNumber: number;
    /** Source order: layers[0] = innermost (filled disc); last = outermost ring. */
    layers: RingLayer[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
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

/** Marker alphabet member for any variant. */
type RaciMarker = 'R' | 'A' | 'S' | 'C' | 'I' | 'D';
/** Variant identifier — selects alphabet + constraint rule set. */
type RaciVariant = 'raci' | 'rasci' | 'daci';
/**
 * One `Role: <markers>` line under a task.
 *
 * `id` is the normalized role key — used by mutations to look up the
 * cell and by validation to detect unknown roles. `displayName` is the
 * first-seen casing/spacing for rendering.
 */
interface RaciRoleAssignment {
    id: string;
    displayName: string;
    markers: RaciMarker[];
    lineNumber: number;
    endLineNumber: number;
}
/** One task — flush-left under a phase or directly under the chart. */
interface RaciTask {
    id: string;
    displayName: string;
    description: string;
    roleAssignments: RaciRoleAssignment[];
    lineNumber: number;
    endLineNumber: number;
}
/** Optional `[Phase Label]` group header — one level deep. */
interface RaciPhase {
    id: string;
    displayName: string;
    /** Optional palette color from a `[Label](color)` suffix on the bracket. */
    color?: string;
    tasks: RaciTask[];
    lineNumber: number;
    endLineNumber: number;
}
/** Top-level parse result. */
interface ParsedRaci {
    type: 'raci';
    /** Optional title from the chart-type header line. */
    title?: string;
    titleLineNumber?: number;
    /** Variant selected by directive, or by chart-type id when absent. */
    variant: RaciVariant;
    /**
     * Canonical column order. Populated either from an explicit
     * `roles:` directive or, when absent, from first-seen role usage.
     */
    roles: string[];
    /** Display name for each role (parallel to `roles`). */
    roleDisplayNames: string[];
    /**
     * Optional per-role palette color from the `Cap blue` trailing-token
     * suffix in the roles block (or the long pipe form `Cap | color: blue`).
     * Parallel to `roles`; entries default to `undefined` (renderer falls
     * back to the neutral column tint).
     */
    roleColors: Array<string | undefined>;
    phases: RaciPhase[];
    /** Tasks declared without a parent phase. */
    tasksWithoutPhase: RaciTask[];
    options: Record<string, string>;
    diagnostics: DgmoError[];
    error: string | null;
}

/**
 * Parse RACI/RASCI/DACI source. The leading chart-type id (if a
 * recognized variant id) acts as a hint for default variant when the
 * `variant` directive is absent.
 */
declare function parseRaci(content: string, palette?: PaletteColors): ParsedRaci;

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
    readonly DUPLICATE_VARIANT: "E_RACI_DUPLICATE_VARIANT";
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

/**
 * Async or sync file reader. Receives an absolute path, returns content.
 * Throwing means "file not found".
 */
type ReadFileFn = (path: string) => string | Promise<string>;
/** Tracks the original source file and line for an imported line. */
interface ImportSource {
    /** Absolute path of the file this line originates from */
    filePath: string;
    /** 1-based line number in the original (pre-resolution) source file */
    sourceLine: number;
}
interface ResolveImportsResult {
    content: string;
    diagnostics: DgmoError[];
    /** resolvedLine (1-based index) → originalLine (1-based) or null for inserted lines */
    lineMap: (number | null)[];
    /** resolvedLine (1-based index) → import source info or null for non-imported lines */
    importSourceMap: (ImportSource | null)[];
}
/**
 * Pre-processes org chart content, resolving `tags` and `import` directives.
 *
 * @param content   - Raw .dgmo file content
 * @param filePath  - Absolute path of the file (for relative path resolution)
 * @param readFileFn - Function to read files (sync or async)
 * @returns Merged content with all imports resolved + diagnostics
 */
declare function resolveOrgImports(content: string, filePath: string, readFileFn: ReadFileFn): Promise<ResolveImportsResult>;

declare function renderFlowchart(container: HTMLDivElement, graph: ParsedGraph, layout: LayoutResult$1, palette: PaletteColors, isDark: boolean, onClickItem?: (lineNumber: number) => void, exportDims?: {
    width?: number;
    height?: number;
}): void;
declare function renderFlowchartForExport(content: string, theme: 'light' | 'dark' | 'transparent', palette: PaletteColors): string;

declare const LEGEND_HEIGHT = 28;
declare const LEGEND_GEAR_PILL_W: number;

declare function renderLegendD3(container: D3Sel, config: LegendConfig, state: LegendState, palette: LegendPalette, isDark: boolean, callbacks?: LegendCallbacks, containerWidth?: number): LegendHandle;

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
declare function groupMessagesBySection(elements: SequenceElement[], messages: SequenceMessage[]): SectionMessageGroup[];
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
declare function buildRenderSequence(messages: SequenceMessage[]): RenderStep[];
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
declare function applyPositionOverrides(participants: SequenceParticipant[]): SequenceParticipant[];
/**
 * Reorder participants so that members of the same group are adjacent.
 * Groups are positioned at the point where their first member would naturally
 * appear based on message order (first-occurrence positioning). This prevents
 * groups declared at the top of the file from being placed before participants
 * that appear in messages earlier.
 *
 * Explicit `position` overrides are handled separately by `applyPositionOverrides`.
 */
declare function applyGroupOrdering(participants: SequenceParticipant[], groups: SequenceGroup[], messages?: SequenceMessage[]): SequenceParticipant[];
/**
 * Render a sequence diagram into the given container element.
 */
declare function renderSequenceDiagram(container: HTMLDivElement, parsed: ParsedSequenceDgmo, palette: PaletteColors, isDark: boolean, _onNavigateToLine?: (line: number) => void, options?: SequenceRenderOptions): void;
/**
 * Build a mapping from each note's lineNumber to the lineNumber of its
 * associated message (the last message before the note in document order).
 * Used by the app to highlight the associated message when cursor is on a note.
 */
declare function buildNoteMessageMap(elements: SequenceElement[]): Map<number, number>;

interface CollapsedView {
    participants: SequenceParticipant[];
    messages: SequenceMessage[];
    elements: SequenceElement[];
    groups: SequenceGroup[];
    /** Maps member participant ID → collapsed group name */
    collapsedGroupIds: Map<string, string>;
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
 * Diagram symbol extraction API + completion registry.
 *
 * Provides:
 * - DiagramSymbols interface + extractDiagramSymbols() dispatch
 * - COMPLETION_REGISTRY: chart-type → directives map (for editor autocomplete)
 * - CHART_TYPES: array of { name, description } for chart type completion
 * - METADATA_KEY_SET: derived set of all known directive keys
 *
 * Each diagram type registers its own extractor via registerExtractor().
 * All built-in extractors are registered at module init below.
 */

declare function registerExtractor(kind: ChartType, fn: ExtractFn): void;
/**
 * Extract diagram symbols from document text.
 * Returns null if the chart type is unknown or has no registered extractor.
 */
declare function extractDiagramSymbols(docText: string): DiagramSymbols | null;
/** Specification for a single directive: description + optional enumerated values. */
interface DirectiveValueSpec {
    description: string;
    values?: string[];
}
/** Specification for a chart type's directives. */
interface DirectiveSpec {
    directives: Record<string, DirectiveValueSpec>;
}
/** Chart-type → directive specifications. Every chart type has at least palette + theme. */
declare const COMPLETION_REGISTRY: Map<string, DirectiveSpec>;
declare const CHART_TYPES: ReadonlyArray<{
    name: string;
    description: string;
}>;
/**
 * Entity types for `Name is a <type>` declarations, keyed by chart type.
 * Values are sourced from parser constants (VALID_PARTICIPANT_TYPES,
 * C4_IS_A_RE).
 */
declare const ENTITY_TYPES: Map<string, string[]>;
/** Specification for a single pipe metadata key. */
interface PipeKeySpec {
    description: string;
    values?: string[];
}
/**
 * Pipe metadata keys for inline `| key value` on data lines.
 * Keyed by chart type → { context-name: keys }.
 *
 * Contexts are open-ended. The two universal ones are:
 *   - `node` — the default for any non-arrow line
 *   - `edge` — lines containing an arrow (`->`, `--`)
 *
 * Charts with richer line types declare additional contexts:
 *   - raci: `role`, `phase`, `assignment`
 *   - ring / pyramid: `layer`
 *   - tech-radar: `quadrant`, `blip`
 *   - journey-map: `step`
 *
 * IMPORTANT: NEVER add 'sequence' here. The `|` character in sequence
 * diagrams separates display names from identifiers and tag metadata.
 * Adding sequence would trigger false pipe-metadata completions on every `|`.
 */
type PipeContextMap = Record<string, Record<string, PipeKeySpec>>;
declare const PIPE_METADATA: Map<string, PipeContextMap>;
/** All known directive keys, derived from COMPLETION_REGISTRY. Includes implicit keys. */
declare const METADATA_KEY_SET: ReadonlySet<string>;
/**
 * Extract tag declarations from document text.
 * Returns a map of alias (or full name) → array of tag values.
 * Keys preserve original case for display; use case-insensitive lookup.
 */
declare function extractTagDeclarations(docText: string): Map<string, string[]>;

/**
 * Shared parser utilities — extracted from individual parsers to eliminate
 * duplication of measureIndent, extractColor, header regexes, and
 * pipe-metadata parsing.
 */

/** Complete set of recognized chart type identifiers. */
declare const ALL_CHART_TYPES: Set<string>;
/**
 * Parse the first non-empty, non-comment line to extract chart type and optional title.
 * The first token is matched against `ALL_CHART_TYPES`; the remainder is the title.
 *
 * Returns `null` if the first token is not a recognized chart type.
 */
declare function parseFirstLine(line: string): {
    chartType: string;
    title: string | undefined;
} | null;

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

export { ALL_CHART_TYPES, AMBIGUITY_THRESHOLD, ARROW_DIAGNOSTIC_CODES, type Activation, type AncestorInfo, type ArcLink, type ArcNodeGroup, type BLCollapseResult, type BLEdge, type BLGroup, type BLLayoutEdge, type BLLayoutGroup, type BLLayoutNode, type BLLayoutResult, type BLNode, type BlipTrend, type C4ArrowType, type C4DeploymentNode, type C4Element, type C4ElementType, type C4Group, type C4LayoutBoundary, type C4LayoutEdge, type C4LayoutNode, type C4LayoutResult, type C4LegendEntry, type C4LegendGroup, type C4Relationship, type C4Shape, type C4TagEntry, type C4TagGroup, CHART_TYPES, CHART_TYPE_DESCRIPTIONS, COMPLETION_REGISTRY, type ChartDataPoint, type ChartEra, type ChartType$1 as ChartType, type Confidence as ChartTypeConfidence, type ChartTypeMeta, type ChartTypeScore, type SuggestionResult as ChartTypeSuggestionResult, type ClassLayoutEdge, type ClassLayoutNode, type ClassLayoutResult, type ClassMember, type ClassModifier, type ClassNode, type ClassRelationship, type CollapsedMindmapResult, type CollapsedOrgResult, type CollapsedSitemapResult, type CollapsedView, type CompactViewState, type ComputedInfraEdge, type ComputedInfraModel, type ComputedInfraNode, type ContextRelationship, type CycleEdge, type CycleLayoutEdge, type CycleLayoutNode, type CycleLayoutResult, type CycleNode, type CycleRenderOptions, type D3ExportDimensions, type DecodedDiagramUrl, type DgmoError, type DgmoSeverity, type DiagramSymbols, type DirectiveSpec, type DirectiveValueSpec, type Duration, type DurationUnit, ENTITY_TYPES, type ERCardinality, type ERColumn, type ERConstraint, type ERLayoutEdge, type ERLayoutNode, type ERLayoutResult, type ERRelationship, type ERTable, type ElseIfBranch, type EncodeDiagramUrlOptions, type EncodeDiagramUrlResult, type ExpandedActivity, type ExtendedChartType, type ExtractFn, type FocusOrgResult, type GanttDependency, type GanttEra, type GanttGroup, type GroupRow as GanttGroupRow, type GanttHolidays, type GanttInteractiveOptions, type LaneHeaderRow as GanttLaneHeaderRow, type GanttMarker, type GanttNode, type GanttOptions, type GanttParallelBlock, type Row as GanttRow, type GanttTask, type TaskRow as GanttTaskRow, type GetOrCreateNameResult, type GraphDirection, type GraphEdge, type GraphGroup, type GraphNode, type GraphShape, INFRA_BEHAVIOR_KEYS, type ImportSource, type InfraAvailabilityPercentiles, type InfraBehaviorKey, type InfraCbState, type InfraComputeParams, type InfraDiagnostic, type InfraEdge, type InfraGroup, type InfraLatencyPercentiles, type InfraLayoutEdge, type InfraLayoutGroup, type InfraLayoutNode, type InfraLayoutResult, type InfraLegendGroup, type InfraNode, type InfraPlaybackState, type InfraProperty, type InfraRole, type InfraTagGroup, type InlineSpan, type JourneyMapAnnotation, type JourneyMapInteractiveOptions, type JourneyMapLayout, type JourneyMapPersona, type JourneyMapPhase, type JourneyMapStep, type KanbanCard, type KanbanColumn, type KanbanTagEntry, type KanbanTagGroup, LEGEND_GEAR_PILL_W, LEGEND_HEIGHT, type LayoutEdge, type LayoutGroup, type LayoutNode, type LayoutOptions, type LayoutResult$1 as LayoutResult, type LegendCallbacks, type LegendConfig, type LegendControl, type LegendGroupData, type LegendHandle, type LegendLayout, type LegendMode, type LegendPalette, type LegendPosition, type LegendState, METADATA_KEY_SET, MIN_PRIMARY_SCORE, type MemberVisibility, type MindmapLayoutEdge, type MindmapLayoutNode, type MindmapLayoutResult, type MindmapNode, type MonteCarloResult, type NameEntry, type NodeDetail, type OrgContainerBounds, type OrgLayoutEdge, type OrgLayoutNode, type OrgLayoutResult, type OrgNode, PERT_LEGEND_PILL_HEIGHT, PIPE_METADATA, type PaletteColors, type PaletteConfig, type ParseInArrowLabelResult, type ParsedBoxesAndLines, type ParsedC4, type ParsedChart, type ParsedClassDiagram, type ParsedCycle, type ParsedERDiagram, type ParsedExtendedChart, type ParsedGantt, type ParsedGraph, type ParsedInfra, type ParsedJourneyMap, type ParsedKanban, type ParsedMindmap, type ParsedOrg, type ParsedPert, type ParsedPyramid, type ParsedRaci, type ParsedRing, type ParsedSequenceDgmo, type ParsedSitemap, type ParsedTechRadar, type ParsedVisualization, type ParsedWireframe, type ParticipantType, type PertActivity, type Anchor as PertAnchor, type PertDirection, type PertEdge, type PertGroup, type PertLayoutEdge, type PertLayoutGroup, type PertLayoutNode, type LayoutOverrides as PertLayoutOverrides, type LayoutResult as PertLayoutResult, type PertMilestone, type PertOptions, type PertRenderOptions, type PipeKeySpec, type PyramidLayer, type QuadrantPosition, RACI_ERROR_CODES, VARIANTS as RACI_VARIANTS, RACI_WARNING_CODES, RECOGNIZED_COLOR_NAMES, RULE_COUNT, type RaciDragSource, type RaciInteractionHandlers, type RaciMarker, type RaciPhase, type RaciRoleAssignment, type RaciTask, type RaciVariant, type ReadFileFn, type RelationshipType, type RenderCategory, type RenderStep, type ResolveImportsResult, type ResolvedActivity, type ResolvedGroup$1 as ResolvedGroup, type ResolvedPert, type ResolvedGroup as ResolvedPertGroup, type ResolvedSchedule, type ResolvedTask, type RingLayer, type ScatterLabelPoint, type SectionMessageGroup, type SequenceBlock, type SequenceElement, type SequenceGroup, type SequenceMessage, type SequenceNote, type SequenceParticipant, type SequenceRenderOptions, type SequenceSection, type SimulateOptions, type SitemapContainerBounds, type SitemapDirection, type SitemapEdge, type SitemapLayoutEdge, type SitemapLayoutNode, type SitemapLayoutResult, type SitemapLegendEntry, type SitemapLegendGroup, type SitemapNode, type StateCollapseResult, type TagEntry, type TagGroup, type TechRadarBlip, type TechRadarLayoutPoint, type TechRadarQuadrant, type TechRadarRing, type Theme, type VisualizationType, type WireframeElement, type WireframeElementType, type WireframeFormFactor, type WireframeLayout, type WireframeLayoutNode, addDurationToDate, analyzePert, applyCollapseProjection, applyGroupOrdering, applyPositionOverrides, boldPalette, buildExtendedChartOption, buildNoteMessageMap, buildRenderSequence, buildSimpleChartOption, buildSimulationContext, buildTagLaneRowList, calculateSchedule, catppuccinPalette, confidence as chartTypeConfidence, chartTypeParsers, chartTypes, collapseBoxesAndLines, collapseMindmapTree, collapseOrgTree, collapseSitemapTree, collapseStateGroups, collectDiagramRoles, collectTasks, colorNames, computeActivations, computeCardArchive, computeCardMove, computeCycleLayout, computeInfra, computeInfraLegendGroups, computeLegendLayout, computeRadarLayout, computeScatterLabelGraphics, computeTimeTicks, contrastText, controlsGroupCapsuleWidth, decodeDiagramUrl, decodeViewState, displayName, draculaPalette, encodeDiagramUrl, encodeViewState, extractDiagramSymbols, extractPertSymbols, extractTagDeclarations, focusOrgTree, formatDateLabel, formatDgmoError, getAllChartTypes, getAvailablePalettes, getExtendedChartLegendGroups, getLegendReservedHeight, getOrCreateName, getPalette, getRadarGeometry, getRenderCategory, getSeriesColors, getSimpleChartLegendGroups, groupMessagesBySection, gruvboxPalette, hexToHSL, hexToHSLString, highlightPertCriticalPath, highlightPertSet, hslToHex, inferParticipantType, inferRoles, isArchiveColumn, isExtendedChartType, isRecognizedColorName, isSequenceBlock, isSequenceNote, isValidHex, knownChartTypeIds, layoutBoxesAndLines, layoutC4Components, layoutC4Containers, layoutC4Context, layoutC4Deployment, layoutClassDiagram, layoutERDiagram, layoutGraph, layoutInfra, layoutJourneyMap, layoutMindmap, layoutOrg, layoutPert, layoutSitemap, layoutWireframe, looksLikeClassDiagram, looksLikeERDiagram, looksLikeFlowchart, looksLikePert, looksLikeSequence, looksLikeSitemap, looksLikeState, makeDgmoError, matchesContiguously, measurePertAnalysisBlock, mix, monokaiPalette, mulberry32, nord, nordPalette, normalize as normalizeChartTypePrompt, normalizeName, normalizePertSourceForShare, oneDarkPalette, orderArcNodes, palettes, parseAndLayoutInfra, parseBoxesAndLines, parseC4, parseChart, parseClassDiagram, parseCycle, parseDataRowValues, parseDgmo, parseDgmoChartType, parseERDiagram, parseExtendedChart, parseFirstLine, parseFlowchart, parseGantt, parseInArrowLabel, parseInfra, parseInlineMarkdown, parseJourneyMap, parseKanban, parseMindmap, parseOrg, parsePert, parsePyramid, parseRaci, parseRing, parseSequenceDgmo, parseSequenceDgmo as parseSequenceDiagram, parseSitemap, parseState, parseTechRadar, parseTimelineDate, parseVisualization, parseWireframe, pertLegendBlockWidth, pertLegendEntries, cellAppendMarker as raciCellAppendMarker, cellCycle as raciCellCycle, cellRemove as raciCellRemove, cellReplace as raciCellReplace, registerExtractor, registerPalette, relayoutPert, render, renderArcDiagram, renderBoxesAndLines, renderBoxesAndLinesForExport, renderC4ComponentsForExport, renderC4Containers, renderC4ContainersForExport, renderC4Context, renderC4ContextForExport, renderC4Deployment, renderC4DeploymentForExport, renderClassDiagram, renderClassDiagramForExport, renderCycle, renderCycleForExport, renderERDiagram, renderERDiagramForExport, renderExtendedChartForExport, renderFlowchart, renderFlowchartForExport, renderForExport, renderGantt, renderInfra, renderJourneyMap, renderJourneyMapForExport, renderKanban, renderKanbanForExport, renderLegendD3, renderLegendSvg, renderLegendSvgFromConfig, renderMindmap, renderMindmapForExport, renderOrg, renderOrgForExport, renderPert, renderPertAnalysisBlock, renderPertForExport, renderLegendBlock as renderPertLegendBlock, renderPyramid, renderPyramidForExport, renderQuadrant, renderQuadrantFocus, renderQuadrantFocusForExport, renderRaci, renderRaciForExport, renderRing, renderRingForExport, renderSequenceDiagram, renderSitemap, renderSitemapForExport, renderSlopeChart, renderState, renderStateForExport, renderTechRadar, renderTechRadarForExport, renderTimeline, renderVenn, renderWireframe, renderWordCloud, resetPertCriticalPath, resetPertHighlight, resolveColor, resolveColorWithDiagnostic, resolveOrgImports, resolveTaskName, rollUpContextRelationships, rosePinePalette, sampleBetaPert, scoreChartType, seriesColors, shade, shapeFill, simulateCanonical, simulateFast, solarizedPalette, suggestChartTypes, themes, tint, tokyoNightPalette, truncateBareUrl, parseDgmo as validate, validateComputed, validateInfra, validateLabelCharacters };
