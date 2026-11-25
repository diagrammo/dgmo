// ============================================================
// Waterfall renderer — floating steps between totals (#1850)
// ============================================================
//
// Each step floats from the running total before it to the one after it; a
// total runs from 0. Rises take green and falls red (`direction down` swaps
// them, for a cost bridge), totals grey; a colour word on a row wins. Dashed
// connectors carry the running total from each bar's end to the next bar's
// start (`no-connectors` drops them). Steps print their signed change in their
// colour, totals their level in bold (`no-value` drops them). Vertical by
// default; `orientation-horizontal` runs the steps down the left.

import { scaleBand } from 'd3-scale';
import { resolveColor } from '../colors';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix, shapeFill, themeBaseBg } from '../palettes/color-utils';
import {
  applyChartFrame,
  placeFrameTitle,
  reserveChartFrame,
} from '../utils/chart-frame';
import { initD3Chart, renderChartTitle } from '../utils/d3-helpers';
import type { D3ExportDimensions } from '../utils/d3-types';
import { fitLabel } from '../utils/fit-label';
import {
  isWordUnit,
  makeNumberFormatter,
  titleWithUnit,
} from '../utils/number-format';
import { measureText } from '../utils/text-measure';
import { FRAME_BODY_TOP } from '../utils/title-constants';
import { buildValueAxis } from '../charts-d3/value-axis';
import { fmtNum, TICK_FONT, VALUE_FONT } from '../charts-d3/shared';
import type { ParsedWaterfall, WaterfallRow } from './types';

const PAD = 20;
const TICK_GAP = 8;
const VALUE_GAP = 6;
const NAME_GAP = 14;
const AXIS_TITLE_H = TICK_FONT + 6;
const NAME_LINE_PX = Math.round(TICK_FONT * 1.2);
const NAME_MAX_LINES = 2;
/** Most of the width the step names may take beside horizontal bars. */
const NAME_COLUMN_SHARE = 0.35;
const CONNECTOR_DASH = '3 3';
const MINUS = '−';

/** The hue each bar takes: the row's own colour word, else its role. */
export function waterfallHue(
  row: WaterfallRow,
  parsed: Pick<ParsedWaterfall, 'directionDown'>,
  palette: PaletteColors
): string {
  if (row.color) {
    const own = resolveColor(row.color, palette);
    if (own) return own;
  }
  if (row.kind === 'total') return palette.colors.gray;
  const good = (row.kind === 'rise') !== parsed.directionDown;
  return good ? palette.colors.green : palette.colors.red;
}

/** The text a bar prints: `+340` / `−180` on a step, the level on a total. */
export function waterfallValueText(
  row: WaterfallRow,
  fmt: (n: number) => string
): string {
  const abs = fmt(Math.abs(row.value));
  if (row.kind === 'total') return row.value < 0 ? `${MINUS}${abs}` : abs;
  return row.value < 0 ? `${MINUS}${abs}` : `+${abs}`;
}

export function renderWaterfall(
  container: HTMLDivElement,
  parsed: ParsedWaterfall,
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
  const zeroColor = mix(palette.textMuted, bg, 55);
  const connectorColor = palette.textMuted;
  const horizontal = parsed.horizontal;

  const levels = rows.flatMap((r) => [r.from, r.to]);
  const lo = Math.min(0, ...levels);
  const hi0 = Math.max(0, ...levels);
  const hi = hi0 === 0 && lo === 0 ? 1 : hi0;
  const valueAxis = (range: [number, number]) =>
    buildValueAxis(lo, hi, undefined, range, { nice: true });
  const ticks = valueAxis([0, 1]).ticks(6);
  // A word unit is stated once, on the value-axis title (#2295, #2088).
  const unit = parsed.numberFormat?.unit;
  const axisTitle =
    unit && isWordUnit(unit) ? titleWithUnit(undefined, unit, true) : undefined;
  const bareUnit = (nf: typeof parsed.numberFormat) => {
    const bare = { ...nf };
    delete bare.unit;
    return bare;
  };
  const fmt = makeNumberFormatter(
    axisTitle ? bareUnit(parsed.numberFormat) : parsed.numberFormat,
    fmtNum,
    [...ticks, ...rows.map((r) => Math.abs(r.value))]
  );
  const titleH = axisTitle ? AXIS_TITLE_H : 0;
  const tickText = (t: number) =>
    t < 0 ? `${MINUS}${fmt(Math.abs(t))}` : fmt(t);
  const valueTexts = rows.map((r) => waterfallValueText(r, fmt));
  const valueW = parsed.values
    ? Math.max(
        ...valueTexts.map((t) => measureText(t, VALUE_FONT, { bold: true }))
      )
    : 0;

  const top = (title ? FRAME_BODY_TOP : PAD) + titleExtra;
  const g = svg.append('g').attr('class', 'waterfall-body');
  const clickable = (lineNumber: number) =>
    onClickItem ? () => onClickItem(lineNumber) : null;

  // ── Layout ─────────────────────────────────────────────────
  let cat: ReturnType<typeof scaleBand<string>>;
  let val: ReturnType<typeof valueAxis>;
  let plot: { left: number; top: number; right: number; bottom: number };
  const keys = rows.map((_, i) => String(i));
  let names: string[][];

  if (!horizontal) {
    const tickW = Math.max(
      ...ticks.map((t) => measureText(tickText(t), TICK_FONT))
    );
    const left = PAD + titleH + tickW + TICK_GAP;
    const right = width - PAD;
    const step = (right - left) / Math.max(1, rows.length);
    names = rows.map(
      (r) => fitLabel(r.label, TICK_FONT, step * 0.95, NAME_MAX_LINES).lines
    );
    const nameLines = Math.max(1, ...names.map((n) => n.length));
    const bottom = height - PAD - NAME_GAP - (nameLines - 1) * NAME_LINE_PX;
    // Room over the tallest bar (and under the lowest) for its value label.
    const plotTop = top + (parsed.values ? VALUE_FONT + VALUE_GAP : 4);
    const plotBottom =
      bottom - (parsed.values && lo < 0 ? VALUE_FONT + VALUE_GAP : 0);
    plot = { left, top: plotTop, right, bottom: plotBottom };
    cat = scaleBand<string>().domain(keys).range([left, right]).padding(0.3);
    val = valueAxis([plotBottom, plotTop]);
  } else {
    names = rows.map(
      (r) =>
        fitLabel(r.label, TICK_FONT, width * NAME_COLUMN_SHARE, NAME_MAX_LINES)
          .lines
    );
    const nameW = Math.max(
      ...names.flat().map((l) => measureText(l, TICK_FONT))
    );
    const left = PAD + nameW + TICK_GAP;
    // Value labels stand past each bar's end, so the axis stops short of them.
    const right = width - PAD - (parsed.values ? valueW + VALUE_GAP : 0);
    const leftReserve = parsed.values && lo < 0 ? valueW + VALUE_GAP : 0;
    const bottom = height - PAD - NAME_GAP - titleH;
    plot = { left: left + leftReserve, top, right, bottom };
    cat = scaleBand<string>().domain(keys).range([top, bottom]).padding(0.3);
    val = valueAxis([left + leftReserve, right]);
  }

  // ── Gridlines and ticks ────────────────────────────────────
  const grid = g.append('g').attr('class', 'waterfall-grid');
  for (const t of ticks) {
    const p = val(t);
    const line = grid
      .append('line')
      .attr('stroke', t === 0 ? zeroColor : gridColor)
      .attr('stroke-width', 1);
    const label = grid
      .append('text')
      .attr('class', 'waterfall-tick')
      .attr('font-size', TICK_FONT)
      .attr('fill', palette.textMuted)
      .text(tickText(t));
    if (!horizontal) {
      line
        .attr('x1', plot.left)
        .attr('x2', plot.right)
        .attr('y1', p)
        .attr('y2', p);
      label
        .attr('x', plot.left - TICK_GAP)
        .attr('y', p)
        .attr('dy', '0.33em')
        .attr('text-anchor', 'end');
    } else {
      line
        .attr('x1', p)
        .attr('x2', p)
        .attr('y1', plot.top)
        .attr('y2', plot.bottom);
      label
        .attr('x', p)
        .attr('y', plot.bottom + NAME_GAP)
        .attr('text-anchor', 'middle');
    }
  }

  if (axisTitle) {
    const t = g
      .append('text')
      .attr('class', 'waterfall-axis-title')
      .attr('font-size', TICK_FONT)
      .attr('fill', palette.textMuted)
      .attr('text-anchor', 'middle')
      .text(axisTitle);
    if (!horizontal) {
      const cy = (plot.top + plot.bottom) / 2;
      const x = PAD + TICK_FONT / 2;
      t.attr('transform', `rotate(-90 ${x} ${cy})`).attr('x', x).attr('y', cy);
    } else {
      t.attr('x', (plot.left + plot.right) / 2).attr('y', height - PAD);
    }
  }

  // ── Bars, connectors, values and names ─────────────────────
  const bars = g.append('g').attr('class', 'waterfall-bars');
  const band = cat.bandwidth();
  rows.forEach((row, i) => {
    const hue = waterfallHue(row, parsed, palette);
    const lowEnd = Math.min(row.from, row.to);
    const highEnd = Math.max(row.from, row.to);
    const pos0 = cat(String(i))!;
    const item = bars
      .append('g')
      .attr('class', `waterfall-row waterfall-${row.kind}`)
      .attr('data-line-number', row.lineNumber);
    const click = clickable(row.lineNumber);
    if (click) item.style('cursor', 'pointer').on('click', click);

    const rect = item
      .append('rect')
      .attr('class', 'waterfall-bar')
      .attr('fill', shapeFill(palette, hue, isDark))
      .attr('stroke', hue)
      .attr('stroke-width', 1.5);
    if (!horizontal) {
      const y = val(highEnd);
      rect
        .attr('x', pos0)
        .attr('y', y)
        .attr('width', band)
        .attr('height', Math.max(1, val(lowEnd) - y));
    } else {
      const x = val(lowEnd);
      rect
        .attr('x', x)
        .attr('y', pos0)
        .attr('width', Math.max(1, val(highEnd) - x))
        .attr('height', band);
    }

    // The dashed connector at the running total, to the next bar's start.
    const next = rows[i + 1];
    if (parsed.connectors && next) {
      const at = val(row.to);
      const nextPos = cat(String(i + 1))!;
      const c = bars
        .append('line')
        .attr('class', 'waterfall-connector')
        .attr('stroke', connectorColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', CONNECTOR_DASH);
      if (!horizontal)
        c.attr('x1', pos0 + band)
          .attr('x2', nextPos)
          .attr('y1', at)
          .attr('y2', at);
      else
        c.attr('x1', at)
          .attr('x2', at)
          .attr('y1', pos0 + band)
          .attr('y2', nextPos);
    }

    if (parsed.values) {
      // Beyond the bar's far end from 0: above (or right of) a bar that
      // reaches above zero, below (or left of) one wholly under it.
      const under = highEnd <= 0 && lowEnd < 0;
      const text = item
        .append('text')
        .attr('class', 'waterfall-value')
        .attr('font-size', VALUE_FONT)
        .attr('font-weight', row.kind === 'total' ? 'bold' : 500)
        .attr('fill', row.kind === 'total' && !row.color ? palette.text : hue)
        .text(valueTexts[i]!);
      if (!horizontal) {
        text
          .attr('x', pos0 + band / 2)
          .attr('text-anchor', 'middle')
          .attr(
            'y',
            under
              ? val(lowEnd) + VALUE_GAP + VALUE_FONT * 0.8
              : val(highEnd) - VALUE_GAP
          );
      } else {
        text
          .attr('y', pos0 + band / 2)
          .attr('dy', '0.33em')
          .attr('text-anchor', under ? 'end' : 'start')
          .attr(
            'x',
            under ? val(lowEnd) - VALUE_GAP : val(highEnd) + VALUE_GAP
          );
      }
    }

    const name = item
      .append('text')
      .attr('class', 'waterfall-label')
      .attr('font-size', TICK_FONT)
      .attr('fill', palette.text)
      .attr('font-weight', row.kind === 'total' ? 600 : 400);
    const lines = names[i]!;
    if (!horizontal) {
      const cx = pos0 + band / 2;
      const baseY =
        (lo < 0 && parsed.values
          ? plot.bottom + VALUE_FONT + VALUE_GAP
          : plot.bottom) + NAME_GAP;
      name.attr('text-anchor', 'middle').attr('x', cx).attr('y', baseY);
      lines.forEach((l, k) =>
        name
          .append('tspan')
          .attr('x', cx)
          .attr('dy', k === 0 ? 0 : NAME_LINE_PX)
          .text(l)
      );
    } else {
      const x =
        plot.left -
        (lo < 0 && parsed.values ? valueW + VALUE_GAP : 0) -
        TICK_GAP;
      const cy = pos0 + band / 2 - ((lines.length - 1) * NAME_LINE_PX) / 2;
      name
        .attr('text-anchor', 'end')
        .attr('x', x)
        .attr('y', cy)
        .attr('dy', '0.33em');
      lines.forEach((l, k) =>
        name
          .append('tspan')
          .attr('x', x)
          .attr('dy', k === 0 ? '0.33em' : NAME_LINE_PX)
          .text(l)
      );
    }
  });

  if (reserve)
    applyChartFrame(svg, reserve, width, canvasHeight, palette, parsed.frame);
  // The title's edge (#1838), frame lines or not.
  placeFrameTitle(svg.node(), parsed.frame);
}
