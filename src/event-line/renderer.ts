// ============================================================
// Event Line — D3 SVG Renderer (spec §28)
// ============================================================
//
// Horizontal spine of point events. Each event: a dot at its date position
// (or even index under no-scale), a leader line, and an org-style card
// (utils/card.ts `renderNodeCard` chrome + a hand-drawn divider and a
// pyramid/ring prose body). Cards auto-alternate above/below and pack into
// stacked lanes on collision; date labels dedupe + declutter rather than
// moving the dots. The tag legend uses the shared `renderIntegratedLegend`.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import {
  CARD_RADIUS,
  HEADER_HEIGHT,
  LABEL_FONT_SIZE,
  NODE_STROKE_WIDTH,
  SEPARATOR_GAP,
} from '../utils/visual-conventions';
import { contrastText, getSeriesColors, shapeFill } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { renderNodeCard } from '../utils/card';
import { renderInlineText } from '../utils/inline-markdown';
import { CHAR_WIDTH_RATIO } from '../utils/text-measure';
import { wrapDescriptionLines, type WrappedDescLine } from '../utils/wrapped-desc';
import { renderIntegratedLegend } from '../utils/legend-integration';
import type { LegendGroupData } from '../utils/legend-types';
import {
  resolveActiveTagGroup,
  resolveTagColor,
  type TagGroup,
} from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { EventLineEvent, ParsedEventLine } from './types';

// ── Geometry constants ───────────────────────────────────────
const CARD_W = 210;
const H_MARGIN = 58;
const TITLE_AREA = 48;
const LEGEND_BAND = 34;
const LEADER_ABOVE = 26;
const LEADER_BELOW = 40;
const DESC_FONT = 11.5;
const DESC_LINE_H = 16;
const CARD_PAD = 9;
const CARD_BODY_TOP = HEADER_HEIGHT + SEPARATOR_GAP;
const DOT_R = 5.5;
const MIN_SPACING = 96;
const LANE_GAP = 16;
const NEUTRAL_TAG = '#999999';

type Side = 'above' | 'below';

interface Placed {
  event: EventLineEvent;
  color: string;
  cardFill: string;
  titleColor: string;
  lines: WrappedDescLine[];
  cardH: number;
  x: number;
  side: Side;
  lane: number;
}

export function renderEventLine(
  container: HTMLDivElement,
  parsed: ParsedEventLine,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  tagOverride?: string
): void {
  if (parsed.events.length === 0) return;

  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const heightHint = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || heightHint <= 0) return;

  const exportMode = !!exportDims;
  const seriesColors = getSeriesColors(palette);
  const accent = seriesColors[0]!;
  const activeGroup = resolveActiveTagGroup(
    parsed.tagGroups,
    undefined,
    tagOverride
  );

  const showTitle = !!parsed.title && !parsed.options.noTitle;
  const hasLegend = parsed.tagGroups.length > 0 && activeGroup !== null;
  const titleH = showTitle ? TITLE_AREA : 0;
  const legendH = hasLegend ? LEGEND_BAND : 0;
  const topUsed = titleH + legendH;

  // ── Per-event color + wrapped body + card height ──
  const charsPerLine = Math.max(
    8,
    Math.floor((CARD_W - CARD_PAD * 2) / (DESC_FONT * CHAR_WIDTH_RATIO))
  );
  const placed: Placed[] = parsed.events.map((event, i) => {
    let solid = accent;
    if (activeGroup) {
      const tc = resolveTagColor(
        event.metadata,
        parsed.tagGroups as TagGroup[],
        activeGroup
      );
      if (tc && tc !== NEUTRAL_TAG) solid = resolveColor(tc, palette) ?? tc;
    }
    const cardFill = shapeFill(palette, solid, isDark, { solid: false });
    const titleColor = contrastText(
      cardFill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    const lines = wrapDescription(event.description, charsPerLine);
    const bodyH = lines.length > 0 ? SEPARATOR_GAP + lines.length * DESC_LINE_H : 0;
    const cardH = HEADER_HEIGHT + bodyH + (lines.length > 0 ? CARD_PAD : 6);
    return {
      event,
      color: solid,
      cardFill,
      titleColor,
      lines,
      cardH,
      x: 0,
      side: (parsed.options.alternate ? (i % 2 === 0 ? 'above' : 'below') : 'below') as Side,
      lane: 0,
    };
  });

  // ── X positions ──
  const scaled =
    parsed.options.scale && placed.every((p) => p.event.dateValue !== null);
  const innerW = width - H_MARGIN * 2;
  if (scaled) {
    const vals = placed.map((p) => p.event.dateValue!);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    placed.forEach((p) => {
      p.x = H_MARGIN + (hi > lo ? ((p.event.dateValue! - lo) / (hi - lo)) * innerW : innerW / 2);
    });
  } else {
    const n = placed.length;
    const spacing = n > 1 ? Math.max(MIN_SPACING, innerW / (n - 1)) : 0;
    placed.forEach((p, i) => {
      p.x = H_MARGIN + i * spacing;
    });
  }
  const contentW = Math.max(width, Math.max(...placed.map((p) => p.x)) + H_MARGIN);

  // Card-left, clamped on-canvas.
  const cardLeft = (p: Placed): number =>
    Math.max(6, Math.min(contentW - CARD_W - 6, p.x - CARD_W / 2));

  // ── Lane packing per side (avoid horizontal overlap) ──
  for (const side of ['above', 'below'] as Side[]) {
    const arr = placed
      .filter((p) => p.side === side)
      .sort((a, b) => cardLeft(a) - cardLeft(b));
    const laneEnds: number[] = [];
    for (const p of arr) {
      const left = cardLeft(p);
      let lane = 0;
      for (; lane < laneEnds.length; lane++) {
        if (left > laneEnds[lane]! + 8) break;
      }
      p.lane = lane;
      laneEnds[lane] = left + CARD_W;
    }
  }
  const rowGap = (side: Side): number =>
    Math.max(0, ...placed.filter((p) => p.side === side).map((p) => p.cardH)) +
    LANE_GAP;
  const rowGapA = rowGap('above');
  const rowGapB = rowGap('below');
  const ext = (side: Side): number =>
    Math.max(
      0,
      ...placed
        .filter((p) => p.side === side)
        .map(
          (p) =>
            (side === 'above' ? LEADER_ABOVE : LEADER_BELOW) +
            p.lane * (side === 'above' ? rowGapA : rowGapB) +
            p.cardH
        )
    );
  const aboveExt = ext('above');
  const belowExt = ext('below');
  const TOP_PAD = 14;
  const BOT_PAD = 14;
  const spineY = topUsed + TOP_PAD + aboveExt;
  const totalH = Math.max(heightHint, spineY + belowExt + BOT_PAD);

  // ── SVG root ──
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', contentW)
    .attr('height', totalH)
    .attr('viewBox', `0 0 ${contentW} ${totalH}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  svg
    .append('rect')
    .attr('width', contentW)
    .attr('height', totalH)
    .attr('fill', palette.bg);

  if (showTitle) {
    const t = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', contentW / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('data-line-number', parsed.titleLineNumber ?? 1)
      .text(parsed.title!);
    if (onClickItem && parsed.titleLineNumber) {
      const ln = parsed.titleLineNumber;
      t.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }
  }

  // ── Shared tag legend ──
  if (hasLegend) {
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0, ${titleH})`);
    const groups: LegendGroupData[] = parsed.tagGroups.map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({
        value: e.value,
        color: resolveColor(e.color, palette) ?? e.color,
      })),
    }));
    renderIntegratedLegend(legendG, {
      groups,
      palette,
      isDark,
      width: contentW,
      mode: exportMode ? 'export' : 'preview',
      activeGroup,
    });
  }

  // ── Spine ──
  const xs = placed.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  svg
    .append('line')
    .attr('x1', x0 - 20)
    .attr('y1', spineY)
    .attr('x2', x1 + 20)
    .attr('y2', spineY)
    .attr('stroke', palette.text)
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round');

  // ── Leaders + cards ──
  for (const p of placed) {
    const near =
      p.side === 'above'
        ? spineY - LEADER_ABOVE - p.lane * rowGapA
        : spineY + LEADER_BELOW + p.lane * rowGapB;
    const top = p.side === 'above' ? near - p.cardH : near;
    const left = cardLeft(p);

    svg
      .append('line')
      .attr('x1', p.x)
      .attr('y1', spineY)
      .attr('x2', p.x)
      .attr('y2', near)
      .attr('stroke', p.color)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.65);

    const cardG = svg
      .append('g')
      .attr('transform', `translate(${left}, ${top})`)
      .attr('data-line-number', p.event.lineNumber);
    if (onClickItem) {
      const ln = p.event.lineNumber;
      cardG.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }

    // Org-card chrome: rect + bold centered title (reuses utils/card.ts).
    renderNodeCard(cardG, {
      width: CARD_W,
      height: p.cardH,
      rx: CARD_RADIUS,
      fill: p.cardFill,
      stroke: p.color,
      strokeWidth: NODE_STROKE_WIDTH,
      label: p.event.label,
      labelColor: p.titleColor,
      labelFontSize: LABEL_FONT_SIZE,
      headerHeight: HEADER_HEIGHT,
    });

    if (p.lines.length > 0) {
      // Divider (org convention: 1px, 30% opacity at headerHeight).
      cardG
        .append('line')
        .attr('x1', 0)
        .attr('y1', HEADER_HEIGHT)
        .attr('x2', CARD_W)
        .attr('y2', HEADER_HEIGHT)
        .attr('stroke', p.titleColor)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);
      renderBody(cardG, p.lines, p.titleColor, palette);
    }

    // Tag-colored top rule — the card's color key (clipped to the top edge).
    cardG
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', CARD_W)
      .attr('height', 3)
      .attr('fill', p.color);
  }

  // ── Date captions: dedupe per unique x, declutter into sub-rows ──
  const seen = new Map<number, string>();
  for (const p of placed) {
    if (!p.event.date) continue;
    const key = Math.round(p.x);
    if (!seen.has(key)) seen.set(key, p.event.date);
  }
  const labels = [...seen.entries()]
    .map(([x, d]) => ({ x, d }))
    .sort((a, b) => a.x - b.x);
  const rowRight: number[] = [];
  for (const L of labels) {
    const hw = L.d.length * (DESC_FONT * CHAR_WIDTH_RATIO) * 0.5 + 6;
    let r = 0;
    for (; r < rowRight.length; r++) {
      if (L.x - hw > rowRight[r]! + 4) break;
    }
    rowRight[r] = L.x + hw;
    const y = spineY + 15 + r * 12;
    svg
      .append('rect')
      .attr('x', L.x - hw)
      .attr('y', y - 9)
      .attr('width', hw * 2)
      .attr('height', 13)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.92);
    svg
      .append('text')
      .attr('x', L.x)
      .attr('y', y)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 10.5)
      .attr('fill', palette.textMuted)
      .text(L.d);
  }

  // ── Dots on top ──
  for (const p of placed) {
    svg
      .append('circle')
      .attr('class', 'dgmo-event-dot')
      .attr('cx', p.x)
      .attr('cy', spineY)
      .attr('r', DOT_R)
      .attr('fill', p.color)
      .attr('stroke', palette.bg)
      .attr('stroke-width', 2)
      .attr('data-line-number', p.event.lineNumber);
  }
}

export function renderEventLineForExport(
  container: HTMLDivElement,
  parsed: ParsedEventLine,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  tagOverride?: string
): void {
  renderEventLine(container, parsed, palette, isDark, undefined, exportDims, tagOverride);
}

// ── helpers ──

function wrapDescription(
  lines: readonly string[],
  charsPerLine: number
): WrappedDescLine[] {
  const out: WrappedDescLine[] = [];
  for (const line of lines) {
    if (line === '') {
      out.push({ text: '', kind: 'plain' });
      continue;
    }
    out.push(...wrapDescriptionLines([line], charsPerLine));
  }
  return out;
}

function renderBody(
  cardG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  lines: WrappedDescLine[],
  bodyColor: string,
  palette: PaletteColors
): void {
  let y = CARD_BODY_TOP + DESC_FONT;
  for (const line of lines) {
    const isBullet = line.kind === 'bullet-first' || line.kind === 'bullet-cont';
    const bodyX = CARD_PAD + (isBullet ? 12 : 0);
    if (line.kind === 'bullet-first') {
      cardG
        .append('text')
        .attr('x', CARD_PAD)
        .attr('y', y)
        .attr('text-anchor', 'start')
        .attr('fill', bodyColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', DESC_FONT)
        .text('•');
    }
    const t = cardG
      .append('text')
      .attr('x', bodyX)
      .attr('y', y)
      .attr('text-anchor', 'start')
      .attr('fill', bodyColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', DESC_FONT);
    renderInlineText(t, line.text, palette);
    y += DESC_LINE_H;
  }
}
