// ============================================================
// Hand-built bar renderer.
// Handles: single-series bar, multi-series `stack` (stacked) and `group`
// (clustered side-by-side) layouts (chart.barLayout), horizontal orientation.
// Matches the house style: 25% tint fill + full-strength border, per-category
// colors for single series, value labels, 0-baseline.
// Signed values: the domain is [min(0, dataMin), max(0, dataMax)] and bars
// grow from the 0 baseline in either direction (diverging); stacks accumulate
// positive and negative runs separately.
// ============================================================

import { scaleBand, scaleLinear } from 'd3-scale';
import { max as d3max, min as d3min } from 'd3-array';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import { fitLabel } from '../utils/fit-label';
import { measureText } from '../utils/text-measure';
import { createLabelPlacement, type LabelRect } from '../label-layout';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  resolveEmphasis,
} from '../utils/emphasis';
import {
  type Svg,
  type Margins,
  type InlineTitleInfo,
  TICK_FONT,
  VALUE_FONT,
  fmtNum,
  reserveHeader,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  drawValueLabel,
  tagDatum,
  planCategoryLabels,
  planLabelsFitLeft,
  drawCategoryLabels,
  NEVER_THIN_MAX,
} from './shared';

// Long category names must not size the chart (#1422). Their region is capped
// at a share of the canvas: rotated names below vertical bars by height, the
// name column beside horizontal bars by width. Rotated names also give way
// while the plot would be under PLOT_MIN_SHARE of the height. Names in the
// column wrap first (#1828); only what still does not fit ends in `…`, and
// keeps its full text as a hover title.
const LABEL_REGION_SHARE = 0.35;
const PLOT_MIN_SHARE = 0.6;
/** A vertical bar axis this short flips horizontal rather than rotate (#1828). */
const FLIP_MAX_CATEGORIES = NEVER_THIN_MAX;
/** Most lines one horizontal-bar name may wrap to before it ends in `…`. */
const NAME_MAX_LINES = 3;
/** Baseline-to-baseline distance of a wrapped name's lines. */
const NAME_LINE_PX = Math.round(TICK_FONT * 1.2);

function seriesValues(
  pt: { value: number; extraValues?: number[] },
  seriesCount: number
): number[] {
  const out = [pt.value];
  for (let s = 1; s < seriesCount; s++) out.push(pt.extraValues?.[s - 1] ?? 0);
  return out;
}

export function renderBar(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  hasTitle: boolean,
  inlineTitle?: InlineTitleInfo
): void {
  const data = chart.data;
  const seriesNames = chart.seriesNames?.length
    ? chart.seriesNames
    : [chart.series ?? ''];
  const stacked = chart.barLayout === 'stack';
  const grouped = chart.barLayout === 'group';
  // A `stack` or `group` block header makes it multi-series; plain `bar` (no
  // layout header) is single-series. `stack` sums into one bar; `group` draws
  // the series side by side via the `inner` band below.
  const seriesCount =
    stacked || grouped
      ? Math.max(
          1,
          seriesNames.length,
          1 + Math.max(0, ...data.map((d) => d.extraValues?.length ?? 0))
        )
      : 1;
  const authoredHorizontal = chart.orientation === 'horizontal';
  const multiSeries = seriesCount > 1;
  const fillMode = chart.fillMode;

  // Multi series → color by series index. Single series → ONE hue, because a
  // hue per category encodes nothing (#1829): the palette's primary, and its
  // red for a negative bar, the diverging hue. An author's color — on the row,
  // the chart's `color`, or the lone series' — still wins.
  const colorFor = (seriesIdx: number, value: number, override?: string) => {
    if (override) return override;
    if (multiSeries)
      return (
        chart.seriesNameColors?.[seriesIdx] ??
        colors[seriesIdx % colors.length]!
      );
    const authored = chart.color ?? chart.seriesNameColors?.[0];
    if (authored) return authored;
    return value < 0 ? palette.colors.red : palette.primary;
  };
  const fillOf = (c: string) =>
    shapeFill(palette, c, isDark, { mode: fillMode });

  // §1.11 emphasis (#1829): `highlight` names categories or, on a multi-series
  // bar, series. A segment stays at full strength when its category or its
  // series is named; every other segment and its value label recede.
  const { dimmed } = resolveEmphasis(chart.emphasis, [
    ...data.map((d) => d.label),
    ...(multiSeries ? seriesNames : []),
  ]);
  const recedes = (category: string, series: string) =>
    dimmed.has(category) && (!multiSeries || dimmed.has(series));

  const top = reserveHeader(
    svg,
    chart,
    colors,
    palette,
    isDark,
    hasTitle,
    width,
    inlineTitle
  );

  const perCat = data.map((d) => seriesValues(d, seriesCount));
  // Stacked bars accumulate positive and negative values into separate runs,
  // so the extents are the per-category positive sum and negative sum.
  const maxVal = stacked
    ? (d3max(perCat, (vals) =>
        vals.filter((v) => v > 0).reduce((a, b) => a + b, 0)
      ) ?? 0)
    : (d3max(perCat, (vals) => d3max(vals) ?? 0) ?? 0);
  const minVal = stacked
    ? (d3min(perCat, (vals) =>
        vals.filter((v) => v < 0).reduce((a, b) => a + b, 0)
      ) ?? 0)
    : (d3min(perCat, (vals) => d3min(vals) ?? 0) ?? 0);
  // Domain always includes 0 (bars encode magnitude from a 0 baseline); with
  // negative data it extends below so bars grow either direction from 0.
  const hiVal = Math.max(0, maxVal);
  const loVal = Math.min(0, minVal);
  const niceMax = hiVal === 0 && loVal === 0 ? 1 : hiVal;

  // Left margin must fit the rotated y-title + the left-edge labels: category
  // names for horizontal bars, value ticks for vertical.
  const catLabels = data.map((d) => d.label);
  const valueTicks = [
    fmtNum(niceMax),
    fmtNum(niceMax / 2),
    fmtNum(loVal),
    fmtNum(loVal / 2),
  ];
  // Vertical bars carry their category names under the axis, so they need the
  // same fit treatment as line. Horizontal bars put them in the left gutter,
  // which computeLeftMargin already sizes. Rotated labels hang left of the
  // first bar, so the margin may grow to keep them inside the SVG.
  const mTop = top + 8;
  const xTitleBand = chart.xlabel ? 40 : 18;
  const labelCap = Math.floor(
    Math.min(
      height * LABEL_REGION_SHARE,
      height * (1 - PLOT_MIN_SHARE) - mTop - xTitleBand
    )
  );
  const verticalFit = authoredHorizontal
    ? null
    : planLabelsFitLeft(
        catLabels,
        computeLeftMargin(chart.ylabel, valueTicks),
        (ml) => width - ml - 32,
        (pw) => (data.length === 0 ? Infinity : pw / data.length),
        // scaleBand padding 0.3: first centre sits 0.65 steps in
        (pw) => (pw / (data.length + 0.3)) * 0.65,
        TICK_FONT,
        labelCap
      );
  // A short axis whose names would have to rotate turns horizontal instead
  // (#1828): names read flat in the left column, wrapped rather than cut. A
  // long axis (dates, many points) keeps thinning and rotating.
  // A plan that cut its names counts too: once cut short they may fit flat.
  const flipped =
    verticalFit !== null &&
    data.length <= FLIP_MAX_CATEGORIES &&
    (verticalFit.plan.rotate ||
      verticalFit.shown.some((s, i) => s !== catLabels[i]));
  const horizontal = authoredHorizontal || flipped;
  // Axis titles name the axis they sit on: after a flip the categories run
  // down the left, so the authored x-label moves there and y-label goes below.
  const bottomTitle = flipped ? chart.ylabel : chart.xlabel;
  const leftTitle = flipped ? chart.xlabel : chart.ylabel;

  // Horizontal names wrap to as many lines as one band's step holds (up to
  // NAME_MAX_LINES) inside the name column, and only then end in `…`.
  const sideSteps = data.length === 0 ? 1 : data.length + 0.3;
  const nameLines = Math.max(
    1,
    Math.min(
      NAME_MAX_LINES,
      Math.floor((height - mTop - 64) / sideSteps / NAME_LINE_PX)
    )
  );
  const sideFit = horizontal
    ? catLabels.map((t) =>
        fitLabel(t, TICK_FONT, width * LABEL_REGION_SHARE, nameLines)
      )
    : [];
  const mLeft0 = horizontal
    ? computeLeftMargin(
        leftTitle,
        sideFit.flatMap((f) => f.lines)
      )
    : computeLeftMargin(chart.ylabel, valueTicks);
  const fit = horizontal ? null : verticalFit;
  const mLeft = fit ? fit.mLeft : mLeft0;
  const plotW = fit ? fit.plotW : width - mLeft - 32;
  const labelPlan = fit?.plan ?? planCategoryLabels(catLabels, Infinity);
  const shown = fit?.shown ?? catLabels;
  const m: Margins = {
    top: mTop,
    right: 32,
    bottom: horizontal ? 64 : Math.max(64, labelPlan.height + xTitleBand),
    left: mLeft,
  };

  const plotH = height - m.top - m.bottom;
  const horiz = horizontal;

  const catRange: [number, number] = horiz
    ? [m.top, m.top + plotH]
    : [m.left, m.left + plotW];
  const cat = scaleBand<string>()
    .domain(data.map((d) => d.label))
    .range(catRange)
    .padding(0.3);
  const valRange: [number, number] = horiz
    ? [m.left, m.left + plotW]
    : [m.top + plotH, m.top];
  const val = scaleLinear().domain([loVal, niceMax]).nice().range(valRange);

  // value-axis gridlines + ticks
  for (const t of val.ticks(6)) {
    if (horiz) {
      const x = val(t);
      svg
        .append('line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', m.top)
        .attr('y2', m.top + plotH)
        .attr('stroke', mutedColor)
        .attr('stroke-opacity', t === 0 ? 0.6 : 0.25);
      svg
        .append('text')
        .attr('x', x)
        .attr('y', m.top + plotH + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(fmtNum(t));
    } else {
      const y = val(t);
      svg
        .append('line')
        .attr('x1', m.left)
        .attr('x2', m.left + plotW)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', mutedColor)
        .attr('stroke-opacity', t === 0 ? 0.6 : 0.25);
      svg
        .append('text')
        .attr('x', m.left - 10)
        .attr('y', y + 4)
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(fmtNum(t));
    }
  }

  // category labels
  if (horiz) {
    data.forEach((d, i) => {
      const c = (cat(d.label) ?? 0) + cat.bandwidth() / 2;
      const { lines, truncated } = sideFit[i]!;
      const t = svg
        .append('text')
        .attr('x', m.left - 10)
        .attr('y', c + 4 - ((lines.length - 1) * NAME_LINE_PX) / 2)
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY);
      if (lines.length === 1) t.text(lines[0]!);
      else
        lines.forEach((line, k) =>
          t
            .append('tspan')
            .attr('x', m.left - 10)
            .attr('dy', k === 0 ? 0 : NAME_LINE_PX)
            .text(line)
        );
      if (truncated) t.append('title').text(d.label);
    });
  } else {
    // Thinned, and rotated when thinning alone would cost too many. See
    // planCategoryLabels in ./shared.
    drawCategoryLabels(
      svg,
      shown,
      labelPlan,
      (i) => (cat(data[i]!.label) ?? 0) + cat.bandwidth() / 2,
      m.top + plotH,
      textColor,
      TICK_FONT,
      catLabels
    );
  }

  const zero = val(0);
  const inner = stacked
    ? null
    : scaleBand<number>()
        .domain(seriesNames.map((_, i) => i))
        .range([0, cat.bandwidth()])
        .padding(0.12);

  // Where a side-by-side bar's value label goes. Negative bars grow left (or
  // down): the label sits off the bar's free end, flipped inside the bar when
  // it would leave the plot (the extreme bar ends exactly at the plot edge and
  // would hit the category name).
  const valueSpot = (base: number, s: number, v: number): ValueSpot => {
    const off = inner!(s) ?? 0;
    const bw = inner!.bandwidth();
    const text = fmtNum(v);
    if (horiz) {
      const x1 = val(v);
      const approxW = text.length * 7 + 6;
      const inside =
        v < 0 ? x1 - approxW < m.left : x1 + approxW > m.left + plotW;
      return {
        text,
        x: v < 0 ? (inside ? x1 + 6 : x1 - 6) : inside ? x1 - 6 : x1 + 6,
        y: base + off + bw / 2 + 4,
        anchor: v < 0 !== inside ? 'end' : 'start',
        keep: true,
      };
    }
    const y1 = val(v);
    const yOut = v < 0 ? y1 + 14 : y1 - 6;
    const yInside = v < 0 ? yOut > m.top + plotH - 2 : yOut < m.top + 2;
    return {
      text,
      x: base + off + bw / 2,
      y: yInside ? (v < 0 ? y1 - 6 : y1 + 14) : yOut,
      anchor: 'middle',
      keep: true,
    };
  };

  data.forEach((d) => {
    const base = cat(d.label) ?? 0;
    const vals = seriesValues(d, seriesCount);
    // One category's labels collide when its bars are thinner than the type:
    // the larger value keeps its label, a smaller one that would touch it is
    // dropped (#1828). Its value stays on the bar's hover.
    const spots = stacked
      ? []
      : dropColliding(
          vals.map((v, s) => valueSpot(base, s, v)),
          vals
        );
    let accPos = 0;
    let accNeg = 0;
    vals.forEach((v, s) => {
      const stroke = colorFor(s, v, seriesCount === 1 ? d.color : undefined);
      const fill = fillOf(stroke);
      const sName = seriesNames[s] ?? '';
      const dim = recedes(d.label, sName);
      const tag = {
        line: d.lineNumber,
        key: multiSeries ? sName : d.label,
        name: multiSeries ? `${d.label} · ${sName}` : d.label,
        value: v,
        color: stroke,
        seriesName: multiSeries ? sName : undefined,
      };
      if (stacked) {
        // Positive segments stack up/right from 0, negative segments stack
        // down/left — the diverging-stack convention.
        const acc = v < 0 ? accNeg : accPos;
        if (horiz) {
          const x0 = val(acc);
          const x1 = val(acc + v);
          rect(
            svg,
            Math.min(x0, x1),
            base,
            Math.abs(x1 - x0),
            cat.bandwidth(),
            fill,
            stroke,
            tag,
            dim
          );
          if (Math.abs(x1 - x0) > 26)
            drawValueLabel(
              svg,
              fmtNum(v),
              (x0 + x1) / 2,
              base + cat.bandwidth() / 2 + 4,
              textColor
            ).attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
        } else {
          const y0 = val(acc);
          const y1 = val(acc + v);
          rect(
            svg,
            base,
            Math.min(y0, y1),
            cat.bandwidth(),
            Math.abs(y1 - y0),
            fill,
            stroke,
            tag,
            dim
          );
          if (Math.abs(y1 - y0) > 18)
            drawValueLabel(
              svg,
              fmtNum(v),
              base + cat.bandwidth() / 2,
              (y0 + y1) / 2 + 4,
              textColor
            ).attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
        }
        if (v < 0) accNeg += v;
        else accPos += v;
      } else {
        const off = inner!(s) ?? 0;
        const bw = inner!.bandwidth();
        if (horiz) {
          const x1 = val(v);
          rect(
            svg,
            Math.min(zero, x1),
            base + off,
            Math.abs(x1 - zero),
            bw,
            fill,
            stroke,
            tag,
            dim
          );
          const spot = spots[s]!;
          if (spot.keep)
            drawValueLabel(
              svg,
              spot.text,
              spot.x,
              spot.y,
              textColor,
              spot.anchor
            ).attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
        } else {
          const y1 = val(v);
          rect(
            svg,
            base + off,
            Math.min(zero, y1),
            bw,
            Math.abs(zero - y1),
            fill,
            stroke,
            tag,
            dim
          );
          const spot = spots[s]!;
          if (spot.keep)
            drawValueLabel(
              svg,
              spot.text,
              spot.x,
              spot.y,
              textColor,
              spot.anchor
            ).attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
        }
      }
    });
  });

  drawXAxisTitle(
    svg,
    bottomTitle,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor
  );
  drawYAxisTitle(svg, leftTitle, m.top + plotH / 2, 20, textColor);
}

interface ValueSpot {
  text: string;
  x: number;
  y: number;
  anchor: 'middle' | 'start' | 'end';
  keep: boolean;
}

/** A value label's box, from its baseline anchor (VALUE_FONT tall). */
function spotBox(spot: ValueSpot): LabelRect {
  const w = measureText(spot.text, VALUE_FONT);
  const x =
    spot.anchor === 'middle'
      ? spot.x - w / 2
      : spot.anchor === 'end'
        ? spot.x - w
        : spot.x;
  return { x, y: spot.y - VALUE_FONT * 0.8, w, h: VALUE_FONT };
}

/** Keep labels in order of |value|, dropping any that would touch a kept one. */
function dropColliding(spots: ValueSpot[], vals: number[]): ValueSpot[] {
  const placement = createLabelPlacement();
  const order = spots
    .map((_, i) => i)
    .sort((a, b) => Math.abs(vals[b]!) - Math.abs(vals[a]!) || a - b);
  for (const i of order) {
    const box = spotBox(spots[i]!);
    if (placement.hitsPlaced(box)) spots[i]!.keep = false;
    else placement.commit(box);
  }
  return spots;
}

function rect(
  svg: Svg,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  tag: {
    line: number;
    key: string;
    name: string;
    value: number;
    color: string;
    seriesName?: string | undefined;
  },
  dim: boolean
): void {
  const r = svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 1.5);
  // A receded bar keeps its paint: the dim is a baked opacity (§1.11).
  if (dim) r.attr('opacity', EMPHASIS_DIM_OPACITY);
  tagDatum(r, tag);
}
