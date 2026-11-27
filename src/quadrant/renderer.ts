// ============================================================
// Quadrant renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import { computeQuadrantPointLabels, type LabelRect } from '../label-layout';
import {
  fitWrapped,
  measureText,
  type MeasureOpts,
  wrapTextToWidth,
} from '../utils/text-measure';
import { FULL_TEXT_ATTR, isCutShort } from '../utils/full-text';
import type { D3ExportDimensions } from '../utils/d3-types';
import { ScaleContext } from '../utils/scaling';
import { initD3Chart, renderChartTitle } from '../utils/d3-helpers';
import { growChartFrame } from '../utils/chart-frame';
import type { ParsedQuadrant, QuadrantLabel } from '../visualizations/types';
import type { PaletteColors } from '../palettes';
import { mix, themeBaseBg } from '../palettes/color-utils';

// Quadrant Chart Renderer
// ============================================================

/** Lines an axis label may wrap to along its axis before it is cut (#2459). */
export const AXIS_MAX_LINES = 2;
/** Lines a quadrant name may wrap to before it is cut (#2459). */
export const QUADRANT_LABEL_MAX_LINES = 3;
/** Lines a point name may wrap to before it is cut (#2459). */
export const POINT_LABEL_MAX_LINES = 2;
/**
 * Fit text to `maxWidth` in the order #2459 asks for: shrink on one line down
 * to `minFont`, then wrap at `minFont` to `maxLines`, then cut the last line
 * with `…`.
 */
function scaleWrapCut(
  text: string,
  maxWidth: number,
  maxFont: number,
  minFont: number,
  maxLines: number,
  opts: MeasureOpts
): { lines: string[]; fontSize: number } {
  for (let fs = Math.round(maxFont); fs >= minFont; fs--) {
    if (measureText(text, fs, opts) <= maxWidth)
      return { lines: [text], fontSize: fs };
  }
  return fitWrapped(text, maxWidth, minFont, minFont, maxLines, opts);
}

/** Smallest size an axis label shrinks to before it wraps further. */
const AXIS_MIN_FONT = 12;
const AXIS_LINE_HEIGHT = 1.2;
const POINT_LINE_HEIGHT_EM = 1.2;

type QuadrantPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-left'
  | 'bottom-right';

/**
 * Renders a quadrant chart using D3.
 * Displays 4 colored quadrant regions, axis labels, quadrant labels, and data points.
 */
export function renderQuadrant(
  container: HTMLDivElement,
  parsed: ParsedQuadrant,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const {
    quadrantLabels,
    quadrantPoints,
    quadrantXAxis,
    quadrantYAxis,
    quadrantTitleLineNumber,
    quadrantXAxisLineNumber,
    quadrantYAxisLineNumber,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  if (quadrantPoints.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor } = init;
  const borderColor = palette.border;

  const idealWidth = 600;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  svg.attr('preserveAspectRatio', 'xMidYMid meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const defaultColors = [
    palette.colors.blue,
    palette.colors.green,
    palette.colors.yellow,
    palette.colors.purple,
  ];

  // Title — drawn before the layout so a wrapped title's extra line, drawn
  // at full size (unscaled), pushes the chart down (#1718).
  const titleExtra = renderChartTitle(
    svg,
    title,
    quadrantTitleLineNumber,
    width,
    textColor,
    onClickItem,
    2
  );

  const hasXAxis = !!quadrantXAxis;
  const hasYAxis = !!quadrantYAxis;
  const sAxisFont = ctx.text(18);
  const sAxisMinFont = ctx.text(AXIS_MIN_FONT);
  const sAxisPad = ctx.aesthetic(20);
  const sAxisX = ctx.aesthetic(22);
  const AXIS_HALF_GAP = ctx.aesthetic(16);
  const fitAxis = (text: string, len: number) =>
    scaleWrapCut(text, len, sAxisFont, sAxisMinFont, AXIS_MAX_LINES, {});
  // The band each axis takes, reserved for AXIS_MAX_LINES lines at full size
  // so a wrapped label never reaches the plot. At scale 1 the base margins
  // already hold two lines; the reserve matters once the layout shrinks.
  const axisBand = (first: number) =>
    first +
    (AXIS_MAX_LINES - 1) * sAxisFont * AXIS_LINE_HEIGHT +
    sAxisFont * 0.3 +
    ctx.aesthetic(10);
  const margin = {
    top: (title ? ctx.aesthetic(60) : ctx.aesthetic(30)) + titleExtra,
    right: ctx.aesthetic(30),
    bottom: hasXAxis
      ? Math.max(ctx.aesthetic(70), axisBand(sAxisPad + sAxisFont * 0.7))
      : ctx.aesthetic(40),
    left: hasYAxis
      ? Math.max(ctx.aesthetic(80), axisBand(sAxisX))
      : ctx.aesthetic(40),
  };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const xAxisLen = Math.max(0, chartWidth / 2 - AXIS_HALF_GAP);
  const xAxisFits = quadrantXAxis
    ? quadrantXAxis.map((t) => fitAxis(t, xAxisLen))
    : [];

  // Scales: data uses 0-1 range
  const xScale = d3Scale.scaleLinear().domain([0, 1]).range([0, chartWidth]);
  const yScale = d3Scale.scaleLinear().domain([0, 1]).range([chartHeight, 0]);

  // Chart group (translated by margins)
  const chartG = svg
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  const bg = themeBaseBg(palette, isDark);

  // Full palette color for a quadrant (used for border and label tinting)
  const getQuadrantColor = (
    label: QuadrantLabel | null,
    defaultIdx: number
  ): string => {
    // defaultColors is non-empty; modulo guarantees in-bounds.
    return label?.color ?? defaultColors[defaultIdx % defaultColors.length]!;
  };

  // Muted fill: palette color blended 30% toward bg — matches other chart fill style
  const getQuadrantFill = (
    label: QuadrantLabel | null,
    defaultIdx: number
  ): string => {
    return mix(getQuadrantColor(label, defaultIdx), bg, 30);
  };

  // Quadrant names sit small in each quadrant's OUTER corner, behind the points.
  const LABEL_INSET = ctx.aesthetic(14);

  // Quadrant definitions: position, rect bounds, label position
  const quadrantDefs: {
    position: QuadrantPosition;
    x: number;
    y: number;
    w: number;
    h: number;
    labelX: number;
    labelY: number;
    label: QuadrantLabel | null;
    colorIdx: number;
  }[] = [
    {
      position: 'top-left',
      x: 0,
      y: 0,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: LABEL_INSET,
      labelY: chartHeight / 4,
      label: quadrantLabels.topLeft,
      colorIdx: 1, // green
    },
    {
      position: 'top-right',
      x: chartWidth / 2,
      y: 0,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: chartWidth - LABEL_INSET,
      labelY: chartHeight / 4,
      label: quadrantLabels.topRight,
      colorIdx: 0, // blue
    },
    {
      position: 'bottom-left',
      x: 0,
      y: chartHeight / 2,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: LABEL_INSET,
      labelY: (chartHeight * 3) / 4,
      label: quadrantLabels.bottomLeft,
      colorIdx: 2, // yellow
    },
    {
      position: 'bottom-right',
      x: chartWidth / 2,
      y: chartHeight / 2,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: chartWidth - LABEL_INSET,
      labelY: (chartHeight * 3) / 4,
      label: quadrantLabels.bottomRight,
      colorIdx: 3, // purple
    },
  ];

  // Draw quadrant rectangles
  const quadrantRects = chartG
    .selectAll('rect.quadrant')
    .data(quadrantDefs)
    .enter()
    .append('rect')
    .attr('class', 'quadrant')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .attr('width', (d) => d.w)
    .attr('height', (d) => d.h)
    .attr('fill', (d) => getQuadrantFill(d.label, d.colorIdx))
    .attr('stroke', (d) => getQuadrantColor(d.label, d.colorIdx))
    .attr('stroke-width', ctx.structural(2));

  // Halo behind point labels. Branched on theme like every other shadow in
  // the codebase — a flat black halo was invisible on a dark canvas.
  const shadowColor = isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.4)';

  // Single muted shade of textColor — watermark-style, readable against any quadrant fill
  const quadrantLabelColor = mix(textColor, bg, 55);

  // Scale label font size to fit within quadrant bounds, wrapping into multiple lines if needed
  const LABEL_MAX_FONT = ctx.text(18);
  const LABEL_MIN_FONT = ctx.text(12);
  const LABEL_PAD = LABEL_INSET * 2;

  interface QuadrantLabelLayout {
    lines: string[];
    fontSize: number;
  }

  const quadrantLabelLayout = (
    text: string,
    qw: number,
    qh: number
  ): QuadrantLabelLayout => {
    const availW = qw - LABEL_PAD;
    const availH = qh / 3;

    // Try single line first
    // The watermark is drawn at 700 (see the quadrant-label render below).
    if (measureText(text, LABEL_MAX_FONT, { bold: true }) <= availW) {
      const fs = Math.min(LABEL_MAX_FONT, availH);
      return {
        lines: [text],
        fontSize: Math.max(LABEL_MIN_FONT, Math.round(fs)),
      };
    }

    // Wrap: greedily pack words so each line fits availW, breaking a word
    // that alone is wider than the quadrant.
    const wrapLines = (fs: number): string[] =>
      wrapTextToWidth(text, fs, availW, { bold: true, hardBreak: true });

    // Binary-search for the largest font where the wrapped text fits the
    // width, the height and QUADRANT_LABEL_MAX_LINES.
    let lo = LABEL_MIN_FONT;
    let hi = LABEL_MAX_FONT;
    let best: QuadrantLabelLayout | null = null;
    while (lo <= hi) {
      const mid = Math.round((lo + hi) / 2);
      const lines = wrapLines(mid);
      const totalH = lines.length * mid * 1.2; // line height ~1.2em
      const maxLineW = Math.max(
        ...lines.map((l) => measureText(l, mid, { bold: true }))
      );
      if (
        lines.length <= QUADRANT_LABEL_MAX_LINES &&
        maxLineW <= availW &&
        totalH <= availH
      ) {
        best = { lines, fontSize: mid };
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best) return best;
    // Nothing fits even at the floor: cut at the line cap with `…` (#2459).
    return fitWrapped(
      text,
      availW,
      LABEL_MIN_FONT,
      LABEL_MIN_FONT,
      QUADRANT_LABEL_MAX_LINES
    );
  };

  // Draw quadrant labels (large, centered, darkened shade of fill — recedes behind points)
  // Pre-compute layout (lines + font size) for each quadrant label
  const qw = chartWidth / 2;
  const qh = chartHeight / 2;
  const quadrantDefsWithLabel = quadrantDefs.filter((d) => d.label !== null);
  const labelLayouts = new Map(
    quadrantDefsWithLabel.map((d) => [
      d.label!.text,
      quadrantLabelLayout(d.label!.text, qw, qh),
    ])
  );

  // Anchor each name to its outer corner: left quadrants start-aligned at the
  // left edge, right quadrants end-aligned at the right edge; top quadrants
  // hang from the top, bottom quadrants stand on the bottom.
  const labelAnchor = (d: (typeof quadrantDefs)[number]) =>
    d.position.endsWith('left') ? 'start' : 'end';
  for (const d of quadrantDefsWithLabel) {
    const layout = labelLayouts.get(d.label!.text)!;
    const totalH = layout.lines.length * layout.fontSize * 1.2;
    d.labelY = d.position.startsWith('top')
      ? LABEL_INSET + totalH / 2
      : chartHeight - LABEL_INSET - totalH / 2;
  }

  // Renders the original watermark content (quadrant name) into a text element.
  // Extracted so point hover can swap it for a hover state and restore on leave.
  const renderWatermarkOriginal = (
    textEl: SVGTextElement,
    d: (typeof quadrantDefsWithLabel)[number]
  ) => {
    const layout = labelLayouts.get(d.label!.text)!;
    const el = d3Selection.select(textEl);
    el.text(null)
      .attr('font-size', layout.fontSize)
      .attr('font-weight', 'bold');
    if (layout.lines.length === 1) {
      // In-bounds by length === 1 check.
      el.text(layout.lines[0]!);
    } else {
      const lineH = layout.fontSize * 1.2;
      const totalH = layout.lines.length * lineH;
      const startY = -totalH / 2 + lineH / 2;
      layout.lines.forEach((line, i) => {
        el.append('tspan')
          .attr('x', d.labelX)
          .attr('dy', i === 0 ? `${startY}px` : `${lineH}px`)
          .text(line);
      });
    }
  };

  const quadrantLabelTexts = chartG
    .selectAll('text.quadrant-label')
    .data(quadrantDefsWithLabel)
    .enter()
    .append('text')
    .attr('class', 'quadrant-label')
    .attr('x', (d) => d.labelX)
    .attr('y', (d) => d.labelY)
    .attr('text-anchor', labelAnchor)
    .attr('dominant-baseline', 'central')
    .attr('fill', quadrantLabelColor)
    .attr('fill-opacity', 0.7)
    .attr('data-line-number', (d) =>
      d.label?.lineNumber ? String(d.label.lineNumber) : null
    )
    .attr(FULL_TEXT_ATTR, (d) =>
      isCutShort(labelLayouts.get(d.label!.text)!.lines, [d.label!.text])
        ? d.label!.text
        : null
    )
    .style('cursor', (d) =>
      onClickItem && d.label?.lineNumber ? 'pointer' : 'default'
    )
    .each(function (d) {
      renderWatermarkOriginal(this, d);
    });

  if (onClickItem) {
    quadrantLabelTexts
      .on('click', (_, d) => {
        if (d.label?.lineNumber) onClickItem(d.label.lineNumber);
      })
      .on('mouseenter', function () {
        d3Selection.select(this).attr('opacity', 0.7);
      })
      .on('mouseleave', function () {
        d3Selection.select(this).attr('opacity', 1);
      });
  }

  // Axis labels: one per half of each axis. Each fits its half — shrink to
  // AXIS_MIN_FONT, wrap to AXIS_MAX_LINES lines along the axis, then cut with
  // `…` and keep the author's words in FULL_TEXT_ATTR (#2459).
  const drawAxisLabel = (
    text: string,
    fit: { lines: string[]; fontSize: number },
    x: number,
    y: number,
    rotate: boolean,
    lineNumber: number | null | undefined
  ) => {
    const lineH = fit.fontSize * AXIS_LINE_HEIGHT;
    const el = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', x)
      // X labels grow upward from the bottom pad; Y labels grow toward the
      // plot (rotated, +dy points right), so the first line keeps its place.
      .attr('y', rotate ? y : y - (fit.lines.length - 1) * lineH)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', fit.fontSize)
      .attr('transform', rotate ? `rotate(-90, ${x}, ${y})` : null)
      .attr('data-line-number', lineNumber ? String(lineNumber) : null)
      .style('cursor', onClickItem && lineNumber ? 'pointer' : 'default');
    if (fit.lines.length === 1) el.text(fit.lines[0]!);
    else
      fit.lines.forEach((line, i) => {
        el.append('tspan')
          .attr('x', x)
          .attr('dy', i === 0 ? 0 : `${lineH}px`)
          .text(line);
      });
    if (isCutShort(fit.lines, [text])) el.attr(FULL_TEXT_ATTR, text);
    if (onClickItem && lineNumber) {
      el.on('click', () => onClickItem(lineNumber))
        .on('mouseenter', function () {
          d3Selection.select(this).attr('opacity', 0.7);
        })
        .on('mouseleave', function () {
          d3Selection.select(this).attr('opacity', 1);
        });
    }
  };

  if (quadrantXAxis) {
    xAxisFits.forEach((fit, i) =>
      drawAxisLabel(
        quadrantXAxis[i]!,
        fit,
        margin.left + (chartWidth * (i === 0 ? 1 : 3)) / 4,
        height - sAxisPad,
        false,
        quadrantXAxisLineNumber
      )
    );
  }

  // Y-axis labels — low on the bottom half, high on the top half.
  if (quadrantYAxis) {
    const yAxisLen = Math.max(0, chartHeight / 2 - AXIS_HALF_GAP);
    [margin.top + (chartHeight * 3) / 4, margin.top + chartHeight / 4].forEach(
      (yMid, i) => {
        const text = quadrantYAxis[i]!;
        drawAxisLabel(
          text,
          fitAxis(text, yAxisLen),
          sAxisX,
          yMid,
          true,
          quadrantYAxisLineNumber
        );
      }
    );
  }

  // Draw center cross lines
  chartG
    .append('line')
    .attr('x1', chartWidth / 2)
    .attr('y1', 0)
    .attr('x2', chartWidth / 2)
    .attr('y2', chartHeight)
    .attr('stroke', borderColor)
    .attr('stroke-width', 1);

  chartG
    .append('line')
    .attr('x1', 0)
    .attr('y1', chartHeight / 2)
    .attr('x2', chartWidth)
    .attr('y2', chartHeight / 2)
    .attr('stroke', borderColor)
    .attr('stroke-width', 1);

  // Get which quadrant a point belongs to
  const getPointQuadrant = (x: number, y: number): QuadrantPosition => {
    if (x >= 0.5 && y >= 0.5) return 'top-right';
    if (x < 0.5 && y >= 0.5) return 'top-left';
    if (x < 0.5 && y < 0.5) return 'bottom-left';
    return 'bottom-right';
  };

  // Build obstacle rects from quadrant watermark labels for collision avoidance
  const POINT_RADIUS = ctx.structural(6);
  const POINT_LABEL_FONT_SIZE = ctx.text(12);
  const quadrantLabelObstacles: LabelRect[] = quadrantDefsWithLabel.map((d) => {
    const layout = labelLayouts.get(d.label!.text)!;
    const totalW = Math.max(
      ...layout.lines.map((l) =>
        measureText(l, layout.fontSize, { bold: true })
      )
    );
    const totalH = layout.lines.length * layout.fontSize * 1.2;
    return {
      x: labelAnchor(d) === 'start' ? d.labelX : d.labelX - totalW,
      y: d.labelY - totalH / 2,
      w: totalW,
      h: totalH,
    };
  });

  // Point names wrap to POINT_LABEL_MAX_LINES, then cut with `…` (#2459).
  // They are already drawn at the smallest point size, so nothing shrinks.
  const POINT_LABEL_MAX_W = Math.max(
    0,
    Math.min(qw - LABEL_PAD, ctx.aesthetic(220))
  );
  const pointFit = {
    maxWidth: POINT_LABEL_MAX_W,
    maxLines: POINT_LABEL_MAX_LINES,
    lineHeight: POINT_LABEL_FONT_SIZE * POINT_LINE_HEIGHT_EM,
  };
  const lineCaps: (number | undefined)[] = quadrantPoints.map(() => undefined);
  const placePointLabels = () =>
    computeQuadrantPointLabels(
      quadrantPoints.map((point, i) => ({
        label: point.label,
        cx: xScale(point.x),
        cy: yScale(point.y),
        ...(lineCaps[i] !== undefined && { maxLines: lineCaps[i] }),
      })),
      { left: 0, top: 0, right: chartWidth, bottom: chartHeight },
      quadrantLabelObstacles,
      POINT_RADIUS,
      POINT_LABEL_FONT_SIZE,
      // Point labels are drawn at 700 here.
      true,
      pointFit
    );
  let placedPointLabels = placePointLabels();
  // A wrapped name with no clear spot is cut to one line and placed again.
  const crowded = placedPointLabels.flatMap((p, i) =>
    p.collided && p.lines.length > 1 ? [i] : []
  );
  if (crowded.length > 0) {
    for (const i of crowded) lineCaps[i] = 1;
    placedPointLabels = placePointLabels();
  }

  // Draw data points (circles and labels)
  const pointsG = chartG.append('g').attr('class', 'points');

  quadrantPoints.forEach((point, i) => {
    const cx = xScale(point.x);
    const cy = yScale(point.y);
    const quadrant = getPointQuadrant(point.x, point.y);
    const quadDef = quadrantDefs.find((d) => d.position === quadrant);
    // defaultColors is non-empty; in-bounds by modulo / fallback to index 0.
    const pointColor =
      quadDef?.label?.color ?? defaultColors[quadDef?.colorIdx ?? 0]!;
    // placedPointLabels comes from computeQuadrantPointLabels over the points,
    // which has the same length as quadrantPoints.
    const placed = placedPointLabels[i]!;

    const pointG = pointsG
      .append('g')
      .attr('class', 'point-group')
      .attr('data-line-number', String(point.lineNumber))
      // Computed quadrant for baked-CSS cross-highlight (hover a point → dim
      // points in other quadrants).
      .attr('data-quadrant', quadrant);

    // Connector line (drawn first so it renders behind circle and label)
    if (placed.connectorLine) {
      pointG
        .append('line')
        .attr('x1', placed.connectorLine.x1)
        .attr('y1', placed.connectorLine.y1)
        .attr('x2', placed.connectorLine.x2)
        .attr('y2', placed.connectorLine.y2)
        .attr('stroke', pointColor)
        .attr('stroke-width', 1)
        .attr('opacity', 0.5);
    }

    // Circle with white fill and colored border for visibility on opaque
    // quadrants. §1.9 fill-outline hollows the dot: theme base background
    // fill so only the colored ring reads (stroke already carries the color).
    pointG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', POINT_RADIUS)
      .attr('fill', bg)
      .attr('stroke', pointColor)
      .attr('stroke-width', ctx.structural(2));

    // Label at computed position. Name is always shown; coords sit below
    // (smaller, lighter weight) and only appear on hover.
    const labelText = pointG
      .append('text')
      .attr('x', placed.x)
      .attr('y', placed.y)
      .attr('text-anchor', placed.anchor)
      .attr('dominant-baseline', 'central')
      .attr('fill', textColor)
      .attr('font-size', POINT_LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .style('text-shadow', `0 1px 2px ${shadowColor}`)
      .style('transition', 'y 120ms ease-out');

    const nameLines = placed.lines;
    if (nameLines.length === 1) labelText.append('tspan').text(nameLines[0]!);
    else {
      const lineH = pointFit.lineHeight;
      nameLines.forEach((line, k) => {
        labelText
          .append('tspan')
          .attr('x', placed.x)
          .attr(
            'dy',
            `${k === 0 ? (-(nameLines.length - 1) * lineH) / 2 : lineH}px`
          )
          .text(line);
      });
    }
    if (placed.truncated) pointG.attr(FULL_TEXT_ATTR, point.label);

    const coordsTspan = labelText
      .append('tspan')
      .attr('class', 'point-coords')
      .attr('x', placed.x)
      .attr('dy', `${POINT_LABEL_FONT_SIZE}px`)
      .attr('font-size', ctx.text(10))
      .attr('font-weight', 'normal')
      // `visibility`, not `opacity`: resvg ignores opacity on a <tspan>, so
      // every PNG drew the coords as a second line the label placement never
      // reserved, over the neighbouring labels (diagrammo/diagrammo#1536).
      .attr('visibility', 'hidden')
      .text(`${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);

    const COORDS_LINE_H = ctx.structural(14);
    const bumpDy = placed.y < cy ? -COORDS_LINE_H : COORDS_LINE_H;

    pointG
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', () => {
        pointG.select('circle').attr('r', ctx.structural(8));
        labelText.attr('y', placed.y + bumpDy);
        coordsTspan.attr('visibility', 'visible');
        quadrantRects.attr('opacity', (qd) =>
          qd.position === quadrant ? 1 : 0.3
        );
        quadrantLabelTexts.attr('opacity', (qd) =>
          qd.position === quadrant ? 1 : 0.3
        );
        pointsG
          .selectAll<SVGGElement, unknown>('g.point-group')
          .filter((_, j) => j !== i)
          .attr('opacity', 0.3);
      })
      .on('mouseleave', () => {
        pointG.select('circle').attr('r', POINT_RADIUS);
        labelText.attr('y', placed.y);
        coordsTspan.attr('visibility', 'hidden');
        quadrantRects.attr('opacity', 1);
        quadrantLabelTexts.attr('opacity', 1);
        pointsG.selectAll('g.point-group').attr('opacity', 1);
      })
      .on('click', () => {
        if (onClickItem && point.lineNumber) onClickItem(point.lineNumber);
      });
  });

  // Quadrant highlighting on hover and click-to-navigate
  quadrantRects
    .style('cursor', onClickItem ? 'pointer' : 'default')
    .on('mouseenter', function (_, d) {
      // Dim other quadrants
      quadrantRects.attr('opacity', (qd) =>
        qd.position === d.position ? 1 : 0.3
      );
      quadrantLabelTexts.attr('opacity', (qd) =>
        qd.position === d.position ? 1 : 0.3
      );
      // Dim points not in this quadrant
      pointsG.selectAll('g.point-group').each(function (_, i) {
        // selectAll iterates over point-group elements, so i indexes into quadrantPoints.
        const pt = quadrantPoints[i]!;
        const ptQuad = getPointQuadrant(pt.x, pt.y);
        d3Selection
          .select(this)
          .attr('opacity', ptQuad === d.position ? 1 : 0.2);
      });
    })
    .on('mouseleave', () => {
      quadrantRects.attr('opacity', 1);
      quadrantLabelTexts.attr('opacity', 1);
      pointsG.selectAll('g.point-group').attr('opacity', 1);
    })
    .on('click', (_, d) => {
      // Navigate to the quadrant label's line in the source
      if (onClickItem && d.label?.lineNumber) {
        onClickItem(d.label.lineNumber);
      }
    });

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
  });
}

// ============================================================
