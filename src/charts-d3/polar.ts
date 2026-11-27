// ============================================================
// Hand-built polar-area (rose) renderer — SPIKE (Tier 2).
// Equal-angle sectors; radius proportional to value (ECharts roseType:radius).
// ============================================================

import { arc as d3arc } from 'd3-shape';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { getSegmentColors, shapeFill } from '../palettes/color-utils';
import { type Svg, chartFormatter, tagDatum } from './shared';
import { MAX_POLAR_AREA_WEDGES } from './polar-limits';
import { fitLabel } from '../utils/fit-label';
import { measureText, truncateText } from '../utils/text-measure';
import { FULL_TEXT_ATTR } from '../utils/full-text';

// Label text top above its anchor: the 13px label's em box less its +4
// baseline drop. The em, not the cap height, so the label keeps the same air
// under the title as every other chart's text (#2111).
const LABEL_TOP_ABOVE_ANCHOR = 13 - 4;
const LABEL_FONT = 13;
/** Descender below the last baseline's +4 drop. */
const LABEL_BELOW_ANCHOR = 4 + 4;
/** Air between two stacked labels on one side. */
const LABEL_SPACING = 2;
/** Baseline-to-baseline step of a wrapped label. */
const LABEL_LINE = 16;
/** Ring to label anchor, and anchor to the text's near end. */
const LABEL_GAP = 14;
const LABEL_NUDGE = 4;
/** Air kept between a label and the canvas edge. */
const EDGE_PAD = 8;
/** The ring never shrinks below this to make room for labels (#2458). */
const MIN_OUTER_R = 60;
/** A wrapped label: up to two name lines and the value line. */
const LABEL_MAX_LINES = 3;

export function renderPolarArea(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  topInset: number
): void {
  // The parser already cuts to the limit (#2457); this guards a chart built
  // by hand.
  const data = chart.data
    .slice(0, MAX_POLAR_AREA_WEDGES)
    .filter((d) => d.value > 0);
  // The author's `format` / `unit` / `locale` (#1831); under `format compact`
  // every value prints in one unit (#2036).
  const fmt = chartFormatter(
    chart,
    data.map((d) => d.value)
  );
  const n = data.length;
  if (n === 0) return;
  const fillMode = chart.fillMode;
  const total = data.reduce((a, d) => a + d.value, 0);
  const maxValue = Math.max(...data.map((d) => d.value)) || 1;

  const cx = width / 2;
  const top = topInset + 8;
  const seg = (2 * Math.PI) / n;
  // Horizontal reach of each label's anchor, per unit of ring radius
  // (d3 angle 0 = top, clockwise).
  const reach = data.map((_, i) => Math.abs(Math.sin((i + 0.5) * seg)));
  const labels = data.map((d) => {
    const pct = Math.round((d.value / total) * 100);
    const nm = chart.noName ? '' : d.label;
    const tail = [
      chart.noValue ? '' : fmt(d.value),
      chart.noPercent ? '' : `(${pct}%)`,
    ]
      .filter(Boolean)
      .join(' ');
    return { nm, tail, text: [nm, tail].filter(Boolean).join(' — ') };
  });

  // Long labels (#2458), in order: shrink the ring until every label fits
  // on one line beside it, down to MIN_OUTER_R; then wrap; then cut with `…`.
  const ringR = Math.min(width / 2 - 200, (height - top) / 2 - 40);
  const fitR = Math.min(
    ...labels.map((l, i) => {
      if (!l.text || reach[i]! < 1e-6) return Infinity;
      const w = measureText(l.text, LABEL_FONT);
      return (width / 2 - LABEL_NUDGE - EDGE_PAD - w) / reach[i]! - LABEL_GAP;
    })
  );
  const startR = Math.min(ringR, Math.max(MIN_OUTER_R, fitR));

  /** Lay the labels out at ring radius `R`, each in at most `maxLines`. */
  const layout = (R: number, maxLines: number) => {
    const fitted = labels.map((l, i) => {
      const room =
        width / 2 - reach[i]! * (R + LABEL_GAP) - LABEL_NUDGE - EDGE_PAD;
      if (!l.text || measureText(l.text, LABEL_FONT) <= room)
        return { lines: l.text ? [l.text] : [], cut: false };
      if (l.nm && l.tail && maxLines > 1) {
        // The value line stays whole; the name takes the lines above it.
        const name = fitLabel(l.nm, LABEL_FONT, room, maxLines - 1);
        const tail = truncateText(l.tail, LABEL_FONT, room);
        return {
          lines: [...name.lines, tail],
          cut: name.truncated || tail !== l.tail,
        };
      }
      const f = fitLabel(l.text, LABEL_FONT, room, maxLines);
      return { lines: f.lines, cut: f.truncated };
    });
    // Each label block is centred on its anchor, 14 past the ring at its
    // wedge's mid-angle. Ink runs from its top line's em top to its last
    // line's descender.
    const half = (i: number) =>
      (Math.max(0, fitted[i]!.lines.length - 1) * LABEL_LINE) / 2;
    const above = (i: number) => half(i) + LABEL_TOP_ABOVE_ANCHOR;
    const below = (i: number) => half(i) + LABEL_BELOW_ANCHOR;
    const ideal = data.map(
      (_, i) => -Math.cos((i + 0.5) * seg) * (R + LABEL_GAP)
    );
    const c = [...ideal];
    // Crowded labels (the pie's leader-label model): on each side, labels
    // move apart vertically, always away from the equator, so a moved label
    // only gets further from the ring. The two nearest the equator part
    // around their midpoint.
    for (const right of [true, false]) {
      const side = data
        .map((_, i) => i)
        .filter(
          (i) =>
            fitted[i]!.lines.length > 0 &&
            Math.sin((i + 0.5) * seg) >= 0 === right
        )
        .sort((p, q) => ideal[p]! - ideal[q]!);
      if (side.length === 0) continue;
      let k = side.findIndex((i) => ideal[i]! >= 0);
      if (k === -1) k = side.length;
      if (k > 0 && k < side.length) {
        const u = side[k - 1]!;
        const d = side[k]!;
        const need = below(u) + LABEL_SPACING + above(d) - (c[d]! - c[u]!);
        if (need > 0) {
          c[u]! -= need / 2;
          c[d]! += need / 2;
        }
      }
      for (let j = k - 2; j >= 0; j--) {
        const i = side[j]!;
        const nx = side[j + 1]!;
        c[i] = Math.min(c[i]!, c[nx]! - above(nx) - LABEL_SPACING - below(i));
      }
      for (let j = k + 1; j < side.length; j++) {
        const i = side[j]!;
        const pv = side[j - 1]!;
        c[i] = Math.max(c[i]!, c[pv]! + below(pv) + LABEL_SPACING + above(i));
      }
    }
    // Top-aligned on the body band (#1838): the highest of the wedges'
    // corners and the labels sets the top.
    const rOf = (v: number) => R * 0.14 + (v / maxValue) * (R * 0.86);
    const has = (i: number) => fitted[i]!.lines.length > 0;
    const rise = Math.max(
      ...data.map((d, i) => {
        const wedge =
          Math.max(Math.cos(i * seg), Math.cos((i + 1) * seg)) * rOf(d.value);
        return has(i) ? Math.max(wedge, above(i) - c[i]!) : wedge;
      })
    );
    const drop = Math.max(
      R,
      ...data.map((_, i) => (has(i) ? c[i]! + below(i) : 0))
    );
    return {
      R,
      fitted,
      c,
      ideal,
      half,
      cy: top + rise,
      bottom: top + rise + drop,
    };
  };

  // Scale first, then fewer lines (more cutting), until the labels fit the
  // canvas height too; the last try is drawn whatever it gives.
  let lay = layout(startR, LABEL_MAX_LINES);
  search: for (let lines = LABEL_MAX_LINES; lines >= 1; lines--) {
    for (let R = startR; ; R = Math.max(MIN_OUTER_R, R * 0.85)) {
      lay = layout(Math.min(R, startR), lines);
      if (lay.bottom <= height - EDGE_PAD) break search;
      if (R <= MIN_OUTER_R || R <= 0) break;
    }
  }
  const { R: outerR, fitted, c, ideal, half, cy } = lay;
  const innerR = outerR * 0.14;

  const segColors = getSegmentColors(palette, n);
  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

  data.forEach((d, i) => {
    const stroke = d.color ?? segColors[i % segColors.length]!;
    const r = innerR + (d.value / maxValue) * (outerR - innerR);
    const a0 = i * seg;
    const a1 = a0 + seg;
    const arcGen = d3arc<unknown>()
      .innerRadius(innerR)
      .outerRadius(r)
      .startAngle(a0)
      .endAngle(a1);
    const pct = Math.round((d.value / total) * 100);
    const sector = g
      .append('path')
      .attr('d', arcGen({}) ?? '')
      .attr('fill', shapeFill(palette, stroke, isDark, { mode: fillMode }))
      .attr('stroke', stroke)
      .attr('stroke-width', 2);
    tagDatum(sector, {
      line: d.lineNumber,
      key: d.label,
      name: d.label,
      value: `${fmt(d.value)} (${pct}%)`,
      color: stroke,
    });

    // external label at sector mid-angle (d3 angle 0 = top, clockwise)
    const mid = a0 + seg / 2 - Math.PI / 2;
    const rightSide = Math.cos(mid) >= 0;
    const lx = Math.cos(mid) * (outerR + LABEL_GAP);
    const { lines, cut } = fitted[i]!;
    if (lines.length) {
      const x = lx + (rightSide ? LABEL_NUDGE : -LABEL_NUDGE);
      // A label moved off its wedge's angle gets a leader back to the ring.
      if (Math.abs(c[i]! - ideal[i]!) > 1)
        g.append('line')
          .attr('x1', Math.cos(mid) * (outerR + 2))
          .attr('y1', Math.sin(mid) * (outerR + 2))
          .attr('x2', lx)
          .attr('y2', c[i]!)
          .attr('stroke', stroke)
          .attr('stroke-width', 1);
      const t = g
        .append('text')
        .attr('x', x)
        .attr('y', c[i]! + 4 - half(i))
        .attr('text-anchor', rightSide ? 'start' : 'end')
        .attr('fill', textColor)
        .attr('font-size', LABEL_FONT)
        .attr('font-family', FONT_FAMILY);
      if (lines.length === 1) t.text(lines[0]!);
      else
        lines.forEach((line, k) =>
          t
            .append('tspan')
            .attr('x', x)
            .attr('dy', k === 0 ? 0 : LABEL_LINE)
            .text(line)
        );
      if (cut) t.attr(FULL_TEXT_ATTR, labels[i]!.text);
    }
  });
}
