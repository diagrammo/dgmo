// ============================================================
// Ownership chart renderer — entity structure, top down (#1873)
// ============================================================
//
// A rounded rectangle for a corporation, a triangle for a partnership, an
// oval for an individual, a double-outlined rectangle for a trust. Each shape
// shows the name in bold, "jurisdiction · type" (no type on a triangle) and
// the first description line in italics. Outside owners draw outline-only and
// dashed. Every line carries its stake in a pill on its own last vertical,
// with an arrowhead into the owned entity. The title row has the title on the
// left, the legend capsule on the right and, under it, a key of the shapes the
// chart uses.
//
// On screen, hovering or focusing an entity keeps its chain of owners lit and
// dims the rest; its card shows effective ownership summed across paths.
// Hovering a line keeps the line and its two ends lit. Tab walks the entities
// in tree order and Enter opens the card. An export carries aria-labels and
// data attributes but no listeners.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import { growChartFrame } from '../utils/chart-frame';
import type { ChartFrame } from '../utils/chart-frame-parse';
import { createTooltip, hideTooltip, showTooltip } from '../utils/d3-helpers';
import { DEFAULT_DIM_OPACITY } from '../utils/hover-styles';
import { renderInlineText } from '../utils/inline-markdown';
import { LEGEND_HEIGHT, legendInkBottom } from '../utils/legend-constants';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  getLegendExtent,
  getMaxLegendReservedHeight,
} from '../utils/legend-layout';
import type { LegendConfig } from '../utils/legend-types';
import { fillModeFromOptions, legendSuppressed } from '../utils/parsing';
import {
  resolveTagColor,
  tagAttrKey,
  UNTAGGED_TAG_COLOR,
} from '../utils/tag-groups';
import { measureText } from '../utils/text-measure';
import {
  FRAME_BODY_TOP,
  LEGEND_BODY_GAP,
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { ownerChain } from './effective';
import { entityAriaLabel, entityCardHtml, linkCardHtml } from './format';
import {
  ARROW_SIZE,
  DESC_FONT_SIZE,
  layoutOwnership,
  NAME_FONT_SIZE,
  NAME_LINE_HEIGHT,
  PILL_FONT_SIZE,
  PILL_HEIGHT,
  shapeOf,
  SUB_FONT_SIZE,
  SUB_LINE_HEIGHT,
  TYPE_LABELS,
} from './layout';
import type { EntityShape, LayoutEntity } from './layout';
import { ENTITY_TYPES } from './types';
import type { ParsedOwnership } from './types';

export interface OwnershipRenderOptions {
  activeTagGroup?: string | null;
  exportMode?: boolean;
}

const DIAGRAM_PADDING = 20;
const TITLE_LEGEND_GAP = 16;
const KEY_TOP_GAP = 6;
const KEY_ROW_HEIGHT = 14;
const KEY_ICON_W = 16;
const KEY_ICON_GAP = 5;
const KEY_ITEM_GAP = 16;
const KEY_FONT_SIZE = 10;
const RADIUS = 8;
const STROKE_WIDTH = 1.3;
const EDGE_WIDTH = 1.4;
const TRIANGLE_TEXT_BOTTOM = 7;
const TRUST_INSET = 3;

export function renderOwnership(
  container: HTMLElement,
  parsed: ParsedOwnership,
  palette: PaletteColors,
  isDark: boolean,
  options?: OwnershipRenderOptions
): void {
  const exportMode = options?.exportMode ?? false;
  const activeTagGroup = options?.activeTagGroup ?? null;
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const showLegend =
    parsed.tagGroups.length > 0 && !legendSuppressed(parsed.options);
  const layout = layoutOwnership(parsed);
  const usedTypes = ENTITY_TYPES.filter((t) =>
    parsed.entities.some((e) => e.type === t)
  );
  const showKey = usedTypes.some((t) => t !== 'corporation');

  // ── Header: title left; legend and shape key right ─────────
  const titleWidth = showTitle
    ? measureText(parsed.title, TITLE_FONT_SIZE, { bold: true })
    : 0;
  const legendConfig: LegendConfig = {
    groups: parsed.tagGroups,
    position: { placement: 'top-center', titleRelation: 'inline-with-title' },
    mode: exportMode ? 'export' : 'preview',
    showInactivePills: true,
  };
  const legendNatural = showLegend
    ? getLegendExtent(legendConfig, { activeGroup: activeTagGroup }, 4000).width
    : 0;
  const keyItems = usedTypes.map((t) => ({
    type: t,
    label: TYPE_LABELS[t],
    width:
      KEY_ICON_W + KEY_ICON_GAP + measureText(TYPE_LABELS[t], KEY_FONT_SIZE),
  }));
  const keyWidth = showKey
    ? keyItems.reduce((s, k) => s + k.width, 0) +
      KEY_ITEM_GAP * (keyItems.length - 1)
    : 0;
  const headerWidth =
    (showTitle ? titleWidth + TITLE_LEGEND_GAP : 0) +
    Math.max(legendNatural, keyWidth);
  const width = Math.ceil(
    2 * DIAGRAM_PADDING + Math.max(layout.width, headerWidth)
  );
  const legendX =
    DIAGRAM_PADDING + (showTitle ? titleWidth + TITLE_LEGEND_GAP : 0);
  const legendWidth = Math.max(
    legendNatural,
    width - legendX - DIAGRAM_PADDING
  );
  const legendHeight = showLegend
    ? getMaxLegendReservedHeight(legendConfig, legendWidth)
    : 0;
  // Centre the FIRST row on the title row; extra rows of an expanded group
  // grow downward (legendInkBottom). Centring the full reserved height put a
  // wrapped legend above the page beside a long title (#2103).
  const legendY =
    TITLE_Y - TITLE_FONT_SIZE + (TITLE_FONT_SIZE - LEGEND_HEIGHT) / 2;
  const legendBottom = showLegend ? legendY + legendInkBottom(legendHeight) : 0;
  // Under the legend; with no legend, on the title row itself.
  const keyTop = showLegend
    ? legendBottom + KEY_TOP_GAP
    : showTitle
      ? TITLE_Y - KEY_ROW_HEIGHT + 3
      : DIAGRAM_PADDING;
  const headerBottom = Math.max(
    showLegend ? legendBottom + LEGEND_BODY_GAP : 0,
    showKey ? keyTop + KEY_ROW_HEIGHT + LEGEND_BODY_GAP : 0,
    showTitle ? FRAME_BODY_TOP : DIAGRAM_PADDING
  );
  const bodyTop = headerBottom;
  const bodyLeft =
    DIAGRAM_PADDING + (width - 2 * DIAGRAM_PADDING - layout.width) / 2;
  const height = Math.ceil(bodyTop + layout.height + DIAGRAM_PADDING);

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
      .attr('y', TITLE_Y)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(parsed.title);
  }

  // The legend sits right unless the author aligned it.
  const legendFrame: ChartFrame = {
    ...parsed.frame,
    align: {
      lineNumbers: [],
      ...parsed.frame?.align,
      legend:
        parsed.frame?.align?.legend ?? parsed.frame?.align?.all ?? 'right',
    },
  };
  // The legend and the shape key are one header block: the drawing starts
  // LEGEND_BODY_GAP under whichever ends lower.
  const header = svg
    .append('g')
    .attr(
      'class',
      showLegend ? 'ownership-header chart-legend' : 'ownership-header'
    )
    .attr('data-frame-part', '');
  if (showLegend) {
    const legendG = header
      .append('g')
      .attr('class', 'ownership-legend')
      .attr('transform', `translate(${legendX},${legendY})`);
    renderIntegratedLegend(legendG, {
      frame: legendFrame,
      ...legendConfig,
      palette,
      isDark,
      width: legendWidth,
      activeGroup: activeTagGroup,
    });
  }

  const ink = palette.textMuted;
  const neutral = palette.textMuted;
  if (showKey) {
    const keyG = header
      .append('g')
      .attr('class', 'ownership-shape-key')
      .attr(
        'transform',
        `translate(${width - DIAGRAM_PADDING - keyWidth},${keyTop})`
      );
    let x = 0;
    for (const item of keyItems) {
      drawShape(
        keyG,
        shapeOf(item.type),
        x + KEY_ICON_W / 2,
        1,
        KEY_ICON_W,
        11,
        palette.bg,
        ink,
        1,
        false,
        2
      );
      keyG
        .append('text')
        .attr('x', x + KEY_ICON_W + KEY_ICON_GAP)
        .attr('y', 10)
        .attr('font-size', KEY_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(item.label);
      x += item.width + KEY_ITEM_GAP;
    }
  }

  const body = svg
    .append('g')
    .attr('class', 'ownership-body')
    .attr('transform', `translate(${bodyLeft},${bodyTop})`);

  // ── Lines ───────────────────────────────────────────────────
  const edgeColor = isDark ? mix(palette.textMuted, palette.bg, 85) : ink;
  const linkById = new Map(parsed.links.map((l) => [l.id, l]));
  const edgeLayer = body.append('g').attr('class', 'ownership-edges');
  const edgeGroups = new Map<
    string,
    d3Selection.Selection<SVGGElement, unknown, null, undefined>
  >();
  for (const edge of layout.edges) {
    const link = linkById.get(edge.id)!;
    const g = edgeLayer
      .append('g')
      .attr('class', 'ownership-edge')
      .attr('data-link-id', edge.id)
      .attr('data-from', edge.ownerId)
      .attr('data-to', edge.ownedId)
      .attr('data-line-number', link.lineNumber);
    edgeGroups.set(edge.id, g);
    const d = edge.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
      .join(' ');
    g.append('path')
      .attr('class', 'ownership-edge-line')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', edgeColor)
      .attr('stroke-width', EDGE_WIDTH)
      .attr('stroke-dasharray', edge.dashed ? '4 3' : null);
    // Arrowhead into the owned entity: the last point, or the first when the
    // link is drawn against a cycle.
    const tip = edge.reversed
      ? edge.points[0]!
      : edge.points[edge.points.length - 1]!;
    const dir = edge.reversed ? -1 : 1;
    g.append('path')
      .attr('class', 'ownership-edge-arrow')
      .attr(
        'd',
        `M${tip.x - 4} ${tip.y - dir * ARROW_SIZE} L${tip.x} ${tip.y} L${tip.x + 4} ${tip.y - dir * ARROW_SIZE}`
      )
      .attr('fill', 'none')
      .attr('stroke', edgeColor)
      .attr('stroke-width', EDGE_WIDTH);
    const pill = edge.pill;
    g.append('rect')
      .attr('class', 'ownership-pill')
      .attr('x', pill.x - pill.width / 2)
      .attr('y', pill.y - PILL_HEIGHT / 2)
      .attr('width', pill.width)
      .attr('height', PILL_HEIGHT)
      .attr('rx', PILL_HEIGHT / 2)
      .attr('fill', palette.bg)
      .attr('stroke', edgeColor);
    g.append('text')
      .attr('class', 'ownership-pill-text')
      .attr('x', pill.x)
      .attr('y', pill.y)
      .attr('dy', '0.34em')
      .attr('text-anchor', 'middle')
      .attr('font-size', PILL_FONT_SIZE)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text(pill.text);
    g.attr('aria-label', `${pill.text} stake`);
    if (!exportMode) {
      // A wide, invisible stroke so the thin line is easy to hover.
      g.insert('path', ':first-child')
        .attr('class', 'ownership-edge-hit')
        .attr('d', d)
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', 10);
    }
  }

  // ── Entities, in tree order (the Tab order) ─────────────────
  const fillMode = fillModeFromOptions(parsed.options);
  const byId = new Map(layout.entities.map((e) => [e.id, e]));
  const treeOrder: LayoutEntity[] = [];
  const visit = (id: string): void => {
    const le = byId.get(id);
    if (!le || treeOrder.includes(le)) return;
    treeOrder.push(le);
    for (const e of parsed.entities) if (e.treeParentId === id) visit(e.id);
  };
  if (parsed.rootId) visit(parsed.rootId);
  for (const e of parsed.entities) if (e.treeParentId === null) visit(e.id);

  const entityLayer = body.append('g').attr('class', 'ownership-entities');
  const entityGroups = new Map<
    string,
    d3Selection.Selection<SVGGElement, unknown, null, undefined>
  >();
  for (const le of treeOrder) {
    const entity = le.entity;
    const tagColor = resolveTagColor(
      { ...entity.metadata },
      [...parsed.tagGroups],
      activeTagGroup
    );
    const color =
      tagColor && tagColor !== UNTAGGED_TAG_COLOR ? tagColor : neutral;
    const mode = entity.outside ? 'outline' : fillMode;
    const fill = shapeFill(palette, color, isDark, { mode });
    const solid = mode === 'solid';
    const textColor = solid
      ? contrastText(fill, palette.bg, palette.text)
      : palette.text;
    const mutedColor = solid ? textColor : palette.textMuted;

    const g = entityLayer
      .append('g')
      .attr('class', 'ownership-entity')
      .attr('data-node-id', entity.id)
      .attr('data-entity-type', entity.type)
      .attr('data-line-number', entity.lineNumber)
      .attr('aria-label', entityAriaLabel(parsed, entity));
    if (entity.outside) g.attr('data-outside', 'true');
    if (activeTagGroup) {
      const key = tagAttrKey(activeTagGroup);
      const value = entity.metadata[key];
      if (value) g.attr(`data-tag-${key}`, value.toLowerCase());
    }
    entityGroups.set(entity.id, g);

    drawShape(
      g,
      le.shape,
      le.x,
      le.y,
      le.width,
      le.height,
      fill,
      color,
      STROKE_WIDTH,
      entity.outside,
      RADIUS
    );

    // Text block: centred, or near the base of a triangle.
    const lines =
      le.nameLines.length * NAME_LINE_HEIGHT +
      (le.sub ? SUB_LINE_HEIGHT : 0) +
      (le.desc ? SUB_LINE_HEIGHT : 0);
    let ty =
      le.shape === 'triangle'
        ? le.y + le.height - TRIANGLE_TEXT_BOTTOM - lines
        : le.y + (le.height - lines) / 2;
    for (const line of le.nameLines) {
      g.append('text')
        .attr('class', 'ownership-entity-name')
        .attr('x', le.x)
        .attr('y', ty + NAME_LINE_HEIGHT - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', NAME_FONT_SIZE)
        .attr('font-weight', 700)
        .attr('fill', textColor)
        .text(line);
      ty += NAME_LINE_HEIGHT;
    }
    if (le.sub) {
      g.append('text')
        .attr('class', 'ownership-entity-facts')
        .attr('x', le.x)
        .attr('y', ty + SUB_LINE_HEIGHT - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', SUB_FONT_SIZE)
        .attr('fill', mutedColor)
        .text(le.sub);
      ty += SUB_LINE_HEIGHT;
    }
    if (le.desc) {
      const t = g
        .append('text')
        .attr('class', 'ownership-entity-desc')
        .attr('x', le.x)
        .attr('y', ty + SUB_LINE_HEIGHT - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', DESC_FONT_SIZE)
        .attr('font-style', 'italic')
        .attr('fill', mutedColor);
      renderInlineText(t, le.desc, palette, DESC_FONT_SIZE);
    }
  }

  // ── Hover and focus (screen only) ───────────────────────────
  if (!exportMode) {
    const tooltip = createTooltip(container, palette, isDark);
    tooltip.style.whiteSpace = 'normal';
    tooltip.style.maxWidth = '320px';
    const light = (entities: Set<string>, links: Set<string>): void => {
      for (const [id, g] of entityGroups)
        g.attr('opacity', entities.has(id) ? null : DEFAULT_DIM_OPACITY);
      for (const [id, g] of edgeGroups)
        g.attr('opacity', links.has(id) ? null : DEFAULT_DIM_OPACITY);
    };
    const reset = (): void => {
      for (const g of entityGroups.values()) g.attr('opacity', null);
      for (const g of edgeGroups.values()) g.attr('opacity', null);
      hideTooltip(tooltip);
    };
    const at = (el: Element): MouseEvent => {
      const r = el.getBoundingClientRect();
      return { clientX: r.right, clientY: r.top } as MouseEvent;
    };
    for (const le of treeOrder) {
      const g = entityGroups.get(le.id)!;
      const chain = ownerChain(parsed, le.id);
      const html = entityCardHtml(parsed, le.entity);
      g.attr('tabindex', 0)
        .attr('role', 'button')
        .style('cursor', 'default')
        .on('mouseenter', (event: MouseEvent) => {
          light(chain.entities, chain.links);
          showTooltip(tooltip, html, event);
        })
        .on('mousemove', (event: MouseEvent) =>
          showTooltip(tooltip, html, event)
        )
        .on('mouseleave', reset)
        .on('focus', () => light(chain.entities, chain.links))
        .on('keydown', function (this: SVGGElement, event: KeyboardEvent) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            showTooltip(tooltip, html, at(this));
          } else if (event.key === 'Escape') {
            hideTooltip(tooltip);
          }
        })
        .on('blur', reset);
    }
    for (const edge of layout.edges) {
      const g = edgeGroups.get(edge.id)!;
      const link = linkById.get(edge.id)!;
      const html = linkCardHtml(parsed, link);
      const ends = new Set([edge.ownerId, edge.ownedId]);
      const self = new Set([edge.id]);
      g.on('mouseenter', (event: MouseEvent) => {
        light(ends, self);
        showTooltip(tooltip, html, event);
      })
        .on('mousemove', (event: MouseEvent) =>
          showTooltip(tooltip, html, event)
        )
        .on('mouseleave', reset);
    }
  }

  growChartFrame(svg.node(), parsed.frame, palette, { size: 'grow' });
}

function drawShape(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  shape: EntityShape,
  cx: number,
  top: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  dashed: boolean,
  radius: number
): void {
  const dash = dashed ? '5 3' : null;
  const left = cx - width / 2;
  if (shape === 'triangle') {
    g.append('path')
      .attr('class', 'ownership-shape')
      .attr(
        'd',
        `M${cx} ${top} L${left + width} ${top + height} L${left} ${top + height} Z`
      )
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', strokeWidth)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-dasharray', dash);
    return;
  }
  if (shape === 'oval') {
    g.append('ellipse')
      .attr('class', 'ownership-shape')
      .attr('cx', cx)
      .attr('cy', top + height / 2)
      .attr('rx', width / 2)
      .attr('ry', height / 2)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', strokeWidth)
      .attr('stroke-dasharray', dash);
    return;
  }
  g.append('rect')
    .attr('class', 'ownership-shape')
    .attr('x', left)
    .attr('y', top)
    .attr('width', width)
    .attr('height', height)
    .attr('rx', radius)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', strokeWidth)
    .attr('stroke-dasharray', dash);
  if (shape === 'trust') {
    const inset = Math.min(TRUST_INSET, width / 4, height / 4);
    g.append('rect')
      .attr('class', 'ownership-shape-inner')
      .attr('x', left + inset)
      .attr('y', top + inset)
      .attr('width', width - 2 * inset)
      .attr('height', height - 2 * inset)
      .attr('rx', Math.max(0, radius - inset))
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', strokeWidth * 0.8)
      .attr('stroke-dasharray', dash);
  }
}
