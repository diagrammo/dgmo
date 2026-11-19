// ============================================================
// Box plot renderer (#1848)
// ============================================================
//
// One Tukey box per group: Q1–Q3 as a translucent box with an outline, the
// median as a thicker line, whiskers to the last value within 1.5 × IQR,
// and every value beyond as a hollow dot. `points` draws every value as a
// dot beside its box, spread sideways by a hash (never random), `mean` a
// hollow diamond, `orientation-horizontal` lays the groups down the left.
// Every box takes one colour unless its header names one (#1829). `n` is
// always printed under the group name.

import type { ParsedBoxplot } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { shapeFill, themeBaseBg } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { tabularText, measureTabular } from '../utils/tabular-figures';
import { measureText, truncateText } from '../utils/text-measure';
import { type BoxSummary, boxSummary } from '../stats/quartiles';
import { scaleLinear } from 'd3-scale';
import { buildValueAxis } from './value-axis';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  TICK_INK_ABOVE,
  bandSafeTop,
  topTickFraction,
  chartFormatter,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  tagDatum,
} from './shared';

/** One group's box, ready to scale. */
export interface BoxplotSeries {
  /** '' for the unnamed group. */
  readonly name: string;
  readonly color: string;
  readonly lineNumber: number;
  readonly values: readonly number[];
  readonly valueLines: readonly number[];
  readonly box: BoxSummary;
}

/** Summarize every group. Pure: the parse result in, the boxes out. */
export function layoutBoxplot(
  chart: ParsedBoxplot,
  fallback: string
): BoxplotSeries[] {
  const out: BoxplotSeries[] = [];
  for (const g of chart.boxplotGroups ?? []) {
    const box = boxSummary(g.values);
    if (!box) continue;
    out.push({
      name: g.name,
      color: g.color ?? fallback,
      lineNumber: g.lineNumber,
      values: g.values,
      valueLines: g.valueLines,
      box,
    });
  }
  return out;
}

/**
 * A fixed sideways offset in [-1, 1] for one point, from a hash of its
 * group, index and value (FNV-1a). Same source, same picture.
 */
export function pointJitter(
  group: string,
  index: number,
  value: number
): number {
  const key = `${group}\u0000${index}\u0000${value}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Widest a box is drawn, px. */
const MAX_BOX = 72;
/** Gap between the two label lines under a box, px. */
const LABEL_LINE = 16;
const OUTLIER_R = 3;
const POINT_R = 2.25;
const MEAN_HALF = 5;
/** About this many value ticks. */
const TICK_COUNT = 6;

export function renderBoxplot(
  svg: Svg,
  chart: ParsedBoxplot,
  width: number,
  height: number,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  topInset: number
): void {
  const series = layoutBoxplot(chart, palette.primary);
  if (series.length === 0) return;
  const horizontal = !!chart.horizontal;
  const all = series.flatMap((s) => s.values);
  const fmt = chartFormatter(chart, all);
  const dataLo = Math.min(...all);
  const dataHi = Math.max(...all);
  const pad = dataHi > dataLo ? (dataHi - dataLo) * 0.05 : 1;
  // Round the ends to the drawn tick stride, so the top tick sits on the
  // plot's top edge.
  const [lo, hi] = scaleLinear()
    .domain([dataLo - pad, dataHi + pad])
    .nice(TICK_COUNT)
    .domain() as [number, number];
  const ySpec = chart.axes?.y;
  const valueAxis = (range: [number, number]) =>
    buildValueAxis(lo, hi, ySpec, range, {
      nice: false,
      dataLo: Math.min(...all.filter((v) => v > 0), dataHi > 0 ? dataHi : 1),
      dataHi,
    });
  const probe = valueAxis([0, 1]);
  const probeTicks = probe.ticks(TICK_COUNT).map(fmt);
  const nLabel = (s: BoxplotSeries) => `n = ${s.box.n.toLocaleString('en-US')}`;
  const named = series.some((s) => s.name);

  // Margins: the group labels sit beside (horizontal) or under the boxes.
  let m: Margins;
  if (horizontal) {
    const labelW = Math.max(
      ...series.map((s) =>
        Math.max(
          measureText(s.name, TICK_FONT),
          measureTabular(nLabel(s), TICK_FONT)
        )
      )
    );
    m = {
      top: topInset + 8,
      right: 32,
      bottom: chart.ylabel ? 64 : 40,
      left: Math.min(width * 0.35, labelW + 24) + (chart.xlabel ? 22 : 0),
    };
  } else {
    m = {
      top: topInset + 8,
      right: 32,
      bottom: (named ? 2 : 1) * LABEL_LINE + 18 + (chart.xlabel ? 34 : 0),
      left: computeLeftMargin(chart.ylabel, probeTicks, { tabular: true }),
    };
    // The top tick label stands over its gridline; keep it on the band
    // (#2111).
    m.top = bandSafeTop(m.top, height - m.bottom, [
      [topTickFraction(probe, probe.ticks(TICK_COUNT)), TICK_INK_ABOVE],
    ]);
  }
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = Math.max(10, height - m.top - m.bottom);
  const v = horizontal
    ? valueAxis([m.left, m.left + plotW])
    : valueAxis([m.top + plotH, m.top]);
  const groupSpan = horizontal ? plotH : plotW;
  const slot = groupSpan / series.length;
  const groupCenter = (i: number) =>
    (horizontal ? m.top : m.left) + slot * (i + 0.5);
  /** (group-axis px, value-axis px) → [x, y]. */
  const at = (g: number, val: number): [number, number] =>
    horizontal ? [val, g] : [g, val];

  // Value gridlines and ticks.
  for (const t of v.ticks(TICK_COUNT)) {
    const p = v(t);
    const [x1, y1] = at(horizontal ? m.top : m.left, p);
    const [x2, y2] = at(horizontal ? m.top + plotH : m.left + plotW, p);
    svg
      .append('line')
      .attr('x1', x1)
      .attr('x2', x2)
      .attr('y1', y1)
      .attr('y2', y2)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.25);
    const label = svg
      .append('text')
      .attr('class', 'dgmo-tick')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY);
    if (horizontal)
      label
        .attr('x', p)
        .attr('y', m.top + plotH + 18)
        .attr('text-anchor', 'middle');
    else
      label
        .attr('x', m.left - 10)
        .attr('y', p + 4)
        .attr('text-anchor', 'end');
    label.call(tabularText(fmt(t), TICK_FONT));
  }

  // Box thickness across the group axis. With `points`, the box moves to
  // one side of its slot and the dots take the other.
  const points = !!chart.points;
  const boxW = Math.max(6, Math.min(MAX_BOX, slot * (points ? 0.32 : 0.5)));
  const boxOffset = points ? -boxW * 0.65 : 0;
  const stripOffset = boxW * 0.65;
  const stripHalf = boxW * 0.4;
  const bg = themeBaseBg(palette, isDark);
  const [d0, d1] = v.domain();
  const inDomain = (val: number) =>
    val >= Math.min(d0, d1) && val <= Math.max(d0, d1);

  series.forEach((s, i) => {
    const c = groupCenter(i);
    const bc = c + boxOffset;
    const b = s.box;
    const g = svg
      .append('g')
      .attr('class', 'dgmo-series dgmo-boxplot-group')
      .attr('data-series-name', s.name || null)
      .attr('data-line-number', s.lineNumber);
    const line = (
      ga: number,
      va: number,
      gb: number,
      vb: number,
      w: number
    ) => {
      const [x1, y1] = at(ga, va);
      const [x2, y2] = at(gb, vb);
      return g
        .append('line')
        .attr('x1', x1)
        .attr('y1', y1)
        .attr('x2', x2)
        .attr('y2', y2)
        .attr('stroke', s.color)
        .attr('stroke-width', w);
    };

    // Whiskers and their caps.
    const cap = boxW * 0.45;
    line(bc, v(b.whiskerLo), bc, v(b.q1), 1.5).attr(
      'class',
      'dgmo-boxplot-whisker'
    );
    line(bc, v(b.q3), bc, v(b.whiskerHi), 1.5).attr(
      'class',
      'dgmo-boxplot-whisker'
    );
    line(bc - cap / 2, v(b.whiskerLo), bc + cap / 2, v(b.whiskerLo), 1.5);
    line(bc - cap / 2, v(b.whiskerHi), bc + cap / 2, v(b.whiskerHi), 1.5);

    // The box, Q1 to Q3.
    const [bx1, by1] = at(bc - boxW / 2, v(b.q1));
    const [bx2, by2] = at(bc + boxW / 2, v(b.q3));
    const rect = g
      .append('rect')
      .attr('class', 'dgmo-boxplot-box')
      .attr('x', Math.min(bx1, bx2))
      .attr('y', Math.min(by1, by2))
      .attr('width', Math.abs(bx2 - bx1))
      .attr('height', Math.max(1, Math.abs(by2 - by1)))
      .attr(
        'fill',
        shapeFill(palette, s.color, isDark, { mode: chart.fillMode })
      )
      .attr('stroke', s.color)
      .attr('stroke-width', 1.5);
    tagDatum(rect, {
      line: s.lineNumber,
      key: s.name || 'values',
      name: s.name || 'Values',
      value: `median ${fmt(b.median)} · Q1 ${fmt(b.q1)} · Q3 ${fmt(b.q3)} · ${nLabel(s)}`,
      color: s.color,
      seriesName: s.name || undefined,
    });

    // The median, thicker than the outline.
    const medStroke = chart.fillMode === 'solid' ? bg : s.color;
    line(bc - boxW / 2, v(b.median), bc + boxW / 2, v(b.median), 3)
      .attr('class', 'dgmo-boxplot-median')
      .attr('stroke', medStroke);

    // Outliers, hollow. With `points` on, every value is drawn as a dot
    // beside the box instead, so the outliers are not drawn twice.
    if (!points) {
      for (const o of b.outliers) {
        if (!inDomain(o)) continue;
        const [x, y] = at(bc, v(o));
        const dot = g
          .append('circle')
          .attr('class', 'dgmo-boxplot-outlier')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', OUTLIER_R)
          .attr('fill', bg)
          .attr('stroke', s.color)
          .attr('stroke-width', 1.25);
        const idx = s.values.indexOf(o);
        tagDatum(dot, {
          line: s.valueLines[idx] ?? s.lineNumber,
          key: s.name || 'values',
          name: `${s.name ? `${s.name} ` : ''}outlier`,
          value: fmt(o),
          color: s.color,
          seriesName: s.name || undefined,
        });
      }
    } else {
      s.values.forEach((val, k) => {
        if (!inDomain(val)) return;
        const outlier = val < b.whiskerLo || val > b.whiskerHi;
        const [x, y] = at(
          c + stripOffset + pointJitter(s.name, k, val) * stripHalf,
          v(val)
        );
        g.append('circle')
          .attr(
            'class',
            `dgmo-boxplot-point${outlier ? ' dgmo-boxplot-outlier' : ''}`
          )
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', outlier ? OUTLIER_R : POINT_R)
          .attr('fill', outlier ? bg : s.color)
          .attr('fill-opacity', outlier ? 1 : 0.55)
          .attr('stroke', s.color)
          .attr('stroke-width', outlier ? 1.25 : 0)
          .attr('data-line-number', s.valueLines[k] ?? s.lineNumber);
      });
    }

    // The mean, a hollow diamond.
    if (chart.showMean && inDomain(b.mean)) {
      const [x, y] = at(bc, v(b.mean));
      const diamond = g
        .append('path')
        .attr('class', 'dgmo-boxplot-mean')
        .attr(
          'd',
          `M${x},${y - MEAN_HALF}L${x + MEAN_HALF},${y}L${x},${y + MEAN_HALF}L${x - MEAN_HALF},${y}Z`
        )
        .attr('fill', bg)
        .attr('stroke', s.color)
        .attr('stroke-width', 1.5);
      tagDatum(diamond, {
        line: s.lineNumber,
        key: s.name || 'values',
        name: `${s.name ? `${s.name} ` : ''}mean`,
        value: fmt(b.mean),
        color: s.color,
        seriesName: s.name || undefined,
      });
    }

    // Group name and n.
    const maxLabel = horizontal
      ? m.left - 12 - (chart.xlabel ? 22 : 0)
      : slot - 6;
    const name = truncateText(s.name, TICK_FONT, Math.max(0, maxLabel));
    const nText = nLabel(s);
    if (horizontal) {
      const lx = m.left - 10;
      const rows = s.name ? [name, nText] : [nText];
      const y0 = c - ((rows.length - 1) * LABEL_LINE) / 2 + 4;
      rows.forEach((t, r) => {
        const isN = r === rows.length - 1;
        const text = svg
          .append('text')
          .attr('class', isN ? 'dgmo-tick dgmo-boxplot-n' : 'dgmo-tick')
          .attr('x', lx)
          .attr('y', y0 + r * LABEL_LINE)
          .attr('text-anchor', 'end')
          .attr('fill', isN ? palette.textMuted : textColor)
          .attr('font-size', TICK_FONT)
          .attr('font-family', FONT_FAMILY)
          .attr('data-line-number', s.lineNumber);
        if (isN) text.call(tabularText(t, TICK_FONT));
        else text.text(t);
      });
    } else {
      const base = m.top + plotH + 18;
      if (s.name)
        svg
          .append('text')
          .attr('class', 'dgmo-tick')
          .attr('x', c)
          .attr('y', base)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', TICK_FONT)
          .attr('font-family', FONT_FAMILY)
          .attr('data-line-number', s.lineNumber)
          .text(name);
      svg
        .append('text')
        .attr('class', 'dgmo-tick dgmo-boxplot-n')
        .attr('x', c)
        .attr('y', base + (named ? LABEL_LINE : 0))
        .attr('text-anchor', 'middle')
        .attr('fill', palette.textMuted)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .attr('data-line-number', s.lineNumber)
        .call(tabularText(nText, TICK_FONT));
    }
  });

  // Axis titles: y names the values in either orientation, as on bar.
  if (horizontal) {
    drawXAxisTitle(
      svg,
      chart.ylabel,
      m.left + plotW / 2,
      m.top + plotH + 46,
      textColor
    );
    drawYAxisTitle(svg, chart.xlabel, m.top + plotH / 2, 20, textColor);
  } else {
    drawXAxisTitle(
      svg,
      chart.xlabel,
      m.left + plotW / 2,
      m.top + plotH + 18 + (named ? 2 : 1) * LABEL_LINE + 14,
      textColor
    );
    drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
  }
}
