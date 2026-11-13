// ============================================================
// Hand-built line / multi-line / area renderer.
// Series-tinted value labels, 0-baseline, era bands (markArea parity),
// dual y-axis (§15.1: y-label / y-right-label grouped series).
// ============================================================

import { scalePoint } from 'd3-scale';
import { buildValueAxis, type ValueAxis } from './value-axis';
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
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { mix, shapeFill } from '../palettes/color-utils';
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
  chartFormatter,
  reserveHeader,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  drawValueLabel,
  planLabelsFitLeft,
  drawCategoryLabels,
} from './shared';
import { labelBox, placeLabels } from '../utils/place-labels';
import type { LabelRect } from '../label-layout';

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
  // The author's `format` / `unit` / `locale` (#1831).
  const fmt = chartFormatter(chart);
  const data = chart.data;
  // `line` + a `fill` directive → filled (area) rendering. (#25)
  const isArea = chart.fill === true;
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
  const seriesColor = (s: number): string =>
    chart.seriesNameColors?.[s] ?? colors[s % colors.length]!;

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
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of data)
      for (let s = 0; s < seriesCount; s++)
        if (axisOf(s) === side) {
          const v = seriesValue(d, s);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
    if (!isFinite(lo)) return [0, 1];
    if (chart.noAutoY) {
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
  // Left axis (#1830): `y-scale log`, `y-min`, `y-max`. The right axis of a
  // dual-axis chart keeps its auto-fit. Probed on a unit range so the margin
  // is sized from the labels the axis will really draw.
  const ySpec = chart.axes?.y;
  let dataLoL = Infinity;
  let dataHiL = -Infinity;
  for (const d of data)
    for (let s = 0; s < seriesCount; s++)
      if (axisOf(s) === 'left') {
        const v = seriesValue(d, s);
        dataLoL = Math.min(dataLoL, v);
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

  // Horizontal margins first: the category-label plan needs the plot width to
  // know how much room one category owns, and the bottom margin then follows
  // from the plan (rotated labels stand taller than flat ones).
  const mRight = dual
    ? computeLeftMargin(chart.yrlabel, [fmt(hiR), fmt(loR)])
    : 32;
  const mLeft0 = computeLeftMargin(chart.ylabel, probeL.map(fmt));
  // scalePoint with padding(0.5) puts one slot's worth of space between
  // adjacent points, and half a slot at each end. Rotated labels hang left of
  // the first point, so the margin may grow to keep them inside the SVG.
  // A time axis when every row is an ISO date (#1880); else categories. A
  // time axis labels its own ticks flat, so it needs no label fit.
  const dates = isoDatesOf(data.map((d) => d.label));
  const fit = dates
    ? null
    : planLabelsFitLeft(
        data.map((d) => d.label),
        mLeft0,
        (ml) => width - ml - mRight,
        (pw) => (data.length > 0 ? pw / data.length : pw),
        (pw) => (data.length > 0 ? pw / data.length : pw) * 0.5
      );
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
  const xOfLabel = (label: string): number | undefined => {
    if (!dateAxis) return pointX(label);
    const i = data.findIndex((d) => d.label === label);
    return i < 0 ? undefined : xOfRow(i);
  };
  // `step` / `step-before` (#1880): each value holds until the next point;
  // the last one stops at the last point.
  const curve =
    chart.step === 'after'
      ? curveStepAfter
      : chart.step === 'before'
        ? curveStepBefore
        : curveLinear;
  const yL = leftAxis([m.top + plotH, m.top]);
  const yR: ValueAxis | null = dual
    ? buildValueAxis(loR, hiR, undefined, [m.top + plotH, m.top], {
        nice: true,
      })
    : null;
  const yFor = (s: number): ValueAxis =>
    dual && axisOf(s) === 'right' && yR ? yR : yL;
  const leftTint = dual ? soleAxisColor('left') : undefined;
  const rightTint = soleAxisColor('right');

  // era bands (markArea parity) — positioned on the left axis. Their titles
  // are text the point values must clear.
  const eraTitles: LabelRect[] = [];
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
  for (const t of yL.ticks(6)) {
    const yy = yL(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === 0 ? 0.6 : 0.25);
    svg
      .append('text')
      .attr('class', 'dgmo-tick')
      .attr('x', m.left - 10)
      .attr('y', yy + 4)
      .attr('text-anchor', 'end')
      .attr('fill', leftTint ?? textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(fmt(t));
  }

  // right y ticks (no gridlines)
  if (dual && yR) {
    for (const t of yR.ticks(6)) {
      svg
        .append('text')
        .attr('class', 'dgmo-tick')
        .attr('x', m.left + plotW + 10)
        .attr('y', yR(t) + 4)
        .attr('text-anchor', 'start')
        .attr('fill', rightTint ?? textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(fmt(t));
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
  const { dimmed } = resolveEmphasis(
    chart.emphasis,
    Array.from({ length: seriesCount }, (_, s) => nameOf(s))
  );

  const valueLabels: {
    text: string;
    cx: number;
    cy: number;
    v: number;
    endpoint: boolean;
    color: string;
    dim: boolean;
  }[] = [];
  for (let s = 0; s < seriesCount; s++) {
    const color = seriesColor(s);
    const yy = yFor(s);
    const name = nameOf(s);
    const dim = dimmed.has(name);
    const pts = data.map((d, i) => ({
      label: d.label,
      v: seriesValue(d, s),
      xIndex: i,
      lineNumber: d.lineNumber,
    }));
    const g = svg
      .append('g')
      .attr('class', 'dgmo-series')
      .attr('data-series-index', s)
      .attr('data-series-name', name)
      .attr('data-axis', axisOf(s))
      .attr('data-color', color);
    const seriesLine = chart.seriesNameLineNumbers?.[s];
    if (seriesLine !== undefined) g.attr('data-line-number', seriesLine);
    // A receded series keeps its paint: the dim is a baked opacity (§1.11).
    if (dim) g.attr('opacity', EMPHASIS_DIM_OPACITY);

    if (isArea) {
      const areaGen = d3area<(typeof pts)[number]>()
        .x((p) => xOfRow(p.xIndex))
        .y0(yy(yy.baseline))
        .y1((p) => yy(p.v))
        .curve(curve);
      g.append('path')
        .attr('class', 'dgmo-series-area')
        .attr('d', areaGen(pts) ?? '')
        .attr('fill', solid ? color : shapeFill(palette, color, isDark))
        .attr('stroke', 'none');
    }

    const lineGen = d3line<(typeof pts)[number]>()
      .x((p) => xOfRow(p.xIndex))
      .y((p) => yy(p.v))
      .curve(curve);
    g.append('path')
      .attr('class', 'dgmo-series-line')
      .attr('d', lineGen(pts) ?? '')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.5)
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

    const labelColor = mix(color, textColor, 60);
    for (const p of pts) {
      g.append('circle')
        .attr('class', 'dgmo-pt')
        .attr('data-series-index', s)
        .attr('data-series-name', name)
        .attr('data-color', color)
        .attr('data-x-index', p.xIndex)
        .attr('data-x-label', p.label)
        .attr('data-value', p.v)
        .attr('data-line-number', p.lineNumber)
        .attr('cx', xOfRow(p.xIndex))
        .attr('cy', yy(p.v))
        .attr('r', 3.5)
        .attr('fill', bgColor)
        .attr('stroke', color)
        .attr('stroke-width', 2);
      if (!chart.noValue) {
        valueLabels.push({
          text: fmt(p.v),
          cx: xOfRow(p.xIndex),
          cy: yy(p.v),
          v: p.v,
          endpoint: p.xIndex === 0 || p.xIndex === pts.length - 1,
          color: labelColor,
          dim,
        });
      }
    }
  }

  // Point values (#1828): every series' labels are placed together, so one
  // series' value never prints over another's. A label goes above its point,
  // else below, right or left; one with no clear spot is dropped — smallest
  // |value| first — and its value stays on the point's hover.
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
      ],
    })),
    {
      fontSize: VALUE_FONT,
      reserved: eraTitles,
      markers: valueLabels.map((l) => ({ cx: l.cx, cy: l.cy, r: 4.5 })),
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
    m.top + plotH / 2,
    20,
    leftTint ?? textColor
  );
  if (dual) {
    drawYAxisTitle(
      svg,
      chart.yrlabel,
      m.top + plotH / 2,
      width - 18,
      rightTint ?? textColor
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
