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
  // Labels are decluttered onto a fixed column (radius·1.245) rather than sitting
  // at each slice's own angle, so EVERY label — not just equatorial ones — now
  // consumes the full horizontal extent. Reserve for that worst case.
  const labelExtent = 1.27 + 0.06 * maxLabelLen;
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

  // Collected label placements — deferred so we can run a vertical
  // declutter pass per side before drawing (small slices bunched near a pole
  // have near-identical y and would otherwise pile up horizontally).
  type LabelInfo = {
    rightSide: boolean;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    idealY: number;
    y: number;
    label: string;
    stroke: string;
    tag: Record<string, unknown>;
  };
  const labelInfos: LabelInfo[] = [];

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

    if (!showLabels) return;
    const label = labels[i]!;
    if (!label) return;
    const mid = (a.startAngle + a.endAngle) / 2 - Math.PI / 2;
    const rightSide = Math.cos(mid) >= 0;
    labelInfos.push({
      rightSide,
      x0: Math.cos(mid) * radius,
      y0: Math.sin(mid) * radius,
      // Radial stub end — meets the arc at 90° to the circle edge.
      x1: Math.cos(mid) * (radius + elbowOut),
      y1: Math.sin(mid) * (radius + elbowOut),
      idealY: Math.sin(mid) * (radius + elbowOut),
      y: 0,
      label,
      stroke,
      // Tag the leader-line + label with the same emph-key as the wedge so
      // hover (baked-CSS :has() and the app's JS dim) emphasizes all three
      // together; colour the label text to match its segment.
      tag: {
        line: data[i]!.lineNumber,
        key: data[i]!.label,
        name: data[i]!.label,
        value: `${fmtNum(data[i]!.value)} (${pct}%)`,
        color: stroke,
      },
    });
  });

  // Label avoidance. Each leader is a straight RADIAL line off the arc that
  // ends where a flat horizontal to the text begins — the label's only bend.
  // Crowded labels are separated by riding the radial ray OUTWARD (longer
  // stubs), so top labels fan up and bottom labels fan down; they stagger at
  // their own heights rather than sharing a column.
  if (showLabels && labelInfos.length > 0) {
    const labelX = radius + elbowOut + elbowRun;
    const minGap = font * 1.18;
    const bound = availH / 2 - font;
    for (const side of [true, false]) {
      const group = labelInfos.filter((l) => l.rightSide === side);
      if (group.length === 0) continue;

      // Top half fans up (toward the pole), bottom half fans down — always
      // AWAY from the equator so stubs only lengthen and bends stay outside
      // the arc. Process each half from the label nearest the equator outward.
      const topHalf = group
        .filter((l) => l.idealY < 0)
        .sort((a, b) => b.idealY - a.idealY); // nearest equator first
      const botHalf = group
        .filter((l) => l.idealY >= 0)
        .sort((a, b) => a.idealY - b.idealY); // nearest equator first
      topHalf.forEach((l, i) => {
        l.y =
          i === 0 ? l.idealY : Math.min(l.idealY, topHalf[i - 1]!.y - minGap);
        l.y = Math.max(l.y, -bound);
      });
      botHalf.forEach((l, i) => {
        l.y =
          i === 0 ? l.idealY : Math.max(l.idealY, botHalf[i - 1]!.y + minGap);
        l.y = Math.min(l.y, bound);
      });

      const sx = side ? 1 : -1;
      const tx = sx * labelX;
      for (const l of group) {
        // Bend point rides the radial ray (collinear with the centre) at the
        // label's height — keeps the stub perfectly radial. Fall back to the
        // fixed stub tip for a centroid sitting on the horizontal axis.
        const xr = Math.abs(l.y0) < 0.001 ? l.x1 : (l.y * l.x0) / l.y0;
        tagDatum(
          g
            .append('polyline')
            .attr('points', `${l.x0},${l.y0} ${xr},${l.y} ${tx},${l.y}`)
            .attr('fill', 'none')
            .attr('stroke', l.stroke)
            .attr('stroke-width', 1),
          l.tag
        );
        tagDatum(
          g
            .append('text')
            .attr('x', tx + sx * font * 0.3)
            .attr('y', l.y + font * 0.3)
            .attr('text-anchor', side ? 'start' : 'end')
            .attr('fill', l.stroke)
            .attr('font-size', font)
            .attr('font-family', FONT_FAMILY)
            .text(l.label),
          l.tag
        );
      }
    }
  }

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
