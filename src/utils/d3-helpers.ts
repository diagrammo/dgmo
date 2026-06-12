// ============================================================
// Shared D3 rendering helpers — Story 109.2 (arch-review).
//
// The genuinely-shared primitives the per-visualization renderers and the
// export-dispatch handlers all reuse: SVG bootstrap (initD3Chart), chart-title
// rendering, the tooltip element, and the offscreen export-container lifecycle.
// Extracted verbatim from d3.ts so a venn renderer and a timeline renderer share
// these helpers without sharing an 8,800-line file.
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { getSeriesColors } from '../palettes';
import type { D3ExportDimensions } from './d3-types';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT, TITLE_Y } from './title-constants';

/**
 * Renders a chart title on the SVG with optional click interaction.
 */
export function renderChartTitle(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  title: string | undefined | null,
  titleLineNumber: number | undefined | null,
  width: number,
  textColor: string,
  onClickItem?: (lineNumber: number) => void
): void {
  if (!title) return;
  const titleEl = svg
    .append('text')
    .attr('class', 'chart-title')
    .attr('x', width / 2)
    .attr('y', TITLE_Y)
    .attr('text-anchor', 'middle')
    .attr('fill', textColor)
    .attr('font-size', TITLE_FONT_SIZE)
    .attr('font-weight', TITLE_FONT_WEIGHT)
    .style('cursor', onClickItem && titleLineNumber ? 'pointer' : 'default')
    .text(title);
  if (titleLineNumber) {
    titleEl.attr('data-line-number', titleLineNumber);
    if (onClickItem) {
      titleEl
        .on('click', () => onClickItem(titleLineNumber))
        .on('mouseenter', function () {
          d3Selection.select(this).attr('opacity', 0.7);
        })
        .on('mouseleave', function () {
          d3Selection.select(this).attr('opacity', 1);
        });
    }
  }
}

/**
 * Initializes a D3 chart: clears existing content, creates SVG, resolves palette colors.
 * Returns null if the container has zero dimensions.
 */
export function initD3Chart(
  container: HTMLDivElement,
  palette: PaletteColors,
  exportDims?: D3ExportDimensions
): {
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;
  width: number;
  height: number;
  textColor: string;
  mutedColor: string;
  bgColor: string;
  colors: string[];
} | null {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return null;
  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.bg;
  const colors = getSeriesColors(palette);
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('background', bgColor);
  return { svg, width, height, textColor, mutedColor, bgColor, colors };
}

/**
 * Creates (or reuses) the shared hover tooltip element inside a chart container.
 */
export function createTooltip(
  container: HTMLElement,
  palette: PaletteColors,
  isDark: boolean
): HTMLDivElement {
  container.style.position = 'relative';

  // Reuse existing tooltip element if present (avoids DOM churn on re-renders)
  const existing = container.querySelector<HTMLDivElement>('[data-d3-tooltip]');
  if (existing) {
    existing.style.display = 'none';
    existing.style.background = palette.surface;
    existing.style.color = palette.text;
    existing.style.boxShadow = isDark
      ? '0 2px 6px rgba(0,0,0,0.3)'
      : '0 2px 6px rgba(0,0,0,0.12)';
    return existing;
  }

  const tip = document.createElement('div');
  tip.setAttribute('data-d3-tooltip', '');
  tip.style.position = 'absolute';
  tip.style.display = 'none';
  tip.style.pointerEvents = 'none';
  tip.style.background = palette.surface;
  tip.style.color = palette.text;
  tip.style.padding = '6px 10px';
  tip.style.borderRadius = '4px';
  tip.style.fontSize = '12px';
  tip.style.lineHeight = '1.4';
  tip.style.whiteSpace = 'nowrap';
  tip.style.zIndex = '10';
  tip.style.boxShadow = isDark
    ? '0 2px 6px rgba(0,0,0,0.3)'
    : '0 2px 6px rgba(0,0,0,0.12)';
  container.appendChild(tip);
  return tip;
}

// ============================================================
// Export-render container lifecycle
// ============================================================

export const EXPORT_WIDTH = 1200;
export const EXPORT_HEIGHT = 800;

/**
 * Resolves the palette for export, falling back to Nord light/dark.
 */
export async function resolveExportPalette(
  theme: string,
  palette?: PaletteColors
): Promise<PaletteColors> {
  if (palette) return palette;
  const { getPalette } = await import('../palettes');
  return theme === 'dark' ? getPalette('nord').dark : getPalette('nord').light;
}

/**
 * Creates an offscreen container for export rendering.
 */
export function createExportContainer(
  width: number,
  height: number
): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);
  return container;
}

/**
 * Extracts the SVG from a container, applies common export styling, and cleans up.
 */
export function finalizeSvgExport(
  container: HTMLDivElement,
  theme: string,
  palette: PaletteColors
): string {
  const svgEl = container.querySelector('svg');
  if (!svgEl) return '';
  if (theme === 'transparent') {
    svgEl.style.background = 'none';
  } else if (!svgEl.style.background) {
    svgEl.style.background = palette.bg;
  }
  svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgEl.style.fontFamily = FONT_FAMILY;
  // Strip elements marked for export exclusion (e.g., inactive legend pills)
  svgEl.querySelectorAll('[data-export-ignore]').forEach((el) => el.remove());
  const svgHtml = svgEl.outerHTML;
  document.body.removeChild(container);
  return svgHtml;
}
