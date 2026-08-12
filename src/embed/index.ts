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

import { render } from '../render';
import type { MapDataSource } from '../d3';
import { encodeDiagramUrl } from '../sharing';
import { resolvePaletteOrFallback } from '../palettes';
import { highlightDgmo } from '../editor/highlight-api';
import {
  normalizeSvgForEmbed,
  defaultEmbedBackground,
} from '../utils/svg-embed';
import { renderErrorCard, docsLink } from '../error-card';
import { escapeHtml, escapeAttr } from './escape';

export { BLOCK_CSS } from './css';

/**
 * The shape `mapData` accepts. A TYPE export, deliberately — `loadMapData`
 * itself is NOT re-exported here and must not be. This entry is loaded in
 * browsers (the `<dgmo-diagram>` element, and remark-dgmo's opt-in client
 * re-render, which reaches it by dynamic import), and the loader's module
 * carries `import('fs/promises')`; pulling it in would put an unresolvable
 * Node builtin into every browser bundle of this entry to save a Node host one
 * import. Node hosts take `loadMapData` from `@diagrammo/dgmo/advanced`.
 */
export type { MapDataSource } from '../d3';

/** Default hosted editor used by "Open in editor" links. */
export const EDITOR_BASE_URL = 'https://online.diagrammo.app';

export type BlockMode = 'diagram' | 'showcase';

/**
 * Color-mode strategy for the emitted SVG(s).
 * - `auto` — render twice (light + dark) and let CSS flip visibility.
 * - `light` / `dark` / `transparent` — single render with that theme.
 */
export type BlockColorMode = 'auto' | 'light' | 'dark' | 'transparent';

export interface DgmoBlockOptions {
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

type ResolvedBlockOptions = Required<
  Omit<DgmoBlockOptions, 'title' | 'onWarn' | 'mapData'>
> & {
  title: string | undefined;
  mapData: MapDataSource | undefined;
  onWarn: (message: string) => void;
};

export interface DgmoBlockResult {
  html: string;
  diagnostics: Array<{ message: string; line?: number; severity?: string }>;
}

function resolveBlockOptions(opts: DgmoBlockOptions): ResolvedBlockOptions {
  const mode: BlockMode = opts.mode ?? 'diagram';
  const showcase = mode === 'showcase';
  return {
    mode,
    palette: opts.palette ?? 'slate',
    colorMode: opts.colorMode ?? 'auto',
    background: opts.background ?? 'auto',
    showSource: opts.showSource ?? showcase,
    showCopy: opts.showCopy ?? showcase,
    showExpand: opts.showExpand ?? showcase,
    showOpenInEditor: opts.showOpenInEditor ?? showcase,
    editorBaseUrl: opts.editorBaseUrl ?? EDITOR_BASE_URL,
    wrapper: opts.wrapper ?? 'figure',
    className: opts.className ?? 'dgmo',
    legacyClassNames: opts.legacyClassNames ?? [],
    dataAttributes: opts.dataAttributes ?? {},
    title: opts.title,
    mapData: opts.mapData,

    onWarn: opts.onWarn ?? ((message) => console.warn(message)),
  };
}

/**
 * Render one ```dgmo source block to the standard embed HTML. Async because
 * it runs the full dgmo render pipeline (once per color mode).
 *
 * Render errors are NOT caught here — callers decide between throwing,
 * `errorBlockHtml()`, or their own fallback.
 */
export async function renderDgmoBlock(
  source: string,
  options: DgmoBlockOptions = {}
): Promise<DgmoBlockResult> {
  const opts = resolveBlockOptions(options);
  const trimmed = source.trim();
  // Resolve-with-fallback so unknown names warn here. The full config (not just
  // the id) is needed for the error card below, which indexes palette.light/.dark.
  const palette = resolvePaletteOrFallback(opts.palette, opts.onWarn);
  const diagnostics: DgmoBlockResult['diagnostics'] = [];

  // Render one theme. `render` here is the low-level renderer, which returns an
  // empty/partial SVG (not the friendly error card) when the source has
  // error-severity diagnostics. So substitute the shared error card — the same
  // fall-through image every host shows — whenever the parse errored. Without
  // this the block emits an empty `.dgmo-light`/`.dgmo-dark` div: a blank box.
  // The detected chart type (same across color modes) selects the default embed
  // background — `map` and other background-meaningful types stay opaque.
  let chartType: string | undefined;
  const renderTheme = async (
    theme: 'light' | 'dark' | 'transparent'
  ): Promise<string> => {
    // `mapData` is spread in only when the host supplied one: under
    // `exactOptionalPropertyTypes` an explicit `undefined` is not the same as
    // an absent key, and `render()`'s option is optional rather than nullable.
    const r = await render(trimmed, {
      palette: palette.id,
      theme,
      ...(opts.mapData !== undefined ? { mapData: opts.mapData } : {}),
    });
    chartType = r.chartType;
    diagnostics.push(...r.diagnostics);
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    return errors.length
      ? renderErrorCard(errors, trimmed, palette, theme)
      : r.svg;
  };

  let svgsHtml: string;
  if (opts.colorMode === 'auto') {
    const [light, dark] = await Promise.all([
      renderTheme('light'),
      renderTheme('dark'),
    ]);
    const background =
      opts.background === 'auto'
        ? defaultEmbedBackground(chartType)
        : opts.background;
    svgsHtml =
      `<div class="${escapeAttr(innerClasses(opts, 'dgmo-light'))}" data-dgmo-bg="${escapeAttr(palette.light.bg)}">${normalizeSvgForEmbed(light, { background })}</div>` +
      `<div class="${escapeAttr(innerClasses(opts, 'dgmo-dark'))}" data-dgmo-bg="${escapeAttr(palette.dark.bg)}">${normalizeSvgForEmbed(dark, { background })}</div>`;
  } else {
    const svg = await renderTheme(opts.colorMode);
    const background =
      opts.background === 'auto'
        ? defaultEmbedBackground(chartType)
        : opts.background;
    // Stash the real palette background so the expand lightbox can paint an
    // opaque surface even when this embed renders transparent (§transparent
    // embeds strip the chart bg from the SVG itself). `transparent` colorMode
    // falls back to the light background.
    const paletteBg = palette[opts.colorMode === 'dark' ? 'dark' : 'light'].bg;
    svgsHtml = `<div class="${escapeAttr(innerClasses(opts, 'dgmo-svg'))}" data-dgmo-bg="${escapeAttr(paletteBg)}">${normalizeSvgForEmbed(svg, { background })}</div>`;
  }

  return { html: assembleBlock(trimmed, svgsHtml, opts), diagnostics };
}

/**
 * Assemble the standard block around already-rendered SVG markup. Exposed for
 * surfaces that render through their own pipeline (e.g. dgmo-mcp's
 * renderPipeline) but must emit the canonical chrome. `svgsHtml` must be the
 * `.dgmo-light`+`.dgmo-dark` (or `.dgmo-svg`) wrapper divs.
 */
export function buildDgmoBlockHtml(
  source: string,
  svgsHtml: string,
  options: DgmoBlockOptions = {}
): string {
  return assembleBlock(source.trim(), svgsHtml, resolveBlockOptions(options));
}

/**
 * Standard error card for a block that failed to parse/render. Same shape on
 * every surface: `.dgmo--error` with `role="alert"`, message + offending
 * source.
 */
export function errorBlockHtml(
  err: unknown,
  source: string,
  options: Pick<DgmoBlockOptions, 'className' | 'legacyClassNames'> = {}
): string {
  const msg =
    err instanceof Error ? err.message : 'Failed to render dgmo block.';
  const base = options.className ?? 'dgmo';
  const legacy = (options.legacyClassNames ?? []).join(' ');
  const cls = legacy
    ? `${base} ${legacy} ${base}--error`
    : `${base} ${base}--error`;
  // Always-present documentation link (chart-type-specific when detectable).
  const docs = docsLink(source);
  return (
    `<div class="${escapeAttr(cls)}" role="alert">` +
    `<strong>dgmo render error:</strong> ${escapeHtml(msg)}` +
    `<pre>${escapeHtml(source)}</pre>` +
    `<a class="${escapeAttr(base)}-error-docs" href="${escapeAttr(docs.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(docs.label)}</a>` +
    `</div>`
  );
}

// ============================================================
// Internals
// ============================================================

function wrapperClasses(
  opts: ResolvedBlockOptions,
  variant: 'diagram' | 'showcase'
): string {
  const base = `${opts.className} ${opts.className}--${variant}`;
  const legacy = opts.legacyClassNames.join(' ');
  return legacy ? `${base} ${legacy}` : base;
}

function innerClasses(opts: ResolvedBlockOptions, primary: string): string {
  const legacy = opts.legacyClassNames.join(' ');
  return legacy ? `${primary} ${legacy}` : primary;
}

function assembleBlock(
  source: string,
  svgsHtml: string,
  opts: ResolvedBlockOptions
): string {
  const Wrapper = opts.wrapper;
  const showcase = opts.mode === 'showcase';
  const variant = showcase ? 'showcase' : 'diagram';

  const ariaAttr = opts.title ? ` aria-label="${escapeAttr(opts.title)}"` : '';
  const dataAttrs = dataAttributeString(opts.dataAttributes);

  // The toolbar is emitted whenever ANY of its buttons is enabled — each
  // show* flag is independent, so authors can keep e.g. copy without the
  // source-view toggle. In `diagram` mode every flag defaults off, so this
  // stays empty unless a flag is explicitly turned on.
  const sourceHtml = sourceDisclosure(source, opts);

  return (
    `<${Wrapper} class="${escapeAttr(wrapperClasses(opts, variant))}"${ariaAttr}${dataAttrs}>` +
    svgsHtml +
    sourceHtml +
    `</${Wrapper}>`
  );
}

/**
 * Render `dataAttributes` as ` data-<name>="<value>"` pairs.
 *
 * Keys are restricted to `[a-z0-9-]` and must start with a letter: the value is
 * escaped, but the NAME is written into markup verbatim, so a key carrying a
 * quote or a space could close the attribute and open another. Dropped rather
 * than escaped — a caller passing a name that isn't an attribute name has a bug
 * we should not paper over.
 */
function dataAttributeString(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .filter(([name]) => /^[a-z][a-z0-9-]*$/.test(name))
    .map(([name, value]) => ` data-${name}="${escapeAttr(value)}"`)
    .join('');
}

// ----- icon SVGs (static author-controlled markup) -----
const CODE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 4.5 4 3.5-4 3.5"/><path d="m6 4.5-4 3.5 4 3.5"/></svg>`;
const COPY_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h2.5"/></svg>`;
const EXTERNAL_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5 7 9"/><path d="M12.5 9.5v3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3"/></svg>`;
// Maximize / "arrows out to corners" — the full-screen expand affordance.
const EXPAND_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4"/><path d="M6.5 13.5h-4v-4"/><path d="M13.5 2.5 9 7"/><path d="M2.5 13.5 7 9"/></svg>`;

/**
 * The overlay toolbar, plus the hidden source panel when the source-view
 * toggle is on. Every button is independently gated by its own `show*` flag,
 * so any subset can be turned off:
 *
 * - `showSource` — the `</>` toggle AND the collapsible source panel. When on,
 *   the wrapper is a native `<details>` whose `<summary>` is the toolbar, so
 *   show/hide needs no JS. The toggle deliberately does NOT get the
 *   `.dgmo-toolbar-btn` class — client copy/open handlers preventDefault on
 *   `.dgmo-toolbar-btn` inside a `<summary>` (to not also toggle), and the
 *   toggle must keep the default.
 * - `showExpand` / `showCopy` / `showOpenInEditor` — the respective buttons.
 *
 * When the source toggle is off but another button is on, there's no
 * `<details>` to drive, so the wrapper is a plain `<div>` (same
 * `.dgmo-source-wrap` / `.dgmo-toolbar` classes, so the overlay CSS is shared)
 * with no source panel. When nothing is enabled, returns ''.
 */
function sourceDisclosure(source: string, opts: ResolvedBlockOptions): string {
  const toggle = opts.showSource
    ? `<span class="dgmo-toggle" aria-label="View DGMO source">${CODE_ICON}</span>`
    : '';

  const expandButton = opts.showExpand
    ? `<button type="button" class="dgmo-toolbar-btn dgmo-expand" aria-label="View full screen">${EXPAND_ICON}</button>`
    : '';

  const copyButton = opts.showCopy
    ? `<button type="button" class="dgmo-toolbar-btn dgmo-copy" aria-label="Copy DGMO source" data-dgmo-source="${escapeAttr(source)}">${COPY_ICON}</button>`
    : '';

  let openButton = '';
  if (opts.showOpenInEditor) {
    const encoded = encodeDiagramUrl(source, { baseUrl: opts.editorBaseUrl });
    // `too-large` (or any encode failure) → omit the link; copy remains.
    if (encoded.url) {
      openButton = `<a href="${escapeAttr(encoded.url)}" target="_blank" rel="noopener noreferrer" class="dgmo-toolbar-btn dgmo-open" aria-label="Open in online editor">${EXTERNAL_ICON}</a>`;
    }
  }

  const buttons = `${toggle}${expandButton}${copyButton}${openButton}`;
  if (!buttons) return '';

  // No source-view toggle → no <details> to drive; render a plain toolbar
  // overlay with whatever buttons remain (copy/expand still work via JS; the
  // open-in-editor link is a plain anchor and needs no JS).
  if (!opts.showSource) {
    return `<div class="dgmo-source-wrap"><div class="dgmo-toolbar">${buttons}</div></div>`;
  }

  const sourceHtml = highlightedSource(source);
  return (
    `<details class="dgmo-source-wrap">` +
    `<summary class="dgmo-toolbar" aria-label="View DGMO source">${buttons}</summary>` +
    `<div class="dgmo-source-inner">${sourceHtml}</div>` +
    `</details>`
  );
}

function highlightedSource(source: string): string {
  const tokens = highlightDgmo(source);
  const inner = tokens
    .map((t) => {
      const text = escapeHtml(t.text);
      if (!t.role || t.role === 'default') return text;
      return `<span class="dgmo-tok-${escapeAttr(t.role)}">${text}</span>`;
    })
    .join('');
  // <pre><span> rather than <pre><code>: Astro's Shiki rehype plugin and
  // Docusaurus's MDX pipeline post-process any <pre><code> pair (even ones
  // emitted as raw HTML), clobbering pre-rendered highlight spans. A <span>
  // inner element bypasses the matcher while keeping preformatted semantics.
  return `<pre class="dgmo-pre"><span class="dgmo-code">${inner}</span></pre>`;
}
