// ============================================================
// Histogram renderer (#1847)
// ============================================================
//
// Raw values counted into shared bins, or pre-counted `lo-hi count` rows.
// One group draws tinted bars like a bar chart; several groups overlay as
// translucent fills, each with a stepped outline in its colour. Ticks sit on
// the bin edges. `mean` / `median` draw as vertical overlay lines.

import { scaleLinear } from 'd3-scale';
import type { ParsedHistogram } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { shapeFill, themeBaseBg } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { tabularText, measureTabular } from '../utils/tabular-figures';
import type { ValueAxisFrame } from '../annotations/draw';
import {
  drawOverlayLabels,
  drawOverlayLevels,
  type OverlayLevel,
} from '../overlays/draw';
import { mean, median, roundStat } from '../overlays/compute';
import {
  type Bin,
  binnedMean,
  binnedMedian,
  cleanEdge,
  countIntoBins,
  histogramEdges,
} from '../stats/binning';
import { buildValueAxis } from './value-axis';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  TICK_INK_ABOVE,
  bandSafeTop,
  topTickFraction,
  fmtNum,
  chartFormatter,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  tagDatum,
} from './shared';

/** One group's bars, ready to scale. */
export interface HistogramSeries {
  /** '' for the unnamed group. */
  readonly name: string;
  readonly color: string;
  readonly lineNumber: number;
  readonly bins: readonly Bin[];
  /** Bar height per bin: count, share, or count per unit width. */
  readonly heights: readonly number[];
  /** Mean and median of what was counted. */
  readonly mean: number;
  readonly median: number;
  /** Source line of each bin, for click-to-source. */
  readonly binLines: readonly number[];
}

export interface HistogramLayout {
  readonly series: HistogramSeries[];
  /** Every edge any bar has, ascending. */
  readonly edges: number[];
  /** The x domain: the edges' span, or the author's `x-axis` range. */
  readonly domain: [number, number];
  /** Set when pre-counted widths differ: heights are per this width. */
  readonly perWidth?: number;
  /** Values below `bin-start`, not counted. */
  readonly belowStart: number;
}

/**
 * Bin the chart. Pure: the parse result in, the bars out. Raw groups share
 * one set of edges; pre-counted groups keep their own ranges. Values outside
 * an author's `x-axis` range are not counted.
 */
export function layoutHistogram(
  chart: ParsedHistogram,
  colors: readonly string[],
  fallback: string
): HistogramLayout {
  const groups = chart.histogramGroups ?? [];
  const xs = chart.axes?.x;
  const inX = (v: number) =>
    (xs?.min === undefined || v >= xs.min) &&
    (xs?.max === undefined || v <= xs.max);
  const colorOf = (i: number) => {
    const g = groups[i]!;
    if (g.color) return g.color;
    if (groups.length === 1) return fallback;
    return colors[i % colors.length]!;
  };
  const counted = groups.some((g) => g.ranges.length > 0);

  let binsPer: Bin[][];
  let lines: number[][];
  let belowStart = 0;
  if (counted) {
    binsPer = groups.map((g) =>
      g.ranges
        .filter((r) => inX(r.x0) || inX(r.x1))
        .map((r) => ({ x0: r.x0, x1: r.x1, count: r.count }))
    );
    lines = groups.map((g) =>
      g.ranges.filter((r) => inX(r.x0) || inX(r.x1)).map((r) => r.lineNumber)
    );
  } else {
    const kept = groups.map((g) => g.values.filter(inX));
    const rule = chart.histogramBins ?? {};
    const { edges } = histogramEdges(kept.flat(), {
      ...(rule.width !== undefined && { width: rule.width }),
      ...(rule.count !== undefined && { count: rule.count }),
      ...(rule.start !== undefined && { start: rule.start }),
    });
    if (rule.start !== undefined)
      belowStart = kept.flat().filter((v) => v < rule.start!).length;
    binsPer = kept.map((vals) =>
      edges.length > 1 ? countIntoBins(vals, edges) : []
    );
    lines = groups.map((g, i) => binsPer[i]!.map(() => g.lineNumber));
  }

  const widths = binsPer.flat().map((b) => cleanEdge(b.x1 - b.x0));
  const unequal =
    counted && widths.some((w) => Math.abs(w - widths[0]!) > 1e-9);
  const perWidth = unequal ? Math.min(...widths) : undefined;

  const series: HistogramSeries[] = groups.map((g, i) => {
    const bins = binsPer[i]!;
    const total = bins.reduce((s, b) => s + b.count, 0);
    const heights = bins.map((b) => {
      let h = b.count;
      if (chart.percent) h = total > 0 ? (h / total) * 100 : 0;
      if (perWidth !== undefined) h = (h / (b.x1 - b.x0)) * perWidth;
      return h;
    });
    const vals = counted ? [] : g.values.filter(inX);
    return {
      name: g.name,
      color: colorOf(i),
      lineNumber: g.lineNumber,
      bins,
      heights,
      mean: counted ? binnedMean(bins) : mean(vals),
      median: counted ? binnedMedian(bins) : median(vals),
      binLines: lines[i]!,
    };
  });

  const edgeSet = new Set<number>();
  for (const b of binsPer.flat()) {
    edgeSet.add(b.x0);
    edgeSet.add(b.x1);
  }
  const edges = [...edgeSet].sort((a, b) => a - b);
  const lo = xs?.min ?? edges[0] ?? 0;
  const hi = xs?.max ?? edges.at(-1) ?? 1;
  return {
    series,
    edges,
    domain: [lo, hi > lo ? hi : lo + 1],
    ...(perWidth !== undefined && { perWidth }),
    belowStart,
  };
}

/** Gap between two neighbouring tick labels. */
const TICK_GAP = 8;

/**
 * The edges to label: every edge when they fit, else every k-th, with the
 * first and last always shown. A stride label too close to the last edge
 * gives way to it.
 */
export function thinEdgeTicks(
  edges: readonly number[],
  px: (v: number) => number,
  label: (v: number) => string
): number[] {
  if (edges.length <= 2) return [...edges];
  const w = edges.map((e) => measureTabular(label(e), TICK_FONT));
  const fits = (picked: number[]) => {
    for (let i = 1; i < picked.length; i++) {
      const a = picked[i - 1]!;
      const b = picked[i]!;
      if (px(edges[b]!) - px(edges[a]!) < (w[a]! + w[b]!) / 2 + TICK_GAP)
        return false;
    }
    return true;
  };
  const last = edges.length - 1;
  for (let k = 1; k <= last; k++) {
    const picked: number[] = [];
    for (let i = 0; i < last; i += k) picked.push(i);
    // The last edge always shows; a stride tick crowding it drops.
    while (
      picked.length > 1 &&
      px(edges[last]!) - px(edges[picked.at(-1)!]!) <
        (w[last]! + w[picked.at(-1)!]!) / 2 + TICK_GAP
    )
      picked.pop();
    picked.push(last);
    if (fits(picked)) return picked.map((i) => edges[i]!);
  }
  return [edges[0]!, edges[last]!];
}

/** Opacity of an overlaid group's fill, by fill mode. */
function overlayOpacity(mode: ParsedHistogram['fillMode']): number {
  if (mode === 'solid') return 0.6;
  if (mode === 'outline') return 0;
  return 0.3;
}

export function renderHistogram(
  svg: Svg,
  chart: ParsedHistogram,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  topInset: number
): void {
  const layout = layoutHistogram(chart, colors, palette.primary);
  const series = layout.series.filter((s) => s.bins.length > 0);
  if (series.length === 0) return;
  const overlaid = series.length > 1;

  // x prints the values, so it takes the author's number format (#1831).
  const xFmt = chartFormatter(chart, layout.edges);
  const maxH = Math.max(0, ...series.flatMap((s) => s.heights));
  const ySpec = chart.axes?.y;
  const yAxis = (range: [number, number]) =>
    buildValueAxis(0, maxH > 0 ? maxH : 1, ySpec, range, {
      nice: true,
      dataLo: Math.min(
        ...series.flatMap((s) => s.heights.filter((h) => h > 0)),
        maxH > 0 ? maxH : 1
      ),
      dataHi: maxH,
    });
  const yTicks = yAxis([0, 1]).ticks(6);
  const yFmt = (v: number) => (chart.percent ? `${fmtNum(v)}%` : fmtNum(v));

  let ylabel = chart.ylabel;
  if (layout.perWidth !== undefined) {
    const base = ylabel ?? (chart.percent ? 'Percent' : 'Count');
    ylabel = `${base} per ${xFmt(layout.perWidth)}${chart.xlabel ? ` ${chart.xlabel}` : ''}`;
  }

  const m: Margins = {
    top: topInset + 8,
    right: 32,
    bottom: chart.xlabel ? 64 : 40,
    left: computeLeftMargin(ylabel, yTicks.map(yFmt), { tabular: true }),
  };
  // The top tick label stands over its gridline; keep it on the band (#2111).
  const probe = yAxis([0, 1]);
  m.top = Math.max(
    m.top,
    bandSafeTop(topInset + 8, height - m.bottom, [
      [topTickFraction(probe, probe.ticks(6)), TICK_INK_ABOVE],
    ])
  );
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = Math.max(10, height - m.top - m.bottom);
  const x = scaleLinear()
    .domain(layout.domain)
    .range([m.left, m.left + plotW])
    .clamp(true);
  const y = yAxis([m.top + plotH, m.top]);
  const base = y(y.baseline);

  // Value gridlines and ticks.
  for (const t of y.ticks(6)) {
    const yy = y(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === y.baseline ? 0.6 : 0.25);
    svg
      .append('text')
      .attr('class', 'dgmo-tick')
      .attr('x', m.left - 10)
      .attr('y', yy + 4)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .call(tabularText(yFmt(t), TICK_FONT));
  }

  // Overlay lines go down behind the bars (#1954).
  const frame: ValueAxisFrame = {
    pos: (v) => x(v),
    domain: layout.domain,
    left: m.left,
    top: m.top,
    width: plotW,
    height: plotH,
    horizontal: true,
  };
  const levels: OverlayLevel[] = [];
  for (const o of chart.overlays ?? []) {
    if (o.kind !== 'mean' && o.kind !== 'median') continue;
    for (const s of series) {
      const v = o.kind === 'mean' ? s.mean : s.median;
      if (!Number.isFinite(v)) continue;
      levels.push({
        kind: o.kind,
        value: v,
        label: `${overlaid && s.name ? `${s.name} ` : ''}${o.kind} ${xFmt(roundStat(v))}`,
        color: overlaid ? s.color : textColor,
        lineNumber: o.lineNumber,
      });
    }
  }
  const overlayLabels = drawOverlayLevels(svg, levels, frame);

  // Bars. A 1px gap between neighbours; bars are clipped to the domain.
  const [d0, d1] = layout.domain;
  const opacity = overlayOpacity(chart.fillMode);
  for (const s of series) {
    const g = svg
      .append('g')
      .attr('class', 'dgmo-series dgmo-histogram-group')
      .attr('data-series-name', s.name || null)
      .attr('data-line-number', s.lineNumber);
    const steps: string[] = [];
    s.bins.forEach((b, i) => {
      if (b.x1 <= d0 || b.x0 >= d1) return;
      const h = s.heights[i]!;
      const left = x(b.x0);
      const right = x(b.x1);
      const top = h > 0 ? y(h) : base;
      steps.push(`L${left},${top}L${right},${top}`);
      if (!(h > 0)) return;
      const rect = g
        .append('rect')
        .attr('x', left + 0.5)
        .attr('y', top)
        .attr('width', Math.max(0, right - left - 1))
        .attr('height', Math.max(0, base - top));
      // The baked legend hover pairs on this (hover-styles.ts).
      if (s.name) rect.attr('data-category', s.name);
      if (overlaid) {
        rect
          .attr('fill', s.color)
          .attr('fill-opacity', opacity)
          .attr('stroke', 'none');
      } else {
        rect
          .attr(
            'fill',
            shapeFill(palette, s.color, isDark, { mode: chart.fillMode })
          )
          .attr('stroke', s.color)
          .attr('stroke-width', 1);
      }
      tagDatum(rect, {
        line: s.binLines[i] ?? s.lineNumber,
        key: s.name || `${b.x0}`,
        name: `${xFmt(b.x0)}–${xFmt(b.x1)}`,
        value: chart.percent
          ? `${fmtNum(roundStat(h))}%`
          : b.count.toLocaleString('en-US'),
        color: s.color,
        seriesName: s.name || undefined,
      });
    });
    // Overlaid groups: a stepped outline so each shape reads through the
    // others' fills.
    if (overlaid && steps.length) {
      const first = s.bins.find((b) => !(b.x1 <= d0 || b.x0 >= d1))!;
      const last = [...s.bins]
        .reverse()
        .find((b) => !(b.x1 <= d0 || b.x0 >= d1))!;
      g.append('path')
        .attr('class', 'dgmo-histogram-outline')
        .attr(
          'd',
          `M${x(first.x0)},${base}${steps.join('')}L${x(last.x1)},${base}`
        )
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 1.5)
        .attr('stroke-linejoin', 'miter');
    }
  }

  // Baseline over the bars' feet.
  svg
    .append('line')
    .attr('x1', m.left)
    .attr('x2', m.left + plotW)
    .attr('y1', base)
    .attr('y2', base)
    .attr('stroke', mutedColor)
    .attr('stroke-opacity', 0.6);

  // x ticks on the bin edges, thinned when crowded.
  const inDomain = layout.edges.filter((e) => e >= d0 - 1e-9 && e <= d1 + 1e-9);
  const tickEdges = [
    ...new Set([
      ...(chart.axes?.x?.min !== undefined ? [d0] : []),
      ...inDomain,
      ...(chart.axes?.x?.max !== undefined ? [d1] : []),
    ]),
  ].sort((a, b) => a - b);
  for (const t of thinEdgeTicks(tickEdges, (v) => x(v), xFmt)) {
    const xx = x(t);
    svg
      .append('line')
      .attr('x1', xx)
      .attr('x2', xx)
      .attr('y1', base)
      .attr('y2', base + 4)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.6);
    svg
      .append('text')
      .attr('class', 'dgmo-tick')
      .attr('x', xx)
      .attr('y', m.top + plotH + 18)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .call(tabularText(xFmt(t), TICK_FONT));
  }

  drawOverlayLabels(svg, overlayLabels, frame, themeBaseBg(palette, isDark));

  drawXAxisTitle(
    svg,
    chart.xlabel,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor
  );
  drawYAxisTitle(svg, ylabel, m.top, plotH, 20, textColor);
}
