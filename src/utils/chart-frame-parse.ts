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

/** Which edge a part of the frame sits on (#1838). Default `left`. */
export type FrameAlign = 'left' | 'center' | 'right';

/** The parts of the frame that `<part>-align` moves. */
export type FramePart = 'title' | 'subtitle' | 'legend' | 'footer';

/**
 * The alignment lines of one chart (#1838): `align` for the whole frame,
 * `<part>-align` to override one part. Line numbers let a chart type that
 * ignores them say which line.
 */
export interface ChartFrameAlign {
  all?: FrameAlign;
  title?: FrameAlign;
  subtitle?: FrameAlign;
  legend?: FrameAlign;
  footer?: FrameAlign;
  lineNumbers: number[];
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
  /** `align`, `title-align`, … (#1838). */
  align?: ChartFrameAlign;
  /**
   * How a static legend is drawn (#1838): a bare key (the default), or
   * `legend-box` / `legend-pill`. The app's interactive legend is unchanged.
   */
  legendStyle?: 'box' | 'pill';
  legendStyleLineNumber?: number;
}

const ALIGN_RE =
  /^(align|title-align|subtitle-align|legend-align|footer-align)(?:\s+(\S.*))?$/;
const ALIGN_VALUES: readonly FrameAlign[] = ['left', 'center', 'right'];

/**
 * Where `part` sits: its own line, else the whole-frame `align`, else left.
 * The subtitle follows the title, because the two read as one block.
 */
export function frameAlign(
  frame: ChartFrame | undefined,
  part: FramePart
): FrameAlign {
  const a = frame?.align;
  if (!a) return 'left';
  if (part === 'subtitle') return a.subtitle ?? a.title ?? a.all ?? 'left';
  return a[part] ?? a.all ?? 'left';
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
  diagnostics: DgmoError[],
  opts: { heroTitle?: string } = {}
): boolean {
  const trimmed = rawLine.trimEnd();
  if (trimmed === 'legend-box' || trimmed === 'legend-pill') {
    const frame = (holder.frame ??= {});
    frame.legendStyle = trimmed === 'legend-box' ? 'box' : 'pill';
    frame.legendStyleLineNumber = lineNumber;
    return true;
  }
  const am = ALIGN_RE.exec(trimmed);
  if (am) {
    const token = am[1]!;
    const value = (am[2] ?? '').trim();
    if (!ALIGN_VALUES.includes(value as FrameAlign)) {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          `"${token}" takes left, center or right${value ? `, not "${value}"` : ''} — the line is ignored.`,
          'warning'
        )
      );
      return true;
    }
    if (opts.heroTitle && (token === 'align' || token === 'title-align')) {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          `${opts.heroTitle} keeps its own large title, so "${token}" does nothing here — use subtitle-align, legend-align or footer-align. The line is ignored.`,
          'warning'
        )
      );
      return true;
    }
    const frame = (holder.frame ??= {});
    const align = (frame.align ??= { lineNumbers: [] });
    const part =
      token === 'align'
        ? 'all'
        : (token.slice(0, -'-align'.length) as FramePart);
    align[part] = value as FrameAlign;
    align.lineNumbers.push(lineNumber);
    return true;
  }
  const m = /^(subtitle|source|footnote|byline)(?:\s+(.*))?$/.exec(trimmed);
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
