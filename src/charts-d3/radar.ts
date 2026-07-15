// ============================================================
// Hand-built radar renderer — SPIKE (Tier 2).
// One filled polygon per series over N value-axes; polygon grid rings + spokes.
// Multi-series (§15.1): a `series` block draws one polygon + markers per series,
// colored by series index from the palette, with the shared series legend
// injected by the dispatcher (charts-d3/index.ts). Single-series is unchanged.
// ============================================================

import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import { type Svg, fmtNum, tagDatum } from './shared';

const RINGS = 5;

/** Value of data point `d` for series index `s` (0 = primary, rest = extraValues). */
function seriesValue(
  d: { value: number; extraValues?: number[] },
  s: number
): number {
  return s === 0 ? d.value : (d.extraValues?.[s - 1] ?? 0);
}

export function renderRadar(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  topInset: number
): void {
  const data = chart.data;
  const n = data.length;
  if (n < 3) return;
  const solid = chart.fillMode;

  const seriesNames = chart.seriesNames?.length
    ? chart.seriesNames
    : [chart.series ?? ''];
  const seriesCount = Math.max(
    1,
    seriesNames.length,
    1 + Math.max(0, ...data.map((d) => d.extraValues?.length ?? 0))
  );
  const multi = seriesCount > 1;

  // Single-series keeps the original palette.primary default (colors[0] is the
  // categorical "red", so switching would regress the single-series look);
  // multi-series colors by series index to match the injected legend.
  const seriesColor = (s: number): string =>
    multi
      ? (chart.seriesNameColors?.[s] ?? colors[s % colors.length]!)
      : (chart.color ?? chart.seriesNameColors?.[0] ?? palette.primary);

  // Max across every series value so all polygons share one scale.
  const allValues: number[] = [];
  for (const d of data)
    for (let s = 0; s < seriesCount; s++) allValues.push(seriesValue(d, s));
  const maxValue = Math.max(...allValues) * 1.15 || 1;

  const cx = width / 2;
  const top = topInset + 8;
  const cy = top + (height - top) / 2;
  const radius = Math.min(width / 2 - 130, (height - top) / 2 - 50);

  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number): [number, number] => [
    cx + Math.cos(angle(i)) * r,
    cy + Math.sin(angle(i)) * r,
  ];

  // grid rings (polygons) + spokes
  for (let l = 1; l <= RINGS; l++) {
    const r = (radius * l) / RINGS;
    const poly = data.map((_, i) => pt(i, r).join(',')).join(' ');
    svg
      .append('polygon')
      .attr('points', poly)
      .attr('fill', 'none')
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.4);
  }
  data.forEach((_, i) => {
    const [x, y] = pt(i, radius);
    svg
      .append('line')
      .attr('x1', cx)
      .attr('y1', cy)
      .attr('x2', x)
      .attr('y2', y)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.4);
    // axis name
    const [lx, ly] = pt(i, radius + 18);
    const c = Math.cos(angle(i));
    svg
      .append('text')
      .attr('x', lx)
      .attr('y', ly + 4)
      .attr(
        'text-anchor',
        Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end'
      )
      .attr('fill', textColor)
      .attr('font-size', 14)
      .attr('font-family', FONT_FAMILY)
      .text(data[i]!.label);
  });

  // one polygon (+ point markers + value labels) per series
  for (let s = 0; s < seriesCount; s++) {
    const color = seriesColor(s);
    const name = seriesNames[s] ?? `Series ${s + 1}`;
    const g = svg
      .append('g')
      .attr('class', 'dgmo-series')
      .attr('data-series-index', s)
      .attr('data-series-name', name)
      .attr('data-color', color);
    const seriesLine = chart.seriesNameLineNumbers?.[s];
    if (seriesLine !== undefined) g.attr('data-line-number', seriesLine);

    const poly = data
      .map((d, i) => pt(i, (seriesValue(d, s) / maxValue) * radius).join(','))
      .join(' ');
    // Multi-series polygons overlap, so they need true alpha (not the opaque
    // shapeFill tint) — otherwise the last series painted hides the rest.
    // Single-series keeps the original opaque tint.
    g.append('polygon')
      .attr('points', poly)
      .attr('fill', solid || multi ? color : shapeFill(palette, color, isDark))
      .attr('fill-opacity', solid ? 0.6 : multi ? 0.2 : 1)
      .attr('stroke', color)
      .attr('stroke-width', 2);

    data.forEach((d, i) => {
      const v = seriesValue(d, s);
      const [x, y] = pt(i, (v / maxValue) * radius);
      const vtx = g
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', 4)
        .attr('fill', color);
      tagDatum(vtx, {
        line: d.lineNumber,
        key: multi ? `${name} ${d.label}` : d.label,
        name: multi ? `${name} — ${d.label}` : d.label,
        value: fmtNum(v),
        color,
      });
      if (!chart.noValue) {
        // Place the value label just past the dot, along the spoke away from
        // center, so each number reads outward from its vertex.
        const [lx, ly] = pt(i, (v / maxValue) * radius + 14);
        const c = Math.cos(angle(i));
        const s = Math.sin(angle(i));
        g.append('text')
          .attr('x', lx)
          .attr('y', ly + (s < -0.3 ? 0 : s > 0.3 ? 11 : 4))
          .attr(
            'text-anchor',
            Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end'
          )
          .attr('fill', multi ? color : textColor)
          .attr('font-size', 12)
          .attr('font-family', FONT_FAMILY)
          .text(fmtNum(v));
      }
    });
  }
}
