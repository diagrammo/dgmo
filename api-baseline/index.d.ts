import { P as PaletteConfig, C as CompactViewState } from './chart-types-Dxtv4XSz.js';
export { a as ChartTypeId, b as ChartTypeMeta, c as PaletteColors, d as chartTypes, g as getPalette, r as resolvePaletteOrFallback } from './chart-types-Dxtv4XSz.js';
import { T as Theme } from './themes-Dyke6aVB.js';
export { E as EncodeInkOptions, I as INK_DEFAULT_TOLERANCE, a as INK_PRESSURE_LEVELS, b as InkDecodeResult, c as InkPoint, M as MapCompletionOptions, d as MapLocationMatch, e as MapPlaceCompletion, f as MapRegionCompletion, g as completeMapPlaces, h as completeMapRegions, i as decodeInk, j as encodeInk, p as palettes, s as searchMapLocations, t as themes, k as validate } from './themes-Dyke6aVB.js';
import { M as MapDataSource } from './export-context-DCBbrXaA.js';
export { G as Gazetteer, a as GazetteerEntry, b as MapData, R as RegionName, c as RegionNames } from './export-context-DCBbrXaA.js';
import { a as DiagnosticSpec, D as DgmoError } from './tag-groups-BUohVKID.js';
export { b as DgmoFix, c as DgmoSeverity, d as DiagnosticParams, E as EmitOptions, e as emit, f as formatDgmoError } from './tag-groups-BUohVKID.js';
export { a as GLYPH_STROKE, b as GLYPH_VIEWBOX, c as GlyphName, g as glyphPaths } from './registry-B4obA3gD.js';
export { f as foldAtLine } from './fold-at-line-DmSAa1eU.js';

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

/** Air left around the measured content, in px — a little more than the embed's 16. */
declare const EXPORT_FIT_PAD = 24;
interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
interface ContentMeasurement {
    /** Union of everything drawn, in root user space; null when nothing was. */
    box: Box | null;
    /** False when some drawn element could not be placed — do not trim. */
    complete: boolean;
}
/**
 * Measure what an SVG draws, in root user space, composing every transform.
 * `complete` is false when something drawn could not be placed.
 */
declare function measureSvgContent(svg: string): ContentMeasurement;
interface FitSvgToContentOptions {
    /** The width the caller asked the renderer for, if any. */
    width?: number;
    /** The height the caller asked the renderer for, if any. */
    height?: number;
}
/**
 * Shrink an exported SVG's frame to what it draws plus EXPORT_FIT_PAD, under
 * the trust rule at the top of this file. Returns the input unchanged when
 * the measurement is incomplete or the trim would be too small to matter.
 *
 * A caller that asked for a size gets it: when the renderer drew onto the
 * requested canvas, the fitted frame is scaled back up to that width (and/or
 * height, whichever binds first) — fit first, then the requested scale.
 */
declare function fitSvgToContent(svg: string, opts?: FitSvgToContentOptions): string;

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
 * Add or remove the `collapsed: true` view-state marker on an element's source
 * line (mindmap node label, or a `[group]` header via the group-header variant),
 * preserving any other same-line metadata. This is what makes a host's (the app's, Obsidian's)
 * automatic write-through (collapse in the preview → mutate the source) land as
 * clean, hand-editable dgmo rather than a naive append.
 *
 * `collapsed` is a reserved key, so dgmo's parser cuts the label at the first
 * `collapsed:` regardless of comma placement — but a SECOND metadata key must be
 * comma-separated from the first, so we comma-join when the line already carries
 * metadata and space-append when it doesn't.
 *
 * Hand-written dgmo usually carries the bare trailing flag instead (`Gold
 * collapsed`, `Wine w: Prized, collapsed`), which dgmo's
 * `peelTrailingCollapsedFlag` reads as the same thing. Treating it as metadata
 * wrote `Gold collapsed, collapsed: true`, which parses to the label
 * `Gold collapsed,` (#1571).
 */
/** Toggle the `collapsed: true` marker on a single line, given the node's label. */
declare function applyCollapsedMarker(line: string, label: string, collapse: boolean): string;
/** Apply {@link applyCollapsedMarker} to the given 1-based line of a document. */
declare function applyCollapsedMarkerAtLine(text: string, lineNumber: number, label: string, collapse: boolean): string;
/**
 * Toggle `collapsed: true` on a bracketed group-header line (`[Name]` →
 * `[Name] collapsed: true`), used by sequence/gantt/etc. where the collapse
 * marker rides on the group header rather than a node label. The `]` is the
 * label/metadata boundary, so no separate label argument is needed.
 */
declare function applyGroupHeaderCollapsedMarkerAtLine(text: string, lineNumber: number, collapse: boolean): string;
/**
 * Toggle `collapsed: true` as an INDENTED property line under a `[group]`
 * header (infra's form — the header itself doesn't take same-line metadata).
 * Collapse inserts `  collapsed: true` as the group's first child; expand
 * removes the immediate-child `collapsed:` line (never a deeper one). Child indent is inferred from
 * the group's existing first child (falls back to header indent + 2).
 */
declare function applyIndentedGroupCollapsedMarkerAtLine(text: string, headerLineNumber: number, collapse: boolean): string;
/**
 * Toggle the collapse marker on a multi-line note's opening line (`note right
 * of A` → `note right of A collapsed: true`), used by sequence notes (#1741).
 * The line minus any marker is the label, so the bare flag a hand-written note
 * carries (`note right of A collapsed`) is recognised and removed cleanly.
 * Leaves a line that is not a `note` head untouched.
 */
declare function applyNoteCollapsedMarkerAtLine(text: string, lineNumber: number, collapse: boolean): string;

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
     * A palette that beats the diagram's own `palette` line — for a deliberate
     * per-embed choice such as a fence attribute or a CLI flag. Same forms as
     * `palette`. Who wins, highest first: `paletteOverride`, the file's own
     * `palette` line, `palette`, Slate.
     */
    paletteOverride?: PaletteConfig | string;
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
    /**
     * Whiteboard images: turn an image ref (a relative path such as
     * `board.assets/9f3c.webp`, or an `https://` URL) into an href — a data URI
     * or a URL. Supplied → its answer is final, and `undefined` draws a plain
     * box labelled "image not uploaded". Omitted → `https://` refs pass through
     * and everything else is that box. Every other chart type ignores it.
     */
    resolveImage?: (ref: string) => string | undefined;
    /**
     * Whiteboard sticky notes: `true` draws them and `false` hides them,
     * whatever the board's `no-notes` says. Omitted, the directive decides.
     * Every other chart type ignores it.
     */
    showNotes?: boolean;
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

export { CompactViewState, D3_DATA_CHART_TYPES, DgmoError, DiagnosticSpec, EXPORT_FIT_PAD, MapDataSource, PaletteConfig, Theme, applyCollapsedMarker, applyCollapsedMarkerAtLine, applyGroupHeaderCollapsedMarkerAtLine, applyIndentedGroupCollapsedMarkerAtLine, applyNoteCollapsedMarkerAtLine, attachDataChartInteractions, decodeDiagramUrl, defaultEmbedBackground, encodeDiagramUrl, fitSvgToContent, getDiagnosticSpec, getEmbedSvgViewBox, listDiagnosticCodes, measureSvgContent, mountD3DataChart, normalizeSvgForEmbed, render, sanitizeSvgInPlace, supportsD3DataChart };
export type { ContentMeasurement, DataChartInteractionOpts, DecodedDiagramUrl, EncodeDiagramUrlOptions, FitSvgToContentOptions, MountD3Opts, MountedD3Chart, NormalizeSvgForEmbedOptions, RenderOptions, RenderResult };
