import { b as DiagnosticSpec, P as PaletteConfig, C as CompactViewState, D as DgmoError } from './tag-groups-fgxWTyyB.js';
export { c as DgmoSeverity, d as DiagnosticParams, E as EmitOptions, a as PaletteColors, e as emit, f as formatDgmoError } from './tag-groups-fgxWTyyB.js';
import { T as Theme } from './themes-CzuBdx1T.js';
export { M as MapCompletionOptions, a as MapLocationMatch, b as MapPlaceCompletion, c as MapRegionCompletion, d as completeMapPlaces, e as completeMapRegions, p as palettes, s as searchMapLocations, t as themes, f as validate } from './themes-CzuBdx1T.js';
import { M as MapDataSource } from './d3-B6524aaP.js';
export { G as Gazetteer, a as GazetteerEntry, b as MapData, R as RegionName, c as RegionNames } from './d3-B6524aaP.js';
export { C as ChartTypeId, a as ChartTypeMeta, c as chartTypes, g as getPalette, r as resolvePaletteOrFallback } from './chart-types-Db_EGf1o.js';

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
 * - The root background (the theme's opaque `palette.bg` — both the inline
 *   `background:` style and the full-canvas `<rect>` some renderers paint) is
 *   STRIPPED by default so the embed inherits the host page surface and blends
 *   into Obsidian / doc-site / arbitrary pages instead of showing a mismatched
 *   rectangle. Pass `{ background: 'opaque' }` to keep it — the embedder
 *   opt-out, and the automatic default for background-meaningful types like
 *   `map` (whose bg is the ocean) via `defaultEmbedBackground`. Standalone
 *   PNG/SVG export does NOT go through here and stays opaque.
 *
 * This is intentionally a string transform, not a DOM `getBBox()` step: dgmo
 * can dual-render light/dark SVGs where one is hidden by color-mode CSS, and
 * `getBBox()` returns 0 for the hidden copy. Parsing coordinates from the
 * markup measures both copies reliably and works server-side (Node).
 */
interface NormalizeSvgForEmbedOptions {
    /**
     * `transparent` (default) strips the theme's opaque root background so the
     * embed inherits the host page surface. `opaque` preserves it — the embedder
     * opt-out for diagrams that need their own solid backdrop. Callers that know
     * the chart type should resolve this via `defaultEmbedBackground`.
     */
    background?: 'transparent' | 'opaque';
}
declare function normalizeSvgForEmbed(input: string, opts?: NormalizeSvgForEmbedOptions): string;
/**
 * The embed background an embedder gets by default for a given chart type:
 * `transparent` (blend into the host) for everything except
 * background-meaningful types, which stay `opaque`.
 */
declare function defaultEmbedBackground(chartType?: string): 'transparent' | 'opaque';
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
 * The supported sanitizing boundary for renderer output that is about to land
 * in a live document.
 *
 * Renderer output is trusted only as far as the renderer that produced it, and
 * every host — the desktop app, the web editor, Obsidian, the script-tag
 * drop-ins, this library's own `mountD3DataChart` — puts that output into the
 * DOM. This module is what they call first. It lives here, beside `safe-href`,
 * rather than inside `src/auto/shared.ts` where it started: that module is the
 * browser-embed bundle's private toolbox, reachable only from the two IIFE
 * script-tag builds, so a host importing `@diagrammo/dgmo` could not call the
 * sanitizer at all however much it wanted to.
 *
 * 🔴 **Parse into a DETACHED holder, take the `<svg>`, sanitize, insert.** All
 * four steps, in that order:
 *
 * ```ts
 * const holder = document.createElement('div');
 * holder.innerHTML = svg;          // inert: nothing here is connected yet
 * const svgEl = holder.querySelector('svg');
 * if (svgEl) {
 *   sanitizeSvgInPlace(svgEl);
 *   container.replaceChildren(svgEl);
 * }
 * ```
 *
 * Sanitizing *after* assigning into a live container is too late: connecting
 * the subtree is what creates a nested browsing context for an `<iframe>` and
 * runs a custom element's `connectedCallback`, both synchronously inside the
 * assignment. And taking only the `<svg>` is half the safety — moving every
 * child of the holder across would connect whatever a hostile document put
 * *beside* the diagram. `auto/index.ts` and `element/index.ts` have always done
 * both; `mount.ts` learned them on diagrammo/diagrammo#884.
 *
 * 🔴 **What this does NOT do**, so a caller is not misled about the contract:
 *
 * - It does not parse CSS. An `@import` or a `url()` inside a `<style>`
 *   element passes through untouched.
 * - It removes the elements listed in `REMOVED_TAGS` and nothing else. That
 *   set is the script-execution and remote-content surface as of
 *   diagrammo/diagrammo#884; an element neither it nor the attribute scrub
 *   below names survives, so a caller sanitizing *arbitrary* HTML rather than
 *   dgmo renderer output needs its own allowlist on top.
 * - It does not stop a resource load that an attribute alone starts —
 *   `<img src>` fetches whether or not the node is connected. What protects
 *   that case is the `on*` strip, not the detached holder.
 * - It is no substitute for escaping where a renderer interpolates author
 *   text (see `src/embed/escape.ts`).
 *
 * Browser-only — it needs a live DOM. There is nothing to sanitize on the
 * rasterising path, which never builds a document.
 */
/**
 * Strip script-execution surface from a freshly parsed SVG tree before it
 * lands in the live DOM. This is the safety net that lets us build SVG from
 * markup without trusting renderer output to be fully sanitized.
 *
 * Removes every element in `REMOVED_TAGS`, any SMIL element animating an
 * `href`, any `on*` event-handler attribute, and any `href`/`xlink:href`
 * failing the `safeHref` allowlist.
 *
 * Mutates `root` and returns nothing. Call it on a detached holder — see the
 * module comment above for why the order matters, and for what this does not
 * cover.
 */
declare function sanitizeSvgInPlace(root: Element): void;

/**
 * The full diagnostic catalog, sorted by code. Every coded diagnostic
 * dgmo can emit — its severity, owning chart type, canonical message,
 * fix hint, and a triggering example. This is the enumerable source of
 * truth for the CLI `diagnostics` subcommand, the console error-review
 * surface, MCP, and the language-spec catalog.
 */
declare function listDiagnosticCodes(): DiagnosticSpec[];
declare function getDiagnosticSpec(code: string): DiagnosticSpec | undefined;

interface RenderOptions {
    theme?: Theme;
    /**
     * A `PaletteConfig` (e.g. `palettes.catppuccin`) or a palette id string
     * (e.g. `'catppuccin'`). Unknown ids fall back to the default palette.
     */
    palette?: PaletteConfig | string;
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
    /**
     * Canvas to draw onto, in px. Defaults to the 1200x800 export sheet.
     *
     * Omit these and nothing changes. Pass them when the result is going into a
     * box whose shape you already know — fitting the default sheet to a narrow
     * column inherits its aspect, so a one-line meter arrives as tall as a poster.
     */
    width?: number;
    height?: number;
    /**
     * Basemap assets for `map` charts — the data itself, or a loader returning
     * it. `render()` reads nothing from the filesystem or the network on its own,
     * so this is the only way a map obtains a basemap, and its presence here is
     * what tells a caller whether a render can touch the environment.
     *
     * - Node / CLI / SSR: pass the `loadMapData` loader from
     *   `@diagrammo/dgmo/advanced`. It runs only when the content really is a
     *   map, so a non-map render never pays to read the assets.
     * - Browser / Worker / Obsidian: pass your bundled `MapData`.
     *
     * Omit it and a map renders empty with an `E_MAP_DATA_NOT_SUPPLIED`
     * diagnostic. Every other chart type ignores this option.
     */
    mapData?: MapDataSource;
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

export { CompactViewState, D3_DATA_CHART_TYPES, type DataChartInteractionOpts, type DecodedDiagramUrl, DgmoError, DiagnosticSpec, type EncodeDiagramUrlOptions, MapDataSource, type MountD3Opts, type MountedD3Chart, type NormalizeSvgForEmbedOptions, PaletteConfig, type RenderOptions, type RenderResult, Theme, attachDataChartInteractions, decodeDiagramUrl, defaultEmbedBackground, encodeDiagramUrl, getDiagnosticSpec, getEmbedSvgViewBox, listDiagnosticCodes, mountD3DataChart, normalizeSvgForEmbed, render, sanitizeSvgInPlace, supportsD3DataChart };
