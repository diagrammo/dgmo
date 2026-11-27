// ============================================================
// Hand-built bar renderer.
// Handles: single-series bar, multi-series `stack` (stacked), `group`
// (clustered side-by-side) and `mirror` (two series back to back) layouts
// (chart.barLayout), horizontal orientation.
// Matches the house style: 25% tint fill + full-strength border, per-category
// colors for single series, value labels, 0-baseline.
// Signed values: the domain is [min(0, dataMin), max(0, dataMax)] and bars
// grow from the 0 baseline in either direction (diverging); stacks accumulate
// positive and negative runs separately.
// ============================================================

import { scaleBand } from 'd3-scale';
import { buildDateAxis, timeLabelsOf } from './date-axis';
import { axisTickFormat, buildValueAxis, labelledTicks } from './value-axis';
import { max as d3max, min as d3min } from 'd3-array';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { contrastText, shapeFill, themeBaseBg } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { annotationValues } from '../annotations/parse';
import { divergingSpans } from '../utils/diverging';
import { shareText, toShares } from '../utils/stack-share';
import { tabularText } from '../utils/tabular-figures';
import {
  drawBands,
  drawMarkers,
  settleBandLabels,
  LIFT_CLASS,
  type ValueAxisFrame,
} from '../annotations/draw';
import {
  drawChartNotes,
  drawNoteKey,
  noteBlock,
  captionWrap,
  placeChartNotes,
  planNoteKey,
  KEY_DISC_R,
  type NoteKeyItem,
  type NoteKeyPlan,
  type PlacedNoteDatum,
} from '../annotations/notes';
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
import { measureText, truncateText } from '../utils/text-measure';
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
  xAxisTitleY,
  drawYAxisTitle,
  drawValueLabel,
  tagDatum,
  planCategoryLabels,
  planLabelsFitLeft,
  drawCategoryLabels,
  rotatedLabelCap,
  LABEL_REGION_SHARE,
  NEVER_THIN_MAX,
  isOrderedLabelSet,
  bandSafeTop,
  TICK_INK_ABOVE,
  topTickFraction,
  LABEL_ROTATE_DEG,
  ROTATED_LABEL_PAD,
  CUT_MARK_GAP,
  CUT_MARK_LEN,
  cutMark,
} from './shared';
import type { FacetPanel } from './facet-panel';

// Long category names must not size the chart (#1422). Their region is capped
// at a share of the canvas: rotated names below vertical bars by height, the
// name column beside horizontal bars by width. Rotated names also give way
// while the plot would be under PLOT_MIN_SHARE of the height. Names in the
// column wrap first (#1828); only what still does not fit ends in `…`, and
// keeps its full text as a hover title.
/** A vertical bar axis this short flips horizontal rather than rotate (#1828).
 *  A longer axis of plain names flips too, rather than thin them (#2271). */
const FLIP_MAX_CATEGORIES = NEVER_THIN_MAX;
/** Shortest row a horizontal bar gets: one name line and its gap. Below it
 *  the drawing grows taller than its host height (#2271). */
const ROW_MIN_STEP = Math.round(TICK_FONT * 1.2) + 6;
/** A time axis keeps its end bars at least this far in from the plot edge. */
const DATE_AXIS_INSET = 16;
/** The category axis: a band per label, or a bar at each row's time. */
type CatScale = ((label: string) => number | undefined) & {
  bandwidth(): number;
  step(): number;
  paddingInner(): number;
};
/** Most lines one horizontal-bar name may wrap to before it ends in `…`. */
const NAME_MAX_LINES = 3;
/** Baseline-to-baseline distance of a wrapped name's lines. */
const NAME_LINE_PX = Math.round(TICK_FONT * 1.2);
/** Most lines a Marimekko column name wraps to before the names rotate (#2084). */
const NAME_MAX_LINES_MEKKO = 2;
/** A rotated Marimekko name keeps at least this much text before its `…`. */
const MIN_ROTATED_NAME_W = 40;
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
  inlineTitle?: InlineTitleInfo,
  /** Set on the second pass when the notes could not all stand clear: the
   *  key to draw under the chart. `height` already excludes the key, which
   *  draws in the strip below it, so the drawing keeps the requested size. */
  noteKey?: NoteKeyPlan,
  /** Set when this chart is one panel of a `facet` grid (#1853). */
  panel?: FacetPanel
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
  if (chart.barLayout === 'mirror') {
    renderMirror(
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
  const startNodes = svg.node()?.childNodes.length ?? 0;
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
  const authoredVertical = chart.orientation === 'vertical';
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
  // `target 100 green`: a bar that reaches it takes the named colour.
  const targetPaint = target?.color
    ? (resolveColor(target.color, palette) ?? undefined)
    : undefined;
  const metColor = (v: number) =>
    target && targetPaint && reachesTarget(v, target.value!, target.below)
      ? targetPaint
      : undefined;
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
  // Value axis (decision #60): `y-axis 0..100 log`. Built once on a unit
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
      : axisTickFormat(valueAxis([0, 1]), chart.numberFormat, fmt);
  const valueTicks = probeTicks.map(tickFmt);
  // Vertical bars carry their category names under the axis, so they need the
  // same fit treatment as line. Horizontal bars put them in the left gutter,
  // which computeLeftMargin already sizes. Rotated labels hang left of the
  // first bar, so the margin may grow to keep them inside the SVG.
  const mTop = top + 8;
  const xTitleBand = chart.xlabel ? 40 : 18;
  const labelCap = rotatedLabelCap(height, mTop, xTitleBand);
  // `pareto` (#1954): columns only, with a 0–100% axis in the right margin.
  const pareto =
    !stacked && !grouped && !!chart.overlays?.some((o) => o.kind === 'pareto');
  const mRight = pareto
    ? Math.max(32, measureText('100%', TICK_FONT) + PARETO_TICK_GAP + 8)
    : 32;
  // A side-by-side bar past a fixed `y-axis` range is clamped to the
  // plot edge (#2114). It keeps a triangle pointing the way the value went,
  // with its real value beside it, so it never reads as the limit.
  const cutHi = (v: number) =>
    !stacked && ySpec?.max !== undefined && v > ySpec.max;
  const cutLo = (v: number) =>
    !stacked && ySpec?.min !== undefined && v < ySpec.min;
  const hiCuts = perCat.flat().filter(cutHi);
  // A time axis when every row is a date, date-time or bare time (#2208):
  // each bar stands at its time, to scale. Horizontal, pareto, diverging and
  // lollipop bars stay categorical. A time axis never flips: its ticks are
  // short, and there is no name to fit.
  const timeLabels =
    authoredHorizontal || pareto || diverging || chart.lollipop
      ? null
      : timeLabelsOf(catLabels);
  const dates = timeLabels?.dates ?? null;
  const verticalFit =
    authoredHorizontal || dates
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
  // A longer axis of plain names flips when the plan would drop or cut one
  // (#2271), and the drawing grows to give each name a row; ordered names
  // still thin, since a dropped one reads off its neighbours (#2212). A facet
  // panel cannot grow, so it keeps the short-axis rule. `orientation-vertical`
  // keeps the columns.
  const cutNames = !!verticalFit?.shown.some((s, i) => s !== catLabels[i]);
  const flipped =
    !pareto &&
    !authoredVertical &&
    verticalFit !== null &&
    (data.length <= FLIP_MAX_CATEGORIES
      ? verticalFit.plan.rotate || cutNames
      : !panel &&
        !isOrderedLabelSet(catLabels) &&
        (verticalFit.plan.keep.size < data.length || cutNames));
  const horizontal = authoredHorizontal || flipped;
  // x names the category axis and y the value axis in any orientation, the
  // same axis the `y-axis` range and scale set (diagrammo/diagrammo#2122). Once
  // horizontal, authored or flipped, categories run down the left, so the
  // x-axis title moves there and the y-axis title goes below.
  const bottomTitle = horizontal ? chart.ylabel : chart.xlabel;
  const leftTitle = horizontal ? chart.xlabel : chart.ylabel;

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
  // Horizontal: the mark and its value stand past the right edge.
  const hiCutW = hiCuts.length
    ? CUT_MARK_GAP +
      CUT_MARK_LEN +
      4 +
      Math.max(...hiCuts.map((v) => measureText(fmt(v), VALUE_FONT)))
    : 0;
  const plotW = fit ? fit.plotW : width - mLeft - mRight - hiCutW;
  const labelPlan = fit?.plan ?? planCategoryLabels(catLabels, Infinity);
  const shown = fit?.shown ?? catLabels;
  const m: Margins = {
    top: mTop,
    right: mRight,
    bottom: horizontal
      ? 64
      : Math.max(64, (dates ? TICK_FONT + 10 : labelPlan.height) + xTitleBand),
    left: mLeft,
  };

  // Vertical: the mark and its value stand above the top edge.
  if (!horizontal && hiCuts.length)
    m.top += CUT_MARK_GAP + CUT_MARK_LEN + 4 + VALUE_FONT;

  // A note stands above its column (#2078). When the column reaches near the
  // plot's top, reserve the room the note needs over it.
  const noteTop = m.top;
  if (!horizontal && chart.notes?.length && !chart.noNotes) {
    const probe = valueAxis([0, 1]);
    const plotH0 = height - m.top - m.bottom;
    let deficit = 0;
    for (const n of chart.notes) {
      const vals = perCat[n.index] ?? [];
      const end = stacked
        ? vals.filter((v) => v > 0).reduce((a, b) => a + b, 0)
        : (vals[n.series] ?? vals[0] ?? 0);
      const f = Math.min(1, Math.max(0, probe(end)));
      if (end < 0 || !(f > 0)) continue;
      // A note whose full width would reach over a noted neighbour wraps
      // to its bar's width (#2136): reserve that taller block.
      const step = plotW / Math.max(1, data.length);
      const full = noteBlock(n.text);
      const reach = Math.ceil(full.w / 2 / step);
      const crowded = chart.notes.some(
        (o) => o !== n && Math.abs(o.index - n.index) <= reach
      );
      const need = noteKey
        ? 2 * KEY_DISC_R + VALUE_FONT + 8
        : (crowded ? noteBlock(n.text, captionWrap(step)) : full).h +
          VALUE_FONT +
          14;
      deficit = Math.max(deficit, (need - (1 - f) * plotH0) / f);
    }
    m.top += Math.ceil(Math.min(Math.max(0, deficit), plotH0 * 0.4));
  }
  // Ink over the plot's top edge stays on the band (#2111): the top tick
  // label, a column's value label, the pareto axis and its percent labels.
  if (!horizontal) {
    const probe = valueAxis([0, 1]);
    const items: [number, number][] = [
      [topTickFraction(probe, probeTicks), TICK_INK_ABOVE],
    ];
    if (!stacked) {
      const hi = Math.max(0, ...perCat.flat());
      const lift = 6 + (chart.lollipop ? LOLLIPOP_DOT_MAX : 0) + VALUE_FONT;
      if (hi > 0) items.push([1 - probe(hi), lift]);
    }
    if (pareto) {
      items.push([0, TICK_INK_ABOVE]);
      const cum = paretoCumulative(rawCat.map((vals) => vals[0]!));
      const shown = cum.slice(0, -1);
      if (shown.length)
        items.push([1 - Math.max(...shown) / 100, 8 + VALUE_FONT]);
    }
    m.top = Math.max(m.top, bandSafeTop(mTop, height - m.bottom, items));
  }
  // Horizontal: the first category's name centres on its band (#2117). With
  // many categories the band is shorter than the name, which then rises over
  // the plot's top edge. Its centre is 0.65 of a step under the top (padding
  // 0.3 inner and outer).
  if (horizontal && data.length) {
    const lines = sideFit[0]?.lines.length ?? 1;
    const above = TICK_FONT - 4 + ((lines - 1) * NAME_LINE_PX) / 2;
    const f = 0.65 / (data.length + 0.3);
    m.top = Math.max(m.top, bandSafeTop(mTop, height - m.bottom, [[f, above]]));
  }
  // Horizontal rows too short for a name line: the drawing grows (#2271), as
  // it does for a note key, and the frame lays out around the taller canvas.
  if (horizontal && !panel && data.length) {
    const grow = Math.ceil(
      sideSteps * ROW_MIN_STEP - (height - m.top - m.bottom)
    );
    const root = svg.node();
    if (grow > 0 && root) {
      const h = Number(root.getAttribute('height') ?? height) + grow;
      const w = Number(root.getAttribute('width') ?? width);
      root.setAttribute('height', String(h));
      root.setAttribute('viewBox', `0 0 ${w} ${h}`);
      height += grow;
    }
  }
  const plotH = height - m.top - m.bottom;
  const horiz = horizontal;

  const catRange: [number, number] = horiz
    ? [m.top, m.top + plotH]
    : [m.left, m.left + plotW];
  // On a time axis a bar is 70% of the smallest interval between rows wide,
  // so bars never overlap and a missing period shows as a missing bar. The
  // inset holds half an end bar: inset = 0.35·f·(plotW − 2·inset), f being
  // that interval's share of the span (as line.ts).
  const dateAxis =
    dates && !horiz
      ? (() => {
          const ms = dates.map((d) => d.getTime());
          const span = Math.max(...ms) - Math.min(...ms);
          const sorted = [...ms].sort((a, b) => a - b);
          const steps = sorted
            .slice(1)
            .map((t, i) => t - sorted[i]!)
            .filter((g) => g > 0);
          const f = span > 0 && steps.length ? Math.min(...steps) / span : 0;
          const inset = f
            ? Math.max(DATE_AXIS_INSET, (0.35 * f * plotW + 2) / (1 + 0.7 * f))
            : DATE_AXIS_INSET;
          const axis = buildDateAxis(
            dates,
            [m.left + inset, m.left + plotW - inset],
            { fontSize: TICK_FONT },
            timeLabels!.kind
          );
          const slotW = f ? f * (plotW - 2 * inset) : plotW / 4;
          return { axis, slotW };
        })()
      : null;
  const cat: CatScale = dateAxis
    ? Object.assign(
        (label: string) => {
          const i = data.findIndex((d) => d.label === label);
          return i < 0
            ? undefined
            : dateAxis.axis.x(dates![i]!) - (dateAxis.slotW * 0.7) / 2;
        },
        {
          bandwidth: () => dateAxis.slotW * 0.7,
          step: () => dateAxis.slotW,
          paddingInner: () => 0.3,
        }
      )
    : scaleBand<string>()
        .domain(data.map((d) => d.label))
        .range(catRange)
        .padding(0.3);
  // Horizontal side-by-side: a value label stands past its bar's end, so the
  // value range stops short of the plot edge by the widest label on that side
  // (#2082). The label never flips onto the mark.
  let reserveL = 0;
  let reserveR = 0;
  if (horiz && !stacked) {
    const room = (neg: boolean) => {
      const ws = perCat
        .flat()
        .filter((v) => v < 0 === neg && !cutHi(v) && !cutLo(v))
        .map((v) => measureText(fmt(v), VALUE_FONT));
      return ws.length
        ? Math.max(...ws) + 6 + (chart.lollipop ? LOLLIPOP_DOT_MAX : 0) + 2
        : 0;
    };
    reserveL = room(true);
    reserveR = room(false);
  }
  const valRange: [number, number] = horiz
    ? [m.left + reserveL, m.left + plotW - reserveR]
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
    // Drawn over the bars by drawMarkers, haloed, so a bar never hides it.
    g.append('text')
      .attr('class', LIFT_CLASS)
      .attr('data-line-number', era.lineNumber)
      .attr('x', spot.x)
      .attr('y', spot.y)
      .attr('text-anchor', spot.anchor)
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .attr('opacity', 0.8)
      .attr('stroke', annotationColors.bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .text(era.label);
    eraTitles.push(labelBox(era.label, spot, TICK_FONT));
  });

  // value-axis gridlines + ticks
  const valTicks = val.ticks(6);
  const labelled = labelledTicks(val, valTicks, tickFmt, {
    fontSize: TICK_FONT,
    vertical: !horiz,
  });
  for (const t of valTicks) {
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
      if (labelled.has(t))
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
      if (labelled.has(t) && !panel?.hideValueTicks)
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
      overlayLevels(overlays, overlaySeries, fmt, palette.colors.red, palette),
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
  } else if (dateAxis) {
    // Time ticks replace the row names: a short mark on the axis and a flat
    // label beneath it, as on line.
    for (const t of dateAxis.axis.ticks) {
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
  // down): the label sits off the bar's free end. Horizontal bars have room
  // reserved for it (reserveL/reserveR); vertical ones flip inside at the edge.
  const valueSpot = (base: number, s: number, v: number): ValueSpot => {
    const off = inner!(s) ?? 0;
    const bw = inner!.bandwidth();
    const text = fmt(v);
    const cut = cutHi(v) ? 1 : cutLo(v) ? -1 : 0;
    if (cut) {
      const mid = base + off + bw / 2;
      const past = CUT_MARK_GAP + CUT_MARK_LEN + 4;
      if (horiz) {
        const edge = cut > 0 ? m.left + plotW : m.left;
        return {
          text,
          x: edge + past,
          y: mid + 4,
          anchor: 'start',
          keep: true,
        };
      }
      const edge = cut > 0 ? m.top : m.top + plotH;
      return { text, x: mid, y: edge - past, anchor: 'middle', keep: true };
    }
    if (horiz) {
      const x1 = val(v);
      const o = 6 + pad;
      return {
        text,
        x: v < 0 ? x1 - o : x1 + o,
        y: base + off + bw / 2 + 4,
        anchor: v < 0 ? 'end' : 'start',
        keep: true,
      };
    }
    const y1 = val(v);
    const yOut = v < 0 ? y1 + 14 + pad : y1 - 6 - pad;
    // `noteTop`: room reserved over the plot for a note (#2078) holds the
    // value label too, so the label stays outside its bar.
    const yInside = v < 0 ? yOut > m.top + plotH - 2 : yOut < noteTop + 2;
    return {
      text,
      x: base + off + bw / 2,
      y: yInside ? (v < 0 ? y1 - 6 - pad : y1 + 14 + pad) : yOut,
      anchor: 'middle',
      keep: true,
    };
  };

  // Hover projection onto the axes (#2307): plain and grouped bars only.
  // Stacked, pareto (a second axis on the right), lollipop and facet panels (one plot
  // rect per drawing) keep the dim-only hover.
  const projects = !stacked && !pareto && !panel && !chart.lollipop;
  const clampTo = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));
  if (projects)
    svg
      .append('rect')
      .attr('class', 'dgmo-plot-rect')
      .attr('x', m.left)
      .attr('y', m.top)
      .attr('width', plotW)
      .attr('height', plotH)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'none');

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
      const own = colorFor(
        s,
        v,
        metColor(v) ?? (seriesCount === 1 ? d.color : undefined)
      );
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
          if (
            Math.abs(x1 - x0) > 26 &&
            measureText(segText, VALUE_FONT) + 4 <= Math.abs(x1 - x0)
          )
            drawValueLabel(
              svg,
              segText,
              (x0 + x1) / 2,
              base + cat.bandwidth() / 2 + 4,
              onBarColor
            )
              .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
              .attr('data-series-name', tag.seriesName ?? null);
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
          if (
            Math.abs(y1 - y0) > 18 &&
            measureText(segText, VALUE_FONT) + 4 <= cat.bandwidth()
          )
            drawValueLabel(
              svg,
              segText,
              base + cat.bandwidth() / 2,
              (y0 + y1) / 2 + 4,
              onBarColor
            )
              .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
              .attr('data-series-name', tag.seriesName ?? null);
        }
        if (v < 0) accNeg += v;
        else accPos += v;
      } else {
        const off = inner!(s) ?? 0;
        const bw = inner!.bandwidth();
        const mid = base + off + bw / 2;
        noteAt.set(`${di}:${s}`, horiz ? [val(v), mid] : [mid, val(v)]);
        const cut = cutHi(v) ? 1 : cutLo(v) ? -1 : 0;
        if (cut) {
          const edge = horiz
            ? cut > 0
              ? m.left + plotW
              : m.left
            : cut > 0
              ? m.top
              : m.top + plotH;
          cutMark(svg, mid, edge, cut, horiz, stroke, d.lineNumber, dim);
        }
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
            )
              .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
              .attr('data-series-name', tag.seriesName ?? null);
        } else if (horiz) {
          const x1 = val(v);
          const r = rect(
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
          // Hover projects the value onto the value axis (#2307). The row
          // name already stands beside the bar, so it gets no second copy.
          if (projects)
            r.attr('data-axval-x', fmt(v))
              .attr('data-cx', clampTo(x1, m.left, m.left + plotW))
              .attr('data-cy', mid);
          const spot = spots[s]!;
          if (spot.keep)
            drawValueLabel(
              svg,
              spot.text,
              spot.x,
              spot.y,
              labelColor,
              spot.anchor
            )
              .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
              .attr('data-series-name', tag.seriesName ?? null);
        } else {
          const y1 = val(v);
          const r = rect(
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
          // Hover prints the FULL name on the category axis — never the
          // thinned or tilted tick text — and the value on the value axis
          // (#2307).
          if (projects)
            r.attr('data-axval-x', d.label)
              .attr('data-axval-y', fmt(v))
              .attr('data-cx', mid)
              .attr('data-cy', clampTo(y1, m.top, m.top + plotH));
          const spot = spots[s]!;
          if (spot.keep)
            drawValueLabel(
              svg,
              spot.text,
              spot.x,
              spot.y,
              labelColor,
              spot.anchor
            )
              .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
              .attr('data-series-name', tag.seriesName ?? null);
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

  const markerLines: LabelRect[] = [];
  const markerLabels = [
    ...paretoLabels,
    ...drawMarkers(
      svg,
      chart.annotations,
      annotationFrame,
      annotationColors,
      markerLines
    ),
    ...drawOverlayLabels(
      svg,
      overlayLabels,
      annotationFrame,
      annotationColors.bg
    ),
  ];
  settleBandLabels(svg);

  // Notes (#2039): a ring on the bar's end, the text in clear plot space.
  // A value label a note lands on yields to it.
  if (chart.notes?.length && !chart.noNotes && svgNode) {
    const drawn = Array.from(svgNode.childNodes).slice(
      drawnBefore
    ) as Element[];
    const num = (e: Element, a: string) => Number(e.getAttribute(a) ?? 0);
    const obstacles: LabelRect[] = [...markerLines];
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
    // A note stands just past its bar's end, beyond the bar's value label
    // (#2078); a bar running below zero keeps the ring and leader.
    const zero = val(0);
    /** Each note's bar end and direction, by source line, for the key. */
    const ends = new Map<number, { at: [number, number]; forward: boolean }>();
    const notes: PlacedNoteDatum[] = chart.notes.flatMap((n) => {
      const at = noteAt.get(`${n.index}:${n.series}`);
      if (!at) return [];
      const [x, y] = at;
      const forward = horiz ? x >= zero : y <= zero;
      ends.set(n.lineNumber, { at, forward });
      const label = forward
        ? values.find(({ box }) =>
            horiz
              ? Math.abs(box.y + box.h / 2 - y) < 4 &&
                box.x >= x - 4 &&
                box.x <= x + 12
              : Math.abs(box.x + box.w / 2 - x) < 4 &&
                box.y + box.h <= y + 4 &&
                box.y + box.h >= y - 16
          )?.box
        : undefined;
      return [
        {
          x: label && horiz ? label.x + label.w : x,
          y: label && !horiz ? label.y : y,
          r: 0,
          text: n.text,
          color: n.color,
          lineNumber: n.lineNumber,
          ...(!horiz && { wrap: captionWrap(cat.step()) }),
          ...(forward && {
            beyond: horiz ? ('right' as const) : ('above' as const),
          }),
        },
      ];
    });
    const noteOpts = {
      plot: {
        left: m.left,
        top: noteTop,
        right: m.left + plotW,
        bottom: m.top + plotH,
      },
      canvas: {
        left: m.left,
        top: noteTop,
        right: width,
        bottom: m.top + plotH,
      },
      reserved: [...eraTitles, ...markerLabels],
      obstacles,
      leaderObstacles: values.map((v) => v.box),
      colors: { text: textColor, bg: annotationColors.bg },
      palette,
    };
    // Numbered in bar order (#2159).
    const keyItems: NoteKeyItem[] = [...chart.notes]
      .filter((n) => ends.has(n.lineNumber))
      .sort((a, b) => a.index - b.index || a.series - b.series)
      .map((n, k) => ({
        num: k + 1,
        text: n.text,
        color: n.color,
        lineNumber: n.lineNumber,
      }));
    let boxes: LabelRect[];
    if (noteKey) {
      const marks = notes.map((d) => {
        const item = keyItems.find((it) => it.lineNumber === d.lineNumber)!;
        const sign = d.beyond ? 1 : -1;
        const off = KEY_DISC_R + 3;
        return horiz
          ? { x: d.x + sign * off, y: d.y, item }
          : { x: d.x, y: d.y - sign * off, item };
      });
      // Each noted bar carries its number, so hovering it lights its disc.
      const rects = drawn.filter((e) => e.tagName.toLowerCase() === 'rect');
      for (const it of keyItems) {
        const [ax, ay] = ends.get(it.lineNumber)!.at;
        const bar = rects.find((e) => {
          const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) =>
            num(e, a)
          ) as [number, number, number, number];
          return horiz
            ? Math.abs(y + h / 2 - ay) < 1.5 &&
                (Math.abs(x + w - ax) < 1.5 || Math.abs(x - ax) < 1.5)
            : Math.abs(x + w / 2 - ax) < 1.5 &&
                (Math.abs(y - ay) < 1.5 || Math.abs(y + h - ay) < 1.5);
        });
        bar?.setAttribute(
          'data-note-key',
          `${panel?.noteScope ?? ''}${it.num}`
        );
        bar?.classList.add('dgmo-note-bar');
      }
      // The key draws in the strip the second pass took off the plot's
      // height: the drawing keeps the size it was asked for (#2310), since a
      // host that sized the pane clips anything taller.
      drawNoteKey(
        svg,
        marks,
        noteKey,
        { x: m.left, y: height },
        { ...noteOpts, keyScope: panel?.noteScope }
      );
      boxes = marks.map(({ x, y }) => ({
        x: x - KEY_DISC_R,
        y: y - KEY_DISC_R,
        w: 2 * KEY_DISC_R,
        h: 2 * KEY_DISC_R,
      }));
    } else {
      const placed = placeChartNotes(notes, noteOpts);
      if (!placed.clear) {
        // Some note has no clear spot: lay the chart out again with every
        // note numbered and a key under it (#2159).
        while ((svg.node()?.childNodes.length ?? 0) > startNodes)
          svg.node()!.lastChild!.remove();
        const plan = planNoteKey(keyItems, width - m.left - 16);
        renderBar(
          svg,
          chart,
          width,
          height - plan.h,
          colors,
          palette,
          isDark,
          textColor,
          mutedColor,
          hasTitle,
          inlineTitle,
          plan,
          panel
        );
        return;
      }
      boxes = drawChartNotes(svg, notes, noteOpts, placed);
    }
    const hits = (a: LabelRect, b: LabelRect) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const v of values)
      if (boxes.some((b) => hits(b, v.box))) v.el.remove();
  }

  drawXAxisTitle(
    svg,
    bottomTitle,
    m.left + plotW / 2,
    xAxisTitleY(m.top + plotH, m.bottom),
    textColor
  );
  drawYAxisTitle(svg, leftTitle, m.top, plotH, 20, textColor, mTop);
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
) {
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
  return r;
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
    : axisTickFormat(valueAxis([0, 1]), chart.numberFormat, fmt);
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

  const valTicks = val.ticks(6);
  const labelled = labelledTicks(val, valTicks, tickFmt, {
    fontSize: TICK_FONT,
    vertical: true,
  });
  for (const t of valTicks) {
    const y = val(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === val.baseline ? 0.6 : 0.25);
    if (labelled.has(t))
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
        drawValueLabel(svg, text, x + w / 2, (y0 + y1) / 2 + 4, onBar)
          .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
          .attr('data-series-name', multi ? sName : null);
      }
      if (v < 0) accNeg += v;
      else accPos += v;
    });
  }

  drawMarkers(svg, chart.annotations, annotationFrame, annotationColors);
  settleBandLabels(svg);
  drawXAxisTitle(svg, chart.xlabel, m.left + plotW / 2, nameY + 30, textColor);
  drawYAxisTitle(svg, chart.ylabel, m.top, plotH, 20, textColor);
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

  const mLeft = computeLeftMargin(chart.ylabel, probeTicks);
  const mRight = 32;
  const plotW0 = width - mLeft - mRight;

  // A label centred on a narrow column may spill as far as its neighbours'
  // own labels leave room, so `LATAM` over an 8% column reads whole.
  const room = (texts: string[]): number[] => {
    const colW = columns.map((c) => c.w * plotW0);
    const spare = texts.map((t, i) =>
      Math.max(0, (colW[i]! - measureText(t, TICK_FONT)) / 2)
    );
    return colW.map(
      (cw, i) =>
        cw +
        2 *
          Math.min(
            i > 0 ? spare[i - 1]! : mLeft,
            i < colW.length - 1 ? spare[i + 1]! : mRight
          )
    );
  };
  const widthTexts = columns.map(({ d }) =>
    share ? shareText(d.width!) : fmt(d.width!)
  );
  const widthRoom = room(widthTexts);
  const nameRoom = room(columns.map(({ d }) => d.label));

  // Column names follow the bar label plan (#2084): wrap to two lines inside
  // the room a column has; when any name still does not fit, every name
  // rotates below the axis (cut with `…` only past the region cap), and the
  // bottom margin grows to hold them.
  const wrapped = columns.map(({ d }, i) =>
    fitLabel(d.label, TICK_FONT, nameRoom[i]!, NAME_MAX_LINES_MEKKO)
  );
  const rotateNames = wrapped.some((f) => f.truncated);
  const rotRad = (LABEL_ROTATE_DEG * Math.PI) / 180;
  const nameCap = Math.max(
    MIN_ROTATED_NAME_W,
    Math.floor(
      (height * LABEL_REGION_SHARE - ROTATED_LABEL_PAD) / Math.sin(rotRad)
    )
  );
  const rotNames = rotateNames
    ? columns.map(({ d }) => truncateText(d.label, TICK_FONT, nameCap))
    : [];
  const nameDrop = rotateNames
    ? Math.round(
        Math.max(...rotNames.map((t) => measureText(t, TICK_FONT))) *
          Math.sin(rotRad)
      ) + ROTATED_LABEL_PAD
    : (Math.max(...wrapped.map((f) => f.lines.length)) - 1) * NAME_LINE_PX;

  const m: Margins = {
    top: top + 8 + TICK_FONT + WIDTH_LABEL_GAP,
    right: mRight,
    bottom:
      TICK_FONT +
      6 +
      8 +
      TICK_FONT +
      10 +
      (chart.xlabel ? 40 : 18) +
      Math.max(0, nameDrop),
    left: mLeft,
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
    const nameEl = rotateNames
      ? svg
          .append('text')
          .attr('class', 'dgmo-mekko-name')
          .attr(
            'transform',
            `translate(${x + colW / 2},${nameY}) rotate(-${LABEL_ROTATE_DEG})`
          )
          .attr('text-anchor', 'end')
          .attr('fill', textColor)
          .attr('font-size', TICK_FONT)
          .attr('font-family', FONT_FAMILY)
          .attr('font-weight', 600)
          .text(rotNames[i]!)
      : (() => {
          const { lines, truncated } = wrapped[i]!;
          const t = svg
            .append('text')
            .attr('class', 'dgmo-mekko-name')
            .attr('x', x + colW / 2)
            .attr('y', nameY)
            .attr('text-anchor', 'middle')
            .attr('fill', textColor)
            .attr('font-size', TICK_FONT)
            .attr('font-family', FONT_FAMILY)
            .attr('font-weight', 600);
          if (lines.length === 1) t.text(lines[0]!);
          else
            lines.forEach((line, k) =>
              t
                .append('tspan')
                .attr('x', x + colW / 2)
                .attr('dy', k === 0 ? 0 : NAME_LINE_PX)
                .text(line)
            );
          if (truncated) t.attr('aria-label', d.label);
          return t;
        })();
    if (rotateNames && rotNames[i] !== d.label)
      nameEl.attr('aria-label', d.label);
    tagDatum(nameEl, {
      line: d.lineNumber,
      name: d.label,
      value: `width ${widthText} · total ${fmt(colTotal)}`,
    });
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
        drawValueLabel(svg, text, x + colW / 2, (y0 + y1) / 2 + 4, onBar)
          .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
          .attr('data-series-name', multi ? sName : null);
      }
    });
  }

  drawXAxisTitle(svg, chart.xlabel, m.left + plotW / 2, nameY + 30, textColor);
  drawYAxisTitle(svg, chart.ylabel, m.top, plotH, 20, textColor);
}

/** Space either side of the category names in a `mirror` chart's gutter. */
const MIRROR_GUTTER_PAD = 10;
/** Gap between a `mirror` bar's free end and its value label. */
const MIRROR_VALUE_GAP = 4;

/**
 * Butterfly / population pyramid (`mirror`, #1878): two series back to back.
 * The category names sit in a centre gutter; the first series grows left
 * from it and the second right, on ONE scale, so equal values draw equal
 * lengths. Ticks run along the bottom of both halves and read positive both
 * ways; each value label sits off its bar's free end. Rows run top to bottom
 * in source order.
 */
function renderMirror(
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
  const seriesNames = chart.seriesNames ?? [];
  const rows = chart.data.map((d) => ({ d, vals: seriesValues(d, 2) }));
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

  const finite = rows.flatMap(({ vals }) => vals.filter(Number.isFinite));
  const maxVal = Math.max(0, ...finite) || 1;
  const valueAxis = (range: [number, number]) =>
    buildValueAxis(0, maxVal, chart.axes?.y, range, {
      nice: true,
      dataHi: maxVal,
    });

  // Each half's free end must hold its longest value label.
  const valueRoom = (s: number): number =>
    chart.noValue
      ? 12
      : Math.max(
          12,
          ...rows.map(({ vals }) =>
            Number.isFinite(vals[s]!)
              ? measureText(fmt(vals[s]!), VALUE_FONT) + MIRROR_VALUE_GAP + 4
              : 0
          )
        );
  const mLeft = valueRoom(0);
  const mRight = valueRoom(1);

  // The gutter fits the longest name, capped at the label region's share.
  const gutterCap = Math.floor(width * LABEL_REGION_SHARE);
  const nameW = Math.max(
    0,
    ...rows.map(({ d }) => measureText(d.label, TICK_FONT))
  );
  const gutterW = Math.min(gutterCap, nameW + 2 * MIRROR_GUTTER_PAD);
  const halfW = Math.max(1, (width - mLeft - mRight - gutterW) / 2);
  const gutterL = mLeft + halfW;
  const gutterR = gutterL + gutterW;
  const centre = (gutterL + gutterR) / 2;

  // x is the category axis on a bar in any orientation (decision #60): its
  // title heads the gutter of names; the y title sits under the value ticks.
  const headH = chart.xlabel ? TICK_FONT + 10 : 0;
  const m: Margins = {
    top: top + 8 + headH,
    right: mRight,
    bottom: TICK_FONT + 14 + (chart.ylabel ? 30 : 8),
    left: mLeft,
  };
  const plotH = Math.max(1, height - m.top - m.bottom);
  const band = scaleBand<number>()
    .domain(rows.map((_, i) => i))
    .range([m.top, m.top + plotH])
    .padding(0.2);
  const len = valueAxis([0, halfW]);
  const tickFmt = axisTickFormat(len, chart.numberFormat, fmt);
  const ticks = len.ticks(Math.max(2, Math.min(5, Math.floor(halfW / 60))));
  const axisY = m.top + plotH;

  // Gridlines and ticks on both halves, mirrored about the gutter.
  for (const side of [0, 1] as const) {
    const xAt = (v: number) =>
      side === 0 ? gutterL - len(v) : gutterR + len(v);
    for (const t of ticks) {
      const x = xAt(t);
      svg
        .append('line')
        .attr('class', 'dgmo-mirror-grid')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', m.top)
        .attr('y2', axisY)
        .attr('stroke', mutedColor)
        .attr('stroke-opacity', t === 0 ? 0.6 : 0.25)
        .attr('stroke-dasharray', t === 0 ? null : GRID_DASH);
      svg
        .append('text')
        .attr('class', 'dgmo-mirror-tick')
        .attr('x', x)
        .attr('y', axisY + TICK_FONT + 6)
        .attr('text-anchor', 'middle')
        .attr('fill', palette.textMuted)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .call(tabularText(tickFmt(t), TICK_FONT));
    }
  }

  const bw = band.bandwidth();
  for (const [i, { d, vals }] of rows.entries()) {
    const y = band(i)!;
    const { lines, truncated } = fitLabel(
      d.label,
      TICK_FONT,
      Math.max(1, gutterW - 2 * MIRROR_GUTTER_PAD),
      1
    );
    const nameEl = svg
      .append('text')
      .attr('class', 'dgmo-mirror-name')
      .attr('x', centre)
      .attr('y', y + bw / 2 + TICK_FONT / 2 - 1)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(lines[0] ?? '');
    if (truncated) nameEl.attr('aria-label', d.label);
    tagDatum(nameEl, {
      line: d.lineNumber,
      name: d.label,
      value: seriesNames
        .map(
          (n, s) => `${n} ${Number.isFinite(vals[s]!) ? fmt(vals[s]!) : '—'}`
        )
        .join(' · '),
    });

    for (const s of [0, 1] as const) {
      const v = vals[s]!;
      if (!Number.isFinite(v)) continue;
      const sName = seriesNames[s] ?? '';
      const own = colorOf(s);
      const recede = dimmed.has(d.label) || dimmed.has(sName);
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
      const w = len(v);
      const x = s === 0 ? gutterL - w : gutterR;
      rect(
        svg,
        x,
        y,
        w,
        bw,
        fill,
        stroke,
        {
          line: d.lineNumber,
          key: sName,
          name: `${d.label} · ${sName}`,
          value: fmt(v),
          color: own,
          seriesName: sName,
        },
        dim
      );
      if (chart.noValue) continue;
      const lx = s === 0 ? x - MIRROR_VALUE_GAP : x + w + MIRROR_VALUE_GAP;
      drawValueLabel(
        svg,
        fmt(v),
        lx,
        y + bw / 2 + VALUE_FONT / 2 - 1,
        story.active && recede ? story.groundText : textColor,
        s === 0 ? 'end' : 'start'
      )
        .attr('class', 'dgmo-mirror-value')
        .attr('data-series-name', sName)
        .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
    }
  }

  if (chart.xlabel) {
    const { lines, truncated } = fitLabel(
      chart.xlabel,
      TICK_FONT,
      Math.max(1, gutterW),
      1
    );
    const head = svg
      .append('text')
      .attr('class', 'dgmo-mirror-category-title')
      .attr('x', centre)
      .attr('y', m.top - 8)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-weight', 600)
      .attr('font-family', FONT_FAMILY)
      .text(lines[0] ?? '');
    if (truncated) head.attr('aria-label', chart.xlabel);
  }
  drawXAxisTitle(svg, chart.ylabel, centre, axisY + TICK_FONT + 34, textColor);
}
