// ============================================================
// Quadrant renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import { computeQuadrantPointLabels, type LabelRect } from '../label-layout';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import type { D3ExportDimensions } from '../utils/d3-types';
import { ScaleContext } from '../utils/scaling';
import { initD3Chart, renderChartTitle } from '../utils/d3-helpers';
import type {
  ParsedVisualization,
  QuadrantLabel,
} from '../visualizations/types';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';

// Quadrant Chart Renderer
// ============================================================

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
  parsed: ParsedVisualization,
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

  const hasXAxis = !!quadrantXAxis;
  const hasYAxis = !!quadrantYAxis;
  const margin = {
    top: title ? ctx.aesthetic(60) : ctx.aesthetic(30),
    right: ctx.aesthetic(30),
    bottom: hasXAxis ? ctx.aesthetic(70) : ctx.aesthetic(40),
    left: hasYAxis ? ctx.aesthetic(80) : ctx.aesthetic(40),
  };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  // Scales: data uses 0-1 range
  const xScale = d3Scale.scaleLinear().domain([0, 1]).range([0, chartWidth]);
  const yScale = d3Scale.scaleLinear().domain([0, 1]).range([chartHeight, 0]);

  // Title
  renderChartTitle(
    svg,
    title,
    quadrantTitleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // Chart group (translated by margins)
  const chartG = svg
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  const bg = isDark ? palette.surface : palette.bg;

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
      labelX: chartWidth / 4,
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
      labelX: (chartWidth * 3) / 4,
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
      labelX: chartWidth / 4,
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
      labelX: (chartWidth * 3) / 4,
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

  // White text for points; quadrant labels use a muted text color (consistent across all quadrants)
  const shadowColor = 'rgba(0,0,0,0.4)';

  // Single muted shade of textColor — watermark-style, readable against any quadrant fill
  const quadrantLabelColor = mix(textColor, bg, 35);

  // Scale label font size to fit within quadrant bounds, wrapping into multiple lines if needed
  const LABEL_MAX_FONT = ctx.text(48);
  const LABEL_MIN_FONT = ctx.text(14);
  const LABEL_PAD = ctx.aesthetic(40);

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
    const availH = qh - LABEL_PAD;

    // Try single line first
    if (measureText(text, LABEL_MAX_FONT) <= availW) {
      const fs = Math.min(LABEL_MAX_FONT, availH);
      return {
        lines: [text],
        fontSize: Math.max(LABEL_MIN_FONT, Math.round(fs)),
      };
    }

    // Try wrapping into 2+ lines: greedily pack words so each line fits availW
    const wrapLines = (fs: number): string[] =>
      wrapTextToWidth(text, fs, availW);

    // Binary-search for largest font size where wrapped text fits both width and height
    let lo = LABEL_MIN_FONT;
    let hi = LABEL_MAX_FONT;
    let bestLines = wrapLines(lo);
    let bestFs = lo;
    while (lo <= hi) {
      const mid = Math.round((lo + hi) / 2);
      const lines = wrapLines(mid);
      const totalH = lines.length * mid * 1.2; // line height ~1.2em
      const maxLineW = Math.max(...lines.map((l) => measureText(l, mid)));
      if (maxLineW <= availW && totalH <= availH) {
        bestFs = mid;
        bestLines = lines;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { lines: bestLines, fontSize: Math.max(LABEL_MIN_FONT, bestFs) };
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

  // Renders the original watermark content (quadrant name) into a text element.
  // Extracted so point hover can swap it for a hover state and restore on leave.
  const renderWatermarkOriginal = (
    textEl: SVGTextElement,
    d: (typeof quadrantDefsWithLabel)[number]
  ) => {
    const layout = labelLayouts.get(d.label!.text)!;
    const el = d3Selection.select(textEl);
    el.text(null)
      .attr('font-size', `${layout.fontSize}px`)
      .attr('font-weight', '700');
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
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', quadrantLabelColor)
    .attr('data-line-number', (d) =>
      d.label?.lineNumber ? String(d.label.lineNumber) : null
    )
    .style('cursor', (d) =>
      onClickItem && d.label?.lineNumber ? 'pointer' : 'default'
    )
    .each(function (d) {
      renderWatermarkOriginal(this as SVGTextElement, d);
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

  const sAxisFont = ctx.text(18);
  const sAxisPad = ctx.aesthetic(20);
  const sAxisX = ctx.aesthetic(22);

  if (quadrantXAxis) {
    const xLowLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', margin.left + chartWidth / 4)
      .attr('y', height - sAxisPad)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sAxisFont}px`)
      .attr(
        'data-line-number',
        quadrantXAxisLineNumber ? String(quadrantXAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantXAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantXAxis[0]);

    // High label (centered on right half)
    const xHighLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', margin.left + (chartWidth * 3) / 4)
      .attr('y', height - sAxisPad)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sAxisFont}px`)
      .attr(
        'data-line-number',
        quadrantXAxisLineNumber ? String(quadrantXAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantXAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantXAxis[1]);

    if (onClickItem && quadrantXAxisLineNumber) {
      [xLowLabel, xHighLabel].forEach((label) => {
        label
          .on('click', () => onClickItem(quadrantXAxisLineNumber))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      });
    }
  }

  // Y-axis labels — centered on top/bottom halves
  if (quadrantYAxis) {
    const yMidBottom = margin.top + (chartHeight * 3) / 4;
    const yMidTop = margin.top + chartHeight / 4;

    // Low label (centered on bottom half)
    const yLowLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', sAxisX)
      .attr('y', yMidBottom)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sAxisFont}px`)
      .attr('transform', `rotate(-90, ${sAxisX}, ${yMidBottom})`)
      .attr(
        'data-line-number',
        quadrantYAxisLineNumber ? String(quadrantYAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantYAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantYAxis[0]);

    // High label (centered on top half)
    const yHighLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', sAxisX)
      .attr('y', yMidTop)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sAxisFont}px`)
      .attr('transform', `rotate(-90, ${sAxisX}, ${yMidTop})`)
      .attr(
        'data-line-number',
        quadrantYAxisLineNumber ? String(quadrantYAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantYAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantYAxis[1]);

    if (onClickItem && quadrantYAxisLineNumber) {
      [yLowLabel, yHighLabel].forEach((label) => {
        label
          .on('click', () => onClickItem(quadrantYAxisLineNumber))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      });
    }
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
      ...layout.lines.map((l) => measureText(l, layout.fontSize))
    );
    const totalH = layout.lines.length * layout.fontSize * 1.2;
    return {
      x: d.labelX - totalW / 2,
      y: d.labelY - totalH / 2,
      w: totalW,
      h: totalH,
    };
  });

  // Compute collision-free label positions for all points
  const pointPixels = quadrantPoints.map((point) => ({
    label: point.label,
    cx: xScale(point.x),
    cy: yScale(point.y),
  }));

  const placedPointLabels = computeQuadrantPointLabels(
    pointPixels,
    { left: 0, top: 0, right: chartWidth, bottom: chartHeight },
    quadrantLabelObstacles,
    POINT_RADIUS,
    POINT_LABEL_FONT_SIZE
  );

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
    // placedPointLabels was produced by computeQuadrantPointLabels from pointPixels,
    // which has the same length as quadrantPoints.
    const placed = placedPointLabels[i]!;

    const pointG = pointsG
      .append('g')
      .attr('class', 'point-group')
      .attr('data-line-number', String(point.lineNumber));

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

    // Circle with white fill and colored border for visibility on opaque quadrants
    pointG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', POINT_RADIUS)
      .attr('fill', '#ffffff')
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
      .attr('font-size', `${POINT_LABEL_FONT_SIZE}px`)
      .attr('font-weight', '700')
      .style('text-shadow', `0 1px 2px ${shadowColor}`)
      .style('transition', 'y 120ms ease-out');

    labelText.append('tspan').text(point.label);

    const coordsTspan = labelText
      .append('tspan')
      .attr('class', 'point-coords')
      .attr('x', placed.x)
      .attr('dy', `${POINT_LABEL_FONT_SIZE}px`)
      .attr('font-size', `${ctx.text(10)}px`)
      .attr('font-weight', '500')
      .attr('opacity', 0)
      .text(`${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);

    const COORDS_LINE_H = ctx.structural(14);
    const bumpDy = placed.y < cy ? -COORDS_LINE_H : COORDS_LINE_H;

    pointG
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', () => {
        pointG.select('circle').attr('r', ctx.structural(8));
        labelText.attr('y', placed.y + bumpDy);
        coordsTspan.attr('opacity', 1);
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
        coordsTspan.attr('opacity', 0);
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
}

// ============================================================
