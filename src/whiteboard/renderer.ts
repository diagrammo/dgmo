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
import { mix, shapeFill, themeBaseBg } from '../palettes/color-utils';
import { drawCylinderCard, drawQueueCard } from '../c4/renderer';
import { renderChartTitle } from '../utils/d3-helpers';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import { TITLE_FONT_SIZE } from '../utils/title-constants';
import type { InkPoint } from './ink-codec';
import type {
  ParsedWhiteboard,
  WhiteboardColor,
  WhiteboardElement,
  WhiteboardImage,
} from './types';

export interface WhiteboardRenderOptions {
  /**
   * Turn an image ref into an `href` (a data URI or a URL). When supplied, its
   * answer is final: `undefined` draws the placeholder box. When omitted,
   * `https://` refs pass through unchanged and anything else is a placeholder.
   */
  readonly resolveImage?: (ref: string) => string | undefined;
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
const LABEL_FONT = 14;
const LABEL_LINE = 1.25;
const LABEL_PAD = 8;
const WHITEBOARD_TEXT_FONT = 16;
const BASELINE = 0.8;
const RECT_RADIUS = 6;
/** Placeholder text for an image no host could resolve. */
export const IMAGE_NOT_UPLOADED = 'image not uploaded';
const PLACEHOLDER_MIN_FONT = 8;

/** A drawable `href`: http(s), blob, or an inline raster/vector image. */
const SAFE_IMAGE_HREF_RE = /^(https?:|blob:|data:image\/)/i;

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

/** Content bounds of every element, in canvas px. */
export function whiteboardBounds(parsed: ParsedWhiteboard): Bounds {
  const b: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const el of parsed.elements) {
    switch (el.kind) {
      case 'shape':
      case 'image':
        grow(b, el.x, el.y, el.x + el.width, el.y + el.height);
        break;
      case 'arrow':
      case 'line': {
        const pad = ARROW_HEAD_HALF + ARROW_STROKE;
        grow(b, el.x1 - pad, el.y1 - pad, el.x2 + pad, el.y2 + pad);
        grow(b, el.x1 + pad, el.y1 + pad, el.x2 - pad, el.y2 - pad);
        if (el.label) {
          const mx = (el.x1 + el.x2) / 2;
          const my = (el.y1 + el.y2) / 2;
          const hw = measureText(el.label, LABEL_FONT) / 2 + 4;
          grow(b, mx - hw, my - LABEL_FONT, mx + hw, my + LABEL_FONT);
        }
        break;
      }
      case 'text':
        grow(
          b,
          el.x,
          el.y,
          el.x + measureText(el.text, WHITEBOARD_TEXT_FONT),
          el.y + WHITEBOARD_TEXT_FONT * LABEL_LINE
        );
        break;
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
  const b = whiteboardBounds(parsed);
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

  const centredLabel = (
    g: GSel,
    label: string,
    cx: number,
    cy: number,
    maxW: number
  ): void => {
    if (!label) return;
    const lines = wrapTextToWidth(label, LABEL_FONT, Math.max(maxW, 20));
    const lh = LABEL_FONT * LABEL_LINE;
    const top = cy - (lines.length * lh) / 2 + lh * BASELINE;
    const t = g
      .append('text')
      .attr('class', 'whiteboard-label')
      .attr('text-anchor', 'middle')
      .attr('font-size', LABEL_FONT)
      .attr('fill', palette.text);
    lines.forEach((ln, i) => {
      t.append('tspan')
        .attr('x', round2(cx))
        .attr('y', round2(top + i * lh))
        .text(ln);
    });
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
        const fill = fillOf(el.color);
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
        // An ellipse's usable width is narrower than its box.
        const inset = el.shape === 'ellipse' ? el.width * 0.15 : 0;
        centredLabel(g, el.label, cx, cy, el.width - 2 * (LABEL_PAD + inset));
        break;
      }
      case 'arrow':
      case 'line': {
        const color = colorOf(el.color);
        const dx = el.x2 - el.x1;
        const dy = el.y2 - el.y1;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const ux = dx / len;
          const uy = dy / len;
          const head = el.kind === 'arrow' ? Math.min(ARROW_HEAD_LEN, len) : 0;
          const bx = el.x2 - ux * head;
          const by = el.y2 - uy * head;
          const stroke = g
            .append('line')
            .attr('x1', el.x1)
            .attr('y1', el.y1)
            .attr('x2', round2(bx))
            .attr('y2', round2(by))
            .attr('stroke', color)
            .attr('stroke-width', ARROW_STROKE)
            .attr('stroke-linecap', 'round');
          if (el.style === 'dashed') {
            stroke.attr(
              'stroke-dasharray',
              `${DASH_ON * ARROW_STROKE} ${DASH_OFF * ARROW_STROKE}`
            );
          }
          if (el.kind === 'arrow') {
            const px = -uy * ARROW_HEAD_HALF;
            const py = ux * ARROW_HEAD_HALF;
            g.append('polygon')
              .attr(
                'points',
                `${el.x2},${el.y2} ${round2(bx + px)},${round2(by + py)} ${round2(bx - px)},${round2(by - py)}`
              )
              .attr('fill', color);
          }
        }
        if (el.label) {
          g.append('text')
            .attr('class', 'whiteboard-label')
            .attr('x', round2((el.x1 + el.x2) / 2))
            .attr('y', round2((el.y1 + el.y2) / 2 + LABEL_FONT * 0.35))
            .attr('text-anchor', 'middle')
            .attr('font-size', LABEL_FONT)
            .attr('fill', palette.text)
            .attr('stroke', halo)
            .attr('stroke-width', 4)
            .attr('stroke-linejoin', 'round')
            .attr('paint-order', 'stroke')
            .text(el.label);
        }
        break;
      }
      case 'text':
        g.append('text')
          .attr('x', el.x)
          .attr('y', round2(el.y + WHITEBOARD_TEXT_FONT * BASELINE))
          .attr('font-size', WHITEBOARD_TEXT_FONT)
          .attr('fill', colorOf(el.color))
          .text(el.text);
        break;
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

  for (const el of parsed.elements) drawElement(el);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
