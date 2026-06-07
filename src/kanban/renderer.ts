// ============================================================
// Kanban Board SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import { renderInlineText } from '../utils/inline-markdown';
import type {
  ParsedKanban,
  KanbanColumn,
  KanbanCard,
  KanbanTagGroup,
} from './types';
import { parseKanban } from './parser';
import { isArchiveColumn } from './mutations';
import { LEGEND_HEIGHT, measureLegendText } from '../utils/legend-constants';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { renderLegendD3 } from '../utils/legend-d3';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
  D3Sel,
} from '../utils/legend-types';
import { ScaleContext } from '../utils/scaling';
import { measureText } from '../utils/text-measure';

// ============================================================
// Public options object
// ============================================================

interface KanbanInteractiveOptions {
  onNavigateToLine?: (line: number) => void;
  exportDims?: { width: number; height: number };
  activeTagGroup?: string | null;
  currentSwimlaneGroup?: string | null;
  onSwimlaneChange?: (group: string | null) => void;
  collapsedLanes?: Set<string>;
  collapsedColumns?: Set<string>;
  compactMeta?: boolean;
  exportMode?: boolean;
}

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const COLUMN_GAP = 16;
const COLUMN_HEADER_HEIGHT = 36;
const COLUMN_PADDING = 12;
const COLUMN_MIN_WIDTH = 200;
const CARD_HEADER_HEIGHT = 24;
const CARD_META_LINE_HEIGHT = 14;
const CARD_SEPARATOR_GAP = 4;
const CARD_GAP = 8;
const CARD_RADIUS = 6;
const CARD_PADDING_X = 10;
const CARD_PADDING_Y = 6;
const CARD_STROKE_WIDTH = 1.5;
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';
const TITLE_HEIGHT = 30;
const COLUMN_HEADER_FONT_SIZE = 13;
const CARD_TITLE_FONT_SIZE = 12;
const CARD_META_FONT_SIZE = 10;
const WIP_FONT_SIZE = 10;
const COLUMN_RADIUS = 8;
const COLUMN_HEADER_RADIUS = 8;
const COLLAPSED_COLUMN_WIDTH = 40;
const COLLAPSED_LANE_HEIGHT = 26;

// ============================================================
// Tag color resolution
// ============================================================

function resolveCardTagMeta(
  card: KanbanCard,
  tagGroups: readonly KanbanTagGroup[],
  hiddenMetaGroups?: string[]
): { label: string; value: string; color?: string }[] {
  const meta: { label: string; value: string; color?: string }[] = [];
  for (const group of tagGroups) {
    if (hiddenMetaGroups?.includes(group.name.toLowerCase())) continue;
    const tagValue = card.tags[group.name.toLowerCase()];
    const value = tagValue ?? group.defaultValue;
    if (!value) continue;
    const entry = group.entries.find(
      (e) => e.value.toLowerCase() === value.toLowerCase()
    );
    meta.push({
      label: group.name,
      value,
      ...(entry?.color !== undefined && { color: entry.color }),
    });
  }
  return meta;
}

function resolveCardTagColor(
  card: KanbanCard,
  tagGroups: readonly KanbanTagGroup[],
  activeTagGroup: string | null
): string | undefined {
  if (!activeTagGroup) return card.color;
  const group = tagGroups.find(
    (g) => g.name.toLowerCase() === activeTagGroup.toLowerCase()
  );
  if (!group) return card.color;
  const tagValue = card.tags[group.name.toLowerCase()];
  const value = tagValue ?? group.defaultValue;
  if (!value) return undefined;
  const entry = group.entries.find(
    (e) => e.value.toLowerCase() === value.toLowerCase()
  );
  return entry?.color;
}

// ============================================================
// Layout computation
// ============================================================

interface ColumnLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  column: KanbanColumn;
  cardLayouts: CardLayout[];
}

interface CardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  card: KanbanCard;
}

function computeLayout(
  parsed: ParsedKanban,
  _palette: PaletteColors,
  collapsedColumns?: Set<string>,
  hiddenMetaGroups?: string[],
  sDiagramPadding = DIAGRAM_PADDING,
  sTitleHeight = TITLE_HEIGHT,
  sCardTitleFontSize = CARD_TITLE_FONT_SIZE,
  sColumnHeaderFontSize = COLUMN_HEADER_FONT_SIZE,
  sColumnHeaderHeight = COLUMN_HEADER_HEIGHT,
  sColumnPadding = COLUMN_PADDING,
  sCardPaddingX = CARD_PADDING_X,
  sCardPaddingY = CARD_PADDING_Y,
  sCardSeparatorGap = CARD_SEPARATOR_GAP,
  sCardMetaLineHeight = CARD_META_LINE_HEIGHT,
  sCardHeaderHeight = CARD_HEADER_HEIGHT,
  sCardMetaFontSize = CARD_META_FONT_SIZE,
  sCardGap = CARD_GAP,
  sColumnMinWidth = COLUMN_MIN_WIDTH,
  sColumnGap = COLUMN_GAP,
  sCollapsedColumnWidth = COLLAPSED_COLUMN_WIDTH
): { columns: ColumnLayout[]; totalWidth: number; totalHeight: number } {
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const headerHeight = showTitle ? sTitleHeight + 8 : 0;
  const startY = sDiagramPadding + headerHeight;

  const columnLayouts: ColumnLayout[] = [];

  let maxColumnHeight = 0;

  const visibleColumns = parsed.columns.filter((c) => !isArchiveColumn(c.name));

  for (const col of visibleColumns) {
    const isCollapsed = collapsedColumns?.has(col.id) ?? false;

    if (isCollapsed) {
      columnLayouts.push({
        x: 0,
        y: startY,
        width: sCollapsedColumnWidth,
        height: 0,
        column: col,
        cardLayouts: [],
      });
      continue;
    }

    let maxCardTextWidth = measureText(col.name, sColumnHeaderFontSize);

    const cardLayouts: CardLayout[] = [];
    let cardY = sColumnHeaderHeight + sColumnPadding;

    for (const card of col.cards) {
      const titleWidth = measureText(card.title, sCardTitleFontSize);
      maxCardTextWidth = Math.max(
        maxCardTextWidth,
        titleWidth + sCardPaddingX * 2
      );

      const tagMeta = resolveCardTagMeta(
        card,
        parsed.tagGroups,
        hiddenMetaGroups
      );
      const metaCount = tagMeta.length + card.details.length;
      const metaHeight =
        metaCount > 0
          ? sCardSeparatorGap +
            1 +
            sCardPaddingY +
            metaCount * sCardMetaLineHeight
          : 0;
      const cardHeight = sCardHeaderHeight + sCardPaddingY + metaHeight;

      for (const m of tagMeta) {
        const metaW =
          measureText(`${m.label}: ${m.value}`, sCardMetaFontSize) +
          sCardPaddingX * 2;
        maxCardTextWidth = Math.max(maxCardTextWidth, metaW);
      }

      cardLayouts.push({
        x: sColumnPadding,
        y: cardY,
        width: 0,
        height: cardHeight,
        card,
      });

      cardY += cardHeight + sCardGap;
    }

    const colWidth = Math.max(
      sColumnMinWidth,
      maxCardTextWidth + sColumnPadding * 2
    );

    for (const cl of cardLayouts) {
      cl.width = colWidth - sColumnPadding * 2;
    }

    const colHeight = cardY + sColumnPadding;
    maxColumnHeight = Math.max(maxColumnHeight, colHeight);

    columnLayouts.push({
      x: 0,
      y: startY,
      width: colWidth,
      height: colHeight,
      column: col,
      cardLayouts,
    });
  }

  let currentX = sDiagramPadding;
  for (const cl of columnLayouts) {
    cl.x = currentX;
    cl.height = maxColumnHeight;
    currentX += cl.width + sColumnGap;
  }

  const totalWidth = currentX - sColumnGap + sDiagramPadding;
  const totalHeight = startY + maxColumnHeight + sDiagramPadding;

  return { columns: columnLayouts, totalWidth, totalHeight };
}

// ============================================================
// Render function
// ============================================================

export function renderKanban(
  container: HTMLElement,
  parsed: ParsedKanban,
  palette: PaletteColors,
  isDark: boolean,
  options?: KanbanInteractiveOptions
): void {
  const exportDims = options?.exportDims;
  const activeTagGroup = options?.activeTagGroup ?? null;
  const onSwimlaneChange = options?.onSwimlaneChange;
  const collapsedLanes = options?.collapsedLanes;
  const collapsedColumns = options?.collapsedColumns;
  const compactMeta = options?.compactMeta ?? false;
  const solid = parsed.options['solid-fill'] === 'on';
  const requestedSwimlane = options?.currentSwimlaneGroup ?? null;
  const swimlaneGroup = requestedSwimlane
    ? (parsed.tagGroups.find(
        (g) => g.name.toLowerCase() === requestedSwimlane.toLowerCase()
      ) ?? null)
    : null;

  const hiddenMetaGroups: string[] = [];
  if (compactMeta) {
    if (activeTagGroup) hiddenMetaGroups.push(activeTagGroup.toLowerCase());
    if (requestedSwimlane)
      hiddenMetaGroups.push(requestedSwimlane.toLowerCase());
  }

  const visibleColumns = parsed.columns.filter((c) => !isArchiveColumn(c.name));
  const colCount = Math.max(1, visibleColumns.length);
  const idealWidth =
    colCount * COLUMN_MIN_WIDTH +
    (colCount - 1) * COLUMN_GAP +
    2 * DIAGRAM_PADDING;
  const containerWidth =
    exportDims?.width ?? container.getBoundingClientRect().width;
  const ctx =
    exportDims || containerWidth <= 0
      ? ScaleContext.identity()
      : ScaleContext.from(containerWidth, idealWidth);

  const sDiagramPadding = ctx.aesthetic(DIAGRAM_PADDING);
  const sColumnGap = ctx.aesthetic(COLUMN_GAP);
  const sColumnHeaderHeight = ctx.structural(COLUMN_HEADER_HEIGHT);
  const sColumnPadding = ctx.aesthetic(COLUMN_PADDING);
  const sColumnMinWidth = ctx.structural(COLUMN_MIN_WIDTH);
  const sCardHeaderHeight = ctx.structural(CARD_HEADER_HEIGHT);
  const sCardMetaLineHeight = ctx.structural(CARD_META_LINE_HEIGHT);
  const sCardSeparatorGap = ctx.structural(CARD_SEPARATOR_GAP);
  const sCardGap = ctx.aesthetic(CARD_GAP);
  const sCardRadius = ctx.structural(CARD_RADIUS);
  const sCardPaddingX = ctx.aesthetic(CARD_PADDING_X);
  const sCardPaddingY = ctx.aesthetic(CARD_PADDING_Y);
  const sCardStrokeWidth = ctx.structural(CARD_STROKE_WIDTH);
  const sTitleHeight = ctx.structural(TITLE_HEIGHT);
  const sColumnHeaderFontSize = ctx.text(COLUMN_HEADER_FONT_SIZE);
  const sCardTitleFontSize = ctx.text(CARD_TITLE_FONT_SIZE);
  const sCardMetaFontSize = ctx.text(CARD_META_FONT_SIZE);
  const sWipFontSize = ctx.text(WIP_FONT_SIZE);
  const sColumnRadius = ctx.structural(COLUMN_RADIUS);
  const sColumnHeaderRadius = ctx.structural(COLUMN_HEADER_RADIUS);
  const sCollapsedColumnWidth = ctx.structural(COLLAPSED_COLUMN_WIDTH);
  const sCollapsedLaneHeight = ctx.structural(COLLAPSED_LANE_HEIGHT);
  const sTitleFontSize = ctx.text(TITLE_FONT_SIZE);
  const sLaneHeaderWidth = ctx.structural(LANE_HEADER_WIDTH);
  const sLaneGap = ctx.aesthetic(LANE_GAP);

  const layout = computeLayout(
    parsed,
    palette,
    collapsedColumns,
    hiddenMetaGroups,
    sDiagramPadding,
    sTitleHeight,
    sCardTitleFontSize,
    sColumnHeaderFontSize,
    sColumnHeaderHeight,
    sColumnPadding,
    sCardPaddingX,
    sCardPaddingY,
    sCardSeparatorGap,
    sCardMetaLineHeight,
    sCardHeaderHeight,
    sCardMetaFontSize,
    sCardGap,
    sColumnMinWidth,
    sColumnGap,
    sCollapsedColumnWidth
  );

  const width = exportDims?.width ?? layout.totalWidth;
  const height = exportDims?.height ?? layout.totalHeight;

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

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const showTopTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  if (showTopTitle) {
    svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('data-line-number', parsed.titleLineNumber ?? 0)
      .attr('x', sDiagramPadding)
      .attr('y', sDiagramPadding + sTitleFontSize)
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(parsed.title!);
  }

  if (parsed.tagGroups.length > 0) {
    const titleTextWidth = showTopTitle
      ? measureLegendText(parsed.title!, sTitleFontSize) + 16
      : 0;
    const legendX = sDiagramPadding + titleTextWidth;
    const legendConfig: LegendConfig = {
      groups: parsed.tagGroups,
      position: { placement: 'top-center', titleRelation: 'inline-with-title' },
      mode: options?.exportMode ? 'export' : 'preview',
    };
    const legendH = getMaxLegendReservedHeight(
      legendConfig,
      width - legendX - sDiagramPadding
    );
    const legendY = sDiagramPadding + (sTitleFontSize - legendH) / 2;
    const legendState: LegendState = { activeGroup: activeTagGroup ?? null };
    const legendG = svg
      .append('g')
      .attr('class', 'kanban-legend')
      .attr('transform', `translate(${legendX},${legendY})`);

    const showSwimlaneIcon = !!onSwimlaneChange && !exportDims;

    const legendCallbacks: LegendCallbacks | undefined = showSwimlaneIcon
      ? {
          onGroupRendered: (groupName, groupEl, isActive) => {
            const isCurrent =
              swimlaneGroup?.name.toLowerCase() === groupName.toLowerCase();
            const textW = measureLegendText(groupName, 11);
            const iconX = isActive ? 4 + 6 + textW + 6 : 8 + textW + 4;
            const iconY = (LEGEND_HEIGHT - 7) / 2;
            const iconEl = drawSwimlaneIcon(
              groupEl,
              iconX,
              iconY,
              isCurrent,
              palette
            );
            iconEl.append('title').text(`Group by ${groupName}`);
            iconEl.style('cursor', 'pointer').on('click', (event: Event) => {
              event.stopPropagation();
              onSwimlaneChange?.(isCurrent ? null : groupName);
            });
          },
        }
      : undefined;

    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      palette,
      isDark,
      legendCallbacks,
      width - legendX - sDiagramPadding
    );
  }

  if (swimlaneGroup) {
    renderSwimlaneBoard(
      svg,
      parsed,
      layout,
      swimlaneGroup,
      palette,
      isDark,
      activeTagGroup,
      collapsedLanes,
      collapsedColumns,
      hiddenMetaGroups,
      sDiagramPadding,
      sTitleHeight,
      sLaneHeaderWidth,
      sColumnGap,
      sCollapsedColumnWidth,
      sColumnHeaderHeight,
      sColumnPadding,
      sCardHeaderHeight,
      sCardPaddingY,
      sCardGap,
      sCollapsedLaneHeight,
      sLaneGap,
      sCardSeparatorGap,
      sCardMetaLineHeight,
      sColumnHeaderFontSize,
      sColumnRadius,
      sColumnHeaderRadius,
      sWipFontSize,
      sCardRadius,
      sCardPaddingX,
      sCardStrokeWidth,
      sCardTitleFontSize,
      sCardMetaFontSize
    );
    return;
  }

  const defaultColBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);
  const defaultColHeaderBg = isDark
    ? mix(palette.surface, palette.bg, 70)
    : mix(palette.surface, palette.bg, 50);

  for (const colLayout of layout.columns) {
    const col = colLayout.column;
    const isColCollapsed = collapsedColumns?.has(col.id) ?? false;
    const g = svg
      .append('g')
      .attr('class', 'kanban-column')
      .attr('data-column-id', col.id)
      .attr('data-line-number', col.lineNumber);

    const thisColBg = defaultColBg;
    const thisColHeaderBg = col.color
      ? shapeFill(palette, col.color, isDark, { solid })
      : defaultColHeaderBg;
    const onHeaderText = col.color
      ? contrastText(
          thisColHeaderBg,
          palette.textOnFillLight,
          palette.textOnFillDark
        )
      : palette.text;

    if (isColCollapsed) {
      g.append('rect')
        .attr('x', colLayout.x)
        .attr('y', colLayout.y)
        .attr('width', sCollapsedColumnWidth)
        .attr('height', colLayout.height)
        .attr('rx', sColumnRadius)
        .attr('fill', thisColBg);

      g.append('rect')
        .attr('x', colLayout.x)
        .attr('y', colLayout.y)
        .attr('width', sCollapsedColumnWidth)
        .attr('height', sColumnHeaderHeight)
        .attr('rx', sColumnHeaderRadius)
        .attr('fill', thisColHeaderBg);

      g.append('text')
        .attr('x', colLayout.x + sCollapsedColumnWidth / 2)
        .attr('y', colLayout.y + sColumnHeaderHeight / 2 + sWipFontSize / 2 - 1)
        .attr('font-size', sWipFontSize)
        .attr('font-weight', 'bold')
        .attr('fill', col.color ? onHeaderText : palette.textMuted)
        .attr('text-anchor', 'middle')
        .text(String(col.cards.length));

      g.append('text')
        .attr('x', colLayout.x + sCollapsedColumnWidth / 2)
        .attr('y', colLayout.y + sColumnHeaderHeight + sColumnPadding)
        .attr('font-size', sCardTitleFontSize)
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .attr('text-anchor', 'middle')
        .attr('writing-mode', 'tb')
        .text(col.name);

      continue;
    }

    g.append('rect')
      .attr('x', colLayout.x)
      .attr('y', colLayout.y)
      .attr('width', colLayout.width)
      .attr('height', colLayout.height)
      .attr('rx', sColumnRadius)
      .attr('fill', thisColBg);

    g.append('rect')
      .attr('x', colLayout.x)
      .attr('y', colLayout.y)
      .attr('width', colLayout.width)
      .attr('height', sColumnHeaderHeight)
      .attr('rx', sColumnHeaderRadius)
      .attr('fill', thisColHeaderBg);

    g.append('text')
      .attr('x', colLayout.x + sColumnPadding)
      .attr(
        'y',
        colLayout.y + sColumnHeaderHeight / 2 + sColumnHeaderFontSize / 2 - 2
      )
      .attr('font-size', sColumnHeaderFontSize)
      .attr('font-weight', 'bold')
      .attr('fill', onHeaderText)
      .text(col.name);

    {
      const wipExceeded =
        col.wipLimit != null && col.cards.length > col.wipLimit;
      const badgeText =
        col.wipLimit != null
          ? `${col.cards.length}/${col.wipLimit}`
          : String(col.cards.length);
      g.append('text')
        .attr('x', colLayout.x + colLayout.width - sColumnPadding)
        .attr('y', colLayout.y + sColumnHeaderHeight / 2 + sWipFontSize / 2 - 1)
        .attr('text-anchor', 'end')
        .attr('font-size', sWipFontSize)
        .attr(
          'fill',
          wipExceeded
            ? palette.colors.red
            : col.color
              ? onHeaderText
              : palette.textMuted
        )
        .attr('font-weight', wipExceeded ? 'bold' : 'normal')
        .text(badgeText);
    }

    for (const cardLayout of colLayout.cardLayouts) {
      const card = cardLayout.card;
      const resolvedColor = resolveCardTagColor(
        card,
        parsed.tagGroups,
        activeTagGroup ?? null
      );
      const tagMeta = resolveCardTagMeta(
        card,
        parsed.tagGroups,
        hiddenMetaGroups
      );
      const hasMeta = tagMeta.length > 0 || card.details.length > 0;

      const cardFill = shapeFill(
        palette,
        resolvedColor ?? palette.primary,
        isDark,
        { solid }
      );
      const cardStroke = resolvedColor ?? palette.textMuted;
      const onCardText = contrastText(
        cardFill,
        palette.textOnFillLight,
        palette.textOnFillDark
      );

      const cg = g
        .append('g')
        .attr('class', 'kanban-card')
        .attr('data-card-id', card.id)
        .attr('data-line-number', card.lineNumber);

      if (activeTagGroup) {
        const tagKey = activeTagGroup.toLowerCase();
        const tagValue = card.tags[tagKey];
        const group = parsed.tagGroups.find(
          (tg) => tg.name.toLowerCase() === tagKey
        );
        const value = tagValue ?? group?.defaultValue;
        if (value) {
          cg.attr(`data-tag-${tagKey}`, value.toLowerCase());
        }
      }

      const cx = colLayout.x + cardLayout.x;
      const cy = colLayout.y + cardLayout.y;

      cg.append('rect')
        .attr('x', cx)
        .attr('y', cy)
        .attr('width', cardLayout.width)
        .attr('height', cardLayout.height)
        .attr('rx', sCardRadius)
        .attr('fill', cardFill)
        .attr('stroke', cardStroke)
        .attr('stroke-width', sCardStrokeWidth);

      const titleEl = cg
        .append('text')
        .attr('x', cx + sCardPaddingX)
        .attr('y', cy + sCardPaddingY + sCardTitleFontSize)
        .attr('font-size', sCardTitleFontSize)
        .attr('font-weight', '500')
        .attr('fill', onCardText);
      renderInlineText(titleEl, card.title, palette, sCardTitleFontSize);

      if (hasMeta) {
        const separatorY = cy + sCardHeaderHeight;

        cg.append('line')
          .attr('x1', cx)
          .attr('y1', separatorY)
          .attr('x2', cx + cardLayout.width)
          .attr('y2', separatorY)
          .attr('stroke', solid ? onCardText : cardStroke)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);

        let metaY = separatorY + sCardSeparatorGap + sCardMetaFontSize;

        for (const meta of tagMeta) {
          cg.append('text')
            .attr('x', cx + sCardPaddingX)
            .attr('y', metaY)
            .attr('font-size', sCardMetaFontSize)
            .attr('fill', onCardText)
            .text(`${meta.label}: `);

          const labelWidth = measureText(`${meta.label}: `, sCardMetaFontSize);
          cg.append('text')
            .attr('x', cx + sCardPaddingX + labelWidth)
            .attr('y', metaY)
            .attr('font-size', sCardMetaFontSize)
            .attr('fill', onCardText)
            .text(meta.value);

          metaY += sCardMetaLineHeight;
        }

        for (const detail of card.details) {
          const detailEl = cg
            .append('text')
            .attr('x', cx + sCardPaddingX)
            .attr('y', metaY)
            .attr('font-size', sCardMetaFontSize)
            .attr('fill', onCardText);
          renderInlineText(detailEl, detail, palette, sCardMetaFontSize);

          metaY += sCardMetaLineHeight;
        }
      }
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderKanbanForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseKanban(content, palette);
  if (parsed.error || parsed.columns.length === 0) return '';

  const isDark = theme === 'dark';
  const layout = computeLayout(parsed, palette);

  const container = document.createElement('div');
  renderKanban(container, parsed, palette, isDark, {
    exportDims: { width: layout.totalWidth, height: layout.totalHeight },
    exportMode: true,
  });

  const svgEl = container.querySelector('svg');
  return svgEl?.outerHTML ?? '';
}

// ============================================================
// Swimlane: icon, bucketing, layout, render
// ============================================================

const LANE_HEADER_WIDTH = 140;
const LANE_GAP = 14;

function drawSwimlaneIcon(
  parent: D3Sel,
  x: number,
  y: number,
  isActive: boolean,
  palette: PaletteColors
): D3Sel {
  const iconG = parent
    .append('g')
    .attr('class', 'kanban-swimlane-icon')
    .attr('transform', `translate(${x}, ${y})`);

  // Transparent hit area so the whole icon (not just the 2px bars) is clickable
  iconG
    .append('rect')
    .attr('x', -5)
    .attr('y', -5)
    .attr('width', 22)
    .attr('height', 18)
    .attr('fill', 'transparent');

  const color = isActive ? palette.primary : palette.textMuted;
  const opacity = isActive ? 1 : 0.35;
  const barWidths = [8, 12, 6];
  const barH = 2;
  const gap = 3;

  for (let i = 0; i < barWidths.length; i++) {
    iconG
      .append('rect')
      .attr('x', 0)
      .attr('y', i * gap)
      .attr('width', barWidths[i]!)
      .attr('height', barH)
      .attr('rx', 1)
      .attr('fill', color)
      .attr('opacity', opacity);
  }

  return iconG;
}

interface SwimlaneBucket {
  laneName: string;
  laneColor?: string;
  isFallback: boolean;
  cellsByColumn: Record<string, KanbanCard[]>;
}

function bucketCardsBySwimlane(
  columns: KanbanColumn[],
  swimlaneGroup: KanbanTagGroup
): SwimlaneBucket[] {
  const tagKey = swimlaneGroup.name.toLowerCase();
  const buckets = new Map<string, SwimlaneBucket>();

  // Seed lanes from declaration order
  for (const entry of swimlaneGroup.entries) {
    buckets.set(entry.value.toLowerCase(), {
      laneName: entry.value,
      laneColor: entry.color,
      isFallback: false,
      cellsByColumn: {},
    });
  }

  const fallbackKey = `__no_${tagKey}__`;

  for (const col of columns) {
    for (const card of col.cards) {
      const raw = card.tags[tagKey] ?? swimlaneGroup.defaultValue;
      let bucketKey: string;
      if (raw && buckets.has(raw.toLowerCase())) {
        bucketKey = raw.toLowerCase();
      } else {
        if (!buckets.has(fallbackKey)) {
          buckets.set(fallbackKey, {
            laneName: `No ${swimlaneGroup.name}`,
            isFallback: true,
            cellsByColumn: {},
          });
        }
        bucketKey = fallbackKey;
      }
      const bucket = buckets.get(bucketKey)!;
      (bucket.cellsByColumn[col.id] ??= []).push(card);
    }
  }

  // Drop empty seeded lanes that have no cards (and aren't fallback).
  // Phase A choice: keep entries even if empty so users see the structure.
  return Array.from(buckets.values());
}

interface SwimlaneCellLayout {
  column: KanbanColumn;
  cards: KanbanCard[];
  cardLayouts: CardLayout[];
}

interface SwimlaneLaneLayout {
  bucket: SwimlaneBucket;
  y: number;
  height: number;
  cells: SwimlaneCellLayout[];
}

interface SwimlaneBoardLayout {
  columnXs: { column: KanbanColumn; x: number; width: number }[];
  lanes: SwimlaneLaneLayout[];
  totalWidth: number;
  totalHeight: number;
  startY: number;
}

function computeCardHeight(
  card: KanbanCard,
  tagGroups: readonly KanbanTagGroup[],
  hiddenMetaGroups?: string[],
  sCardSeparatorGap = CARD_SEPARATOR_GAP,
  sCardPaddingY = CARD_PADDING_Y,
  sCardMetaLineHeight = CARD_META_LINE_HEIGHT,
  sCardHeaderHeight = CARD_HEADER_HEIGHT
) {
  const tagMeta = resolveCardTagMeta(card, tagGroups, hiddenMetaGroups);
  const metaCount = tagMeta.length + card.details.length;
  const metaHeight =
    metaCount > 0
      ? sCardSeparatorGap + 1 + sCardPaddingY + metaCount * sCardMetaLineHeight
      : 0;
  return sCardHeaderHeight + sCardPaddingY + metaHeight;
}

function computeSwimlaneLayout(
  parsed: ParsedKanban,
  buckets: SwimlaneBucket[],
  baseLayout: { columns: ColumnLayout[] },
  collapsedLanes?: Set<string>,
  collapsedColumns?: Set<string>,
  hiddenMetaGroups?: string[],
  sDiagramPadding = DIAGRAM_PADDING,
  sTitleHeight = TITLE_HEIGHT,
  sLaneHeaderWidth = LANE_HEADER_WIDTH,
  sColumnGap = COLUMN_GAP,
  sCollapsedColumnWidth = COLLAPSED_COLUMN_WIDTH,
  sColumnHeaderHeight = COLUMN_HEADER_HEIGHT,
  sColumnPadding = COLUMN_PADDING,
  sCardHeaderHeight = CARD_HEADER_HEIGHT,
  sCardPaddingY = CARD_PADDING_Y,
  sCardGap = CARD_GAP,
  sCollapsedLaneHeight = COLLAPSED_LANE_HEIGHT,
  sLaneGap = LANE_GAP,
  sCardSeparatorGap = CARD_SEPARATOR_GAP,
  sCardMetaLineHeight = CARD_META_LINE_HEIGHT
): SwimlaneBoardLayout {
  const headerHeight =
    parsed.title && parsed.options['no-title'] !== 'on' ? sTitleHeight + 8 : 0;
  const startY = sDiagramPadding + headerHeight;

  const columnXs: SwimlaneBoardLayout['columnXs'] = [];
  let currentX = sDiagramPadding + sLaneHeaderWidth;
  for (const col of baseLayout.columns) {
    const isColCollapsed = collapsedColumns?.has(col.column.id) ?? false;
    const w = isColCollapsed ? sCollapsedColumnWidth : col.width;
    columnXs.push({ column: col.column, x: currentX, width: w });
    currentX += w + sColumnGap;
  }
  const totalWidth = currentX - sColumnGap + sDiagramPadding;

  const lanes: SwimlaneLaneLayout[] = [];
  let laneY = startY + sColumnHeaderHeight + sColumnPadding;
  const minCellH = sCardHeaderHeight + sCardPaddingY + sCardGap;

  for (const bucket of buckets) {
    const isLaneCollapsed = collapsedLanes?.has(bucket.laneName) ?? false;

    if (isLaneCollapsed) {
      const cells: SwimlaneCellLayout[] = columnXs.map((colInfo) => ({
        column: colInfo.column,
        cards: bucket.cellsByColumn[colInfo.column.id] ?? [],
        cardLayouts: [],
      }));
      lanes.push({ bucket, y: laneY, height: sCollapsedLaneHeight, cells });
      laneY += sCollapsedLaneHeight + sLaneGap;
      continue;
    }

    let maxCellH = minCellH;
    const cellsTmp: { column: KanbanColumn; cards: KanbanCard[]; h: number }[] =
      [];

    for (const colInfo of columnXs) {
      const isColCollapsed = collapsedColumns?.has(colInfo.column.id) ?? false;
      const cards = bucket.cellsByColumn[colInfo.column.id] ?? [];
      if (isColCollapsed) {
        cellsTmp.push({ column: colInfo.column, cards, h: 0 });
        continue;
      }
      let h = 0;
      for (const c of cards) {
        h +=
          computeCardHeight(
            c,
            parsed.tagGroups,
            hiddenMetaGroups,
            sCardSeparatorGap,
            sCardPaddingY,
            sCardMetaLineHeight,
            sCardHeaderHeight
          ) + sCardGap;
      }
      h = Math.max(h - (cards.length > 0 ? sCardGap : 0), 0);
      cellsTmp.push({ column: colInfo.column, cards, h });
      if (h > maxCellH) maxCellH = h;
    }

    const laneHeight = Math.max(maxCellH, minCellH);

    const cells: SwimlaneCellLayout[] = cellsTmp.map((tmp, i) => {
      const colInfo = columnXs[i]!;
      const isColCollapsed = collapsedColumns?.has(colInfo.column.id) ?? false;
      if (isColCollapsed) {
        return { column: tmp.column, cards: tmp.cards, cardLayouts: [] };
      }
      const cardLayouts: CardLayout[] = [];
      let cy = 0;
      for (const card of tmp.cards) {
        const ch = computeCardHeight(
          card,
          parsed.tagGroups,
          hiddenMetaGroups,
          sCardSeparatorGap,
          sCardPaddingY,
          sCardMetaLineHeight,
          sCardHeaderHeight
        );
        cardLayouts.push({
          x: colInfo.x + sColumnPadding,
          y: laneY + cy,
          width: colInfo.width - sColumnPadding * 2,
          height: ch,
          card,
        });
        cy += ch + sCardGap;
      }
      return { column: tmp.column, cards: tmp.cards, cardLayouts };
    });

    lanes.push({ bucket, y: laneY, height: laneHeight, cells });
    laneY += laneHeight + sLaneGap;
  }

  const totalHeight = laneY - sLaneGap + sColumnPadding + sDiagramPadding;

  return { columnXs, lanes, totalWidth, totalHeight, startY };
}

function renderSwimlaneBoard(
  svg: D3Sel,
  parsed: ParsedKanban,
  baseLayout: {
    columns: ColumnLayout[];
    totalWidth: number;
    totalHeight: number;
  },
  swimlaneGroup: KanbanTagGroup,
  palette: PaletteColors,
  isDark: boolean,
  activeTagGroup: string | null,
  collapsedLanes?: Set<string>,
  collapsedColumns?: Set<string>,
  hiddenMetaGroups?: string[],
  sDiagramPadding = DIAGRAM_PADDING,
  sTitleHeight = TITLE_HEIGHT,
  sLaneHeaderWidth = LANE_HEADER_WIDTH,
  sColumnGap = COLUMN_GAP,
  sCollapsedColumnWidth = COLLAPSED_COLUMN_WIDTH,
  sColumnHeaderHeight = COLUMN_HEADER_HEIGHT,
  sColumnPadding = COLUMN_PADDING,
  sCardHeaderHeight = CARD_HEADER_HEIGHT,
  sCardPaddingY = CARD_PADDING_Y,
  sCardGap = CARD_GAP,
  sCollapsedLaneHeight = COLLAPSED_LANE_HEIGHT,
  sLaneGap = LANE_GAP,
  sCardSeparatorGap = CARD_SEPARATOR_GAP,
  sCardMetaLineHeight = CARD_META_LINE_HEIGHT,
  sColumnHeaderFontSize = COLUMN_HEADER_FONT_SIZE,
  sColumnRadius = COLUMN_RADIUS,
  sColumnHeaderRadius = COLUMN_HEADER_RADIUS,
  sWipFontSize = WIP_FONT_SIZE,
  sCardRadius = CARD_RADIUS,
  sCardPaddingX = CARD_PADDING_X,
  sCardStrokeWidth = CARD_STROKE_WIDTH,
  sCardTitleFontSize = CARD_TITLE_FONT_SIZE,
  sCardMetaFontSize = CARD_META_FONT_SIZE
): void {
  const visibleColumns = parsed.columns.filter((c) => !isArchiveColumn(c.name));
  const buckets = bucketCardsBySwimlane(visibleColumns, swimlaneGroup);
  const grid = computeSwimlaneLayout(
    parsed,
    buckets,
    baseLayout,
    collapsedLanes,
    collapsedColumns,
    hiddenMetaGroups,
    sDiagramPadding,
    sTitleHeight,
    sLaneHeaderWidth,
    sColumnGap,
    sCollapsedColumnWidth,
    sColumnHeaderHeight,
    sColumnPadding,
    sCardHeaderHeight,
    sCardPaddingY,
    sCardGap,
    sCollapsedLaneHeight,
    sLaneGap,
    sCardSeparatorGap,
    sCardMetaLineHeight
  );

  const currentW = parseFloat(svg.attr('width') || '0');
  const currentH = parseFloat(svg.attr('height') || '0');
  if (grid.totalWidth > currentW) {
    svg.attr('width', grid.totalWidth);
    svg.attr(
      'viewBox',
      `0 0 ${grid.totalWidth} ${Math.max(currentH, grid.totalHeight)}`
    );
  }
  if (grid.totalHeight > currentH) {
    svg.attr('height', grid.totalHeight);
    svg.attr(
      'viewBox',
      `0 0 ${Math.max(currentW, grid.totalWidth)} ${grid.totalHeight}`
    );
  }

  const defaultColBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);
  const defaultColHeaderBg = isDark
    ? mix(palette.surface, palette.bg, 70)
    : mix(palette.surface, palette.bg, 50);

  for (const colInfo of grid.columnXs) {
    const col = colInfo.column;
    const isColCollapsed = collapsedColumns?.has(col.id) ?? false;
    const headerG = svg
      .append('g')
      .attr('class', 'kanban-column kanban-column-header')
      .attr('data-column-id', col.id)
      .attr('data-line-number', col.lineNumber);

    const colHeaderBg = col.color
      ? shapeFill(palette, col.color, isDark, {
          solid: parsed.options['solid-fill'] === 'on',
        })
      : defaultColHeaderBg;

    headerG
      .append('rect')
      .attr('x', colInfo.x)
      .attr('y', grid.startY)
      .attr('width', colInfo.width)
      .attr('height', sColumnHeaderHeight)
      .attr('rx', sColumnHeaderRadius)
      .attr('fill', colHeaderBg);

    if (isColCollapsed) {
      headerG
        .append('text')
        .attr('x', colInfo.x + colInfo.width / 2)
        .attr('y', grid.startY + sColumnHeaderHeight / 2 + sWipFontSize / 2 - 1)
        .attr('font-size', sWipFontSize)
        .attr('font-weight', 'bold')
        .attr('fill', palette.textMuted)
        .attr('text-anchor', 'middle')
        .text(String(col.cards.length));
    } else {
      headerG
        .append('text')
        .attr('x', colInfo.x + sColumnPadding)
        .attr(
          'y',
          grid.startY + sColumnHeaderHeight / 2 + sColumnHeaderFontSize / 2 - 2
        )
        .attr('font-size', sColumnHeaderFontSize)
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .text(col.name);

      const wipExceeded =
        col.wipLimit != null && col.cards.length > col.wipLimit;
      const badgeText =
        col.wipLimit != null
          ? `${col.cards.length}/${col.wipLimit}`
          : String(col.cards.length);
      headerG
        .append('text')
        .attr('x', colInfo.x + colInfo.width - sColumnPadding)
        .attr('y', grid.startY + sColumnHeaderHeight / 2 + sWipFontSize / 2 - 1)
        .attr('text-anchor', 'end')
        .attr('font-size', sWipFontSize)
        .attr('fill', wipExceeded ? palette.colors.red : palette.textMuted)
        .attr('font-weight', wipExceeded ? 'bold' : 'normal')
        .text(badgeText);
    }
  }

  for (const lane of grid.lanes) {
    const isLaneCollapsed = collapsedLanes?.has(lane.bucket.laneName) ?? false;
    const laneG = svg
      .append('g')
      .attr('class', 'kanban-lane')
      .attr('data-lane-name', lane.bucket.laneName);

    const headerG = laneG
      .append('g')
      .attr('class', 'kanban-lane-header')
      .attr(
        'transform',
        `translate(${sDiagramPadding}, ${lane.y - sColumnPadding})`
      );

    headerG
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', sLaneHeaderWidth - 8)
      .attr('height', lane.height + sColumnPadding * 2)
      .attr('rx', sColumnRadius)
      .attr('fill', defaultColBg);

    let labelX = 10;
    const totalCards = lane.cells.reduce((s, c) => s + c.cards.length, 0);
    if (lane.bucket.laneColor) {
      headerG
        .append('circle')
        .attr('cx', labelX + 4)
        .attr('cy', 16)
        .attr('r', 4)
        .attr('fill', lane.bucket.laneColor);
      labelX += 14;
    }

    if (isLaneCollapsed) {
      headerG
        .append('text')
        .attr('x', labelX)
        .attr('y', 20)
        .attr('font-size', 10)
        .attr('fill', palette.textMuted)
        .text(`${lane.bucket.laneName} (${totalCards})`);
    } else {
      headerG
        .append('text')
        .attr('x', labelX)
        .attr('y', 20)
        .attr('font-size', 12)
        .attr('font-weight', 'bold')
        .attr('fill', lane.bucket.isFallback ? palette.textMuted : palette.text)
        .text(lane.bucket.laneName);
    }

    if (isLaneCollapsed) {
      for (const cell of lane.cells) {
        const isColCollapsed = collapsedColumns?.has(cell.column.id) ?? false;
        if (cell.cards.length > 0) {
          const colInfo = grid.columnXs.find(
            (c) => c.column.id === cell.column.id
          );
          if (!colInfo) continue;
          const placeholderBg = lane.bucket.laneColor
            ? mix(lane.bucket.laneColor, palette.bg, isDark ? 40 : 28)
            : mix(palette.textMuted, palette.bg, isDark ? 28 : 22);
          const pw = isColCollapsed
            ? sCollapsedColumnWidth - 8
            : colInfo.width - sColumnPadding * 2;
          laneG
            .append('rect')
            .attr('x', colInfo.x + (isColCollapsed ? 4 : sColumnPadding))
            .attr('y', lane.y)
            .attr('width', pw)
            .attr('height', 18)
            .attr('rx', 4)
            .attr('fill', placeholderBg);
          laneG
            .append('text')
            .attr(
              'x',
              colInfo.x + (isColCollapsed ? 4 : sColumnPadding) + pw / 2
            )
            .attr('y', lane.y + 13)
            .attr('font-size', sWipFontSize)
            .attr('font-weight', 'bold')
            .attr('fill', palette.textMuted)
            .attr('text-anchor', 'middle')
            .text(String(cell.cards.length));
        }
      }
    }

    laneG
      .append('line')
      .attr('x1', sDiagramPadding + sLaneHeaderWidth)
      .attr('x2', grid.totalWidth - sDiagramPadding)
      .attr('y1', lane.y + lane.height + sColumnPadding)
      .attr('y2', lane.y + lane.height + sColumnPadding)
      .attr('stroke', palette.border ?? palette.textMuted)
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1);

    if (!isLaneCollapsed) {
      for (const cell of lane.cells) {
        const isColCollapsed = collapsedColumns?.has(cell.column.id) ?? false;
        if (isColCollapsed && cell.cards.length > 0) {
          const colInfo = grid.columnXs.find(
            (c) => c.column.id === cell.column.id
          );
          if (colInfo) {
            const placeholderBg = lane.bucket.laneColor
              ? mix(lane.bucket.laneColor, palette.bg, isDark ? 40 : 28)
              : mix(palette.textMuted, palette.bg, isDark ? 28 : 22);
            laneG
              .append('rect')
              .attr('x', colInfo.x + 4)
              .attr('y', lane.y)
              .attr('width', sCollapsedColumnWidth - 8)
              .attr('height', 22)
              .attr('rx', 4)
              .attr('fill', placeholderBg);
            laneG
              .append('text')
              .attr('x', colInfo.x + sCollapsedColumnWidth / 2)
              .attr('y', lane.y + 16)
              .attr('font-size', sWipFontSize)
              .attr('font-weight', 'bold')
              .attr('fill', palette.textMuted)
              .attr('text-anchor', 'middle')
              .text(String(cell.cards.length));
          }
          continue;
        }
        for (const cardLayout of cell.cardLayouts) {
          renderSwimlaneCard(
            laneG,
            cardLayout,
            parsed.tagGroups,
            activeTagGroup,
            palette,
            isDark,
            hiddenMetaGroups,
            parsed.options['solid-fill'] === 'on',
            sCardRadius,
            sCardPaddingX,
            sCardPaddingY,
            sCardStrokeWidth,
            sCardTitleFontSize,
            sCardMetaFontSize,
            sCardHeaderHeight,
            sCardSeparatorGap,
            sCardMetaLineHeight
          );
        }
      }
    }
  }
}

function renderSwimlaneCard(
  parent: D3Sel,
  cardLayout: CardLayout,
  tagGroups: readonly KanbanTagGroup[],
  activeTagGroup: string | null,
  palette: PaletteColors,
  isDark: boolean,
  hiddenMetaGroups?: string[],
  solid?: boolean,
  sCardRadius = CARD_RADIUS,
  sCardPaddingX = CARD_PADDING_X,
  sCardPaddingY = CARD_PADDING_Y,
  sCardStrokeWidth = CARD_STROKE_WIDTH,
  sCardTitleFontSize = CARD_TITLE_FONT_SIZE,
  sCardMetaFontSize = CARD_META_FONT_SIZE,
  sCardHeaderHeight = CARD_HEADER_HEIGHT,
  sCardSeparatorGap = CARD_SEPARATOR_GAP,
  sCardMetaLineHeight = CARD_META_LINE_HEIGHT
): void {
  const card = cardLayout.card;
  const resolvedColor = resolveCardTagColor(card, tagGroups, activeTagGroup);
  const tagMeta = resolveCardTagMeta(card, tagGroups, hiddenMetaGroups);
  const hasMeta = tagMeta.length > 0 || card.details.length > 0;

  const cardFill = shapeFill(
    palette,
    resolvedColor ?? palette.primary,
    isDark,
    {
      ...(solid !== undefined && { solid }),
    }
  );
  const cardStroke = resolvedColor ?? palette.textMuted;
  const onCardText = contrastText(
    cardFill,
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  const cg = parent
    .append('g')
    .attr('class', 'kanban-card')
    .attr('data-card-id', card.id)
    .attr('data-line-number', card.lineNumber);

  if (activeTagGroup) {
    const tagKey = activeTagGroup.toLowerCase();
    const group = tagGroups.find((tg) => tg.name.toLowerCase() === tagKey);
    const value = card.tags[tagKey] ?? group?.defaultValue;
    if (value) {
      cg.attr(`data-tag-${tagKey}`, value.toLowerCase());
    }
  }

  const cx = cardLayout.x;
  const cy = cardLayout.y;

  cg.append('rect')
    .attr('x', cx)
    .attr('y', cy)
    .attr('width', cardLayout.width)
    .attr('height', cardLayout.height)
    .attr('rx', sCardRadius)
    .attr('fill', cardFill)
    .attr('stroke', cardStroke)
    .attr('stroke-width', sCardStrokeWidth);

  const titleEl = cg
    .append('text')
    .attr('x', cx + sCardPaddingX)
    .attr('y', cy + sCardPaddingY + sCardTitleFontSize)
    .attr('font-size', sCardTitleFontSize)
    .attr('font-weight', '500')
    .attr('fill', onCardText);
  renderInlineText(titleEl, card.title, palette, sCardTitleFontSize);

  if (hasMeta) {
    const separatorY = cy + sCardHeaderHeight;
    cg.append('line')
      .attr('x1', cx)
      .attr('y1', separatorY)
      .attr('x2', cx + cardLayout.width)
      .attr('y2', separatorY)
      .attr('stroke', cardStroke)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);

    let metaY = separatorY + sCardSeparatorGap + sCardMetaFontSize;

    for (const meta of tagMeta) {
      cg.append('text')
        .attr('x', cx + sCardPaddingX)
        .attr('y', metaY)
        .attr('font-size', sCardMetaFontSize)
        .attr('fill', palette.textMuted)
        .text(`${meta.label}: `);
      const labelWidth = measureText(`${meta.label}: `, sCardMetaFontSize);
      cg.append('text')
        .attr('x', cx + sCardPaddingX + labelWidth)
        .attr('y', metaY)
        .attr('font-size', sCardMetaFontSize)
        .attr('fill', onCardText)
        .text(meta.value);
      metaY += sCardMetaLineHeight;
    }

    for (const detail of card.details) {
      const detailEl = cg
        .append('text')
        .attr('x', cx + sCardPaddingX)
        .attr('y', metaY)
        .attr('font-size', sCardMetaFontSize)
        .attr('fill', palette.textMuted);
      renderInlineText(detailEl, detail, palette, sCardMetaFontSize);
      metaY += sCardMetaLineHeight;
    }
  }
}
