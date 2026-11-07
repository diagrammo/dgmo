// ============================================================
// SWOT SVG Renderer — four fixed panels, 2×2, always S W / O T
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix } from '../palettes/color-utils';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import type { LegendConfig } from '../utils/legend-types';
import { legendSuppressed } from '../utils/parsing';
import { tagAttrKey } from '../utils/tag-groups';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';
import type { ParsedSwot, SwotItem, SwotSection } from './types';

export interface SwotRenderOptions {
  activeTagGroup?: string | null;
  exportMode?: boolean;
}

const DIAGRAM_PADDING = 20;
const TITLE_HEIGHT = 30;
const LEGEND_GAP = 8;
const PANEL_WIDTH = 300;
const PANEL_GAP = 12;
const PANEL_RADIUS = 8;
const PANEL_PADDING = 12;
const HEADER_HEIGHT = 34;
const HEADER_FONT_SIZE = 13;
const HEADER_LINE_HEIGHT = 16;
const HEADER_COLOR_PCT = 38;
const ITEM_FONT_SIZE = 13;
const ITEM_LINE_HEIGHT = 18;
const ITEM_GAP = 8;
const DOT_RADIUS = 3.5;
const DOT_GAP = 8;
const DETAIL_FONT_SIZE = 11;
const DETAIL_LINE_HEIGHT = 15;
// Axes are drawn as the textbook matrix's table headers (#1742): a filled
// band over each column and a filled rail beside each row, aligned to the
// panels. Loose 11px captions read as stray text.
const AXIS_FONT_SIZE = 10.5;
const AXIS_FONT_WEIGHT = 600;
const AXIS_LETTER_SPACING = 1.2;
const AXIS_HEADER_SIZE = 22; // band height / rail width
const AXIS_HEADER_GAP = 6; // band → panel
const AXIS_HEADER_RADIUS = 5;
const AXIS_BAND = AXIS_HEADER_SIZE + AXIS_HEADER_GAP;
const EMPTY_TEXT = 'None listed';

const ITEM_TEXT_WIDTH =
  PANEL_WIDTH - 2 * PANEL_PADDING - 2 * DOT_RADIUS - DOT_GAP;

interface ItemLayout {
  readonly item: SwotItem;
  readonly titleLines: readonly string[];
  readonly detailLines: readonly string[];
  readonly height: number;
}

interface PanelLayout {
  readonly section: SwotSection;
  readonly headerLines: readonly string[];
  readonly headerHeight: number;
  readonly items: readonly ItemLayout[];
  readonly height: number;
}

function layoutItem(item: SwotItem): ItemLayout {
  const wrapOpts = { hardBreak: true };
  const titleLines = wrapTextToWidth(
    item.title,
    ITEM_FONT_SIZE,
    ITEM_TEXT_WIDTH,
    wrapOpts
  );
  const detailLines = item.details.flatMap((detail) =>
    wrapTextToWidth(detail, DETAIL_FONT_SIZE, ITEM_TEXT_WIDTH, wrapOpts)
  );
  return {
    item,
    titleLines,
    detailLines,
    height:
      titleLines.length * ITEM_LINE_HEIGHT +
      detailLines.length * DETAIL_LINE_HEIGHT,
  };
}

function layoutPanel(section: SwotSection): PanelLayout {
  const headerLines = wrapTextToWidth(
    section.label,
    HEADER_FONT_SIZE,
    PANEL_WIDTH - 2 * PANEL_PADDING,
    { bold: true, hardBreak: true }
  );
  const headerHeight =
    HEADER_HEIGHT + (headerLines.length - 1) * HEADER_LINE_HEIGHT;
  const items = section.items.map(layoutItem);
  const body =
    items.length === 0
      ? ITEM_LINE_HEIGHT
      : items.reduce((sum, item) => sum + item.height, 0) +
        (items.length - 1) * ITEM_GAP;
  return {
    section,
    headerLines,
    headerHeight,
    items,
    height: headerHeight + 2 * PANEL_PADDING + body,
  };
}

/** A tagged item takes its tag's colour; an untagged one keeps the section's. */
function itemColor(
  item: SwotItem,
  section: SwotSection,
  parsed: ParsedSwot,
  activeTagGroup: string | null
): string {
  if (!activeTagGroup) return section.color;
  const key = tagAttrKey(activeTagGroup);
  const value = item.tags[key];
  if (!value) return section.color;
  const group = parsed.tagGroups.find((g) => tagAttrKey(g.name) === key);
  const entry = group?.entries.find(
    (e) => e.value.toLowerCase() === value.toLowerCase()
  );
  return entry?.color ?? section.color;
}

export function renderSwot(
  container: HTMLElement,
  parsed: ParsedSwot,
  palette: PaletteColors,
  isDark: boolean,
  options?: SwotRenderOptions
): void {
  const activeTagGroup = options?.activeTagGroup ?? null;
  const showAxes = parsed.options['no-axes'] !== 'on';
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const showLegend =
    parsed.tagGroups.length > 0 && !legendSuppressed(parsed.options);

  const axisBand = showAxes ? AXIS_BAND : 0;
  const gridWidth = 2 * PANEL_WIDTH + PANEL_GAP;
  const titleWidth = showTitle
    ? measureText(parsed.title, TITLE_FONT_SIZE, { bold: true })
    : 0;
  const width = Math.ceil(
    2 * DIAGRAM_PADDING + Math.max(axisBand + gridWidth, titleWidth)
  );

  const legendX = DIAGRAM_PADDING + (showTitle ? titleWidth + 16 : 0);
  const legendWidth = Math.max(
    gridWidth / 2,
    width - legendX - DIAGRAM_PADDING
  );
  const legendConfig: LegendConfig = {
    groups: parsed.tagGroups,
    position: { placement: 'top-center', titleRelation: 'inline-with-title' },
    mode: options?.exportMode ? 'export' : 'preview',
  };
  const legendHeight = showLegend
    ? getMaxLegendReservedHeight(legendConfig, legendWidth)
    : 0;
  const legendY = DIAGRAM_PADDING + (TITLE_FONT_SIZE - legendHeight) / 2;

  const headerBottom = Math.max(
    showTitle || showLegend ? DIAGRAM_PADDING + TITLE_HEIGHT : DIAGRAM_PADDING,
    showLegend ? legendY + legendHeight + LEGEND_GAP : 0
  );
  const gridTop = headerBottom + axisBand;
  const gridLeft = DIAGRAM_PADDING + axisBand;

  const panels = parsed.sections.map(layoutPanel);
  const topHeight = Math.max(panels[0]!.height, panels[1]!.height);
  const bottomHeight = Math.max(panels[2]!.height, panels[3]!.height);
  const height = Math.ceil(
    gridTop + topHeight + PANEL_GAP + bottomHeight + DIAGRAM_PADDING
  );

  container.innerHTML = '';
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('font-family', FONT_FAMILY)
    .style('background', palette.bg);

  // Stays 2×2 on a phone: the same layout, scaled whole by its viewBox.
  const containerWidth = container.getBoundingClientRect().width;
  if (containerWidth > 0 && containerWidth < width) {
    svg.attr('width', '100%').attr('height', null);
  }

  if (showTitle) {
    svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('data-line-number', parsed.titleLineNumber ?? 0)
      .attr('x', DIAGRAM_PADDING)
      .attr('y', DIAGRAM_PADDING + TITLE_FONT_SIZE)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(parsed.title);
  }

  if (showLegend) {
    const legendG = svg
      .append('g')
      .attr('class', 'swot-legend')
      .attr('transform', `translate(${legendX},${legendY})`);
    renderIntegratedLegend(legendG, {
      ...legendConfig,
      palette,
      isDark,
      width: legendWidth,
      activeGroup: activeTagGroup,
    });
  }

  const columnX = [gridLeft, gridLeft + PANEL_WIDTH + PANEL_GAP] as const;
  const rowY = [gridTop, gridTop + topHeight + PANEL_GAP] as const;
  const rowHeight = [topHeight, bottomHeight] as const;

  const panelFill = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);

  if (showAxes) {
    const axes = svg.append('g').attr('class', 'swot-axes');
    const headerFill = mix(palette.textMuted, panelFill, 12);
    const header = (
      x: number,
      y: number,
      w: number,
      h: number,
      label: string,
      rotate: boolean
    ) => {
      axes
        .append('rect')
        .attr('class', 'swot-axis-header')
        .attr('x', x)
        .attr('y', y)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', AXIS_HEADER_RADIUS)
        .attr('fill', headerFill);
      const cx = x + w / 2;
      const cy = y + h / 2;
      const text = axes
        .append('text')
        .attr('class', 'swot-axis-label')
        .attr('x', cx)
        .attr('y', cy)
        .attr('font-size', AXIS_FONT_SIZE)
        .attr('font-weight', AXIS_FONT_WEIGHT)
        .attr('letter-spacing', AXIS_LETTER_SPACING)
        .attr('fill', palette.textMuted)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .text(label.toUpperCase());
      if (rotate) text.attr('transform', `rotate(-90 ${cx} ${cy})`);
    };
    for (const column of [0, 1] as const) {
      header(
        columnX[column],
        gridTop - AXIS_BAND,
        PANEL_WIDTH,
        AXIS_HEADER_SIZE,
        parsed.xLabels[column],
        false
      );
    }
    for (const row of [0, 1] as const) {
      header(
        gridLeft - AXIS_BAND,
        rowY[row],
        AXIS_HEADER_SIZE,
        rowHeight[row],
        parsed.yLabels[row],
        true
      );
    }
  }

  panels.forEach((panel, index) => {
    const section = panel.section;
    const column = (index % 2) as 0 | 1;
    const row = index < 2 ? 0 : 1;
    const x = columnX[column];
    const y = rowY[row];

    const g = svg
      .append('g')
      .attr('class', 'swot-panel')
      .attr('data-section', section.key);
    if (section.lineNumber > 0) {
      g.attr('data-line-number', section.lineNumber);
    }

    g.append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', PANEL_WIDTH)
      .attr('height', rowHeight[row])
      .attr('rx', PANEL_RADIUS)
      .attr('fill', panelFill);

    // Rounded on top only, so the band meets the panel body in a straight edge.
    const bandFill = mix(section.color, panelFill, HEADER_COLOR_PCT);
    const r = PANEL_RADIUS;
    const right = x + PANEL_WIDTH;
    const bottom = y + panel.headerHeight;
    g.append('path')
      .attr('class', 'swot-header')
      .attr(
        'd',
        `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${right - r}Q${right},${y} ${right},${y + r}V${bottom}Z`
      )
      .attr('fill', bandFill);
    const labelColor = contrastText(
      bandFill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    panel.headerLines.forEach((line, lineIndex) => {
      g.append('text')
        .attr('x', x + PANEL_PADDING)
        .attr('y', y + HEADER_HEIGHT / 2 + lineIndex * HEADER_LINE_HEIGHT)
        .attr('dominant-baseline', 'central')
        .attr('font-size', HEADER_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('fill', labelColor)
        .text(line);
    });

    const dotX = x + PANEL_PADDING + DOT_RADIUS;
    const textX = dotX + DOT_RADIUS + DOT_GAP;
    let cursorY = y + panel.headerHeight + PANEL_PADDING;

    if (panel.items.length === 0) {
      g.append('text')
        .attr('class', 'swot-empty')
        .attr('x', x + PANEL_PADDING)
        .attr('y', cursorY + ITEM_LINE_HEIGHT / 2)
        .attr('dominant-baseline', 'central')
        .attr('font-size', ITEM_FONT_SIZE)
        .attr('font-style', 'italic')
        .attr('fill', palette.textMuted)
        .text(EMPTY_TEXT);
      return;
    }

    for (const itemLayout of panel.items) {
      const item = itemLayout.item;
      const itemG = g
        .append('g')
        .attr('class', 'swot-item')
        .attr('data-line-number', item.lineNumber);
      if (activeTagGroup) {
        const key = tagAttrKey(activeTagGroup);
        const value = item.tags[key];
        if (value) itemG.attr(`data-tag-${key}`, value.toLowerCase());
      }

      itemG
        .append('circle')
        .attr('cx', dotX)
        .attr('cy', cursorY + ITEM_LINE_HEIGHT / 2)
        .attr('r', DOT_RADIUS)
        .attr('fill', itemColor(item, section, parsed, activeTagGroup));

      for (const line of itemLayout.titleLines) {
        itemG
          .append('text')
          .attr('x', textX)
          .attr('y', cursorY + ITEM_LINE_HEIGHT / 2)
          .attr('dominant-baseline', 'central')
          .attr('font-size', ITEM_FONT_SIZE)
          .attr('fill', palette.text)
          .text(line);
        cursorY += ITEM_LINE_HEIGHT;
      }
      for (const line of itemLayout.detailLines) {
        itemG
          .append('text')
          .attr('class', 'swot-detail')
          .attr('x', textX)
          .attr('y', cursorY + DETAIL_LINE_HEIGHT / 2)
          .attr('dominant-baseline', 'central')
          .attr('font-size', DETAIL_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .text(line);
        cursorY += DETAIL_LINE_HEIGHT;
      }
      cursorY += ITEM_GAP;
    }
  });
}
