// ============================================================
// Whiteboard diagram — Renderer (spec §39)
// ============================================================
//
// Clean vector shapes (no hand-drawn wobble); only ink looks hand-made, drawn
// with perfect-freehand as a filled outline polygon so resvg renders it too.
// The canvas is infinite, so the SVG is cropped to the content bounds plus a
// margin, with the title band above.
//
// Colours are palette NAMES resolved here: `ink` is `palette.text` (near-black
// on light, near-white on dark), every other name is the palette's own shade
// of that hue for the current theme.

import * as d3 from 'd3-selection';
import { getStroke } from 'perfect-freehand';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import { drawCylinderCard, drawQueueCard } from '../c4/renderer';
import { renderChartTitle } from '../utils/d3-helpers';
import { measureText } from '../utils/text-measure';
import { TITLE_FONT_SIZE } from '../utils/title-constants';
import {
  RECT_RADIUS,
  clipWhiteboardConnector,
  whiteboardConnectorAttachments,
  whiteboardNoteFold,
  whiteboardSegmentMidpoint,
  type WhiteboardPoint,
  type WhiteboardSegment,
} from './geometry';
import type { InkPoint } from './ink-codec';
import {
  WHITEBOARD_LABEL_FONT as LABEL_FONT,
  WHITEBOARD_LABEL_LINE as LABEL_LINE,
  WHITEBOARD_NOTE_PAD as NOTE_PAD,
  fitWhiteboardLabel,
} from './label';
import type {
  ParsedWhiteboard,
  WhiteboardColor,
  WhiteboardElement,
  WhiteboardImage,
  WhiteboardNote,
} from './types';

export interface WhiteboardRenderOptions {
  /**
   * Turn an image ref into an `href` (a data URI or a URL). When supplied, its
   * answer is final: `undefined` draws the placeholder box. When omitted,
   * `https://` refs pass through unchanged and anything else is a placeholder.
   */
  readonly resolveImage?: (ref: string) => string | undefined;
  /**
   * Draw the sticky notes, overriding the board's `no-notes` directive either
   * way — the app's notes toggle and its export pass this. Omitted, the
   * directive decides: notes show unless the board says `no-notes`. Hidden
   * notes are left out entirely — not drawn, not counted in the crop — and so
   * is every arrow or line with an end on one.
   */
  readonly showNotes?: boolean;
}

/**
 * Whole-board indices of the elements a render draws, in order: every
 * element, less the sticky notes when they are hidden (see
 * {@link WhiteboardRenderOptions.showNotes}) and less every arrow or line with
 * an end on a hidden note — a connector drawn from a note goes with it, label
 * and all. Attachment is read on the WHOLE board, so an end the note held is
 * not re-attached to whatever lies beneath it.
 */
export function visibleWhiteboardIndices(
  parsed: ParsedWhiteboard,
  options: Pick<WhiteboardRenderOptions, 'showNotes'> = {}
): number[] {
  const all = parsed.elements;
  const show = options.showNotes ?? !parsed.options.noNotes;
  const out: number[] = [];
  all.forEach((el, i) => {
    if (show) return void out.push(i);
    if (el.kind === 'note') return;
    if (el.kind === 'arrow' || el.kind === 'line') {
      const { from, to } = whiteboardConnectorAttachments(el, all);
      if (all[from]?.kind === 'note' || all[to]?.kind === 'note') return;
    }
    out.push(i);
  });
  return out;
}

/**
 * The elements a render draws, in order — {@link visibleWhiteboardIndices},
 * as elements.
 */
export function visibleWhiteboardElements(
  parsed: ParsedWhiteboard,
  options: Pick<WhiteboardRenderOptions, 'showNotes'> = {}
): readonly WhiteboardElement[] {
  const show = options.showNotes ?? !parsed.options.noNotes;
  if (show) return parsed.elements;
  return visibleWhiteboardIndices(parsed, options).map(
    (i) => parsed.elements[i]!
  );
}

/** Space around the cropped content, px. */
const WHITEBOARD_MARGIN = 24;
const TITLE_BAND = 40;
const SHAPE_STROKE = 2;
const ARROW_STROKE = 2;
const ARROW_HEAD_LEN = 12;
const ARROW_HEAD_HALF = 6;
/**
 * `style: dashed` dash and gap, in multiples of the stroke width. The round
 * caps add half a width to each end of a dash, so the drawn dash is one width
 * longer and the drawn gap one width shorter: 8 on, 6 off at the default 2px.
 */
const DASH_ON = 3;
const DASH_OFF = 4;
const WHITEBOARD_TEXT_FONT = 16;
/** A sticky note's fill and edge: its hue mixed into the ground, percent. */
const NOTE_TINT = 40;
const NOTE_EDGE = 65;
/** A sticky note's text: its hue mixed into the palette's text colour, percent. */
const NOTE_INK = 40;
/** Opacity of a sticky note's folded corner, drawn in its edge colour. */
const NOTE_FOLD_OPACITY = 0.55;
const BASELINE = 0.8;
/** Placeholder text for an image no host could resolve. */
export const IMAGE_NOT_UPLOADED = 'image not uploaded';
const PLACEHOLDER_MIN_FONT = 8;

/** A drawable `href`: http(s), blob, or an inline raster/vector image. */
const SAFE_IMAGE_HREF_RE = /^(https?:|blob:|data:image\/)/i;

/** An arrow, line or text label's written lines — one drawn line each, never reflowed. */
function labelLines(label: string): string[] {
  return label.split('\n');
}

/** Widest of `lines` at `font` px. */
function widest(lines: readonly string[], font: number): number {
  return Math.max(0, ...lines.map((l) => measureText(l, font)));
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function grow(b: Bounds, x0: number, y0: number, x1: number, y1: number): void {
  b.minX = Math.min(b.minX, x0, x1);
  b.minY = Math.min(b.minY, y0, y1);
  b.maxX = Math.max(b.maxX, x0, x1);
  b.maxY = Math.max(b.maxY, y0, y1);
}

/** Height of a sticky note's text block, padding included, px. */
function noteTextHeight(el: WhiteboardNote): number {
  const { lines, font } = fitWhiteboardLabel(el.text, el);
  return 2 * NOTE_PAD + lines.length * font * LABEL_LINE;
}

/** Content bounds of every drawn element, in canvas px. */
export function whiteboardBounds(
  parsed: ParsedWhiteboard,
  options: Pick<WhiteboardRenderOptions, 'showNotes'> = {}
): Bounds {
  const b: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const elements = visibleWhiteboardElements(parsed, options);
  for (const el of elements) {
    switch (el.kind) {
      case 'shape':
      case 'image':
        grow(b, el.x, el.y, el.x + el.width, el.y + el.height);
        break;
      case 'note':
        // Text longer than the card runs on below it, and stays in the crop.
        grow(
          b,
          el.x,
          el.y,
          el.x + el.width,
          el.y + Math.max(el.height, noteTextHeight(el))
        );
        break;
      case 'arrow':
      case 'line': {
        // The DRAWN segment — an end attached to a shape stops at its border.
        const s = clipWhiteboardConnector(el, elements);
        const pad = ARROW_HEAD_HALF + ARROW_STROKE;
        grow(b, s.x1 - pad, s.y1 - pad, s.x2 + pad, s.y2 + pad);
        grow(b, s.x1 + pad, s.y1 + pad, s.x2 - pad, s.y2 - pad);
        if (s.cx !== undefined) {
          for (let k = 1; k < CURVE_BOUND_STEPS; k++) {
            const p = segmentPoint(s, k / CURVE_BOUND_STEPS);
            grow(b, p.x - pad, p.y - pad, p.x + pad, p.y + pad);
          }
        }
        if (el.label) {
          const lines = labelLines(el.label);
          const { x: mx, y: my } = whiteboardSegmentMidpoint(s);
          const hw = widest(lines, LABEL_FONT) / 2 + 4;
          const hh =
            LABEL_FONT + ((lines.length - 1) * LABEL_FONT * LABEL_LINE) / 2;
          grow(b, mx - hw, my - hh, mx + hw, my + hh);
        }
        break;
      }
      case 'text': {
        const lines = labelLines(el.text);
        grow(
          b,
          el.x,
          el.y,
          el.x + widest(lines, WHITEBOARD_TEXT_FONT),
          el.y + lines.length * WHITEBOARD_TEXT_FONT * LABEL_LINE
        );
        break;
      }
      case 'ink': {
        const r = el.width;
        for (const p of el.points) grow(b, p.x - r, p.y - r, p.x + r, p.y + r);
        break;
      }
    }
  }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return b;
}

/** Samples taken along a curve to fit it in the crop. */
const CURVE_BOUND_STEPS = 16;

/** The point at `t` along a drawn segment — straight, or its quadratic. */
function segmentPoint(s: WhiteboardSegment, t: number): WhiteboardPoint {
  const u = 1 - t;
  if (s.cx === undefined || s.cy === undefined) {
    return { x: u * s.x1 + t * s.x2, y: u * s.y1 + t * s.y2 };
  }
  return {
    x: u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2,
    y: u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2,
  };
}

/**
 * The `t` at which a curve is `len` px (straight-line) from its end at
 * `t = end`, found by bisection; the head is drawn over the rest.
 */
function curveTrim(s: WhiteboardSegment, end: 0 | 1, len: number): number {
  const tip = segmentPoint(s, end);
  let near: number = end;
  let far: number = 1 - end;
  for (let n = 0; n < 24; n++) {
    const m = (near + far) / 2;
    const p = segmentPoint(s, m);
    if (Math.hypot(p.x - tip.x, p.y - tip.y) < len) near = m;
    else far = m;
  }
  return (near + far) / 2;
}

/** The outline polygon perfect-freehand produces, as an SVG path. */
export function inkOutlinePath(
  points: readonly InkPoint[],
  width: number
): string {
  const hasPressure = points.every((p) => p.pressure !== undefined);
  const outline = getStroke(
    points.map((p) => (hasPressure ? [p.x, p.y, p.pressure!] : [p.x, p.y])),
    {
      size: width,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: !hasPressure,
      last: true,
    }
  );
  if (outline.length === 0) return '';
  const r = (n: number): string => String(Math.round(n * 100) / 100);
  // Quadratic smoothing through midpoints — perfect-freehand's own recipe.
  const first = outline[0]!;
  let d = `M${r(first[0]!)} ${r(first[1]!)}Q`;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    d += `${r(a[0]!)} ${r(a[1]!)} ${r((a[0]! + b[0]!) / 2)} ${r((a[1]! + b[1]!) / 2)} `;
  }
  return d.trimEnd() + 'Z';
}

type GSel = d3.Selection<SVGGElement, unknown, null, undefined>;

export function renderWhiteboard(
  container: HTMLDivElement,
  parsed: ParsedWhiteboard,
  palette: PaletteColors,
  isDark: boolean,
  options: WhiteboardRenderOptions = {}
): void {
  const base = themeBaseBg(palette, isDark);
  const colorOf = (c: WhiteboardColor): string =>
    c === 'ink' ? palette.text : (palette.colors[c] ?? palette.text);
  const fillOf = (c: WhiteboardColor): string =>
    c === 'ink' ? base : shapeFill(palette, colorOf(c), isDark);

  const showTitle = !!parsed.title && !parsed.options.noTitle;
  const titleOffset = showTitle ? TITLE_BAND : 0;
  const elements = visibleWhiteboardElements(parsed, options);
  const b = whiteboardBounds(parsed, options);
  const contentW = b.maxX - b.minX;
  const contentH = b.maxY - b.minY;
  const titleW = showTitle
    ? measureText(parsed.title!, TITLE_FONT_SIZE, { bold: true })
    : 0;
  const width = Math.ceil(Math.max(contentW, titleW) + 2 * WHITEBOARD_MARGIN);
  const height = Math.ceil(contentH + 2 * WHITEBOARD_MARGIN + titleOffset);
  // Centre the content under a title wider than it.
  const tx =
    WHITEBOARD_MARGIN - b.minX + (width - 2 * WHITEBOARD_MARGIN - contentW) / 2;
  const ty = WHITEBOARD_MARGIN + titleOffset - b.minY;

  d3.select(container).selectAll('*').remove();
  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('font-family', FONT_FAMILY);

  if (showTitle) {
    renderChartTitle(
      svg,
      parsed.title,
      parsed.titleLineNumber,
      width,
      palette.text
    );
  }

  const canvas = svg
    .append('g')
    .attr('class', 'whiteboard-canvas')
    .attr('transform', `translate(${round2(tx)},${round2(ty)})`);

  const halo = palette.bg;

  /** A shape label: fitted to the shape (#1225), centred as a block. */
  const centredLabel = (
    g: GSel,
    { lines, font }: { lines: readonly string[]; font: number },
    cx: number,
    cy: number,
    color: string = palette.text
  ): void => {
    if (lines.length === 0) return;
    const lh = font * LABEL_LINE;
    const top = cy - (lines.length * lh) / 2 + lh * BASELINE;
    const t = g
      .append('text')
      .attr('class', 'whiteboard-label')
      .attr('text-anchor', 'middle')
      .attr('font-size', font)
      .attr('fill', color);
    appendLines(t, lines, cx, top, lh);
  };

  const drawImage = (g: GSel, el: WhiteboardImage): void => {
    const resolved = options.resolveImage
      ? options.resolveImage(el.ref)
      : /^https:\/\//i.test(el.ref)
        ? el.ref
        : undefined;
    if (resolved !== undefined && SAFE_IMAGE_HREF_RE.test(resolved)) {
      g.append('image')
        .attr('x', el.x)
        .attr('y', el.y)
        .attr('width', el.width)
        .attr('height', el.height)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('href', resolved);
      return;
    }
    g.append('rect')
      .attr('class', 'whiteboard-image-placeholder')
      .attr('x', el.x)
      .attr('y', el.y)
      .attr('width', el.width)
      .attr('height', el.height)
      .attr('rx', 4)
      .attr('fill', mix(palette.textMuted, base, 10))
      .attr('stroke', mix(palette.textMuted, base, 50))
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '6 4');
    // Shrink the label to fit the box (≈0.55em per Inter glyph); a box too
    // small for a legible label keeps only its dashed outline.
    const fit = Math.min(
      LABEL_FONT,
      (el.width - 8) / (IMAGE_NOT_UPLOADED.length * 0.55)
    );
    if (fit < PLACEHOLDER_MIN_FONT) return;
    g.append('text')
      .attr('x', el.x + el.width / 2)
      .attr('y', el.y + el.height / 2 + fit * 0.35)
      .attr('text-anchor', 'middle')
      .attr('font-size', round2(fit))
      .attr('fill', palette.textMuted)
      .text(IMAGE_NOT_UPLOADED);
  };

  const drawElement = (el: WhiteboardElement): void => {
    const g = canvas
      .append('g')
      .attr('class', `whiteboard-${el.kind === 'shape' ? el.shape : el.kind}`)
      .attr('data-line-number', el.lineNumber);
    switch (el.kind) {
      case 'shape': {
        const stroke = colorOf(el.color);
        // tint: a wash of the colour · solid: the colour · outline: hollow.
        const fill =
          el.fill === 'solid'
            ? stroke
            : el.fill === 'outline'
              ? 'none'
              : fillOf(el.color);
        const labelColor =
          el.fill === 'solid'
            ? contrastText(stroke, base, palette.text)
            : palette.text;
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        if (el.shape === 'rectangle') {
          g.append('rect')
            .attr('x', el.x)
            .attr('y', el.y)
            .attr('width', el.width)
            .attr('height', el.height)
            .attr('rx', Math.min(RECT_RADIUS, el.width / 2, el.height / 2))
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', SHAPE_STROKE);
        } else if (el.shape === 'ellipse') {
          g.append('ellipse')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('rx', el.width / 2)
            .attr('ry', el.height / 2)
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', SHAPE_STROKE);
        } else {
          const inner = g
            .append('g')
            .attr('transform', `translate(${round2(cx)},${round2(cy)})`);
          if (el.shape === 'database') {
            drawCylinderCard(inner, el.width, el.height, fill, stroke, false);
          } else {
            drawQueueCard(inner, el.width, el.height, fill, stroke);
          }
        }
        centredLabel(g, fitWhiteboardLabel(el.label, el), cx, cy, labelColor);
        break;
      }
      case 'note': {
        // A flat tinted card — stronger than a shape's tint, edged in its own
        // hue — with its top-right corner folded down, and the text top-left
        // in a dark shade of the same hue, wrapped to the card.
        const hue = colorOf(el.color);
        const edge = mix(hue, base, NOTE_EDGE);
        const { x, y, width: w, height: h } = el;
        const f = whiteboardNoteFold(w, h);
        g.append('path')
          .attr('d', `M${x} ${y}h${w - f}l${f} ${f}v${h - f}h${-w}z`)
          .attr('fill', mix(hue, base, NOTE_TINT))
          .attr('stroke', edge)
          .attr('stroke-width', 1)
          .attr('stroke-linejoin', 'round');
        if (f > 2) {
          g.append('path')
            .attr('class', 'whiteboard-note-fold')
            .attr('d', `M${x + w - f} ${y}v${f - 2}q0 2 2 2h${f - 2}z`)
            .attr('fill', edge)
            .attr('opacity', NOTE_FOLD_OPACITY);
        }
        const { lines, font } = fitWhiteboardLabel(el.text, el);
        if (lines.length > 0) {
          const lh = font * LABEL_LINE;
          const t = g
            .append('text')
            .attr('class', 'whiteboard-label')
            .attr('font-size', font)
            .attr('fill', mix(hue, palette.text, NOTE_INK));
          appendLines(
            t,
            lines,
            el.x + NOTE_PAD,
            el.y + NOTE_PAD + lh * BASELINE,
            lh
          );
        }
        break;
      }
      case 'arrow':
      case 'line': {
        const color = colorOf(el.color);
        // An end inside a shape is attached and drawn to its border.
        const s = clipWhiteboardConnector(el, elements);
        const headEnd = el.kind === 'arrow';
        const headStart = el.kind === 'arrow' && el.heads === 'both';
        const dashed = (stroke: { attr(k: string, v: string): unknown }) => {
          if (el.style === 'dashed') {
            stroke.attr(
              'stroke-dasharray',
              `${DASH_ON * ARROW_STROKE} ${DASH_OFF * ARROW_STROKE}`
            );
          }
        };
        // A head: its tip at `tip`, its base `head` px back along (ux, uy).
        const drawHead = (
          tip: WhiteboardPoint,
          ux: number,
          uy: number,
          head: number
        ): void => {
          const bx = tip.x - ux * head;
          const by = tip.y - uy * head;
          const px = -uy * ARROW_HEAD_HALF;
          const py = ux * ARROW_HEAD_HALF;
          g.append('polygon')
            .attr(
              'points',
              `${round2(tip.x)},${round2(tip.y)} ${round2(bx + px)},${round2(by + py)} ${round2(bx - px)},${round2(by - py)}`
            )
            .attr('fill', color);
        };
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const len = Math.hypot(dx, dy);
        if (len > 0 && s.cx === undefined) {
          const ux = dx / len;
          const uy = dy / len;
          const headE = headEnd ? Math.min(ARROW_HEAD_LEN, len) : 0;
          const headS = headStart ? Math.min(ARROW_HEAD_LEN, len / 2) : 0;
          const head = headStart ? Math.min(headE, len / 2) : headE;
          const bx = s.x2 - ux * head;
          const by = s.y2 - uy * head;
          const stroke = g
            .append('line')
            .attr('x1', round2(s.x1 + ux * headS))
            .attr('y1', round2(s.y1 + uy * headS))
            .attr('x2', round2(bx))
            .attr('y2', round2(by))
            .attr('stroke', color)
            .attr('stroke-width', ARROW_STROKE)
            .attr('stroke-linecap', 'round');
          dashed(stroke);
          if (headEnd) drawHead({ x: s.x2, y: s.y2 }, ux, uy, head);
          if (headStart) drawHead({ x: s.x1, y: s.y1 }, -ux, -uy, headS);
        } else if (len > 0 || s.cx !== undefined) {
          // A curve: the stroke stops where each head's base meets it, and
          // each head points along the bit of curve it covers.
          const tEnd = headEnd ? curveTrim(s, 1, ARROW_HEAD_LEN) : 1;
          const tStart = headStart ? curveTrim(s, 0, ARROW_HEAD_LEN) : 0;
          const [t0, t1] = tEnd - tStart > 0 ? [tStart, tEnd] : [0, 1];
          const p0 = segmentPoint(s, t0);
          const p1 = segmentPoint(s, t1);
          const w0 = (1 - t0) * (1 - t1);
          const w1 = (1 - t0) * t1 + t0 * (1 - t1);
          const w2 = t0 * t1;
          const qx = w0 * s.x1 + w1 * s.cx! + w2 * s.x2;
          const qy = w0 * s.y1 + w1 * s.cy! + w2 * s.y2;
          const stroke = g
            .append('path')
            .attr(
              'd',
              `M${round2(p0.x)} ${round2(p0.y)}Q${round2(qx)} ${round2(qy)} ${round2(p1.x)} ${round2(p1.y)}`
            )
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', ARROW_STROKE)
            .attr('stroke-linecap', 'round');
          dashed(stroke);
          const along = (tip: WhiteboardPoint, base: WhiteboardPoint): void => {
            const hx = tip.x - base.x;
            const hy = tip.y - base.y;
            const hl = Math.hypot(hx, hy);
            if (hl > 0) drawHead(tip, hx / hl, hy / hl, hl);
          };
          if (headEnd) along({ x: s.x2, y: s.y2 }, p1);
          if (headStart) along({ x: s.x1, y: s.y1 }, p0);
        }
        if (el.label) {
          // The block of lines is centred on the midpoint; the halo stroke
          // knocks the line out behind every one of them.
          const lines = labelLines(el.label);
          const mid = whiteboardSegmentMidpoint(s);
          const mx = round2(mid.x);
          const lh = LABEL_FONT * LABEL_LINE;
          const firstY =
            mid.y + LABEL_FONT * 0.35 - ((lines.length - 1) * lh) / 2;
          const t = g
            .append('text')
            .attr('class', 'whiteboard-label')
            .attr('x', mx)
            .attr('y', round2(firstY))
            .attr('text-anchor', 'middle')
            .attr('font-size', LABEL_FONT)
            .attr('fill', palette.text)
            .attr('stroke', halo)
            .attr('stroke-width', 4)
            .attr('stroke-linejoin', 'round')
            .attr('paint-order', 'stroke');
          if (lines.length === 1) t.text(el.label);
          else appendLines(t, lines, mx, firstY, lh);
        }
        break;
      }
      case 'text': {
        const lines = labelLines(el.text);
        const firstY = el.y + WHITEBOARD_TEXT_FONT * BASELINE;
        const t = g
          .append('text')
          .attr('x', el.x)
          .attr('y', round2(firstY))
          .attr('font-size', WHITEBOARD_TEXT_FONT)
          .attr('fill', colorOf(el.color));
        if (lines.length === 1) t.text(el.text);
        else
          appendLines(
            t,
            lines,
            el.x,
            firstY,
            WHITEBOARD_TEXT_FONT * LABEL_LINE
          );
        break;
      }
      case 'image':
        drawImage(g, el);
        break;
      case 'ink': {
        const d = inkOutlinePath(el.points, el.width);
        if (d) g.append('path').attr('d', d).attr('fill', colorOf(el.color));
        break;
      }
    }
  };

  for (const el of elements) drawElement(el);
}

/** One `<tspan>` per non-empty line, `lh` apart from the first baseline. */
function appendLines(
  t: d3.Selection<SVGTextElement, unknown, null, undefined>,
  lines: readonly string[],
  x: number,
  firstY: number,
  lh: number
): void {
  lines.forEach((ln, i) => {
    if (!ln) return; // an empty line keeps its slot, draws nothing
    t.append('tspan')
      .attr('x', round2(x))
      .attr('y', round2(firstY + i * lh))
      .text(ln);
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
