// ============================================================
// Calendar — `layout month`, the wall calendar (§41.3, #1876). Pure layout:
// where each month block, tile and bar piece sits. No DOM.
// ============================================================
//
// Each month is a seven-column grid of rounded tiles. The more months drawn,
// the less text (#1876's size table), keyed on the tile width that results:
//
//   full     1 month    named bars, 3 lanes, "+N more"
//   compact  2 months   smaller named bars, 3 lanes, "+N"
//   bars     3–6        colour bars without names; a corner dot for overflow
//   tiles    7–12       the tile takes its first event's colour; a corner dot
//                       for a second event
//
// `months-per-row N` changes the per-row count; the tier still follows the
// tile width, so a wider tile may show names where the default would not.

import { dayNumber, daysInMonth, dayToIso, parts, weekday } from './dates';
import { MONTHS, WEEKDAYS } from './format';
import type { Cell, Geometry, Label } from './geometry';
import type { CalendarEvent, DayNumber, ParsedCalendar } from './types';

export type MonthTier = 'full' | 'compact' | 'bars' | 'tiles';

export interface TierStyle {
  readonly tier: MonthTier;
  /** The narrowest tile this tier is drawn at. */
  readonly minTileW: number;
  readonly gap: number;
  readonly tileH: (tileW: number) => number;
  readonly radius: number;
  readonly dateFont: number;
  /** Day-number inset from the tile's top-left corner. */
  readonly datePad: number;
  /** Top of the first lane, from the tile's top. */
  readonly laneTop: number;
  readonly barH: number;
  readonly laneStep: number;
  readonly barFont: number;
  /** Space between a bar's true end and its tile's edge. */
  readonly inset: number;
  /** Lanes drawn before a day's events overflow. */
  readonly lanes: number;
  readonly titleFont: number;
  readonly titleBand: number;
  readonly weekdayFont: number;
  readonly weekdayBand: number;
  /** Column heads: `SUN` or `S`. */
  readonly weekdayLong: boolean;
}

const LANES = 3;

/** In order, widest first: the first tier whose tiles are wide enough wins. */
export const TIERS: readonly TierStyle[] = [
  {
    tier: 'full',
    minTileW: 80,
    gap: 6,
    tileH: () => 120,
    radius: 8,
    dateFont: 11,
    datePad: 9,
    laneTop: 28,
    barH: 18,
    laneStep: 22,
    barFont: 10.5,
    inset: 4,
    lanes: LANES,
    titleFont: 15,
    titleBand: 30,
    weekdayFont: 10,
    weekdayBand: 18,
    weekdayLong: true,
  },
  {
    tier: 'compact',
    minTileW: 44,
    gap: 4,
    tileH: () => 62,
    radius: 6,
    dateFont: 9,
    datePad: 5,
    laneTop: 17,
    barH: 12,
    laneStep: 14,
    barFont: 8.5,
    inset: 3,
    lanes: LANES,
    titleFont: 13,
    titleBand: 24,
    weekdayFont: 9,
    weekdayBand: 15,
    weekdayLong: false,
  },
  {
    tier: 'bars',
    minTileW: 26,
    gap: 3,
    tileH: (w) => Math.round(w * 1.15),
    radius: 4,
    dateFont: 7.5,
    datePad: 4,
    laneTop: 13,
    barH: 5,
    laneStep: 7,
    barFont: 0,
    inset: 2,
    lanes: LANES,
    titleFont: 13,
    titleBand: 22,
    weekdayFont: 9,
    weekdayBand: 14,
    weekdayLong: false,
  },
  {
    tier: 'tiles',
    minTileW: 0,
    gap: 3,
    tileH: (w) => w,
    radius: 3,
    dateFont: 6.5,
    datePad: 3,
    laneTop: 0,
    barH: 0,
    laneStep: 0,
    barFont: 0,
    inset: 0,
    lanes: 0,
    titleFont: 11,
    titleBand: 18,
    weekdayFont: 8,
    weekdayBand: 12,
    weekdayLong: false,
  },
];

/** The width every per-row count shares: seven 108-unit tiles and their
 *  gaps, the one-month calendar of #1876. */
export const MONTH_ROW_WIDTH = 7 * 108 + 6 * 6;
const MAX_TILE_W = 120;
export const MONTH_GAP_X = 24;
export const MONTH_GAP_Y = 22;

/** Months per row by months drawn (#1876's table). */
export function defaultMonthsPerRow(months: number): number {
  if (months <= 1) return 1;
  if (months === 2) return 2;
  if (months <= 6) return 3;
  return 4;
}

export interface MonthBlock {
  readonly year: number;
  readonly month: number;
  /** First and last day of the month. */
  readonly first: DayNumber;
  readonly last: DayNumber;
  /** `YYYY-MM`. */
  readonly key: string;
  /** The grid's top-left (the first column, the first week row). */
  readonly x: number;
  readonly y: number;
  readonly weeks: number;
}

export interface MonthGeometry extends Geometry {
  readonly style: TierStyle;
  readonly blocks: readonly MonthBlock[];
  /** Days of a neighbouring month that fill a block's first and last weeks. */
  readonly faint: readonly { x: number; y: number }[];
  /** Column of a day within its week, 0–6. */
  readonly column: (day: DayNumber) => number;
}

/** The months the span touches, in order. */
export function spanMonths(
  start: DayNumber,
  end: DayNumber
): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  const s = parts(start);
  const e = parts(end);
  for (
    let y = s.year, m = s.month;
    y < e.year || (y === e.year && m <= e.month);
  ) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** The tier and tile width for a per-row count. */
export function tierFor(perRow: number): { style: TierStyle; tileW: number } {
  const monthW = (MONTH_ROW_WIDTH - (perRow - 1) * MONTH_GAP_X) / perRow;
  for (const style of TIERS) {
    const tileW = Math.min(
      MAX_TILE_W,
      Math.floor((monthW - 6 * style.gap) / 7)
    );
    if (tileW >= style.minTileW) return { style, tileW };
  }
  // Unreachable: the last tier accepts any width.
  return { style: TIERS[TIERS.length - 1]!, tileW: 16 };
}

export function monthGeometry(
  parsed: ParsedCalendar,
  left0: number,
  top: number,
  exportMode: boolean
): MonthGeometry {
  const months = spanMonths(parsed.start, parsed.end);
  const perRow = parsed.monthsPerRow ?? defaultMonthsPerRow(months.length);
  const { style, tileW } = tierFor(perRow);
  const tileH = style.tileH(tileW);
  const { gap } = style;
  const pitchX = tileW + gap;
  const pitchY = tileH + gap;
  const monthW = 7 * tileW + 6 * gap;
  const column = (day: DayNumber): number =>
    (weekday(day) - parsed.weekStart + 7) % 7;
  const multiYear = months[0]!.year !== months[months.length - 1]!.year;
  const withYear = style.tier === 'full' || style.tier === 'compact';

  const labels: Label[] = [];
  const cells: Cell[] = [];
  const faint: { x: number; y: number }[] = [];
  const blocks: MonthBlock[] = [];
  const cols = Math.min(perRow, months.length);
  let rowTop = top;
  let bottom = top;
  for (let r = 0; r * perRow < months.length; r++) {
    const row = months.slice(r * perRow, (r + 1) * perRow);
    const weeksOf = (m: { year: number; month: number }): number => {
      const first = dayNumber(m.year, m.month, 1)!;
      return Math.ceil((column(first) + daysInMonth(m.year, m.month)) / 7);
    };
    const weeks = Math.max(...row.map(weeksOf));
    row.forEach((m, c) => {
      const x = left0 + c * (monthW + MONTH_GAP_X);
      const gridTop = rowTop + style.titleBand + style.weekdayBand;
      const first = dayNumber(m.year, m.month, 1)!;
      const n = daysInMonth(m.year, m.month);
      const last = first + n - 1;
      const key = dayToIso(first).slice(0, 7);
      const name = MONTHS[m.month - 1]!;
      labels.push({
        text: withYear || multiYear ? `${name} ${m.year}` : name,
        x,
        y: rowTop + style.titleFont + 2,
        anchor: 'start',
        cls: 'calendar-month',
        bold: true,
        size: style.titleFont,
        ...(!exportMode && { month: key }),
      });
      for (let col = 0; col < 7; col++) {
        const wd = (col + parsed.weekStart) % 7;
        const word = WEEKDAYS[wd]!;
        labels.push({
          text: style.weekdayLong
            ? word.slice(0, 3).toUpperCase()
            : word.slice(0, 1),
          x: style.weekdayLong
            ? x + col * pitchX + style.datePad
            : x + col * pitchX + tileW / 2,
          y: gridTop - 6,
          anchor: style.weekdayLong ? 'start' : 'middle',
          cls: 'calendar-weekday',
          size: style.weekdayFont,
          faint: wd === 0 || wd === 6,
        });
      }
      const offset = column(first);
      for (let i = 0; i < weeks * 7; i++) {
        const cx = x + (i % 7) * pitchX;
        const cy = gridTop + Math.floor(i / 7) * pitchY;
        const date = i - offset + 1;
        if (date < 1 || date > n) {
          // Only the first and last week rows hold neighbouring days.
          if (Math.floor(i / 7) < weeksOf(m)) faint.push({ x: cx, y: cy });
          continue;
        }
        cells.push({ day: first + date - 1, x: cx, y: cy });
      }
      blocks.push({
        year: m.year,
        month: m.month,
        first,
        last,
        key,
        x,
        y: gridTop,
        weeks: weeksOf(m),
      });
    });
    bottom =
      rowTop + style.titleBand + style.weekdayBand + weeks * pitchY - gap;
    rowTop = bottom + MONTH_GAP_Y;
  }
  return {
    cells,
    labels,
    cellW: tileW,
    cellH: tileH,
    pitchX,
    pitchY,
    right: left0 + cols * monthW + (cols - 1) * MONTH_GAP_X,
    bottom,
    weekend: (day) => {
      const wd = weekday(day);
      return wd === 0 || wd === 6;
    },
    style,
    blocks,
    faint,
    column,
  };
}

/** One row's stretch of an event: the bar drawn across one week. */
export interface Piece {
  /** Index into `parsed.events`. */
  readonly event: number;
  readonly lane: number;
  readonly from: DayNumber;
  readonly to: DayNumber;
  /** The event runs on before this piece (a `‹` and a square left end). */
  readonly continuesLeft: boolean;
  /** The event runs on after this piece (a square right end). */
  readonly continuesRight: boolean;
  /** `YYYY-MM` of the block it sits in. */
  readonly month: string;
}

export interface MonthLanes {
  readonly pieces: Piece[];
  /** Events on each day, in lane order (lowest lane first). */
  readonly onDay: Map<DayNumber, number[]>;
  /** Events past the last lane, per day. */
  readonly hidden: Map<DayNumber, number[]>;
}

/**
 * Stack each month's events in lanes. Earlier starts go first and, on a tie,
 * longer events, so a long bar takes a low lane and keeps it for its whole
 * run through the month; each event takes the lowest lane free on all its
 * days. Events past `lanes` are hidden and counted per day.
 */
export function laneEvents(
  events: readonly CalendarEvent[],
  blocks: readonly MonthBlock[],
  column: (day: DayNumber) => number,
  lanes: number
): MonthLanes {
  const pieces: Piece[] = [];
  const onDay = new Map<DayNumber, number[]>();
  const hidden = new Map<DayNumber, number[]>();
  const push = (m: Map<DayNumber, number[]>, d: DayNumber, i: number) => {
    const l = m.get(d);
    if (l) l.push(i);
    else m.set(d, [i]);
  };
  for (const block of blocks) {
    const inMonth = events
      .map((e, i) => ({
        i,
        e,
        s: Math.max(e.start, block.first),
        t: Math.min(e.end, block.last),
      }))
      .filter((x) => x.s <= x.t)
      .sort((a, b) => a.s - b.s || b.t - b.s - (a.t - a.s) || a.i - b.i);
    const taken = new Map<DayNumber, Set<number>>();
    const laneOf = new Map<number, number>();
    for (const { i, e, s, t } of inMonth) {
      let lane = 0;
      const free = (l: number): boolean => {
        for (let d = s; d <= t; d++) if (taken.get(d)?.has(l)) return false;
        return true;
      };
      while (!free(lane)) lane++;
      laneOf.set(i, lane);
      for (let d = s; d <= t; d++) {
        const set = taken.get(d);
        if (set) set.add(lane);
        else taken.set(d, new Set([lane]));
        push(onDay, d, i);
        if (lane >= lanes) push(hidden, d, i);
      }
      if (lane >= lanes) continue;
      for (let d = s; d <= t; ) {
        const to = Math.min(t, d + 6 - column(d));
        pieces.push({
          event: i,
          lane,
          from: d,
          to,
          continuesLeft: d > e.start,
          continuesRight: to < e.end,
          month: block.key,
        });
        d = to + 1;
      }
    }
    // A day lists its events lowest lane first.
    for (let d = block.first; d <= block.last; d++) {
      const list = onDay.get(d);
      if (!list) continue;
      list.sort((a, b) => laneOf.get(a)! - laneOf.get(b)!);
    }
  }
  return { pieces, onDay, hidden };
}
