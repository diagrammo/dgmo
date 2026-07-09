// ============================================================
// Hand-built scatter / bubble renderer — SPIKE (Tier 2).
// Auto-fit axes (10% pad), per-point or per-category color, bubble sizing,
// point labels. (Spike uses simple above-point labels, not the full ECharts
// greedy collision graphic.)
// ============================================================

import { scaleLinear, scaleSqrt } from 'd3-scale';
import {
  computeQuadrantPointLabels,
  rectsOverlap,
  rectCircleOverlap,
  type LabelRect,
  type PointCircle,
} from '../label-layout';
import { measureText } from '../utils/text-measure';
import type { ParsedScatter } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  tagDatum,
} from './shared';

const FILL_OPACITY = 0.65;
const DEFAULT_SIZE = 15; // diameter
const LABEL_FONT = 11;
// Must match the adapter's hover point-value styling: a big bold number line
// nearest the bubble, the small label line stacked beyond it.
const SIZEVAL_FONT = 20;
const SIZEVAL_LINE = SIZEVAL_FONT + 4;
const SIZEVAL_LABEL_FONT = 11;
const SIZEVAL_LABEL_LINE = SIZEVAL_LABEL_FONT + 4;
const SIZEVAL_BOLD_FACTOR = 1.08;

/**
 * Place the two-line hover size-value block (number + label) for one point so
 * it avoids the static name labels, the other bubbles, and the plot bounds.
 * Tries below / above / right / left at expanding offsets; falls back to
 * just-below when everything collides. The number line always sits nearest the
 * bubble, the label line beyond it. Returned x/y/labelY are SVG text attrs
 * (alphabetic baselines). Exported for tests.
 */
export function placeScatterHoverValue(
  cx: number,
  cy: number,
  r: number,
  labelText: string,
  valueText: string,
  labelRects: LabelRect[],
  circles: PointCircle[],
  bounds: { left: number; top: number; right: number; bottom: number }
): {
  x: number;
  y: number;
  labelY: number;
  anchor: 'middle' | 'start' | 'end';
  rect: LabelRect;
} {
  const w =
    Math.max(
      measureText(valueText, SIZEVAL_FONT) * SIZEVAL_BOLD_FACTOR,
      measureText(labelText, SIZEVAL_LABEL_FONT)
    ) + 6;
  const h = SIZEVAL_LINE + SIZEVAL_LABEL_LINE;
  const gap = 8;
  // numberFirst: number line at the top of the block (block sits below the
  // bubble / beside it); false: label on top, number at the bottom, nearest
  // the bubble (block sits above).
  const toResult = (
    rect: LabelRect,
    anchor: 'middle' | 'start' | 'end',
    numberFirst: boolean
  ) => {
    const numY = numberFirst ? rect.y + SIZEVAL_LINE - 6 : rect.y + h - 6;
    const lblY = numberFirst ? rect.y + h - 4 : rect.y + SIZEVAL_LABEL_LINE - 4;
    return {
      x:
        anchor === 'middle'
          ? cx
          : anchor === 'start'
            ? rect.x
            : rect.x + rect.w,
      y: numY,
      labelY: lblY,
      anchor,
      rect,
    };
  };
  const gens: Array<
    (off: number) => {
      rect: LabelRect;
      anchor: 'middle' | 'start' | 'end';
      numberFirst: boolean;
    }
  > = [
    (off) => ({
      rect: { x: cx - w / 2, y: cy + r + off, w, h },
      anchor: 'middle',
      numberFirst: true,
    }),
    (off) => ({
      rect: { x: cx - w / 2, y: cy - r - off - h, w, h },
      anchor: 'middle',
      numberFirst: false,
    }),
    (off) => ({
      rect: { x: cx + r + off, y: cy - h / 2, w, h },
      anchor: 'start',
      numberFirst: true,
    }),
    (off) => ({
      rect: { x: cx - r - off - w, y: cy - h / 2, w, h },
      anchor: 'end',
      numberFirst: true,
    }),
  ];
  for (let off = gap; off <= gap + 96; off += 12) {
    for (const gen of gens) {
      const { rect, anchor, numberFirst } = gen(off);
      if (
        rect.x < bounds.left ||
        rect.x + rect.w > bounds.right ||
        rect.y < bounds.top ||
        rect.y + rect.h > bounds.bottom
      )
        continue;
      if (labelRects.some((lr) => rectsOverlap(rect, lr))) continue;
      if (circles.some((c) => rectCircleOverlap(rect, c))) continue;
      return toResult(rect, anchor, numberFirst);
    }
  }
  return toResult({ x: cx - w / 2, y: cy + r + gap, w, h }, 'middle', true);
}

export function renderScatter(
  svg: Svg,
  chart: ParsedScatter,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  topInset: number
): void {
  const points = chart.scatterPoints ?? [];
  if (points.length === 0) return;
  const solid = chart.solidFill === true;
  const hasSize = points.some((p) => p.size !== undefined);

  const categories = [
    ...new Set(points.map((p) => p.category).filter(Boolean)),
  ] as string[];
  const catColor = (cat: string, i: number) =>
    chart.categoryColors?.[cat] ?? colors[i % colors.length]!;
  const catIndex = new Map(categories.map((c, i) => [c, i]));

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;

  const m: Margins = {
    top: topInset + 8,
    right: 32,
    bottom: 64,
    left: computeLeftMargin(chart.ylabel, [
      fmtNum(Math.ceil(yMax + yPad)),
      fmtNum(Math.floor(yMin - yPad)),
    ]),
  };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  // Bubble radii: area-proportional (scaleSqrt, true-zero domain) mapped into a
  // plot-relative pixel budget so the biggest bubble can always fit. Raw size/2
  // pixels blew out the pane (a size of 510 → r=255px, larger than the plot).
  // Plain scatter (no size declared) keeps the fixed DEFAULT_SIZE dot.
  const sizes = points.map((p) =>
    hasSize ? (p.size ?? DEFAULT_SIZE) : DEFAULT_SIZE
  );
  const rBudget = Math.max(12, Math.min(plotW, plotH) * 0.14);
  const rScale = scaleSqrt()
    .domain([0, Math.max(...sizes) || 1])
    .range([0, rBudget]);
  const radii = points.map((_, i) =>
    hasSize ? Math.max(5, rScale(sizes[i]!)) : DEFAULT_SIZE / 2
  );
  // Inset the data range by the largest bubble radius so no bubble edge clips
  // the pane, whichever point sits at an axis extreme.
  const rInset = Math.max(...radii) + 4;

  const x = scaleLinear()
    .domain([Math.floor(xMin - xPad), Math.ceil(xMax + xPad)])
    .range([m.left + rInset, m.left + plotW - rInset]);
  const y = scaleLinear()
    .domain([Math.floor(yMin - yPad), Math.ceil(yMax + yPad)])
    .range([m.top + plotH - rInset, m.top + rInset]);

  // Hit/bounds target so the interaction adapter knows axis positions for the
  // dotted leader-line + on-axis value projection.
  svg
    .append('rect')
    .attr('class', 'dgmo-plot-rect')
    .attr('x', m.left)
    .attr('y', m.top)
    .attr('width', plotW)
    .attr('height', plotH)
    .attr('fill', 'transparent')
    .attr('pointer-events', 'none');

  // gridlines + ticks
  for (const t of y.ticks(6)) {
    const yy = y(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.25);
    svg
      .append('text')
      .attr('class', 'dgmo-tick')
      .attr('x', m.left - 10)
      .attr('y', yy + 4)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(t));
  }
  for (const t of x.ticks(6)) {
    const xx = x(t);
    svg
      .append('line')
      .attr('x1', xx)
      .attr('x2', xx)
      .attr('y1', m.top)
      .attr('y2', m.top + plotH)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.25);
    svg
      .append('text')
      .attr('class', 'dgmo-tick')
      .attr('x', xx)
      .attr('y', m.top + plotH + 18)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(t));
  }

  // Greedy collision-avoiding label placement (above/below/left/right + leader
  // line when pushed) — replaces the spike's naive above-point labels.
  const placedLabels = chart.noName
    ? null
    : computeQuadrantPointLabels(
        points.map((p, i) => ({
          label: p.name,
          cx: x(p.x),
          cy: y(p.y),
          r: radii[i]!,
        })),
        {
          left: m.left,
          top: m.top,
          right: m.left + plotW,
          bottom: m.top + plotH,
        },
        [],
        DEFAULT_SIZE / 2,
        LABEL_FONT
      );

  const plotBounds = {
    left: m.left,
    top: m.top,
    right: m.left + plotW,
    bottom: m.top + plotH,
  };
  // A point's own name label stays unfaded during hover, so the size block
  // must clear it (everything else dims and may be overlapped).
  const ownLabelRect = (i: number): LabelRect[] => {
    const pl = placedLabels?.[i];
    if (!pl) return [];
    const w = measureText(points[i]!.name, LABEL_FONT) + 8;
    const h = LABEL_FONT + 4;
    const lx =
      pl.anchor === 'middle'
        ? pl.x - w / 2
        : pl.anchor === 'end'
          ? pl.x - w
          : pl.x;
    return [{ x: lx, y: pl.y - h / 2, w, h }];
  };

  // points
  points.forEach((p, i) => {
    const stroke =
      p.color ??
      (p.category
        ? catColor(p.category, catIndex.get(p.category) ?? 0)
        : colors[i % colors.length]!);
    const r = radii[i]!;
    const dot = svg
      .append('circle')
      .attr('cx', x(p.x))
      .attr('cy', y(p.y))
      .attr('r', r)
      .attr('fill', solid ? stroke : shapeFill(palette, stroke, isDark))
      .attr('fill-opacity', FILL_OPACITY)
      .attr('stroke', stroke)
      .attr('stroke-width', 2);
    tagDatum(dot, {
      line: p.lineNumber,
      key: p.name,
      name: p.category ? `${p.name} · ${p.category}` : p.name,
      value:
        p.size !== undefined
          ? `(${fmtNum(p.x)}, ${fmtNum(p.y)}) · ${chart.sizelabel ?? 'size'}: ${fmtNum(p.size)}`
          : `(${fmtNum(p.x)}, ${fmtNum(p.y)})`,
      color: stroke,
    });
    // Per-axis values for the adapter's on-axis projection (no tooltip).
    dot.attr('data-axval-x', fmtNum(p.x)).attr('data-axval-y', fmtNum(p.y));
    // Size has no axis to project onto — the adapter prints it next to the
    // hovered point instead, labeled by `size-label` when declared.
    if (p.size !== undefined) {
      const sizeLabel = chart.sizelabel ?? 'size';
      // Tight to the bubble on purpose — everything else fades during hover,
      // so the block may sit over dimmed marks. Only the point's own name
      // label (unfaded) and plot bounds constrain it.
      const pos = placeScatterHoverValue(
        x(p.x),
        y(p.y),
        r,
        sizeLabel,
        fmtNum(p.size),
        ownLabelRect(i),
        [],
        plotBounds
      );
      dot
        .attr('data-size', fmtNum(p.size))
        .attr('data-size-label', sizeLabel)
        .attr('data-sizeval-x', pos.x)
        .attr('data-sizeval-y', pos.y)
        .attr('data-sizeval-ly', pos.labelY)
        .attr('data-sizeval-anchor', pos.anchor);
    }
    // Category key for cross-highlight (hover a point → dim other categories).
    // `data-category` drives the baked-CSS path; `data-series-name` (mirrors the
    // legend entry) lets the live JS adapter treat categories as series so
    // legend-hover dims the other groups. Only when a category is declared.
    if (p.category) {
      dot.attr('data-category', p.category);
      dot.attr('data-series-name', p.category);
    }
    if (placedLabels) {
      // Same length as points by construction.
      const placed = placedLabels[i]!;
      // `dgmo-ptlabel` + line number let the interaction adapter fade every
      // other point's label while one bubble is hovered.
      if (placed.connectorLine) {
        svg
          .append('line')
          .attr('class', 'dgmo-ptlabel')
          .attr('data-line-number', p.lineNumber)
          .attr('x1', placed.connectorLine.x1)
          .attr('y1', placed.connectorLine.y1)
          .attr('x2', placed.connectorLine.x2)
          .attr('y2', placed.connectorLine.y2)
          .attr('stroke', stroke)
          .attr('stroke-width', 1)
          .attr('opacity', 0.5);
      }
      svg
        .append('text')
        .attr('class', 'dgmo-ptlabel')
        .attr('data-line-number', p.lineNumber)
        .attr('x', placed.x)
        .attr('y', placed.y)
        .attr('text-anchor', placed.anchor)
        .attr('dominant-baseline', 'central')
        .attr('fill', stroke)
        .attr('font-size', LABEL_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(p.name);
    }
  });

  drawXAxisTitle(
    svg,
    chart.xlabel,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor
  );
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}
