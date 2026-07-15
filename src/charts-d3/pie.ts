// ============================================================
// Hand-built pie / doughnut renderer — SPIKE.
// ECharts-style: 25% tint fill + full-strength border, external leader-line
// labels ("Name — value (pct%)"), doughnut center total.
// ============================================================

import { pie as d3pie, arc as d3arc } from 'd3-shape';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { getSegmentColors, shapeFill } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { type Svg, fmtNum, tagDatum } from './shared';

const LABEL_FONT = 14;

export function renderPie(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  topInset: number
): void {
  const data = chart.data.filter((d) => d.value > 0);
  if (data.length === 0) return;
  // A hole turns the pie into a ring — `pie` + a `hole` directive. (#23)
  const holeRatio = chart.hole;
  const hasHole = holeRatio !== undefined;
  const fillMode = chart.fillMode;
  const total = data.reduce((a, d) => a + d.value, 0);

  const cx = width / 2;
  const top = topInset + 12;
  const availH = height - top;
  const cy = top + availH / 2;

  // Precompute the external label strings up front so the radius can reserve
  // horizontal room for the ACTUAL longest one. The elbow gutter alone (~1.2r)
  // doesn't account for the rendered TEXT width, so a long label like
  // "Cooks & Surgeons — 5 (5%)" overruns the canvas edge.
  const labels = data.map((d) => {
    const pct = Math.round((d.value / total) * 100);
    const nm = chart.noName ? '' : d.label;
    const tail = [
      chart.noValue ? '' : fmtNum(d.value),
      chart.noPercent ? '' : `(${pct}%)`,
    ]
      .filter(Boolean)
      .join(' ');
    return [nm, tail].filter(Boolean).join(' — ');
  });
  const maxLabelLen = labels.reduce((m, s) => Math.max(m, s.length), 0);

  // Radius scales with the available box rather than reserving a FIXED pixel
  // gutter — a fixed gutter (e.g. width/2 - 220) collapses the pie to nothing on
  // a narrow canvas while the labels keep their pixel size and pile up. The
  // horizontal extent of the whole figure is, as a multiple of the radius:
  //   1 (arc) + 0.245 (elbow out+run) + 0.023 (text pad) + text width.
  // Text width per side ≈ maxLabelLen · font · 0.55, and font = 0.078·r, so it
  // is itself ∝ r — the extent is linear in r and solves directly. Reserving it
  // both sides keeps even the longest label inside the canvas.
  const MARGIN = 6;
  const halfW = width / 2 - MARGIN;
  const rH = availH / 2 - availH * 0.06;
  const labelExtent = 1.268 + 0.0428 * maxLabelLen;
  const rLabeled = Math.min(rH, halfW / labelExtent);
  // Below this the leader-line labels can't separate legibly around the arc (or
  // there are none) — drop them and let the pie fill the box instead.
  const showLabels = maxLabelLen > 0 && rLabeled >= 45;
  const rPlain = Math.min(rH, halfW * 0.94);
  const radius = Math.max(8, showLabels ? rLabeled : rPlain);

  // Everything label-related scales off the radius (180 = the export-size
  // reference radius that the previous fixed constants were tuned for).
  const labelScale = radius / 180;
  const font = Math.max(7, LABEL_FONT * labelScale);
  const elbowOut = radius * 0.09; // radial stub off the arc
  const elbowRun = radius * 0.155; // horizontal run to the text

  const segColors = getSegmentColors(palette, data.length);
  const strokeFor = (i: number, override?: string) =>
    override ?? segColors[i % segColors.length]!;

  const arcs = d3pie<{ value: number }>()
    .sort(null)
    .value((d) => d.value)(data.map((d) => ({ value: d.value })));

  const arcGen = d3arc<(typeof arcs)[number]>()
    .innerRadius(hasHole ? radius * holeRatio! : 0)
    .outerRadius(radius);

  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

  arcs.forEach((a, i) => {
    const stroke = strokeFor(i, data[i]!.color);
    const fill = shapeFill(palette, stroke, isDark, { mode: fillMode });
    const pct = Math.round((data[i]!.value / total) * 100);
    const slice = g
      .append('path')
      .attr('d', arcGen(a) ?? '')
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 1.5);
    tagDatum(slice, {
      line: data[i]!.lineNumber,
      key: data[i]!.label,
      name: data[i]!.label,
      value: `${fmtNum(data[i]!.value)} (${pct}%)`,
      color: stroke,
    });

    // External leader-line label.
    if (!showLabels) return;
    const mid = (a.startAngle + a.endAngle) / 2 - Math.PI / 2;
    const rightSide = Math.cos(mid) >= 0;
    const x0 = Math.cos(mid) * radius;
    const y0 = Math.sin(mid) * radius;
    const x1 = Math.cos(mid) * (radius + elbowOut);
    const y1 = Math.sin(mid) * (radius + elbowOut);
    const x2 = x1 + (rightSide ? elbowRun : -elbowRun);
    const label = labels[i]!;
    if (label) {
      // Tag the leader-line + label with the same emph-key as the wedge so
      // hover (baked-CSS :has() and the app's JS dim) emphasizes all three
      // together; colour the label text to match its segment.
      const tag = {
        line: data[i]!.lineNumber,
        key: data[i]!.label,
        name: data[i]!.label,
        value: `${fmtNum(data[i]!.value)} (${pct}%)`,
        color: stroke,
      };
      tagDatum(
        g
          .append('polyline')
          .attr('points', `${x0},${y0} ${x1},${y1} ${x2},${y1}`)
          .attr('fill', 'none')
          .attr('stroke', stroke)
          .attr('stroke-width', 1),
        tag
      );
      tagDatum(
        g
          .append('text')
          .attr('x', x2 + (rightSide ? font * 0.3 : -font * 0.3))
          .attr('y', y1 + font * 0.3)
          .attr('text-anchor', rightSide ? 'start' : 'end')
          .attr('fill', stroke)
          .attr('font-size', font)
          .attr('font-family', FONT_FAMILY)
          .text(label),
        tag
      );
    }
  });

  // Center total — shown by default whenever there is a hole, unless suppressed
  // with `no-center-total`. (#23)
  if (hasHole && !chart.noCenterTotal) {
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', Math.max(4, 8 * labelScale))
      .attr('fill', textColor)
      .attr('font-size', Math.max(11, 26 * labelScale))
      .attr('font-weight', 700)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(total));
  }
}
