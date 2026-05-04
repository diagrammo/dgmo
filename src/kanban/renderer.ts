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
import { renderLegendD3 } from '../utils/legend-d3';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
  D3Sel,
} from '../utils/legend-types';

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
  tagGroups: KanbanTagGroup[],
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
  _palette: PaletteColors,
  collapsedColumns?: Set<string>,
  hiddenMetaGroups?: string[]
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
    const isCollapsed = collapsedColumns?.has(col.id) ?? false;

    if (isCollapsed) {
      columnLayouts.push({
        x: 0,
        y: startY,
        width: COLLAPSED_COLUMN_WIDTH,
        height: 0, // normalized below
        column: col,
        cardLayouts: [],
      });
      continue;
    }

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
      const tagMeta = resolveCardTagMeta(
        card,
        parsed.tagGroups,
        hiddenMetaGroups
      );
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
  options?: KanbanInteractiveOptions
): void {
  const exportDims = options?.exportDims;
  const activeTagGroup = options?.activeTagGroup ?? null;
  const onSwimlaneChange = options?.onSwimlaneChange;
  const collapsedLanes = options?.collapsedLanes;
  const collapsedColumns = options?.collapsedColumns;
  const compactMeta = options?.compactMeta ?? false;
  const solid = parsed.options['solid-fill'] === 'on';
  // Resolve current swimlane group: must match an existing tag group, else ignore.
  const requestedSwimlane = options?.currentSwimlaneGroup ?? null;
  const swimlaneGroup = requestedSwimlane
    ? (parsed.tagGroups.find(
        (g) => g.name.toLowerCase() === requestedSwimlane.toLowerCase()
      ) ?? null)
    : null;

  // Compute hidden meta groups for compact mode
  const hiddenMetaGroups: string[] = [];
  if (compactMeta) {
    if (activeTagGroup) hiddenMetaGroups.push(activeTagGroup.toLowerCase());
    if (requestedSwimlane)
      hiddenMetaGroups.push(requestedSwimlane.toLowerCase());
  }

  const layout = computeLayout(
    parsed,
    palette,
    collapsedColumns,
    hiddenMetaGroups
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

    // Only show ≡ swimlane icons in interactive contexts (callback present
    // and not exporting). Static SVG/PNG exports get no icon.
    const showSwimlaneIcon = !!onSwimlaneChange && !exportDims;

    const legendCallbacks: LegendCallbacks | undefined = showSwimlaneIcon
      ? {
          onGroupRendered: (groupName, groupEl, isActive) => {
            const isCurrent =
              swimlaneGroup?.name.toLowerCase() === groupName.toLowerCase();
            // Position icon at the trailing edge of the pill text.
            // For collapsed pills, the groupEl is at (pill.x, pill.y) and the
            // pill rect spans pill.width. For active capsule, the groupEl is at
            // (capsule.x, capsule.y) and the inner pill is offset.
            // We measure text and place the icon just to the right of it.
            const textW = measureLegendText(groupName, 11);
            const iconX = isActive
              ? 4 + 6 + textW + 6 // capsule pad + pill pad/2 + text + gap
              : 8 + textW + 4; // pill pad/2 + text + gap
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
      width - legendX - DIAGRAM_PADDING
    );
  }

  // Swimlane mode: bucket cards into (column, lane) cells and render grid
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
      hiddenMetaGroups
    );
    return;
  }

  // Columns
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

    // Column body: always neutral
    const thisColBg = defaultColBg;
    // Column header: tinted if column has explicit color (or full intent when solid-fill is on)
    const thisColHeaderBg = col.color
      ? shapeFill(palette, col.color, isDark, { solid })
      : defaultColHeaderBg;
    // Header text must contrast against the header bg, not against the chart bg.
    // Without this, a solid-yellow "In Progress" header with `palette.text` (white
    // in dark mode) gives white-on-yellow — unreadable.
    const onHeaderText = col.color
      ? contrastText(
          thisColHeaderBg,
          palette.textOnFillLight,
          palette.textOnFillDark
        )
      : palette.text;

    if (isColCollapsed) {
      // Collapsed column: narrow strip with count + vertical name
      g.append('rect')
        .attr('x', colLayout.x)
        .attr('y', colLayout.y)
        .attr('width', COLLAPSED_COLUMN_WIDTH)
        .attr('height', colLayout.height)
        .attr('rx', COLUMN_RADIUS)
        .attr('fill', thisColBg);

      g.append('rect')
        .attr('x', colLayout.x)
        .attr('y', colLayout.y)
        .attr('width', COLLAPSED_COLUMN_WIDTH)
        .attr('height', COLUMN_HEADER_HEIGHT)
        .attr('rx', COLUMN_HEADER_RADIUS)
        .attr('fill', thisColHeaderBg);

      // Card count — count sits on the header bg, vertical name sits on the
      // body bg below. Contrast against header for the count.
      g.append('text')
        .attr('x', colLayout.x + COLLAPSED_COLUMN_WIDTH / 2)
        .attr(
          'y',
          colLayout.y + COLUMN_HEADER_HEIGHT / 2 + WIP_FONT_SIZE / 2 - 1
        )
        .attr('font-size', WIP_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('fill', col.color ? onHeaderText : palette.textMuted)
        .attr('text-anchor', 'middle')
        .text(String(col.cards.length));

      // Vertical column name (sits on body bg below the header — palette.text fine)
      g.append('text')
        .attr('x', colLayout.x + COLLAPSED_COLUMN_WIDTH / 2)
        .attr('y', colLayout.y + COLUMN_HEADER_HEIGHT + COLUMN_PADDING)
        .attr('font-size', CARD_TITLE_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .attr('text-anchor', 'middle')
        .attr('writing-mode', 'tb')
        .text(col.name);

      continue;
    }

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

    // Column title — must contrast against the (possibly solid) header bg.
    g.append('text')
      .attr('x', colLayout.x + COLUMN_PADDING)
      .attr(
        'y',
        colLayout.y + COLUMN_HEADER_HEIGHT / 2 + COLUMN_HEADER_FONT_SIZE / 2 - 2
      )
      .attr('font-size', COLUMN_HEADER_FONT_SIZE)
      .attr('font-weight', 'bold')
      .attr('fill', onHeaderText)
      .text(col.name);

    // Card count / WIP limit badge (right-aligned)
    {
      const wipExceeded =
        col.wipLimit != null && col.cards.length > col.wipLimit;
      const badgeText =
        col.wipLimit != null
          ? `${col.cards.length}/${col.wipLimit}`
          : String(col.cards.length);
      g.append('text')
        .attr('x', colLayout.x + colLayout.width - COLUMN_PADDING)
        .attr(
          'y',
          colLayout.y + COLUMN_HEADER_HEIGHT / 2 + WIP_FONT_SIZE / 2 - 1
        )
        .attr('text-anchor', 'end')
        .attr('font-size', WIP_FONT_SIZE)
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

    // Cards
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

      // Canonical 25% tint via shapeFill() (or full intent when solid-fill is on)
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

      // Card title (inline markdown) — contrast against card fill
      const titleEl = cg
        .append('text')
        .attr('x', cx + CARD_PADDING_X)
        .attr('y', cy + CARD_PADDING_Y + CARD_TITLE_FONT_SIZE)
        .attr('font-size', CARD_TITLE_FONT_SIZE)
        .attr('font-weight', '500')
        .attr('fill', onCardText);
      renderInlineText(titleEl, card.title, palette, CARD_TITLE_FONT_SIZE);

      // Separator + metadata
      if (hasMeta) {
        const separatorY = cy + CARD_HEADER_HEIGHT;

        cg.append('line')
          .attr('x1', cx)
          .attr('y1', separatorY)
          .attr('x2', cx + cardLayout.width)
          .attr('y2', separatorY)
          .attr('stroke', solid ? onCardText : cardStroke)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);

        let metaY = separatorY + CARD_SEPARATOR_GAP + CARD_META_FONT_SIZE;

        // Tag metadata rows
        for (const meta of tagMeta) {
          cg.append('text')
            .attr('x', cx + CARD_PADDING_X)
            .attr('y', metaY)
            .attr('font-size', CARD_META_FONT_SIZE)
            .attr('fill', onCardText)
            .text(`${meta.label}: `);

          const labelWidth =
            (meta.label.length + 2) * CARD_META_FONT_SIZE * 0.6;
          cg.append('text')
            .attr('x', cx + CARD_PADDING_X + labelWidth)
            .attr('y', metaY)
            .attr('font-size', CARD_META_FONT_SIZE)
            .attr('fill', onCardText)
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
            .attr('fill', onCardText);
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
  renderKanban(container, parsed, palette, isDark, {
    exportDims: { width: layout.totalWidth, height: layout.totalHeight },
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
  tagGroups: KanbanTagGroup[],
  hiddenMetaGroups?: string[]
) {
  const tagMeta = resolveCardTagMeta(card, tagGroups, hiddenMetaGroups);
  const metaCount = tagMeta.length + card.details.length;
  const metaHeight =
    metaCount > 0
      ? CARD_SEPARATOR_GAP +
        1 +
        CARD_PADDING_Y +
        metaCount * CARD_META_LINE_HEIGHT
      : 0;
  return CARD_HEADER_HEIGHT + CARD_PADDING_Y + metaHeight;
}

function computeSwimlaneLayout(
  parsed: ParsedKanban,
  buckets: SwimlaneBucket[],
  baseLayout: { columns: ColumnLayout[] },
  collapsedLanes?: Set<string>,
  collapsedColumns?: Set<string>,
  hiddenMetaGroups?: string[]
): SwimlaneBoardLayout {
  const headerHeight = parsed.title ? TITLE_HEIGHT + 8 : 0;
  const startY = DIAGRAM_PADDING + headerHeight;

  // Column x positions: shift right by LANE_HEADER_WIDTH, reuse widths from base layout.
  const columnXs: SwimlaneBoardLayout['columnXs'] = [];
  let currentX = DIAGRAM_PADDING + LANE_HEADER_WIDTH;
  for (const col of baseLayout.columns) {
    const isColCollapsed = collapsedColumns?.has(col.column.id) ?? false;
    const w = isColCollapsed ? COLLAPSED_COLUMN_WIDTH : col.width;
    columnXs.push({ column: col.column, x: currentX, width: w });
    currentX += w + COLUMN_GAP;
  }
  const totalWidth = currentX - COLUMN_GAP + DIAGRAM_PADDING;

  // For each lane, compute card stacks per column and normalize the lane height.
  const lanes: SwimlaneLaneLayout[] = [];
  let laneY = startY + COLUMN_HEADER_HEIGHT + COLUMN_PADDING;
  const minCellH = CARD_HEADER_HEIGHT + CARD_PADDING_Y + CARD_GAP;

  for (const bucket of buckets) {
    const isLaneCollapsed = collapsedLanes?.has(bucket.laneName) ?? false;

    if (isLaneCollapsed) {
      // Collapsed lane: minimal height, no card layouts
      const cells: SwimlaneCellLayout[] = columnXs.map((colInfo) => ({
        column: colInfo.column,
        cards: bucket.cellsByColumn[colInfo.column.id] ?? [],
        cardLayouts: [],
      }));
      lanes.push({ bucket, y: laneY, height: COLLAPSED_LANE_HEIGHT, cells });
      laneY += COLLAPSED_LANE_HEIGHT + LANE_GAP;
      continue;
    }

    let maxCellH = minCellH;
    const cellsTmp: { column: KanbanColumn; cards: KanbanCard[]; h: number }[] =
      [];

    for (const colInfo of columnXs) {
      const isColCollapsed = collapsedColumns?.has(colInfo.column.id) ?? false;
      const cards = bucket.cellsByColumn[colInfo.column.id] ?? [];
      if (isColCollapsed) {
        // Collapsed column cells get minimal height
        cellsTmp.push({ column: colInfo.column, cards, h: 0 });
        continue;
      }
      let h = 0;
      for (const c of cards) {
        h +=
          computeCardHeight(c, parsed.tagGroups, hiddenMetaGroups) + CARD_GAP;
      }
      h = Math.max(h - (cards.length > 0 ? CARD_GAP : 0), 0);
      cellsTmp.push({ column: colInfo.column, cards, h });
      if (h > maxCellH) maxCellH = h;
    }

    const laneHeight = Math.max(maxCellH, minCellH);

    // Build cell layouts with card x/y offsets relative to (cell.x, laneY)
    const cells: SwimlaneCellLayout[] = cellsTmp.map((tmp, i) => {
      const colInfo = columnXs[i]!;
      const isColCollapsed = collapsedColumns?.has(colInfo.column.id) ?? false;
      if (isColCollapsed) {
        return { column: tmp.column, cards: tmp.cards, cardLayouts: [] };
      }
      const cardLayouts: CardLayout[] = [];
      let cy = 0;
      for (const card of tmp.cards) {
        const ch = computeCardHeight(card, parsed.tagGroups, hiddenMetaGroups);
        cardLayouts.push({
          x: colInfo.x + COLUMN_PADDING,
          y: laneY + cy,
          width: colInfo.width - COLUMN_PADDING * 2,
          height: ch,
          card,
        });
        cy += ch + CARD_GAP;
      }
      return { column: tmp.column, cards: tmp.cards, cardLayouts };
    });

    lanes.push({ bucket, y: laneY, height: laneHeight, cells });
    laneY += laneHeight + LANE_GAP;
  }

  const totalHeight = laneY - LANE_GAP + COLUMN_PADDING + DIAGRAM_PADDING;

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
  hiddenMetaGroups?: string[]
): void {
  const visibleColumns = parsed.columns.filter((c) => !isArchiveColumn(c.name));
  const buckets = bucketCardsBySwimlane(visibleColumns, swimlaneGroup);
  const grid = computeSwimlaneLayout(
    parsed,
    buckets,
    baseLayout,
    collapsedLanes,
    collapsedColumns,
    hiddenMetaGroups
  );

  // Resize the svg to fit the grid (only when not using exportDims).
  const currentW = parseFloat(svg.attr('width') || '0');
  const currentH = parseFloat(svg.attr('height') || '0');
  if (grid.totalWidth > currentW) svg.attr('width', grid.totalWidth);
  if (grid.totalHeight > currentH) svg.attr('height', grid.totalHeight);

  const defaultColBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);
  const defaultColHeaderBg = isDark
    ? mix(palette.surface, palette.bg, 70)
    : mix(palette.surface, palette.bg, 50);

  // Column header row spanning all lanes
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
      .attr('height', COLUMN_HEADER_HEIGHT)
      .attr('rx', COLUMN_HEADER_RADIUS)
      .attr('fill', colHeaderBg);

    if (isColCollapsed) {
      // Collapsed: show count + vertical name below header
      headerG
        .append('text')
        .attr('x', colInfo.x + colInfo.width / 2)
        .attr(
          'y',
          grid.startY + COLUMN_HEADER_HEIGHT / 2 + WIP_FONT_SIZE / 2 - 1
        )
        .attr('font-size', WIP_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('fill', palette.textMuted)
        .attr('text-anchor', 'middle')
        .text(String(col.cards.length));
    } else {
      headerG
        .append('text')
        .attr('x', colInfo.x + COLUMN_PADDING)
        .attr(
          'y',
          grid.startY +
            COLUMN_HEADER_HEIGHT / 2 +
            COLUMN_HEADER_FONT_SIZE / 2 -
            2
        )
        .attr('font-size', COLUMN_HEADER_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .text(col.name);

      // Card count (right-aligned)
      const wipExceeded =
        col.wipLimit != null && col.cards.length > col.wipLimit;
      const badgeText =
        col.wipLimit != null
          ? `${col.cards.length}/${col.wipLimit}`
          : String(col.cards.length);
      headerG
        .append('text')
        .attr('x', colInfo.x + colInfo.width - COLUMN_PADDING)
        .attr(
          'y',
          grid.startY + COLUMN_HEADER_HEIGHT / 2 + WIP_FONT_SIZE / 2 - 1
        )
        .attr('text-anchor', 'end')
        .attr('font-size', WIP_FONT_SIZE)
        .attr('fill', wipExceeded ? palette.colors.red : palette.textMuted)
        .attr('font-weight', wipExceeded ? 'bold' : 'normal')
        .text(badgeText);
    }
  }

  // Lanes
  for (const lane of grid.lanes) {
    const isLaneCollapsed = collapsedLanes?.has(lane.bucket.laneName) ?? false;
    const laneG = svg
      .append('g')
      .attr('class', 'kanban-lane')
      .attr('data-lane-name', lane.bucket.laneName);

    // Lane header on the left edge
    const headerG = laneG
      .append('g')
      .attr('class', 'kanban-lane-header')
      .attr(
        'transform',
        `translate(${DIAGRAM_PADDING}, ${lane.y - COLUMN_PADDING})`
      );

    // Background band spanning the row
    headerG
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', LANE_HEADER_WIDTH - 8)
      .attr('height', lane.height + COLUMN_PADDING * 2)
      .attr('rx', COLUMN_RADIUS)
      .attr('fill', defaultColBg);

    // Lane label + count
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
      // Collapsed: single line with name + count
      headerG
        .append('text')
        .attr('x', labelX)
        .attr('y', 20)
        .attr('font-size', 10)
        .attr('fill', palette.textMuted)
        .text(`${lane.bucket.laneName} (${totalCards})`);
    } else {
      // Expanded: name only (count omitted to match app view)
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
      // Render count placeholders in each cell
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
            ? COLLAPSED_COLUMN_WIDTH - 8
            : colInfo.width - COLUMN_PADDING * 2;
          laneG
            .append('rect')
            .attr('x', colInfo.x + (isColCollapsed ? 4 : COLUMN_PADDING))
            .attr('y', lane.y)
            .attr('width', pw)
            .attr('height', 18)
            .attr('rx', 4)
            .attr('fill', placeholderBg);
          laneG
            .append('text')
            .attr(
              'x',
              colInfo.x + (isColCollapsed ? 4 : COLUMN_PADDING) + pw / 2
            )
            .attr('y', lane.y + 13)
            .attr('font-size', WIP_FONT_SIZE)
            .attr('font-weight', 'bold')
            .attr('fill', palette.textMuted)
            .attr('text-anchor', 'middle')
            .text(String(cell.cards.length));
        }
      }
    }

    // Lane divider line below the row
    laneG
      .append('line')
      .attr('x1', DIAGRAM_PADDING + LANE_HEADER_WIDTH)
      .attr('x2', grid.totalWidth - DIAGRAM_PADDING)
      .attr('y1', lane.y + lane.height + COLUMN_PADDING)
      .attr('y2', lane.y + lane.height + COLUMN_PADDING)
      .attr('stroke', palette.border ?? palette.textMuted)
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1);

    // Cards inside cells (skip for collapsed lanes — they show count placeholders instead)
    if (!isLaneCollapsed) {
      for (const cell of lane.cells) {
        const isColCollapsed = collapsedColumns?.has(cell.column.id) ?? false;
        if (isColCollapsed && cell.cards.length > 0) {
          // Collapsed column in non-collapsed lane: show count placeholder
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
              .attr('width', COLLAPSED_COLUMN_WIDTH - 8)
              .attr('height', 22)
              .attr('rx', 4)
              .attr('fill', placeholderBg);
            laneG
              .append('text')
              .attr('x', colInfo.x + COLLAPSED_COLUMN_WIDTH / 2)
              .attr('y', lane.y + 16)
              .attr('font-size', WIP_FONT_SIZE)
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
            parsed.options['solid-fill'] === 'on'
          );
        }
      }
    }
  }
}

function renderSwimlaneCard(
  parent: D3Sel,
  cardLayout: CardLayout,
  tagGroups: KanbanTagGroup[],
  activeTagGroup: string | null,
  palette: PaletteColors,
  isDark: boolean,
  hiddenMetaGroups?: string[],
  solid?: boolean
): void {
  const card = cardLayout.card;
  const resolvedColor = resolveCardTagColor(card, tagGroups, activeTagGroup);
  const tagMeta = resolveCardTagMeta(card, tagGroups, hiddenMetaGroups);
  const hasMeta = tagMeta.length > 0 || card.details.length > 0;

  // Canonical 25% tint via shapeFill() (or full intent when solid-fill is on)
  const cardFill = shapeFill(
    palette,
    resolvedColor ?? palette.primary,
    isDark,
    {
      solid,
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
    .attr('rx', CARD_RADIUS)
    .attr('fill', cardFill)
    .attr('stroke', cardStroke)
    .attr('stroke-width', CARD_STROKE_WIDTH);

  const titleEl = cg
    .append('text')
    .attr('x', cx + CARD_PADDING_X)
    .attr('y', cy + CARD_PADDING_Y + CARD_TITLE_FONT_SIZE)
    .attr('font-size', CARD_TITLE_FONT_SIZE)
    .attr('font-weight', '500')
    .attr('fill', onCardText);
  renderInlineText(titleEl, card.title, palette, CARD_TITLE_FONT_SIZE);

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

    for (const meta of tagMeta) {
      cg.append('text')
        .attr('x', cx + CARD_PADDING_X)
        .attr('y', metaY)
        .attr('font-size', CARD_META_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(`${meta.label}: `);
      const labelWidth = (meta.label.length + 2) * CARD_META_FONT_SIZE * 0.6;
      cg.append('text')
        .attr('x', cx + CARD_PADDING_X + labelWidth)
        .attr('y', metaY)
        .attr('font-size', CARD_META_FONT_SIZE)
        .attr('fill', onCardText)
        .text(meta.value);
      metaY += CARD_META_LINE_HEIGHT;
    }

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
