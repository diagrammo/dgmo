import { renderForExport } from './d3';
import { renderExtendedChartForExport } from './echarts';
import { parseDgmoChartType, getRenderCategory } from './dgmo-router';
import { getPalette } from './palettes/registry';

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
 * @returns SVG string, or empty string on error
 *
 * @example
 * ```ts
 * import { render } from '@diagrammo/dgmo';
 *
 * const svg = await render(`pie Languages
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
    branding?: boolean;
    c4Level?: 'context' | 'containers' | 'components' | 'deployment';
    c4System?: string;
    c4Container?: string;
    tagGroup?: string;
    /** Legend state for export — controls which tag group is shown in exported SVG. */
    legendState?: { activeGroup?: string; hiddenAttributes?: string[] };
  }
): Promise<string> {
  const theme = options?.theme ?? 'light';
  const paletteName = options?.palette ?? 'nord';
  const branding = options?.branding ?? false;

  const paletteColors =
    getPalette(paletteName)[theme === 'dark' ? 'dark' : 'light'];

  const chartType = parseDgmoChartType(content);
  const category = chartType ? getRenderCategory(chartType) : null;

  // Build orgExportState from legendState if provided
  const legendExportState = options?.legendState
    ? {
        activeTagGroup: options.legendState.activeGroup ?? null,
        hiddenAttributes: options.legendState.hiddenAttributes
          ? new Set(options.legendState.hiddenAttributes)
          : undefined,
      }
    : undefined;

  if (category === 'data-chart') {
    return renderExtendedChartForExport(content, theme, paletteColors, {
      branding,
    });
  }

  // Visualization/diagram and unknown/null types all go through the unified renderer
  await ensureDom();
  return renderForExport(content, theme, paletteColors, legendExportState, {
    branding,
    c4Level: options?.c4Level,
    c4System: options?.c4System,
    c4Container: options?.c4Container,
    tagGroup: options?.tagGroup,
  });
}
