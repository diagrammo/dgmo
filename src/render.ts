import { renderForExport, resolveArcChordOverride } from './d3';
import { renderDataChartD3 } from './charts-d3';
import { getRenderCategory, parseDgmo } from './dgmo-router';
import type { DgmoError } from './diagnostics';
import { getPalette } from './palettes/registry';
import type { CompactViewState } from './sharing';

// DOM globals installed for Node-side D3 rendering, scoped with ref-counting.
//
// These need to exist on `globalThis` while a D3 renderer runs (it reaches for
// `document`). The naive approach — install them once and leave them — leaks a
// jsdom `window` into the host Node process forever. That breaks hosts that run
// their OWN SSR/SSG in the same process after calling render(): notably
// Docusaurus static export, whose theme then believes it is in a browser
// (`canUseDOM` true) and crashes on bare globals this shim does NOT define
// (`requestAnimationFrame`, `MutationObserver`) or on opaque-origin
// `localStorage`. So we install on the first concurrent render and tear down
// once the last one finishes, leaving the host a clean Node environment.
const DOM_GLOBALS = [
  'document',
  'window',
  'navigator',
  'HTMLElement',
  'SVGElement',
] as const;
let domRefCount = 0;
let domInstallPromise: Promise<void> | null = null;
let domInstalledByUs = false;

async function installDom(): Promise<void> {
  const { JSDOM } = await loadJsdom();
  // Concrete URL → non-opaque origin, so host code that touches
  // window.localStorage during a same-process render doesn't throw.
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  const win = dom.window;
  const values: Record<(typeof DOM_GLOBALS)[number], unknown> = {
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  };
  for (const key of DOM_GLOBALS) {
    Object.defineProperty(globalThis, key, {
      value: values[key],
      configurable: true,
    });
  }
  domInstalledByUs = true;
}

/**
 * Make DOM globals available for the duration of a render. No-ops in a real
 * browser or any host that already provides `document` (we never touch globals
 * we did not install). Pair every successful call with `releaseDom()`.
 */
async function acquireDom(): Promise<void> {
  if (typeof document !== 'undefined' && !domInstalledByUs) return;
  domRefCount++;
  if (!domInstallPromise) domInstallPromise = installDom();
  await domInstallPromise;
}

/** Tear down the jsdom globals once no render is in flight. */
function releaseDom(): void {
  if (!domInstalledByUs) return;
  if (--domRefCount > 0) return;
  for (const key of DOM_GLOBALS) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  domInstalledByUs = false;
  domInstallPromise = null;
  domRefCount = 0;
}

/**
 * Load jsdom server-side. The specifier is constructed at runtime so
 * downstream bundlers (Vite, Rollup, esbuild, webpack) cannot statically
 * resolve it. Without this indirection, every browser bundle of
 * @diagrammo/dgmo emits a 5+ MB jsdom chunk even though `acquireDom()`
 * guards execution with a `typeof document` check — the guard prevents
 * runtime evaluation, but the static dependency edge still pulls jsdom
 * into the bundle.
 */
async function loadJsdom(): Promise<typeof import('jsdom')> {
  const spec = ['js', 'dom'].join('');
  return import(/* @vite-ignore */ /* webpackIgnore: true */ spec) as Promise<
    typeof import('jsdom')
  >;
}

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
export async function render(
  content: string,
  options?: {
    theme?: 'light' | 'dark' | 'transparent';
    palette?: string;
    c4Level?: 'context' | 'containers' | 'components' | 'deployment';
    c4System?: string;
    c4Container?: string;
    tagGroup?: string;
    /** Legend state for export — controls which tag group is shown in exported SVG. */
    legendState?: { activeGroup?: string; hiddenAttributes?: string[] };
    /** View state for export — controls interactive state (collapse, swimlanes, etc.) */
    viewState?: CompactViewState;
    /** Bundled map data for `map` charts in the browser, where the Node fs
     *  `loadMapData()` seam can't run. CLI/SSR omit this and fall back to fs. */
    mapData?: import('./map/resolved-types').MapData;
  }
): Promise<{ svg: string; diagnostics: DgmoError[] }> {
  const theme = options?.theme ?? 'light';
  const paletteName = options?.palette ?? 'slate';

  const paletteColors =
    getPalette(paletteName)[theme === 'dark' ? 'dark' : 'light'];

  const parsed = parseDgmo(content);
  let diagnostics = parsed.diagnostics;
  // Arc↔chord `layout` override (#26): re-emit canonical content for the other
  // engine so each renders its own grammar. Applied here (before the category
  // branch) so it covers BOTH the data-chart shortcut and the unified path.
  const acOverride = resolveArcChordOverride(
    content,
    parsed.chartType,
    paletteColors
  );
  const renderContent = acOverride?.content ?? content;
  const chartType = acOverride?.type ?? parsed.chartType;
  // The arc `layout chord` override (#26/#29) re-emits canonical `chord …`
  // content for the internal circular renderer. `chord` is no longer a registry
  // type, so getRenderCategory returns null for it — force the data-chart branch
  // when the override applied, otherwise the re-emitted content is re-detected as
  // a sequence diagram (arrow-shaped edges) and renders wrong.
  const category = acOverride
    ? 'data-chart'
    : chartType
      ? getRenderCategory(chartType)
      : null;

  // Build viewState from legendState (backwards compat) or use provided viewState
  const viewState: CompactViewState | undefined =
    options?.viewState ??
    (options?.legendState
      ? {
          ...(options.legendState.activeGroup !== undefined && {
            tag: options.legendState.activeGroup,
          }),
          ...(options.legendState.hiddenAttributes !== undefined && {
            ha: options.legendState.hiddenAttributes,
          }),
        }
      : undefined);

  if (category === 'data-chart') {
    // All data-chart types render through the hand-built D3 engine (no ECharts).
    await acquireDom();
    try {
      const svg = await renderDataChartD3(renderContent, theme, paletteColors);
      return { svg, diagnostics };
    } finally {
      releaseDom();
    }
  }

  // Visualization/diagram and unknown/null types all go through the unified renderer
  await acquireDom();
  let svg: string;
  try {
    svg = await renderForExport(
      renderContent,
      theme,
      paletteColors,
      viewState,
      {
        ...(options?.c4Level !== undefined && { c4Level: options.c4Level }),
        ...(options?.c4System !== undefined && { c4System: options.c4System }),
        ...(options?.c4Container !== undefined && {
          c4Container: options.c4Container,
        }),
        ...(options?.tagGroup !== undefined && { tagGroup: options.tagGroup }),
        ...(options?.mapData !== undefined && { mapData: options.mapData }),
      }
    );
  } finally {
    releaseDom();
  }

  // The map pipeline resolves names AFTER parsing (gazetteer/ISO lookup), so its
  // unknown-place / unknown-subdivision errors live on the ResolvedMap, not the
  // ParsedMap. Surface them through render() so the editor shows squiggles.
  // resolveMap seeds its diagnostics with the parser's, so this is a superset.
  // loadMapData is memoized (renderForExport already loaded it) — no double read.
  if (chartType === 'map') {
    try {
      const [{ parseMap }, { resolveMap }, { loadMapData }] = await Promise.all(
        [
          import('./map/parser'),
          import('./map/resolver'),
          import('./map/load-data'),
        ]
      );
      // Prefer injected data (browser); fall back to the fs loader (CLI/SSR).
      const data = options?.mapData ?? (await loadMapData());
      // resolveMap seeds its diagnostics with the parser's, so this is a superset.
      // (The layout stage has no diagnostics producer, so there is nothing to merge.)
      diagnostics = [...resolveMap(parseMap(content), data).diagnostics];
    } catch {
      /* asset load failed — keep the parser diagnostics */
    }
  }

  return { svg, diagnostics };
}
