// ============================================================
// Event Line — D3 SVG Renderer (spec §28)
// ============================================================
//
// Horizontal spine of point events. Each event: a dot at its date position
// (or even index under no-scale), a vertical leader line, and an org-style card
// (utils/card.ts `renderNodeCard` chrome + a hand-drawn divider and a
// pyramid/ring prose body). The event's date rides INSIDE its card as a muted
// subtitle, so it travels with the event instead of sitting on the axis. The
// spine carries no date tick ruler. Cards auto-alternate above/below and pack
// into stacked lanes on collision. The tag legend uses the shared
// `renderIntegratedLegend`.

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
  HAIRLINE_DASH,
} from '../utils/visual-conventions';
import {
  contrastText,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { renderNodeCard } from '../utils/card';
import { renderInlineText } from '../utils/inline-markdown';
import type { WrappedDescLine } from '../utils/wrapped-desc';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { formatDateLabel } from '../timeline/renderer';
import type { LegendGroupData } from '../utils/legend-types';
import { resolveActiveTagGroup, tagAttrKey } from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedEventLine } from './types';
import {
  CARD_PAD,
  CARD_W,
  DATE_SUBTITLE_H,
  DESC_FONT,
  DESC_LINE_H,
  DOT_R,
  LEADER_ABOVE,
  LEADER_BELOW,
  TITLE_LINE_H,
  layoutEventLine,
  type Placed,
} from './layout';

// ── Geometry constants ───────────────────────────────────────
// The card and lane geometry the layout also reads lives in `./layout`.
const CARD_BODY_TOP = HEADER_HEIGHT + SEPARATOR_GAP;
const DATE_SUBTITLE_FONT = 10;
// `no-box` only: a soft tag-tinted "shelf" sits behind the title + date so the
// header reads as a unit, and a full-strength colored bar on its spine-side edge
// is the leader's landing pad — keeping the dot→block link solid in dense charts.
const SHELF_TINT = 13; // % of the tag color mixed over the theme base
// Thickness of the colored landing lip. The shelf's corner radius is matched to
// it (SHELF_EDGE below) so the lip exactly fills the rounded corners and reads
// as part of the rounded rect — a thinner lip therefore also means slightly
// tighter shelf corners, which keeps the carry-through clean.
const SHELF_EDGE = 4;
// How the tag color is anchored on a no-box shelf. The old spine-side lip landed
// at a card's BOTTOM whenever the card sat above the spine — pixel-identical to
// the collapse-accent bar (utils/card.ts) that means "collapsed, click to
// expand" in org/sitemap/sketch, so it read as a false affordance. Options kept
// switchable while we settle the look:
//   'none'  — shaded shelf only, no colored lip (the leader still carries color)
//   'spine' — the original full-width lip on the shelf's spine-side edge
//   'left'  — a vertical lip on the card's spine-relative leading edge
// Lip thickness for 'spine'/'left' comes from SHELF_LIP.
const SHELF_EDGE_STYLE: 'none' | 'spine' | 'left' = 'spine';
const SHELF_LIP = 2;
const ERA_BRACKET_CAP = 8;
// Collapsed-era axis-break glyph (`≈` rotated 90°): two short parallel wavy
// strokes that cross the spine, with the spine blanked between them so the
// timeline visibly breaks where the folded span is.
const BREAK_HALF_H = 6; // squiggle extends this far above AND below the spine
const BREAK_AMP = 2.6; // horizontal wave amplitude
const BREAK_GAP = 5; // spacing between the two waves (= the spine gap width)
const ERA_LABEL_FONT = 11.5;

// ── Hover interactivity (preview only — inert in the resvg export path) ───────
// All effects are renderer-owned so they work identically in the app, the web
// editor, and Obsidian, and re-bind on every re-render (no orphaned listeners).
// CSS supplies the smooth self-effects + the dim/highlight state classes; a
// single delegated handler on the SVG root correlates the pieces of one event,
// an era's members, and legend-entry → category focus.
const HL = 'dgmo-evt-hl';
const DIM = 'dgmo-evt-dim';
const ERA_HL = 'dgmo-evt-era-hl';
// Clicking a legend entry collapses that tag value's cards (and their leaders)
// to bare dots — the dot stays on the spine in its tag color and still reveals
// its card on hover; the legend entry dims with a hollow swatch so the muted
// state is self-documenting and reversible. Preview-only
// (never in `exportMode`), so static SVG/PNG always carries the full set.
const COLLAPSED = 'dgmo-evt-collapsed';
const OFF = 'dgmo-evt-off';
const HIDDEN_ATTR = 'data-evt-hidden';
const HOVER_CSS =
  `.dgmo-event-dot{transition:transform .12s ease;transform-box:fill-box;transform-origin:center}` +
  `.dgmo-event-leader,.dgmo-event-card,.dgmo-event-era{transition:opacity .12s ease,filter .12s ease}` +
  `.dgmo-event-dot,.dgmo-event-card,.dgmo-event-era{cursor:default}` +
  `[data-legend-entry]{cursor:pointer}` +
  `.${DIM}{opacity:.2}` +
  `.dgmo-event-dot.${HL}{transform:scale(1.55)}` +
  `.dgmo-event-leader.${HL}{stroke-opacity:1;stroke-width:2.5}` +
  `.dgmo-event-card.${HL}{filter:drop-shadow(0 2px 5px rgba(0,0,0,.22))}` +
  `.dgmo-event-era.${ERA_HL}{filter:drop-shadow(0 1px 2px rgba(0,0,0,.28))}` +
  // Collapsed-to-dot: hide the card + its leader, keep the dot. A hover that
  // glows the event (HL on all its pieces) transiently re-reveals the card —
  // the extra class out-specifies both the collapse rule and DIM.
  `.dgmo-event-card.${COLLAPSED},.dgmo-event-leader.${COLLAPSED}{opacity:0;pointer-events:none}` +
  `.dgmo-event-card.${COLLAPSED}.${HL},.dgmo-event-leader.${COLLAPSED}.${HL}{opacity:1;pointer-events:auto}` +
  `[data-legend-entry].${OFF} text{opacity:.5}`;

export function renderEventLine(
  container: HTMLDivElement,
  parsed: ParsedEventLine,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  tagOverride?: string,
  /** Injectable clock for the computed `now` marker (§28.6b). Defaults to the
   *  live wall-clock; tests/snapshots pass a fixed date for determinism. */
  nowDate?: Date
): void {
  if (parsed.events.length === 0) return;

  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const heightHint = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || heightHint <= 0) return;

  const exportMode = !!exportDims;
  // Preview-only legend-muted tag values (persisted on the container so they
  // survive every re-render — era collapse/expand, resize, palette change). The
  // export path always builds the full set; muting is interactive chrome only.
  const hiddenSet = exportMode ? new Set<string>() : readHidden(container);
  const activeGroup = resolveActiveTagGroup(
    parsed.tagGroups,
    undefined,
    tagOverride
  );

  // ── Layout ── every position is computed as data first (./layout); the
  // rest of this function only draws what it returns.
  const {
    header: band,
    hasEras,
    eraSide,
    contentW,
    contentH,
    totalH,
    spineY,
    eraBaseY,
    cards,
    spine,
    eraBrackets,
    now,
  } = layoutEventLine(parsed, palette, isDark, {
    width,
    heightHint,
    exportMode,
    hiddenSet,
    activeGroup,
    nowDate,
  });
  const { showTitle, hasLegend, titleH, topUsed, placement: header } = band;

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

  // The preview canvas is padded past the content to fill the panel
  // (totalH > contentH). Stamp the tight height so capture-based exporters
  // (the app's fast path clones this live SVG) can crop the dead band.
  if (!exportMode && totalH > contentH) {
    svg.attr('data-content-height', Math.ceil(contentH));
  }

  if (!exportMode) svg.append('style').text(HOVER_CSS);

  // No opaque full-canvas background rect: the SVG's CSS `background` style
  // (and resvg's background option on PNG export) supplies the fill, so
  // transparent-theme / Obsidian embeds blend with the host instead of
  // showing a dark box — matching every other chart type.

  if (showTitle) {
    const t = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', header.inline ? header.titleX : contentW / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', header.inline ? header.titleAnchor : 'middle')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('data-line-number', parsed.titleLineNumber ?? 1)
      .text(parsed.title);
    if (onClickItem && parsed.titleLineNumber) {
      const ln = parsed.titleLineNumber;
      t.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }
  }

  // ── Shared tag legend ──
  if (hasLegend) {
    const legendG = svg
      .append('g')
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0, ${titleH})`
      );
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
      // Inline → left-origin so the wrapper's right-flush translate lands the
      // legend at the header's right edge; stacked → centered below the title
      // (== DEFAULT_POSITION, so the stacked output is byte-identical).
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
    });
    // Mute-toggling a category (§28.5) means clicking its legend entry, but the
    // painted swatch + label are a tiny target. Back each entry with a
    // transparent hit rect spanning its whole bounding box (+ padding) so the
    // entire swatch-and-label region is clickable. Preview only — exports carry
    // no interaction, so their snapshots are untouched.
    if (!exportMode) addLegendEntryHitAreas(legendG);
  }

  // ── Spine ──
  // A trailing TBD (open horizon) turns the spine DASHED past the last real
  // event — the timeline literally trails off into the unscheduled future.
  svg
    .append('line')
    .attr('x1', spine.left)
    .attr('y1', spineY)
    .attr('x2', spine.solidRight)
    .attr('y2', spineY)
    .attr('stroke', palette.text)
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round');
  if (spine.dashed) {
    svg
      .append('line')
      .attr('x1', spine.solidRight)
      .attr('y1', spineY)
      .attr('x2', spine.right)
      .attr('y2', spineY)
      .attr('stroke', palette.text)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-opacity', 0.45)
      .attr('stroke-dasharray', HAIRLINE_DASH);
  }

  // The `now` marker (§28.6b) is drawn LAST — after cards + dots — so its pin is
  // never hidden and it can test the finished card boxes for collision.

  // A bracketed TBD plots at an INFERRED point inside a known gap. The hollow
  // dot + "TBD" caption carry the uncertain read on their own — no dashed
  // "somewhere in here" whisker is drawn across the spine.

  // ── Leaders + cards ──
  // Leaders draw BEHIND every card (a card always covers the leaders beneath
  // it). A leader that passes through another card's box is faded so the text
  // stays clear; a collapsed era's leader stops AT its `⊓` bar.
  for (const { p, near, leaderFrom, leaderCrossesCard } of cards) {
    const leader = svg
      .append('line')
      .attr('class', 'dgmo-event-leader')
      .attr('x1', p.x)
      .attr('y1', leaderFrom)
      .attr('x2', p.x)
      .attr('y2', near)
      .attr('stroke', p.color)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', leaderCrossesCard ? 0.18 : p.future ? 0.4 : 0.65);
    // A future (TBD) event's leader stays SOLID but faded to 40% — the tentative
    // read comes from the fade, matching the faded card bar and dot (no dashes).
    applyHoverHooks(leader, p);
  }

  // Cards on top.
  let shelfClipSeq = 0;
  for (const { p, top } of cards) {
    const left = p.left;

    const cardG = svg
      .append('g')
      .attr('class', 'dgmo-event-card')
      .attr('transform', `translate(${left}, ${top})`)
      .attr('data-line-number', p.lineNumber);
    applyHoverHooks(cardG, p);
    if (p.kind === 'era') {
      // App hook: a collapsed-era summary card toggles back open on click.
      cardG.attr('data-era', p.era!.name).attr('data-era-collapsed', 'true');
    }
    if (onClickItem) {
      const ln = p.lineNumber;
      cardG.style('cursor', 'pointer').on('click', () => onClickItem(ln));
      // A transparent hit-rect over the whole card bounds so the ENTIRE card is
      // clickable — in no-box mode only the shelf + text glyphs are painted, so
      // without this the empty space around a collapsed era's bullet list would
      // not register clicks. Added first → sits beneath the visible content.
      cardG
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', CARD_W)
        .attr('height', p.cardH)
        .attr('fill', 'transparent')
        .attr('pointer-events', 'all');
    }

    // The date rides as a muted subtitle adjacent to the title, on the side AWAY
    // from the spine (so it reads title → date going outward). Collapsed-era cards
    // carry no date (their members list their own dates).
    const dateStr =
      p.kind === 'event' && p.date
        ? p.future
          ? 'TBD'
          : formatDateLabel(p.date)
        : null;
    const dateH = dateStr ? DATE_SUBTITLE_H : 0;

    if (parsed.options.noBox) {
      // Card-less style: a tag-colored label + muted date sitting on a soft
      // tag-tinted "shelf", with the leader docking into the shelf's colored
      // spine-side edge so the dot→block link stays solid in dense charts. The
      // title (the anchor) sits nearest the spine; for above-side blocks the
      // header order flips to description → date → title.
      const titleNearTop = p.side === 'below';
      const headBandTop = titleNearTop ? 0 : p.cardH - p.headerH;
      // The shelf wraps the whole header band (title + date). Its spine-side edge
      // (top for below-side blocks, bottom otherwise) is where the leader lands.
      const shelfTop = titleNearTop ? 0 : p.cardH - p.headerH - dateH;
      const shelfH = p.headerH + dateH;
      // Clip both the tint and the colored edge to ONE rounded-rect mask so the
      // edge carries through the shelf's curved corners (the collapse-bar idiom,
      // utils/card.ts) instead of reading as a straight bar bolted on top.
      const clipId = `dgmo-evt-shelf-${shelfClipSeq++}`;
      cardG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', 0)
        .attr('y', shelfTop)
        .attr('width', CARD_W)
        .attr('height', shelfH)
        .attr('rx', SHELF_EDGE);
      cardG
        .append('rect')
        .attr('x', 0)
        .attr('y', shelfTop)
        .attr('width', CARD_W)
        .attr('height', shelfH)
        .attr('clip-path', `url(#${clipId})`)
        .attr(
          'fill',
          parsed.options.fillMode
            ? p.color
            : mix(p.color, themeBaseBg(palette, isDark), SHELF_TINT)
        );
      // The colored leader-landing lip (skipped for 'none'). A future (TBD) card
      // draws the SAME solid lip faded to 40% — the tentative read comes from the
      // fade, matching the faded leader + dot (no dashes). fillMode already floods
      // the whole shelf with the color, so the lip is only meaningful when tinted.
      if (SHELF_EDGE_STYLE !== 'none' && !parsed.options.fillMode) {
        const lip =
          SHELF_EDGE_STYLE === 'left'
            ? {
                // vertical lip on the spine-relative leading edge
                x: 0,
                y: shelfTop,
                width: SHELF_LIP,
                height: shelfH,
              }
            : {
                x: 0,
                y: titleNearTop ? shelfTop : shelfTop + shelfH - SHELF_LIP,
                width: CARD_W,
                height: SHELF_LIP,
              };
        cardG
          .append('rect')
          .attr('x', lip.x)
          .attr('y', lip.y)
          .attr('width', lip.width)
          .attr('height', lip.height)
          .attr('clip-path', `url(#${clipId})`)
          .attr('fill', p.color)
          .attr('fill-opacity', p.future ? 0.4 : 1);
      }
      // On a solid shelf the title/date must contrast against the fill; the
      // default (tinted) shelf keeps the tag color for the title.
      const shelfText = parsed.options.fillMode
        ? contrastText(p.color, palette.textOnFillLight, palette.textOnFillDark)
        : p.color;
      // Title lines stack centered in the header band, each line centred by the
      // renderer rather than by an offset of ours — see the note above
      // `centerText` in utils/legend-d3.ts for why that distinction matters.
      const titleMid = headBandTop + p.headerH / 2;
      const titleTop =
        titleMid - ((p.titleLines.length - 1) * TITLE_LINE_H) / 2;
      for (let ti = 0; ti < p.titleLines.length; ti++) {
        cardG
          .append('text')
          .attr('x', CARD_PAD)
          .attr('y', titleTop + ti * TITLE_LINE_H)
          .attr('dominant-baseline', 'central')
          .attr('fill', shelfText)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', LABEL_FONT_SIZE)
          .attr('font-weight', 'bold')
          // In-bounds by loop guard.
          .text(p.titleLines[ti]!);
      }
      if (dateStr) {
        cardG
          .append('text')
          .attr('x', CARD_PAD)
          .attr(
            'y',
            (titleNearTop ? p.headerH : headBandTop - dateH) +
              DATE_SUBTITLE_FONT +
              2
          )
          .attr(
            'fill',
            parsed.options.fillMode
              ? mix(shelfText, p.color, 25)
              : mix(palette.text, palette.bg, 55)
          )
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', DATE_SUBTITLE_FONT)
          .attr('font-weight', 'bold')
          .text(dateStr);
      }
      if (p.lines.length > 0) {
        const startBaseline = titleNearTop
          ? p.headerH + SEPARATOR_GAP + dateH + DESC_FONT
          : CARD_PAD + DESC_FONT;
        renderBody(
          cardG,
          p.lines,
          palette.text,
          palette,
          startBaseline,
          p.bulletColors,
          p.bulletMeta
        );
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
        labelLines: p.titleLines,
        labelColor: p.titleColor,
        labelFontSize: LABEL_FONT_SIZE,
        headerHeight: p.headerH,
      });

      if (dateStr) {
        cardG
          .append('text')
          .attr('x', CARD_W / 2)
          .attr('y', p.headerH + DATE_SUBTITLE_FONT + 1)
          .attr('text-anchor', 'middle')
          .attr('fill', mix(p.titleColor, p.cardFill, 60))
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', DATE_SUBTITLE_FONT)
          .attr('font-weight', 'bold')
          .text(dateStr);
      }

      if (p.lines.length > 0) {
        // Divider (org convention: 1px, 30% opacity) below the title + date band.
        cardG
          .append('line')
          .attr('x1', 0)
          .attr('y1', p.headerH + dateH)
          .attr('x2', CARD_W)
          .attr('y2', p.headerH + dateH)
          .attr('stroke', p.titleColor)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);
        renderBody(
          cardG,
          p.lines,
          p.titleColor,
          palette,
          p.headerH + SEPARATOR_GAP + dateH + DESC_FONT,
          p.bulletColors,
          p.bulletMeta
        );
      }
    }
  }

  // No date ruler: dates ride inside the cards, and the spine carries no
  // year/period tick markers (removed by request — the timeline shows order,
  // not a measured date axis).

  // ── Dots (events) + span brackets (collapsed eras) on the spine ──
  for (const { p, eraBar } of cards) {
    if (eraBar) {
      // A collapsed era terminates on the spine as a `⊓` stretched across its
      // folded date range, so it keeps its true timeline footprint. No dot, no
      // separate bottom bracket — the card title names it. Matches the card's
      // color so the leader reads straight through.
      const col = p.color;
      // A `⊓`: the bar floats off the spine on the card's side (where the leader
      // lands), and a leg drops from each end down to rest its foot ON the spine.
      const { x0: bx0, x1: bx1, y: barY } = eraBar;
      const eg = svg
        .append('g')
        .attr('class', 'dgmo-event-era')
        .attr('data-era', p.era!.name)
        .attr('data-era-collapsed', 'true')
        .attr('data-line-number', p.lineNumber);
      if (onClickItem) {
        // Transparent hit-rect spanning the whole ⊓ + squiggle so the entire
        // bracket area is clickable, not just the thin strokes. Added first →
        // beneath the visible glyph.
        const hy0 = Math.min(barY, spineY) - 4;
        const hy1 = Math.max(barY, spineY) + 8;
        eg.append('rect')
          .attr('x', bx0)
          .attr('y', hy0)
          .attr('width', bx1 - bx0)
          .attr('height', hy1 - hy0)
          .attr('fill', 'transparent')
          .attr('pointer-events', 'all');
      }
      eg.append('path')
        .attr(
          'd',
          `M${bx0},${spineY} L${bx0},${barY} L${bx1},${barY} L${bx1},${spineY}`
        )
        .attr('fill', 'none')
        .attr('stroke', col)
        .attr('stroke-width', 1.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');
      // Axis-break glyph bisecting the bracket: the folded span is not to scale.
      // Blank the spine between the two waves first so the timeline reads as
      // genuinely broken, then draw the squiggles over the gap.
      const breakCx = (bx0 + bx1) / 2;
      eg.append('line')
        .attr('x1', breakCx - BREAK_GAP / 2)
        .attr('y1', spineY)
        .attr('x2', breakCx + BREAK_GAP / 2)
        .attr('y2', spineY)
        .attr('stroke', palette.bg)
        .attr('stroke-width', 5)
        .attr('stroke-linecap', 'butt');
      for (const d of axisBreakPaths(breakCx, spineY)) {
        eg.append('path')
          .attr('d', d)
          .attr('fill', 'none')
          .attr('stroke', palette.text)
          .attr('stroke-width', 2)
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round');
      }
      if (onClickItem) {
        const ln = p.lineNumber;
        eg.style('cursor', 'pointer').on('click', () => onClickItem(ln));
      }
      continue;
    }
    // A real event is a SOLID colored dot; a TBD is a colored RING with a
    // background fill (hollow) — opaque, never transparent. The tentative read
    // also carries through its faded leader + card bar and "TBD" caption.
    const dot = svg
      .append('circle')
      .attr('class', 'dgmo-event-dot')
      .attr('cx', p.x)
      .attr('cy', spineY)
      .attr('r', DOT_R)
      .attr('fill', p.future ? palette.bg : p.color)
      .attr('stroke', p.future ? p.color : palette.bg)
      .attr('stroke-width', 2)
      .attr('data-line-number', p.lineNumber);
    applyHoverHooks(dot, p);
  }

  // ── Era `]` brackets ─────────────────────────────────────────
  // A horizontal bracket on the side OPPOSITE the cards marks each era's run.
  // Expanded: spans the run. Collapsed: a short bracket centered on the summary,
  // so the era stays on the timeline even when folded. No chevrons — the bracket
  // (and the summary card) are the affordance; the app wires click-to-toggle.
  if (hasEras) {
    const cap = eraSide === 'above' ? 1 : -1; // bracket caps point toward the spine
    for (const r of eraBrackets) {
      const { x0, x1 } = r;
      const neutral = !r.era.color;
      const col = neutral
        ? palette.text
        : (resolveColor(r.era.color!, palette) ?? palette.text);
      const op = neutral ? 0.5 : 0.85;
      const y = eraBaseY;
      const eg = svg
        .append('g')
        .attr('class', 'dgmo-event-era')
        .attr('data-era', r.era.name)
        .attr('data-era-collapsed', 'false')
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
        .attr('font-weight', 'bold')
        .attr('fill', col)
        .attr('fill-opacity', neutral ? 0.85 : 1)
        .text(r.era.name);
      if (onClickItem) {
        const ln = r.era.lineNumber;
        eg.style('cursor', 'pointer').on('click', () => onClickItem(ln));
      }
    }
  }

  // ── `now` marker (§28.6b) — a "grounded pin" ──
  // A pin planted ON the spine (a small diamond) with a short stem up/down to a
  // labeled tab, dropped into a lane the cards don't occupy (its x and slot come
  // from the layout). Drawn last so nothing hides it.
  if (parsed.now && now) {
    const nowX = now.x;
    // The marker reads as a "today line": palette-native RED
    // (`palette.destructive`) — the Gantt today-line convention users already
    // parse as "right now." On-palette in every palette; distinct from the
    // green/orange/blue tag rotation. The fill family below softens the tab
    // FILL, but text/stroke/diamond/rule stay at full destructive ink.
    // A named color on the directive (§28.6b) replaces the red, for the
    // timeline whose own tags already use it — the shape carries the meaning.
    const base = themeBaseBg(palette, isDark);
    const nowColor = parsed.now.color
      ? (resolveColor(parsed.now.color, palette) ?? palette.destructive)
      : palette.destructive;
    // The tab honors the §1.9 fill family, mirroring the event cards: solid =
    // flooded, outline = hollow (bg fill + colored stroke), tint (default) =
    // soft fill with a hairline edge. The diamond + stem stay solid, like the
    // event dots. Text stays full-ink graphite in every mode except solid (where
    // the flooded chip needs light text), so the label never washes out.
    const fillMode = parsed.options.fillMode;
    const pillFill = shapeFill(palette, nowColor, isDark, { mode: fillMode });
    const pillStroke =
      fillMode === 'solid'
        ? 'none'
        : fillMode === 'outline'
          ? nowColor
          : mix(nowColor, base, 55); // tint: hairline so the chip edge reads
    const pillStrokeW =
      fillMode === 'solid' ? 0 : fillMode === 'outline' ? 1.3 : 1;
    const pillText =
      fillMode === 'solid'
        ? contrastText(
            pillFill,
            palette.textOnFillLight,
            palette.textOnFillDark
          )
        : nowColor;
    const { label, pillW, pillH, pillCX, y0, stemFrom, stemTo } = now;

    const nowG = svg
      .append('g')
      .attr('class', 'evt-now')
      .attr('data-now-x', nowX.toFixed(2));
    // DOTTED "today line" grounded at the spine. It dies quickly — faded to
    // nothing within the spine→card leader gap (`FADE_SPAN`), so it never
    // paints over an event card. The full-height reveal is HOVER-only (below):
    // at rest the rule stays in its own lane. (resvg supports linearGradient +
    // per-stop stop-opacity, so the resting rule exports.)
    const FADE_SPAN = Math.min(LEADER_ABOVE, LEADER_BELOW); // dies where cards begin
    const ruleTop = spineY - FADE_SPAN;
    const ruleBot = spineY + FADE_SPAN;
    const gradId = `evt-now-fade-${nowX.toFixed(0)}`;
    const grad = nowG
      .append('defs')
      .append('linearGradient')
      .attr('id', gradId)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 0)
      .attr('y1', ruleTop)
      .attr('x2', 0)
      .attr('y2', ruleBot);
    grad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', nowColor)
      .attr('stop-opacity', 0);
    grad
      .append('stop')
      .attr('offset', '50%')
      .attr('stop-color', nowColor)
      .attr('stop-opacity', 0.9);
    grad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', nowColor)
      .attr('stop-opacity', 0);
    nowG
      .append('line')
      .attr('x1', nowX)
      .attr('y1', ruleTop)
      .attr('x2', nowX)
      .attr('y2', ruleBot)
      .attr('stroke', `url(#${gradId})`)
      .attr('stroke-width', 1.6)
      .attr('stroke-dasharray', HAIRLINE_DASH)
      .attr('stroke-linecap', 'round');
    // Diamond planted on the spine — the exact "you are here" point.
    nowG
      .append('path')
      .attr('d', `M${nowX} ${spineY - 5} l5 5 l-5 5 l-5 -5 z`)
      .attr('fill', nowColor);
    // Stem from the spine to the tab.
    nowG
      .append('line')
      .attr('x1', nowX)
      .attr('y1', stemFrom)
      .attr('x2', nowX)
      .attr('y2', stemTo)
      .attr('stroke', nowColor)
      .attr('stroke-width', 1.6);
    // Labeled tab.
    nowG
      .append('rect')
      .attr('x', pillCX - pillW / 2)
      .attr('y', y0)
      .attr('width', pillW)
      .attr('height', pillH)
      .attr('rx', pillH / 2)
      .attr('fill', pillFill)
      .attr('stroke', pillStroke)
      .attr('stroke-width', pillStrokeW);
    nowG
      .append('text')
      .attr('x', pillCX)
      .attr('y', y0 + pillH / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 10.5)
      .attr('font-weight', 'bold')
      .attr('fill', pillText)
      .text(label);

    // HOVER reveal (preview only): a full-height dotted rule that appears only
    // while the pointer is over the marker, so at rest the today-line never
    // sits atop cards. Lowered within nowG so it rides ABOVE cards but BELOW
    // the diamond/tab. Static exports skip it — nothing to hover.
    if (!exportMode) {
      const hoverRule = nowG
        .append('line')
        .attr('class', 'evt-now-rule-full')
        .attr('x1', nowX)
        .attr('y1', Math.max(topUsed, 2))
        .attr('x2', nowX)
        .attr('y2', totalH - 2)
        .attr('stroke', nowColor)
        .attr('stroke-width', 1.4)
        .attr('stroke-dasharray', HAIRLINE_DASH)
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0)
        .style('transition', 'opacity 120ms ease')
        .style('pointer-events', 'none');
      hoverRule.lower();
      const nowNode = nowG.node();
      if (nowNode) {
        nowNode.addEventListener('mouseenter', () =>
          hoverRule.attr('opacity', 0.5)
        );
        nowNode.addEventListener('mouseleave', () =>
          hoverRule.attr('opacity', 0)
        );
      }
    }
  }

  // ── Hover + legend-toggle wiring (preview only) ──
  // Delegated handlers on the SVG root, so they re-bind with every render and
  // never leak per-node listeners. Hover priority: legend entry → category
  // focus, else era bracket → era + members, else any event piece → whole-event
  // glow. A legend CLICK mutes that category and re-renders.
  if (!exportMode) {
    const root = svg.node();
    wireEventLineHover(root);
    if (root) {
      wireLegendToggle(container, root, () =>
        renderEventLine(
          container,
          parsed,
          palette,
          isDark,
          onClickItem,
          exportDims,
          tagOverride,
          nowDate
        )
      );
      // Re-apply the persisted muted state to the freshly built SVG (live event
      // cards collapse-to-dot + legend entries struck/hollow). Era bullets are
      // already excluded at build time above.
      applyEvtHidden(container, root);
    }
  }
}

/** Share the same hover hooks across every piece of one event: a common
 *  `data-evt` id (hover any → light all), the enclosing era for era focus, and
 *  `data-tag-<group>` values mirroring the legend's `data-legend-entry`. */
function applyHoverHooks<E extends d3Selection.BaseType>(
  sel: d3Selection.Selection<E, unknown, null, undefined>,
  p: Placed
): void {
  sel.attr('data-evt', p.lineNumber);
  if (p.eraName) sel.attr('data-evt-era', p.eraName);
  if (p.event) {
    for (const [k, v] of Object.entries(p.event.metadata)) {
      sel.attr(`data-tag-${tagAttrKey(k)}`, String(v).toLowerCase());
    }
  }
}

// Everything that can dim. The spine, the year ruler, the title, and the legend
// carry none of these classes, so they always stay lit — focusing anything
// fades the rest, never the timeline itself.
const DIMMABLE_SEL =
  '.dgmo-event-dot,.dgmo-event-leader,.dgmo-event-card,.dgmo-event-era';
const PIN_ATTR = 'data-evt-pin';

/** A focus target: a single event (by its `data-evt` id, = source line), an era
 *  (by name), or a tag value (a legend category). `null` clears the focus. */
export type EventLineFocus =
  | { readonly kind: 'event'; readonly id: string }
  | { readonly kind: 'era'; readonly name: string }
  | { readonly kind: 'tag'; readonly group: string; readonly value: string };

function clearEvtFocus(root: Element): void {
  root
    .querySelectorAll(`.${HL},.${DIM},.${ERA_HL}`)
    .forEach((el) => el.classList.remove(HL, DIM, ERA_HL));
}

// Dim every dimmable element that isn't part of the subject; glow/emphasize the
// subject. A spec that matches nothing is a no-op (never an all-dim void).
function applyEvtFocus(root: Element, spec: EventLineFocus | null): void {
  clearEvtFocus(root);
  if (!spec) return;
  const els = [...root.querySelectorAll(DIMMABLE_SEL)];
  if (spec.kind === 'event') {
    const keep = (el: Element): boolean =>
      el.getAttribute('data-evt') === spec.id;
    if (!els.some(keep)) return;
    els.forEach((el) => el.classList.add(keep(el) ? HL : DIM));
    return;
  }
  if (spec.kind === 'era') {
    const keep = (el: Element): boolean =>
      el.getAttribute('data-evt-era') === spec.name ||
      (el.classList.contains('dgmo-event-era') &&
        el.getAttribute('data-era') === spec.name);
    if (!els.some(keep)) return;
    els.forEach((el) => {
      if (!keep(el)) el.classList.add(DIM);
      else if (el.classList.contains('dgmo-event-era'))
        el.classList.add(ERA_HL);
    });
    return;
  }
  const attr = `data-tag-${tagAttrKey(spec.group)}`;
  const matches = (el: Element): boolean =>
    el.getAttribute(attr) === spec.value;
  // Member bullets folded inside a collapsed era carry the same `data-tag-*` as
  // their source events, so a legend hover can surface them too.
  const bullets = [...root.querySelectorAll('.dgmo-evt-bullet')];
  // An era that holds ≥1 matching member bullet stays lit (its card, spine glyph,
  // and leader), with the non-matching member bullets dimmed inside it.
  const litEras = new Set<string>();
  for (const b of bullets) {
    if (!matches(b)) continue;
    const card = b.closest('.dgmo-event-card');
    const era =
      card?.getAttribute('data-era') ?? card?.getAttribute('data-evt-era');
    if (era) litEras.add(era);
  }
  if (!els.some(matches) && litEras.size === 0) return;
  const inLitEra = (el: Element): boolean => {
    const era = el.getAttribute('data-era') ?? el.getAttribute('data-evt-era');
    return !!era && litEras.has(era);
  };
  els.forEach((el) => {
    if (!matches(el) && !inLitEra(el)) el.classList.add(DIM);
  });
  for (const b of bullets) if (!matches(b)) b.classList.add(DIM);
}

function readPin(root: Element): EventLineFocus | null {
  const raw = root.getAttribute(PIN_ATTR);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EventLineFocus;
  } catch {
    return null;
  }
}

/**
 * Clear the preview-only legend-muted tag set persisted on a container (the
 * collapsed-to-dot categories from §28.5). View state is per-document, so a host
 * resets it when the source changes (switching files / edits) — the same
 * contract the app uses for live era collapse toggles. No-op if nothing is set.
 */
export function clearEventLineMuted(container: HTMLElement): void {
  container.removeAttribute(HIDDEN_ATTR);
}

/**
 * Pin a persistent focus on a rendered event-line — e.g. driven by the editor
 * cursor — dimming everything except the target, exactly like hover. Hovering
 * temporarily overrides the pin; leaving the diagram reverts to it. Pass `null`
 * to clear. No-op when the container holds no event-line SVG.
 */
export function focusEventLine(
  container: HTMLElement,
  spec: EventLineFocus | null
): void {
  const root = container.querySelector('svg');
  if (!root) return;
  if (spec) root.setAttribute(PIN_ATTR, JSON.stringify(spec));
  else root.removeAttribute(PIN_ATTR);
  applyEvtFocus(root, spec);
}

// ── Legend-toggled card hiding (preview only) ───────────────
// A muted category is recorded on the CONTAINER (not the throwaway SVG) as a
// `"group:value"` list, so it survives every re-render — era collapse/expand,
// resize, palette change. The hidden set is independent of focus state
// (HL/DIM): collapse and focus compose because they live in different classes.
function readHidden(el: Element): Set<string> {
  const raw = el.getAttribute(HIDDEN_ATTR);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

// Prepend a transparent hit rect to each legend entry so the full swatch+label
// region toggles its category, not just the tiny dot/glyphs. Sized from the
// entry's own bbox (+ padding) and inserted first so it sits behind the visible
// marks; a delegated click on it still resolves to the entry via `closest()`.
function addLegendEntryHitAreas(
  legendG: d3Selection.Selection<SVGGElement, unknown, null, undefined>
): void {
  const PAD_X = 6;
  const PAD_Y = 7;
  legendG
    .selectAll<SVGGElement, unknown>('[data-legend-entry]')
    .each(function () {
      let bb: { x: number; y: number; width: number; height: number };
      try {
        bb = this.getBBox();
      } catch {
        return; // no layout (e.g. jsdom) — the entry itself stays clickable
      }
      if (!bb.width || !bb.height) return;
      d3Selection
        .select(this)
        .insert('rect', ':first-child')
        .attr('x', bb.x - PAD_X)
        .attr('y', bb.y - PAD_Y)
        .attr('width', bb.width + PAD_X * 2)
        .attr('height', bb.height + PAD_Y * 2)
        .attr('fill', 'transparent')
        .attr('data-legend-hit', '');
    });
}

// Reconcile the rendered SVG to the container's hidden set: collapse matching
// cards/leaders (never the dot) and mark the matching legend entries muted
// (struck label + hollow swatch). The collapsed-era BULLETS are handled at build
// time (excluded from the summary card); this covers the live event cards and
// the legend chrome. Idempotent — safe to call on every render.
function applyEvtHidden(container: Element, root: Element): void {
  const hidden = readHidden(container);
  const isHidden = (el: Element): boolean => {
    for (const key of hidden) {
      const sep = key.indexOf(':');
      if (sep < 0) continue;
      const group = key.slice(0, sep);
      const value = key.slice(sep + 1);
      if (el.getAttribute(`data-tag-${tagAttrKey(group)}`) === value)
        return true;
    }
    return false;
  };
  root
    .querySelectorAll('.dgmo-event-card,.dgmo-event-leader')
    .forEach((el) => el.classList.toggle(COLLAPSED, isHidden(el)));
  root.querySelectorAll('[data-legend-entry]').forEach((entry) => {
    const group = entry
      .closest('[data-legend-group]')
      ?.getAttribute('data-legend-group');
    const value = entry.getAttribute('data-legend-entry');
    setLegendEntryOff(entry, !!group && hidden.has(`${group}:${value}`));
  });
}

// Hollow the legend swatch (fill → none, stroke = its own color) for the muted
// state, restoring the stashed fill when un-muted.
function setLegendEntryOff(entry: Element, off: boolean): void {
  entry.classList.toggle(OFF, off);
  const c = entry.querySelector('circle');
  if (!c) return;
  if (off) {
    if (!c.hasAttribute('data-fill0'))
      c.setAttribute('data-fill0', c.getAttribute('fill') ?? '');
    c.setAttribute('fill', 'none');
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a circle with no fill stores an empty data-fill0, which must still fall back to currentColor
    c.setAttribute('stroke', c.getAttribute('data-fill0') || 'currentColor');
    c.setAttribute('stroke-width', '1.5');
  } else {
    const fill0 = c.getAttribute('data-fill0');
    if (fill0 !== null) c.setAttribute('fill', fill0);
    c.removeAttribute('stroke');
    c.removeAttribute('stroke-width');
  }
}

function toggleHidden(container: Element, group: string, value: string): void {
  const hidden = readHidden(container);
  const key = `${group}:${value}`;
  if (hidden.has(key)) hidden.delete(key);
  else hidden.add(key);
  container.setAttribute(HIDDEN_ATTR, JSON.stringify([...hidden]));
}

// A click on a legend entry mutes/un-mutes that tag value, then re-renders so
// both effects flow from one build: live event cards collapse-to-dot AND any
// member folded inside a collapsed era drops out of its summary bullets. The
// hidden set lives on the container, so the rebuild (and any later era toggle /
// resize) reads it back and stays in sync. Renderer-owned, so it behaves the
// same in the app, web editor, and Obsidian.
function wireLegendToggle(
  container: HTMLElement,
  root: SVGSVGElement,
  rerender: () => void
): void {
  root.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== 'function') return;
    const entry = t.closest('[data-legend-entry]');
    if (!entry) return;
    const value = entry.getAttribute('data-legend-entry');
    const group = entry
      .closest('[data-legend-group]')
      ?.getAttribute('data-legend-group');
    if (!group || !value) return;
    toggleHidden(container, group, value);
    // Preserve the editor-cursor focus pin across the rebuild — the host
    // re-applies it only on its own renders, not on this renderer-owned one.
    const pin = readPin(root);
    rerender();
    if (pin) focusEventLine(container, pin);
    // This rebuild replaced the SVG, so any post-render normalization the host
    // applied to the previous root (e.g. fit-to-canvas sizing) is gone. Signal
    // the host to re-apply it. Hosts that render the renderer's intrinsic size
    // verbatim can ignore the event.
    if (typeof CustomEvent !== 'undefined')
      container.dispatchEvent(new CustomEvent('dgmo-event-line-rerender'));
  });
}

// One delegated handler: hover focuses transiently; on mouseout (or over bare
// canvas) it reverts to the pinned cursor focus rather than clearing outright.
function wireEventLineHover(root: SVGSVGElement | null): void {
  if (!root) return;
  root.addEventListener('mouseover', (e) => {
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== 'function') return;

    const entry = t.closest('[data-legend-entry]');
    if (entry) {
      const value = entry.getAttribute('data-legend-entry');
      const group = entry
        .closest('[data-legend-group]')
        ?.getAttribute('data-legend-group');
      applyEvtFocus(
        root,
        group && value ? { kind: 'tag', group, value } : readPin(root)
      );
      return;
    }
    const era = t.closest('.dgmo-event-era');
    if (era) {
      applyEvtFocus(root, {
        kind: 'era',
        name: era.getAttribute('data-era') ?? '',
      });
      return;
    }
    const evt = t.closest('[data-evt]');
    if (evt) {
      // A collapsed-era summary card carries `data-era` as well as `data-evt`;
      // focus it as an ERA so its `⊓` bracket + axis-break squiggle (a
      // `.dgmo-event-era` group, no `data-evt`) stay lit with the card instead
      // of fading. Plain events focus by their `data-evt` id.
      const eraName = evt.getAttribute('data-era');
      applyEvtFocus(
        root,
        eraName
          ? { kind: 'era', name: eraName }
          : { kind: 'event', id: evt.getAttribute('data-evt') ?? '' }
      );
      return;
    }
    // Bare canvas / title / legend chrome → revert to the pinned focus.
    applyEvtFocus(root, readPin(root));
  });
  root.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !root.contains(to)) applyEvtFocus(root, readPin(root));
  });
}

export function renderEventLineForExport(
  container: HTMLDivElement,
  parsed: ParsedEventLine,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  tagOverride?: string,
  nowDate?: Date
): void {
  renderEventLine(
    container,
    parsed,
    palette,
    isDark,
    undefined,
    exportDims,
    tagOverride,
    nowDate
  );
}

// ── helpers ──

// A vertical "≈ rotated 90°" axis-break glyph: two parallel wavy strokes that
// cross the timeline at a collapsed era to signal the span there is folded and
// NOT drawn to scale. Returns the two path `d` strings, centered on (cx, cy).
function axisBreakPaths(cx: number, cy: number): [string, string] {
  const HUMPS = 2;
  const STEPS = 48;
  const wave = (x0: number): string => {
    let d = '';
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = cy - BREAK_HALF_H + t * 2 * BREAK_HALF_H;
      const x = x0 + BREAK_AMP * Math.sin(t * Math.PI * HUMPS);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      if (i < STEPS) d += ' ';
    }
    return d;
  };
  return [wave(cx - BREAK_GAP / 2), wave(cx + BREAK_GAP / 2)];
}

function renderBody(
  cardG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  lines: WrappedDescLine[],
  bodyColor: string,
  palette: PaletteColors,
  startBaseline = CARD_BODY_TOP + DESC_FONT,
  // Per-bullet color (collapsed-era member list — each bullet takes its event's
  // tag color). Consumed in bullet-first order; falls back to bodyColor.
  bulletColors: readonly string[] = [],
  // Per-bullet tag metadata, same order as bulletColors. Stamped on each bullet
  // line as `data-tag-<group>` (+ the `dgmo-evt-bullet` class) so a legend hover
  // can highlight matching members inside a folded era.
  bulletMeta: readonly Readonly<Record<string, string>>[] = []
): void {
  let y = startBaseline;
  let bulletIdx = 0;
  // The whole bulleted entry (marker + text) takes its member's tag color so a
  // collapsed era reads like a mini tag-colored list; continuation lines keep
  // it, plain lines (e.g. "+N more") fall back to the body color.
  let lineColor = bodyColor;
  let lineMeta: Readonly<Record<string, string>> | null = null;
  const tagBullet = (
    el: d3Selection.Selection<SVGTextElement, unknown, null, undefined>
  ): void => {
    if (!lineMeta) return;
    el.attr('class', 'dgmo-evt-bullet');
    for (const [k, v] of Object.entries(lineMeta))
      el.attr(`data-tag-${tagAttrKey(k)}`, String(v).toLowerCase());
  };
  for (const line of lines) {
    const isBullet =
      line.kind === 'bullet-first' || line.kind === 'bullet-cont';
    const bodyX = CARD_PAD + (isBullet ? 12 : 0);
    if (line.kind === 'bullet-first') {
      lineColor = bulletColors[bulletIdx] ?? bodyColor;
      lineMeta = bulletMeta[bulletIdx] ?? null;
      bulletIdx++;
      const marker = cardG
        .append('text')
        .attr('x', CARD_PAD)
        .attr('y', y)
        .attr('text-anchor', 'start')
        .attr('fill', lineColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', DESC_FONT)
        .attr('font-weight', 'bold')
        .text('•');
      tagBullet(marker);
    } else if (!isBullet) {
      lineColor = bodyColor;
      lineMeta = null;
    }
    const t = cardG
      .append('text')
      .attr('x', bodyX)
      .attr('y', y)
      .attr('text-anchor', 'start')
      .attr('fill', isBullet ? lineColor : bodyColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', DESC_FONT);
    if (isBullet) tagBullet(t);
    renderInlineText(t, line.text, palette);
    y += DESC_LINE_H;
  }
}
