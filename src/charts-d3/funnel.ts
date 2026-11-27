// ============================================================
// Hand-built funnel renderer — SPIKE (Tier 2).
// Descending-sorted contiguous trapezoid bands, width ∝ value; a zero stage
// has zero width and a tiny one a hairline (#2440). Names sit flush left of each band in the band's color; the value
// is centered inside the band (falling back beside the band when too
// narrow); the conversion % sits flush right — no leader lines.
// Layout is responsive: side text scales with pane width and the funnel
// shrinks/shifts so labels never clip at any dimension.
// `no-name` / `no-value` / `no-percent` suppress each part.
// ============================================================

import type * as d3Selection from 'd3-selection';
import type { ParsedFunnel } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { contrastText, shapeFill } from '../palettes/color-utils';
import { type Svg, chartFormatter, tagDatum } from './shared';
import { tabularText } from '../utils/tabular-figures';
import { measureText } from '../utils/text-measure';
import { capLabelColumn } from '../utils/label-column';
import { fitLabel } from '../utils/fit-label';
import { FULL_TEXT_ATTR } from '../utils/full-text';

const PAD = 12;
const MARGIN = 8;
/** Side-label line height, in em. */
const LABEL_LINE_EM = 1.2;
/**
 * Thinnest drawn non-zero stage, in px (#2440). A stage whose proportional
 * width is under FUNNEL_HAIRLINE_WIDTH is drawn between this and that on a
 * log scale of its value, so a much larger tiny stage is still wider.
 */
const FUNNEL_MIN_STAGE_WIDTH = 1;
/** Proportional widths below this many px are hairlines (#2440). */
const FUNNEL_HAIRLINE_WIDTH = 4;
/**
 * Narrowest plot a funnel draws, in px (#2441). The side columns are capped
 * at LABEL_COLUMN_MAX_SHARE each, so any canvas of 228px or more reaches it;
 * below that the chart says it is too narrow instead of drawing nothing.
 */
const FUNNEL_MIN_PLOT_WIDTH = 60;
/** Most lines a capped stage name wraps to before it is cut with `…`. */
const NAME_MAX_LINES = 3;
/** Most lines a capped value/percent label wraps to. */
const RIGHT_MAX_LINES = 2;

/**
 * Stage-over-stage conversion (#2440). 0 of 0 has no conversion (`—`); an
 * exact 0% prints `0%`; `<1%` only for a share strictly between 0 and 1%.
 */
export function funnelConversionLabel(value: number, previous: number): string {
  if (previous === 0) return '—';
  const pct = (value / previous) * 100;
  if (pct === 0) return '0%';
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

/**
 * A formatter that never prints a non-zero value as zero (#2440): when the
 * chart's formatter rounds it to no non-zero digit, print two significant
 * figures instead (`0.0001`, `1.5e-7`).
 */
export function honestFormatter(
  fmt: (n: number) => string
): (n: number) => string {
  return (n) => {
    const s = fmt(n);
    if (n === 0 || !isFinite(n) || /[1-9]/.test(s)) return s;
    return String(Number(n.toPrecision(2)));
  };
}

export function renderFunnel(
  svg: Svg,
  chart: ParsedFunnel,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  topInset: number
): void {
  const sorted = [...chart.data].sort((a, b) => b.value - a.value);
  // The author's `format` / `unit` / `locale` (#1831); under `format compact`
  // every value prints in one unit (#2036).
  const fmt = honestFormatter(
    chartFormatter(
      chart,
      sorted.map((d) => d.value)
    )
  );
  const n = sorted.length;
  if (n === 0) return;
  const fillMode = chart.fillMode;

  const top = topInset + 8;
  const bottom = height - 30;
  const H = bottom - top;
  const bandH = H / n;
  const maxValue = sorted[0]!.value || 1;

  // Side text scales with pane width (21px from ~1100px, floor 11).
  const sideFont = Math.max(11, Math.min(21, width / 52));
  const est = (s: string, f: number) => s.length * f * 0.6;

  const pctLabelFor = (i: number) =>
    funnelConversionLabel(sorted[i]!.value, sorted[i - 1]!.value);
  const minNonZero = Math.min(
    ...sorted.map((d) => (d.value > 0 ? d.value : Infinity))
  );
  const rightTextFor = (i: number, valueInside: boolean) => {
    const parts: string[] = [];
    if (!chart.noValue && !valueInside) parts.push(fmt(sorted[i]!.value));
    if (!chart.noPercent && i > 0) parts.push(pctLabelFor(i));
    return parts.join(' · ');
  };

  // A long name would ask for more than the canvas (#2441): the gutter is
  // capped at LABEL_COLUMN_MAX_SHARE and names past it wrap, then cut.
  const nameNatural = chart.noName
    ? 0
    : Math.max(...sorted.map((d) => est(d.label, sideFont))) + PAD;
  const nameW = capLabelColumn(nameNatural, width, 0).width;
  const namesCapped = nameNatural > nameW;

  const bandWidthsAt = (plotW: number, i: number) => {
    // Width ∝ value; zero is zero wide; a hairline keeps its order (#2440).
    const hairV = (FUNNEL_HAIRLINE_WIDTH / plotW) * maxValue;
    const scale = (v: number) => {
      if (v <= 0) return 0;
      const w = (v / maxValue) * plotW;
      if (w >= FUNNEL_HAIRLINE_WIDTH) return w;
      const span = Math.log(hairV) - Math.log(minNonZero);
      const t = span > 0 ? (Math.log(v) - Math.log(minNonZero)) / span : 0;
      return (
        FUNNEL_MIN_STAGE_WIDTH +
        (FUNNEL_HAIRLINE_WIDTH - FUNNEL_MIN_STAGE_WIDTH) * t
      );
    };
    const topW = scale(sorted[i]!.value);
    const botW = i < n - 1 ? scale(sorted[i + 1]!.value) : topW * 0.7;
    return { topW, botW };
  };
  const valueSizeAt = (plotW: number, i: number) => {
    const { topW, botW } = bandWidthsAt(plotW, i);
    const wMid = (topW + botW) / 2;
    const label = fmt(sorted[i]!.value);
    const perChar = label.length * 0.6;
    // Fill the band with the value: ~55% of band height, shrink to fit.
    const size = Math.min(bandH * 0.55, (wMid - 16) / perChar);
    // The baseline sits 0.35·size below mid-height, where a narrowing band
    // has lost (topW − botW)·0.35·size/bandH of width. Only when the value's
    // ink would cross the band's outline THERE — a steep band, stages orders
    // of magnitude apart (#1765) — refit it to that width; every other band
    // keeps the mid-height fit. Ink starts ~0.04·size inside the measured
    // advance (Inter Bold digits' side bearing is 0.037–0.054 em) and the
    // 2px outline reaches 1px past the edge, so that much overhang is drawn
    // inside the shape.
    const narrowing = (Math.max(0, topW - botW) * 0.35) / bandH;
    const overhang =
      (measureText(label, size, { bold: true }) - (wMid - narrowing * size)) /
      2;
    if (overhang <= 1 + 0.04 * size) return size;
    return Math.min(bandH * 0.55, (wMid - 16) / (perChar + narrowing));
  };
  const valueInsideAt = (plotW: number, i: number) =>
    !chart.noValue && valueSizeAt(plotW, i) >= 13;

  const layout = (rightW: number) => {
    const spanL = MARGIN + nameW;
    const spanR = width - MARGIN - rightW;
    // Never wider than the span between the gutters, so the centre stays
    // inside the canvas (#2441).
    const plotW = Math.min(
      spanR - spanL,
      Math.max(width * 0.25, Math.min(width * 0.6, spanR - spanL))
    );
    const lo = spanL + plotW / 2;
    const hi = spanR - plotW / 2;
    const cx = Math.min(Math.max(width / 2, lo), hi);
    return { plotW, cx };
  };
  const rightCap = capLabelColumn(Infinity, width, 0).width;

  // Two passes: first size gutters assuming every value fits inside its
  // band, then re-reserve for the values that fall back to the right rail.
  const maxRightEst = (plotW: number | null) =>
    Math.max(
      0,
      ...sorted.map((_, i) =>
        est(
          rightTextFor(i, plotW === null ? true : valueInsideAt(plotW, i)),
          sideFont
        )
      )
    );
  let rightNatural = maxRightEst(null) + PAD;
  let rightW = Math.min(rightNatural, rightCap);
  let { plotW, cx } = layout(rightW);
  rightNatural = maxRightEst(plotW) + PAD;
  rightW = Math.min(rightNatural, rightCap);
  ({ plotW, cx } = layout(rightW));
  const rightCapped = rightNatural > rightW;
  if (plotW < FUNNEL_MIN_PLOT_WIDTH) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', (top + bottom) / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.textMuted)
      .attr('font-size', 12)
      .attr('font-family', FONT_FAMILY)
      .text('Too narrow to draw this funnel — widen the chart');
    return;
  }

  // Side labels (#2439). Each stage's name (left) and value/percent (right)
  // sits beside its band. When bands are shorter than a label line, a column
  // is spread top to bottom so no two labels overlap, set in an outer column
  // clear of every band, and joined to its band by a leader line — the pie's
  // label avoidance (pie.ts). A column that needs no spreading draws exactly
  // as before.
  interface SideLabel {
    i: number;
    lines: string[];
    full?: string;
    ideal: number;
    c: number;
  }
  const lo = top;
  const hi = bottom;
  const leftLabels: SideLabel[] = [];
  const rightLabels: SideLabel[] = [];
  const valueInsides = sorted.map((_, i) => valueInsideAt(plotW, i));
  sorted.forEach((d, i) => {
    const yMid = top + (i + 0.5) * bandH;
    // A capped column wraps its labels, then cuts the last line (#2441).
    const fit = (text: string, capped: boolean, w: number, max: number) => {
      if (!capped) return { lines: [text] };
      const f = fitLabel(text, sideFont, w - PAD, max, { bold: true });
      return f.truncated ? { lines: f.lines, full: text } : { lines: f.lines };
    };
    if (!chart.noName)
      leftLabels.push({
        i,
        ...fit(d.label, namesCapped, nameW, NAME_MAX_LINES),
        ideal: yMid,
        c: yMid,
      });
    const right = rightTextFor(i, valueInsides[i]!);
    if (right)
      rightLabels.push({
        i,
        ...fit(right, rightCapped, rightW, RIGHT_MAX_LINES),
        ideal: yMid,
        c: yMid,
      });
  });
  // A column taller than the band area shrinks its font, as the pie's does.
  const linesIn = (col: SideLabel[]) =>
    col.reduce((t, l) => t + l.lines.length, 0);
  const maxLines = Math.max(linesIn(leftLabels), linesIn(rightLabels), 1);
  const labelFont = Math.min(sideFont, (hi - lo) / (maxLines * LABEL_LINE_EM));
  const lineH = labelFont * LABEL_LINE_EM;
  const spread = (col: SideLabel[]): boolean => {
    col.forEach((l, k) => {
      const h = l.lines.length * lineH;
      const prev = col[k - 1];
      const floor = prev
        ? prev.c + (prev.lines.length * lineH) / 2 + h / 2
        : lo + h / 2;
      l.c = Math.max(l.ideal, floor);
    });
    for (let k = col.length - 1; k >= 0; k--) {
      const l = col[k]!;
      const h = l.lines.length * lineH;
      const next = col[k + 1];
      const ceil = next
        ? next.c - (next.lines.length * lineH) / 2 - h / 2
        : hi - h / 2;
      l.c = Math.min(l.c, ceil);
    }
    return (
      labelFont < sideFont ||
      col.some((l) => Math.abs(l.c - l.ideal) > 0.5 || l.lines.length > 1)
    );
  };
  /** Baseline of line `j` of a label centred at `l.c`. */
  const lineY = (l: SideLabel, j: number) =>
    l.c + (j - (l.lines.length - 1) / 2) * lineH + labelFont * 0.35;
  const leftOuter = spread(leftLabels);
  const rightOuter = spread(rightLabels);

  // Hover pairing (#2439): a label and its leader carry their stage's line,
  // so hovering one lights its stage and hovering a stage lights them
  // (interactions.ts, `.dgmo-ptlabel`).
  const pair = <E extends Element>(
    sel: d3Selection.Selection<E, unknown, null, undefined>,
    i: number
  ) =>
    sel
      .attr('class', 'dgmo-ptlabel')
      .attr('data-line-number', sorted[i]!.lineNumber);
  // The outer columns clear the widest band, which is the top one.
  const outerHalf = plotW / 2;
  const leftAt = new Map(leftLabels.map((l) => [l.i, l]));
  const rightAt = new Map(rightLabels.map((l) => [l.i, l]));

  sorted.forEach((d, i) => {
    const stroke = d.color ?? colors[chart.data.indexOf(d) % colors.length]!;
    const fill = shapeFill(palette, stroke, isDark, { mode: fillMode });
    const { topW, botW } = bandWidthsAt(plotW, i);
    const y0 = top + i * bandH;
    const y1 = y0 + bandH;
    const seg = svg
      .append('polygon')
      .attr(
        'points',
        `${cx - topW / 2},${y0} ${cx + topW / 2},${y0} ${cx + botW / 2},${y1} ${cx - botW / 2},${y1}`
      )
      .attr('fill', fill)
      .attr('stroke', stroke)
      // A zero stage is a band of no width: nothing to outline (#2440).
      .attr('stroke-width', topW === 0 && botW === 0 ? 0 : 2);
    tagDatum(seg, {
      line: d.lineNumber,
      key: d.label,
      name: d.label,
      value: fmt(d.value),
      color: stroke,
    });

    const yMid = (y0 + y1) / 2;
    const halfEdge = (topW + botW) / 4; // half of the band's width at yMid
    const leader = (side: 1 | -1, x: number, c: number) => {
      const edge = cx + side * halfEdge;
      pair(
        svg
          .append('path')
          .attr('d', `M${edge + side * 2},${yMid}L${x - side * 4},${c}`)
          .attr('fill', 'none')
          .attr('stroke', stroke)
          .attr('stroke-width', 1),
        i
      );
    };
    const name = leftAt.get(i);
    if (name) {
      const x = leftOuter ? cx - outerHalf - PAD : cx - halfEdge - PAD;
      if (leftOuter) leader(-1, x, name.c);
      name.lines.forEach((line, j) => {
        const t = pair(
          svg
            .append('text')
            .attr('x', x)
            .attr('y', lineY(name, j))
            .attr('text-anchor', 'end')
            .attr('fill', stroke)
            .attr('font-size', labelFont)
            .attr('font-weight', 'bold')
            .attr('font-family', FONT_FAMILY),
          i
        ).text(line);
        if (j === 0 && name.full) t.attr(FULL_TEXT_ATTR, name.full);
      });
    }

    const valueInside = valueInsides[i]!;
    if (valueInside) {
      const valueSize = valueSizeAt(plotW, i);
      const valueFill =
        fillMode === 'solid'
          ? contrastText(fill, palette.textOnFillLight, palette.textOnFillDark)
          : stroke;
      svg
        .append('text')
        .attr('x', cx)
        .attr('y', yMid + valueSize * 0.35)
        .attr('text-anchor', 'middle')
        .attr('fill', valueFill)
        .attr('font-size', valueSize)
        .attr('font-weight', 'bold')
        .attr('font-family', FONT_FAMILY)
        .call(tabularText(fmt(d.value), valueSize, { bold: true }));
    }
    const right = rightAt.get(i);
    if (right) {
      const x = rightOuter ? cx + outerHalf + PAD : cx + halfEdge + PAD;
      if (rightOuter) leader(1, x, right.c);
      right.lines.forEach((line, j) => {
        const text = svg
          .append('text')
          .attr('x', x)
          .attr('y', lineY(right, j))
          .attr('text-anchor', 'start')
          .attr('font-size', labelFont)
          .attr('font-weight', 'bold')
          .attr('font-family', FONT_FAMILY);
        pair(text.attr('fill', stroke), i).call(
          tabularText(line, labelFont, { bold: true })
        );
        if (j === 0 && right.full) text.attr(FULL_TEXT_ATTR, right.full);
      });
    }
  });
}
