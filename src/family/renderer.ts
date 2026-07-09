// ============================================================
// Family Diagram (genealogy) — D3 SVG Renderer
// ============================================================
//
// Person cards (name header + separator + muted year-range row + labeled meta
// rows), horizontal marriage bars (midpoint dot + marriage year), and children
// buses (org bus-edge pattern: trunk + horizontal bar + per-child drops; adopted
// children get a dashed drop).
//
// COLOURING is standard tag-group behaviour (org precedent): the ACTIVE tag
// group tints the cards, and every tag group — including the synthesized "Sex"
// group (parser adds it when any `sex:` is present) — renders in the shared
// `renderIntegratedLegend` legend with hover-dim via `data-tag-<key>`. An
// explicit inline `(color)` still wins over the active group.
//
// Visual conventions: `docs/architecture/diagram-visual-conventions.md` §1/§2/§4.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import {
  shapeFill,
  contrastText,
  themeBaseBg,
  mix,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { resolveTagColor, tagAttrKey } from '../utils/tag-groups';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { LEGEND_GROUP_GAP } from '../utils/legend-constants';
import type { LegendConfig } from '../utils/legend-types';
import { measureText } from '../utils/text-measure';
import {
  HEADER_HEIGHT,
  LABEL_FONT_SIZE,
  META_FONT_SIZE,
  META_LINE_HEIGHT,
  SEPARATOR_GAP,
  CARD_RADIUS,
  NODE_STROKE_WIDTH,
  EDGE_STROKE_WIDTH,
} from '../utils/visual-conventions';
import { familyCardRows } from './card-model';
import type { PaletteColors } from '../palettes';
import type {
  ParsedFamily,
  FamilyLayoutResult,
  FamilyLayoutNode,
} from './types';

type D3Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;
type D3G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

const KEY_X = 10;
const KEY_VALUE_GAP = 6;
const BAR_DOT_R = 3.5;
const TITLE_RESERVE = 40; // native vertical band for the title

export interface FamilyRenderOptions {
  exportDims?: { width: number; height: number };
  /**
   * App-preview display size (px). When set, the diagram is scaled to fit while
   * the title + legend stay at NATIVE size (always legible). Omit for export.
   */
  fit?: { width: number; height: number };
  activeTagGroup?: string | null;
  exportMode?: boolean;
}

/**
 * A person's card base color (hex): an explicit inline color wins; otherwise the
 * ACTIVE tag group tints the card (the synthesized "Sex" group is the default
 * active one). No tag/active group → neutral primary.
 */
function baseColor(
  node: FamilyLayoutNode,
  parsed: ParsedFamily,
  palette: PaletteColors,
  activeTagGroup: string | null
): string {
  if (node.color) {
    const c = resolveColor(node.color, palette);
    if (c) return c;
  }
  if (activeTagGroup) {
    const c = resolveTagColor(
      node.tagMetadata,
      [...parsed.tagGroups],
      activeTagGroup
    );
    if (c && c !== '#999999') return c;
  }
  return palette.primary;
}

export function renderFamilyForExport(
  container: HTMLElement,
  parsed: ParsedFamily,
  layout: FamilyLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  opts: FamilyRenderOptions = {}
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const activeTagGroup = opts.activeTagGroup ?? null;
  const solid = parsed.options['solid-fill'] === 'on';
  const baseBg = themeBaseBg(palette, isDark);

  const PAD = 20;
  const MAX_SCALE = 1.5;
  const titleReserve = parsed.title ? TITLE_RESERVE : 0;

  // ── Legend (standard tag-group framework) ──
  const legendGroups = parsed.tagGroups
    .filter((g) => g.entries.length > 0)
    .map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
    }));
  const hasLegend = legendGroups.length > 0;
  const legendConfig: LegendConfig = {
    groups: legendGroups,
    position: { placement: 'top-center', titleRelation: 'below-title' },
    mode: opts.exportMode ? 'export' : 'preview',
    showInactivePills: true,
  };

  // Overall SVG size. `fit` (app preview) = the display pane px → the diagram is
  // SCALED to fit while the title + legend stay at NATIVE size (org precedent),
  // so the chrome is always legible no matter how far the tree is scaled down.
  // Export/CLI: full size (scale 1), chrome native too.
  const contentW = layout.width;
  const contentH = layout.height;
  const W = opts.fit?.width ?? opts.exportDims?.width ?? contentW + PAD * 2;
  const legendReserve = hasLegend
    ? getMaxLegendReservedHeight(legendConfig, W) + LEGEND_GROUP_GAP
    : 0;
  const chrome = titleReserve + legendReserve;
  let scale = 1;
  let H: number;
  if (opts.fit) {
    H = opts.fit.height;
    const availW = Math.max(1, W - PAD * 2);
    const availH = Math.max(1, H - chrome - PAD * 2);
    scale = Math.min(MAX_SCALE, availW / contentW, availH / contentH);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  } else {
    H = contentH + chrome + PAD * 2;
  }

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', W)
    .attr('height', H)
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    // The app reads the fit-scale to decide when the tree is too small to read
    // (→ a single card click focuses instead of navigating).
    .attr('data-fit-scale', scale.toFixed(3))
    .style('font-family', FONT_FAMILY) as unknown as D3Svg;

  // ── Title (native size, pinned top) ──
  if (parsed.title) {
    svg
      .append('text')
      .attr('x', W / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(parsed.title);
  }

  // ── Tag-group legend (native size, below title) ──
  if (hasLegend) {
    const legendParent = svg
      .append('g')
      .attr('transform', `translate(0, ${titleReserve})`) as unknown as D3G;
    renderIntegratedLegend(legendParent, {
      ...legendConfig,
      palette,
      isDark,
      width: W,
      activeGroup: activeTagGroup,
    });
    legendParent
      .selectAll('[data-legend-group]')
      .classed('family-legend-group', true);
  }

  // ── Scaled content group (the diagram) ──
  const contentX = (W - contentW * scale) / 2;
  const root = svg
    .append('g')
    .attr(
      'transform',
      `translate(${contentX}, ${chrome + PAD}) scale(${scale})`
    ) as unknown as D3G;

  // ── Children buses (drawn under cards) ──
  const edgeG = root.append('g').attr('class', 'family-edges');
  for (const e of layout.edges) {
    const d = e.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    edgeG
      .append('path')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('stroke-dasharray', e.adopted ? '6 3' : null);
    if (e.adopted) {
      // Italic `adopted` label near the child drop.
      const last = e.points[e.points.length - 1]!;
      const prev = e.points[e.points.length - 2] ?? last;
      edgeG
        .append('text')
        .attr('x', last.x + 5)
        .attr('y', (last.y + prev.y) / 2)
        .attr('font-size', META_FONT_SIZE)
        .attr('font-style', 'italic')
        .attr('fill', palette.textMuted)
        .text('adopted');
    }
  }

  // ── Marriage bars ──
  const barG = root.append('g').attr('class', 'family-bars');
  for (const bar of layout.bars) {
    barG
      .append('line')
      .attr('x1', bar.x1)
      .attr('y1', bar.y)
      .attr('x2', bar.x2)
      .attr('y2', bar.y)
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('class', 'family-marriage-bar')
      .attr('data-line-number', String(bar.lineNumber));
    barG
      .append('circle')
      .attr('cx', bar.midX)
      .attr('cy', bar.y)
      .attr('r', BAR_DOT_R)
      .attr('fill', palette.textMuted);
    if (bar.year) {
      barG
        .append('text')
        .attr('x', bar.labelX)
        .attr('y', bar.y - BAR_DOT_R - 3)
        .attr('text-anchor', 'middle')
        .attr('font-size', META_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .attr('stroke', baseBg)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke')
        .text(`m. ${bar.year}`);
    }
  }

  // ── Person cards ──
  const cardsG = root.append('g').attr('class', 'family-cards');
  for (const node of layout.nodes) {
    const base = baseColor(node, parsed, palette, activeTagGroup);
    const fill = shapeFill(palette, base, isDark, { solid });
    const stroke = base;
    const labelColor = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    const g = cardsG
      .append('g')
      .attr('class', 'family-card')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-person-id', node.id) as D3G;
    // Expose the active tag value for legend-entry hover-dim (org precedent).
    if (activeTagGroup) {
      const key = tagAttrKey(activeTagGroup);
      const v = node.tagMetadata[key];
      if (v) g.attr(`data-tag-${key}`, v.toLowerCase());
    }

    g.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', CARD_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    g.append('text')
      .attr('x', node.width / 2)
      .attr('y', HEADER_HEIGHT / 2 + LABEL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', labelColor)
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(node.label);

    // Focus dot-target (org precedent) — click to collapse the tree to this
    // person's line. Subtle by default; the app reveals it fully on hover.
    const fx = node.width - 13;
    const fy = 9;
    const focusG = g
      .append('g')
      .attr('class', 'family-focus-icon')
      .attr('data-focus-person', node.id)
      .attr('data-export-ignore', 'true')
      .attr('opacity', 0.4)
      .style('cursor', 'pointer');
    focusG
      .append('rect')
      .attr('x', fx - 6)
      .attr('y', fy - 6)
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', 'transparent');
    focusG
      .append('circle')
      .attr('cx', fx)
      .attr('cy', fy)
      .attr('r', 5)
      .attr('fill', 'none')
      .attr('stroke', labelColor)
      .attr('stroke-width', 1.4);
    focusG
      .append('circle')
      .attr('cx', fx)
      .attr('cy', fy)
      .attr('r', 1.6)
      .attr('fill', labelColor);

    const rows = familyCardRows(node);
    if (rows.length === 0) continue;

    g.append('line')
      .attr('x1', 0)
      .attr('y1', HEADER_HEIGHT)
      .attr('x2', node.width)
      .attr('y2', HEADER_HEIGHT)
      .attr('stroke', solid ? labelColor : stroke)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);

    const maxKeyWidth = Math.max(
      0,
      ...rows
        .filter((r) => !r.year)
        .map((r) => measureText(`${r.key}: `, META_FONT_SIZE))
    );
    const valueX = KEY_X + maxKeyWidth + KEY_VALUE_GAP;
    const startY = HEADER_HEIGHT + SEPARATOR_GAP + META_FONT_SIZE;
    rows.forEach((r, i) => {
      const rowY = startY + i * META_LINE_HEIGHT;
      if (r.year) {
        g.append('text')
          .attr('x', KEY_X)
          .attr('y', rowY)
          .attr('fill', labelColor)
          .attr('fill-opacity', 0.7)
          .attr('font-size', META_FONT_SIZE)
          .text(r.value);
      } else {
        g.append('text')
          .attr('x', KEY_X)
          .attr('y', rowY)
          .attr('fill', labelColor)
          .attr('font-size', META_FONT_SIZE)
          .text(`${r.key}: `);
        g.append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', labelColor)
          .attr('font-size', META_FONT_SIZE)
          .text(r.value);
      }
    });
  }

  // ── Ancestor dots (focus mode): the focused person's parents, collapsed to
  // small labeled dots above their card, connected by a short trail (org-style).
  if (layout.ancestors.length > 0 && layout.focusAnchor) {
    const aG = root.append('g').attr('class', 'family-ancestors');
    const anchor = layout.focusAnchor;
    const dotY = layout.ancestors[0]!.y;
    aG.append('line')
      .attr('x1', anchor.x)
      .attr('y1', dotY)
      .attr('x2', anchor.x)
      .attr('y2', anchor.y)
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('stroke-opacity', 0.5);
    for (const a of layout.ancestors) {
      const hue =
        (a.color ? resolveColor(a.color, palette) : null) ??
        resolveColor(
          a.sex === 'm' ? 'blue' : a.sex === 'f' ? 'purple' : 'gray',
          palette
        ) ??
        palette.textMuted;
      // Clickable to focus UP onto this parent (the app handles data-focus-person).
      const dot = aG
        .append('g')
        .attr('data-ancestor', a.label)
        .attr('data-focus-person', a.id)
        .style('cursor', 'pointer');
      dot
        .append('circle')
        .attr('cx', a.x)
        .attr('cy', a.y)
        .attr('r', 6)
        .attr('fill', mix(hue, baseBg, 40))
        .attr('stroke', hue)
        .attr('stroke-width', 1.5);
      dot
        .append('text')
        .attr('x', a.x + 10)
        .attr('y', a.y)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', META_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .attr('stroke', baseBg)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke')
        .text(a.label);
    }
  }
}

/** App-preview entry: scales the diagram to fit the container. */
export function renderFamily(
  container: HTMLElement,
  parsed: ParsedFamily,
  layout: FamilyLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  opts: FamilyRenderOptions = {}
): void {
  renderFamilyForExport(container, parsed, layout, palette, isDark, opts);
}
