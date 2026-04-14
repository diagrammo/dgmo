import { renderForExport } from './d3';
import { renderExtendedChartForExport } from './echarts';
import {
  parseDgmoChartType,
  getRenderCategory,
  parseDgmo,
} from './dgmo-router';
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

  const { JSDOM } = await import('jsdom');
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
    /** Use v2 boxes-and-lines renderer (experimental). */
    blRendererV2?: boolean;
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

  const { diagnostics } = parseDgmo(content);

  const chartType = parseDgmoChartType(content);
  const category = chartType ? getRenderCategory(chartType) : null;

  // Build viewState from legendState (backwards compat) or use provided viewState
  const viewState: CompactViewState | undefined =
    options?.viewState ??
    (options?.legendState
      ? {
          tag: options.legendState.activeGroup ?? undefined,
          ha: options.legendState.hiddenAttributes,
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
    c4Level: options?.c4Level,
    c4System: options?.c4System,
    c4Container: options?.c4Container,
    tagGroup: options?.tagGroup,
    blRendererV2: options?.blRendererV2,
  });
  return { svg, diagnostics };
}
