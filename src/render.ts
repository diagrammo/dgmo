import { renderForExport } from './d3';
import { renderExtendedChartForExport } from './echarts';
import { getRenderCategory, parseDgmo } from './dgmo-router';
import type { DgmoError } from './diagnostics';
import { getPalette } from './palettes/registry';
import type { CompactViewState } from './sharing';

/**
 * Ensures DOM globals are available for D3 renderers.
 * No-ops in browser environments where `document` already exists.
 * Dynamically imports jsdom only in Node.js to avoid bundling it for browsers.
 */
async function ensureDom(): Promise<void> {
  if (typeof document !== 'undefined') return;

  const { JSDOM } = await loadJsdom();
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;

  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
}

/**
 * Load jsdom server-side. The specifier is constructed at runtime so
 * downstream bundlers (Vite, Rollup, esbuild, webpack) cannot statically
 * resolve it. Without this indirection, every browser bundle of
 * @diagrammo/dgmo emits a 5+ MB jsdom chunk even though `ensureDom()`
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
  }
): Promise<{ svg: string; diagnostics: DgmoError[] }> {
  const theme = options?.theme ?? 'light';
  const paletteName = options?.palette ?? 'nord';

  const paletteColors =
    getPalette(paletteName)[theme === 'dark' ? 'dark' : 'light'];

  const parsed = parseDgmo(content);
  let diagnostics = parsed.diagnostics;
  const chartType = parsed.chartType;
  const category = chartType ? getRenderCategory(chartType) : null;

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
    const svg = await renderExtendedChartForExport(
      content,
      theme,
      paletteColors
    );
    return { svg, diagnostics };
  }

  // Visualization/diagram and unknown/null types all go through the unified renderer
  await ensureDom();
  const svg = await renderForExport(content, theme, paletteColors, viewState, {
    ...(options?.c4Level !== undefined && { c4Level: options.c4Level }),
    ...(options?.c4System !== undefined && { c4System: options.c4System }),
    ...(options?.c4Container !== undefined && {
      c4Container: options.c4Container,
    }),
    ...(options?.tagGroup !== undefined && { tagGroup: options.tagGroup }),
  });

  // The map pipeline resolves names AFTER parsing (gazetteer/ISO lookup), so its
  // unknown-place / unknown-subdivision errors live on the ResolvedMap, not the
  // ParsedMap. Surface them through render() so the editor shows squiggles.
  // resolveMap seeds its diagnostics with the parser's, so this is a superset.
  // loadMapData is memoized (renderForExport already loaded it) — no double read.
  if (chartType === 'map') {
    try {
      const [{ parseMap }, { resolveMap }, { loadMapData }, { layoutMap }] =
        await Promise.all([
          import('./map/parser'),
          import('./map/resolver'),
          import('./map/load-data'),
          import('./map/layout'),
        ]);
      const data = await loadMapData();
      const resolvedMap = resolveMap(parseMap(content), data);
      // Layout-time, dimension-dependent diagnostics (best-effort surface-route
      // warnings) live on the MapLayout, not the ResolvedMap. Run the layout at
      // the SAME export dimensions the renderer used (d3.ts EXPORT_WIDTH/HEIGHT)
      // so the diagnostics match what was drawn, then merge (deduped).
      let layoutDiags: DgmoError[] = [];
      try {
        layoutDiags = [
          ...layoutMap(
            resolvedMap,
            data,
            { width: 1200, height: 800 },
            { palette: paletteColors, isDark: theme === 'dark' }
          ).diagnostics,
        ];
      } catch {
        /* layout failed → keep resolver diagnostics only */
      }
      const seen = new Set<string>();
      diagnostics = [...resolvedMap.diagnostics, ...layoutDiags].filter((d) => {
        const key = `${d.code}|${d.line}|${d.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch {
      /* asset load failed — keep the parser diagnostics */
    }
  }

  return { svg, diagnostics };
}
