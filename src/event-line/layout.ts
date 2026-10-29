// ============================================================
// Event Line — layout (spec §28)
// ============================================================
//
// Everything the renderer needs to know about WHERE things go, computed as data
// before anything is drawn: each slot's card size, its x on the spine, its side,
// lane and left edge, and the canvas size and spine y that follow from them.
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
}

export function layoutEventLine(
  parsed: ParsedEventLine,
  palette: PaletteColors,
  isDark: boolean,
  opts: EventLineLayoutOptions
): EventLineLayout {
  const { width, heightHint, exportMode, hiddenSet, activeGroup, topUsed } =
    opts;
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

  return {
    placed,
    scaled,
    hasEras,
    eraSide,
    eraByName,
    ...layout,
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

// Reconcile the rendered SVG to the container's hidden set: collapse matching

function wrapDescription(
  lines: readonly string[],
  charsPerLine: number
): WrappedDescLine[] {
  return wrapDescriptionLines([...lines], charsPerLine);
}
