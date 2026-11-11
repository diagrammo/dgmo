// ============================================================
// Chart frame — the publication furniture around a chart (#1827).
//
// A published chart stacks: title, subtitle (deck), the plot, then notes, a
// source line and a byline. The title is drawn by each renderer as before;
// everything else in the frame is parsed by `parseChartFrameLine` and drawn by
// `applyChartFrame`, once, for every chart type that adopts it — so the frame
// is placed identically everywhere.
//
// How a renderer adopts it: reserve the bands with `reserveChartFrame`, draw
// the plot into `height - reserve.top - reserve.bottom`, then call
// `applyChartFrame`. It moves everything but the title row down by
// `reserve.top`, draws the subtitle under the title and the footer at the
// bottom, so the canvas keeps the size it was given and the renderer itself
// changes nothing.
// ============================================================

import type * as d3Selection from 'd3-selection';
import type { DgmoError } from '../diagnostics';
import { makeDgmoError } from '../diagnostics';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { fitWrapped } from './text-measure';
import { TITLE_LINE_HEIGHT, TITLE_SIDE_PAD, TITLE_Y } from './title-constants';

/** One note line under the plot (`note` is repeatable). */
export interface ChartFrameNote {
  text: string;
  lineNumber: number;
}

/** The `subtitle`, `source`, `note` and `byline` directives of one chart. */
export interface ChartFrame {
  subtitle?: string;
  subtitleLineNumber?: number;
  source?: string;
  sourceLineNumber?: number;
  byline?: string;
  bylineLineNumber?: number;
  notes?: ChartFrameNote[];
}

// Type scale: title (20, bold) > subtitle > body (13) > footer.
export const SUBTITLE_FONT_SIZE = 15;
export const SUBTITLE_LINE_HEIGHT = 20;
/** Lines a subtitle may wrap to before it ends in `…`. */
export const SUBTITLE_MAX_LINES = 2;
export const FOOTER_FONT_SIZE = 11;
export const FOOTER_LINE_HEIGHT = 15;
/** Lines one note may wrap to before it ends in `…`. */
export const NOTE_MAX_LINES = 3;
/** Space between the bottom of the plot band and the first footer line. */
export const FOOTER_TOP_GAP = 10;
/** Space between the last footer baseline and the canvas edge. */
export const FOOTER_BOTTOM_PAD = 12;
/** Space between the last subtitle line and the plot. */
export const SUBTITLE_BOTTOM_GAP = 6;
/** First subtitle baseline when the chart draws no title. */
const SUBTITLE_Y_NO_TITLE = 24;

/**
 * Read one frame directive into `holder.frame`, creating it on the first one.
 * Returns true when `rawLine` was one. A directive starts in column 1: an
 * indented line is a child row (a sankey target, a series value) and is
 * never one.
 *
 * The keyword is matched case-sensitively, as written in the language
 * reference, so a data row labelled `Source 12` or `Note 3` stays a data row
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
  const m = /^(subtitle|source|note|byline)(?:\s+(.*))?$/.exec(
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
  if (token === 'note') {
    (frame.notes ??= []).push({ text: value, lineNumber });
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
  note: 'Figures are unaudited.',
  byline: 'Chart: Jane Doe',
};

/** True when `frame` has anything to draw. */
export function hasChartFrame(frame: ChartFrame | undefined): boolean {
  return (
    !!frame &&
    (!!frame.subtitle ||
      !!frame.source ||
      !!frame.byline ||
      (frame.notes?.length ?? 0) > 0)
  );
}

interface FrameLine {
  text: string;
  className: string;
  lineNumber?: number | undefined;
}

/** The space a frame takes, and its lines already fitted to the width. */
export interface ChartFrameReserve {
  /** Height the subtitle band adds between the title row and the plot. */
  top: number;
  /** Height the footer band takes at the bottom of the canvas. */
  bottom: number;
  subtitleLines: FrameLine[];
  footerLines: FrameLine[];
}

function fitLines(text: string, maxWidth: number, size: number, cap: number) {
  return fitWrapped(text, maxWidth, size, size, cap, { bold: false }).lines;
}

/**
 * Fit the frame to `width` and say how much of the canvas it takes. Returns
 * undefined when the chart has no frame directives, so a chart without them
 * lays out exactly as before.
 */
export function reserveChartFrame(
  frame: ChartFrame | undefined,
  width: number
): ChartFrameReserve | undefined {
  if (!frame || !hasChartFrame(frame)) return undefined;
  const maxWidth = Math.max(0, width - 2 * TITLE_SIDE_PAD);
  const subtitleLines: FrameLine[] = frame.subtitle
    ? fitLines(
        frame.subtitle,
        maxWidth,
        SUBTITLE_FONT_SIZE,
        SUBTITLE_MAX_LINES
      ).map((text) => ({
        text,
        className: 'chart-subtitle',
        lineNumber: frame.subtitleLineNumber,
      }))
    : [];
  const footerLines: FrameLine[] = [];
  for (const note of frame.notes ?? []) {
    for (const text of fitLines(
      note.text,
      maxWidth,
      FOOTER_FONT_SIZE,
      NOTE_MAX_LINES
    ))
      footerLines.push({
        text,
        className: 'chart-note',
        lineNumber: note.lineNumber,
      });
  }
  if (frame.source) {
    for (const text of fitLines(
      `Source: ${frame.source}`,
      maxWidth,
      FOOTER_FONT_SIZE,
      2
    ))
      footerLines.push({
        text,
        className: 'chart-source',
        lineNumber: frame.sourceLineNumber,
      });
  }
  if (frame.byline) {
    for (const text of fitLines(frame.byline, maxWidth, FOOTER_FONT_SIZE, 1))
      footerLines.push({
        text,
        className: 'chart-byline',
        lineNumber: frame.bylineLineNumber,
      });
  }
  const top = subtitleLines.length
    ? subtitleLines.length * SUBTITLE_LINE_HEIGHT + SUBTITLE_BOTTOM_GAP
    : 0;
  const bottom = footerLines.length
    ? FOOTER_TOP_GAP +
      (footerLines.length - 1) * FOOTER_LINE_HEIGHT +
      FOOTER_FONT_SIZE +
      FOOTER_BOTTOM_PAD
    : 0;
  return { top, bottom, subtitleLines, footerLines };
}

type Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Draw a reserved frame onto a chart whose plot was laid out into
 * `height - reserve.top - reserve.bottom`.
 *
 * Everything already on the SVG except the title row — `text.chart-title` and
 * any `[data-chart-header]` element drawn beside it — moves down by
 * `reserve.top`. The subtitle goes under the title, the footer at the bottom.
 * Both follow the title's alignment: centred under a centred title, flush
 * left under a left-aligned one (`legend-inline`).
 */
export function applyChartFrame(
  svg: Svg,
  reserve: ChartFrameReserve,
  width: number,
  height: number,
  palette: PaletteColors
): void {
  const node = svg.node();
  if (!node) return;
  const doc = node.ownerDocument;
  const title = node.querySelector<SVGTextElement>('text.chart-title');
  const titleAnchor = title?.getAttribute('text-anchor') ?? 'start';
  const centred = !title || titleAnchor === 'middle';
  const x = centred ? width / 2 : Number(title.getAttribute('x') ?? 0);
  const anchor = centred ? 'middle' : 'start';

  if (reserve.top > 0) {
    const body = doc.createElementNS(SVG_NS, 'g');
    body.setAttribute('class', 'chart-frame-body');
    body.setAttribute('transform', `translate(0,${reserve.top})`);
    for (const child of Array.from(node.childNodes)) {
      if (child === title) continue;
      if ((child as Element).hasAttribute?.('data-chart-header')) continue;
      body.appendChild(child);
    }
    node.appendChild(body);
  }

  const titleLines = title
    ? Math.max(1, title.querySelectorAll('tspan').length)
    : 0;
  let y = title
    ? TITLE_Y + (titleLines - 1) * TITLE_LINE_HEIGHT + SUBTITLE_LINE_HEIGHT + 2
    : SUBTITLE_Y_NO_TITLE;
  for (const line of reserve.subtitleLines) {
    drawLine(node, line, x, y, anchor, SUBTITLE_FONT_SIZE, palette.text);
    y += SUBTITLE_LINE_HEIGHT;
  }

  const n = reserve.footerLines.length;
  reserve.footerLines.forEach((line, i) => {
    const baseline =
      height - FOOTER_BOTTOM_PAD - (n - 1 - i) * FOOTER_LINE_HEIGHT;
    drawLine(
      node,
      line,
      x,
      baseline,
      anchor,
      FOOTER_FONT_SIZE,
      palette.textMuted
    );
  });
}

function drawLine(
  node: SVGSVGElement,
  line: FrameLine,
  x: number,
  y: number,
  anchor: 'middle' | 'start',
  fontSize: number,
  fill: string
): void {
  const el = node.ownerDocument.createElementNS(SVG_NS, 'text');
  el.setAttribute('class', line.className);
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.setAttribute('text-anchor', anchor);
  el.setAttribute('fill', fill);
  el.setAttribute('font-size', String(fontSize));
  el.setAttribute('font-family', FONT_FAMILY);
  if (line.lineNumber)
    el.setAttribute('data-line-number', String(line.lineNumber));
  el.textContent = line.text;
  node.appendChild(el);
}
