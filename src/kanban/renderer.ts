// ============================================================
// Kanban Board SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
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
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';

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

// ============================================================
// Tag color resolution
// ============================================================

function resolveCardTagMeta(
  card: KanbanCard,
  tagGroups: KanbanTagGroup[]
): { label: string; value: string; color?: string }[] {
  const meta: { label: string; value: string; color?: string }[] = [];
  for (const group of tagGroups) {
    const tagValue = card.tags[group.name.toLowerCase()];
    const value = tagValue ?? group.defaultValue;
    if (!value) continue;
    const entry = group.entries.find(
      (e) => e.value.toLowerCase() === value.toLowerCase()
    );
    meta.push({ label: group.name, value, color: entry?.color });
  }
  return meta;
}

function resolveCardTagColor(
  card: KanbanCard,
  tagGroups: KanbanTagGroup[],
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
  _palette: PaletteColors
): { columns: ColumnLayout[]; totalWidth: number; totalHeight: number } {
  // Title row
  const headerHeight = parsed.title ? TITLE_HEIGHT + 8 : 0;
  const startY = DIAGRAM_PADDING + headerHeight;

  // Estimate column widths based on content
  const charWidth = CARD_TITLE_FONT_SIZE * 0.6;
  const columnLayouts: ColumnLayout[] = [];

  let maxColumnHeight = 0;

  // Filter out the archive column — it's a drop target only, not rendered
  const visibleColumns = parsed.columns.filter((c) => !isArchiveColumn(c.name));

  for (const col of visibleColumns) {
    // Compute card heights and column width
    let maxCardTextWidth = col.name.length * (COLUMN_HEADER_FONT_SIZE * 0.65);

    const cardLayouts: CardLayout[] = [];
    let cardY = COLUMN_HEADER_HEIGHT + COLUMN_PADDING;

    for (const card of col.cards) {
      const titleWidth = card.title.length * charWidth;
      maxCardTextWidth = Math.max(
        maxCardTextWidth,
        titleWidth + CARD_PADDING_X * 2
      );

      // Count metadata rows (tag groups + detail lines)
      const tagMeta = resolveCardTagMeta(card, parsed.tagGroups);
      const metaCount = tagMeta.length + card.details.length;
      const metaHeight =
        metaCount > 0
          ? CARD_SEPARATOR_GAP +
            1 +
            CARD_PADDING_Y +
            metaCount * CARD_META_LINE_HEIGHT
          : 0;
      const cardHeight = CARD_HEADER_HEIGHT + CARD_PADDING_Y + metaHeight;

      // Account for meta label widths
      for (const m of tagMeta) {
        const metaW =
          (m.label.length + 2 + m.value.length) * CARD_META_FONT_SIZE * 0.6 +
          CARD_PADDING_X * 2;
        maxCardTextWidth = Math.max(maxCardTextWidth, metaW);
      }

      cardLayouts.push({
        x: COLUMN_PADDING,
        y: cardY,
        width: 0, // set after column width computed
        height: cardHeight,
        card,
      });

      cardY += cardHeight + CARD_GAP;
    }

    const colWidth = Math.max(
      COLUMN_MIN_WIDTH,
      maxCardTextWidth + COLUMN_PADDING * 2
    );

    // Set card widths
    for (const cl of cardLayouts) {
      cl.width = colWidth - COLUMN_PADDING * 2;
    }

    const colHeight = cardY + COLUMN_PADDING;
    maxColumnHeight = Math.max(maxColumnHeight, colHeight);

    columnLayouts.push({
      x: 0, // set below
      y: startY,
      width: colWidth,
      height: colHeight,
      column: col,
      cardLayouts,
    });
  }

  // Normalize column heights and compute x positions
  let currentX = DIAGRAM_PADDING;
  for (const cl of columnLayouts) {
    cl.x = currentX;
    cl.height = maxColumnHeight;
    currentX += cl.width + COLUMN_GAP;
  }

  const totalWidth = currentX - COLUMN_GAP + DIAGRAM_PADDING;
  const totalHeight = startY + maxColumnHeight + DIAGRAM_PADDING;

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
  _onNavigateToLine?: (line: number) => void,
  exportDims?: { width: number; height: number },
  activeTagGroup?: string | null
): void {
  const layout = computeLayout(parsed, palette);

  const width = exportDims?.width ?? layout.totalWidth;
  const height = exportDims?.height ?? layout.totalHeight;

  container.innerHTML = '';

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .attr('font-family', FONT_FAMILY)
    .style('background', palette.bg);

  // Title
  if (parsed.title) {
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

  // Legend (top-right, inline with title)
  if (parsed.tagGroups.length > 0) {
    const titleTextWidth = parsed.title
      ? measureLegendText(parsed.title, TITLE_FONT_SIZE) + 16
      : 0;
    const legendX = DIAGRAM_PADDING + titleTextWidth;
    const legendY = DIAGRAM_PADDING + (TITLE_FONT_SIZE - LEGEND_HEIGHT) / 2;
    const legendConfig: LegendConfig = {
      groups: parsed.tagGroups,
      position: { placement: 'top-center', titleRelation: 'inline-with-title' },
      mode: exportDims ? 'inline' : 'fixed',
    };
    const legendState: LegendState = { activeGroup: activeTagGroup ?? null };
    const legendG = svg
      .append('g')
      .attr('class', 'kanban-legend')
      .attr('transform', `translate(${legendX},${legendY})`);
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      palette,
      isDark,
      undefined,
      width - legendX - DIAGRAM_PADDING
    );
  }

  // Columns
  const defaultColBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);
  const defaultColHeaderBg = isDark
    ? mix(palette.surface, palette.bg, 70)
    : mix(palette.surface, palette.bg, 50);

  const cardBaseBg = isDark ? palette.surface : palette.bg;

  for (const colLayout of layout.columns) {
    const col = colLayout.column;
    const g = svg
      .append('g')
      .attr('class', 'kanban-column')
      .attr('data-column-id', col.id)
      .attr('data-line-number', col.lineNumber);

    // Column body: always neutral
    const thisColBg = defaultColBg;
    // Column header: tinted if column has explicit color
    const thisColHeaderBg = col.color
      ? mix(col.color, palette.bg, 25)
      : defaultColHeaderBg;

    // Column background
    g.append('rect')
      .attr('x', colLayout.x)
      .attr('y', colLayout.y)
      .attr('width', colLayout.width)
      .attr('height', colLayout.height)
      .attr('rx', COLUMN_RADIUS)
      .attr('fill', thisColBg);

    // Column header background
    g.append('rect')
      .attr('x', colLayout.x)
      .attr('y', colLayout.y)
      .attr('width', colLayout.width)
      .attr('height', COLUMN_HEADER_HEIGHT)
      .attr('rx', COLUMN_HEADER_RADIUS)
      .attr('fill', thisColHeaderBg);

    // Column title
    g.append('text')
      .attr('x', colLayout.x + COLUMN_PADDING)
      .attr(
        'y',
        colLayout.y + COLUMN_HEADER_HEIGHT / 2 + COLUMN_HEADER_FONT_SIZE / 2 - 2
      )
      .attr('font-size', COLUMN_HEADER_FONT_SIZE)
      .attr('font-weight', 'bold')
      .attr('fill', palette.text)
      .text(col.name);

    // WIP limit badge
    if (col.wipLimit != null) {
      const wipExceeded = col.cards.length > col.wipLimit;
      const badgeText = `${col.cards.length}/${col.wipLimit}`;
      const nameWidth = col.name.length * COLUMN_HEADER_FONT_SIZE * 0.65;
      g.append('text')
        .attr('x', colLayout.x + COLUMN_PADDING + nameWidth + 8)
        .attr(
          'y',
          colLayout.y + COLUMN_HEADER_HEIGHT / 2 + WIP_FONT_SIZE / 2 - 1
        )
        .attr('font-size', WIP_FONT_SIZE)
        .attr('fill', wipExceeded ? palette.colors.red : palette.textMuted)
        .attr('font-weight', wipExceeded ? 'bold' : 'normal')
        .text(badgeText);
    }

    // Cards
    for (const cardLayout of colLayout.cardLayouts) {
      const card = cardLayout.card;
      const resolvedColor = resolveCardTagColor(
        card,
        parsed.tagGroups,
        activeTagGroup ?? null
      );
      const tagMeta = resolveCardTagMeta(card, parsed.tagGroups);
      const hasMeta = tagMeta.length > 0 || card.details.length > 0;

      // Org-chart-style fill: 15% blend of color into bg
      const cardFill = resolvedColor
        ? mix(resolvedColor, cardBaseBg, 15)
        : mix(palette.primary, cardBaseBg, 15);
      const cardStroke = resolvedColor ?? palette.textMuted;

      const cg = g
        .append('g')
        .attr('class', 'kanban-card')
        .attr('data-card-id', card.id)
        .attr('data-line-number', card.lineNumber);

      // Expose active tag group value for legend-entry hover dimming
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

      // Card background
      cg.append('rect')
        .attr('x', cx)
        .attr('y', cy)
        .attr('width', cardLayout.width)
        .attr('height', cardLayout.height)
        .attr('rx', CARD_RADIUS)
        .attr('fill', cardFill)
        .attr('stroke', cardStroke)
        .attr('stroke-width', CARD_STROKE_WIDTH);

      // Card title (inline markdown)
      const titleEl = cg
        .append('text')
        .attr('x', cx + CARD_PADDING_X)
        .attr('y', cy + CARD_PADDING_Y + CARD_TITLE_FONT_SIZE)
        .attr('font-size', CARD_TITLE_FONT_SIZE)
        .attr('font-weight', '500')
        .attr('fill', palette.text);
      renderInlineText(titleEl, card.title, palette, CARD_TITLE_FONT_SIZE);

      // Separator + metadata
      if (hasMeta) {
        const separatorY = cy + CARD_HEADER_HEIGHT;

        cg.append('line')
          .attr('x1', cx)
          .attr('y1', separatorY)
          .attr('x2', cx + cardLayout.width)
          .attr('y2', separatorY)
          .attr('stroke', cardStroke)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);

        let metaY = separatorY + CARD_SEPARATOR_GAP + CARD_META_FONT_SIZE;

        // Tag metadata rows
        for (const meta of tagMeta) {
          cg.append('text')
            .attr('x', cx + CARD_PADDING_X)
            .attr('y', metaY)
            .attr('font-size', CARD_META_FONT_SIZE)
            .attr('fill', palette.textMuted)
            .text(`${meta.label}: `);

          const labelWidth =
            (meta.label.length + 2) * CARD_META_FONT_SIZE * 0.6;
          cg.append('text')
            .attr('x', cx + CARD_PADDING_X + labelWidth)
            .attr('y', metaY)
            .attr('font-size', CARD_META_FONT_SIZE)
            .attr('fill', palette.text)
            .text(meta.value);

          metaY += CARD_META_LINE_HEIGHT;
        }

        // Detail lines (inline markdown)
        for (const detail of card.details) {
          const detailEl = cg
            .append('text')
            .attr('x', cx + CARD_PADDING_X)
            .attr('y', metaY)
            .attr('font-size', CARD_META_FONT_SIZE)
            .attr('fill', palette.textMuted);
          renderInlineText(detailEl, detail, palette, CARD_META_FONT_SIZE);

          metaY += CARD_META_LINE_HEIGHT;
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
  renderKanban(container, parsed, palette, isDark, undefined, {
    width: layout.totalWidth,
    height: layout.totalHeight,
  });

  const svgEl = container.querySelector('svg');
  return svgEl?.outerHTML ?? '';
}
