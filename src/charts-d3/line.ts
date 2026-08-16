// ============================================================
// Hand-built line / multi-line / area renderer.
// Series-tinted value labels, 0-baseline, era bands (markArea parity),
// dual y-axis (§15.1: y-label / y-right-label grouped series).
// ============================================================

import { scalePoint, scaleLinear, type ScaleLinear } from 'd3-scale';
import { line as d3line, area as d3area } from 'd3-shape';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { mix, shapeFill } from '../palettes/color-utils';
import {
  type Svg,
  type Margins,
  type InlineTitleInfo,
  TICK_FONT,
  fmtNum,
  reserveHeader,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  drawValueLabel,
  planCategoryLabels,
  drawCategoryLabels,
} from './shared';

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
  const [loR, hiR] = dual ? extentFor('right') : [0, 1];

  // Horizontal margins first: the category-label plan needs the plot width to
  // know how much room one category owns, and the bottom margin then follows
  // from the plan (rotated labels stand taller than flat ones).
  const mLeft = computeLeftMargin(chart.ylabel, [fmtNum(hiL), fmtNum(loL)]);
  const mRight = dual
    ? computeLeftMargin(chart.yrlabel, [fmtNum(hiR), fmtNum(loR)])
    : 32;
  const plotW = width - mLeft - mRight;
  // scalePoint with padding(0.5) puts one slot's worth of space between
  // adjacent points, and half a slot at each end.
  const labelPlan = planCategoryLabels(
    data.map((d) => d.label),
    data.length > 0 ? plotW / data.length : plotW
  );
  const m: Margins = {
    top: top + 8,
    right: mRight,
    bottom: Math.max(64, labelPlan.height + (chart.xlabel ? 40 : 18)),
    left: mLeft,
  };
  const plotH = height - m.top - m.bottom;

  const x = scalePoint<string>()
    .domain(data.map((d) => d.label))
    .range([m.left, m.left + plotW])
    .padding(0.5);
  const yL = scaleLinear()
    .domain([loL, hiL])
    .nice()
    .range([m.top + plotH, m.top]);
  const yR: ScaleLinear<number, number> | null = dual
    ? scaleLinear()
        .domain([loR, hiR])
        .nice()
        .range([m.top + plotH, m.top])
    : null;
  const yFor = (s: number): ScaleLinear<number, number> =>
    dual && axisOf(s) === 'right' && yR ? yR : yL;
  const leftTint = dual ? soleAxisColor('left') : undefined;
  const rightTint = soleAxisColor('right');

  // era bands (markArea parity) — positioned on the left axis
  if (chart.eras?.length) {
    chart.eras.forEach((era, i) => {
      const xs = x(era.start);
      const xe = x(era.end);
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
      .text(fmtNum(t));
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
        .text(fmtNum(t));
    }
  }

  // x category labels — thinned, and rotated when thinning alone would cost too
  // many of them. See planCategoryLabels in ./shared.
  drawCategoryLabels(
    svg,
    data.map((d) => d.label),
    labelPlan,
    (i) => x(data[i]!.label) ?? 0,
    m.top + plotH,
    textColor
  );

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

  for (let s = 0; s < seriesCount; s++) {
    const color = seriesColor(s);
    const yy = yFor(s);
    const name = seriesNames[s] ?? `Series ${s + 1}`;
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

    if (isArea) {
      const areaGen = d3area<(typeof pts)[number]>()
        .x((p) => x(p.label) ?? 0)
        .y0(yy(Math.max(yy.domain()[0]!, 0)))
        .y1((p) => yy(p.v));
      g.append('path')
        .attr('class', 'dgmo-series-area')
        .attr('d', areaGen(pts) ?? '')
        .attr('fill', solid ? color : shapeFill(palette, color, isDark))
        .attr('stroke', 'none');
    }

    const lineGen = d3line<(typeof pts)[number]>()
      .x((p) => x(p.label) ?? 0)
      .y((p) => yy(p.v));
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
        .attr('cx', x(p.label) ?? 0)
        .attr('cy', yy(p.v))
        .attr('r', 3.5)
        .attr('fill', bgColor)
        .attr('stroke', color)
        .attr('stroke-width', 2);
      if (!chart.noValue) {
        drawValueLabel(
          svg,
          fmtNum(p.v),
          x(p.label) ?? 0,
          yy(p.v) - 10,
          labelColor
        );
      }
    }
  }

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
