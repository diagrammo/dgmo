// ============================================================
// Slope renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import { growChartFrame } from '../utils/chart-frame';
import { GRID_DASH, scaleDash } from '../utils/visual-conventions';
import * as d3Scale from 'd3-scale';
import { buildValueAxis } from '../charts-d3/value-axis';
import { makeNumberFormatter } from '../utils/number-format';
import { measureTabular, tabularText } from '../utils/tabular-figures';
import * as d3Shape from 'd3-shape';
import * as d3Array from 'd3-array';
import { wrapTextToWidth } from '../utils/text-measure';
import type { D3ExportDimensions } from '../utils/d3-types';
import { ScaleContext } from '../utils/scaling';
import { initD3Chart, renderChartTitle } from '../utils/d3-helpers';
import type { ParsedSlope } from '../visualizations/types';
import { FRAME_BODY_TOP } from '../utils/title-constants';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  resolveEmphasis,
  storyPaint,
} from '../utils/emphasis';
import type { PaletteColors } from '../palettes';
import { contrastText } from '../palettes/color-utils';
import type { Svg } from '../charts-d3/shared';
import { annotationValues } from '../annotations/parse';
import {
  drawBands,
  drawMarkers,
  settleBandLabels,
  type ValueAxisFrame,
} from '../annotations/draw';
import { drawChartNotes, sampleLines } from '../annotations/notes';
import type { LabelRect } from '../label-layout';

// ============================================================
// Slope Chart Renderer
// ============================================================

/**
 * Resolves vertical label collisions by nudging overlapping items apart.
 * Takes items with a naturalY (center) and height, returns adjusted center Y positions.
 * Optional maxY clamps the bottom edge so labels don't overflow the chart area.
 */
export function resolveVerticalCollisions(
  items: { naturalY: number; height: number }[],
  minGap: number,
  maxY?: number
): number[] {
  if (items.length === 0) return [];
  const sorted = items
    .map((it, i) => ({ ...it, idx: i }))
    .sort((a, b) => a.naturalY - b.naturalY);
  const adjustedY = new Array<number>(items.length);
  // Pass 1: push down from the top so every gap is at least minGap.
  const tops: number[] = [];
  let prevBottom = -Infinity;
  for (const item of sorted) {
    const top = Math.max(item.naturalY - item.height / 2, prevBottom + minGap);
    tops.push(top);
    prevBottom = top + item.height;
  }
  // Pass 2: if the stack passes maxY, pull it up from the bottom, keeping
  // minGap, so the clamp can never put a label back on the one above it.
  if (maxY !== undefined) {
    let limit = maxY;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const h = sorted[i]!.height;
      tops[i] = Math.min(tops[i]!, limit - h);
      limit = tops[i]! - minGap;
    }
  }
  sorted.forEach((item, i) => {
    adjustedY[item.idx] = tops[i]! + item.height / 2;
  });
  return adjustedY;
}

/**
 * Which side of its point a middle-period value sits on (#1946). The value is
 * offset `gap` above or below the point; each adjacent segment is checked at
 * the label's half-width toward its neighbour, where it climbs furthest into
 * the label box. The side the segments intrude on least wins; above on a tie.
 */
export function middleValueSide(
  point: { x: number; y: number },
  neighbours: { x: number; y: number }[],
  halfWidth: number,
  gap: number
): 'above' | 'below' {
  let above = 0;
  let below = 0;
  for (const n of neighbours) {
    const dx = Math.abs(n.x - point.x);
    if (dx === 0) continue;
    const yAtEdge = point.y + ((n.y - point.y) * Math.min(halfWidth, dx)) / dx;
    above = Math.max(above, point.y - gap - yAtEdge);
    below = Math.max(below, yAtEdge - (point.y + gap));
  }
  return below < above ? 'below' : 'above';
}

/**
 * Where each point of a `rank` slope sits sideways on its row (#1854). Items
 * sharing a position in one period stand side by side, centred on the period:
 * the offset is in units of one dot step (0 for a lone item).
 */
export function rankTieOffsets(values: number[]): number[] {
  const seen = new Map<number, number[]>();
  values.forEach((v, s) => {
    const list = seen.get(v);
    if (list) list.push(s);
    else seen.set(v, [s]);
  });
  const out = new Array<number>(values.length).fill(0);
  for (const list of seen.values()) {
    list.forEach((s, j) => {
      out[s] = j - (list.length - 1) / 2;
    });
  }
  return out;
}

const SLOPE_MARGIN = { top: 80, bottom: 40, left: 80 };
const SLOPE_LABEL_FONT_SIZE = 14;

/**
 * Renders a slope chart into the given container using D3.
 */
export function renderSlopeChart(
  container: HTMLDivElement,
  parsed: ParsedSlope,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { periods, data } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (data.length === 0 || periods.length < 2) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;

  const idealWidth = SLOPE_MARGIN.left + periods.length * 100 + 150;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sMarginTop = ctx.aesthetic(SLOPE_MARGIN.top);
  const sMarginBottom = ctx.aesthetic(SLOPE_MARGIN.bottom);
  let sLabelFontSize = ctx.text(SLOPE_LABEL_FONT_SIZE);
  const sPeriodFont = ctx.text(18);
  const sValueFont = ctx.text(16);
  const sPeriodHeaderY = ctx.structural(15);
  const sDash = scaleDash(GRID_DASH, (n) => ctx.structural(n));
  const sLineStroke = ctx.structural(2.5);
  const sHitWidth = ctx.structural(14);
  const sPointR = ctx.structural(4);
  const sPointStroke = ctx.structural(1.5);
  const sLabelGap = ctx.structural(10);

  svg.attr('preserveAspectRatio', 'xMidYMin meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const g = svg.append('g');

  // Title — drawn before the layout so a wrapped title's extra line, drawn
  // at full size, pushes the plot down (#1718).
  const titleExtra = renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem,
    2
  );
  // The period headers rise above the plot; the band starts at the headers.
  const sPlotTop =
    (title ? FRAME_BODY_TOP + sPeriodHeaderY + sPeriodFont : sMarginTop) +
    titleExtra;

  // Compute right margin from the longest end-of-line label
  // The author's `format` / `unit` / `locale` (#1831); plain values otherwise.
  // Under `format compact` every value prints in one unit (#2036).
  const fmt = makeNumberFormatter(
    parsed.numberFormat,
    String,
    data.flatMap((d) => d.values)
  );
  const rankMode = parsed.rank === true;
  const maxLabelText = data.reduce((longest, item) => {
    const text = rankMode
      ? item.label
      : `${fmt(item.values[item.values.length - 1]!)} — ${item.label}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const estimatedLabelWidth = measureTabular(maxLabelText, sLabelFontSize);
  const maxRightMargin = Math.floor(width * 0.35);
  const rightMargin = Math.min(
    Math.max(estimatedLabelWidth + ctx.aesthetic(30), ctx.aesthetic(120)),
    maxRightMargin
  );

  // Left margin holds the first column's "name — value" labels
  const maxLeftText = data.reduce((longest, item) => {
    const text = rankMode
      ? item.label
      : `${item.label} — ${fmt(item.values[0]!)}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const sLeftGap = ctx.structural(10);
  const sMarginLeft = Math.min(
    Math.max(
      measureTabular(maxLeftText, sLabelFontSize) +
        sLeftGap +
        ctx.aesthetic(15),
      ctx.aesthetic(SLOPE_MARGIN.left)
    ),
    Math.floor(width * 0.35)
  );
  const leftAvailableWidth = sMarginLeft - sLeftGap - ctx.aesthetic(10);

  const innerWidth = width - sMarginLeft - rightMargin;
  const innerHeight = height - sPlotTop - sMarginBottom;

  // A stack of end labels taller than the plot would overlap however it is
  // packed (#2132): step the label font down (7px floor) until it fits.
  const LABEL_GAP = 4;
  const MIN_LABEL_FONT = 7;
  while (
    sLabelFontSize > MIN_LABEL_FONT &&
    data.length * sLabelFontSize * 1.4 + (data.length - 1) * LABEL_GAP >
      innerHeight
  ) {
    sLabelFontSize = Math.max(MIN_LABEL_FONT, sLabelFontSize - 1);
  }

  // Scales
  // A `marker` or `band` (#2039) beyond the data widens the range to it.
  const allValues = [
    ...data.flatMap((d) => d.values),
    ...annotationValues(parsed.annotations),
  ];
  const [minVal, maxVal] = d3Array.extent(allValues) as [number, number];
  const valuePadding = (maxVal - minVal) * 0.1 || 1;

  // `rank` (#1854): one row per position, position 1 at the top, no value
  // axis — the range is the positions, whatever `y-axis` says.
  const rank = rankMode;
  const maxRank = rank ? Math.max(...data.flatMap((d) => d.values)) : 0;
  const yScale = rank
    ? d3Scale
        .scaleLinear()
        .domain([maxRank + 0.5, 0.5])
        .range([innerHeight, 0])
    : // `y-axis 0..100 log` sets the vertical range (decision #60). Slope
      // draws no tick axis, so the range only places the lines.
      buildValueAxis(
        minVal - valuePadding,
        maxVal + valuePadding,
        parsed.axes?.y,
        [innerHeight, 0],
        { dataLo: minVal, dataHi: maxVal }
      );

  const xScale = d3Scale
    .scalePoint<string>()
    .domain(periods)
    .range([0, innerWidth])
    .padding(0);

  g.attr('transform', `translate(${sMarginLeft},${sPlotTop})`);

  // Period column headers
  for (const period of periods) {
    const x = xScale(period)!;
    g.append('text')
      .attr('x', x)
      .attr('y', -sPeriodHeaderY)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', sPeriodFont)
      .attr('font-weight', 'bold')
      .text(period);

    // Vertical guide line
    g.append('line')
      .attr('x1', x)
      .attr('y1', 0)
      .attr('x2', x)
      .attr('y2', innerHeight)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', sDash);
  }

  // Bands and markers (#2039), drawn in the plot's own coordinates.
  const [domainLo, domainHi] = yScale.domain();
  const annotationFrame: ValueAxisFrame = {
    pos: (v) => yScale(v),
    domain: [domainLo!, domainHi!],
    left: 0,
    top: 0,
    width: innerWidth,
    height: innerHeight,
    horizontal: false,
    crossPos: (at) => (typeof at === 'string' ? xScale(at) : undefined),
  };
  const annotationColors = {
    text: textColor,
    muted: palette.textMuted,
    bg: bgColor,
  };
  const plotG = g as unknown as Svg;
  const annotationBoxes = drawBands(
    plotG,
    parsed.annotations,
    annotationFrame,
    annotationColors
  );

  // Rank dots carry their position number, so they are bigger than a point,
  // and never taller than most of a row.
  const rowStep = rank ? innerHeight / maxRank : 0;
  const sRankR = Math.max(
    ctx.structural(5),
    Math.min(ctx.structural(10), rowStep * 0.4)
  );
  const pointR = rank ? sRankR : sPointR;
  // Ties (#1854): items sharing a position in one period sit side by side.
  const tieOffsets = rank
    ? periods.map((_p, i) => rankTieOffsets(data.map((d) => d.values[i]!)))
    : [];
  const tieStep = 2 * sRankR + ctx.structural(4);
  // An end label clears its dot and any tied dot beside it.
  const endClear = (i: number): number =>
    rank ? sRankR + Math.max(0, ...tieOffsets[i]!.map(Math.abs)) * tieStep : 0;
  const leftClear = endClear(0);
  const rightClear = endClear(periods.length - 1);
  const pointAt = (s: number, i: number): [number, number] => [
    xScale(periods[i]!)! + (rank ? tieOffsets[i]![s]! * tieStep : 0),
    yScale(data[s]!.values[i]!),
  ];

  // Line generator. Under `rank` each segment is a horizontal-tangent S-curve,
  // flat at each period, so a crossing reads as a swap (#1854).
  const lineGen = (s: number): string =>
    (rank ? d3Shape.line().curve(d3Shape.curveBumpX) : d3Shape.line())(
      periods.map((_p, i) => pointAt(s, i))
    ) ?? '';

  // Pre-compute per-series data for label collision resolution
  const seriesInfo = data.map((item, idx) => {
    // colors is non-empty; modulo guarantees in-bounds.
    const color = item.color ?? colors[idx % colors.length]!;
    // values is non-empty by parser validation (slope requires P>=2 values per series).
    const firstVal = item.values[0]!;
    const lastVal = item.values[item.values.length - 1]!;

    // Compute right-side label text and wrapping info
    // periods is non-empty (slope requires P >= 2 periods).
    const lastX = xScale(periods[periods.length - 1]!)!;
    // Under `rank` the dot carries the position; the ends carry the name.
    const labelText = rank ? item.label : `${fmt(lastVal)} — ${item.label}`;
    const availableWidth = rightMargin - ctx.aesthetic(15);

    let labelLineCount = 1;
    let wrappedLines: string[] | null = null;
    if (measureTabular(labelText, sLabelFontSize) > availableWidth) {
      const lines = wrapTextToWidth(labelText, sLabelFontSize, availableWidth);
      labelLineCount = lines.length;
      wrappedLines = lines;
    }
    const lineHeight = sLabelFontSize * 1.2;
    const labelHeight =
      labelLineCount === 1 ? sLabelFontSize : labelLineCount * lineHeight;

    // Left-side label (first column): "name — value", wraps like the right side
    const leftText = rank ? item.label : `${item.label} — ${fmt(firstVal)}`;
    const leftLines =
      measureTabular(leftText, sLabelFontSize) > leftAvailableWidth
        ? wrapTextToWidth(leftText, sLabelFontSize, leftAvailableWidth)
        : null;
    const leftHeight = leftLines
      ? leftLines.length * lineHeight
      : sLabelFontSize;

    return {
      item,
      idx,
      color,
      firstVal,
      lastVal,
      lastX,
      labelText,
      wrappedLines,
      labelHeight,
      leftText,
      leftLines,
      leftHeight,
    };
  });

  // --- Resolve left-side label collisions per non-last period column ---
  const leftLabelHeight = sValueFont * 1.25;
  // Middle-period values sit beside their point, never on it, so neither the
  // series' own line nor its marker strikes through the digits (#1946).
  const sMiddleGap = sPointR + ctx.structural(4);
  const middleOffsetY = (item: (typeof data)[number], pi: number): number => {
    const pt = (i: number) => ({
      x: xScale(periods[i]!)!,
      y: yScale(item.values[i]!),
    });
    const side = middleValueSide(
      pt(pi),
      [pt(pi - 1), pt(pi + 1)],
      measureTabular(fmt(item.values[pi]!), sValueFont) / 2,
      sMiddleGap
    );
    const shift = sMiddleGap + sValueFont / 2;
    return side === 'above' ? -shift : shift;
  };
  const leftLabelCollisions: Map<number, number[]> = new Map();
  for (let pi = 0; pi < periods.length - 1; pi++) {
    const entries = data.map((item) => ({
      // pi is in-bounds by loop guard against periods.length, and each data row has periods.length values.
      naturalY:
        yScale(item.values[pi]!) + (pi === 0 ? 0 : middleOffsetY(item, pi)),
      height:
        pi === 0
          ? Math.max(
              ...seriesInfo.map((si) => si.leftHeight),
              sLabelFontSize * 1.4
            )
          : leftLabelHeight,
    }));
    leftLabelCollisions.set(
      pi,
      resolveVerticalCollisions(entries, 4, innerHeight)
    );
  }

  // --- Resolve right-side label collisions ---
  const rightEntries = seriesInfo.map((si) => ({
    naturalY: yScale(si.lastVal),
    height: Math.max(si.labelHeight, sLabelFontSize * 1.4),
  }));
  const rightAdjustedY = resolveVerticalCollisions(
    rightEntries,
    4,
    innerHeight
  );

  // §1.11 emphasis (#1829): `highlight` names series. Every other series —
  // its line, points and labels — recedes; a receded series keeps its colour.
  const emphasis = resolveEmphasis(
    parsed.emphasis,
    data.map((d) => d.label)
  );
  const { dimmed } = emphasis;
  // Story view (#2046): the subject keeps its colour, the rest go grey. The
  // grey is baked into the paint, so only `dim` uses opacity.
  const story = storyPaint(emphasis, palette, isDark);
  const shapeOpacity = (dim: boolean) =>
    dim && !story.active ? EMPHASIS_DIM_OPACITY : null;
  const textOpacity = (dim: boolean) =>
    dim && !story.active ? EMPHASIS_DIM_TEXT_OPACITY : null;

  // Render each data series
  // Under story view the grey series are drawn first, so the subject is on top.
  const slopeOrder = data.map((_, i) => i);
  if (story.active)
    slopeOrder.sort(
      (a, b) =>
        Number(dimmed.has(data[b]!.label)) - Number(dimmed.has(data[a]!.label))
    );
  slopeOrder.forEach((idx) => {
    const item = data[idx]!;
    // seriesInfo was built by data.map() above, so idx is in-bounds.
    const si = seriesInfo[idx]!;
    const dim = dimmed.has(item.label);
    const color = !story.active
      ? si.color
      : dim
        ? story.groundStroke
        : story.subject(si.color);
    const textFill = story.active && dim ? story.groundText : color;

    // Wrap each series in a group with data-line-number for sync adapter
    const seriesG = g
      .append('g')
      .attr('class', 'slope-series')
      .attr('data-line-number', String(item.lineNumber))
      // The name a `highlight` line matches — the app's Spotlight reads it.
      .attr('data-series-name', item.label)
      // Hover anywhere on a series — line, dot or either name — and every
      // other series recedes (#2211). The series stays the whole answer: its
      // dots already carry the values, so there is no tooltip.
      .on('mouseenter', () => {
        g.selectAll<SVGGElement, unknown>('g.slope-series').each(function () {
          if (this !== seriesG.node())
            this.style.opacity = String(EMPHASIS_DIM_OPACITY);
        });
      })
      .on('mouseleave', () => {
        g.selectAll<SVGGElement, unknown>('g.slope-series').style(
          'opacity',
          null
        );
      });

    // Line
    seriesG
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', sLineStroke)
      .attr('opacity', shapeOpacity(dim))
      .attr('d', lineGen(idx));

    // Invisible wider path for easier hover targeting
    seriesG
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', sHitWidth)
      .attr('d', lineGen(idx))
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('click', () => {
        if (onClickItem && item.lineNumber) onClickItem(item.lineNumber);
      });

    // Points and value labels
    item.values.forEach((val, i) => {
      // periods[i] is in-bounds because item.values.length === periods.length (slope contract).
      const x = xScale(periods[i]!)!;
      const [px, y] = pointAt(idx, i);

      // Point circle
      seriesG
        .append('circle')
        .attr('cx', px)
        .attr('cy', y)
        .attr('r', pointR)
        .attr('fill', color)
        .attr('stroke', bgColor)
        .attr('stroke-width', sPointStroke)
        .attr('opacity', shapeOpacity(dim))
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('click', () => {
          if (onClickItem && item.lineNumber) onClickItem(item.lineNumber);
        });

      // `rank` (#1854): the dot shows its position number.
      if (rank) {
        const numFont = Math.min(sValueFont * 0.8, sRankR * 1.15);
        seriesG
          .append('text')
          .attr('x', px)
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'middle')
          .attr(
            'fill',
            contrastText(color, palette.textOnFillLight, palette.textOnFillDark)
          )
          .attr('font-size', numFont)
          .attr('font-weight', 'bold')
          .attr('opacity', shapeOpacity(dim))
          .style('pointer-events', 'none')
          .text(String(val));
      }

      // Value label — skip last point (shown in series label instead)
      const isFirst = i === 0;
      const isLast = i === periods.length - 1;
      if (!isLast && (isFirst || !rank)) {
        // leftLabelCollisions was set for every i in [0, periods.length-1); idx is in-bounds by data.map.
        const adjustedY = leftLabelCollisions.get(i)![idx]!;
        if (isFirst) {
          const leftEl = seriesG
            .append('text')
            .attr('x', x - sLeftGap - leftClear)
            .attr('y', adjustedY)
            .attr('text-anchor', 'end')
            .attr('fill', textFill)
            .attr('font-size', sLabelFontSize)
            .attr('opacity', textOpacity(dim));
          if (!si.leftLines) {
            leftEl
              .attr('dy', '0.35em')
              .call(tabularText(si.leftText, sLabelFontSize));
          } else {
            const lh = sLabelFontSize * 1.2;
            const startDy = (-(si.leftLines.length - 1) * lh) / 2;
            si.leftLines.forEach((line, li) => {
              leftEl
                .append('tspan')
                .attr('x', x - sLeftGap - leftClear)
                .attr(
                  'dy',
                  li === 0 ? `${startDy + sLabelFontSize * 0.35}px` : `${lh}px`
                )
                .text(line);
            });
          }
        } else {
          seriesG
            .append('text')
            .attr('x', x)
            .attr('y', adjustedY)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', textFill)
            .attr('font-size', sValueFont)
            .attr('stroke', bgColor)
            .attr('stroke-width', ctx.structural(3))
            .attr('stroke-linejoin', 'round')
            .attr('paint-order', 'stroke')
            .attr('opacity', textOpacity(dim))
            .call(tabularText(fmt(val), sValueFont));
        }
      }
    });

    // Series label with value at end of line — wraps if it exceeds available space
    // rightAdjustedY was produced from rightEntries.length === seriesInfo.length === data.length.
    const adjustedLastY = rightAdjustedY[idx]!;

    const labelEl = seriesG
      .append('text')
      .attr('x', si.lastX + sLabelGap + rightClear)
      .attr('y', adjustedLastY)
      .attr('text-anchor', 'start')
      .attr('fill', textFill)
      .attr('font-size', sLabelFontSize)
      .attr('font-weight', 'normal')
      .attr('opacity', textOpacity(dim));

    if (!si.wrappedLines) {
      labelEl
        .attr('dy', '0.35em')
        .call(tabularText(si.labelText, sLabelFontSize));
    } else {
      const lineHeight = sLabelFontSize * 1.2;
      const totalHeight = (si.wrappedLines.length - 1) * lineHeight;
      const startDy = -totalHeight / 2;

      si.wrappedLines.forEach((line, li) => {
        labelEl
          .append('tspan')
          .attr('x', si.lastX + sLabelGap + rightClear)
          .attr(
            'dy',
            li === 0
              ? `${startDy + sLabelFontSize * 0.35}px`
              : `${lineHeight}px`
          )
          .text(line);
      });
    }
  });

  const markerLines: LabelRect[] = [];
  annotationBoxes.push(
    ...drawMarkers(
      plotG,
      parsed.annotations,
      annotationFrame,
      annotationColors,
      markerLines
    )
  );
  settleBandLabels(plotG);

  // Notes (#2039): a ring on the point, the text in clear plot space.
  if (parsed.notes?.length && !parsed.noNotes) {
    const at = pointAt;
    const plot = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    drawChartNotes(
      plotG,
      parsed.notes.map((n) => {
        const [x, y] = at(n.series, n.index);
        return {
          x,
          y,
          r: pointR,
          text: n.text,
          color: n.color,
          lineNumber: n.lineNumber,
        };
      }),
      {
        plot,
        canvas: plot,
        reserved: annotationBoxes,
        obstacles: markerLines,
        markers: [
          ...data.flatMap((_, s) =>
            periods.map((_p, i) => {
              const [cx, cy] = at(s, i);
              return { cx, cy, r: pointR + 14 };
            })
          ),
          ...sampleLines(data.map((_, s) => periods.map((_p, i) => at(s, i)))),
        ],
        colors: { text: textColor, bg: bgColor },
        palette,
      }
    );
  }

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
  });
}

// ============================================================
// Arc Node Ordering
// ============================================================

/**
 * Orders arc diagram nodes based on the selected ordering strategy.
 */
