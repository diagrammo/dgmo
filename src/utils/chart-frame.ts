// ============================================================
// Chart frame — the publication furniture around a chart (#1827).
//
// A published chart stacks: title, subtitle (deck), the plot, then footnotes,
// a source line and a byline. The title is drawn by each renderer as before;
// everything else in the frame is parsed by `parseChartFrameLine` and drawn by
// `applyChartFrame`, once, for every chart type that adopts it — so the frame
// is placed identically everywhere.
//
// Two ways a renderer adopts it:
//   - The data charts reserve the bands with `reserveChartFrame`, draw the
//     plot into `height - reserve.top - reserve.bottom`, then call
//     `applyChartFrame`. It moves everything but the title row down by
//     `reserve.top`, draws the subtitle under the title and the footer at the
//     bottom, so the canvas keeps the size it was given.
//   - Every other chart type draws as it always has, then calls
//     `growChartFrame` on the finished SVG. It reads where the title and the
//     drawing ended up, opens the subtitle band under the title, puts the
//     footer under the drawing, and grows the viewBox by what did not fit.
//
// The footer note is spelled `footnote` in every chart type, because `note`
// is the note-card element in eleven of them (owner, 2026-11-11).
// ============================================================

import type * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import {
  IDENTITY,
  measureSvgContent,
  multiply,
  parseTransform,
  type Matrix,
} from './export-fit';
import { fitWrapped } from './text-measure';
import { TITLE_LINE_HEIGHT, TITLE_SIDE_PAD, TITLE_Y } from './title-constants';
import { hasChartFrame, type ChartFrame } from './chart-frame-parse';

export {
  hasChartFrame,
  parseChartFrameLine,
  type ChartFrame,
  type ChartFrameFootnote,
} from './chart-frame-parse';

// Type scale: title (20, bold) > subtitle > body (13) > footer.
export const SUBTITLE_FONT_SIZE = 15;
export const SUBTITLE_LINE_HEIGHT = 20;
/** Lines a subtitle may wrap to before it ends in `…`. */
export const SUBTITLE_MAX_LINES = 2;
export const FOOTER_FONT_SIZE = 11;
export const FOOTER_LINE_HEIGHT = 15;
/** Lines one footnote may wrap to before it ends in `…`. */
export const FOOTNOTE_MAX_LINES = 3;
/** Lines the `Source: …` line may wrap to before it ends in `…`. */
export const SOURCE_MAX_LINES = 2;
/** The byline is fitted to one line and ends in `…` past it. */
export const BYLINE_MAX_LINES = 1;
/** Space between the bottom of the plot band and the first footer line. */
export const FOOTER_TOP_GAP = 10;
/** Space between the last footer baseline and the canvas edge. */
export const FOOTER_BOTTOM_PAD = 12;
/** Space between the last subtitle line and the plot. */
export const SUBTITLE_BOTTOM_GAP = 6;
/** First subtitle baseline when the chart draws no title. */
const SUBTITLE_Y_NO_TITLE = 24;

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
  for (const footnote of frame.footnotes ?? []) {
    for (const text of fitLines(
      footnote.text,
      maxWidth,
      FOOTER_FONT_SIZE,
      FOOTNOTE_MAX_LINES
    ))
      footerLines.push({
        text,
        className: 'chart-footnote',
        lineNumber: footnote.lineNumber,
      });
  }
  if (frame.source) {
    for (const text of fitLines(
      `Source: ${frame.source}`,
      maxWidth,
      FOOTER_FONT_SIZE,
      SOURCE_MAX_LINES
    ))
      footerLines.push({
        text,
        className: 'chart-source',
        lineNumber: frame.sourceLineNumber,
      });
  }
  if (frame.byline) {
    for (const text of fitLines(
      frame.byline,
      maxWidth,
      FOOTER_FONT_SIZE,
      BYLINE_MAX_LINES
    ))
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
  node: Element,
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

/** The frame without its subtitle, for a chart that draws the subtitle itself. */
export function footerOnly(frame: ChartFrame): ChartFrame {
  const footer: ChartFrame = { ...frame };
  delete footer.subtitle;
  delete footer.subtitleLineNumber;
  return footer;
}

// ============================================================
// growChartFrame — the frame for every chart that is not a data chart
// ============================================================

/** How `growChartFrame` treats the root `<svg>`'s width and height. */
export interface GrowChartFrameOptions {
  /**
   * The chart's title element, when it is not the first `text.chart-title`.
   * Pass null for a chart that draws no title row the frame can hang from.
   */
  title?: Element | null;
  /**
   * `'grow'` (the default) for a chart that sizes itself: the root `width`
   * and `height` grow with the viewBox. `'fit'` for a canvas the caller sized
   * (a preview pane, a requested export size): they stay, and the drawing
   * scales down inside them to make room.
   */
  size?: 'grow' | 'fit';
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readRootBox(node: SVGSVGElement): Box | null {
  const raw = node.getAttribute('viewBox');
  if (raw) {
    const n = raw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      n.length === 4 &&
      n.every((v) => Number.isFinite(v)) &&
      n[2]! > 0 &&
      n[3]! > 0
    )
      return { x: n[0]!, y: n[1]!, width: n[2]!, height: n[3]! };
    return null;
  }
  const w = Number(node.getAttribute('width'));
  const h = Number(node.getAttribute('height'));
  if (!(w > 0) || !(h > 0)) return null;
  return { x: 0, y: 0, width: w, height: h };
}

/** The element's transform from its own user space to the root's, or null. */
function ctmOf(el: Element, root: Element): Matrix | null {
  const chain: Element[] = [];
  for (let e: Element | null = el; e && e !== root; e = e.parentElement)
    chain.unshift(e);
  let m: Matrix = IDENTITY;
  for (const e of chain) {
    const t = e.getAttribute('transform');
    if (!t) continue;
    const local = parseTransform(t);
    if (!local) return null;
    m = multiply(m, local);
  }
  return m;
}

/** A root-level rect that paints the whole canvas (a background). */
function isCanvasRect(el: Element, vb: Box): boolean {
  if (el.tagName.toLowerCase() !== 'rect') return false;
  if ((el.getAttribute('class') ?? '').includes('dgmo-canvas-bg')) return true;
  const w = el.getAttribute('width');
  const h = el.getAttribute('height');
  const full = (v: string | null, n: number) =>
    v === '100%' || (v !== null && Math.abs(Number(v) - n) < 0.5);
  const x = Number(el.getAttribute('x') ?? 0);
  const y = Number(el.getAttribute('y') ?? 0);
  return (
    full(w, vb.width) &&
    full(h, vb.height) &&
    (w === '100%' || Math.abs(x - vb.x) < 0.5) &&
    (h === '100%' || Math.abs(y - vb.y) < 0.5)
  );
}

/**
 * Draw the frame onto a chart that has already drawn itself (#1827).
 *
 * - The subtitle goes under the title row. Everything except the title (and
 *   any `[data-chart-header]` element beside it) moves down to make room.
 * - The footer goes under the drawing, measured from what was drawn, so a
 *   drawing centred on a large canvas does not leave its footer stranded at
 *   the canvas edge. The viewBox grows only by what does not fit in the
 *   space already below the drawing.
 * - The frame follows the title: its alignment (centred, or flush left with
 *   a left-aligned title) and its scale, so a chart that scales its whole
 *   drawing, title included, keeps the type scale title > subtitle > footer.
 *
 * Does nothing when `frame` has nothing to draw, so a chart without the
 * directives renders byte for byte as before.
 */
export function growChartFrame(
  node: SVGSVGElement | null | undefined,
  frame: ChartFrame | undefined,
  palette: PaletteColors,
  opts: GrowChartFrameOptions = {}
): void {
  if (!node || !frame || !hasChartFrame(frame)) return;
  const vb = readRootBox(node);
  if (!vb) return;
  const doc = node.ownerDocument;

  const titleCandidate =
    opts.title !== undefined
      ? opts.title
      : node.querySelector<SVGTextElement>('text.chart-title');
  const titleCtm = titleCandidate ? ctmOf(titleCandidate, node) : null;
  // A title under a rotation or skew cannot anchor the frame; treat the chart
  // as untitled rather than guess.
  const title =
    titleCandidate && titleCtm?.[1] === 0 && titleCtm[2] === 0
      ? titleCandidate
      : null;
  const m: Matrix = title ? titleCtm! : IDENTITY;
  const scale = title && m[3] > 0 ? m[3] : 1;

  const reserve = reserveChartFrame(frame, vb.width / scale);
  if (!reserve) return;

  // Where the drawing ends, measured without the canvas background (which
  // spans the whole canvas and would hide any room left below the drawing).
  const backgrounds = Array.from(node.children).filter((c) =>
    isCanvasRect(c, vb)
  );
  const placeholders = backgrounds.map((bg) => {
    const ph = doc.createComment('bg');
    node.replaceChild(ph, bg);
    return ph;
  });
  const measured = measureSvgContent(node.outerHTML);
  placeholders.forEach((ph, i) => node.replaceChild(backgrounds[i]!, ph));
  const vbBottom = vb.y + vb.height;
  const drawnBottom =
    measured.complete && measured.box
      ? Math.min(measured.box.y1, vbBottom)
      : vbBottom;

  // The title row, in root units.
  let x = vb.x + vb.width / 2;
  let anchor: 'middle' | 'start' = 'middle';
  let subtitleY = vb.y + SUBTITLE_Y_NO_TITLE * scale;
  if (title) {
    const tx = Number(title.getAttribute('x') ?? 0);
    const ty = Number(title.getAttribute('y') ?? 0);
    const lines = Math.max(1, title.querySelectorAll('tspan').length);
    const baseline = ty + (lines - 1) * TITLE_LINE_HEIGHT;
    const a = title.getAttribute('text-anchor') ?? 'start';
    anchor = a === 'middle' ? 'middle' : 'start';
    x = m[0] * tx + m[4];
    subtitleY = m[3] * baseline + m[5] + (SUBTITLE_LINE_HEIGHT + 2) * scale;
  }

  // Open the subtitle band: everything but the title row and the canvas
  // background moves down.
  const top = reserve.top * scale;
  if (top > 0) {
    const body = doc.createElementNS(SVG_NS, 'g');
    body.setAttribute('class', 'chart-frame-body');
    body.setAttribute('transform', `translate(0,${top})`);
    const keep = new Set<Node>(backgrounds);
    for (const child of Array.from(node.childNodes)) {
      if (keep.has(child)) continue;
      if (child === title) continue;
      if ((child as Element).hasAttribute?.('data-chart-header')) continue;
      body.appendChild(child);
    }
    node.appendChild(body);
    // A title nested in a moved group is moved back up by the same amount.
    const pinned = title
      ? [title, ...Array.from(body.querySelectorAll('[data-chart-header]'))]
      : Array.from(body.querySelectorAll('[data-chart-header]'));
    for (const el of pinned) {
      if (!body.contains(el)) continue;
      // The shift is written in the parent's user space, so divide by its scale.
      const parent = el.parentElement ? ctmOf(el.parentElement, node) : null;
      const sy = parent && parent[3] > 0 ? parent[3] : 1;
      const prev = el.getAttribute('transform');
      el.setAttribute(
        'transform',
        `translate(0,${-top / sy})${prev ? ` ${prev}` : ''}`
      );
    }
  }

  const g = doc.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'chart-frame');
  node.appendChild(g);
  const lineH = SUBTITLE_LINE_HEIGHT * scale;
  reserve.subtitleLines.forEach((line, i) => {
    drawLine(
      g,
      line,
      x,
      subtitleY + i * lineH,
      anchor,
      SUBTITLE_FONT_SIZE * scale,
      palette.text
    );
  });

  // The footer under the drawing.
  let newBottom: number;
  const n = reserve.footerLines.length;
  if (n > 0) {
    const first =
      drawnBottom + top + (FOOTER_TOP_GAP + FOOTER_FONT_SIZE) * scale;
    reserve.footerLines.forEach((line, i) => {
      drawLine(
        g,
        line,
        x,
        first + i * FOOTER_LINE_HEIGHT * scale,
        anchor,
        FOOTER_FONT_SIZE * scale,
        palette.textMuted
      );
    });
    const footerEnd =
      first + (n - 1) * FOOTER_LINE_HEIGHT * scale + FOOTER_BOTTOM_PAD * scale;
    newBottom = Math.max(vbBottom, footerEnd);
  } else {
    // No footer: keep the margin the drawing had below it, up to a pad.
    const margin = Math.min(vbBottom - drawnBottom, FOOTER_BOTTOM_PAD * 2);
    newBottom = Math.max(vbBottom, drawnBottom + top + margin);
  }

  const newHeight = newBottom - vb.y;
  if (newHeight === vb.height) return;
  node.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${newHeight}`);
  for (const bg of backgrounds) {
    if (bg.getAttribute('height') !== '100%')
      bg.setAttribute('height', String(newHeight));
  }
  if ((opts.size ?? 'grow') === 'grow') {
    const h = Number(node.getAttribute('height'));
    if (h > 0)
      node.setAttribute(
        'height',
        String(Math.round((h * newHeight) / vb.height))
      );
  } else if (!node.getAttribute('preserveAspectRatio')) {
    node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
}
