// ============================================================
// Hand-built line / multi-line / area renderer.
// Series-tinted value labels, 0-baseline, era bands (markArea parity),
// dual y-axis (§15.1.1: y-axis / y-right-axis grouped series).
// ============================================================

import { scalePoint } from 'd3-scale';
import {
  axisTickFormat,
  buildValueAxis,
  labelledTicks,
  type ValueAxis,
} from './value-axis';
import {
  line as d3line,
  area as d3area,
  curveLinear,
  curveStepAfter,
  curveStepBefore,
} from 'd3-shape';
import { buildDateAxis, isoDatesOf } from './date-axis';

/** Gap between a time axis's first/last point and the plot edge (#1880). */
const DATE_AXIS_INSET = 16;
/** Fill opacity of an uncertainty band (#1981): the low series' colour, faint
 *  enough that the gridlines and any line inside it still read. */
const BAND_OPACITY = 0.22;
/** Series names at the right end of their lines (#1950): size, gap. */
const END_LABEL_FONT = 12;
const END_LABEL_GAP = 8;
/** A point's resting dot (#2203): its radius, and the median gap between
 *  neighbouring points, in dot diameters, below which dots are dropped. */
const POINT_R = 3.5;
const POINT_CLEAR_DIAMETERS = 3;
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { mix, shapeFill } from '../palettes/color-utils';
import { annotationValues } from '../annotations/parse';
import {
  drawBands,
  drawMarkers,
  settleBandLabels,
  type ValueAxisFrame,
} from '../annotations/draw';
import {
  drawChartNotes,
  sampleLines,
  type PlacedNoteDatum,
} from '../annotations/notes';
import { resolveVerticalCollisions } from '../slope/renderer';
import {
  drawOverlayLabels,
  drawExtremes,
  EXTREME_DOT_R,
  drawOverlayLevels,
  drawOverlayPaths,
  extremeRows,
  movingAveragePaths,
  overlayLevels,
  RAW_UNDER_AVERAGE_STROKE,
  type ExtremeMark,
  targetOf,
  trendPaths,
  trendUnit,
  type OverlayLabel,
} from '../overlays/draw';
import { overlayPlacement } from '../overlays/place';
import { reachesTarget } from '../overlays/compute';
import { measureText } from '../utils/text-measure';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  resolveEmphasis,
  storyPaint,
} from '../utils/emphasis';
import {
  type Svg,
  type Margins,
  type InlineTitleInfo,
  TICK_FONT,
  VALUE_FONT,
  chartFormatter,
  reserveHeader,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  drawValueLabel,
  planLabelsFitLeft,
  drawCategoryLabels,
  bandSafeTop,
  TICK_INK_ABOVE,
  topTickFraction,
} from './shared';
import { labelBox, placeLabels } from '../utils/place-labels';
import { tabularText } from '../utils/tabular-figures';
import { resolveColor } from '../colors';
import type { LabelRect, PointCircle } from '../label-layout';
import { shareText, stackSpans, toShares } from '../utils/stack-share';

function seriesValue(
  pt: { value: number; extraValues?: number[] },
  s: number
): number {
  return s === 0 ? pt.value : (pt.extraValues?.[s - 1] ?? 0);
}

export function renderLine(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  bgColor: string,
  hasTitle: boolean,
  inlineTitle?: InlineTitleInfo
): void {
  const data = chart.data;
  // `line` + a `stack` block → stacked areas; `stack 100%` → each x position
  // as shares of its total (#1846). A stack always fills.
  // A bar chart with lines (#1852) is drawn here too: its bars stand side by
  // side under `group`, or as one stacked bar per slot under `stack`.
  const barHost = chart.type === 'bar';
  const barStack = barHost && chart.barLayout === 'stack';
  const stacked = chart.barLayout === 'stack' && !barHost;
  const percent = stacked && !!chart.stackPercent;
  // `line` + a `fill` directive → filled (area) rendering. (#25)
  const isArea = chart.fill === true || stacked;
  // `fill-solid` → opaque area under the line instead of the default 25% tint.
  // The area IS the data surface — `fill-outline` is ignored here (§1.9).
  const solid = chart.fillMode === 'solid';
  const seriesNames = chart.seriesNames?.length
    ? chart.seriesNames
    : [chart.series ?? ''];
  const seriesCount = Math.max(
    1,
    seriesNames.length,
    1 + Math.max(0, ...data.map((d) => d.extraValues?.length ?? 0))
  );
  // Stacked rows: each series' [lower, upper] on the value axis (in shares
  // under `stack 100%`), and each raw value's share of its row's total.
  const rawRows = data.map((d) =>
    Array.from({ length: seriesCount }, (_, s) => seriesValue(d, s))
  );
  const shareRows = stacked ? rawRows.map(toShares) : null;
  const spanRows = stacked
    ? (percent ? shareRows! : rawRows).map(stackSpans)
    : null;
  // A bar host's stack (#1852): only the bar series stack, positive runs up
  // from 0 and negative runs down; the lines keep their own values.
  const barMark = (s: number): boolean =>
    (chart.seriesMarks?.[s] ?? 'line') === 'bar';
  const barSpanRows = barStack
    ? rawRows.map((row) => {
        let up = 0;
        let down = 0;
        return row.map((v, s): [number, number] | null => {
          if (!barMark(s) || !Number.isFinite(v)) return null;
          const from = v < 0 ? down : up;
          if (v < 0) down += v;
          else up += v;
          return [from, from + v];
        });
      })
    : null;
  /** Where row i of series s sits on its value axis; NaN when missing. */
  const yValue = (i: number, s: number): number => {
    const v = rawRows[i]![s]!;
    const bar = barSpanRows?.[i]![s];
    if (bar) return bar[1];
    if (!spanRows || !Number.isFinite(v)) return v;
    return spanRows[i]![s]![1];
  };
  /** Its lower edge: the top of the series below, or 0. */
  const yLower = (i: number, s: number): number =>
    barSpanRows?.[i]![s]?.[0] ?? (spanRows ? spanRows[i]![s]![0] : 0);
  // A stacked area prints no point values; its hover carries value and share.
  const showValues = !chart.noValue && !stacked;
  // `target N` (#1954): a point that reaches it is lit, the rest go grey.
  const target = stacked ? undefined : targetOf(chart.overlays);
  /** Values on the left axis that are not data: marks and the target. */
  const marked = [
    ...annotationValues(chart.annotations),
    ...(target ? [target.value!] : []),
  ];
  const seriesColor = (s: number): string =>
    chart.seriesNameColors?.[s] ?? colors[s % colors.length]!;
  // Combo (#1852): `mark: bar` draws a series as bars, side by side in each
  // x slot and under every line; `mark: step` draws it as a step line.
  const markOf = (s: number): 'bar' | 'line' | 'step' =>
    chart.seriesMarks?.[s] ?? 'line';
  // A band's bounds (#1981) are drawn only as the band, so a bound with
  // `mark: bar` takes no slot and does not pull its axis to 0.
  const bandBounds = new Set(
    (chart.seriesBands ?? []).flatMap((b) => [b.low, b.high])
  );
  const barSeries = Array.from({ length: seriesCount }, (_, s) => s).filter(
    (s) => markOf(s) === 'bar' && !bandBounds.has(s)
  );
  const isBar = (s: number): boolean => markOf(s) === 'bar';
  // A time axis when every row is an ISO date (#1880); else categories. A
  // chart with bars keeps its categories: a bar stands in a slot.
  const dates = barSeries.length ? null : isoDatesOf(data.map((d) => d.label));

  // Dual-axis (§15.1): per-series left/right assignment; absent ⇒ all left.
  const axisOf = (s: number): 'left' | 'right' =>
    chart.seriesAxes?.[s] ?? 'left';
  const dual = (chart.seriesAxes ?? []).includes('right');
  // An axis owned by exactly one series adopts that series' color.
  const soleAxisColor = (side: 'left' | 'right'): string | undefined => {
    const owners: number[] = [];
    for (let s = 0; s < seriesCount; s++)
      if (axisOf(s) === side) owners.push(s);
    return owners.length === 1 ? seriesColor(owners[0]!) : undefined;
  };

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

  // Per-axis value extent. Default: fit a padded data-min→max window so detail
  // isn't crushed against a forced 0 baseline — line charts float (unlike
  // magnitude-encoding bars). `no-auto-y` restores the 0 floor (§15.1).
  const extentFor = (side: 'left' | 'right'): [number, number] => {
    if (percent) return [0, 100];
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < data.length; i++)
      for (let s = 0; s < seriesCount; s++)
        if (axisOf(s) === side) {
          const v = yValue(i, s);
          if (!Number.isFinite(v)) continue;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
    if (!isFinite(lo)) return [0, 1];
    // A bar's length is its value: an axis with bars on it reaches 0.
    const bars = barSeries.some((s) => axisOf(s) === side);
    if (bars) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    // A `marker` or `band` (#1832) sits on the left axis and widens it.
    if (side === 'left')
      for (const v of marked) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    if (chart.noAutoY || stacked || bars) {
      // A stacked area always starts at 0: its top edge is the total.
      // Opt-out: anchor baseline at 0 for non-negative data (ECharts parity).
      if (lo > 0) lo = 0;
    } else {
      // Auto-fit: pad ~5% each side; `.nice()` then rounds the domain outward.
      // Don't cross 0 for non-negative data (a floating negative axis reads odd).
      const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.05 || 1;
      const nlo = lo - pad;
      lo = lo >= 0 && nlo < 0 ? 0 : nlo;
      hi = hi + pad;
    }
    if (lo === hi) hi = lo + 1;
    return [lo, hi];
  };
  const [loL, hiL] = extentFor('left');
  // Each value axis takes its own axis line (decision #60): `y-axis 0.. log`
  // on the left, `y-right-axis 0..100` on the right of a dual-axis chart.
  // Probed on a unit range so the margin is sized from the labels the axis
  // will really draw.
  const ySpec = chart.axes?.y;
  let dataLoL = Infinity;
  let dataHiL = -Infinity;
  for (let i = 0; i < data.length; i++)
    for (let s = 0; s < seriesCount; s++)
      if (axisOf(s) === 'left') {
        const v = yValue(i, s);
        if (!Number.isFinite(v)) continue;
        dataLoL = Math.min(dataLoL, v);
        dataHiL = Math.max(dataHiL, v);
      }
  // A log axis is bounded by these, not by the padded extent: let it reach a
  // `marker` or `band` (#1832) too.
  for (const v of marked) {
    if (v > 0) dataLoL = Math.min(dataLoL, v);
    dataHiL = Math.max(dataHiL, v);
  }
  const leftAxis = (range: [number, number]) =>
    buildValueAxis(loL, hiL, ySpec, range, {
      nice: true,
      dataLo: dataLoL,
      dataHi: dataHiL,
    });
  const probeL = leftAxis([0, 1]).ticks(6);
  const [loR, hiR] = dual ? extentFor('right') : [0, 1];
  const ySpecR = chart.axes?.['y-right'];
  let dataLoR = Infinity;
  let dataHiR = -Infinity;
  if (dual)
    for (let i = 0; i < data.length; i++)
      for (let s = 0; s < seriesCount; s++)
        if (axisOf(s) === 'right') {
          const v = yValue(i, s);
          if (!Number.isFinite(v)) continue;
          dataLoR = Math.min(dataLoR, v);
          dataHiR = Math.max(dataHiR, v);
        }
  const rightAxis = (range: [number, number]) =>
    buildValueAxis(loR, hiR, ySpecR, range, {
      nice: true,
      dataLo: dataLoR,
      dataHi: dataHiR,
    });
  // The author's `format` / `unit` / `locale` (#1831), with one compact unit
  // per value axis (#2036): a point's label prints in its own axis's unit.
  const fmt = chartFormatter(chart, probeL);
  const fmtR = dual ? chartFormatter(chart, rightAxis([0, 1]).ticks(6)) : fmt;
  const fmtFor = (s: number) => (dual && axisOf(s) === 'right' ? fmtR : fmt);
  const tickFmt = percent
    ? (t: number) => `${round(t)}%`
    : axisTickFormat(leftAxis([0, 1]), chart.numberFormat, fmt);
  const tickFmtR = dual
    ? axisTickFormat(rightAxis([0, 1]), chart.numberFormat, fmtR)
    : fmtR;

  // Horizontal margins first: the category-label plan needs the plot width to
  // know how much room one category owns, and the bottom margin then follows
  // from the plan (rotated labels stand taller than flat ones).
  // Series names at the right end of their lines (#1950), beside the point
  // values: a chart of two or more drawn lines, one value axis, no stack.
  const drawnSeries = Array.from({ length: seriesCount }, (_, s) => s).filter(
    (s) => !(chart.seriesBands ?? []).some((b) => b.low === s || b.high === s)
  );
  // A bar series is named by the legend alone: its end is not a point.
  const lineSeries = drawnSeries.filter((s) => !isBar(s));
  let endLabels = lineSeries.length >= 2 && !dual && !stacked;
  const endLabelW = endLabels
    ? Math.max(
        ...lineSeries.map((s) =>
          measureText(seriesNames[s] ?? `Series ${s + 1}`, END_LABEL_FONT, {
            bold: true,
          })
        )
      )
    : 0;
  let mRight = dual
    ? computeLeftMargin(chart.yrlabel, [tickFmtR(hiR), tickFmtR(loR)], {
        tabular: true,
      })
    : 32;
  const mLeft0 = computeLeftMargin(chart.ylabel, probeL.map(tickFmt), {
    tabular: true,
  });
  // The names start just past the last point, which sits half a slot (or the
  // date inset) in from the plot's right edge: the margin holds the rest.
  if (endLabels) {
    const inset = dates
      ? DATE_AXIS_INSET
      : (width - mLeft0 - mRight) / Math.max(1, 2 * data.length);
    mRight = Math.max(mRight, endLabelW + END_LABEL_GAP + 6 - inset);
  }
  // scalePoint with padding(0.5) puts one slot's worth of space between
  // adjacent points, and half a slot at each end. Rotated labels hang left of
  // the first point, so the margin may grow to keep them inside the SVG.
  // A time axis labels its own ticks flat, so it needs no label fit.
  const fitFor = (mr: number) =>
    dates
      ? null
      : planLabelsFitLeft(
          data.map((d) => d.label),
          mLeft0,
          (ml) => width - ml - mr,
          (pw) => (data.length > 0 ? pw / data.length : pw),
          (pw) => (data.length > 0 ? pw / data.length : pw) * 0.5
        );
  let fit = fitFor(mRight);
  // The names never cost the category labels their flat reading: when the
  // gutter would make them rotate, the chart keeps its legend alone.
  if (endLabels && fit?.plan.rotate) {
    endLabels = false;
    mRight = 32;
    fit = fitFor(mRight);
  }
  const mLeft = fit ? fit.mLeft : mLeft0;
  const plotW = fit ? fit.plotW : width - mLeft0 - mRight;
  const labelPlan = fit?.plan;
  const m: Margins = {
    top: top + 8,
    right: mRight,
    bottom: Math.max(
      64,
      (labelPlan?.height ?? TICK_FONT + 10) + (chart.xlabel ? 40 : 18)
    ),
    left: mLeft,
  };
  // The highest value label sits 10 above its point and VALUE_FONT tall. The
  // drawing starts on the body band (#1838), so push the plot down until that
  // label's top is on it. A point at fraction f from the plot top lands at
  // m.top + f * (height - m.bottom - m.top).
  if (showValues) {
    const probeLeft = leftAxis([0, 1]);
    const probeR = dual ? rightAxis([0, 1]) : null;
    let f = 1;
    for (const d of data)
      for (let s = 0; s < seriesCount; s++) {
        const ax = dual && axisOf(s) === 'right' && probeR ? probeR : probeLeft;
        const v = seriesValue(d, s);
        if (Number.isFinite(v)) f = Math.min(f, 1 - ax(v));
      }
    // A plot too short to keep its ticks apart is not squeezed further.
    const need =
      f < 1 ? (m.top + 10 + VALUE_FONT - f * (height - m.bottom)) / (1 - f) : 0;
    if (
      need > m.top &&
      (height - m.bottom - need) / Math.max(1, probeL.length - 1) >=
        TICK_FONT + 4
    )
      m.top = need;
  }
  // The top tick label stands over its gridline; keep it on the band too
  // (#2111).
  {
    const probeLeft = leftAxis([0, 1]);
    const items: [number, number][] = [
      [topTickFraction(probeLeft, probeLeft.ticks(6)), TICK_INK_ABOVE],
    ];
    if (dual) {
      const probeR = rightAxis([0, 1]);
      items.push([topTickFraction(probeR, probeR.ticks(6)), TICK_INK_ABOVE]);
    }
    m.top = Math.max(m.top, bandSafeTop(top + 8, height - m.bottom, items));
  }
  const plotH = height - m.top - m.bottom;

  const pointX = scalePoint<string>()
    .domain(data.map((d) => d.label))
    .range([m.left, m.left + plotW])
    .padding(0.5);
  // Inset so the first and last points never sit on the plot's edge.
  const dateAxis = dates
    ? buildDateAxis(
        dates,
        [m.left + DATE_AXIS_INSET, m.left + plotW - DATE_AXIS_INSET],
        { fontSize: TICK_FONT }
      )
    : null;
  /** Row → x. Dated rows sit at their time; category rows at their slot. */
  const xOfRow = (i: number): number =>
    dateAxis && dates ? dateAxis.x(dates[i]!) : (pointX(data[i]!.label) ?? 0);
  /** A fractional row → x, between its two rows (for computed lines). */
  const xAtRow = (i: number): number => {
    const a = Math.floor(i);
    const b = Math.min(data.length - 1, a + 1);
    return xOfRow(a) + (i - a) * (xOfRow(b) - xOfRow(a));
  };
  const xOfLabel = (label: string): number | undefined => {
    if (!dateAxis) return pointX(label);
    const i = data.findIndex((d) => d.label === label);
    return i < 0 ? undefined : xOfRow(i);
  };
  // Dense points (#2203): a dot per point in a slot narrower than a few dot
  // widths merges into a chain of beads that hides the line. The median gap
  // decides, so one close pair on a time axis does not strip every dot.
  const gaps = data
    .slice(1)
    .map((_, i) => Math.abs(xOfRow(i + 1) - xOfRow(i)))
    .sort((a, b) => a - b);
  const denseRows =
    gaps.length > 0 &&
    gaps[Math.floor(gaps.length / 2)]! < POINT_CLEAR_DIAMETERS * 2 * POINT_R;
  // `step` / `step-before` (#1880): each value holds until the next point;
  // the last one stops at the last point.
  const curve =
    chart.step === 'after'
      ? curveStepAfter
      : chart.step === 'before'
        ? curveStepBefore
        : curveLinear;
  const yL = leftAxis([m.top + plotH, m.top]);
  const yR: ValueAxis | null = dual ? rightAxis([m.top + plotH, m.top]) : null;
  const yFor = (s: number): ValueAxis =>
    dual && axisOf(s) === 'right' && yR ? yR : yL;
  /** A series' own curve: `mark: step` steps it whatever the chart's flag. */
  const curveOf = (s: number) =>
    markOf(s) === 'step' ? curveStepAfter : curve;
  // Bars of one slot share 70% of it, in declared order; a stack is one bar.
  const barSlots = barStack ? 1 : barSeries.length;
  const barW = barSlots ? (pointX.step() * 0.7) / barSlots : 0;
  const barLeft = (s: number, i: number): number =>
    xOfRow(i) -
    (barW * barSlots) / 2 +
    (barStack ? 0 : barSeries.indexOf(s)) * barW;
  const leftTint = dual ? soleAxisColor('left') : undefined;
  const rightTint = soleAxisColor('right');

  // era bands (markArea parity) — positioned on the left axis. Their titles
  // are text the point values must clear.
  const eraTitles: LabelRect[] = [];
  const annotationFrame: ValueAxisFrame = {
    pos: (v) => yL(v),
    domain: yL.domain(),
    left: m.left,
    top: m.top,
    width: plotW,
    height: plotH,
    horizontal: false,
    crossPos: (at) => (typeof at === 'string' ? xOfLabel(at) : undefined),
  };
  const annotationColors = {
    text: textColor,
    muted: palette.textMuted,
    bg: bgColor,
  };
  eraTitles.push(
    ...drawBands(svg, chart.annotations, annotationFrame, annotationColors)
  );
  if (chart.eras?.length) {
    chart.eras.forEach((era, i) => {
      const xs = xOfLabel(era.start);
      const xe = xOfLabel(era.end);
      if (xs == null || xe == null) return;
      const fill = era.color ?? colors[i % colors.length]!;
      svg
        .append('rect')
        .attr('x', Math.min(xs, xe))
        .attr('y', m.top)
        .attr('width', Math.abs(xe - xs))
        .attr('height', plotH)
        .attr('fill', mix(fill, bgColor, 12));
      svg
        .append('text')
        .attr('x', (xs + xe) / 2)
        .attr('y', m.top + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .attr('opacity', 0.8)
        .text(era.label);
      eraTitles.push(
        labelBox(
          era.label,
          { x: (xs + xe) / 2, y: m.top + 14, anchor: 'middle' },
          TICK_FONT
        )
      );
    });
  }

  // left y gridlines + ticks (only the left axis draws gridlines)
  const shownTicks = yL.ticks(6);
  const shown = labelledTicks(yL, shownTicks, tickFmt, {
    fontSize: TICK_FONT,
    vertical: true,
  });
  for (const t of shownTicks) {
    const yy = yL(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === 0 ? 0.6 : 0.25);
    if (shown.has(t))
      svg
        .append('text')
        .attr('class', 'dgmo-tick')
        .attr('x', m.left - 10)
        .attr('y', yy + 4)
        .attr('text-anchor', 'end')
        .attr('fill', leftTint ?? textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .call(tabularText(tickFmt(t), TICK_FONT));
  }

  // right y ticks (no gridlines)
  if (dual && yR) {
    const shownRTicks = yR.ticks(6);
    const shownR = labelledTicks(yR, shownRTicks, tickFmtR, {
      fontSize: TICK_FONT,
      vertical: true,
    });
    for (const t of shownRTicks) {
      if (shownR.has(t))
        svg
          .append('text')
          .attr('class', 'dgmo-tick')
          .attr('x', m.left + plotW + 10)
          .attr('y', yR(t) + 4)
          .attr('text-anchor', 'start')
          .attr('fill', rightTint ?? textColor)
          .attr('font-size', TICK_FONT)
          .attr('font-family', FONT_FAMILY)
          .call(tabularText(tickFmtR(t), TICK_FONT));
    }
  }

  // x category labels — thinned, and rotated when thinning alone would cost too
  // many of them. See planCategoryLabels in ./shared.
  if (dateAxis) {
    // Time ticks: a short mark on the axis and a flat label beneath it.
    for (const t of dateAxis.ticks) {
      svg
        .append('line')
        .attr('x1', t.pos)
        .attr('x2', t.pos)
        .attr('y1', m.top + plotH)
        .attr('y2', m.top + plotH + 4)
        .attr('stroke', mutedColor)
        .attr('stroke-opacity', 0.6);
      svg
        .append('text')
        .attr('class', 'dgmo-tick')
        .attr('x', t.pos)
        .attr('y', m.top + plotH + TICK_FONT + 6)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(t.label);
    }
  } else if (labelPlan) {
    drawCategoryLabels(
      svg,
      data.map((d) => d.label),
      labelPlan,
      xOfRow,
      m.top + plotH,
      textColor
    );
  }

  // Transparent hit-target over the plot area — the interaction adapter reads
  // its bounds for crosshair extent and snapping (see charts-d3/interactions.ts).
  svg
    .append('rect')
    .attr('class', 'dgmo-plot-rect')
    .attr('x', m.left)
    .attr('y', m.top)
    .attr('width', plotW)
    .attr('height', plotH)
    .attr('fill', 'transparent');

  // §1.11 emphasis (#1829): `highlight` names series. Every other series —
  // its line, area, points and value labels — recedes.
  const nameOf = (s: number) => seriesNames[s] ?? `Series ${s + 1}`;
  // A band's bounds (#1981) are drawn only as the band, never as lines.
  const bands = chart.seriesBands ?? [];
  const boundSeries = new Set(bands.flatMap((b) => [b.low, b.high]));
  const emphasis = resolveEmphasis(chart.emphasis, [
    ...Array.from({ length: seriesCount }, (_, s) => s)
      .filter((s) => !boundSeries.has(s))
      .map(nameOf),
    ...bands.map((b) => b.label),
  ]);
  const { dimmed } = emphasis;
  // Story view (#2046): the subject keeps its colour, the rest go grey and
  // are drawn first so the subject sits on top.
  const story = storyPaint(emphasis, palette, isDark);
  const seriesOrder = Array.from({ length: seriesCount }, (_, s) => s);
  if (story.active)
    seriesOrder.sort(
      (a, b) => Number(dimmed.has(nameOf(b))) - Number(dimmed.has(nameOf(a)))
    );
  // Every bar is drawn before any line, so the lines sit on top (#1852).
  seriesOrder.sort((a, b) => Number(isBar(b)) - Number(isBar(a)));

  /** Each drawn series' points in px, for the notes' clear space. */
  const polylines: [number, number][][] = [];
  /** Points along the overlay lines, which labels must clear (#2106). */
  const overlayTrace: PointCircle[] = [];
  /** Each drawn series' last point and paint, for its end-of-line name. */
  const lineEnds: {
    s: number;
    name: string;
    x: number;
    y: number;
    color: string;
    dim: boolean;
  }[] = [];
  const valueLabels: {
    text: string;
    cx: number;
    cy: number;
    v: number;
    endpoint: boolean;
    color: string;
    dim: boolean;
  }[] = [];
  /** A missing value (non-finite) breaks a line, band or fill there. */
  const has = (v: number): boolean => Number.isFinite(v);

  // Statistics overlays (#1954), behind every series: one mean / median per
  // drawn series on its own axis, in its colour when there are several.
  const overlayLabels: OverlayLabel[] = [];
  if (chart.overlays?.length && !stacked) {
    const drawn = drawnSeries;
    const multi = drawn.length > 1;
    for (const side of ['left', 'right'] as const) {
      const own = drawn.filter((s) => axisOf(s) === side);
      const axis = side === 'right' ? yR : yL;
      if (!axis || (own.length === 0 && side === 'right')) continue;
      const series = own.map((s) => ({
        ...(multi && { name: nameOf(s) }),
        values: rawRows.map((r) => r[s]!),
        color: multi ? seriesColor(s) : textColor,
      }));
      const frame = {
        ...annotationFrame,
        pos: (v: number) => axis(v),
        domain: axis.domain(),
      };
      const sideFmt = side === 'right' ? fmtR : fmt;
      const levels = overlayLevels(
        side === 'right'
          ? chart.overlays.filter((o) => o.kind !== 'target')
          : chart.overlays,
        series,
        sideFmt,
        palette.colors.red
      );
      overlayLabels.push(
        ...drawOverlayLevels(svg, levels, frame, overlayTrace),
        ...drawOverlayPaths(
          svg,
          trendPaths(
            chart.overlays,
            series,
            xAtRow,
            sideFmt,
            trendUnit(chart.xlabel)
          ),
          frame,
          overlayTrace
        ),
        // `moving-average N`: a heavier copy in the series' own colour.
        ...drawOverlayPaths(
          svg,
          movingAveragePaths(
            chart.overlays,
            own.map((s) => ({
              ...(multi && { name: nameOf(s) }),
              values: rawRows.map((r) => r[s]!),
              color: seriesColor(s),
            })),
            xAtRow,
            trendUnit(chart.xlabel)
          ),
          frame,
          overlayTrace
        )
      );
    }
  }
  // `moving-average N` keeps the raw series, drawn thinner (#1954).
  const averaged =
    !stacked && !!chart.overlays?.some((o) => o.kind === 'moving-average');
  // `extremes` (#1954): each drawn series' highest and lowest row. Their
  // value labels give way to the extremes' own.
  const extremeAt =
    !stacked && !barHost && !chart.noExtremes
      ? extremeRows(
          drawnSeries.map((s) => ({
            s,
            values: rawRows.map((r) => r[s]!),
          }))
        )
      : new Map<string, boolean>();
  const extremeMarks: ExtremeMark[] = [];
  /** An extreme's own value label, used only if its mark finds no room. */
  const extremeValues = new Map<ExtremeMark, (typeof valueLabels)[number]>();

  // Uncertainty bands (#1981), beneath every fill and line: the low series'
  // colour at reduced opacity, between the two bounds, in the lines' curve.
  for (const band of bands) {
    const own = seriesColor(band.low);
    const recede = dimmed.has(band.label);
    const lowAxis = yFor(band.low);
    const highAxis = yFor(band.high);
    const rows = data.map((d, i) => ({
      i,
      lo: seriesValue(d, band.low),
      hi: seriesValue(d, band.high),
    }));
    const bandGen = d3area<(typeof rows)[number]>()
      .defined((r) => has(r.lo) && has(r.hi))
      .x((r) => xOfRow(r.i))
      .y0((r) => lowAxis(r.lo))
      .y1((r) => highAxis(r.hi))
      .curve(curve);
    const g = svg
      .append('g')
      .attr('class', 'dgmo-series-band')
      .attr('data-series-name', band.label)
      .attr('data-color', own)
      .attr('data-line-number', band.lineNumber);
    if (recede && !story.active) g.attr('opacity', EMPHASIS_DIM_OPACITY);
    g.append('path')
      .attr('d', bandGen(rows) ?? '')
      .attr(
        'fill',
        story.active ? (recede ? story.groundFill : story.subject(own)) : own
      )
      .attr('fill-opacity', story.active && recede ? 1 : BAND_OPACITY)
      .attr('stroke', 'none');
  }

  // Fill between two series (#1997), in declared order, above the bands and
  // beneath every line: `ahead` where A is above B, `behind` where B is.
  for (const fb of chart.fillBetween ?? []) {
    const aAxis = yFor(fb.a);
    const bAxis = yFor(fb.b);
    const rows = data.map((d, i) => ({
      x: xOfRow(i),
      a: aAxis(seriesValue(d, fb.a)),
      b: bAxis(seriesValue(d, fb.b)),
    }));
    const runs = fillBetweenRuns(rows, chart.step);
    // It recedes only when both of its series do.
    const recede = dimmed.has(nameOf(fb.a)) && dimmed.has(nameOf(fb.b));
    const g = svg
      .append('g')
      .attr('class', 'dgmo-fill-between')
      .attr('data-line-number', fb.lineNumber);
    if (recede && !story.active) g.attr('opacity', EMPHASIS_DIM_OPACITY);
    for (const side of ['ahead', 'behind'] as const) {
      const d = runs
        .filter((r) => r.ahead === (side === 'ahead'))
        .map((r) => polygonPath(r.points))
        .join('');
      if (!d) continue;
      const own =
        resolveColor(fb[side], palette) ??
        (side === 'ahead' ? palette.colors.green : palette.colors.red);
      g.append('path')
        .attr('class', `dgmo-fill-between-${side}`)
        .attr('d', d)
        .attr('fill', story.active && recede ? story.groundFill : own)
        .attr('fill-opacity', story.active && recede ? 1 : BAND_OPACITY)
        .attr('stroke', 'none');
    }
  }

  for (const s of seriesOrder) {
    if (boundSeries.has(s)) continue;
    const own = seriesColor(s);
    const yy = yFor(s);
    const name = nameOf(s);
    const recede = dimmed.has(name);
    const color = !story.active
      ? own
      : recede
        ? story.groundStroke
        : story.subject(own);
    // Story view bakes the grey into the paint; only `dim` uses opacity.
    const dim = recede && !story.active;
    const pts = data.map((d, i) => ({
      label: d.label,
      v: seriesValue(d, s),
      y: yValue(i, s),
      lo: yLower(i, s),
      xIndex: i,
      lineNumber: d.lineNumber,
    }));
    const g = svg
      .append('g')
      .attr('class', 'dgmo-series')
      .attr('data-series-index', s)
      .attr('data-series-name', name)
      .attr('data-axis', axisOf(s))
      .attr('data-color', own);
    const seriesLine = chart.seriesNameLineNumbers?.[s];
    if (seriesLine !== undefined) g.attr('data-line-number', seriesLine);
    // A receded series keeps its paint: the dim is a baked opacity (§1.11).
    if (dim) g.attr('opacity', EMPHASIS_DIM_OPACITY);
    if (isBar(s)) g.attr('data-mark', 'bar');

    const labelColor =
      story.active && recede ? story.groundText : mix(color, textColor, 60);
    if (isBar(s)) {
      const fill =
        story.active && recede
          ? story.groundFill
          : shapeFill(palette, color, isDark, { mode: chart.fillMode });
      const tops: [number, number][] = [];
      for (const p of pts) {
        if (!has(p.v)) continue;
        const x = barLeft(s, p.xIndex);
        // A stacked bar stands on the one below it.
        const base = yy(barStack ? p.lo : yy.baseline);
        const top = yy(p.y);
        g.append('rect')
          .attr('class', 'dgmo-series-bar')
          .attr('data-x-index', p.xIndex)
          .attr('data-line-number', p.lineNumber)
          .attr('x', round(x))
          .attr('y', round(Math.min(top, base)))
          .attr('width', round(Math.max(0, barW - 1)))
          .attr('height', round(Math.abs(base - top)))
          .attr('fill', fill)
          .attr('stroke', color)
          .attr('stroke-width', 1);
        const cx = x + barW / 2;
        tops.push([cx, top]);
        // The hover reads its value off the same point a line's has.
        g.append('circle')
          .attr('class', 'dgmo-pt')
          .attr('data-series-index', s)
          .attr('data-series-name', name)
          .attr('data-color', own)
          .attr('data-x-index', p.xIndex)
          .attr('data-x-label', p.label)
          .attr('data-value', p.v)
          .attr('data-line-number', p.lineNumber)
          .attr('cx', round(cx))
          .attr('cy', round(top))
          .attr('r', 0)
          .attr('fill', color);
        if (showValues && !barStack)
          valueLabels.push({
            text: fmtFor(s)(p.v),
            cx,
            cy: top,
            v: p.v,
            endpoint: p.xIndex === 0 || p.xIndex === pts.length - 1,
            color: labelColor,
            dim,
          });
      }
      polylines.push(tops);
      continue;
    }

    if (isArea) {
      const areaGen = d3area<(typeof pts)[number]>()
        .defined((p) => has(p.v))
        .x((p) => xOfRow(p.xIndex))
        .y0((p) => (stacked ? yy(p.lo) : yy(yy.baseline)))
        .y1((p) => yy(p.y))
        .curve(curveOf(s));
      g.append('path')
        .attr('class', 'dgmo-series-area')
        .attr('d', areaGen(pts) ?? '')
        .attr(
          'fill',
          story.active && recede
            ? story.groundFill
            : solid
              ? color
              : shapeFill(palette, color, isDark)
        )
        .attr('stroke', 'none');
    }

    const lineGen = d3line<(typeof pts)[number]>()
      .defined((p) => has(p.v))
      .x((p) => xOfRow(p.xIndex))
      .y((p) => yy(p.y))
      .curve(curveOf(s));
    g.append('path')
      .attr('class', 'dgmo-series-line')
      .attr('d', lineGen(pts) ?? '')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr(
        'stroke-width',
        stacked ? 1.75 : averaged ? RAW_UNDER_AVERAGE_STROKE : 2.5
      )
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');

    // Invisible fat hit corridor along the line. Without it the series is
    // only hittable on the 2.5px stroke and the tiny dots, so the baked
    // CSS :hover emphasis in embeds (no JS) effectively never fires.
    // Transparent stroke still hit-tests under pointer-events:visiblePainted.
    g.append('path')
      .attr('class', 'dgmo-series-hit')
      .attr('d', lineGen(pts) ?? '')
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 16)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');

    const drawn = pts.filter((p) => has(p.v));
    polylines.push(drawn.map((p) => [xOfRow(p.xIndex), yy(p.y)]));
    const last = drawn.at(-1);
    if (last)
      lineEnds.push({
        s,
        name,
        x: xOfRow(last.xIndex),
        y: yy(last.y),
        color: labelColor,
        dim,
      });
    for (const p of pts) {
      if (!has(p.v)) continue;
      const lit = target
        ? reachesTarget(p.v, target.value!, target.below)
        : null;
      const high = extremeAt.get(`${s}:${p.xIndex}`);
      // A dot that carries data — a target reached, an extreme — always
      // stays; the rest drop when dense, and hover grows the nearest one.
      const rest =
        stacked || (denseRows && lit !== true && high === undefined)
          ? 0
          : averaged
            ? 2.5
            : POINT_R;
      g.append('circle')
        .attr('class', 'dgmo-pt')
        .attr('data-series-index', s)
        .attr('data-series-name', name)
        .attr('data-color', own)
        .attr('data-x-index', p.xIndex)
        .attr('data-x-label', p.label)
        .attr(
          'data-value',
          shareRows
            ? `${fmtFor(s)(p.v)} · ${shareText(shareRows[p.xIndex]![s]!)}`
            : p.v
        )
        .attr('data-line-number', p.lineNumber)
        .attr('cx', xOfRow(p.xIndex))
        .attr('cy', yy(p.y))
        // A stacked area, or dense points, mark none at rest (#2203).
        .attr('r', rest)
        .attr('fill', lit ? color : bgColor)
        .attr('stroke', lit === false ? story.groundStroke : color)
        .attr('stroke-width', 2);
      if (high !== undefined)
        extremeMarks.push({
          x: xOfRow(p.xIndex),
          y: yy(p.y),
          high,
          // Just the value (#2213): x says when, the side says high or low.
          text: fmtFor(s)(p.v),
          fill: color,
          color: drawnSeries.length > 1 ? labelColor : textColor,
          // On by default (#2213), so the mark points at its own data row.
          lineNumber: p.lineNumber,
        });
      // Dense (#2209): values follow the dots. Only the latest reading keeps
      // its number; the extremes print their own, and hand it back when
      // their label finds no room.
      if (showValues && (!denseRows || p === last || high !== undefined)) {
        const label = {
          text: fmtFor(s)(p.v),
          cx: xOfRow(p.xIndex),
          cy: yy(p.v),
          v: p.v,
          endpoint: p.xIndex === 0 || p.xIndex === pts.length - 1,
          color: labelColor,
          dim,
        };
        if (high === undefined) valueLabels.push(label);
        else extremeValues.set(extremeMarks.at(-1)!, label);
      }
    }
  }

  const markerLines: LabelRect[] = [];
  // The series' lines and the overlay lines: overlay labels and point
  // values keep off them, not only off the points (#2106).
  const lineTrace = [...sampleLines(polylines), ...overlayTrace];
  eraTitles.push(
    ...drawMarkers(
      svg,
      chart.annotations,
      annotationFrame,
      annotationColors,
      markerLines
    )
  );
  // End-of-line series names (#1950), nudged apart so none prints over
  // another. They are placed before the point values, which clear them.
  if (endLabels) {
    const ends = lineEnds.sort((a, b) => a.s - b.s);
    const ys = resolveVerticalCollisions(
      ends.map((e) => ({ naturalY: e.y, height: END_LABEL_FONT + 2 })),
      1,
      m.top + plotH
    );
    ends.forEach((e, k) => {
      const x = e.x + END_LABEL_GAP;
      const y = ys[k]! + END_LABEL_FONT * 0.35;
      svg
        .append('text')
        .attr('class', 'dgmo-series-end-label')
        .attr('data-series-name', e.name)
        .attr('x', x)
        .attr('y', y)
        .attr('text-anchor', 'start')
        .attr('fill', e.color)
        .attr('font-size', END_LABEL_FONT)
        .attr('font-weight', 600)
        .attr('font-family', FONT_FAMILY)
        .attr('opacity', e.dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
        .text(e.name);
      eraTitles.push({
        ...labelBox(e.name, { x, y, anchor: 'start' }, END_LABEL_FONT),
        w: measureText(e.name, END_LABEL_FONT, { bold: true }),
      });
    });
  }

  // Overlay labels and the extremes share one placement (#2217), after the
  // series names so they clear them too: none
  // prints over another, a point, a data line or an overlay line.
  const overlayPlace = overlayPlacement({
    reserved: eraTitles,
    markers: [
      ...polylines.flat().map(([cx, cy]) => ({ cx, cy, r: 4.5 })),
      ...lineTrace,
      ...extremeMarks.map((e) => ({ cx: e.x, cy: e.y, r: EXTREME_DOT_R })),
    ],
  });
  const plotBounds = {
    left: m.left,
    top: m.top,
    right: m.left + plotW,
    bottom: m.top + plotH,
  };
  // Extremes first: their dots anchor tighter than a line's label can. A
  // peak's value may rise above the plot, as a point value may.
  const extremeBoxes = drawExtremes(
    svg,
    extremeMarks,
    { ...plotBounds, top: 0 },
    bgColor,
    overlayPlace
  );
  for (const mk of extremeMarks) {
    const back = extremeValues.get(mk);
    if (back && !extremeBoxes.labelled.has(mk)) valueLabels.push(back);
  }
  eraTitles.push(
    ...drawOverlayLabels(
      svg,
      overlayLabels,
      annotationFrame,
      bgColor,
      [],
      overlayPlace
    ),
    ...extremeBoxes.boxes
  );

  // Band labels settle now that points, lines and series names are down;
  // notes and point values then clear them where they land (#2137).
  settleBandLabels(svg);

  // Notes (#2039): a ring on the point, the text in clear plot space. Point
  // values yield to them; they stay full strength under `highlight`.
  if (chart.notes?.length && !chart.noNotes) {
    const notes: PlacedNoteDatum[] = chart.notes.flatMap((n) => {
      const v = yValue(n.index, n.series);
      if (!has(v) || boundSeries.has(n.series)) return [];
      return [
        {
          x: xOfRow(n.index),
          y: yFor(n.series)(v),
          r: stacked ? 0 : 3.5,
          text: n.text,
          color: n.color,
          lineNumber: n.lineNumber,
        },
      ];
    });
    eraTitles.push(
      ...drawChartNotes(svg, notes, {
        plot: {
          left: m.left,
          top: m.top,
          right: m.left + plotW,
          bottom: m.top + plotH,
        },
        // The gutter: the right margin, when the plot has no room.
        canvas: {
          left: m.left,
          top: m.top,
          right: width,
          bottom: m.top + plotH,
        },
        reserved: eraTitles,
        obstacles: markerLines,
        markers: [
          ...polylines.flat().map(([cx, cy]) => ({ cx, cy, r: 4.5 })),
          ...sampleLines(polylines),
        ],
        colors: { text: textColor, bg: bgColor },
        palette,
      })
    );
  }

  // Point values (#1828): every series' labels are placed together, so one
  // series' value never prints over another's. A label goes above its point,
  // else below, right, left or a diagonal, clear of the lines (#2106); one
  // with no clear spot is dropped — smallest |value| first — and its value
  // stays on the point's hover.
  const placed = placeLabels(
    valueLabels.map((l) => ({
      text: l.text,
      priority: Math.abs(l.v),
      endpoint: l.endpoint,
      spots: [
        { x: l.cx, y: l.cy - 10, anchor: 'middle' as const },
        { x: l.cx, y: l.cy + 10 + VALUE_FONT * 0.8, anchor: 'middle' as const },
        { x: l.cx + 7, y: l.cy + VALUE_FONT * 0.3, anchor: 'start' as const },
        { x: l.cx - 7, y: l.cy + VALUE_FONT * 0.3, anchor: 'end' as const },
        { x: l.cx - 5, y: l.cy - 8, anchor: 'end' as const },
        { x: l.cx + 5, y: l.cy - 8, anchor: 'start' as const },
        { x: l.cx - 5, y: l.cy + 8 + VALUE_FONT * 0.8, anchor: 'end' as const },
        {
          x: l.cx + 5,
          y: l.cy + 8 + VALUE_FONT * 0.8,
          anchor: 'start' as const,
        },
      ],
    })),
    {
      fontSize: VALUE_FONT,
      tabular: true,
      reserved: eraTitles,
      markers: [
        ...valueLabels.map((l) => ({ cx: l.cx, cy: l.cy, r: 4.5 })),
        ...lineTrace,
      ],
      bounds: {
        // The y tick labels end 10px left of the plot.
        left: m.left - 8,
        top: 0,
        // A dual chart's right axis ticks sit past the plot.
        right: dual ? m.left + plotW : width,
        bottom: m.top + plotH,
      },
    }
  );
  valueLabels.forEach((l, i) => {
    const spot = placed[i]!.spot;
    if (!spot) return;
    drawValueLabel(svg, l.text, spot.x, spot.y, l.color, spot.anchor).attr(
      'opacity',
      l.dim ? EMPHASIS_DIM_TEXT_OPACITY : null
    );
  });

  drawXAxisTitle(
    svg,
    chart.xlabel,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor
  );
  drawYAxisTitle(
    svg,
    chart.ylabel,
    m.top,
    plotH,
    20,
    leftTint ?? textColor,
    top + 8
  );
  if (dual) {
    drawYAxisTitle(
      svg,
      chart.yrlabel,
      m.top,
      plotH,
      width - 18,
      rightTint ?? textColor,
      top + 8
    );

    // Axis-legend hover targets (§ interactions.ts): a transparent strip over
    // each axis's title + ticks. Appended last so each strip is the topmost
    // (single, flicker-free) mouseenter target while the tinted title/ticks
    // still show through. Only for dual-axis — a sole axis owns every series,
    // so hovering it could not distinguish anything. Sits entirely outside the
    // plot's x-range, so it never shadows point/crosshair hover.
    svg
      .append('rect')
      .attr('class', 'dgmo-axis-legend')
      .attr('data-axis-legend', 'left')
      .attr('x', 0)
      .attr('y', m.top)
      .attr('width', m.left)
      .attr('height', plotH)
      .attr('fill', 'transparent')
      .attr('style', 'cursor:pointer');
    svg
      .append('rect')
      .attr('class', 'dgmo-axis-legend')
      .attr('data-axis-legend', 'right')
      .attr('x', m.left + plotW)
      .attr('y', m.top)
      .attr('width', m.right)
      .attr('height', plotH)
      .attr('fill', 'transparent')
      .attr('style', 'cursor:pointer');
  }
}

/** One same-sign stretch of a fill-between: its closed outline, A then B. */
interface FillRun {
  ahead: boolean;
  points: [number, number][];
}

/**
 * Split the gap between A and B (screen y, so smaller is higher) into runs of
 * one sign (#1997). A crossing ends a run at the interpolated point and starts
 * the next there; a row missing either value ends it with no fill across the
 * gap. Under `step` / `step-before` the rows are expanded to the stepped
 * corners first, so a sign change lands on the vertical jump.
 */
export function fillBetweenRuns(
  rows: readonly { x: number; a: number; b: number }[],
  step?: 'after' | 'before'
): FillRun[] {
  const runs: FillRun[] = [];
  const ok = (r: { a: number; b: number }) =>
    Number.isFinite(r.a) && Number.isFinite(r.b);
  // Contiguous defined stretches, expanded to the drawn vertices.
  const stretches: { x: number; a: number; b: number }[][] = [];
  let cur: { x: number; a: number; b: number }[] = [];
  rows.forEach((r, i) => {
    if (!ok(r)) {
      if (cur.length) stretches.push(cur);
      cur = [];
      return;
    }
    const prev = rows[i - 1];
    if (cur.length && prev && step === 'after')
      cur.push({ x: r.x, a: prev.a, b: prev.b });
    else if (cur.length && prev && step === 'before')
      cur.push({ x: prev.x, a: r.a, b: r.b });
    cur.push(r);
  });
  if (cur.length) stretches.push(cur);

  for (const pts of stretches) {
    if (pts.length < 2) continue;
    // A is above B on screen when its y is smaller.
    const sign = (p: { a: number; b: number }) => Math.sign(p.b - p.a);
    let top: [number, number][] = [];
    let bottom: [number, number][] = [];
    let runSign = 0;
    const close = () => {
      if (top.length >= 2 && runSign !== 0)
        runs.push({
          ahead: runSign > 0,
          points: [...top, ...bottom.reverse()],
        });
      top = [];
      bottom = [];
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const sg = sign(p);
      const q = pts[i - 1];
      if (q && sign(q) !== 0 && sg !== 0 && sign(q) !== sg) {
        // Crossing between q and p: where (b - a) reaches zero.
        const dq = q.b - q.a;
        const t = dq / (dq - (p.b - p.a));
        const c: [number, number] = [
          q.x + t * (p.x - q.x),
          q.a + t * (p.a - q.a),
        ];
        top.push(c);
        bottom.push(c);
        close();
        top.push(c);
        bottom.push(c);
        runSign = 0;
      }
      top.push([p.x, p.a]);
      bottom.push([p.x, p.b]);
      if (runSign === 0) runSign = sg;
      // Touching without crossing: end the run here and start the next.
      if (sg === 0 && top.length >= 2) {
        close();
        top.push([p.x, p.a]);
        bottom.push([p.x, p.b]);
        runSign = 0;
      }
    }
    close();
  }
  return runs;
}

/** A closed SVG polygon through `points`. */
function polygonPath(points: readonly [number, number][]): string {
  return (
    points
      .map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)},${round(y)}`)
      .join('') + 'Z'
  );
}

const round = (n: number): number => Math.round(n * 100) / 100;
