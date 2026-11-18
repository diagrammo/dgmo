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

import { scaleBand } from 'd3-scale';
import { buildValueAxis } from './value-axis';
import { max as d3max, min as d3min } from 'd3-array';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { contrastText, shapeFill, themeBaseBg } from '../palettes/color-utils';
import { annotationValues } from '../annotations/parse';
import { divergingSpans } from '../utils/diverging';
import { shareText, toShares } from '../utils/stack-share';
import { tabularText } from '../utils/tabular-figures';
import {
  drawBands,
  drawMarkers,
  type ValueAxisFrame,
} from '../annotations/draw';
import { drawChartNotes, type PlacedNoteDatum } from '../annotations/notes';
import {
  drawOverlayLabels,
  drawOverlayLevels,
  drawOverlayPaths,
  overlayLevels,
  targetOf,
  trendPaths,
  trendUnit,
} from '../overlays/draw';
import { paretoCumulative, reachesTarget } from '../overlays/compute';
import { GRID_DASH } from '../utils/visual-conventions';
import { labelBox } from '../utils/place-labels';
import { mix } from '../palettes/color-utils';
import { fitLabel, type FittedLabel } from '../utils/fit-label';
import { measureText } from '../utils/text-measure';
import { createLabelPlacement, type LabelRect } from '../label-layout';
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
/** Most lines a clustered-stack period or category name wraps to. */
const CLUSTER_LABEL_MAX_LINES = 4;
/** Largest lollipop dot radius; thinner bands get a smaller dot (#1979). */
const LOLLIPOP_DOT_MAX = 6;
/** Lollipop stem width. */
const LOLLIPOP_STEM = 2;
/** `pareto` (#1954): gap between the plot and the right percent ticks. */
const PARETO_TICK_GAP = 10;
/** `pareto`: the dashed guide's share, the 80 of 80/20. */
const PARETO_GUIDE = 80;

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
  if (chart.widths) {
    renderMarimekko(
      svg,
      chart,
      width,
      height,
      colors,
      palette,
      isDark,
      textColor,
      mutedColor,
      hasTitle,
      inlineTitle
    );
    return;
  }
  if (chart.clusters?.length) {
    renderClusteredStack(
      svg,
      chart,
      width,
      height,
      colors,
      palette,
      isDark,
      textColor,
      mutedColor,
      hasTitle,
      inlineTitle
    );
    return;
  }
  const data = chart.data;
  const seriesNames = chart.seriesNames?.length
    ? chart.seriesNames
    : [chart.series ?? ''];
  const stacked = chart.barLayout === 'stack';
  // `stack diverging` (#1980): segments sit either side of 0 around the
  // neutral series, and every printed number is a magnitude.
  const diverging = stacked && !!chart.diverging;
  // `stack 100%` (#1846): every bar is drawn as shares of its own total.
  const percent = stacked && !diverging && !!chart.stackPercent;
  const spansOf = (vals: number[]) => divergingSpans(vals, chart.neutralSeries);
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
  const emphasis = resolveEmphasis(chart.emphasis, [
    ...data.map((d) => d.label),
    ...(multiSeries ? seriesNames : []),
  ]);
  const { dimmed } = emphasis;
  // `target N` (#1954): a bar that reaches it is lit, the rest recede.
  const target = stacked ? undefined : targetOf(chart.overlays);
  const missesTarget = (v: number) =>
    !!target && !reachesTarget(v, target.value!, target.below);
  const recedes = (category: string, series: string, v: number) =>
    (dimmed.has(category) && (!multiSeries || dimmed.has(series))) ||
    missesTarget(v);
  // Story view (#2046): the subject is solid, the rest one grey ground.
  const story0 = storyPaint(emphasis, palette, isDark);
  const story = target ? { ...story0, active: true } : story0;

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

  const rawCat = data.map((d) => seriesValues(d, seriesCount));
  const perCat = percent ? rawCat.map(toShares) : rawCat;
  // Stacked bars accumulate positive and negative values into separate runs,
  // so the extents are the per-category positive sum and negative sum.
  const maxVal = diverging
    ? (d3max(perCat, (vals) => d3max(spansOf(vals), (s) => s[1]) ?? 0) ?? 0)
    : stacked
      ? (d3max(perCat, (vals) =>
          vals.filter((v) => v > 0).reduce((a, b) => a + b, 0)
        ) ?? 0)
      : (d3max(perCat, (vals) => d3max(vals) ?? 0) ?? 0);
  const minVal = diverging
    ? (d3min(perCat, (vals) => d3min(spansOf(vals), (s) => s[0]) ?? 0) ?? 0)
    : stacked
      ? (d3min(perCat, (vals) =>
          vals.filter((v) => v < 0).reduce((a, b) => a + b, 0)
        ) ?? 0)
      : (d3min(perCat, (vals) => d3min(vals) ?? 0) ?? 0);
  // Domain always includes 0 (bars encode magnitude from a 0 baseline); with
  // negative data it extends below so bars grow either direction from 0.
  // A `marker` or `band` (#1832) beyond the data widens the axis to it.
  const marked = [
    ...annotationValues(chart.annotations),
    ...(target ? [target.value!] : []),
  ];
  const hiVal = Math.max(0, maxVal, ...marked);
  const loVal = Math.min(0, minVal, ...marked);
  const niceMax = hiVal === 0 && loVal === 0 ? 1 : hiVal;
  // Value axis (#1830): `y-scale log`, `y-min`, `y-max`. Built once on a unit
  // range to size the margin from its real tick labels, then on the plot.
  const ySpec = chart.axes?.y;
  const valueAxis = (range: [number, number]) =>
    buildValueAxis(loVal, niceMax, ySpec, range, {
      nice: true,
      dataLo: Math.min(...[...perCat.flat(), ...marked].filter((v) => v > 0)),
      dataHi: Math.max(maxVal, ...marked),
    });
  const probeTicks = valueAxis([0, 1]).ticks(6);
  // The author's `format` / `unit` / `locale` (#1831), one compact unit for
  // the whole value axis (#2036).
  const fmt = chartFormatter(
    chart,
    diverging ? probeTicks.map(Math.abs) : probeTicks
  );

  // Left margin must fit the rotated y-title + the left-edge labels: category
  // names for horizontal bars, value ticks for vertical.
  const catLabels = data.map((d) => d.label);
  // A diverging axis reads positive both ways from 0.
  const tickFmt = diverging
    ? (t: number) => fmt(Math.abs(t))
    : percent
      ? (t: number) => `${Math.round(t * 100) / 100}%`
      : fmt;
  const valueTicks = probeTicks.map(tickFmt);
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
  // `pareto` (#1954): columns only, with a 0–100% axis in the right margin.
  const pareto =
    !stacked && !grouped && !!chart.overlays?.some((o) => o.kind === 'pareto');
  const mRight = pareto
    ? Math.max(32, measureText('100%', TICK_FONT) + PARETO_TICK_GAP + 8)
    : 32;
  const verticalFit = authoredHorizontal
    ? null
    : planLabelsFitLeft(
        catLabels,
        computeLeftMargin(chart.ylabel, valueTicks, { tabular: true }),
        (ml) => width - ml - mRight,
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
    !pareto &&
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
    : computeLeftMargin(chart.ylabel, valueTicks, { tabular: true });
  const fit = horizontal ? null : verticalFit;
  const mLeft = fit ? fit.mLeft : mLeft0;
  const plotW = fit ? fit.plotW : width - mLeft - mRight;
  const labelPlan = fit?.plan ?? planCategoryLabels(catLabels, Infinity);
  const shown = fit?.shown ?? catLabels;
  const m: Margins = {
    top: mTop,
    right: mRight,
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
  const val = valueAxis(valRange);
  const annotationFrame: ValueAxisFrame = {
    pos: (v) => val(v),
    domain: val.domain(),
    left: m.left,
    top: m.top,
    width: plotW,
    height: plotH,
    horizontal: horiz,
    crossPos: (at) => {
      if (typeof at !== 'string') return undefined;
      const b = cat(at);
      return b === undefined ? undefined : b + cat.bandwidth() / 2;
    },
  };
  const annotationColors = {
    text: textColor,
    muted: palette.textMuted,
    bg: themeBaseBg(palette, isDark),
  };
  drawBands(svg, chart.annotations, annotationFrame, annotationColors);

  // Eras (#2039): a span across whole categories, as on line.
  const eraTitles: LabelRect[] = [];
  (chart.eras ?? []).forEach((era, i) => {
    const a = cat(era.start);
    const b = cat(era.end);
    if (a === undefined || b === undefined) return;
    const s0 = Math.min(a, b) - (cat.step() * cat.paddingInner()) / 2;
    const s1 =
      Math.max(a, b) + cat.bandwidth() + (cat.step() * cat.paddingInner()) / 2;
    const fill = era.color ?? colors[i % colors.length]!;
    const g = svg
      .append('g')
      .attr('class', 'dgmo-era')
      .attr('data-line-number', era.lineNumber);
    g.append('rect')
      .attr('x', horiz ? m.left : s0)
      .attr('y', horiz ? s0 : m.top)
      .attr('width', horiz ? plotW : s1 - s0)
      .attr('height', horiz ? s1 - s0 : plotH)
      .attr('fill', mix(fill, annotationColors.bg, 12));
    if (!era.label) return;
    const spot = horiz
      ? { x: m.left + plotW - 4, y: s0 + 14, anchor: 'end' as const }
      : { x: (s0 + s1) / 2, y: m.top + 14, anchor: 'middle' as const };
    g.append('text')
      .attr('x', spot.x)
      .attr('y', spot.y)
      .attr('text-anchor', spot.anchor)
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .attr('opacity', 0.8)
      .text(era.label);
    eraTitles.push(labelBox(era.label, spot, TICK_FONT));
  });

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
        .attr('stroke-opacity', t === val.baseline ? 0.6 : 0.25);
      svg
        .append('text')
        .attr('x', x)
        .attr('y', m.top + plotH + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .call(tabularText(tickFmt(t), TICK_FONT));
    } else {
      const y = val(t);
      svg
        .append('line')
        .attr('x1', m.left)
        .attr('x2', m.left + plotW)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', mutedColor)
        .attr('stroke-opacity', t === val.baseline ? 0.6 : 0.25);
      svg
        .append('text')
        .attr('x', m.left - 10)
        .attr('y', y + 4)
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .call(tabularText(tickFmt(t), TICK_FONT));
    }
  }

  // Statistics overlays (#1954): one mean / median / trend per series, in
  // its colour on a multi-series bar, behind the bars.
  const overlays = stacked ? undefined : chart.overlays;
  const overlaySeries = Array.from({ length: seriesCount }, (_, s) => ({
    ...(multiSeries && { name: seriesNames[s] ?? '' }),
    values: rawCat.map((vals) => vals[s]!),
    color: multiSeries ? colorFor(s, 1) : textColor,
  }));
  const overlayLabels = [
    ...drawOverlayLevels(
      svg,
      overlayLevels(overlays, overlaySeries, fmt, palette.colors.red),
      annotationFrame
    ),
    ...drawOverlayPaths(
      svg,
      trendPaths(
        overlays,
        overlaySeries,
        (i) => (cat(data[i]!.label) ?? 0) + cat.bandwidth() / 2,
        fmt,
        trendUnit(chart.xlabel)
      ),
      annotationFrame
    ),
  ];

  // `pareto`: the right percent axis and the dashed 80% guide, behind the
  // bars. The cumulative line goes on top, once the bars are down.
  const paretoOverlay = pareto
    ? chart.overlays!.find((o) => o.kind === 'pareto')!
    : undefined;
  const pctY = (p: number) => m.top + plotH - (p / 100) * plotH;
  if (paretoOverlay) {
    const g = svg
      .append('g')
      .attr('class', 'dgmo-overlay dgmo-overlay-pareto-axis')
      .attr('data-line-number', paretoOverlay.lineNumber);
    for (let t = 0; t <= 100; t += 20)
      g.append('text')
        .attr('x', m.left + plotW + PARETO_TICK_GAP)
        .attr('y', pctY(t) + 4)
        .attr('text-anchor', 'start')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .call(tabularText(`${t}%`, TICK_FONT));
    g.append('line')
      .attr('class', 'dgmo-pareto-guide')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', pctY(PARETO_GUIDE))
      .attr('y2', pctY(PARETO_GUIDE))
      .attr('stroke', palette.colors.red)
      .attr('stroke-width', 1.25)
      .attr('stroke-dasharray', GRID_DASH);
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

  const zero = val(val.baseline);
  const inner = stacked
    ? null
    : scaleBand<number>()
        .domain(seriesNames.map((_, i) => i))
        .range([0, cat.bandwidth()])
        .padding(0.12);
  // `lollipop` (#1979): a stem from 0 to the value with a dot on its end.
  // The parser has already refused it on a stack.
  const lollipop = !!chart.lollipop && inner !== null;
  const dotR = inner
    ? Math.max(3, Math.min(LOLLIPOP_DOT_MAX, inner.bandwidth() / 2))
    : 0;
  const pad = lollipop ? dotR : 0;

  // Where a side-by-side bar's value label goes. Negative bars grow left (or
  // down): the label sits off the bar's free end, flipped inside the bar when
  // it would leave the plot (the extreme bar ends exactly at the plot edge and
  // would hit the category name).
  const valueSpot = (base: number, s: number, v: number): ValueSpot => {
    const off = inner!(s) ?? 0;
    const bw = inner!.bandwidth();
    const text = fmt(v);
    if (horiz) {
      const x1 = val(v);
      const approxW = text.length * 7 + 6;
      const inside =
        v < 0
          ? x1 - pad - approxW < m.left
          : x1 + pad + approxW > m.left + plotW;
      const o = 6 + pad;
      return {
        text,
        x: v < 0 ? (inside ? x1 + o : x1 - o) : inside ? x1 - o : x1 + o,
        y: base + off + bw / 2 + 4,
        anchor: v < 0 !== inside ? 'end' : 'start',
        keep: true,
      };
    }
    const y1 = val(v);
    const yOut = v < 0 ? y1 + 14 + pad : y1 - 6 - pad;
    const yInside = v < 0 ? yOut > m.top + plotH - 2 : yOut < m.top + 2;
    return {
      text,
      x: base + off + bw / 2,
      y: yInside ? (v < 0 ? y1 - 6 - pad : y1 + 14 + pad) : yOut,
      anchor: 'middle',
      keep: true,
    };
  };

  /** Where each bar ends (`category:series`), for a note's ring (#2039). */
  const noteAt = new Map<string, [number, number]>();
  const svgNode = svg.node();
  const drawnBefore = svgNode ? svgNode.childNodes.length : 0;
  data.forEach((d, di) => {
    const base = cat(d.label) ?? 0;
    // Geometry values (shares under `stack 100%`); the source's own numbers.
    const vals = perCat[di]!;
    const raw = rawCat[di]!;
    // One category's labels collide when its bars are thinner than the type:
    // the larger value keeps its label, a smaller one that would touch it is
    // dropped (#1828). Its value stays on the bar's hover.
    const spots = stacked
      ? []
      : dropColliding(
          vals.map((v, s) => valueSpot(base, s, v)),
          vals
        );
    const dSpans = diverging ? spansOf(vals) : null;
    let accPos = 0;
    let accNeg = 0;
    vals.forEach((v, s) => {
      const own = colorFor(s, v, seriesCount === 1 ? d.color : undefined);
      const sName = seriesNames[s] ?? '';
      const recede = recedes(d.label, sName, v);
      const stroke = !story.active
        ? own
        : recede
          ? story.groundStroke
          : story.subject(own);
      const fill = !story.active
        ? fillOf(own)
        : recede
          ? story.groundFill
          : stroke;
      // Story view bakes the grey into the paint; only `dim` uses opacity.
      const dim = recede && !story.active;
      const labelColor = !story.active
        ? textColor
        : recede
          ? story.groundText
          : textColor;
      // A stacked label sits on its segment, which is solid when lit.
      const onBarColor =
        story.active && !recede
          ? contrastText(fill, palette.textOnFillLight, palette.textOnFillDark)
          : labelColor;
      const tag = {
        line: d.lineNumber,
        key: multiSeries ? sName : d.label,
        name: multiSeries ? `${d.label} · ${sName}` : d.label,
        value: percent
          ? `${fmt(raw[s]!)} · ${shareText(v)}`
          : diverging
            ? Math.abs(v)
            : v,
        color: own,
        seriesName: multiSeries ? sName : undefined,
      };
      if (stacked) {
        // Positive segments stack up/right from 0, negative segments stack
        // down/left — the diverging-stack convention.
        const acc = v < 0 ? accNeg : accPos;
        const [from, to] = dSpans ? dSpans[s]! : [acc, acc + v];
        const mid = base + cat.bandwidth() / 2;
        noteAt.set(`${di}:${s}`, horiz ? [val(to), mid] : [mid, val(to)]);
        const segText = percent
          ? shareText(v)
          : fmt(diverging ? Math.abs(v) : v);
        if (horiz) {
          const x0 = val(from);
          const x1 = val(to);
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
              segText,
              (x0 + x1) / 2,
              base + cat.bandwidth() / 2 + 4,
              onBarColor
            ).attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
        } else {
          const y0 = val(from);
          const y1 = val(to);
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
              segText,
              base + cat.bandwidth() / 2,
              (y0 + y1) / 2 + 4,
              onBarColor
            ).attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
        }
        if (v < 0) accNeg += v;
        else accPos += v;
      } else {
        const off = inner!(s) ?? 0;
        const bw = inner!.bandwidth();
        const mid = base + off + bw / 2;
        noteAt.set(`${di}:${s}`, horiz ? [val(v), mid] : [mid, val(v)]);
        if (lollipop) {
          const c = base + off + bw / 2;
          const end = val(v);
          stemAndDot(
            svg,
            horiz ? [zero, c, end, c] : [c, zero, c, end],
            dotR,
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
              labelColor,
              spot.anchor
            ).attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
        } else if (horiz) {
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
              labelColor,
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
              labelColor,
              spot.anchor
            ).attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
        }
      }
    });
  });

  // `pareto`: the cumulative share, one point per bar, labelled above.
  const paretoLabels: LabelRect[] = [];
  if (paretoOverlay) {
    const cum = paretoCumulative(rawCat.map((vals) => vals[0]!));
    const at = data.map(
      (d, i) =>
        [(cat(d.label) ?? 0) + cat.bandwidth() / 2, pctY(cum[i]!)] as const
    );
    const g = svg
      .append('g')
      .attr('class', 'dgmo-overlay dgmo-overlay-pareto')
      .attr('data-line-number', paretoOverlay.lineNumber);
    g.append('path')
      .attr('d', at.map(([x, y], k) => `${k ? 'L' : 'M'}${x},${y}`).join(''))
      .attr('fill', 'none')
      .attr('stroke', textColor)
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round');
    let lastRight = -Infinity;
    at.forEach(([x, y], i) => {
      g.append('circle')
        .attr('class', 'dgmo-pareto-pt')
        .attr('data-value', `${Math.round(cum[i]!)}%`)
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', 3.5)
        .attr('fill', annotationColors.bg)
        .attr('stroke', textColor)
        .attr('stroke-width', 2);
      // The last point is always 100%; the axis already says so.
      if (i === at.length - 1) return;
      const text = `${Math.round(cum[i]!)}%`;
      const w = measureText(text, VALUE_FONT);
      if (x - w / 2 < lastRight + 4) return;
      lastRight = x + w / 2;
      const ty = y - 8;
      g.append('text')
        .attr('class', 'dgmo-pareto-label')
        .attr('x', x)
        .attr('y', ty)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', VALUE_FONT)
        .attr('font-weight', 600)
        .attr('font-family', FONT_FAMILY)
        .attr('stroke', annotationColors.bg)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke')
        .call(tabularText(text, VALUE_FONT));
      paretoLabels.push({ x: x - w / 2, y: ty - VALUE_FONT, w, h: VALUE_FONT });
    });
  }

  const markerLabels = [
    ...paretoLabels,
    ...drawMarkers(svg, chart.annotations, annotationFrame, annotationColors),
    ...drawOverlayLabels(
      svg,
      overlayLabels,
      annotationFrame,
      annotationColors.bg
    ),
  ];

  // Notes (#2039): a ring on the bar's end, the text in clear plot space.
  // A value label a note lands on yields to it.
  if (chart.notes?.length && !chart.noNotes && svgNode) {
    const drawn = Array.from(svgNode.childNodes).slice(
      drawnBefore
    ) as Element[];
    const num = (e: Element, a: string) => Number(e.getAttribute(a) ?? 0);
    const obstacles: LabelRect[] = [];
    const values: { el: Element; box: LabelRect }[] = [];
    for (const e of drawn) {
      const tag = e.tagName.toLowerCase();
      if (tag === 'rect')
        obstacles.push({
          x: num(e, 'x'),
          y: num(e, 'y'),
          w: num(e, 'width'),
          h: num(e, 'height'),
        });
      else if (tag === 'circle') {
        const r = num(e, 'r');
        obstacles.push({
          x: num(e, 'cx') - r,
          y: num(e, 'cy') - r,
          w: 2 * r,
          h: 2 * r,
        });
      } else if (tag === 'text')
        values.push({
          el: e,
          box: labelBox(
            e.textContent ?? '',
            {
              x: num(e, 'x'),
              y: num(e, 'y'),
              anchor:
                (e.getAttribute('text-anchor') as 'start' | 'middle' | 'end') ??
                'middle',
            },
            VALUE_FONT
          ),
        });
    }
    const notes: PlacedNoteDatum[] = chart.notes.flatMap((n) => {
      const at = noteAt.get(`${n.index}:${n.series}`);
      return at
        ? [
            {
              x: at[0],
              y: at[1],
              r: 0,
              text: n.text,
              color: n.color,
              lineNumber: n.lineNumber,
            },
          ]
        : [];
    });
    const boxes = drawChartNotes(svg, notes, {
      plot: {
        left: m.left,
        top: m.top,
        right: m.left + plotW,
        bottom: m.top + plotH,
      },
      canvas: {
        left: m.left,
        top: m.top,
        right: width,
        bottom: m.top + plotH,
      },
      reserved: [...eraTitles, ...markerLabels],
      obstacles,
      colors: { text: textColor, bg: annotationColors.bg },
      palette,
    });
    const hits = (a: LabelRect, b: LabelRect) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const v of values)
      if (boxes.some((b) => hits(b, v.box))) v.el.remove();
  }

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
    value: number | string;
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

/**
 * One lollipop (#1979): a stem from the 0 baseline to the value, and a dot
 * on its end. The dot carries the datum; the stem shares its line number so
 * a click on either lands on the row, and both recede under `highlight`.
 */
function stemAndDot(
  svg: Svg,
  [x1, y1, x2, y2]: [number, number, number, number],
  r: number,
  fill: string,
  stroke: string,
  tag: {
    line: number;
    key: string;
    name: string;
    value: number | string;
    color: string;
    seriesName?: string | undefined;
  },
  dim: boolean
): void {
  const stem = svg
    .append('line')
    .attr('class', 'dgmo-lollipop-stem')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', stroke)
    .attr('stroke-width', LOLLIPOP_STEM)
    .attr('data-line-number', tag.line)
    .attr('data-emph-key', tag.key);
  if (tag.seriesName != null) stem.attr('data-series-name', tag.seriesName);
  const dot = svg
    .append('circle')
    .attr('class', 'dgmo-lollipop-dot')
    .attr('cx', x2)
    .attr('cy', y2)
    .attr('r', r)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 1.5);
  if (dim) {
    stem.attr('opacity', EMPHASIS_DIM_OPACITY);
    dot.attr('opacity', EMPHASIS_DIM_OPACITY);
  }
  tagDatum(dot, tag);
}

/** Gap between a cluster's period labels and its bracket. */
const BRACKET_GAP = 6;
/** Height of a bracket's end ticks. */
const BRACKET_TICK = 5;

/**
 * Clustered-stacked columns (#1879): one stacked column per period inside
 * each category, on a two-level axis — the period under each column, a
 * bracket and the category name under each cluster. Periods line up across
 * categories; a missing one leaves its slot empty. Colour is the series
 * only. `stack 100%` scales each column on its own.
 */
function renderClusteredStack(
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
  const clusters = chart.clusters!.map((c) => c.label);
  // Periods line up across categories by name. When no name is shared (each
  // category has its own rows) they line up by position instead, so a
  // category's width follows its own row count, not every name in the chart.
  const periodNames = chart.periods ?? [];
  const sharedPeriods = periodNames.some(
    (p) => chart.data.filter((d) => d.label === p).length > 1
  );
  const rowIndex = new Map<(typeof chart.data)[number], number>();
  {
    const seen = new Map<string, number>();
    for (const d of chart.data) {
      const k = seen.get(d.cluster!) ?? 0;
      rowIndex.set(d, k);
      seen.set(d.cluster!, k + 1);
    }
  }
  const slotOf = (d: (typeof chart.data)[number]): string =>
    sharedPeriods ? d.label : String(rowIndex.get(d) ?? 0);
  const periods = sharedPeriods
    ? periodNames
    : Array.from(
        { length: Math.max(0, ...[...rowIndex.values()].map((i) => i + 1)) },
        (_, i) => String(i)
      );
  const seriesNames = chart.seriesNames?.length
    ? chart.seriesNames
    : [chart.series ?? ''];
  const seriesCount = Math.max(
    1,
    seriesNames.length,
    1 + Math.max(0, ...chart.data.map((d) => d.extraValues?.length ?? 0))
  );
  const percent = !!chart.stackPercent;
  const columns = chart.data.map((d) => {
    const raw = seriesValues(d, seriesCount);
    return { d, raw, vals: percent ? toShares(raw) : raw };
  });

  const colorOf = (s: number): string =>
    chart.seriesNameColors?.[s] ?? colors[s % colors.length]!;
  const emphasis = resolveEmphasis(chart.emphasis, [
    ...clusters,
    ...seriesNames,
  ]);
  const { dimmed } = emphasis;
  const story = storyPaint(emphasis, palette, isDark);

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

  // Positive and negative runs stack apart, as on a plain stacked bar.
  const sum = (vals: number[], sign: 1 | -1) =>
    vals.filter((v) => v * sign > 0).reduce((a, b) => a + b, 0);
  const marked = annotationValues(chart.annotations);
  const hiVal = Math.max(0, ...columns.map((c) => sum(c.vals, 1)), ...marked);
  const loVal = Math.min(0, ...columns.map((c) => sum(c.vals, -1)), ...marked);
  const ySpec = chart.axes?.y;
  const valueAxis = (range: [number, number]) =>
    buildValueAxis(
      loVal,
      hiVal === 0 && loVal === 0 ? 1 : hiVal,
      ySpec,
      range,
      {
        nice: true,
      }
    );
  // One compact unit for the whole value axis (#2036).
  const fmt = chartFormatter(chart, valueAxis([0, 1]).ticks(6));
  const tickFmt = percent
    ? (t: number) => `${Math.round(t * 100) / 100}%`
    : fmt;
  const probeTicks = valueAxis([0, 1]).ticks(6).map(tickFmt);

  const m: Margins = {
    top: top + 8,
    right: 32,
    bottom: 0, // set below, once the wrapped labels' line counts are known
    left: computeLeftMargin(chart.ylabel, probeTicks, { tabular: true }),
  };
  const plotW = width - m.left - m.right;
  const outer = scaleBand<string>()
    .domain(clusters)
    .range([m.left, m.left + plotW])
    .paddingInner(0.18)
    .paddingOuter(0.1);
  const inner = scaleBand<string>()
    .domain(periods)
    .range([0, outer.bandwidth()])
    .padding(0.12);
  // Period names wrap to their column's step, category names to their
  // cluster's: the label never sets the spacing, the data does. Each takes
  // at most CLUSTER_LABEL_MAX_LINES lines, then ends in `…`.
  const periodFit = new Map<string, FittedLabel>();
  for (const d of chart.data)
    periodFit.set(
      `${d.cluster}\u0000${d.label}`,
      fitLabel(d.label, TICK_FONT, inner.step(), CLUSTER_LABEL_MAX_LINES)
    );
  const clusterFit = new Map(
    clusters.map((c) => [
      c,
      fitLabel(c, TICK_FONT, outer.step(), CLUSTER_LABEL_MAX_LINES),
    ])
  );
  const periodLines = Math.max(
    1,
    ...[...periodFit.values()].map((f) => f.lines.length)
  );
  const clusterLines = Math.max(
    1,
    ...[...clusterFit.values()].map((f) => f.lines.length)
  );
  m.bottom =
    TICK_FONT +
    (periodLines - 1) * NAME_LINE_PX +
    BRACKET_GAP +
    BRACKET_TICK +
    8 +
    TICK_FONT +
    (clusterLines - 1) * NAME_LINE_PX +
    10 +
    (chart.xlabel ? 40 : 18);
  const plotH = height - m.top - m.bottom;
  const val = valueAxis([m.top + plotH, m.top]);
  const annotationFrame: ValueAxisFrame = {
    pos: (v) => val(v),
    domain: val.domain(),
    left: m.left,
    top: m.top,
    width: plotW,
    height: plotH,
    horizontal: false,
  };
  const annotationColors = {
    text: textColor,
    muted: palette.textMuted,
    bg: themeBaseBg(palette, isDark),
  };
  drawBands(svg, chart.annotations, annotationFrame, annotationColors);

  for (const t of val.ticks(6)) {
    const y = val(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === val.baseline ? 0.6 : 0.25);
    svg
      .append('text')
      .attr('x', m.left - 10)
      .attr('y', y + 4)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .call(tabularText(tickFmt(t), TICK_FONT));
  }

  // Two-level axis: periods under each column, then a bracket and the
  // category name under each cluster.
  const axisY = m.top + plotH;
  const periodY = axisY + TICK_FONT + 6;
  const bracketY = periodY + (periodLines - 1) * NAME_LINE_PX + BRACKET_GAP;
  const nameY = bracketY + BRACKET_TICK + 4 + TICK_FONT;
  const label = (
    text: string,
    fitted: FittedLabel,
    x: number,
    y: number,
    cls: string,
    weight?: number
  ) => {
    const { lines, truncated } = fitted;
    const t = svg
      .append('text')
      .attr('class', cls)
      .attr('x', x)
      .attr('y', y)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY);
    if (lines.length === 1) t.text(lines[0]!);
    else
      lines.forEach((line, k) =>
        t
          .append('tspan')
          .attr('x', x)
          .attr('dy', k === 0 ? 0 : NAME_LINE_PX)
          .text(line)
      );
    if (weight) t.attr('font-weight', weight);
    // A cut name keeps its full text for assistive tech, not as a tooltip.
    if (truncated) t.attr('aria-label', text);
  };
  for (const c of clusters) {
    const x0 = outer(c) ?? 0;
    const x1 = x0 + outer.bandwidth();
    for (const d of chart.data)
      if (d.cluster === c)
        label(
          d.label,
          periodFit.get(`${c}\u0000${d.label}`)!,
          x0 + (inner(slotOf(d)) ?? 0) + inner.bandwidth() / 2,
          periodY,
          'dgmo-period-label'
        );
    svg
      .append('path')
      .attr('class', 'dgmo-cluster-bracket')
      .attr('d', `M${x0},${bracketY} v${BRACKET_TICK} H${x1} v${-BRACKET_TICK}`)
      .attr('fill', 'none')
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.6);
    label(
      c,
      clusterFit.get(c)!,
      (x0 + x1) / 2,
      nameY,
      'dgmo-cluster-label',
      600
    );
  }

  const multi = seriesCount > 1;
  for (const { d, raw, vals } of columns) {
    const x = (outer(d.cluster!) ?? 0) + (inner(slotOf(d)) ?? 0);
    const w = inner.bandwidth();
    let accPos = 0;
    let accNeg = 0;
    vals.forEach((v, s) => {
      const sName = seriesNames[s] ?? '';
      const own = colorOf(s);
      const recede = dimmed.has(d.cluster!) && (!multi || dimmed.has(sName));
      const stroke = !story.active
        ? own
        : recede
          ? story.groundStroke
          : story.subject(own);
      const fill = !story.active
        ? shapeFill(palette, own, isDark, { mode: chart.fillMode })
        : recede
          ? story.groundFill
          : stroke;
      const dim = recede && !story.active;
      const from = v < 0 ? accNeg : accPos;
      const to = from + v;
      const y0 = val(from);
      const y1 = val(to);
      rect(
        svg,
        x,
        Math.min(y0, y1),
        w,
        Math.abs(y1 - y0),
        fill,
        stroke,
        {
          line: d.lineNumber,
          key: multi ? sName : d.cluster!,
          name: [d.cluster, d.label, multi ? sName : '']
            .filter(Boolean)
            .join(' · '),
          value: percent ? `${fmt(raw[s]!)} · ${shareText(v)}` : v,
          color: own,
          seriesName: multi ? sName : undefined,
        },
        dim
      );
      const text = percent ? shareText(v) : fmt(v);
      if (
        !chart.noValue &&
        Math.abs(y1 - y0) > 18 &&
        measureText(text, VALUE_FONT) + 4 <= w
      ) {
        const onBar =
          story.active && !recede
            ? contrastText(
                fill,
                palette.textOnFillLight,
                palette.textOnFillDark
              )
            : story.active
              ? story.groundText
              : textColor;
        drawValueLabel(svg, text, x + w / 2, (y0 + y1) / 2 + 4, onBar).attr(
          'opacity',
          dim ? EMPHASIS_DIM_TEXT_OPACITY : null
        );
      }
      if (v < 0) accNeg += v;
      else accPos += v;
    });
  }

  drawMarkers(svg, chart.annotations, annotationFrame, annotationColors);
  drawXAxisTitle(svg, chart.xlabel, m.left + plotW / 2, nameY + 30, textColor);
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}

/** Gap between a Marimekko column's top and its width label. */
const WIDTH_LABEL_GAP = 6;

/**
 * Marimekko (`widths`, #1872): touching columns whose widths are the rows'
 * first numbers, each filled to 100% by its segments. The width sits above
 * each column, the name below; the y axis is the share of the column and the
 * x axis the cumulative share of the whole. A segment's hover gives its share
 * of the column, its share of the whole (its area), and its value.
 */
function renderMarimekko(
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
  const fmt = chartFormatter(chart);
  const seriesNames = chart.seriesNames?.length
    ? chart.seriesNames
    : [chart.series ?? ''];
  const seriesCount = Math.max(1, seriesNames.length);
  const share = chart.widths === 'share';
  const total = chart.data.reduce((a, d) => a + (d.width ?? 0), 0) || 1;
  const columns = chart.data.map((d) => {
    const raw = seriesValues(d, seriesCount);
    return { d, raw, vals: toShares(raw), w: (d.width ?? 0) / total };
  });

  const colorOf = (s: number): string =>
    chart.seriesNameColors?.[s] ?? colors[s % colors.length]!;
  const emphasis = resolveEmphasis(chart.emphasis, [
    ...chart.data.map((d) => d.label),
    ...seriesNames,
  ]);
  const { dimmed } = emphasis;
  const story = storyPaint(emphasis, palette, isDark);

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

  const pct = (t: number) => `${Math.round(t * 100) / 100}%`;
  const valueAxis = (range: [number, number]) =>
    buildValueAxis(0, 100, undefined, range, { nice: true });
  const probeTicks = valueAxis([0, 1]).ticks(5).map(pct);

  const m: Margins = {
    top: top + 8 + TICK_FONT + WIDTH_LABEL_GAP,
    right: 32,
    bottom: TICK_FONT + 6 + 8 + TICK_FONT + 10 + (chart.xlabel ? 40 : 18),
    left: computeLeftMargin(chart.ylabel, probeTicks),
  };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const val = valueAxis([m.top + plotH, m.top]);
  const xAt = (cum: number) => m.left + cum * plotW;

  for (const t of val.ticks(5)) {
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
      .text(pct(t));
  }

  // x axis: cumulative share of the whole, 0–100%.
  const axisY = m.top + plotH;
  const tickY = axisY + TICK_FONT + 6;
  const nameY = tickY + 8 + TICK_FONT;
  for (const t of [0, 25, 50, 75, 100]) {
    const x = xAt(t / 100);
    svg
      .append('line')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', axisY)
      .attr('y2', axisY + 4)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.6);
    svg
      .append('text')
      .attr('class', 'dgmo-mekko-tick')
      .attr('x', x)
      .attr('y', tickY)
      .attr('text-anchor', t === 0 ? 'start' : t === 100 ? 'end' : 'middle')
      .attr('fill', palette.textMuted)
      .attr('font-size', TICK_FONT - 1)
      .attr('font-family', FONT_FAMILY)
      .text(`${t}%`);
  }

  const label = (
    text: string,
    x: number,
    y: number,
    maxW: number,
    cls: string,
    weight?: number
  ) => {
    const { lines, truncated } = fitLabel(text, TICK_FONT, maxW, 1);
    const t = svg
      .append('text')
      .attr('class', cls)
      .attr('x', x)
      .attr('y', y)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(lines[0] ?? '');
    if (weight) t.attr('font-weight', weight);
    if (truncated) t.attr('aria-label', text);
    return t;
  };

  // A label centred on a narrow column may spill as far as its neighbours'
  // own labels leave room, so `LATAM` over an 8% column reads whole.
  const room = (texts: string[]): number[] => {
    const colW = columns.map((c) => c.w * plotW);
    const spare = texts.map((t, i) =>
      Math.max(0, (colW[i]! - measureText(t, TICK_FONT)) / 2)
    );
    return colW.map(
      (cw, i) =>
        cw +
        2 *
          Math.min(
            i > 0 ? spare[i - 1]! : m.left,
            i < colW.length - 1 ? spare[i + 1]! : m.right
          )
    );
  };
  const widthTexts = columns.map(({ d }) =>
    share ? shareText(d.width!) : fmt(d.width!)
  );
  const widthRoom = room(widthTexts);
  const nameRoom = room(columns.map(({ d }) => d.label));

  const multi = seriesCount > 1;
  let cum = 0;
  for (const [i, { d, raw, vals, w }] of columns.entries()) {
    const x = xAt(cum);
    const colW = w * plotW;
    cum += w;
    const colTotal = raw.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
    const widthText = widthTexts[i]!;
    label(
      widthText,
      x + colW / 2,
      m.top - WIDTH_LABEL_GAP,
      widthRoom[i]!,
      'dgmo-mekko-width'
    );
    tagDatum(
      label(d.label, x + colW / 2, nameY, nameRoom[i]!, 'dgmo-mekko-name', 600),
      {
        line: d.lineNumber,
        name: d.label,
        value: `width ${widthText} · total ${fmt(colTotal)}`,
      }
    );
    let acc = 0;
    vals.forEach((v, s) => {
      if (!Number.isFinite(v)) return;
      const sName = seriesNames[s] ?? '';
      const own = colorOf(s);
      const recede = dimmed.has(d.label) && (!multi || dimmed.has(sName));
      const stroke = !story.active
        ? own
        : recede
          ? story.groundStroke
          : story.subject(own);
      const fill = !story.active
        ? shapeFill(palette, own, isDark, { mode: chart.fillMode })
        : recede
          ? story.groundFill
          : stroke;
      const dim = recede && !story.active;
      const y0 = val(acc);
      const y1 = val(acc + v);
      acc += v;
      // Value: the size this segment stands for when widths are sizes,
      // otherwise the number the author wrote.
      const value = share ? raw[s]! : (v / 100) * d.width!;
      rect(
        svg,
        x,
        Math.min(y0, y1),
        colW,
        Math.abs(y1 - y0),
        fill,
        stroke,
        {
          line: d.lineNumber,
          key: multi ? sName : d.label,
          name: [d.label, multi ? sName : ''].filter(Boolean).join(' · '),
          value: `${shareText(v)} of column · ${shareText(v * w)} of whole · ${fmt(value)}`,
          color: own,
          seriesName: multi ? sName : undefined,
        },
        dim
      );
      const text = shareText(v);
      if (
        !chart.noValue &&
        Math.abs(y1 - y0) > 18 &&
        measureText(text, VALUE_FONT) + 4 <= colW
      ) {
        const onBar =
          story.active && !recede
            ? contrastText(
                fill,
                palette.textOnFillLight,
                palette.textOnFillDark
              )
            : story.active
              ? story.groundText
              : textColor;
        drawValueLabel(svg, text, x + colW / 2, (y0 + y1) / 2 + 4, onBar).attr(
          'opacity',
          dim ? EMPHASIS_DIM_TEXT_OPACITY : null
        );
      }
    });
  }

  drawXAxisTitle(svg, chart.xlabel, m.left + plotW / 2, nameY + 30, textColor);
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}
