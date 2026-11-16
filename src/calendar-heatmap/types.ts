import type { DgmoError } from '../diagnostics';
import type { ChartFrame } from '../utils/chart-frame-parse';

/** One calendar day, as a UTC day number (days since 1970-01-01). */
export type DayNumber = number;

export interface CalendarHeatmapDay {
  /** UTC day number. */
  readonly day: DayNumber;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** Sum of every entry written for this date. */
  readonly value: number;
  /** The first source line that wrote this date. */
  readonly lineNumber: number;
}

export interface ParsedCalendarHeatmap {
  readonly type: 'calendar-heatmap';
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
  /** Days with an entry inside the span, in date order. */
  readonly days: readonly CalendarHeatmapDay[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
