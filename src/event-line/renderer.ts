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
} from '../utils/visual-conventions';
import {
  contrastText,
  getSeriesColors,
  mix,
  shapeFill,
  themeBaseBg,
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
import { formatDateLabel } from '../timeline/renderer';
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
// The event's date rides INSIDE the card as a muted subtitle directly adjacent to
// the title (on the side away from the spine), so a date travels with its event
// instead of sitting on the axis. This much header height is reserved for it.
const DATE_SUBTITLE_H = 15;
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
// Era `]` bracket band: depth reserved on the side opposite the cards.
const ERA_BLOCK = 30;
const ERA_BRACKET_CAP = 8;
// Padding each era bracket extends past its first/last member dot, and the gap
// kept on each side of a seam when two adjacent brackets are clamped apart.
const ERA_BRACKET_PAD = 14;
const ERA_SEAM_GAP = 3;
// Collapsed-era axis-break glyph (`≈` rotated 90°): two short parallel wavy
// strokes that cross the spine, with the spine blanked between them so the
// timeline visibly breaks where the folded span is.
const BREAK_HALF_H = 6; // squiggle extends this far above AND below the spine
const BREAK_AMP = 2.6; // horizontal wave amplitude
const BREAK_GAP = 5; // spacing between the two waves (= the spine gap width)
// Collapsed era: the `⊓` bar floats this far off the spine (on the card's side);
// its legs drop from the bar to rest their feet ON the timeline.
const ERA_LEG = 13;
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
// its card on hover; the legend entry renders struck-through with a hollow
// swatch so the muted state is self-documenting and reversible. Preview-only
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
  `[data-legend-entry].${OFF} text{text-decoration:line-through;opacity:.5}`;

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
  /** True for a `TBD` future event — drawn with a hollow dot + dashed leader. */
  future: boolean;
  /** Bracketed-TBD gap `[lo, hi]` (dateValue units) for the "somewhere in here"
   *  whisker; null for a trailing TBD (dashed spine tail) or any real event. */
  futureSpan: readonly [number, number] | null;
  lineNumber: number;
  /** Name of the enclosing era (for bracket runs), or null. */
  eraName: string | null;
  color: string;
  cardFill: string;
  titleColor: string;
  lines: WrappedDescLine[];
  /** For a collapsed era: per-member tag color, in member order (one per bullet). */
  bulletColors: readonly string[];
  cardH: number;
  x: number;
  side: Side;
  lane: number;
  left: number;
  /** Collapsed era only: half the date-span width in px, so its bracket stretches
   *  across the folded run (`x` is the span MIDPOINT). 0 for events. */
  spanHalf: number;
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
  // Preview-only legend-muted tag values (persisted on the container so they
  // survive every re-render — era collapse/expand, resize, palette change). The
  // export path always builds the full set; muting is interactive chrome only.
  const hiddenSet = exportMode ? new Set<string>() : readHidden(container);
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
  // Only EXPANDED eras draw the bottom `]` bracket band (and reserve room for
  // it). A collapsed era is marked by a span bracket on the spine instead.
  const hasExpandedEra = parsed.events.some(
    (e) => e.era && eraByName.has(e.era) && !collapsedSet.has(e.era)
  );
  const sideOpt = parsed.options.side;
  const alternate = sideOpt === 'alternate';
  const eraSide: Side = alternate
    ? 'below'
    : sideOpt === 'above'
      ? 'below'
      : 'above';

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
  const cardHeight = (lines: WrappedDescLine[], hasDate: boolean): number =>
    HEADER_HEIGHT +
    (hasDate ? DATE_SUBTITLE_H : 0) +
    (lines.length > 0 ? SEPARATOR_GAP + lines.length * DESC_LINE_H : 0) +
    (lines.length > 0 ? CARD_PAD : 6);
  // An event's solid color = its active-tag color (or the neutral accent).
  const eventColor = (ev: EventLineEvent): string => {
    if (!activeGroup) return accent;
    const tc = resolveTagColor(
      ev.metadata,
      parsed.tagGroups as TagGroup[],
      activeGroup
    );
    return tc && tc !== NEUTRAL_TAG
      ? (resolveColor(tc, palette) ?? tc)
      : accent;
  };
  let evIdx = 0;
  const placed: Placed[] = slots.map((slot): Placed => {
    // Events AND collapsed eras share the alternation in source order, so a
    // collapsed era takes its natural above/below slot like any other entry.
    const side: Side = alternate
      ? evIdx++ % 2 === 0
        ? 'above'
        : 'below'
      : (sideOpt as Side);
    if (slot.kind === 'event') {
      const event = slot.event;
      const solid = eventColor(event);
      const cardFill = shapeFill(palette, solid, isDark, { solid: false });
      const titleColor = contrastText(
        cardFill,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
      const lines = wrapDescription(event.description, charsPerLine);
      return {
        kind: 'event',
        event,
        era: null,
        members: [],
        label: event.label,
        date: event.date,
        dateValue: event.dateValue,
        future: event.future,
        futureSpan: event.futureSpan,
        lineNumber: event.lineNumber,
        eraName: event.era,
        color: solid,
        cardFill,
        titleColor,
        lines,
        bulletColors: [],
        cardH: cardHeight(lines, !!event.date),
        x: 0,
        side,
        lane: 0,
        left: 0,
        spanHalf: 0,
      };
    }
    // Collapsed era → an event-like summary card: era name + bulleted members.
    // Color: an explicit `[Name] color` wins; otherwise the era is BLACK unless
    // every member shares one tag, in which case it adopts that tag color.
    const era = slot.era;
    const memberColors = slot.members.map(eventColor);
    const uniformTag =
      activeGroup != null &&
      memberColors.length > 0 &&
      memberColors.every((c) => c === memberColors[0]) &&
      memberColors[0] !== accent;
    const solid = era.color
      ? (resolveColor(era.color, palette) ?? palette.text)
      : uniformTag
        ? memberColors[0]!
        : palette.text;
    // A collapsed era is a folded summary — render it much lighter than an event
    // card (a faint ~10% tint) so it recedes rather than competing for attention.
    const cardFill = mix(solid, themeBaseBg(palette, isDark), 10);
    const titleColor = contrastText(
      cardFill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    // A collapsed era folds a date RANGE into one card. Anchor it at the span
    // MIDPOINT so its card sits over the middle of the run, and its bracket (drawn
    // later) stretches across the whole [first … last] member range — the folded
    // span keeps its true timeline footprint instead of collapsing to a point.
    let spanLo: number | null = null;
    let spanHi: number | null = null;
    for (const m of slot.members) {
      if (m.dateValue === null) continue;
      if (spanLo === null || m.dateValue < spanLo) spanLo = m.dateValue;
      if (spanHi === null || m.dateValue > spanHi) spanHi = m.dateValue;
    }
    const repDateValue =
      spanLo !== null && spanHi !== null ? (spanLo + spanHi) / 2 : null;
    // Show every folded member — a collapsed era summarizes the whole run, so
    // the card grows to fit rather than truncating with a "+N more" line. A
    // member whose tag value is legend-muted (§28.5) drops out of the bullet
    // list too — so de-selecting a category quiets it whether its events are
    // expanded (collapsed-to-dot) or folded inside a collapsed era. The card
    // height auto-shrinks to the surviving bullets.
    const visibleMembers = slot.members.filter(
      (m) => !eventTagHidden(m.metadata, hiddenSet)
    );
    const memberStrs = visibleMembers.map(
      (m) =>
        `• ${m.date ? `${m.future ? 'TBD' : formatDateLabel(m.date)}  ` : ''}${m.label}`
    );
    const bulletColors = visibleMembers.map(eventColor);
    const lines = wrapDescription(memberStrs, charsPerLine);
    return {
      kind: 'era',
      event: null,
      era,
      members: slot.members,
      label: era.name,
      date: null,
      dateValue: repDateValue,
      future: false,
      futureSpan: null,
      lineNumber: era.lineNumber,
      eraName: era.name,
      color: solid,
      cardFill,
      titleColor,
      lines,
      bulletColors,
      cardH: cardHeight(lines, false),
      x: 0,
      side,
      lane: 0,
      left: 0,
      spanHalf: 0,
    };
  });

  // ── X positions ──
  // Draw to scale whenever every slot has a date — a collapsed era is anchored at
  // its earliest member (above), so it scales like any other point. Even spacing
  // is reserved for explicit `no-scale` or a slot that genuinely lacks a date.
  const scaled =
    parsed.options.scale && placed.every((p) => p.dateValue !== null);
  const innerW = width - H_MARGIN * 2;
  const MIN_DOT_GAP = 16; // legibility floor between coincident-ish dots
  const STRETCH_CAP = 8; // widen the date axis at most this many ×

  // BROKEN AXIS: a collapsed era is COMPRESSED to a fixed-width capsule (its
  // squiggle says "lots of timeline folded here"), so the expanded events take
  // over the freed width and draw to scale among themselves. The timeline is a
  // chronological sequence of SEGMENTS — a capsule for each collapsed era, and a
  // to-scale "run" for each maximal stretch of expanded events between them. Dead
  // time (gaps with no expanded events) costs only a fixed `SEG_GAP`, never width.
  const COLLAPSE_W = 64; // fixed px width of a collapsed-era capsule
  const SEG_GAP = 16; // gap between adjacent axis segments
  type Seg =
    | { kind: 'capsule'; p: Placed }
    | { kind: 'run'; events: Placed[]; lo: number; hi: number };
  const segments: Seg[] = [];
  let run: Placed[] = [];
  const flushRun = (): void => {
    if (!run.length) return;
    const ds = run.map((e) => e.dateValue!);
    segments.push({
      kind: 'run',
      events: run,
      lo: Math.min(...ds),
      hi: Math.max(...ds),
    });
    run = [];
  };
  for (const p of placed) {
    if (p.kind === 'era') {
      flushRun();
      segments.push({ kind: 'capsule', p });
    } else {
      run.push(p);
    }
  }
  flushRun();
  // Total to-scale time = the sum of every expanded run's own date span.
  const totalRunTime = segments.reduce(
    (s, seg) => s + (seg.kind === 'run' ? seg.hi - seg.lo : 0),
    0
  );

  // Position every entry by walking the segments left-to-right. Expanded runs
  // collectively scale across `innerW × stretch`; capsules + inter-segment gaps add
  // a fixed amount on top. `stretch` (≥1) widens the expanded scale to fill a wide
  // panel without distorting proportions; a small MIN_DOT_GAP floor only de-overlaps
  // coincident-ish dots. Re-runnable for any stretch so the search below probes freely.
  const place = (stretch: number): void => {
    if (scaled) {
      const pxPerUnit =
        totalRunTime > 0 ? (innerW * stretch) / totalRunTime : 0;
      // Each collapsed-era card centers on its capsule. When two folded eras land
      // on the SAME side their wide cards would overlap (capsules are only
      // COLLAPSE_W apart), forcing the card off its bracket. Float the capsule
      // right instead — enough that its centered card clears the previous
      // same-side era card — so the card stays squarely over its `⊓` (a straight
      // vertical leader) and the spine spacing absorbs the slack. Opposite-side
      // eras stay tight (their cards don't collide).
      const eraCardRight: Record<Side, number> = {
        above: -Infinity,
        below: -Infinity,
      };
      let cursor = H_MARGIN;
      for (const seg of segments) {
        if (seg.kind === 'capsule') {
          let x = cursor + COLLAPSE_W / 2;
          const minX = Math.max(
            CARD_W / 2 + 6, // keep the centered card on-canvas (left ≥ 6)
            eraCardRight[seg.p.side] + FAN_GAP + CARD_W / 2 // clear prior same-side card
          );
          if (x < minX) {
            cursor += minX - x;
            x = minX;
          }
          seg.p.x = x;
          seg.p.spanHalf = COLLAPSE_W / 2;
          eraCardRight[seg.p.side] = x + CARD_W / 2;
          cursor += COLLAPSE_W + SEG_GAP;
        } else {
          for (const e of seg.events) {
            e.x = cursor + (e.dateValue! - seg.lo) * pxPerUnit;
            e.spanHalf = 0;
          }
          cursor += (seg.hi - seg.lo) * pxPerUnit + SEG_GAP;
        }
      }
      // Within a run, distinct dates that map closer than MIN_DOT_GAP get nudged
      // apart for legibility; identical dates keep a shared x.
      let prevX = -Infinity;
      let prevVal: number | null = null;
      for (const p of [...placed].sort((a, b) => a.x - b.x)) {
        if (p.kind === 'era') {
          prevX = p.x + p.spanHalf;
          prevVal = null;
          continue;
        }
        if (p.dateValue === prevVal) {
          p.x = prevX;
          continue;
        }
        if (p.x < prevX + MIN_DOT_GAP) p.x = prevX + MIN_DOT_GAP;
        prevX = p.x;
        prevVal = p.dateValue;
      }
    } else {
      placed.forEach((p) => {
        p.spanHalf = 0;
      });
      const n = placed.length;
      const spacing = n > 1 ? Math.max(MIN_SPACING, innerW / (n - 1)) : 0;
      placed.forEach((p, i) => {
        p.x = H_MARGIN + i * spacing;
      });
    }
    // ── Fan side-by-side, stack into lanes when too tight ──
    // Each card keeps its dot within [left+INSET, left+CARD_W-INSET] so a vertical
    // leader lands on it. A card joins the innermost lane where it clears the
    // previous card in that lane by FAN_GAP; otherwise it opens a new lane. Cards
    // are NEVER pulled back over a neighbour (no right-edge clamp) — boxes must
    // never overlap, so the canvas grows instead (contentW below).
    for (const side of ['above', 'below'] as Side[]) {
      const arr = placed
        .filter((p) => p.side === side)
        .sort((a, b) => a.x - b.x);
      const laneRight: number[] = [];
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]!;
        const next = arr[i + 1];
        // A collapsed-era summary card centers on its own capsule (the `⊓`
        // mark), so consecutive eras cascade exactly with their capsule spacing
        // and each card sits over the spot it folds — spatial order = time
        // order. Only expanded events fan-pull left when crowded by a neighbour.
        const crowdedRight =
          p.kind !== 'era' && !!next && next.x - p.x < CARD_W + FAN_GAP;
        const preferred = crowdedRight
          ? p.x - CARD_W + CARD_INSET
          : p.x - CARD_W / 2;
        const maxLeft = p.x - CARD_INSET;
        const minLeft = p.x - CARD_W + CARD_INSET;
        let lane = laneRight.length;
        let left = Math.max(preferred, minLeft);
        for (let l = 0; l < laneRight.length; l++) {
          const want = Math.max(preferred, laneRight[l]! + FAN_GAP, minLeft);
          if (want <= maxLeft) {
            lane = l;
            left = want;
            break;
          }
        }
        p.lane = lane;
        p.left = Math.max(6, left); // clamp the LEFT edge only — never the right
        laneRight[lane] = p.left + CARD_W;
      }
    }
  };

  interface Layout {
    contentW: number;
    contentH: number; // unclamped content height — used to target the aspect
    totalH: number;
    spineY: number;
    eraBaseY: number;
    laneNear: (p: Placed) => number;
  }

  // Derive all size-dependent geometry from the current placement.
  const derive = (): Layout => {
    // Grow the canvas to fit the widest card edge so nothing clips or overlaps.
    const contentW = Math.max(
      width,
      Math.max(...placed.map((p) => p.x + p.spanHalf)) + H_MARGIN,
      Math.max(...placed.map((p) => p.left + CARD_W)) + 6
    );
    // Lanes are packed with VARIABLE heights: each lane is only as tall as its own
    // tallest card, so a single 3-bullet card no longer pushes every lane on that
    // side down by its height. `laneOffset[side][lane]` is the distance from the
    // spine-side leader to that lane's near edge = Σ(prior lane heights + gap).
    const laneOffset: Record<Side, number[]> = { above: [], below: [] };
    for (const side of ['above', 'below'] as Side[]) {
      const laneH: number[] = [];
      for (const p of placed) {
        if (p.side !== side) continue;
        laneH[p.lane] = Math.max(laneH[p.lane] ?? 0, p.cardH);
      }
      const off: number[] = [];
      let acc = 0;
      for (let l = 0; l < laneH.length; l++) {
        off[l] = acc;
        acc += (laneH[l] ?? 0) + LANE_GAP;
      }
      laneOffset[side] = off;
    }
    const laneNear = (p: Placed): number =>
      (p.side === 'above' ? LEADER_ABOVE : LEADER_BELOW) +
      (laneOffset[p.side][p.lane] ?? 0);
    const ext = (side: Side): number =>
      Math.max(
        0,
        ...placed
          .filter((p) => p.side === side)
          .map((p) => laneNear(p) + p.cardH)
      );
    // Dates ride inside the cards; the spine carries no tick ruler, so no extra
    // band is reserved below it.
    const contentAbove = ext('above');
    const contentBelow = ext('below');
    // The era `]` bracket band lives beyond the content opposite the cards.
    const aboveExt =
      contentAbove + (hasExpandedEra && eraSide === 'above' ? ERA_BLOCK : 0);
    const belowExt =
      contentBelow + (hasExpandedEra && eraSide === 'below' ? ERA_BLOCK : 0);
    const TOP_PAD = 14;
    const BOT_PAD = 14;
    const spineY = topUsed + TOP_PAD + aboveExt;
    const eraBaseY =
      eraSide === 'above'
        ? spineY - (contentAbove + 14)
        : spineY + (contentBelow + 14);
    const contentH = spineY + belowExt + BOT_PAD;
    // Live preview fills the panel (heightHint floor) so the diagram doesn't
    // float in a short panel; export crops tight to content so the rasterized
    // PNG/SVG has no dead whitespace below the cards (mirrors raci's renderer).
    const totalH = exportMode ? contentH : Math.max(heightHint, contentH);
    return { contentW, contentH, totalH, spineY, eraBaseY, laneNear };
  };

  // Choose the axis stretch. The preview/export both fit the whole diagram
  // (`meet`), so when the natural layout is TALLER than the available panel the
  // fit is height-limited and wastes horizontal space. Widen the date axis — which
  // also shortens the layout (fewer lanes) — until the content aspect reaches the
  // panel aspect, where the fit-scale peaks. Past that, extra width only shrinks
  // it, so stop there. `DGMO_EVT_STRETCH` forces a fixed multiplier.
  const envStretch = Number(
    (globalThis as { process?: { env?: Record<string, string> } }).process
      ?.env?.['DGMO_EVT_STRETCH']
  );
  let layout: Layout;
  if (Number.isFinite(envStretch) && envStretch > 0) {
    place(envStretch);
    layout = derive();
  } else {
    place(1);
    layout = derive();
    const panelAspect = width / heightHint;
    const aspectOf = (l: Layout): number => l.contentW / l.contentH;
    if (
      scaled &&
      layout.contentH > heightHint &&
      aspectOf(layout) < panelAspect
    ) {
      place(STRETCH_CAP);
      const capped = derive();
      if (aspectOf(capped) <= panelAspect) {
        layout = capped; // even the max stretch can't reach the panel aspect
      } else {
        let loF = 1;
        let hiF = STRETCH_CAP;
        for (let it = 0; it < 8; it++) {
          const mid = (loF + hiF) / 2;
          place(mid);
          if (aspectOf(derive()) >= panelAspect) hiF = mid;
          else loF = mid;
        }
        place(hiF);
        layout = derive();
      }
    }
  }
  const { contentW, totalH, spineY, eraBaseY, laneNear } = layout;

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

  if (!exportMode) svg.append('style').text(HOVER_CSS);

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
    // Mute-toggling a category (§28.5) means clicking its legend entry, but the
    // painted swatch + label are a tiny target. Back each entry with a
    // transparent hit rect spanning its whole bounding box (+ padding) so the
    // entire swatch-and-label region is clickable. Preview only — exports carry
    // no interaction, so their snapshots are untouched.
    if (!exportMode) addLegendEntryHitAreas(legendG);
  }

  // ── Spine ──
  // Extend to cover collapsed-era brackets, which reach p.x ± spanHalf.
  const x0 = Math.min(...placed.map((p) => p.x - p.spanHalf));
  const x1 = Math.max(...placed.map((p) => p.x + p.spanHalf));
  const spineLeft = x0 - 20;
  const spineRight = x1 + 20;
  // A trailing TBD (open horizon) turns the spine DASHED past the last real
  // event — the timeline literally trails off into the unscheduled future.
  const hasTrailingFuture =
    scaled && placed.some((p) => p.future && !p.futureSpan);
  const realRightX = placed.length
    ? Math.max(
        spineLeft,
        ...placed.filter((p) => !p.future).map((p) => p.x + p.spanHalf)
      )
    : spineRight;
  const solidRight = hasTrailingFuture ? realRightX : spineRight;
  svg
    .append('line')
    .attr('x1', spineLeft)
    .attr('y1', spineY)
    .attr('x2', solidRight)
    .attr('y2', spineY)
    .attr('stroke', palette.text)
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round');
  if (hasTrailingFuture) {
    svg
      .append('line')
      .attr('x1', solidRight)
      .attr('y1', spineY)
      .attr('x2', spineRight)
      .attr('y2', spineY)
      .attr('stroke', palette.text)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-opacity', 0.45)
      .attr('stroke-dasharray', '2 6');
  }

  // A bracketed TBD plots at an INFERRED point inside a known gap. The hollow
  // dot + "TBD" caption carry the uncertain read on their own — no dashed
  // "somewhere in here" whisker is drawn across the spine.

  // ── Leaders + cards ──
  // Box geometry up front so leaders can test box crossings and so leaders draw
  // BEHIND every card (a card always covers the leaders beneath it).
  const geo = placed.map((p) => {
    const near =
      p.side === 'above' ? spineY - laneNear(p) : spineY + laneNear(p);
    const top = p.side === 'above' ? near - p.cardH : near;
    return { p, near, top };
  });
  // A leader runs vertically at its dot's x from the spine to its card. If that
  // segment passes through ANOTHER card's box, fade it so the text stays clear.
  const leaderCrossesBox = (owner: Placed, near: number): boolean => {
    const lo = Math.min(spineY, near);
    const hi = Math.max(spineY, near);
    return geo.some(
      (g) =>
        g.p !== owner &&
        owner.x > g.p.left &&
        owner.x < g.p.left + CARD_W &&
        hi > g.top &&
        lo < g.top + g.p.cardH
    );
  };

  // A collapsed era's `⊓` bar floats on the card's side; the era card's leader
  // stops AT the bar rather than running to the spine.
  const eraBarY = (p: Placed): number =>
    spineY + ERA_LEG * (p.side === 'above' ? -1 : 1);

  // Leaders first (behind all cards).
  for (const { p, near } of geo) {
    const spineEnd = p.kind === 'era' ? eraBarY(p) : spineY;
    const leader = svg
      .append('line')
      .attr('class', 'dgmo-event-leader')
      .attr('x1', p.x)
      .attr('y1', spineEnd)
      .attr('x2', p.x)
      .attr('y2', near)
      .attr('stroke', p.color)
      .attr('stroke-width', 1.5)
      .attr(
        'stroke-opacity',
        leaderCrossesBox(p, near) ? 0.18 : p.future ? 0.4 : 0.65
      );
    // A future (TBD) event's leader stays SOLID but faded to 40% — the tentative
    // read comes from the fade, matching the faded card bar and dot (no dashes).
    applyHoverHooks(leader, p);
  }

  // Cards on top.
  let shelfClipSeq = 0;
  for (const { p, top } of geo) {
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
      const headBandTop = titleNearTop ? 0 : p.cardH - HEADER_HEIGHT;
      // The shelf wraps the whole header band (title + date). Its spine-side edge
      // (top for below-side blocks, bottom otherwise) is where the leader lands.
      const shelfTop = titleNearTop ? 0 : p.cardH - HEADER_HEIGHT - dateH;
      const shelfH = HEADER_HEIGHT + dateH;
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
        .attr('fill', mix(p.color, themeBaseBg(palette, isDark), SHELF_TINT));
      const edgeY = titleNearTop ? shelfTop : shelfTop + shelfH - SHELF_EDGE;
      // The colored leader-landing edge. A future (TBD) card draws the SAME solid
      // edge faded to 40% — the tentative read comes from the fade, matching the
      // faded leader + dot (no dashes).
      cardG
        .append('rect')
        .attr('x', 0)
        .attr('y', edgeY)
        .attr('width', CARD_W)
        .attr('height', SHELF_EDGE)
        .attr('clip-path', `url(#${clipId})`)
        .attr('fill', p.color)
        .attr('fill-opacity', p.future ? 0.4 : 1);
      cardG
        .append('text')
        .attr('x', CARD_PAD)
        .attr('y', headBandTop + HEADER_HEIGHT / 2 + LABEL_FONT_SIZE / 2 - 2)
        .attr('fill', p.color)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', LABEL_FONT_SIZE)
        .attr('font-weight', 700)
        .text(p.label);
      if (dateStr) {
        cardG
          .append('text')
          .attr('x', CARD_PAD)
          .attr(
            'y',
            (titleNearTop ? HEADER_HEIGHT : headBandTop - dateH) +
              DATE_SUBTITLE_FONT +
              2
          )
          .attr('fill', mix(palette.text, palette.bg, 55))
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', DATE_SUBTITLE_FONT)
          .attr('font-weight', 600)
          .text(dateStr);
      }
      if (p.lines.length > 0) {
        const startBaseline = titleNearTop
          ? CARD_BODY_TOP + dateH + DESC_FONT
          : CARD_PAD + DESC_FONT;
        renderBody(
          cardG,
          p.lines,
          palette.text,
          palette,
          startBaseline,
          p.bulletColors
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
        labelColor: p.titleColor,
        labelFontSize: LABEL_FONT_SIZE,
        headerHeight: HEADER_HEIGHT,
      });

      if (dateStr) {
        cardG
          .append('text')
          .attr('x', CARD_W / 2)
          .attr('y', HEADER_HEIGHT + DATE_SUBTITLE_FONT + 1)
          .attr('text-anchor', 'middle')
          .attr('fill', mix(p.titleColor, p.cardFill, 60))
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', DATE_SUBTITLE_FONT)
          .attr('font-weight', 600)
          .text(dateStr);
      }

      if (p.lines.length > 0) {
        // Divider (org convention: 1px, 30% opacity) below the title + date band.
        cardG
          .append('line')
          .attr('x1', 0)
          .attr('y1', HEADER_HEIGHT + dateH)
          .attr('x2', CARD_W)
          .attr('y2', HEADER_HEIGHT + dateH)
          .attr('stroke', p.titleColor)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);
        renderBody(
          cardG,
          p.lines,
          p.titleColor,
          palette,
          CARD_BODY_TOP + dateH + DESC_FONT,
          p.bulletColors
        );
      }
    }
  }

  // No date ruler: dates ride inside the cards, and the spine carries no
  // year/period tick markers (removed by request — the timeline shows order,
  // not a measured date axis).

  // ── Dots (events) + span brackets (collapsed eras) on the spine ──
  for (const p of placed) {
    if (p.kind === 'era') {
      // A collapsed era terminates on the spine as a `⊓` stretched across its
      // folded date range (`p.spanHalf`), so it keeps its true timeline footprint;
      // a minimum width keeps a single-date era visible. No dot, no separate bottom
      // bracket — the card title names it. Matches the card's color so the leader
      // reads straight through.
      const col = p.color;
      const half = Math.max(16, p.spanHalf);
      // Clamp the legs to the drawn spine extent so the feet always land ON the
      // line (never poking off the left/right end of the timeline).
      const spineLeft = x0 - 20;
      const spineRight = x1 + 20;
      const bx0 = Math.max(spineLeft, p.x - half);
      const bx1 = Math.min(spineRight, p.x + half);
      // A `⊓`: the bar floats off the spine on the card's side (where the leader
      // lands), and a leg drops from each end down to rest its foot ON the spine.
      const barY = eraBarY(p);
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
    // Each expanded era's bracket pads its run by ±ERA_BRACKET_PAD. When two
    // adjacent eras' boundary events sit close on the date scale those pads
    // collide, so split the seam at the midpoint between the runs (kept outside
    // each run's own dots) — neighbouring brackets then never overlap.
    const drawn = runs
      .filter((r) => !r.collapsed) // collapsed eras are marked on the spine instead
      .map((r) => ({
        run: r,
        x0: clampX(r.firstX - ERA_BRACKET_PAD),
        x1: clampX(r.lastX + ERA_BRACKET_PAD),
      }))
      .sort((a, b) => a.run.firstX - b.run.firstX);
    for (let i = 1; i < drawn.length; i++) {
      const prev = drawn[i - 1]!;
      const cur = drawn[i]!;
      if (prev.x1 <= cur.x0) continue;
      const mid = (prev.run.lastX + cur.run.firstX) / 2;
      prev.x1 = Math.max(prev.run.lastX, Math.min(prev.x1, mid - ERA_SEAM_GAP));
      cur.x0 = Math.min(cur.run.firstX, Math.max(cur.x0, mid + ERA_SEAM_GAP));
    }
    for (const { run: r, x0, x1 } of drawn) {
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
          tagOverride
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
      sel.attr(`data-tag-${k.toLowerCase()}`, String(v).toLowerCase());
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
  const attr = `data-tag-${spec.group}`;
  const keep = (el: Element): boolean => el.getAttribute(attr) === spec.value;
  if (!els.some(keep)) return;
  els.forEach((el) => {
    if (!keep(el)) el.classList.add(DIM);
  });
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

// True when an event carries any legend-muted `group:value`. The keying matches
// `applyHoverHooks` (metadata key + value, both lowercased) so it lines up with
// the `data-tag-<group>` attributes and the legend's `data-legend-entry`.
function eventTagHidden(
  metadata: Record<string, string>,
  hidden: ReadonlySet<string>
): boolean {
  if (hidden.size === 0) return false;
  for (const [k, v] of Object.entries(metadata)) {
    if (hidden.has(`${k.toLowerCase()}:${String(v).toLowerCase()}`))
      return true;
  }
  return false;
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
      if (el.getAttribute(`data-tag-${group}`) === value) return true;
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
    const to = (e as MouseEvent).relatedTarget as Node | null;
    if (!to || !root.contains(to)) applyEvtFocus(root, readPin(root));
  });
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
  startBaseline = CARD_BODY_TOP + DESC_FONT,
  // Per-bullet color (collapsed-era member list — each bullet takes its event's
  // tag color). Consumed in bullet-first order; falls back to bodyColor.
  bulletColors: readonly string[] = []
): void {
  let y = startBaseline;
  let bulletIdx = 0;
  // The whole bulleted entry (marker + text) takes its member's tag color so a
  // collapsed era reads like a mini tag-colored list; continuation lines keep
  // it, plain lines (e.g. "+N more") fall back to the body color.
  let lineColor = bodyColor;
  for (const line of lines) {
    const isBullet =
      line.kind === 'bullet-first' || line.kind === 'bullet-cont';
    const bodyX = CARD_PAD + (isBullet ? 12 : 0);
    if (line.kind === 'bullet-first') {
      lineColor = bulletColors[bulletIdx++] ?? bodyColor;
      cardG
        .append('text')
        .attr('x', CARD_PAD)
        .attr('y', y)
        .attr('text-anchor', 'start')
        .attr('fill', lineColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', DESC_FONT)
        .attr('font-weight', 700)
        .text('•');
    } else if (!isBullet) {
      lineColor = bodyColor;
    }
    const t = cardG
      .append('text')
      .attr('x', bodyX)
      .attr('y', y)
      .attr('text-anchor', 'start')
      .attr('fill', isBullet ? lineColor : bodyColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', DESC_FONT);
    renderInlineText(t, line.text, palette);
    y += DESC_LINE_H;
  }
}
