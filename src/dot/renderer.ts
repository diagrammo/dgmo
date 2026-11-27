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
// so there is no legend. A long one wraps to two lines, then ends in `…`,
// within an even share of the plot's width, so the names always fit side by
// side; the strip above the first row is as tall as the tallest (#2433). `gap` prints last − first at each row's right end.
//
// Labels never collide (#2432). A row name takes two lines only when the row
// is two lines tall, else one; rows thinner than a line thin the names. The
// gaps print only when every row is a line tall, else they join the hover.
// Hovering a row — a dot, its connector, its name or (in the live preview)
// its band — bolds its name, prints its values and recedes every other row.

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
import {
  isWordUnit,
  makeNumberFormatter,
  titleWithUnit,
} from '../utils/number-format';
import { measureText } from '../utils/text-measure';
import { FRAME_BODY_TOP } from '../utils/title-constants';
import { buildValueAxis } from '../charts-d3/value-axis';
import {
  fmtNum,
  spreadIndices,
  TICK_FONT,
  VALUE_FONT,
} from '../charts-d3/shared';
import { EMPHASIS_DIM_OPACITY } from '../utils/emphasis';
import { FULL_TEXT_ATTR } from '../utils/full-text';
import { dotGap } from './parser';
import type { DotRow, ParsedDot } from './types';

const PAD = 20;
const TICK_GAP = 8;
const NAME_GAP = 14;
const AXIS_TITLE_H = TICK_FONT + 6;
const VALUE_GAP = 6;
const DOT_R = 5.5;
const RING_W = 1.5;
const CONNECTOR_W = 2.5;
/** Room between two series names above the first row. */
const SERIES_LABEL_GAP = 6;
const NAME_LINE_PX = Math.round(TICK_FONT * 1.2);
const SERIES_LINE_PX = Math.round(VALUE_FONT * 1.2);
const SERIES_MAX_LINES = 2;
const NAME_MAX_LINES = 2;
/** Most of the width the row names may take. */
const NAME_COLUMN_SHARE = 0.35;
const MINUS = '−';
/** Room between a value printed on hover and its dot. */
const HOVER_VALUE_GAP = 3;
/** The smallest dot a crowded row shrinks to. */
const MIN_DOT_R = 2;
/** The halo behind text printed on hover, over the receded rows. */
const HALO_W = 3;
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
    [...ticks, ...all, ...gaps.map(Math.abs)]
  );
  const tickText = (t: number) =>
    t < 0 ? `${MINUS}${fmt(Math.abs(t))}` : fmt(t);
  const gapTexts = parsed.gap ? gaps.map((g) => dotGapText(g, fmt)) : [];
  const gapW = parsed.gap
    ? Math.max(...gapTexts.map((t) => measureText(t, VALUE_FONT)))
    : 0;

  // ── Layout ─────────────────────────────────────────────────
  const top = (title ? FRAME_BODY_TOP : PAD) + titleExtra;
  // Series names never collide (#2433): each fits an even share of the room
  // right of the widest possible name column, so side by side they always
  // fit there, whatever the data.
  const seriesBudget = Math.max(
    1,
    (width * (1 - NAME_COLUMN_SHARE) -
      2 * PAD -
      TICK_GAP -
      parsed.series.length * SERIES_LABEL_GAP) /
      Math.max(1, parsed.series.length)
  );
  const seriesFit = parsed.series.map((s) =>
    fitLabel(s.name, VALUE_FONT, seriesBudget, SERIES_MAX_LINES, {
      bold: true,
    })
  );
  const seriesLines = Math.max(1, ...seriesFit.map((f) => f.lines.length));
  // The series names stand above the first row's dots, in a strip as tall
  // as the tallest of them.
  const plotTop =
    top +
    (named ? VALUE_FONT + (seriesLines - 1) * SERIES_LINE_PX + VALUE_GAP : 0);
  const plotBottom = height - PAD - NAME_GAP - (axisTitle ? AXIS_TITLE_H : 0);
  const cat = scaleBand<string>()
    .domain(rows.map((_, i) => String(i)))
    .range([plotTop, plotBottom])
    .padding(0.2);
  // Names never collide (#2432): a name wraps only into the lines its row
  // is tall; rows thinner than one line draw every k-th name, ends kept.
  const step = cat.step();
  const nameLines = Math.max(
    1,
    Math.min(NAME_MAX_LINES, Math.floor(step / NAME_LINE_PX))
  );
  const fitted = rows.map((r) =>
    fitLabel(r.label, TICK_FONT, width * NAME_COLUMN_SHARE, nameLines)
  );
  const names = fitted.map((f) => f.lines);
  const nameKeep =
    step >= NAME_LINE_PX
      ? null
      : spreadIndices(
          rows.length,
          Math.floor((rows.length - 1) / Math.ceil(NAME_LINE_PX / step)) + 1
        );
  // The gaps share one column, so they need a line per row.
  const showGap = parsed.gap && step >= NAME_LINE_PX;
  const nameW = Math.max(...names.flat().map((l) => measureText(l, TICK_FONT)));
  const plotLeft = PAD + nameW + TICK_GAP + DOT_R;
  const plotRight =
    width - PAD - DOT_R - (parsed.gap ? gapW + VALUE_GAP + DOT_R : 0);
  // A dot never reaches into the next row.
  const dotR = Math.min(DOT_R, Math.max(MIN_DOT_R, step / 2 - RING_W));
  // The live preview gives each row band a hit area; an export has no
  // pointer, so it draws none and stays as it was.
  const interactive = !exportDims;
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
      // From the body's top edge, through the series names' strip.
      .attr('y1', top)
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

  if (axisTitle)
    g.append('text')
      .attr('class', 'dot-axis-title')
      .attr('x', (plotLeft + plotRight) / 2)
      .attr('y', height - PAD)
      .attr('text-anchor', 'middle')
      .attr('font-size', TICK_FONT)
      .attr('fill', palette.textMuted)
      .text(axisTitle);

  // ── Rows: name, connector, dots, gap ───────────────────────
  const body = g.append('g').attr('class', 'dot-rows');
  const band = cat.bandwidth();
  const nameX = plotLeft - DOT_R - TICK_GAP;
  /** Draw row `i`'s name into `parent`, its fitted lines centred on `cy`. */
  const drawName = (
    parent: typeof body,
    i: number,
    cy: number,
    lines: readonly string[]
  ) => {
    const name = parent
      .append('text')
      .attr('class', 'dot-label')
      .attr('text-anchor', 'end')
      .attr('font-size', TICK_FONT)
      .attr('fill', palette.text);
    if (fitted[i]!.truncated) name.attr(FULL_TEXT_ATTR, rows[i]!.label);
    const nameY = cy - ((lines.length - 1) * NAME_LINE_PX) / 2;
    lines.forEach((l, k) =>
      name
        .append('tspan')
        .attr('x', nameX)
        .attr('y', k === 0 ? nameY : null)
        .attr('dy', k === 0 ? '0.33em' : NAME_LINE_PX)
        .text(l)
    );
    return name;
  };
  const halo = (t: ReturnType<typeof drawName>) =>
    t
      .attr('stroke', bg)
      .attr('stroke-width', HALO_W)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke');

  /** Hover: row `i` comes forward with its name bold and its values. */
  let active: number | null = null;
  let restore: [SVGGElement, ChildNode | null] | null = null;
  const items: (typeof body)[] = [];
  const enter = (i: number, cy: number) => {
    if (active === i) return;
    leave();
    active = i;
    const row = rows[i]!;
    const item = items[i]!;
    items.forEach((other, k) => {
      if (k !== i) other.style('opacity', String(EMPHASIS_DIM_OPACITY));
    });
    // Drawn last while hovered, so it sits over its neighbours; put back on
    // leave, so the rows keep their reading order.
    const node = item.node()!;
    restore = [node, node.nextSibling];
    item.raise();
    const hover = item
      .append('g')
      .attr('class', 'dot-hover')
      .style('pointer-events', 'none');
    const shown = item.select<SVGTextElement>('text.dot-label');
    if (shown.empty())
      halo(drawName(hover, i, cy, [names[i]![0]!])).attr('font-weight', 600);
    else shown.attr('font-weight', 600);
    // Each value above its dot, spread so no two overlap.
    const labels = row.values.map((v) => tickText(v));
    const widths = labels.map((l) =>
      measureText(l, VALUE_FONT, { bold: true })
    );
    const xs = spreadLabels(
      row.values.map((v) => val(v)),
      widths,
      plotLeft - dotR,
      width - PAD
    );
    labels.forEach((l, s) =>
      halo(
        hover
          .append('text')
          .attr('class', 'dot-hover-value')
          .attr('x', xs[s]!)
          .attr('y', cy - dotR - HOVER_VALUE_GAP)
          .attr('text-anchor', 'middle')
          .attr('font-size', VALUE_FONT)
          .attr('font-weight', 600)
          .attr('fill', dotSeriesColor(parsed, s, palette))
          .text(l)
      )
    );
    if (parsed.gap && !showGap)
      halo(
        hover
          .append('text')
          .attr('class', 'dot-gap')
          .attr('x', plotRight + DOT_R + VALUE_GAP)
          .attr('y', cy)
          .attr('dy', '0.33em')
          .attr('font-size', VALUE_FONT)
          .attr('fill', palette.textMuted)
          .text(gapTexts[i]!)
      );
  };
  function leave() {
    if (active === null) return;
    const item = items[active]!;
    item.select('g.dot-hover').remove();
    item.select('text.dot-label').attr('font-weight', null);
    items.forEach((other) => other.style('opacity', null));
    if (restore) restore[0].parentNode?.insertBefore(restore[0], restore[1]);
    restore = null;
    active = null;
  }

  rows.forEach((row, i) => {
    const cy = cat(String(i))! + band / 2;
    const item = body
      .append('g')
      .attr('class', 'dot-row')
      .attr('data-line-number', row.lineNumber)
      .on('mouseover', () => enter(i, cy))
      .on('mouseleave', leave);
    items.push(item);
    if (onClickItem)
      item
        .style('cursor', 'pointer')
        .on('click', () => onClickItem(row.lineNumber));

    if (interactive)
      item
        .append('rect')
        .attr('class', 'dot-row-hit')
        .attr('x', PAD)
        .attr('y', cy - step / 2)
        .attr('width', width - 2 * PAD)
        .attr('height', step)
        .attr('fill', 'transparent');

    if (!nameKeep || nameKeep.has(i)) drawName(item, i, cy, names[i]!);

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
        .attr('r', dotR)
        .attr('fill', dotSeriesColor(parsed, s, palette))
        .attr('stroke', bg)
        .attr('stroke-width', RING_W);
    });

    if (showGap) {
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
    const widths = seriesFit.map((f) =>
      Math.max(
        ...f.lines.map((l) => measureText(l, VALUE_FONT, { bold: true }))
      )
    );
    const dotXs = first.values.map((v) => val(v));
    let xs = spreadLabels(dotXs, widths, PAD, width - PAD);
    // The baseline of each name's last line; earlier lines stand above it.
    const cy0 = cat('0')! + band / 2;
    const y = cy0 - dotR - VALUE_GAP;
    // A name reaching over the first row's name moves right of the name
    // column, where an even share always leaves it room.
    const firstName = names[0]!;
    const nameTop =
      cy0 -
      ((firstName.length - 1) * NAME_LINE_PX) / 2 +
      0.33 * TICK_FONT -
      0.75 * TICK_FONT;
    const nameLeft =
      nameX - Math.max(...firstName.map((l) => measureText(l, TICK_FONT)));
    const overName = xs.some(
      (x, s) =>
        x - widths[s]! / 2 < nameX &&
        x + widths[s]! / 2 > nameLeft &&
        y + 0.2 * VALUE_FONT > nameTop
    );
    if (overName)
      xs = spreadLabels(dotXs, widths, nameX + SERIES_LABEL_GAP, width - PAD);
    const legend = g.append('g').attr('class', 'dot-series-labels');
    seriesFit.forEach((fit, s) => {
      const text = legend
        .append('text')
        .attr('class', 'dot-series-label')
        .attr('data-line-number', parsed.series[s]!.lineNumber)
        .attr('x', xs[s]!)
        .attr('y', y)
        .attr('text-anchor', 'middle')
        .attr('font-size', VALUE_FONT)
        .attr('font-weight', 600)
        .attr('fill', dotSeriesColor(parsed, s, palette));
      // A cut name keeps its full text, never in an <svg><title>.
      if (fit.truncated) text.attr(FULL_TEXT_ATTR, parsed.series[s]!.name);
      if (fit.lines.length === 1) {
        text.text(fit.lines[0]!);
        return;
      }
      text.attr('y', null);
      fit.lines.forEach((l, k) =>
        text
          .append('tspan')
          .attr('x', xs[s]!)
          .attr('y', y - (fit.lines.length - 1 - k) * SERIES_LINE_PX)
          .text(l)
      );
    });
  }

  if (reserve)
    applyChartFrame(svg, reserve, width, canvasHeight, palette, parsed.frame);
  // The title's edge (#1838), frame lines or not.
  placeFrameTitle(svg.node(), parsed.frame);
}
