// ============================================================
// Chart frame — the parsed form and its one-line reader (#1827).
//
// Split from chart-frame.ts so every chart type's parser can read the frame
// without pulling in the drawing code (text measurement, the SVG measurer).
// ============================================================

import type { DgmoError } from '../diagnostics';
import { makeDgmoError } from '../diagnostics';

/**
 * The footnote block under the plot (#2093): the text on the `footnote` line
 * and its indented body, as description-body lines (spec §1.12) — indent removed,
 * `- ` bullets already turned into `• `, blank lines kept as paragraph breaks.
 */
export interface ChartFrameFootnote {
  lines: string[];
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

/** The `subtitle` and `footnote` of one chart. */
export interface ChartFrame {
  subtitle?: string;
  subtitleLineNumber?: number;
  /** One per chart; a second `footnote` joins it as a new paragraph. */
  footnote?: ChartFrameFootnote;
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
  const m = /^(subtitle|footnote|source|byline)(?:\s+(.*))?$/.exec(trimmed);
  if (!m) return false;
  const token = m[1]!;
  const value = (m[2] ?? '').trim();
  if (value.includes('->')) return false;
  if (token === 'source' || token === 'byline') {
    // Removed in #2093: the footer is one markdown block.
    if (!value) return false;
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `"${token}" is not a keyword — write it as a line of the footnote block, e.g. "footnote ${token === 'source' ? '**Source:** ' : '*'}${value}${token === 'byline' ? '*' : ''}". The line is ignored.`,
        'warning'
      )
    );
    return true;
  }
  if (token === 'footnote') {
    // A parser that ran `takeFootnoteBlock` never gets here; one that did
    // not still reads the one-line form.
    addFootnote(holder, value ? [value] : [], lineNumber, diagnostics);
    return true;
  }
  if (!value) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `"subtitle" needs its text on the same line, e.g. "subtitle Quarterly revenue, 2024–2025".`,
        'warning'
      )
    );
    return true;
  }
  const frame = (holder.frame ??= {});
  if (frame.subtitle !== undefined) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `"subtitle" is given more than once; the last one is used.`,
        'warning'
      )
    );
  }
  frame.subtitle = value;
  frame.subtitleLineNumber = lineNumber;
  return true;
}

/**
 * The bullet marker description bodies use (`BULLET_PREFIX` in
 * wrapped-desc.ts). Spelled here so this module stays light: the completion
 * registry reaches it, and wrapped-desc pulls in the markdown renderer.
 */
const BULLET_PREFIX = '• ';

const FOOTNOTE_RE = /^footnote(?:\s+(.*))?$/;
const COMMENT_RE = /^\/\//;

/** One body line as a description line: trimmed, `- ` → `• `. */
function bodyLine(line: string): string {
  const t = line.trim();
  return t.startsWith('- ') ? `${BULLET_PREFIX}${t.slice(2).trimStart()}` : t;
}

function addFootnote(
  holder: { frame?: ChartFrame },
  body: string[],
  lineNumber: number,
  diagnostics: DgmoError[]
): void {
  const lines = body.map(bodyLine);
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.some(Boolean)) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        '"footnote" needs text — on the same line ("footnote Figures are unaudited.") or indented on the lines below it.',
        'warning'
      )
    );
    return;
  }
  const frame = (holder.frame ??= {});
  if (frame.footnote) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        'A chart has one footnote block — move this text into the first one. It is drawn as a new paragraph of it.',
        'warning'
      )
    );
    frame.footnote.lines.push('', ...lines);
    return;
  }
  frame.footnote = { lines, lineNumber };
}

/**
 * Read every `footnote` block out of a chart's source lines (#2093): a
 * `footnote` line in column 1, its text, and the indented markdown body below
 * it (blank lines inside it are paragraph breaks). The lines read are set to
 * `''` in place, so the chart type's own parser never sees them and every
 * line keeps its number. Run it on the raw lines, before a parser trims or
 * strips them. `firstLineNumber` is the number of `lines[0]`.
 */
export function takeFootnoteBlock(
  holder: { frame?: ChartFrame },
  lines: string[],
  diagnostics: DgmoError[],
  firstLineNumber = 1
): void {
  for (let i = 0; i < lines.length; i++) {
    const m = FOOTNOTE_RE.exec(lines[i]!.trimEnd());
    if (!m) continue;
    const inline = (m[1] ?? '').trim();
    if (inline.includes('->')) continue;
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (!l.trim()) continue;
      if (!/^\s/.test(l)) break;
      last = j;
    }
    const body: string[] = inline ? [inline] : [];
    for (let k = i + 1; k <= last; k++) {
      const l = lines[k]!.trim();
      if (COMMENT_RE.test(l)) continue;
      body.push(l);
    }
    addFootnote(holder, body, i + firstLineNumber, diagnostics);
    for (let k = i; k <= last; k++) lines[k] = '';
    i = last;
  }
}

/** True when `frame` has anything to draw. */
export function hasChartFrame(frame: ChartFrame | undefined): boolean {
  return (
    !!frame && (!!frame.subtitle || (frame.footnote?.lines.length ?? 0) > 0)
  );
}
