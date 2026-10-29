// ============================================================
// Event Line — layout (spec §28)
// ============================================================
//
// Everything the renderer needs to know about WHERE things go, computed as data
// before anything is drawn: each slot's card size, its x on the spine, its side,
// lane and left edge, and the canvas size and spine y that follow from them;
// then the drawing-time geometry those imply — card boxes and leaders, the
// spine's extent, the era bracket runs and the `now` marker's slot.
// No DOM is touched here; `renderer.ts` reads the result and draws it.

import {
  HEADER_HEIGHT,
  LABEL_FONT_SIZE,
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
import { CHAR_WIDTH_RATIO, wrapTextToWidth } from '../utils/text-measure';
import {
  wrapDescriptionLines,
  type WrappedDescLine,
} from '../utils/wrapped-desc';
import { formatDateLabel } from '../timeline/renderer';
import { parseTimelineDate } from '../timeline/parser';
import {
  resolveTagColor,
  type TagGroup,
  UNTAGGED_TAG_COLOR,
} from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import type { EventLineEra, EventLineEvent, ParsedEventLine } from './types';

// ── Geometry constants ───────────────────────────────────────
export const CARD_W = 210;
const H_MARGIN = 58;
export const LEADER_ABOVE = 46;
export const LEADER_BELOW = 46;
export const DESC_FONT = 11.5;
export const DESC_LINE_H = 16;
export const CARD_PAD = 9;
// A long title wraps inside the fixed-width card rather than running over its
// edge. Each wrapped line is TITLE_LINE_H tall; the header band grows to hold
// them (a 1-line title keeps the default HEADER_HEIGHT). Bold titles measure
// ~7% wider than the regular-weight glyph table, so the wrap width is trimmed to
// keep a wrapped line clear of the card edge.
export const TITLE_LINE_H = 16;
const TITLE_MAX_W = (CARD_W - CARD_PAD * 2) * 0.93;
const MIN_SPACING = 96;
const LANE_GAP = 16;
const NEUTRAL_TAG = UNTAGGED_TAG_COLOR;
// Horizontal placement: a card may slide sideways as long as its dot stays at
// least CARD_INSET from either edge (so a vertical leader still lands cleanly
// on it). Cards fan side-by-side until they can't, then stack into lanes.
const CARD_INSET = 18;
const FAN_GAP = 6;
// The event's date rides INSIDE the card as a muted subtitle directly adjacent to
// the title (on the side away from the spine), so a date travels with its event
// instead of sitting on the axis. This much header height is reserved for it.
export const DATE_SUBTITLE_H = 15;
// Era `]` bracket band: depth reserved on the side opposite the cards.
const ERA_BLOCK = 30;
export const DOT_R = 5.5;
// Padding each era bracket extends past its first/last member dot, and the gap
// kept on each side of a seam when two adjacent brackets are clamped apart.
const ERA_BRACKET_PAD = 14;
const ERA_SEAM_GAP = 3;
// Collapsed era: the `⊓` bar floats this far off the spine (on the card's side);
// its legs drop from the bar to rest their feet ON the timeline.
const ERA_LEG = 13;

export type Side = 'above' | 'below';

export interface Placed {
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
  /** Title wrapped to fit the card width (1+ lines). */
  titleLines: string[];
  /** Header-band height sized to hold `titleLines` (>= HEADER_HEIGHT). */
  headerH: number;
  lines: WrappedDescLine[];
  /** For a collapsed era: per-member tag color, in member order (one per bullet). */
  bulletColors: readonly string[];
  /** For a collapsed era: per-member tag metadata, in member/bullet order — lets a
   *  legend hover highlight matching member bullets inside the folded card. */
  bulletMeta: readonly Readonly<Record<string, string>>[];
  cardH: number;
  x: number;
  side: Side;
  lane: number;
  left: number;
  /** Collapsed era only: half the date-span width in px, so its bracket stretches
   *  across the folded run (`x` is the span MIDPOINT). 0 for events. */
  spanHalf: number;
}

/** What the renderer knows before layout: the panel and the chrome above it. */
export interface EventLineLayoutOptions {
  width: number;
  heightHint: number;
  exportMode: boolean;
  /** Legend-muted `group:value` keys; their members drop out of era cards. */
  hiddenSet: ReadonlySet<string>;
  activeGroup: string | null;
  /** Height used by the title and legend bands above the content. */
  topUsed: number;
  /** Clock for a computed `now` marker (§28.6b); defaults to the wall clock. */
  nowDate?: Date | undefined;
}

/** One card's box and leader, in `placed` order. */
export interface CardGeometry {
  p: Placed;
  /** y of the card's spine-side edge, where its leader ends. */
  near: number;
  top: number;
  /** y where the leader starts: the spine, or a collapsed era's `⊓` bar. */
  leaderFrom: number;
  /** The leader passes through ANOTHER card's box. */
  leaderCrossesCard: boolean;
  /** Collapsed era only: the `⊓` bar's ends and y, clamped to the spine. */
  eraBar: { x0: number; x1: number; y: number } | null;
}

export interface SpineGeometry {
  left: number;
  right: number;
  /** End of the solid stroke; past it the spine is dashed (trailing TBD). */
  solidRight: number;
  dashed: boolean;
}

/** An expanded era's `]` bracket: its run of member dots and its clamped ends. */
export interface EraBracket {
  era: EventLineEra;
  firstX: number;
  lastX: number;
  x0: number;
  x1: number;
}

/** The `now` marker (§28.6b): pin x on the spine, its tab's box and its stem. */
export interface NowMarkerGeometry {
  x: number;
  label: string;
  pillW: number;
  pillH: number;
  /** Tab centre x, kept inside the canvas. */
  pillCX: number;
  y0: number;
  y1: number;
  stemFrom: number;
  stemTo: number;
}

export interface EventLineLayout {
  /** One entry per slot, in source order, with x, side, lane and left set. */
  placed: Placed[];
  scaled: boolean;
  hasEras: boolean;
  eraSide: Side;
  eraByName: Map<string, EventLineEra>;
  contentW: number;
  contentH: number; // unclamped content height — used to target the aspect
  totalH: number;
  spineY: number;
  eraBaseY: number;
  /** Distance from the spine to the spine-side edge of `p`'s card. */
  laneNear: (p: Placed) => number;
  cards: CardGeometry[];
  spine: SpineGeometry;
  /** Expanded eras only, left to right; collapsed eras draw as `eraBar`. */
  eraBrackets: EraBracket[];
  /** Null when there is no `now` directive, the axis is not to scale, or
   *  there is no dated event to interpolate over. */
  now: NowMarkerGeometry | null;
}

export function layoutEventLine(
  parsed: ParsedEventLine,
  palette: PaletteColors,
  isDark: boolean,
  opts: EventLineLayoutOptions
): EventLineLayout {
  const {
    width,
    heightHint,
    exportMode,
    hiddenSet,
    activeGroup,
    topUsed,
    nowDate,
  } = opts;
  const seriesColors = getSeriesColors(palette);
  const accent = seriesColors[0]!;

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
  // Wrap the title to the card width and size the header band to the line count.
  const titleLayout = (label: string): { lines: string[]; headerH: number } => {
    const lines = wrapTextToWidth(label, LABEL_FONT_SIZE, TITLE_MAX_W, {
      hardBreak: true,
      // The card title is drawn at 700.
      bold: true,
    });
    const headerH = Math.max(HEADER_HEIGHT, lines.length * TITLE_LINE_H + 12);
    return { lines, headerH };
  };
  const cardHeight = (
    headerH: number,
    lines: WrappedDescLine[],
    hasDate: boolean
  ): number =>
    headerH +
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
      : sideOpt;
    if (slot.kind === 'event') {
      const event = slot.event;
      const solid = eventColor(event);
      const cardFill = shapeFill(palette, solid, isDark, {
        mode: parsed.options.fillMode,
      });
      const titleColor = contrastText(
        cardFill,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
      const lines = wrapDescription(event.description, charsPerLine);
      const title = titleLayout(event.label);
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
        titleLines: title.lines,
        headerH: title.headerH,
        lines,
        bulletColors: [],
        bulletMeta: [],
        cardH: cardHeight(title.headerH, lines, !!event.date),
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
    const bulletMeta = visibleMembers.map((m) => m.metadata);
    const lines = wrapDescription(memberStrs, charsPerLine);
    const title = titleLayout(era.name);
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
      titleLines: title.lines,
      headerH: title.headerH,
      lines,
      bulletColors,
      bulletMeta,
      cardH: cardHeight(title.headerH, lines, false),
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
    // ── Dots stay on their true date; crowding resolves in DEPTH, not width ──
    // A dot's x is its exact calendar position and is never nudged sideways to make
    // room for a card. When same-side events cluster tighter than a card is wide, the
    // fan/lane packer below stacks their cards into deeper lanes (each with its own
    // vertical leader landing on the dot) rather than sliding the dot off its date.
    // The axis-stretch search widens the whole timeline when the panel is wide, which
    // relieves clusters honestly (to scale) instead of distorting positions.
    // (Coincident-date events still share an x and stack with faded leaders below.)
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

  const { contentW, totalH, spineY, laneNear } = layout;
  const spine = layoutSpine(placed, scaled);
  const cards = layoutCards(placed, spineY, laneNear, spine);
  return {
    placed,
    scaled,
    hasEras,
    eraSide,
    eraByName,
    ...layout,
    cards,
    spine,
    eraBrackets: hasEras ? layoutEraBrackets(placed, eraByName, contentW) : [],
    now:
      parsed.now && scaled
        ? layoutNowMarker(parsed, placed, cards, {
            spineY,
            contentW,
            totalH,
            topUsed,
            nowDate,
          })
        : null,
  };
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

function wrapDescription(
  lines: readonly string[],
  charsPerLine: number
): WrappedDescLine[] {
  return wrapDescriptionLines([...lines], charsPerLine);
}

// ── Drawing-time geometry ── what follows from the placement above: the
// spine's extent, each card's box and leader, the era runs and the `now` tab.

function layoutSpine(
  placed: readonly Placed[],
  scaled: boolean
): SpineGeometry {
  // Extend to cover collapsed-era brackets, which reach p.x ± spanHalf.
  const x0 = Math.min(...placed.map((p) => p.x - p.spanHalf));
  const x1 = Math.max(...placed.map((p) => p.x + p.spanHalf));
  const left = x0 - 20;
  const right = x1 + 20;
  // A trailing TBD (open horizon) turns the spine DASHED past the last real
  // event — the timeline literally trails off into the unscheduled future.
  const dashed = scaled && placed.some((p) => p.future && !p.futureSpan);
  const realRightX = placed.length
    ? Math.max(
        left,
        ...placed.filter((p) => !p.future).map((p) => p.x + p.spanHalf)
      )
    : right;
  return { left, right, solidRight: dashed ? realRightX : right, dashed };
}

function layoutCards(
  placed: readonly Placed[],
  spineY: number,
  laneNear: (p: Placed) => number,
  spine: SpineGeometry
): CardGeometry[] {
  // Box geometry up front so leaders can test box crossings.
  const boxes = placed.map((p) => {
    const near =
      p.side === 'above' ? spineY - laneNear(p) : spineY + laneNear(p);
    const top = p.side === 'above' ? near - p.cardH : near;
    return { p, near, top };
  });
  // A leader runs vertically at its dot's x from the spine to its card. If that
  // segment passes through ANOTHER card's box, it is faded so the text stays clear.
  const leaderCrossesBox = (owner: Placed, near: number): boolean => {
    const lo = Math.min(spineY, near);
    const hi = Math.max(spineY, near);
    return boxes.some(
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

  return boxes.map(({ p, near, top }) => {
    let eraBar: CardGeometry['eraBar'] = null;
    if (p.kind === 'era') {
      // The `⊓` stretches across the folded date range (`p.spanHalf`); a minimum
      // width keeps a single-date era visible. Its legs are clamped to the drawn
      // spine extent so the feet always land ON the line.
      const half = Math.max(16, p.spanHalf);
      eraBar = {
        x0: Math.max(spine.left, p.x - half),
        x1: Math.min(spine.right, p.x + half),
        y: eraBarY(p),
      };
    }
    return {
      p,
      near,
      top,
      leaderFrom: p.kind === 'era' ? eraBarY(p) : spineY,
      leaderCrossesCard: leaderCrossesBox(p, near),
      eraBar,
    };
  });
}

function layoutEraBrackets(
  placed: readonly Placed[],
  eraByName: ReadonlyMap<string, EventLineEra>,
  contentW: number
): EraBracket[] {
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
  const clampX = (v: number): number => Math.max(4, Math.min(contentW - 4, v));
  // Each expanded era's bracket pads its run by ±ERA_BRACKET_PAD. When two
  // adjacent eras' boundary events sit close on the date scale those pads
  // collide, so split the seam at the midpoint between the runs (kept outside
  // each run's own dots) — neighbouring brackets then never overlap.
  const drawn = runs
    .filter((r) => !r.collapsed) // collapsed eras are marked on the spine instead
    .map((r) => ({
      era: r.era,
      firstX: r.firstX,
      lastX: r.lastX,
      x0: clampX(r.firstX - ERA_BRACKET_PAD),
      x1: clampX(r.lastX + ERA_BRACKET_PAD),
    }))
    .sort((a, b) => a.firstX - b.firstX);
  for (let i = 1; i < drawn.length; i++) {
    const prev = drawn[i - 1]!;
    const cur = drawn[i]!;
    if (prev.x1 <= cur.x0) continue;
    const mid = (prev.lastX + cur.firstX) / 2;
    prev.x1 = Math.max(prev.lastX, Math.min(prev.x1, mid - ERA_SEAM_GAP));
    cur.x0 = Math.min(cur.firstX, Math.max(cur.x0, mid + ERA_SEAM_GAP));
  }
  return drawn;
}

// A pin planted ON the spine with a short stem to a labeled tab, dropped into a
// lane the cards don't occupy. To-scale only; its x is interpolated over the
// placed DATED events (so it honors the broken axis), riding onto a trailing-TBD
// open horizon when `now` is past the last date.
function layoutNowMarker(
  parsed: ParsedEventLine,
  placed: readonly Placed[],
  cards: readonly CardGeometry[],
  frame: {
    spineY: number;
    contentW: number;
    totalH: number;
    topUsed: number;
    nowDate: Date | undefined;
  }
): NowMarkerGeometry | null {
  const now = parsed.now!;
  const { spineY, contentW, totalH, topUsed } = frame;
  let nowValue: number | null = now.dateValue;
  let nowIso: string | null = now.date;
  if (now.computed) {
    const d = frame.nowDate ?? new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    nowIso = iso;
    const v = parseTimelineDate(iso);
    nowValue = Number.isFinite(v) ? v : null;
  }
  const dated = placed
    .filter((p) => p.kind !== 'era' && !p.future && p.dateValue !== null)
    .sort((a, b) => a.dateValue! - b.dateValue!);
  let nowX = nowValue === null ? null : valueToSpineX(nowValue, dated);
  // Past the last DATED event with a trailing-TBD open horizon: ride the pin
  // out onto that tail ("now, in the unscheduled-future era") rather than
  // clamping back to the last real dot. TBD positions are inferred, so anchor
  // to the nearest trailing-TBD dot.
  const lastReal = dated[dated.length - 1];
  if (
    nowX !== null &&
    nowValue !== null &&
    lastReal &&
    nowValue > lastReal.dateValue!
  ) {
    const trailing = placed
      .filter((p) => p.future && !p.futureSpan)
      .map((p) => p.x);
    if (trailing.length) nowX = Math.min(...trailing);
  }
  if (nowX === null) return null;

  // The tab says WHEN, not just "here": a caption reading `now` is equally
  // true on the day it was drawn and two years later, so a reader cannot
  // tell a diagram that redraws from a picture of a dead one. The date is
  // formatted exactly as the event cards format theirs, so the pin and the
  // cards can never disagree about how a date looks. An explicit caption
  // (`now 2023-06-01 Today`) still wins.
  const label = now.label ?? (nowIso ? formatDateLabel(nowIso) : 'now');
  const pillH = 18;
  const pillW = Math.max(28, label.length * 6.6 + 16);
  const PIN_GAP = 6; // clearance spine↔pill and card↔pill
  const xHalf = pillW / 2 + 4;
  const xLo = nowX - xHalf;
  const xHi = nowX + xHalf;

  // The only obstacles are card boxes sharing the pill's x-span.
  const boxes = cards.map((g) => ({
    side: g.p.side,
    top: g.top,
    bot: g.top + g.p.cardH,
    left: g.p.left,
    right: g.p.left + CARD_W,
  }));
  type Box = (typeof boxes)[number];
  const overlapsX = (b: Box): boolean => b.left < xHi && b.right > xLo;

  // Candidate tab slots: spine-adjacent on each side, plus just beyond every
  // overlapping card. Keep the CLEAR slot with the shortest stem — the pin
  // hugs the spine when the lane is empty and only reaches past a card when
  // it must.
  type Slot = { y0: number; y1: number; stem: number };
  const cands: Slot[] = [];
  const addAbove = (pillBottom: number): void => {
    const y0 = pillBottom - pillH;
    if (y0 > topUsed + 1)
      cands.push({ y0, y1: pillBottom, stem: spineY - pillBottom });
  };
  const addBelow = (pillTop: number): void => {
    const y1 = pillTop + pillH;
    if (y1 < totalH - 1)
      cands.push({ y0: pillTop, y1, stem: pillTop - spineY });
  };
  // Preferred slot: the tab centered in the spine→event-row gap — equidistant
  // to the spine and where event cards begin (their near edge sits LEADER_*
  // off the spine). The pill fits inside that gap, so it clears the cards
  // even when one shares the marker's x. Beyond-card fallbacks handle the
  // rare tighter case.
  addAbove(spineY - LEADER_ABOVE / 2 + pillH / 2);
  addBelow(spineY + LEADER_BELOW / 2 - pillH / 2);
  for (const b of boxes) {
    if (!overlapsX(b)) continue;
    if (b.side === 'above') addAbove(b.top - PIN_GAP);
    else addBelow(b.bot + PIN_GAP);
  }
  const isClear = (c: Slot): boolean =>
    !boxes.some((b) => overlapsX(b) && b.bot > c.y0 && b.top < c.y1);
  const byStem = (a: Slot, b: Slot): number => a.stem - b.stem;
  const slot: Slot = cands.filter(isClear).sort(byStem)[0] ??
    cands.sort(byStem)[0] ?? {
      y0: spineY - PIN_GAP - pillH,
      y1: spineY - PIN_GAP,
      stem: PIN_GAP + pillH,
    };

  const above = slot.y1 <= spineY;
  return {
    x: nowX,
    label,
    pillW,
    pillH,
    pillCX: Math.max(pillW / 2 + 2, Math.min(nowX, contentW - pillW / 2 - 2)),
    y0: slot.y0,
    y1: slot.y1,
    stemFrom: above ? spineY - DOT_R : spineY + DOT_R,
    stemTo: above ? slot.y1 : slot.y0,
  };
}

// Map a date value to a spine x by piecewise-linear interpolation over the
// PLACED dated events (already sorted here). Because event x's already encode
// the broken axis (collapsed-era capsules, per-run scaling), interpolating
// between them keeps the `now` rule consistent with the drawn dots. Values
// before the first / after the last dated event clamp to that endpoint.
function valueToSpineX(v: number, dated: Placed[]): number | null {
  if (!dated.length) return null;
  const first = dated[0]!;
  const last = dated[dated.length - 1]!;
  if (v <= first.dateValue!) return first.x;
  if (v >= last.dateValue!) return last.x;
  for (let i = 0; i < dated.length - 1; i++) {
    const a = dated[i]!;
    const b = dated[i + 1]!;
    if (v >= a.dateValue! && v <= b.dateValue!) {
      const span = b.dateValue! - a.dateValue!;
      if (span <= 0) return a.x;
      return a.x + ((v - a.dateValue!) / span) * (b.x - a.x);
    }
  }
  return last.x;
}
