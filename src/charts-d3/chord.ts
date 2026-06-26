// ============================================================
// Hand-built chord renderer — SPIKE (Tier 3).
// Mirrors the ECharts treatment: a CIRCULAR GRAPH (nodes evenly on a circle,
// curved bezier edges, width ∝ value, arrowheads for directed links), NOT
// true chord ribbons.
// ============================================================

import type { ParsedChord } from '../echarts';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import { measureText } from '../utils/text-measure';
import { type Svg, tagDatum } from './shared';

export function renderChord(
  svg: Svg,
  chart: ParsedChord,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  topInset: number
): void {
  const links = chart.links ?? [];
  if (links.length === 0) return;
  const solid = chart.solidFill === true;

  const names = Array.from(
    new Set(links.flatMap((l) => [l.source, l.target]))
  );
  const n = names.length;
  const idx = new Map(names.map((nm, i) => [nm, i]));
  const colorOf = (i: number) => colors[i % colors.length]!;

  const top = topInset + 8;
  const cx = width / 2;
  const cy = top + (height - top) / 2;
  const maxLabel = Math.max(0, ...names.map((nm) => measureText(nm, 14)));
  const radius = Math.min(width / 2 - maxLabel - 60, (height - top) / 2 - 50);

  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pos = (i: number): [number, number] => [
    cx + Math.cos(angle(i)) * radius,
    cy + Math.sin(angle(i)) * radius,
  ];

  // opposing-pair detection (offset curvature so A→B and B→A don't overlap)
  const pairKeys = new Set<string>();
  for (const l of links) {
    if (links.some((r) => r.source === l.target && r.target === l.source && r !== l))
      pairKeys.add(`${l.source}\0${l.target}`);
  }

  // edges (drawn under nodes)
  for (const link of links) {
    const si = idx.get(link.source)!;
    const ti = idx.get(link.target)!;
    const [x0, y0] = pos(si);
    const [x1, y1] = pos(ti);
    const hasOpp = pairKeys.has(`${link.source}\0${link.target}`);
    const base = 0.3;
    const curve = hasOpp
      ? link.source < link.target
        ? base + 0.15
        : base - 0.15
      : base;
    // control point pulled toward center → chord-like inward arc
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const ctrlX = mx + (cx - mx) * curve * 2;
    const ctrlY = my + (cy - my) * curve * 2;
    const w = Math.max(1, Math.min(link.value / 20, 10));
    const stroke = colorOf(si);
    const edge = svg
      .append('path')
      .attr('d', `M${x0},${y0} Q${ctrlX},${ctrlY} ${x1},${y1}`)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', w)
      .attr('stroke-opacity', 0.6);
    tagDatum(edge, {
      line: link.lineNumber,
      key: `edge:${link.source} ${link.target}`,
      name: `${link.source} → ${link.target}`,
      value: String(link.value),
      color: stroke,
    });
    if (link.directed) {
      // arrowhead at target, oriented along tangent (from control point)
      const ang = Math.atan2(y1 - ctrlY, x1 - ctrlX);
      const ah = 11;
      const tipX = x1 - Math.cos(ang) * 10;
      const tipY = y1 - Math.sin(ang) * 10;
      const a1 = ang + Math.PI - 0.4;
      const a2 = ang + Math.PI + 0.4;
      svg
        .append('polygon')
        .attr(
          'points',
          `${tipX},${tipY} ${tipX + Math.cos(a1) * ah},${tipY + Math.sin(a1) * ah} ${tipX + Math.cos(a2) * ah},${tipY + Math.sin(a2) * ah}`
        )
        .attr('fill', stroke)
        .attr('fill-opacity', 0.7);
    }
  }

  // nodes + labels
  names.forEach((nm, i) => {
    const [px, py] = pos(i);
    const stroke = colorOf(i);
    const dot = svg
      .append('circle')
      .attr('cx', px)
      .attr('cy', py)
      .attr('r', 10)
      .attr('fill', solid ? stroke : shapeFill(palette, stroke, isDark))
      .attr('stroke', stroke)
      .attr('stroke-width', 2);
    tagDatum(dot, { key: `node:${nm}`, name: nm, color: stroke });
    const c = Math.cos(angle(i));
    const lx = px + c * 16;
    const ly = py + Math.sin(angle(i)) * 16;
    svg
      .append('text')
      .attr('x', lx)
      .attr('y', ly + 4)
      .attr('text-anchor', Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end')
      .attr('fill', textColor)
      .attr('font-size', 14)
      .attr('font-family', FONT_FAMILY)
      .text(nm);
  });
}
