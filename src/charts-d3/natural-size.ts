// ============================================================
// Natural canvas size for a data chart
// ============================================================
//
// A structured diagram has a natural width: an org chart with five cards is
// 672px because five cards is how wide five cards are. A data chart had none —
// six bars stretched to fill whatever canvas they were handed, and the canvas
// was always `EXPORT_WIDTH` (1200). So a six-bar chart and a five-card org
// chart, both sparse, came out 1200 and 672 wide, and every consumer scales an
// SVG to its own column (`width: 100%` in the shared embed CSS and in all five
// doc-framework wrappers), which made the bar chart's labels render at roughly
// half the size of the org chart's for no reason connected to the data.
//
// Apparent text size is `declared x column / content extent`. Giving a data
// chart a content extent makes that ratio mean the same thing it means for
// every other chart type. Issue #532.
//
// 🔴 This is the DEFAULT only. An explicit `options.width` still wins, and the
// clamp never exceeds `EXPORT_WIDTH`, so no chart gets wider than it was —
// only a chart with little in it gets narrower.

import { parseChart } from '../chart';
import { parseExtendedChart } from '../data-chart-parser';
import { EXPORT_HEIGHT, EXPORT_WIDTH } from '../utils/d3-helpers';
import { MIN_CANVAS_WIDTH } from '../utils/fit-canvas';
import type { PaletteColors } from '../palettes';

/**
 * Width for a chart whose extent is not driven by a count — radial charts,
 * a funnel's stack, a scatter cloud, a continuous curve. Chosen to sit in the
 * same band as the structured chart types' own natural widths (org 672,
 * kanban 672, er 680, class 420), so their type reads at a comparable size.
 */
const UNCOUNTED_WIDTH = 720;
/** Narrowest natural canvas — shared with the graph fit (`utils/fit-canvas.ts`). */
const MIN_NATURAL_WIDTH = MIN_CANVAS_WIDTH;

/** Comfortable x-step per repeating element, by what the element is. */
const STEP_PER_CATEGORY = 80;
const STEP_PER_SERIES_IN_GROUP = 28;
const STEP_PER_LINE_POINT = 48;
const STEP_PER_HEATMAP_COLUMN = 64;
const STEP_PER_SANKEY_DEPTH = 220;

/** Axis furniture either side of the plot: value gutter plus right padding. */
const AXIS_FURNITURE = 120;

function clamp(w: number): number {
  return Math.round(Math.max(MIN_NATURAL_WIDTH, Math.min(EXPORT_WIDTH, w)));
}

/** Count of distinct depth levels in a sankey/chord link set. */
function sankeyDepth(
  links: readonly { source: string; target: string }[]
): number {
  const targets = new Set(links.map((l) => l.target));
  const roots = new Set(
    links.map((l) => l.source).filter((n) => !targets.has(n))
  );
  if (roots.size === 0) return 2;
  const next = new Map<string, string[]>();
  for (const l of links)
    next.set(l.source, [...(next.get(l.source) ?? []), l.target]);
  let depth = 1;
  let level = [...roots];
  const seen = new Set(level);
  while (level.length > 0 && depth < 12) {
    const following = level
      .flatMap((n) => next.get(n) ?? [])
      .filter((n) => !seen.has(n));
    if (following.length === 0) break;
    following.forEach((n) => seen.add(n));
    level = [...new Set(following)];
    depth += 1;
  }
  return depth;
}

/**
 * The canvas a data chart would choose for itself, or `null` when the content
 * does not parse as one (the caller then keeps its own default).
 *
 * Height follows `EXPORT_WIDTH : EXPORT_HEIGHT`, so a narrower canvas stays the
 * same shape rather than turning a bar chart portrait.
 */
export function naturalDataChartSize(
  content: string,
  palette: PaletteColors
): { width: number; height: number } | null {
  const width = naturalDataChartWidth(content, palette);
  if (width === null) return null;
  return {
    width,
    height: Math.round((width * EXPORT_HEIGHT) / EXPORT_WIDTH),
  };
}

function naturalDataChartWidth(
  content: string,
  palette: PaletteColors
): number | null {
  const ext = parseExtendedChart(content, palette);
  if (ext && !ext.error) {
    switch (ext.type) {
      case 'heatmap': {
        const cols = ext.columns?.length ?? 0;
        if (cols === 0) return UNCOUNTED_WIDTH;
        return clamp(AXIS_FURNITURE + cols * STEP_PER_HEATMAP_COLUMN);
      }
      case 'sankey':
      case 'chord': {
        const links = ext.links ?? [];
        if (ext.type === 'chord' || links.length === 0) return UNCOUNTED_WIDTH;
        return clamp(sankeyDepth(links) * STEP_PER_SANKEY_DEPTH);
      }
      case 'funnel':
      case 'scatter':
      case 'function':
        return UNCOUNTED_WIDTH;
    }
  }

  const std = parseChart(content, palette);
  if (!std || std.error || std.data.length === 0) return null;
  switch (std.type) {
    case 'pie':
    case 'radar':
    case 'polar-area':
      return UNCOUNTED_WIDTH;
    case 'bar': {
      // Horizontal bars run DOWN the canvas, so the category count drives the
      // height, not the width.
      if (std.orientation === 'horizontal') return UNCOUNTED_WIDTH;
      const series = Math.max(1, std.seriesNames?.length ?? 1);
      const grouped = std.barLayout === 'group' ? series : 1;
      const step = Math.max(
        STEP_PER_CATEGORY,
        grouped * STEP_PER_SERIES_IN_GROUP
      );
      return clamp(AXIS_FURNITURE + std.data.length * step);
    }
    case 'line':
      return clamp(AXIS_FURNITURE + std.data.length * STEP_PER_LINE_POINT);
    default:
      return null;
  }
}
