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
import {
  contrastText,
  getSeriesColors,
  shapeFill,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { renderNodeCard } from '../utils/card';
import { renderInlineText } from '../utils/inline-markdown';
import { CHAR_WIDTH_RATIO } from '../utils/text-measure';
import {
  wrapDescriptionLines,
  type WrappedDescLine,
} from '../utils/wrapped-desc';
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
const LEADER_ABOVE = 46;
const LEADER_BELOW = 46;
const DESC_FONT = 11.5;
const DESC_LINE_H = 16;
const CARD_PAD = 9;
const CARD_BODY_TOP = HEADER_HEIGHT + SEPARATOR_GAP;
const DOT_R = 5.5;
const MIN_SPACING = 96;
const LANE_GAP = 16;
const NEUTRAL_TAG = '#999999';
// Horizontal placement: a card may slide sideways as long as its dot stays at
// least CARD_INSET from either edge (so a vertical leader still lands cleanly
// on it). Cards fan side-by-side until they can't, then stack into lanes.
const CARD_INSET = 18;
const FAN_GAP = 6;
// Date labels sit on the side OPPOSITE their card, pushed this far off the spine.
const DATE_OFFSET = 28;

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
  left: number;
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
    const bodyH =
      lines.length > 0 ? SEPARATOR_GAP + lines.length * DESC_LINE_H : 0;
    const cardH = HEADER_HEIGHT + bodyH + (lines.length > 0 ? CARD_PAD : 6);
    return {
      event,
      color: solid,
      cardFill,
      titleColor,
      lines,
      cardH,
      x: 0,
      side: (parsed.options.alternate
        ? i % 2 === 0
          ? 'above'
          : 'below'
        : 'below') as Side,
      lane: 0,
      left: 0,
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
      p.x =
        H_MARGIN +
        (hi > lo
          ? ((p.event.dateValue! - lo) / (hi - lo)) * innerW
          : innerW / 2);
    });
    // Nudge near-coincident dots apart so they read as distinct (and give their
    // labels room). Events with the SAME date keep a shared position; only
    // distinct times are separated.
    const MIN_DOT_GAP = 16;
    let prevX = -Infinity;
    let prevVal: number | null = null;
    for (const p of [...placed].sort((a, b) => a.x - b.x)) {
      if (p.event.dateValue === prevVal) {
        p.x = prevX;
        continue;
      }
      if (p.x < prevX + MIN_DOT_GAP) p.x = prevX + MIN_DOT_GAP;
      prevX = p.x;
      prevVal = p.event.dateValue;
    }
  } else {
    const n = placed.length;
    const spacing = n > 1 ? Math.max(MIN_SPACING, innerW / (n - 1)) : 0;
    placed.forEach((p, i) => {
      p.x = H_MARGIN + i * spacing;
    });
  }
  const contentW = Math.max(
    width,
    Math.max(...placed.map((p) => p.x)) + H_MARGIN
  );

  // ── Horizontal placement: fan side-by-side, stack only when too tight ──
  // Each card keeps its dot within [left+INSET, left+CARD_W-INSET] so a vertical
  // leader lands on it. When the next event's dot is within a card-width, bias
  // this card LEFT (dot near its right edge) to leave room for the neighbour, so
  // close events sit side-by-side instead of stacking + crossing each other.
  const clampLeft = (left: number): number =>
    Math.max(6, Math.min(contentW - CARD_W - 6, left));
  for (const side of ['above', 'below'] as Side[]) {
    const arr = placed.filter((p) => p.side === side).sort((a, b) => a.x - b.x);
    const laneRight: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]!;
      const next = arr[i + 1];
      const crowdedRight = !!next && next.x - p.x < CARD_W + FAN_GAP;
      const preferred = crowdedRight
        ? p.x - CARD_W + CARD_INSET
        : p.x - CARD_W / 2;
      const maxLeft = p.x - CARD_INSET;
      const minLeft = p.x - CARD_W + CARD_INSET;
      // Default: open a fresh lane at the preferred position.
      let lane = laneRight.length;
      let left = Math.max(preferred, minLeft);
      // Prefer the innermost existing lane the card fits in side-by-side.
      for (let l = 0; l < laneRight.length; l++) {
        const want = Math.max(preferred, laneRight[l]! + FAN_GAP, minLeft);
        if (want <= maxLeft) {
          lane = l;
          left = want;
          break;
        }
      }
      left = clampLeft(left);
      p.lane = lane;
      p.left = left;
      laneRight[lane] = left + CARD_W;
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
  // Date labels sit on the side opposite their card; reserve room for that band
  // so a one-sided line (e.g. no-alternate) doesn't push dates into the legend.
  const dateAbove = placed.some((p) => p.side === 'below' && p.event.date);
  const dateBelow = placed.some((p) => p.side === 'above' && p.event.date);
  const aboveExt = Math.max(ext('above'), dateAbove ? DATE_OFFSET + 10 : 0);
  const belowExt = Math.max(ext('below'), dateBelow ? DATE_OFFSET + 10 : 0);
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
    const left = p.left;

    // Vertical leader straight up/down from the dot. The card was placed so the
    // dot stays within its width, so the leader always lands on the card.
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

    if (parsed.options.noBox) {
      // Slide-friendly, card-less style: a tag-colored label, a rule, and the
      // description below — no box / fill / border. The title (the anchor) sits
      // nearest the spine, so for above-side blocks the order flips to
      // description → rule → title.
      const titleNearTop = p.side === 'below';
      const headBandTop = titleNearTop ? 0 : p.cardH - HEADER_HEIGHT;
      cardG
        .append('text')
        .attr('x', CARD_PAD)
        .attr('y', headBandTop + HEADER_HEIGHT / 2 + LABEL_FONT_SIZE / 2 - 2)
        .attr('fill', p.color)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', LABEL_FONT_SIZE)
        .attr('font-weight', 700)
        .text(p.event.label);
      cardG
        .append('line')
        .attr('x1', CARD_PAD)
        .attr('y1', titleNearTop ? HEADER_HEIGHT : headBandTop)
        .attr('x2', CARD_W - CARD_PAD)
        .attr('y2', titleNearTop ? HEADER_HEIGHT : headBandTop)
        .attr('stroke', p.color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.7);
      if (p.lines.length > 0) {
        const startBaseline = titleNearTop
          ? CARD_BODY_TOP + DESC_FONT
          : CARD_PAD + DESC_FONT;
        renderBody(cardG, p.lines, palette.text, palette, startBaseline);
      }
    } else {
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
    }
  }

  // ── Date captions ──
  // Each date sits on the side OPPOSITE its card (pushed DATE_OFFSET off the
  // spine) so it never crowds its own card's leader. One label per (x, date);
  // when same-side labels collide, the cluster spreads horizontally (centered,
  // clamped to canvas) with a thin leader from each dot to its label.
  interface DateLabel {
    x: number;
    date: string;
    color: string;
    side: Side;
    lx: number;
  }
  const labelMap = new Map<string, DateLabel>();
  for (const p of placed) {
    if (!p.event.date) continue;
    const key = `${Math.round(p.x)}|${p.event.date}`;
    if (!labelMap.has(key)) {
      labelMap.set(key, {
        x: p.x,
        date: p.event.date,
        color: p.color,
        side: p.side === 'above' ? 'below' : 'above',
        lx: p.x,
      });
    }
  }
  const halfW = (d: string): number =>
    (d.length * DESC_FONT * CHAR_WIDTH_RATIO) / 2 + 9;
  const LABEL_GAP = 8;
  const EDGE = 8;

  // De-collide same-side labels so they NEVER overlap. Forward pass pushes each
  // label right of its left neighbour (guarantees separation); backward pass
  // pulls the run back inside the right edge without re-colliding; a final
  // forward fixup respects the left edge. lx starts at the dot's x.
  for (const labelSide of ['above', 'below'] as Side[]) {
    const arr = [...labelMap.values()]
      .filter((l) => l.side === labelSide)
      .sort((a, b) => a.x - b.x);
    const hw = arr.map((l) => halfW(l.date));
    for (let i = 1; i < arr.length; i++) {
      const minLx = arr[i - 1]!.lx + hw[i - 1]! + hw[i]! + LABEL_GAP;
      if (arr[i]!.lx < minLx) arr[i]!.lx = minLx;
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const cap =
        i === arr.length - 1
          ? contentW - EDGE - hw[i]!
          : arr[i + 1]!.lx - hw[i + 1]! - hw[i]! - LABEL_GAP;
      if (arr[i]!.lx > cap) arr[i]!.lx = cap;
    }
    for (let i = 0; i < arr.length; i++) {
      const floor =
        i === 0
          ? EDGE + hw[i]!
          : arr[i - 1]!.lx + hw[i - 1]! + hw[i]! + LABEL_GAP;
      if (arr[i]!.lx < floor) arr[i]!.lx = floor;
    }
  }

  for (const L of labelMap.values()) {
    const hw = halfW(L.date);
    const cy = L.side === 'above' ? spineY - DATE_OFFSET : spineY + DATE_OFFSET;
    const nearY = L.side === 'above' ? cy + 7 : cy - 7;
    svg
      .append('line')
      .attr('x1', L.x)
      .attr('y1', L.side === 'above' ? spineY - 1 : spineY + 1)
      .attr('x2', L.lx)
      .attr('y2', nearY)
      .attr('stroke', L.color)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5);
    svg
      .append('rect')
      .attr('x', L.lx - hw)
      .attr('y', cy - 7)
      .attr('width', hw * 2)
      .attr('height', 14)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.92);
    svg
      .append('text')
      .attr('x', L.lx)
      .attr('y', cy + 3.5)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 10.5)
      .attr('font-weight', 600)
      .attr('fill', L.color)
      .text(L.date);
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
  renderEventLine(
    container,
    parsed,
    palette,
    isDark,
    undefined,
    exportDims,
    tagOverride
  );
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
  palette: PaletteColors,
  startBaseline = CARD_BODY_TOP + DESC_FONT
): void {
  let y = startBaseline;
  for (const line of lines) {
    const isBullet =
      line.kind === 'bullet-first' || line.kind === 'bullet-cont';
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
