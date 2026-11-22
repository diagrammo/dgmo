import type { DgmoError } from '../diagnostics';
import type { ChartFrame } from '../utils/chart-frame-parse';
import type { TagGroup } from '../utils/tag-groups';

/** One calendar day, as a UTC day number (days since 1970-01-01). */
export type DayNumber = number;

export interface CalendarDay {
  /** UTC day number. */
  readonly day: DayNumber;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** Sum of every entry written for this date; 0 in tag mode. */
  readonly value: number;
  /** Tag mode: the tag value the day takes, in its group's own spelling. */
  readonly tag?: string;
  /** The first source line that wrote this date. */
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
  /** `unit <noun>`, singular as written; the renderer makes it plural. */
  readonly unit?: string;
  /** First and last day drawn, inclusive. */
  readonly start: DayNumber;
  readonly end: DayNumber;
  /** `week-start monday` sets 1; Sunday (0) is the default. */
  readonly weekStart: 0 | 1;
  /** `max N`: pins the top band. */
  readonly max?: number;
  /** `heat <Label> [low] [high]` (the shared ramp convention, §13.9): the
   *  legend label and up to two palette colour names. */
  readonly heat?: { label: string; low?: string; high?: string };
  /** `tag`: entries carry tag values and each day takes its tag's colour
   *  (year in pixels, #1877); `value`: entries carry numbers. */
  readonly mode: 'value' | 'tag';
  /** `tag Name` groups, with their values and colours. */
  readonly tagGroups: readonly TagGroup[];
  /** Days with an entry inside the span, in date order. */
  readonly days: readonly CalendarDay[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
