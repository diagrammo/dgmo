// ============================================================
// Chart frame — the parsed form and its one-line reader (#1827).
//
// Split from chart-frame.ts so every chart type's parser can read the frame
// without pulling in the drawing code (text measurement, the SVG measurer).
// ============================================================

import type { DgmoError } from '../diagnostics';
import { makeDgmoError } from '../diagnostics';

/** One footnote under the plot (`footnote` is repeatable). */
export interface ChartFrameFootnote {
  text: string;
  lineNumber: number;
}

/** The `subtitle`, `source`, `footnote` and `byline` directives of one chart. */
export interface ChartFrame {
  subtitle?: string;
  subtitleLineNumber?: number;
  source?: string;
  sourceLineNumber?: number;
  byline?: string;
  bylineLineNumber?: number;
  footnotes?: ChartFrameFootnote[];
}

/**
 * Read one frame directive into `holder.frame`, creating it on the first one.
 * Returns true when `rawLine` was one. A directive starts in column 1: an
 * indented line is a child row (a sankey target, a series value) and is
 * never one.
 *
 * The keyword is matched case-sensitively, as written in the language
 * reference, so a data row labelled `Source 12` or `Footnote 3` stays a data row
 * (the pie-only directives follow the same rule). A line with an arrow
 * (`source -> Sink 5`) is never a directive: it is a flow row of a sankey or
 * chord whose node is named `source`, and stays the parser's to read.
 */
export function parseChartFrameLine(
  holder: { frame?: ChartFrame },
  rawLine: string,
  lineNumber: number,
  diagnostics: DgmoError[]
): boolean {
  const m = /^(subtitle|source|footnote|byline)(?:\s+(.*))?$/.exec(
    rawLine.trimEnd()
  );
  if (!m) return false;
  const token = m[1]!;
  const value = (m[2] ?? '').trim();
  if (value.includes('->')) return false;
  if (!value) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `"${token}" needs its text on the same line, e.g. "${token} ${EXAMPLE[token]}".`,
        'warning'
      )
    );
    return true;
  }
  const frame = (holder.frame ??= {});
  if (token === 'footnote') {
    (frame.footnotes ??= []).push({ text: value, lineNumber });
    return true;
  }
  const key = token as 'subtitle' | 'source' | 'byline';
  if (frame[key] !== undefined) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `"${key}" is given more than once; the last one is used.`,
        'warning'
      )
    );
  }
  frame[key] = value;
  frame[`${key}LineNumber`] = lineNumber;
  return true;
}

const EXAMPLE: Record<string, string> = {
  subtitle: 'Quarterly revenue, 2024–2025',
  source: 'Company filings',
  footnote: 'Figures are unaudited.',
  byline: 'Chart: Jane Doe',
};

/** True when `frame` has anything to draw. */
export function hasChartFrame(frame: ChartFrame | undefined): boolean {
  return (
    !!frame &&
    (!!frame.subtitle ||
      !!frame.source ||
      !!frame.byline ||
      (frame.footnotes?.length ?? 0) > 0)
  );
}
