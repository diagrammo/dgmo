import { M as MapDataSource } from './d3-CQT5bwpb.js';
import './tag-groups-BoJg3lFV.js';

/**
 * Canonical stylesheet for the standard DGMO embed block (BL-114).
 *
 * Shipped two ways: `dist/block.css` (extracted at build time by
 * tsup.config.ts, same regex mechanism as auto.css) for `<link>`/import
 * consumers, and the `BLOCK_CSS` string export for embedders that inject a
 * `<style>` tag.
 *
 * Dark mode keys off BOTH `[data-theme="dark"]` (Starlight, Docusaurus) and
 * `html.dark` (Tailwind, next-themes, VitePress), because those two cover
 * essentially every host and picking one silently left the other half of the
 * ecosystem with a diagram that never toggled. A host on a third signal
 * (`body.theme-dark`) still rewrites the selector at its build step —
 * fumadocs-dgmo/nextra-dgmo's build-css.mjs is the reference adapter.
 *
 * 🔴 Keep the two conventions in SEPARATE rule blocks. `auto/styles.ts`
 * re-scopes the `[data-theme="dark"]` rules onto `.dgmo-theme-dark` with a
 * regex that swallows everything up to the `{`, so folding them into one
 * multi-selector rule would drag `html.dark` into the re-scoped copy too.
 *
 * The `.dgmo-tok-*` role colors mirror LIGHT_ROLE_STYLES (light) and
 * NORD_ROLE_STYLES (dark) from editor/highlight-api.ts. A parity test
 * (tests/block.test.ts) guards against drift — update both when either
 * changes.
 *
 * IMPORTANT: keep this a single pure template literal — the build extracts it
 * with a regex, so no interpolation or computed values.
 */
declare const BLOCK_CSS: string;

/**
 * Standard DGMO embed block (BL-114) — the ONE canonical
 * "diagram + source chrome" HTML builder shared by every embed surface:
 * remark-dgmo (and through it the astro/docusaurus/fumadocs/nextra/vitepress
 * wrappers), the `/auto` script-tag drop-in, `<dgmo-diagram>`, dgmo-mcp HTML
 * reports, the marketing site, and the Obsidian plugin.
 *
 * Chrome contract (user-approved 2026-07-05): the diagram is the star. A slim
 * icon toolbar sits in a reserved row below the SVG, invisible until the
 * block is hovered/focused or the source is open. Four wordless icon
 * buttons — `</>` toggles the hidden source panel, expand (full-screen),
 * copy, open-in-editor. No disclosure triangle, no text labels. The toolbar
 * IS the <summary> of a native <details>, so show/hide works with zero
 * JavaScript; copy and expand need a small delegated click handler
 * (remark-dgmo's `bindDgmo` is the reference — expand's lightbox helper is
 * mirrored across every client surface, same as copy).
 *
 * Markup vocabulary: `figure.dgmo` (`--diagram`/`--showcase`/`--error`),
 * `.dgmo-light`/`.dgmo-dark` (dual color-mode) or `.dgmo-svg` (single),
 * `details.dgmo-source-wrap > summary.dgmo-toolbar`, `.dgmo-source-inner`,
 * `pre.dgmo-pre > span.dgmo-code` with `.dgmo-tok-<role>` token spans. While
 * the source is open the wrapper gets one shared frame (`:has()` rule) so
 * diagram + code read as a single unit. No visible caption — `title` becomes
 * the wrapper's aria-label. Styles ship as `BLOCK_CSS` / `dist/block.css`.
 */

/** Default hosted editor used by "Open in editor" links. */
declare const EDITOR_BASE_URL = "https://online.diagrammo.app";
type BlockMode = 'diagram' | 'showcase';
/**
 * Color-mode strategy for the emitted SVG(s).
 * - `auto` — render twice (light + dark) and let CSS flip visibility.
 * - `light` / `dark` / `transparent` — single render with that theme.
 */
type BlockColorMode = 'auto' | 'light' | 'dark' | 'transparent';
interface DgmoBlockOptions {
    /** `diagram` (default): SVG only. `showcase`: SVG + source chrome. */
    mode?: BlockMode;
    /** Palette name. Default `slate`; unknown names warn + fall back. */
    palette?: string;
    /** Default `auto` (dual light/dark render). */
    colorMode?: BlockColorMode;
    /**
     * Embed background. `auto` (default) strips the theme's opaque root
     * background so the diagram blends into the host page — except for
     * background-meaningful types like `map`, which stay opaque. `transparent` /
     * `opaque` force the choice regardless of type (the embedder opt-out).
     */
    background?: 'auto' | 'transparent' | 'opaque';
    /** Default: true in showcase mode, false in diagram mode. */
    showSource?: boolean;
    /** Default: true in showcase mode, false in diagram mode. */
    showCopy?: boolean;
    /**
     * Show the expand (full-screen) toolbar button. Default: true in showcase
     * mode, false in diagram mode. Needs the client lightbox handler to do
     * anything (mirrored across surfaces); markup-only surfaces can omit it.
     */
    showExpand?: boolean;
    /** Default: true in showcase mode, false in diagram mode. */
    showOpenInEditor?: boolean;
    /** Base URL for the open-in-editor link. Default: online.diagrammo.app. */
    editorBaseUrl?: string;
    /** Outer wrapper element. Default `figure`. */
    wrapper?: 'figure' | 'div';
    /** Base class for the wrapper (styling hook). Default `dgmo`. */
    className?: string;
    /** Extra classes appended to every emitted wrapper (compat shims). */
    legacyClassNames?: string[];
    /**
     * Accessible name for the block (`aria-label` on the wrapper). NOT rendered
     * visually — the chart's visible title belongs in the DGMO source itself.
     */
    title?: string;
    /**
     * Extra `data-*` attributes for the outer wrapper, as bare names → values
     * (`{ 'dgmo-ref': 'dgm_01H…' }` emits `data-dgmo-ref="dgm_01H…"`).
     *
     * Exists so a surface can mark a block for its own client code without
     * string-patching the emitted HTML — remark-dgmo's cloud references stamp the
     * diagram id and the revision they were baked from here, and its client script
     * reads them back to decide whether a refresh is even worth a fetch. Values are
     * attribute-escaped; a key that isn't a plain identifier is dropped rather than
     * trusted, since these end up in markup verbatim.
     */
    dataAttributes?: Record<string, string>;
    /**
     * Map basemap assets, forwarded to `render()`. Without them a ` ```dgmo `
     * fence containing a map emits the error card ("This map has no basemap
     * data") — this module reads nothing from disk or the network on its own,
     * and it has no environment default, because it runs in browsers as much as
     * in build scripts.
     *
     * A Node host (a remark build, a static-site generator, a report writer)
     * passes `loadMapData` from `@diagrammo/dgmo/advanced` — as the FUNCTION, so
     * the eleven basemap JSON files are read only for a fence that turns out to
     * be a map. A browser host supplies the data itself, or a loader that
     * fetches it.
     */
    mapData?: MapDataSource;
    /** Receives palette-fallback warnings. Default: console.warn. */
    onWarn?: (message: string) => void;
}
interface DgmoBlockResult {
    html: string;
    diagnostics: Array<{
        message: string;
        line?: number;
        severity?: string;
    }>;
}
/**
 * Render one ```dgmo source block to the standard embed HTML. Async because
 * it runs the full dgmo render pipeline (once per color mode).
 *
 * Render errors are NOT caught here — callers decide between throwing,
 * `errorBlockHtml()`, or their own fallback.
 */
declare function renderDgmoBlock(source: string, options?: DgmoBlockOptions): Promise<DgmoBlockResult>;
/**
 * Assemble the standard block around already-rendered SVG markup. Exposed for
 * surfaces that render through their own pipeline (e.g. dgmo-mcp's
 * renderPipeline) but must emit the canonical chrome. `svgsHtml` must be the
 * `.dgmo-light`+`.dgmo-dark` (or `.dgmo-svg`) wrapper divs.
 */
declare function buildDgmoBlockHtml(source: string, svgsHtml: string, options?: DgmoBlockOptions): string;
/**
 * Standard error card for a block that failed to parse/render. Same shape on
 * every surface: `.dgmo--error` with `role="alert"`, message + offending
 * source.
 */
declare function errorBlockHtml(err: unknown, source: string, options?: Pick<DgmoBlockOptions, 'className' | 'legacyClassNames'>): string;

export { BLOCK_CSS, type BlockColorMode, type BlockMode, type DgmoBlockOptions, type DgmoBlockResult, EDITOR_BASE_URL, MapDataSource, buildDgmoBlockHtml, errorBlockHtml, renderDgmoBlock };
