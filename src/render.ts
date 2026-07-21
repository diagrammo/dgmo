import { renderForExport, resolveArcChordOverride } from './d3';
import { renderDataChartD3 } from './charts-d3';
import { injectHoverStyles } from './utils/hover-styles';
import { getRenderCategory, parseDgmo } from './dgmo-router';
import type { DgmoError } from './diagnostics';
import { makeDgmoError } from './diagnostics';
import { legendInlineSupported } from './utils/inline-header';
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
// The ref-count state lives on `globalThis` under a well-known symbol rather
// than in module state: dist/index and dist/block are each self-contained
// bundles, so a host importing both gets two copies of this module. With
// per-copy state, each copy keeps its own ref-count over the SAME
// `globalThis.document` — one copy's release tears down globals mid-render of
// the other. `Symbol.for` puts every copy on one shared count.
interface DomGlobalsState {
  refCount: number;
  installPromise: Promise<void> | null;
  installedByUs: boolean;
}
const DOM_STATE_KEY = Symbol.for('diagrammo.dgmo.dom-globals');

function domState(): DomGlobalsState {
  const g = globalThis as { [DOM_STATE_KEY]?: DomGlobalsState };
  return (g[DOM_STATE_KEY] ??= {
    refCount: 0,
    installPromise: null,
    installedByUs: false,
  });
}

async function installDom(state: DomGlobalsState): Promise<void> {
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
  state.installedByUs = true;
}

/**
 * Make DOM globals available for the duration of a render. No-ops in a real
 * browser or any host that already provides `document` (we never touch globals
 * we did not install). Pair every successful call with `releaseDom()`.
 */
async function acquireDom(): Promise<void> {
  const state = domState();
  if (typeof document !== 'undefined' && !state.installedByUs) return;
  state.refCount++;
  if (!state.installPromise) state.installPromise = installDom(state);
  await state.installPromise;
}

/** Tear down the jsdom globals once no render is in flight. */
function releaseDom(): void {
  const state = domState();
  if (!state.installedByUs) return;
  if (--state.refCount > 0) return;
  for (const key of DOM_GLOBALS) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  state.installedByUs = false;
  state.installPromise = null;
  state.refCount = 0;
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
    /** Bake pure-CSS hover into the exported SVG (no JS). Default ON — embeds
     *  (Obsidian, doc-site wrappers) get hover feedback for free. The desktop
     *  app renders its live preview through direct renderer calls (not this
     *  entry), so it keeps its JS emphasis; pass `false` to opt out. */
    bakeHover?: boolean;
  }
): Promise<{
  svg: string;
  diagnostics: DgmoError[];
  /** Detected chart type (e.g. `map`, `clock`), or undefined when inference
   *  failed. Embed callers use it to pick the default embed background. */
  chartType: string | undefined;
}> {
  const theme = options?.theme ?? 'light';
  const paletteName = options?.palette ?? 'slate';
  const bakeHover = options?.bakeHover ?? true;

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

  // §1.9 `legend-inline` (decision #50): warn when the directive is present on a
  // chart type that doesn't render a one-line header — so it never silently
  // pretends to work. Computed here but merged at each return (some render
  // branches, e.g. map, reassign `diagnostics` and would drop it otherwise).
  const legendInlineWarning = ((): DgmoError | null => {
    if (!chartType || legendInlineSupported(chartType)) return null;
    const idx = renderContent
      .split('\n')
      .findIndex((l) => l.trim().toLowerCase() === 'legend-inline');
    if (idx < 0) return null;
    return makeDgmoError(
      idx + 1,
      `'legend-inline' isn't supported for ${chartType} charts — the title and legend render stacked.`,
      'warning',
      'W_LEGEND_INLINE_UNSUPPORTED'
    );
  })();
  const withLegendInlineWarning = (ds: DgmoError[]): DgmoError[] =>
    legendInlineWarning ? [...ds, legendInlineWarning] : ds;

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
      const raw = await renderDataChartD3(renderContent, theme, paletteColors);
      // Bake pure-CSS hover while jsdom is still installed (the injector scans
      // the SVG DOM for group values). No-op unless `chartType` has a registry
      // row and `bakeHover` is on.
      const svg = injectHoverStyles(raw, chartType, { bakeHover });
      return { svg, diagnostics: withLegendInlineWarning(diagnostics), chartType: chartType ?? undefined };
    } finally {
      releaseDom();
    }
  }

  // The map pipeline resolves names AFTER parsing (gazetteer/ISO lookup), so its
  // unknown-place / unknown-subdivision errors live on the ResolvedMap, not the
  // ParsedMap. renderForExport's map handler already computes that resolve —
  // capture its diagnostics through the out-param instead of re-running
  // parseMap+resolveMap here. Ref-object (not a bare let) so TS doesn't narrow
  // the closure-assigned value to null at the read below.
  const mapDiag: { current: readonly DgmoError[] | null } = { current: null };

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
        onMapResolverDiagnostics: (d) => {
          mapDiag.current = d;
        },
      }
    );
    // Bake pure-CSS hover while jsdom is still installed (no-op unless the
    // detected `chartType` has a registry row and `bakeHover` is on).
    svg = injectHoverStyles(svg, chartType, { bakeHover });
  } finally {
    releaseDom();
  }

  // resolveMap seeds its diagnostics with the parser's, so this is a superset.
  // (The layout stage has no diagnostics producer, so there is nothing to merge.)
  // When the map assets failed to load, exportMap never resolved and the
  // out-param stays null — keep the parser diagnostics, as before.
  if (chartType === 'map' && mapDiag.current) {
    diagnostics = [...mapDiag.current];
  }

  return { svg, diagnostics: withLegendInlineWarning(diagnostics), chartType: chartType ?? undefined };
}
