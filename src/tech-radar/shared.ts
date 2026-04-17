import type * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import type { QuadrantPosition, BlipTrend } from './types';

/** Default quadrant colors by position when not overridden. */
export const DEFAULT_QUADRANT_COLORS: Record<QuadrantPosition, string> = {
  'top-left': 'blue',
  'top-right': 'green',
  'bottom-left': 'red',
  'bottom-right': 'orange',
};

/** Resolve a quadrant's color from palette, falling back to palette.border. */
export function resolveQuadrantColor(
  position: QuadrantPosition,
  color: string | null,
  palette: PaletteColors
): string {
  const name = color ?? DEFAULT_QUADRANT_COLORS[position];
  return (palette.colors as Record<string, string>)[name] ?? palette.border;
}

/**
 * Render a trend indicator (blip circle + optional crescent/ring).
 *
 * @param angleToCenter — angle in radians from the blip toward the radar center.
 *   Used to orient the crescent for up/down trends (toward center = up, away = down).
 */
export function renderTrendIndicator(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  trend: BlipTrend | null,
  color: string,
  cx: number,
  cy: number,
  r: number,
  angleToCenter: number
): void {
  // Base filled circle (always present)
  g.append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', r * 0.65)
    .attr('fill', color);

  if (trend === 'new') {
    // Double circle — outer ring
    g.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.5);
  } else if (trend === 'up' || trend === 'down') {
    // Semi-circle crescent (ThoughtWorks style)
    // "up" = crescent on the center-facing side (moving inward)
    // "down" = crescent on the outward-facing side (moving outward)
    const crescentAngle =
      trend === 'up' ? angleToCenter : angleToCenter + Math.PI;
    renderCrescent(g, cx, cy, r, crescentAngle, color);
  }
  // 'stable' or null: plain filled circle only
}

/**
 * Draw a crescent (semi-circle arc) on one side of the blip, oriented
 * at `angle` radians (0 = right, π/2 = up in math coords / down in SVG).
 *
 * The crescent is a thick arc segment hugging the outer edge of the blip circle,
 * spanning ~160° centered on `angle`.
 */
function renderCrescent(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  color: string
): void {
  const outerR = r;
  const halfSpan = (Math.PI * 4) / 9; // ~80° each side = 160° total arc

  const startAngle = angle - halfSpan;
  const endAngle = angle + halfSpan;

  // SVG arc: start and end points on the outer circle (SVG Y-down convention)
  const x1 = cx + outerR * Math.cos(startAngle);
  const y1 = cy + outerR * Math.sin(startAngle);
  const x2 = cx + outerR * Math.cos(endAngle);
  const y2 = cy + outerR * Math.sin(endAngle);

  // Large arc flag: 0 since we span < 180°; sweep=1 for clockwise in SVG
  const largeArc = halfSpan * 2 > Math.PI ? 1 : 0;

  g.append('path')
    .attr('d', `M${x1},${y1} A${outerR},${outerR} 0 ${largeArc},1 ${x2},${y2}`)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round');
}

/** Trend indicator character for text listings. */
export function getTrendChar(trend: BlipTrend | null): string {
  switch (trend) {
    case 'new':
      return ' ★';
    case 'up':
      return ' ▲';
    case 'down':
      return ' ▼';
    default:
      return '';
  }
}

// ============================================================
// Shared Constants
// ============================================================

export const DIM_OPACITY = 0.25;

export const TREND_ITEMS: { trend: BlipTrend | null; label: string }[] = [
  { trend: 'new', label: 'New' },
  { trend: 'up', label: 'Moved in' },
  { trend: 'down', label: 'Moved out' },
  { trend: null, label: 'No change' },
];

// ============================================================
// Tooltip Helpers
// ============================================================

export function createTooltip(
  container: HTMLElement,
  palette: PaletteColors,
  isDark: boolean
): HTMLDivElement {
  container.style.position = 'relative';
  const existing = container.querySelector<HTMLDivElement>('[data-d3-tooltip]');
  if (existing) {
    existing.style.display = 'none';
    return existing;
  }
  const tip = document.createElement('div');
  tip.setAttribute('data-d3-tooltip', '');
  tip.style.position = 'absolute';
  tip.style.display = 'none';
  tip.style.pointerEvents = 'none';
  tip.style.padding = '6px 10px';
  tip.style.borderRadius = '4px';
  tip.style.fontSize = '12px';
  tip.style.fontFamily = FONT_FAMILY;
  tip.style.lineHeight = '1.4';
  tip.style.zIndex = '10';
  tip.style.whiteSpace = 'nowrap';
  tip.style.background = palette.surface;
  tip.style.color = palette.text;
  tip.style.boxShadow = isDark
    ? '0 2px 6px rgba(0,0,0,0.3)'
    : '0 2px 6px rgba(0,0,0,0.12)';
  container.appendChild(tip);
  return tip;
}

export function showTooltip(
  tooltip: HTMLDivElement,
  text: string,
  event: MouseEvent
): void {
  tooltip.textContent = text;
  tooltip.style.display = 'block';
  const container = tooltip.parentElement!;
  const rect = container.getBoundingClientRect();
  let left = event.clientX - rect.left + 12;
  let top = event.clientY - rect.top - 28;
  const tipW = tooltip.offsetWidth;
  if (left + tipW > rect.width) left = rect.width - tipW - 4;
  if (top < 0) top = event.clientY - rect.top + 16;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function hideTooltip(tooltip: HTMLDivElement): void {
  tooltip.style.display = 'none';
}
