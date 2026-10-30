// ============================================================
// Export content fit — the exported frame is the diagram, not the sheet
// ============================================================
// Most renderers draw onto the fixed EXPORT_WIDTH x EXPORT_HEIGHT sheet and
// centre their drawing in it, so a narrow diagram exported as a PNG carried a
// band of background on each side (diagrammo/diagrammo#1638). This pass
// measures what was drawn and shrinks the root viewBox to it plus
// EXPORT_FIT_PAD, then repaints the opaque background rect at the new bounds
// so a PNG stays a solid rectangle.
//
// THE TRUST RULE. The measurer is a string walker, so it may only shrink the
// frame when it can prove it saw every drawn element:
//   - it composes every `transform` (translate / scale / rotate / matrix /
//     skew) down the element tree, so `transform`-positioned groups and words
//     are measured where they are drawn — the word-cloud blind spot of the
//     embed tightener (svg-embed.ts, computeBBox) does not exist here;
//   - it parses path data as commands (relative and absolute), takes curve
//     control points and the full circle of every arc, so it can only
//     over-measure a path — the arc over-shoot that guard exists for is
//     harmless here, never a clip;
//   - text is measured with Inter's advance widths (measureText) times
//     TEXT_WIDTH_SAFETY, honouring text-anchor, dominant-baseline, tspans,
//     dx/dy and textPath (the referenced path is measured, even inside defs).
// Anything it cannot place — a `<use>`, a CSS `transform` in a style
// attribute, a transform or path it cannot parse — marks the measurement
// incomplete, and an incomplete measurement leaves the SVG byte-for-byte as
// rendered. The box is also clamped to the renderer's canvas, so the result
// can never show less than today's output did. Because the measurement is
// complete, the embed's >= 0.5 coverage guard is not needed: a small drawing
// on a big sheet is exactly the case this exists to trim.
//
// Two more rules keep content-sized charts as they were:
//   - an axis is only trimmed when it sheds at least EXPORT_FIT_MIN_TRIM px,
//     so a chart that already sizes itself from content comes out unchanged;
//   - the width never drops below MIN_CANVAS_WIDTH (or the canvas, if
//     narrower), the floor content-sized charts already observe.

import { MIN_CANVAS_WIDTH } from './fit-canvas';
import { readViewBox } from './svg-embed';
import { measureText } from './text-measure';

/** Air left around the measured content, in px — a little more than the embed's 16. */
export const EXPORT_FIT_PAD = 24;

/** An axis is only trimmed when that frees at least this many px. */
export const EXPORT_FIT_MIN_TRIM = EXPORT_FIT_PAD * 2;

/** Inter's advance widths are an estimate of the font that draws; err wide. */
const TEXT_WIDTH_SAFETY = 1.15;

/** Room for an arrowhead or other marker drawn past a line's end. */
const MARKER_ALLOWANCE = 12;

/** SVG's initial font-size, used when nothing sets one. */
const DEFAULT_FONT_SIZE = 16;

/** Elements whose children never draw where they are written. */
const NON_RENDERING = new Set([
  'defs',
  'clippath',
  'mask',
  'marker',
  'pattern',
  'symbol',
  'lineargradient',
  'radialgradient',
  'filter',
  'style',
  'title',
  'desc',
  'metadata',
  'script',
]);

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Frame {
  tag: string;
  m: Matrix;
  fontSize: number;
  anchor: string;
  baseline: string;
  bold: boolean;
  mono: boolean;
  strokeW: number;
  /** The inherited `stroke` paint — null when nothing has set one. */
  stroke: string | null;
  skip: boolean;
}

interface TextPiece {
  x0: number;
  x1: number;
  y: number;
  fontSize: number;
  baseline: string;
}

interface TextState {
  m: Matrix;
  curX: number;
  curY: number;
  chunkX: number;
  chunkAnchor: string;
  pieces: TextPiece[];
}

export interface ContentMeasurement {
  /** Union of everything drawn, in root user space; null when nothing was. */
  box: Box | null;
  /** False when some drawn element could not be placed — do not trim. */
  complete: boolean;
}

function multiply(p: Matrix, q: Matrix): Matrix {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function nums(s: string): number[] {
  return (s.match(NUM_RE) ?? []).map(Number);
}

/** Parse an SVG `transform` list; null when any part is not understood. */
function parseTransform(value: string): Matrix | null {
  let m: Matrix = IDENTITY;
  const re =
    /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/gy;
  let consumed = 0;
  for (const t of value.matchAll(re)) {
    consumed = (t.index ?? 0) + t[0].length;
    const a = nums(t[2]!);
    let local: Matrix;
    switch (t[1]) {
      case 'matrix':
        if (a.length !== 6) return null;
        local = a as Matrix;
        break;
      case 'translate':
        if (a.length < 1 || a.length > 2) return null;
        local = [1, 0, 0, 1, a[0]!, a[1] ?? 0];
        break;
      case 'scale':
        if (a.length < 1 || a.length > 2) return null;
        local = [a[0]!, 0, 0, a[1] ?? a[0]!, 0, 0];
        break;
      case 'rotate': {
        if (a.length !== 1 && a.length !== 3) return null;
        const r = (a[0]! * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        const rot: Matrix = [c, s, -s, c, 0, 0];
        if (a.length === 3) {
          const [, cx, cy] = a as [number, number, number];
          local = multiply(multiply([1, 0, 0, 1, cx, cy], rot), [
            1,
            0,
            0,
            1,
            -cx,
            -cy,
          ]);
        } else local = rot;
        break;
      }
      case 'skewX':
        if (a.length !== 1) return null;
        local = [1, 0, Math.tan((a[0]! * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        if (a.length !== 1) return null;
        local = [1, Math.tan((a[0]! * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = multiply(m, local);
  }
  return value.slice(consumed).trim() === '' ? m : null;
}

/**
 * Path data → its local bounding box, or null when it cannot be parsed.
 * Curves contribute their control points and arcs their whole circle, so the
 * box can only be too big, never too small.
 */
function pathBox(d: string): Box | null {
  let i = 0;
  const n = d.length;
  const box: Box = {
    x0: Infinity,
    y0: Infinity,
    x1: -Infinity,
    y1: -Infinity,
  };
  const add = (x: number, y: number) => {
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
  };
  const skipSep = () => {
    while (i < n && /[\s,]/.test(d[i]!)) i++;
  };
  const numAt = (): number | null => {
    skipSep();
    const m = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
    m.lastIndex = i;
    const r = m.exec(d);
    if (!r) return null;
    i += r[0].length;
    return Number(r[0]);
  };
  const flagAt = (): number | null => {
    skipSep();
    const c = d[i];
    if (c !== '0' && c !== '1') return null;
    i++;
    return c === '1' ? 1 : 0;
  };
  const moreNumbers = () => {
    skipSep();
    return i < n && /[-+.\d]/.test(d[i]!);
  };
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  while (true) {
    skipSep();
    if (i >= n) break;
    const c = d[i]!;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      cmd = c;
      i++;
    } else if (!cmd || cmd === 'Z' || cmd === 'z' || !/[-+.\d]/.test(c)) {
      return null;
    }
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    if (up === 'Z') {
      cx = sx;
      cy = sy;
      continue;
    }
    const arity: Record<string, number> = {
      M: 2,
      L: 2,
      T: 2,
      H: 1,
      V: 1,
      C: 6,
      S: 4,
      Q: 4,
      A: 7,
    };
    do {
      const k = arity[up]!;
      const a: number[] = [];
      for (let j = 0; j < k; j++) {
        const v = up === 'A' && (j === 3 || j === 4) ? flagAt() : numAt();
        if (v === null) return null;
        a.push(v);
      }
      const ox = rel ? cx : 0;
      const oy = rel ? cy : 0;
      if (up === 'H') {
        cx = a[0]! + ox;
      } else if (up === 'V') {
        cy = a[0]! + oy;
      } else if (up === 'A') {
        const x2 = a[5]! + ox;
        const y2 = a[6]! + oy;
        arcExtent(cx, cy, a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, x2, y2, add);
        cx = x2;
        cy = y2;
      } else {
        for (let j = 0; j + 1 < k; j += 2) add(a[j]! + ox, a[j + 1]! + oy);
        cx = a[k - 2]! + ox;
        cy = a[k - 1]! + oy;
      }
      add(cx, cy);
      if (up === 'M') {
        sx = cx;
        sy = cy;
      }
    } while (moreNumbers());
    // Implicit commands after a moveto are line-to commands.
    if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
  }
  return box.x0 <= box.x1 ? box : null;
}

/** Add the full circle an SVG arc segment lies on (SVG 1.1 F.6.5). */
function arcExtent(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotDeg: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number,
  add: (x: number, y: number) => void
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return;
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const factor =
    (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den || 0));
  const cxp = (factor * rx * yp) / ry;
  const cyp = (-factor * ry * xp) / rx;
  const ccx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const ccy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const r = Math.max(rx, ry);
  add(ccx - r, ccy - r);
  add(ccx + r, ccy + r);
}

function attrOf(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(
    attrs
  );
  return m ? (m[2] ?? m[3] ?? '') : null;
}

function styleOf(attrs: string, prop: string): string | null {
  const style = attrOf(attrs, 'style');
  if (!style) return null;
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return m ? m[1]!.trim() : null;
}

/** A presentation property: inline style beats the attribute. */
function prop(attrs: string, name: string): string | null {
  return styleOf(attrs, name) ?? attrOf(attrs, name);
}

function lengthOf(
  v: string | null,
  basis: number,
  fontSize: number
): number | null {
  if (v === null) return null;
  const m =
    /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(px|em|%|pt)?/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'em':
      return n * fontSize;
    case '%':
      return (n / 100) * basis;
    case 'pt':
      return (n * 4) / 3;
    default:
      return n;
  }
}

function firstLength(
  v: string | null,
  basis: number,
  fontSize: number
): number | null {
  if (v === null) return null;
  return lengthOf(v.trim().split(/[\s,]+/)[0] ?? '', basis, fontSize);
}

/** Vertical extent of a line of text around its baseline y, in em. */
function verticalEm(baseline: string): [number, number] {
  switch (baseline) {
    case 'middle':
    case 'central':
    case 'mathematical':
      return [0.65, 0.65];
    case 'hanging':
    case 'text-before-edge':
    case 'before-edge':
      return [0.1, 1.25];
    case 'text-after-edge':
    case 'after-edge':
    case 'ideographic':
      return [1.3, 0.1];
    case 'auto':
    case 'alphabetic':
    case 'baseline':
    case '':
      return [1.0, 0.3];
    default:
      return [1.3, 1.25];
  }
}

const SHAPES = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'path',
]);

const NO_PAINT = /^(?:none|transparent)$/i;

function zero(v: string | null): boolean {
  return v !== null && Number(v) === 0;
}

/**
 * True when a shape declares, on itself, that it paints nothing: fully
 * transparent, or no visible fill (a line never has one) and no visible
 * stroke. Only the element's own fill counts; an inherited stroke counts.
 */
function paintsNothing(attrs: string, frame: Frame): boolean {
  if (zero(prop(attrs, 'opacity'))) return true;
  const fill = prop(attrs, 'fill');
  const noFill =
    frame.tag === 'line' ||
    (fill !== null && NO_PAINT.test(fill.trim())) ||
    zero(prop(attrs, 'fill-opacity'));
  const noStroke =
    frame.stroke === null ||
    NO_PAINT.test(frame.stroke.trim()) ||
    zero(prop(attrs, 'stroke-opacity')) ||
    frame.strokeW === 0;
  return noFill && noStroke;
}

/**
 * Does any `<style>` rule set a paint or opacity outside a hover state? Hover
 * rules (inside `@media (hover:hover)` or on a `:hover` selector) never apply
 * to an export, so they are ignored; anything else — keyframes included —
 * counts.
 */
function cssCanSetPaint(svg: string): boolean {
  for (const m of svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    let css = m[1]!;
    for (;;) {
      const at = css.search(/@media\s*\(\s*hover\s*:\s*hover\s*\)\s*\{/);
      if (at < 0) break;
      let i = css.indexOf('{', at) + 1;
      for (let depth = 1; i < css.length && depth > 0; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
      }
      css = css.slice(0, at) + css.slice(i);
    }
    for (const r of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      if (r[1]!.includes(':hover')) continue;
      if (
        /(?:^|[;\s])(?:fill|stroke|opacity|fill-opacity|stroke-opacity)\s*:/.test(
          r[2]!
        )
      )
        return true;
    }
  }
  return false;
}

function decodeText(raw: string): string {
  return raw
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, 'M')
    .replace(/\s+/g, ' ');
}

/**
 * Measure what an SVG draws, in root user space, composing every transform.
 * `complete` is false when something drawn could not be placed.
 */
export function measureSvgContent(svg: string): ContentMeasurement {
  const canvas = readViewBox(svg);
  const cw = canvas?.width ?? 0;
  const ch = canvas?.height ?? 0;
  const out: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let complete = true;

  const addBox = (m: Matrix, b: Box, inflate: number) => {
    const xs = [b.x0 - inflate, b.x1 + inflate];
    const ys = [b.y0 - inflate, b.y1 + inflate];
    for (const x of xs)
      for (const y of ys) {
        const tx = m[0] * x + m[2] * y + m[4];
        const ty = m[1] * x + m[3] * y + m[5];
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
          complete = false;
          continue;
        }
        if (tx < out.x0) out.x0 = tx;
        if (tx > out.x1) out.x1 = tx;
        if (ty < out.y0) out.y0 = ty;
        if (ty > out.y1) out.y1 = ty;
      }
  };

  // Paths a <textPath> may reference, wherever they are defined.
  const pathsById = new Map<string, string>();
  for (const m of svg.matchAll(/<path\b([^>]*)>/g)) {
    const id = attrOf(m[1]!, 'id');
    const d = attrOf(m[1]!, 'd');
    if (id && d) pathsById.set(id, d);
  }

  // A stylesheet could repaint a shape its attributes say is invisible, so
  // the invisible-shape skip is only trusted when none can.
  const trustNoPaint = !cssCanSetPaint(svg);

  const stack: Frame[] = [];
  let text: TextState | null = null;

  const flushChunk = () => {
    if (!text || text.pieces.length === 0) return;
    const right = Math.max(...text.pieces.map((p) => p.x1));
    const w = right - text.chunkX;
    const shift =
      text.chunkAnchor === 'middle'
        ? -w / 2
        : text.chunkAnchor === 'end'
          ? -w
          : 0;
    for (const p of text.pieces) {
      const [up, down] = verticalEm(p.baseline);
      addBox(
        text.m,
        {
          x0: p.x0 + shift,
          x1: p.x1 + shift,
          y0: p.y - up * p.fontSize,
          y1: p.y + down * p.fontSize,
        },
        0
      );
    }
    text.pieces = [];
  };

  const tagRe =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;

  for (const t of svg.matchAll(tagRe)) {
    const [, close, rawName, attrs = '', selfClose, chars] = t;
    const parent = stack[stack.length - 1];

    if (chars !== undefined) {
      if (!text || !parent || parent.skip) continue;
      const s = decodeText(chars);
      if (s.trim() === '') continue;
      const fs = parent.fontSize;
      let w = measureText(s, fs, { bold: parent.bold }) * TEXT_WIDTH_SAFETY;
      if (parent.mono) w = Math.max(w, s.length * fs * 0.62);
      text.pieces.push({
        x0: text.curX,
        x1: text.curX + w,
        y: text.curY,
        fontSize: fs,
        baseline: parent.baseline,
      });
      text.curX += w;
      continue;
    }
    if (rawName === undefined) continue; // comment, CDATA, declaration

    const name = rawName.toLowerCase();
    if (close) {
      // Pop to the matching open tag.
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k]!.tag === name) {
          stack.length = k;
          break;
        }
      }
      if (name === 'text' && text) {
        flushChunk();
        text = null;
      }
      continue;
    }

    // ---- open tag ----
    const isRoot = stack.length === 0;
    const base: Frame = parent ?? {
      tag: '',
      m: IDENTITY,
      fontSize: DEFAULT_FONT_SIZE,
      anchor: 'start',
      baseline: '',
      bold: false,
      mono: false,
      strokeW: 1,
      stroke: null,
      skip: false,
    };
    const skip = base.skip || NON_RENDERING.has(name);
    let m = base.m;
    if (!skip) {
      if (/(?:^|[;\s"])transform\s*:/i.test(attrOf(attrs, 'style') ?? '')) {
        complete = false;
      }
      const tr = attrOf(attrs, 'transform');
      if (tr !== null && !isRoot) {
        const local = parseTransform(tr);
        if (local === null) complete = false;
        else m = multiply(m, local);
      }
    }
    const fsRaw = prop(attrs, 'font-size');
    let fontSize = base.fontSize;
    if (fsRaw !== null) {
      const v = lengthOf(fsRaw, base.fontSize, base.fontSize);
      fontSize = v !== null && v > 0 ? v : base.fontSize * 2;
    }
    const weight = prop(attrs, 'font-weight');
    const family = prop(attrs, 'font-family');
    const sw = lengthOf(prop(attrs, 'stroke-width'), 1, fontSize);
    const frame: Frame = {
      tag: name,
      m,
      fontSize,
      anchor: prop(attrs, 'text-anchor') ?? base.anchor,
      baseline:
        prop(attrs, 'dominant-baseline') ??
        prop(attrs, 'alignment-baseline') ??
        base.baseline,
      bold: weight !== null ? /bold|bolder|[6-9]00/.test(weight) : base.bold,
      mono: family !== null ? /mono|courier/i.test(family) : base.mono,
      strokeW: sw !== null && sw >= 0 ? sw : base.strokeW,
      stroke: prop(attrs, 'stroke') ?? base.stroke,
      skip,
    };

    if (
      trustNoPaint &&
      !skip &&
      !isRoot &&
      SHAPES.has(name) &&
      paintsNothing(attrs, frame)
    ) {
      // A hit area or a clipped overlay with no paint (venn's region
      // overlays, legend hit rects) draws nothing, so it bounds nothing.
    } else if (!skip && !isRoot) {
      const num = (k: string, basis: number) =>
        lengthOf(attrOf(attrs, k), basis, fontSize);
      const inflate =
        frame.strokeW / 2 +
        (/marker-(?:start|mid|end)/.test(attrs) ? MARKER_ALLOWANCE : 0);
      switch (name) {
        case 'rect':
        case 'image':
        case 'foreignobject':
        case 'svg': {
          const cls = attrOf(attrs, 'class') ?? '';
          if (name === 'rect' && /\bdgmo-canvas-bg\b/.test(cls)) break;
          const x = num('x', cw) ?? 0;
          const y = num('y', ch) ?? 0;
          const w = num('width', cw);
          const h = num('height', ch);
          if (w === null || h === null) {
            if (name !== 'rect') complete = false;
            break;
          }
          addBox(m, { x0: x, y0: y, x1: x + w, y1: y + h }, inflate);
          // A nested viewport's children are drawn inside it.
          if (name === 'svg') frame.skip = true;
          break;
        }
        case 'circle':
        case 'ellipse': {
          const cx = num('cx', cw) ?? 0;
          const cy = num('cy', ch) ?? 0;
          const rx = name === 'circle' ? num('r', cw) : num('rx', cw);
          const ry = name === 'circle' ? rx : num('ry', ch);
          if (rx === null || ry === null) break;
          addBox(
            m,
            { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry },
            inflate
          );
          break;
        }
        case 'line': {
          const x1 = num('x1', cw) ?? 0;
          const y1 = num('y1', ch) ?? 0;
          const x2 = num('x2', cw) ?? 0;
          const y2 = num('y2', ch) ?? 0;
          addBox(
            m,
            {
              x0: Math.min(x1, x2),
              y0: Math.min(y1, y2),
              x1: Math.max(x1, x2),
              y1: Math.max(y1, y2),
            },
            inflate
          );
          break;
        }
        case 'polygon':
        case 'polyline': {
          const p = nums(attrOf(attrs, 'points') ?? '');
          if (p.length < 2) break;
          const b: Box = {
            x0: Infinity,
            y0: Infinity,
            x1: -Infinity,
            y1: -Infinity,
          };
          for (let k = 0; k + 1 < p.length; k += 2) {
            b.x0 = Math.min(b.x0, p[k]!);
            b.x1 = Math.max(b.x1, p[k]!);
            b.y0 = Math.min(b.y0, p[k + 1]!);
            b.y1 = Math.max(b.y1, p[k + 1]!);
          }
          addBox(m, b, inflate);
          break;
        }
        case 'path': {
          const d = attrOf(attrs, 'd');
          if (!d || d.trim() === '' || d.trim().toLowerCase() === 'none') break;
          const b = pathBox(d);
          if (b === null) complete = false;
          else addBox(m, b, inflate);
          break;
        }
        case 'use':
          complete = false;
          break;
        case 'text': {
          flushChunk();
          const x = firstLength(attrOf(attrs, 'x'), cw, fontSize) ?? 0;
          const y = firstLength(attrOf(attrs, 'y'), ch, fontSize) ?? 0;
          const dx = firstLength(attrOf(attrs, 'dx'), cw, fontSize) ?? 0;
          const dy = firstLength(attrOf(attrs, 'dy'), ch, fontSize) ?? 0;
          text = {
            m,
            curX: x + dx,
            curY: y + dy,
            chunkX: x + dx,
            chunkAnchor: frame.anchor,
            pieces: [],
          };
          break;
        }
        case 'tspan': {
          if (!text) break;
          const x = firstLength(attrOf(attrs, 'x'), cw, fontSize);
          const y = firstLength(attrOf(attrs, 'y'), ch, fontSize);
          const dx = firstLength(attrOf(attrs, 'dx'), cw, fontSize) ?? 0;
          const dy = firstLength(attrOf(attrs, 'dy'), ch, fontSize) ?? 0;
          if (x !== null || y !== null) {
            // An absolute position starts a new text chunk.
            flushChunk();
            if (x !== null) text.curX = x;
            if (y !== null) text.curY = y;
            text.curX += dx;
            text.curY += dy;
            text.chunkX = text.curX;
            text.chunkAnchor = frame.anchor;
          } else {
            text.curX += dx;
            text.curY += dy;
          }
          break;
        }
        case 'textpath': {
          if (!text) break;
          // The glyphs ride the referenced path: measure that path, grown by
          // a line of text, and keep the words out of the x/y bookkeeping.
          const href = (
            attrOf(attrs, 'href') ??
            attrOf(attrs, 'xlink:href') ??
            ''
          ).replace(/^#/, '');
          const d = pathsById.get(href);
          const b = d ? pathBox(d) : null;
          if (b === null) complete = false;
          else addBox(text.m, b, fontSize * 1.3);
          frame.skip = true;
          break;
        }
        default:
          break;
      }
    }

    if (!selfClose) stack.push(frame);
    else if (name === 'text') {
      flushChunk();
      text = null;
    }
  }

  const box = out.x0 <= out.x1 && out.y0 <= out.y1 ? out : null;
  return { box, complete };
}

export interface FitSvgToContentOptions {
  /** The width the caller asked the renderer for, if any. */
  width?: number;
  /** The height the caller asked the renderer for, if any. */
  height?: number;
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function setRootAttr(root: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name}=)"[^"]*"`);
  return re.test(root)
    ? root.replace(re, `$1"${value}"`)
    : root.replace(/^<svg\b/, `<svg ${name}="${value}"`);
}

/**
 * Shrink an exported SVG's frame to what it draws plus EXPORT_FIT_PAD, under
 * the trust rule at the top of this file. Returns the input unchanged when
 * the measurement is incomplete or the trim would be too small to matter.
 *
 * A caller that asked for a size gets it: when the renderer drew onto the
 * requested canvas, the fitted frame is scaled back up to that width (and/or
 * height, whichever binds first) — fit first, then the requested scale.
 */
export function fitSvgToContent(
  svg: string,
  opts: FitSvgToContentOptions = {}
): string {
  const rootMatch = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(svg);
  if (!rootMatch) return svg;
  const root = rootMatch[0];
  // A camera-framed export (sketch) declares its own extent; leave it alone.
  if (/\sdata-export-(?:width|height)=/.test(root)) return svg;
  const canvas = readViewBox(svg);
  if (!canvas) return svg;

  const { box, complete } = measureSvgContent(svg);
  if (!complete || !box) return svg;

  // Box plus pad, snapped outward to whole px, never past the canvas.
  const cx0 = canvas.x;
  const cy0 = canvas.y;
  const cx1 = canvas.x + canvas.width;
  const cy1 = canvas.y + canvas.height;
  let x0 = Math.max(cx0, Math.floor(box.x0 - EXPORT_FIT_PAD));
  let x1 = Math.min(cx1, Math.ceil(box.x1 + EXPORT_FIT_PAD));
  let y0 = Math.max(cy0, Math.floor(box.y0 - EXPORT_FIT_PAD));
  let y1 = Math.min(cy1, Math.ceil(box.y1 + EXPORT_FIT_PAD));
  if (x1 <= x0 || y1 <= y0) return svg;

  const minW = Math.min(canvas.width, MIN_CANVAS_WIDTH);
  if (x1 - x0 < minW) {
    const grow = minW - (x1 - x0);
    x0 = Math.max(cx0, x0 - Math.floor(grow / 2));
    x1 = x0 + minW;
    if (x1 > cx1) {
      x1 = cx1;
      x0 = cx1 - minW;
    }
  }
  const trimX = canvas.width - (x1 - x0) >= EXPORT_FIT_MIN_TRIM;
  const trimY = canvas.height - (y1 - y0) >= EXPORT_FIT_MIN_TRIM;
  if (!trimX && !trimY) return svg;
  if (!trimX) {
    x0 = cx0;
    x1 = cx1;
  }
  if (!trimY) {
    y0 = cy0;
    y1 = cy1;
  }
  const w = x1 - x0;
  const h = y1 - y0;

  // Root size follows the frame, at the renderer's own px-per-unit ratio.
  const rootW = Number(attrOf(root.slice(4), 'width'));
  const rootH = Number(attrOf(root.slice(4), 'height'));
  const sx = rootW > 0 ? rootW / canvas.width : 1;
  const sy = rootH > 0 ? rootH / canvas.height : 1;
  let outW = w * sx;
  let outH = h * sy;
  const scales: number[] = [];
  if (opts.width && opts.width > 0 && Math.abs(rootW - opts.width) <= 1)
    scales.push(opts.width / w);
  if (opts.height && opts.height > 0 && Math.abs(rootH - opts.height) <= 1)
    scales.push(opts.height / h);
  if (scales.length > 0) {
    const s = Math.min(...scales);
    outW = w * s;
    outH = h * s;
  }

  let newRoot = setRootAttr(root, 'viewBox', `${x0} ${y0} ${w} ${h}`);
  if (rootW > 0) newRoot = setRootAttr(newRoot, 'width', fmt(outW));
  if (rootH > 0) newRoot = setRootAttr(newRoot, 'height', fmt(outH));
  // The pad-to-panel height marker is in the old frame; the fit replaced it.
  if (trimY) newRoot = newRoot.replace(/\sdata-content-height="[^"]*"/, '');

  const body = svg
    .slice(rootMatch.index + root.length)
    .replace(/<rect\b[^>]*\bclass="[^"]*\bdgmo-canvas-bg\b[^"]*"[^>]*>/g, (r) =>
      r
        .replace(/(\sx=)"[^"]*"/, `$1"${x0}"`)
        .replace(/(\sy=)"[^"]*"/, `$1"${y0}"`)
        .replace(/(\swidth=)"[^"]*"/, `$1"${w}"`)
        .replace(/(\sheight=)"[^"]*"/, `$1"${h}"`)
    );
  return svg.slice(0, rootMatch.index) + newRoot + body;
}
