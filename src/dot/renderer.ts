// ============================================================
// Dot renderer — dot plot, dumbbell and strip (#1849)
// ============================================================
//
// Rows run down the left with their names; values sit across one fitted
// axis, so zero need not be on it (`x-axis` overrides the range). One value
// per row draws a dot; two or more draw a connector from the row's lowest to
// its highest value, under the dots. The connector is grey, or with
// `connector direction` green for a rise and red for a fall (`down` flips it).
// Each series name sits above its dot in the first row, in the series colour,
// so there is no legend. `gap` prints last − first at each row's right end.

import { scaleBand, scaleLinear } from 'd3-scale';
import { resolveColor } from '../colors';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { getSeriesColors, mix, themeBaseBg } from '../palettes/color-utils';
import {
  applyChartFrame,
  placeFrameTitle,
  reserveChartFrame,
} from '../utils/chart-frame';
import { initD3Chart, renderChartTitle } from '../utils/d3-helpers';
import type { D3ExportDimensions } from '../utils/d3-types';
import { fitLabel } from '../utils/fit-label';
import { makeNumberFormatter } from '../utils/number-format';
import { measureText } from '../utils/text-measure';
import { FRAME_BODY_TOP } from '../utils/title-constants';
import { buildValueAxis } from '../charts-d3/value-axis';
import { fmtNum, TICK_FONT, VALUE_FONT } from '../charts-d3/shared';
import { dotGap } from './parser';
import type { DotRow, ParsedDot } from './types';

const PAD = 20;
const TICK_GAP = 8;
const NAME_GAP = 14;
const VALUE_GAP = 6;
const DOT_R = 5.5;
const RING_W = 1.5;
const CONNECTOR_W = 2.5;
/** Room between two series names above the first row. */
const SERIES_LABEL_GAP = 6;
const NAME_LINE_PX = Math.round(TICK_FONT * 1.2);
const NAME_MAX_LINES = 2;
/** Most of the width the row names may take. */
const NAME_COLUMN_SHARE = 0.35;
const MINUS = '−';
const TICK_COUNT = 6;

/** The colour of series `s`: its own colour word, else the palette's order —
 *  or the primary colour when there is one series, as on `bar`. */
export function dotSeriesColor(
  parsed: Pick<ParsedDot, 'series'>,
  s: number,
  palette: PaletteColors
): string {
  const own = parsed.series[s]?.color;
  if (own) {
    const hex = resolveColor(own, palette);
    if (hex) return hex;
  }
  if (parsed.series.length <= 1) return palette.primary;
  const colors = getSeriesColors(palette);
  return colors[s % colors.length]!;
}

/** The connector's colour: grey, or by the row's rise or fall. */
export function dotConnectorColor(
  row: Pick<DotRow, 'values'>,
  parsed: Pick<ParsedDot, 'connector'>,
  palette: PaletteColors,
  grey: string
): string {
  const gap = dotGap(row);
  if (parsed.connector === 'grey' || gap === 0) return grey;
  const good = gap > 0 !== (parsed.connector === 'direction-down');
  return good ? palette.colors.green : palette.colors.red;
}

/** The text `gap` prints: `+7`, `−3` (a true minus), `0`. */
export function dotGapText(gap: number, fmt: (n: number) => string): string {
  if (gap === 0) return fmt(0);
  return `${gap < 0 ? MINUS : '+'}${fmt(Math.abs(gap))}`;
}

/**
 * Spread label centres apart so no two overlap, keeping each as near its dot
 * as it can, inside [lo, hi]. `widths` are parallel to `xs`.
 */
function spreadLabels(
  xs: readonly number[],
  widths: readonly number[],
  lo: number,
  hi: number
): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
  const out = [...xs];
  let edge = lo;
  for (const i of order) {
    const half = widths[i]! / 2;
    out[i] = Math.max(out[i]!, edge + half);
    edge = out[i] + half + SERIES_LABEL_GAP;
  }
  // Pushed past the right end: walk back from it.
  edge = hi;
  for (const i of [...order].reverse()) {
    const half = widths[i]! / 2;
    out[i] = Math.min(out[i]!, edge - half);
    edge = out[i] - half - SERIES_LABEL_GAP;
  }
  return out;
}

export function renderDot(
  container: HTMLDivElement,
  parsed: ParsedDot,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const rows = parsed.rows;
  if (rows.length === 0) return;
  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height: canvasHeight } = init;
  // The frame (subtitle, footer) takes its bands out of the canvas, so the
  // chart comes back at exactly the size asked for, as `bar` does (§1.15).
  const reserve = reserveChartFrame(parsed.frame, width);
  const height = canvasHeight - (reserve ? reserve.top + reserve.bottom : 0);
  svg
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('font-family', FONT_FAMILY)
    .attr('preserveAspectRatio', 'xMidYMin meet');

  const title = parsed.options['no-title'] === 'on' ? null : parsed.title;
  const titleExtra = renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    palette.text,
    onClickItem,
    2
  );

  const bg = themeBaseBg(palette, isDark);
  const gridColor = mix(palette.textMuted, bg, 18);
  const edgeColor = mix(palette.textMuted, bg, 40);
  const greyConnector = mix(palette.textMuted, bg, 45);
  const named = parsed.series.length > 0;

  // ── The value axis, fitted to the data ─────────────────────
  const all = rows.flatMap((r) => r.values);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // Round ends at the tick step, so both ends of the axis carry a tick.
  const [niceLo, niceHi] = scaleLinear()
    .domain([lo, hi === lo ? lo + 1 : hi])
    .nice(TICK_COUNT)
    .domain() as [number, number];
  const valueAxis = (range: [number, number]) =>
    buildValueAxis(niceLo, niceHi, parsed.xAxis, range, {
      dataLo: lo,
      dataHi: hi,
    });
  const ticks = valueAxis([0, 1]).ticks(TICK_COUNT);
  const gaps = rows.map(dotGap);
  const fmt = makeNumberFormatter(parsed.numberFormat, fmtNum, [
    ...ticks,
    ...all,
    ...gaps.map(Math.abs),
  ]);
  const tickText = (t: number) =>
    t < 0 ? `${MINUS}${fmt(Math.abs(t))}` : fmt(t);
  const gapTexts = parsed.gap ? gaps.map((g) => dotGapText(g, fmt)) : [];
  const gapW = parsed.gap
    ? Math.max(...gapTexts.map((t) => measureText(t, VALUE_FONT)))
    : 0;

  // ── Layout ─────────────────────────────────────────────────
  const names = rows.map(
    (r) =>
      fitLabel(r.label, TICK_FONT, width * NAME_COLUMN_SHARE, NAME_MAX_LINES)
        .lines
  );
  const nameW = Math.max(...names.flat().map((l) => measureText(l, TICK_FONT)));
  const top = (title ? FRAME_BODY_TOP : PAD) + titleExtra;
  // The series names stand above the first row's dots.
  const plotTop = top + (named ? VALUE_FONT + VALUE_GAP : 0);
  const plotBottom = height - PAD - NAME_GAP;
  const plotLeft = PAD + nameW + TICK_GAP + DOT_R;
  const plotRight =
    width - PAD - DOT_R - (parsed.gap ? gapW + VALUE_GAP + DOT_R : 0);
  const cat = scaleBand<string>()
    .domain(rows.map((_, i) => String(i)))
    .range([plotTop, plotBottom])
    .padding(0.2);
  const val = valueAxis([plotLeft, plotRight]);
  const g = svg.append('g').attr('class', 'dot-body');

  // ── Gridlines and ticks ────────────────────────────────────
  const grid = g.append('g').attr('class', 'dot-grid');
  ticks.forEach((t, k) => {
    const x = val(t);
    grid
      .append('line')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', plotTop)
      .attr('y2', plotBottom)
      .attr('stroke', k === 0 ? edgeColor : gridColor)
      .attr('stroke-width', 1);
    grid
      .append('text')
      .attr('class', 'dot-tick')
      .attr('x', x)
      .attr('y', plotBottom + NAME_GAP)
      .attr('text-anchor', 'middle')
      .attr('font-size', TICK_FONT)
      .attr('fill', palette.textMuted)
      .text(tickText(t));
  });

  // ── Rows: name, connector, dots, gap ───────────────────────
  const body = g.append('g').attr('class', 'dot-rows');
  const band = cat.bandwidth();
  rows.forEach((row, i) => {
    const cy = cat(String(i))! + band / 2;
    const item = body
      .append('g')
      .attr('class', 'dot-row')
      .attr('data-line-number', row.lineNumber);
    if (onClickItem)
      item
        .style('cursor', 'pointer')
        .on('click', () => onClickItem(row.lineNumber));

    const lines = names[i]!;
    const name = item
      .append('text')
      .attr('class', 'dot-label')
      .attr('text-anchor', 'end')
      .attr('font-size', TICK_FONT)
      .attr('fill', palette.text);
    const nameX = plotLeft - DOT_R - TICK_GAP;
    const nameY = cy - ((lines.length - 1) * NAME_LINE_PX) / 2;
    lines.forEach((l, k) =>
      name
        .append('tspan')
        .attr('x', nameX)
        .attr('y', k === 0 ? nameY : null)
        .attr('dy', k === 0 ? '0.33em' : NAME_LINE_PX)
        .text(l)
    );

    if (row.values.length >= 2) {
      item
        .append('line')
        .attr('class', 'dot-connector')
        .attr('x1', val(Math.min(...row.values)))
        .attr('x2', val(Math.max(...row.values)))
        .attr('y1', cy)
        .attr('y2', cy)
        .attr('stroke', dotConnectorColor(row, parsed, palette, greyConnector))
        .attr('stroke-width', CONNECTOR_W)
        .attr('stroke-linecap', 'round');
    }

    row.values.forEach((v, s) => {
      item
        .append('circle')
        .attr('class', 'dot-dot')
        .attr('data-series', s)
        .attr('cx', val(v))
        .attr('cy', cy)
        .attr('r', DOT_R)
        .attr('fill', dotSeriesColor(parsed, s, palette))
        .attr('stroke', bg)
        .attr('stroke-width', RING_W);
    });

    if (parsed.gap) {
      item
        .append('text')
        .attr('class', 'dot-gap')
        .attr('x', plotRight + DOT_R + VALUE_GAP)
        .attr('y', cy)
        .attr('dy', '0.33em')
        .attr('font-size', VALUE_FONT)
        .attr('fill', palette.textMuted)
        .text(gapTexts[i]!);
    }
  });

  // ── Series names above the first row, in the series colour ──
  if (named) {
    const first = rows[0]!;
    const labels = parsed.series.map((s) => s.name);
    const widths = labels.map((l) =>
      measureText(l, VALUE_FONT, { bold: true })
    );
    const xs = spreadLabels(
      first.values.map((v) => val(v)),
      widths,
      PAD,
      width - PAD
    );
    const y = cat('0')! + band / 2 - DOT_R - VALUE_GAP;
    const legend = g.append('g').attr('class', 'dot-series-labels');
    labels.forEach((label, s) =>
      legend
        .append('text')
        .attr('class', 'dot-series-label')
        .attr('data-line-number', parsed.series[s]!.lineNumber)
        .attr('x', xs[s]!)
        .attr('y', y)
        .attr('text-anchor', 'middle')
        .attr('font-size', VALUE_FONT)
        .attr('font-weight', 600)
        .attr('fill', dotSeriesColor(parsed, s, palette))
        .text(label)
    );
  }

  if (reserve)
    applyChartFrame(svg, reserve, width, canvasHeight, palette, parsed.frame);
  // The title's edge (#1838), frame lines or not.
  placeFrameTitle(svg.node(), parsed.frame);
}
