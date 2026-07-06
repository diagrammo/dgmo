import { ab as DiagnosticSpec, a as PaletteConfig, J as Theme, C as CompactViewState, D as DgmoError } from './themes-1-CuKpeH.js';
export { f as ChartTypeMeta, h as DgmoSeverity, ac as DiagnosticParams, ad as EmitOptions, j as Gazetteer, k as GazetteerEntry, l as MapCompletionOptions, M as MapData, o as MapLocationMatch, p as MapPlaceCompletion, s as MapRegionCompletion, P as PaletteColors, w as RegionName, x as RegionNames, N as chartTypes, O as completeMapPlaces, Q as completeMapRegions, ae as emit, X as formatDgmoError, _ as getPalette, a4 as palettes, af as resolvePaletteOrFallback, a8 as searchMapLocations, aa as themes, a5 as validate } from './themes-1-CuKpeH.js';

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
 * - The root inline `background:` (the theme's opaque `palette.bg`) is
 *   PRESERVED: every chart type now carries its own opaque background so
 *   diagrams render consistently across hosts and color modes rather than
 *   inheriting an arbitrary host page background.
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

interface MountD3Opts {
    theme?: 'light' | 'dark' | 'transparent';
    palette?: string;
    /** Forwarded to the interaction adapter: source-line navigation on click. */
    onNavigate?: (line: number) => void;
    mutedColor?: string;
    surface?: string;
    text?: string;
}
interface MountedD3Chart {
    /** Re-render with new content and/or theme/palette; re-attaches interactions. */
    update: (content: string, opts?: Partial<MountD3Opts>) => Promise<void>;
    /** Emphasize the chart element on the given source line (editor cursor sync);
     *  pass null to clear. */
    highlight: (line: number | null) => void;
    /** Tear down listeners + overlays and clear the container. */
    destroy: () => void;
}
declare function mountD3DataChart(container: HTMLElement, content: string, opts?: MountD3Opts): MountedD3Chart;

interface DataChartInteractionOpts {
    onNavigate?: (line: number) => void;
    mutedColor?: string;
    surface?: string;
    text?: string;
}
interface DataChartController {
    /** Remove all listeners + overlays. */
    destroy: () => void;
    /** Emphasize the chart element(s) on the given source line (editor cursor
     *  sync); pass null to clear. No-op while the pointer is actively hovering. */
    highlight: (line: number | null) => void;
}
declare function attachDataChartInteractions(svg: SVGSVGElement, opts?: DataChartInteractionOpts): DataChartController;

/** All data-chart types the hand-built renderers currently cover. */
declare const D3_DATA_CHART_TYPES: Set<string>;
declare function supportsD3DataChart(type: string): boolean;

/**
 * The full diagnostic catalog, sorted by code. Every coded diagnostic
 * dgmo can emit — its severity, owning chart type, canonical message,
 * fix hint, and a triggering example. This is the enumerable source of
 * truth for the CLI `diagnostics` subcommand, the console error-review
 * surface, MCP, and the language-spec catalog.
 */
declare function listDiagnosticCodes(): DiagnosticSpec[];
/** Look up a single spec by its code, or `undefined` if not cataloged. */
declare function getDiagnosticSpec(code: string): DiagnosticSpec | undefined;

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

export { CompactViewState, D3_DATA_CHART_TYPES, type DataChartInteractionOpts, type DecodedDiagramUrl, DgmoError, DiagnosticSpec, type EncodeDiagramUrlOptions, type MountD3Opts, type MountedD3Chart, PaletteConfig, type RenderOptions, type RenderResult, Theme, attachDataChartInteractions, decodeDiagramUrl, encodeDiagramUrl, getDiagnosticSpec, getEmbedSvgViewBox, getMinDimensions, listDiagnosticCodes, mountD3DataChart, normalizeSvgForEmbed, render, supportsD3DataChart };
