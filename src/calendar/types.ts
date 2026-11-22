import type { DgmoError } from '../diagnostics';
import type { ChartFrame } from '../utils/chart-frame-parse';
import type { FillMode } from '../utils/parsing';
import type { TagGroup } from '../utils/tag-groups';

/** One calendar day, as a UTC day number (days since 1970-01-01). */
export type DayNumber = number;

/** How the days are arranged (§41.3). */
export type CalendarLayout = 'weeks' | 'months' | 'month';

/**
 * A number group (§41.5): `heat Name [as a] [low] [high]`, with indented
 * `unit` and `max`, or the implied group bare numbers form when no `heat`
 * line exists.
 */
export interface CalendarNumberGroup {
  /** The pill's name; for the implied group, made from `unit`. */
  readonly name: string;
  readonly alias?: string;
  /** Metadata key the marks are stored under (`tagAttrKey(name)`). */
  readonly key: string;
  /** Singular, as written; the renderer makes it plural. */
  readonly unit?: string;
  /** Pins the top band at this value. */
  readonly max?: number;
  /** Up to two palette colour names (§13.9). */
  readonly low?: string;
  readonly high?: string;
  /** True for the group bare numbers form with no `heat` line. */
  readonly implied: boolean;
  readonly lineNumber: number;
}

/** Every group in declaration order, as the legend lists them. */
export type CalendarGroupRef =
  | { readonly kind: 'number'; readonly key: string; readonly name: string }
  | { readonly kind: 'tag'; readonly key: string; readonly name: string };

export interface CalendarDay {
  /** UTC day number. */
  readonly day: DayNumber;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** Number marks by group key; marks written twice add up. */
  readonly numbers: Readonly<Record<string, number>>;
  /** Tag marks by group key, in the group's own spelling of the value. */
  readonly tags: Readonly<Record<string, string>>;
  /** The first source line that wrote this date. */
  readonly lineNumber: number;
}

/** A named thing on one day or a range of days (§41.4). */
export interface CalendarEvent {
  readonly name: string;
  /** First and last day, inclusive, clipped to the span. */
  readonly start: DayNumber;
  readonly end: DayNumber;
  /** Tag values by tag-group key, in the group's own spelling. */
  readonly tags: Readonly<Record<string, string>>;
  /** Indented note lines, raw (simple markdown). */
  readonly notes: readonly string[];
  readonly lineNumber: number;
}

export interface ParsedCalendar {
  readonly type: 'calendar';
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  readonly frame?: ChartFrame;
  readonly title?: string;
  readonly titleLineNumber?: number;
  /** `year YYYY`, when written. */
  readonly year?: number;
  /** First and last day drawn, inclusive. */
  readonly start: DayNumber;
  readonly end: DayNumber;
  /** `week-start monday` sets 1; Sunday (0) is the default. */
  readonly weekStart: 0 | 1;
  /** The arrangement; `layout …`, else `month` when any event exists. */
  readonly layout: CalendarLayout;
  /** `orientation-horizontal`: months as rows in `layout months`. */
  readonly horizontal: boolean;
  /** `months-per-row N` (1–6), for `layout month`. */
  readonly monthsPerRow?: number;
  /** The legend label for a blank tag day (`empty <label>`). */
  readonly emptyLabel: string;
  /** `fill-tint` (default), `fill-solid` or `fill-outline`, for event bars. */
  readonly fillMode: FillMode | 'tint';
  readonly numberGroups: readonly CalendarNumberGroup[];
  /** `tag Name` groups, with their values and colours. */
  readonly tagGroups: readonly TagGroup[];
  /** Every group in declaration order; the first is the open pill. */
  readonly groups: readonly CalendarGroupRef[];
  /** Days with a mark inside the span, in date order. */
  readonly days: readonly CalendarDay[];
  /** Events inside the span, in source order. */
  readonly events: readonly CalendarEvent[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
