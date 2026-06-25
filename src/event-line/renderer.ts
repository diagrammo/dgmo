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
import type { EventLineEra, EventLineEvent, ParsedEventLine } from './types';

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
// Era `]` bracket band: depth reserved on the side opposite the cards.
const ERA_BLOCK = 30;
const ERA_BRACKET_CAP = 8;
const ERA_LABEL_FONT = 11.5;
// A collapsed era folds its members into one card; cap the bulleted member list.
const ERA_MEMBER_MAX = 6;
const ERA_COLLAPSED_HALF = 30; // half-width of a collapsed era's spine bracket

type Side = 'above' | 'below';

interface Placed {
  /** `event` = a visible event card; `era` = a collapsed era's summary card. */
  kind: 'event' | 'era';
  event: EventLineEvent | null;
  era: EventLineEra | null;
  members: readonly EventLineEvent[];
  label: string;
  date: string | null;
  dateValue: number | null;
  lineNumber: number;
  /** Name of the enclosing era (for bracket runs), or null. */
  eraName: string | null;
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
  const hasLegend =
    parsed.tagGroups.length > 0 &&
    activeGroup !== null &&
    !parsed.options.noLegend;
  const titleH = showTitle ? TITLE_AREA : 0;
  const legendH = hasLegend ? LEGEND_BAND : 0;
  const topUsed = titleH + legendH;

  // ── Eras (§28.6a) ──────────────────────────────────────────
  // The era sits OPPOSITE the cards (one-sided → opposite the chosen side;
  // alternating → below by default). A collapsed era folds into one event-like
  // summary card on the cards' side, with a `]` bracket left on the spine.
  const eraByName = new Map(parsed.eras.map((e) => [e.name, e]));
  const collapsedSet = new Set(
    parsed.eras.filter((e) => e.collapsed).map((e) => e.name)
  );
  const hasEras = parsed.events.some((e) => e.era && eraByName.has(e.era));
  const anyCollapsed = parsed.events.some(
    (e) => e.era && collapsedSet.has(e.era)
  );
  const sideOpt = parsed.options.side;
  const alternate = sideOpt === 'alternate';
  const eraSide: Side = alternate
    ? 'below'
    : sideOpt === 'above'
      ? 'below'
      : 'above';
  const summarySide: Side = eraSide === 'above' ? 'below' : 'above';

  // Slots in source order: a visible event, or one summary per collapsed era.
  type Slot =
    | { kind: 'event'; event: EventLineEvent }
    | { kind: 'era'; era: EventLineEra; members: EventLineEvent[] };
  const slots: Slot[] = [];
  const emitted = new Set<string>();
  for (const event of parsed.events) {
    const name = event.era;
    if (name && collapsedSet.has(name)) {
      if (!emitted.has(name)) {
        emitted.add(name);
        slots.push({
          kind: 'era',
          era: eraByName.get(name)!,
          members: parsed.events.filter((e) => e.era === name),
        });
      }
    } else {
      slots.push({ kind: 'event', event });
    }
  }

  // ── Per-slot color + wrapped body + card height ──
  const charsPerLine = Math.max(
    8,
    Math.floor((CARD_W - CARD_PAD * 2) / (DESC_FONT * CHAR_WIDTH_RATIO))
  );
  const cardHeight = (lines: WrappedDescLine[]): number =>
    HEADER_HEIGHT +
    (lines.length > 0 ? SEPARATOR_GAP + lines.length * DESC_LINE_H : 0) +
    (lines.length > 0 ? CARD_PAD : 6);
  let evIdx = 0;
  const placed: Placed[] = slots.map((slot): Placed => {
    if (slot.kind === 'event') {
      const event = slot.event;
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
      const side: Side = alternate
        ? evIdx++ % 2 === 0
          ? 'above'
          : 'below'
        : (sideOpt as Side);
      return {
        kind: 'event',
        event,
        era: null,
        members: [],
        label: event.label,
        date: event.date,
        dateValue: event.dateValue,
        lineNumber: event.lineNumber,
        eraName: event.era,
        color: solid,
        cardFill,
        titleColor,
        lines,
        cardH: cardHeight(lines),
        x: 0,
        side,
        lane: 0,
        left: 0,
      };
    }
    // Collapsed era → an event-like summary card: era name + bulleted members.
    const era = slot.era;
    const solid = era.color ? (resolveColor(era.color, palette) ?? accent) : accent;
    const cardFill = shapeFill(palette, solid, isDark, { solid: false });
    const titleColor = contrastText(
      cardFill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    const overflow = slot.members.length > ERA_MEMBER_MAX;
    const shown = overflow
      ? slot.members.slice(0, ERA_MEMBER_MAX - 1)
      : slot.members;
    const memberStrs = shown.map(
      (m) => `• ${m.date ? `${m.date}  ` : ''}${m.label}`
    );
    const lines = wrapDescription(memberStrs, charsPerLine);
    if (overflow) {
      lines.push({
        text: `+${slot.members.length - (ERA_MEMBER_MAX - 1)} more`,
        kind: 'plain',
      });
    }
    return {
      kind: 'era',
      event: null,
      era,
      members: slot.members,
      label: era.name,
      date: null,
      dateValue: null,
      lineNumber: era.lineNumber,
      eraName: era.name,
      color: solid,
      cardFill,
      titleColor,
      lines,
      cardH: cardHeight(lines),
      x: 0,
      side: summarySide,
      lane: 0,
      left: 0,
    };
  });

  // ── X positions ──
  // Collapse re-flows the spine, which breaks a linear date scale → fall back to
  // even spacing when any era is collapsed (broken-axis is a fast-follow).
  const scaled =
    parsed.options.scale &&
    !anyCollapsed &&
    placed.every((p) => p.dateValue !== null);
  const innerW = width - H_MARGIN * 2;
  if (scaled) {
    const vals = placed.map((p) => p.dateValue!);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    placed.forEach((p) => {
      p.x =
        H_MARGIN +
        (hi > lo ? ((p.dateValue! - lo) / (hi - lo)) * innerW : innerW / 2);
    });
    // Nudge near-coincident dots apart so they read as distinct (and give their
    // labels room). Events with the SAME date keep a shared position; only
    // distinct times are separated.
    const MIN_DOT_GAP = 16;
    let prevX = -Infinity;
    let prevVal: number | null = null;
    for (const p of [...placed].sort((a, b) => a.x - b.x)) {
      if (p.dateValue === prevVal) {
        p.x = prevX;
        continue;
      }
      if (p.x < prevX + MIN_DOT_GAP) p.x = prevX + MIN_DOT_GAP;
      prevX = p.x;
      prevVal = p.dateValue;
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
  // so a one-sided line (e.g. `side above`) doesn't push dates into the legend.
  const dateAbove = placed.some((p) => p.side === 'below' && p.date);
  const dateBelow = placed.some((p) => p.side === 'above' && p.date);
  const contentAbove = Math.max(ext('above'), dateAbove ? DATE_OFFSET + 10 : 0);
  const contentBelow = Math.max(ext('below'), dateBelow ? DATE_OFFSET + 10 : 0);
  // The era `]` bracket band lives beyond the content on the side opposite the cards.
  const aboveExt = contentAbove + (hasEras && eraSide === 'above' ? ERA_BLOCK : 0);
  const belowExt = contentBelow + (hasEras && eraSide === 'below' ? ERA_BLOCK : 0);
  const TOP_PAD = 14;
  const BOT_PAD = 14;
  const spineY = topUsed + TOP_PAD + aboveExt;
  const eraBaseY =
    eraSide === 'above'
      ? spineY - (contentAbove + 14)
      : spineY + (contentBelow + 14);
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
      .attr('data-line-number', p.lineNumber);
    if (p.kind === 'era') {
      // App hook: a collapsed-era summary card toggles back open on click.
      cardG.attr('data-era', p.era!.name).attr('data-era-collapsed', 'true');
    }
    if (onClickItem) {
      const ln = p.lineNumber;
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
        .text(p.label);
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
        label: p.label,
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
    if (p.kind !== 'event' || !p.date) continue;
    const key = `${Math.round(p.x)}|${p.date}`;
    if (!labelMap.has(key)) {
      labelMap.set(key, {
        x: p.x,
        date: p.date,
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

  // ── Dots on top (events + collapsed-era summaries both read as points) ──
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
      .attr('data-line-number', p.lineNumber);
  }

  // ── Era `]` brackets ─────────────────────────────────────────
  // A horizontal bracket on the side OPPOSITE the cards marks each era's run.
  // Expanded: spans the run. Collapsed: a short bracket centered on the summary,
  // so the era stays on the timeline even when folded. No chevrons — the bracket
  // (and the summary card) are the affordance; the app wires click-to-toggle.
  if (hasEras) {
    interface EraRun {
      era: EventLineEra;
      collapsed: boolean;
      firstX: number;
      lastX: number;
    }
    const runs: EraRun[] = [];
    let prevName: string | null = null;
    for (const p of placed) {
      const name = p.eraName;
      if (name && eraByName.has(name)) {
        if (prevName === name && runs.length > 0) {
          const r = runs[runs.length - 1]!;
          r.firstX = Math.min(r.firstX, p.x);
          r.lastX = Math.max(r.lastX, p.x);
        } else {
          runs.push({
            era: eraByName.get(name)!,
            collapsed: p.kind === 'era',
            firstX: p.x,
            lastX: p.x,
          });
        }
        prevName = name;
      } else {
        prevName = null;
      }
    }
    const clampX = (v: number): number =>
      Math.max(4, Math.min(contentW - 4, v));
    const cap = eraSide === 'above' ? 1 : -1; // bracket caps point toward the spine
    for (const r of runs) {
      const neutral = !r.era.color;
      const col = neutral
        ? palette.text
        : (resolveColor(r.era.color!, palette) ?? palette.text);
      const op = neutral ? 0.5 : 0.85;
      const x0 = clampX(
        r.collapsed ? r.firstX - ERA_COLLAPSED_HALF : r.firstX - 14
      );
      const x1 = clampX(
        r.collapsed ? r.firstX + ERA_COLLAPSED_HALF : r.lastX + 14
      );
      const y = eraBaseY;
      const eg = svg
        .append('g')
        .attr('data-era', r.era.name)
        .attr('data-era-collapsed', String(r.collapsed))
        .attr('data-line-number', r.era.lineNumber);
      eg.append('path')
        .attr(
          'd',
          `M${x0},${y + ERA_BRACKET_CAP * cap} L${x0},${y} L${x1},${y} L${x1},${y + ERA_BRACKET_CAP * cap}`
        )
        .attr('fill', 'none')
        .attr('stroke', col)
        .attr('stroke-width', 1.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('stroke-opacity', op);
      eg.append('text')
        .attr('x', (r.firstX + r.lastX) / 2)
        .attr('y', eraSide === 'above' ? y - 6 : y + ERA_LABEL_FONT + 4)
        .attr('text-anchor', 'middle')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', ERA_LABEL_FONT)
        .attr('font-weight', 700)
        .attr('fill', col)
        .attr('fill-opacity', neutral ? 0.85 : 1)
        .text(r.era.name);
      if (onClickItem) {
        const ln = r.era.lineNumber;
        eg.style('cursor', 'pointer').on('click', () => onClickItem(ln));
      }
    }
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
