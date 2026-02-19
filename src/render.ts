import { renderD3ForExport } from './d3';
import { renderEChartsForExport } from './echarts';
import { parseDgmoChartType, getDgmoFramework } from './dgmo-router';
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

  Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: win.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'SVGElement', { value: win.SVGElement, configurable: true });
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
 * const svg = await render(`chart: pie
 * title: Languages
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
  },
): Promise<string> {
  const theme = options?.theme ?? 'light';
  const paletteName = options?.palette ?? 'nord';

  const paletteColors = getPalette(paletteName)[theme === 'dark' ? 'dark' : 'light'];

  const chartType = parseDgmoChartType(content);
  const framework = chartType ? getDgmoFramework(chartType) : null;

  if (framework === 'echart') {
    return renderEChartsForExport(content, theme, paletteColors);
  }

  // D3 and unknown/null frameworks both go through D3 renderer
  await ensureDom();
  return renderD3ForExport(content, theme, paletteColors);
}
