/**
 * `dist/element.js` — the universal `<dgmo-diagram>` custom element.
 *
 * Reached by `<script src>` only. The `./element` subpath export and its
 * unminified `.mjs` twin were removed on 2026-08-06 — see `src/auto/index.ts`.
 *
 * A mermaid-style, framework-agnostic client-side web component. Drop the
 * IIFE script (`dist/element.js`) on ANY page — Hugo, Jekyll, MkDocs,
 * VitePress, plain HTML — and author diagrams as:
 *
 * ```html
 * <script src="https://unpkg.com/@diagrammo/dgmo/dist/element.js"></script>
 * <dgmo-diagram palette="nord">
 *   flowchart
 *   [Start] -> [Done]
 * </dgmo-diagram>
 * ```
 *
 * The element reads its DGMO source (a nested `<script type="text/dgmo">`,
 * a `<pre>`, or its own text content — de-indented), calls the isomorphic
 * `render()`, sanitizes the SVG, and injects it. Attributes: `palette`,
 * `theme`/`color-mode`, `mode` (diagram|showcase), `editor-base`,
 * `map-data-base`.
 *
 * DOM strategy — **light DOM** (not shadow DOM). Rationale: the rendered
 * SVG, source panel, and syntax-highlight token classes are all styled by
 * the shared `auto.css` (injected once via `ensureStyles()`). Cloning that
 * whole stylesheet into every shadow root would be heavy and would break
 * the `.dgmo-tok-*` highlight hooks; the CSS is already namespaced under
 * `.dgmo-*` so collision risk is low. See the CLAUDE.md embed notes.
 *
 * Map-data seam — the base bundle never statically imports the ~380 KB geo
 * JSON. Only when a diagram's first token is `map` does the element
 * lazy-`fetch()` the map assets from `map-data-base` (default: the pinned
 * unpkg `dist/map-data/` path) and inject them as `render({ mapData })`.
 * Fetched data is cached across every element on the page. Non-map diagrams
 * trigger ZERO extra network requests.
 */

import { render } from '../render';
import { startCountdowns } from '../countdown/ticker';
import { startClocks } from '../clock/ticker';
import { parseDgmoChartType } from '../dgmo-router';
import type { MapData } from '../map/resolved-types';
import '../palettes';
import {
  VERSION,
  EDITOR_BASE_URL,
  ensureStyles,
  resolveTheme,
  sanitizeSvgInPlace,
  deriveAriaLabel,
  buildRenderedBlock,
  buildErrorBlock,
  buildShareUrl,
  sharedWarn,
  type ThemePreference,
} from '../auto/shared';

// ============================================================
// Map-data lazy loader (fetch-based, browser DI seam)
// ============================================================

/** Default CDN base for the map geo JSON, pinned to THIS package version so an
 *  element loaded from a stale bundle can't fetch mismatched assets. */
const DEFAULT_MAP_DATA_BASE = `https://unpkg.com/@diagrammo/dgmo@${VERSION}/dist/map-data/`;

// File names mirror src/map/load-data.ts's FILES map (the Node fs loader).
const REQUIRED_MAP_FILES = {
  worldCoarse: 'world-coarse.json',
  worldDetail: 'world-detail.json',
  usStates: 'us-states.json',
  gazetteer: 'gazetteer.json',
} as const;
const OPTIONAL_MAP_FILES = {
  lakes: 'lakes.json',
  rivers: 'rivers.json',
  mountainRanges: 'mountain-ranges.json',
  naLand: 'na-land.json',
  naLakes: 'na-lakes.json',
  waterBodies: 'water-bodies.json',
  airports: 'airports.json',
} as const;

/** Cache assembled MapData per base URL so N `<dgmo-diagram map>` elements on a
 *  page share ONE set of fetches. A rejected load is evicted so a later element
 *  can retry (mirrors the Node loader's non-poisoning memo). */
const mapDataCache = new Map<string, Promise<MapData>>();

function normalizeBase(base: string): string {
  return base.endsWith('/') ? base : base + '/';
}

async function fetchJson<T>(base: string, file: string): Promise<T> {
  const res = await fetch(base + file);
  if (!res.ok) {
    throw new Error(`map asset ${file} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function loadMapDataFromBase(rawBase: string): Promise<MapData> {
  const base = normalizeBase(rawBase);
  const cached = mapDataCache.get(base);
  if (cached) return cached;

  const promise = (async (): Promise<MapData> => {
    // Required assets fail the whole load if any are missing.
    const [worldCoarse, worldDetail, usStates, gazetteer] = await Promise.all([
      fetchJson<MapData['worldCoarse']>(base, REQUIRED_MAP_FILES.worldCoarse),
      fetchJson<MapData['worldDetail']>(base, REQUIRED_MAP_FILES.worldDetail),
      fetchJson<MapData['usStates']>(base, REQUIRED_MAP_FILES.usStates),
      fetchJson<MapData['gazetteer']>(base, REQUIRED_MAP_FILES.gazetteer),
    ]);
    // Optional assets degrade to `undefined` (older bundles / trimmed CDNs).
    const optionalEntries = await Promise.all(
      (
        Object.entries(OPTIONAL_MAP_FILES) as Array<
          [keyof typeof OPTIONAL_MAP_FILES, string]
        >
      ).map(async ([key, file]) => {
        try {
          return [key, await fetchJson<unknown>(base, file)] as const;
        } catch {
          return [key, undefined] as const;
        }
      })
    );
    const optional: Record<string, unknown> = {};
    for (const [key, value] of optionalEntries) {
      if (value !== undefined) optional[key] = value;
    }
    return {
      worldCoarse,
      worldDetail,
      usStates,
      gazetteer,
      ...optional,
    } as MapData;
  })().catch((err: unknown) => {
    mapDataCache.delete(base); // don't poison retries with a rejected promise
    throw err;
  });

  mapDataCache.set(base, promise);
  return promise;
}

// ============================================================
// Source extraction
// ============================================================

/** Strip a uniform leading indent and surrounding blank lines so authors can
 *  indent the DGMO block to match their surrounding HTML without the indent
 *  leaking into the parser. */
function dedent(raw: string): string {
  const lines = raw.replace(/\t/g, '  ').split('\n');
  // Drop leading/trailing blank lines.
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  if (lines.length === 0) return '';
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent < min) min = indent;
  }
  if (!Number.isFinite(min) || min === 0) return lines.join('\n');
  return lines.map((l) => l.slice(min)).join('\n');
}

// ============================================================
// The custom element
// ============================================================

const OBSERVED = [
  'palette',
  'theme',
  'color-mode',
  'mode',
  'editor-base',
  'map-data-base',
  'show-source',
  'show-copy',
  'show-expand',
  'show-editor-link',
] as const;

export class DgmoDiagram extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  /** DGMO source, captured from the original children ONCE before the first
   *  render replaces them. */
  private source: string | null = null;
  /** Monotonic render token — a late-resolving render/fetch whose token is
   *  stale (superseded by a newer attribute-driven render) is discarded. */
  private renderToken = 0;
  private container: HTMLDivElement | null = null;

  connectedCallback(): void {
    if (this.source === null) {
      this.source = this.readSource();
      ensureStyles();
      // Replace authored children with a managed container (light DOM).
      this.textContent = '';
      this.container = document.createElement('div');
      this.appendChild(this.container);
    }
    void this.rerender();
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    // Ignore the initial attribute set (before connect) and no-op changes.
    if (this.source === null || oldValue === newValue) return;
    void this.rerender();
  }

  // ---- source ----

  private readSource(): string {
    const script = this.querySelector('script[type="text/dgmo"]');
    if (script) return dedent(script.textContent || '');
    const pre = this.querySelector('pre');
    if (pre) return dedent(pre.textContent || '');
    return dedent(this.textContent || '');
  }

  // ---- attribute resolution ----

  private themePreference(): ThemePreference {
    // `color-mode` is canonical; `theme` is an accepted synonym.
    const raw = (
      this.getAttribute('color-mode') ||
      this.getAttribute('theme') ||
      'auto'
    ).toLowerCase();
    if (
      raw === 'auto' ||
      raw === 'light' ||
      raw === 'dark' ||
      raw === 'transparent'
    ) {
      return raw;
    }
    return 'auto';
  }

  private palette(): string {
    return this.getAttribute('palette') || 'slate';
  }

  private editorBase(): string {
    return this.getAttribute('editor-base') || EDITOR_BASE_URL;
  }

  private mapDataBase(): string {
    return this.getAttribute('map-data-base') || DEFAULT_MAP_DATA_BASE;
  }

  private isShowcase(): boolean {
    return (
      (this.getAttribute('mode') || 'diagram').toLowerCase() === 'showcase'
    );
  }

  /**
   * Per-button visibility. Each defaults to the `mode` (showcase → on,
   * diagram → off) and can be independently overridden with a `show-*`
   * attribute set to `true` / `false`.
   */
  private boolAttr(name: string, fallback: boolean): boolean {
    const v = this.getAttribute(name);
    if (v === null) return fallback;
    return v.toLowerCase() !== 'false';
  }

  // ---- render pipeline ----

  private mount(node: Node, classes: string): void {
    if (!this.container) return;
    this.container.className = classes;
    this.container.textContent = '';
    this.container.appendChild(node);
  }

  private showError(opts: {
    message: string;
    severity?: string;
    line?: number;
    column?: number;
  }): void {
    // The standard error card carries `.dgmo.dgmo--error` on its own root,
    // so the container itself stays class-free.
    this.mount(buildErrorBlock({ ...opts, source: this.source ?? '' }), '');
  }

  private async rerender(): Promise<void> {
    const token = ++this.renderToken;
    const src = this.source ?? '';

    if (src.trim() === '') {
      this.showError({ message: 'No DGMO source provided', severity: 'error' });
      return;
    }

    // Loading state (visible only while an async render/fetch is in flight).
    const loading = document.createElement('div');
    loading.textContent = 'Rendering diagram…';
    this.mount(loading, 'dgmo--loading');

    const themePref = this.themePreference();
    const resolvedTheme =
      themePref === 'transparent' ? 'transparent' : resolveTheme(themePref);
    const palette = this.palette();

    // Cheap chart-type detection (first token) — only `map` needs geo data.
    let mapData: MapData | undefined;
    const chartType = parseDgmoChartType(src);
    if (chartType === 'map') {
      const base = this.mapDataBase();
      if (!base) {
        this.showError({
          message:
            'Map diagrams need map data — set a "map-data-base" URL on <dgmo-diagram>.',
          severity: 'error',
        });
        return;
      }
      try {
        mapData = await loadMapDataFromBase(base);
      } catch (err) {
        sharedWarn('map data fetch failed:', err);
        this.showError({
          message: `Could not load map data from "${base}". Check the "map-data-base" URL.`,
          severity: 'error',
        });
        return;
      }
      if (token !== this.renderToken) return; // superseded while fetching
    }

    let result: Awaited<ReturnType<typeof render>>;
    try {
      result = await render(src, {
        theme: resolvedTheme,
        palette,
        ...(mapData !== undefined && { mapData }),
      });
    } catch (err) {
      if (token !== this.renderToken) return;
      const message =
        err instanceof Error ? err.message : 'Render failed unexpectedly';
      this.showError({ message, severity: 'error' });
      sharedWarn('render() rejected:', err);
      return;
    }
    if (token !== this.renderToken) return;

    if (result.diagnostics && result.diagnostics.length > 0) {
      const d = result.diagnostics[0]!;
      this.showError({
        message: d.message,
        severity: d.severity,
        ...(d.line !== undefined && { line: d.line }),
        ...(d.column !== undefined && { column: d.column }),
      });
      return;
    }

    if (!result.svg) {
      this.showError({
        message: 'Empty SVG returned from renderer',
        severity: 'error',
      });
      return;
    }

    // Parse + sanitize the SVG before it lands in the live DOM.
    const holder = document.createElement('div');
    holder.innerHTML = result.svg;
    const svgEl = holder.querySelector('svg');
    if (!svgEl) {
      this.showError({
        message: 'Empty SVG returned from renderer',
        severity: 'error',
      });
      return;
    }
    sanitizeSvgInPlace(svgEl);
    svgEl.setAttribute('role', 'img');
    svgEl.setAttribute('aria-label', deriveAriaLabel(src));

    const themeClass =
      resolvedTheme === 'dark'
        ? 'dgmo-theme-dark'
        : resolvedTheme === 'transparent'
          ? 'dgmo-theme-transparent'
          : 'dgmo-theme-light';

    // Showcase chrome: standard embed block (BL-114) with the hover-reveal
    // toolbar. Each button defaults to `mode` and is independently
    // overridable via `show-source` / `show-copy` / `show-expand` /
    // `show-editor-link`.
    const showcase = this.isShowcase();
    const showSource = this.boolAttr('show-source', showcase);
    const showCopy = this.boolAttr('show-copy', showcase);
    const showExpand = this.boolAttr('show-expand', showcase);
    const showEditorLink = this.boolAttr('show-editor-link', showcase);
    const shareUrl = showEditorLink
      ? buildShareUrl(src, {
          palette,
          theme: resolvedTheme === 'dark' ? 'dark' : 'light',
          editorBase: this.editorBase(),
          campaign: VERSION,
          utmSource: 'element-embed',
        })
      : null;

    const wrapper = buildRenderedBlock({
      source: src,
      svgEl,
      themeClass,
      showSource,
      showCopy,
      showExpand,
      showEditorLink,
      shareUrl,
    });

    this.mount(wrapper, 'dgmo--rendered');
    // Light up any `countdown` chart: seed on load + register the 1s ticker
    // (idempotent, single page-level interval). No-op for other chart types.
    startCountdowns(wrapper);
    startClocks(wrapper);
  }
}

// ============================================================
// Self-registration
// ============================================================

/** Idempotently define `<dgmo-diagram>`. Safe to call multiple times and in
 *  SSR/no-DOM contexts (no-ops when `customElements` is unavailable). */
export function defineDgmoDiagram(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get('dgmo-diagram')) return;
  try {
    customElements.define('dgmo-diagram', DgmoDiagram);
  } catch {
    // Another copy of the bundle may have won the race — harmless.
  }
}

// Auto-register on load so `<script src=".../element.js">` + `<dgmo-diagram>`
// works with zero glue code.
defineDgmoDiagram();

export default DgmoDiagram;
