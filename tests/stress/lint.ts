// Geometry lints for a rendered SVG — the stress corpus's automatic eye (#1417).
//
// Reads the SVG the way a viewer sees it: every visible <text> becomes a box
// in root coordinates (ancestor transforms applied, Inter advance widths from
// src/utils/text-measure.ts), then the boxes are checked against the canvas
// and against each other. It finds what geometry can prove — text leaving the
// canvas, text drawn over text, text too small to read. Taste (a squeezed
// timeline, a lopsided layout) is the vision pass's job, not this file's.
//
// Deliberately conservative: a lint that cries wolf gets its fixture marked
// `known` and stops being read. Every threshold is a named constant below.
import { JSDOM } from 'jsdom';
import { measureText } from '../../src/utils/text-measure';

/** Text may poke past the canvas edge by this much (px) before it counts. */
export const OUTSIDE_TOLERANCE = 2;
/** Overlap must cover this share of the smaller box's area… */
export const OVERLAP_AREA_SHARE = 0.15;
/** …and this share of the smaller box's height (rules out stacked lines that touch). */
export const OVERLAP_HEIGHT_SHARE = 0.3;
/** Rendered font size (px, after scaling) below which text is unreadable. */
export const MIN_FONT_PX = 7;

export type LintRule = 'text-outside' | 'text-overlap' | 'text-tiny' | 'blank';

export interface LintFinding {
  rule: LintRule;
  /** One line a person can act on, naming the text involved. */
  detail: string;
}

type M = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: M = [1, 0, 0, 1, 0, 0];

function mul(p: M, q: M): M {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

export function parseTransform(attr: string | null): M {
  if (!attr) return IDENTITY;
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const [, fn, raw] of attr.matchAll(re)) {
    const a = raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let t: M = IDENTITY;
    if (fn === 'matrix' && a.length === 6) t = a as M;
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const rot: M = [cos, sin, -sin, cos, 0, 0];
      const cx = a[1] ?? 0;
      const cy = a[2] ?? 0;
      t = mul(mul([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX')
      t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY')
      t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

const HIDDEN_CONTAINERS = new Set([
  'defs',
  'clippath',
  'mask',
  'marker',
  'pattern',
  'symbol',
  'title',
  'desc',
  'foreignobject',
  'style',
  'script',
]);

function styleProp(el: Element, prop: string): string | null {
  const style = el.getAttribute('style');
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(style);
    if (m) return m[1].trim();
  }
  return el.getAttribute(prop);
}

/** Inherited presentation property, nearest ancestor first. */
function inherited(el: Element, prop: string): string | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const v = styleProp(n, prop);
    if (v !== null && v !== 'inherit') return v;
  }
  return null;
}

/**
 * Elements a static <style> rule hides — hover-only reveals such as PERT's
 * verbose percentile labels. A selector carrying a pseudo-class (`:hover`) is
 * the reveal, not the resting state, so it is skipped.
 */
function styleHidden(doc: Document): Set<Element> {
  const hidden = new Set<Element>();
  const css = Array.from(doc.getElementsByTagName('style'))
    .map((s) => s.textContent ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (
      !/(?:^|;)\s*(?:opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|display\s*:\s*none|visibility\s*:\s*hidden)/.test(
        body
      )
    )
      continue;
    for (const sel of selectors.split(',').map((x) => x.trim())) {
      if (!sel || sel.includes(':') || sel.startsWith('@')) continue;
      try {
        for (const el of Array.from(doc.querySelectorAll(sel))) hidden.add(el);
      } catch {
        // A selector jsdom cannot parse hides nothing we can prove.
      }
    }
  }
  return hidden;
}

let HIDDEN_BY_STYLE: Set<Element> = new Set();

/** Not drawn at all, or drawn somewhere the reader never sees it. */
function invisible(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (HIDDEN_CONTAINERS.has(n.tagName.toLowerCase())) return true;
    if (HIDDEN_BY_STYLE.has(n)) return true;
    if (styleProp(n, 'display') === 'none') return true;
    if (styleProp(n, 'visibility') === 'hidden') return true;
    // resvg ignores `opacity` on a <tspan> and draws it anyway, so only a
    // container's opacity hides text (diagrammo/diagrammo#1536).
    if (n.tagName.toLowerCase() === 'tspan') continue;
    const op = styleProp(n, 'opacity');
    if (op !== null && parseFloat(op) === 0) return true;
  }
  const fo = styleProp(el, 'fill-opacity');
  return fo !== null && parseFloat(fo) === 0;
}

/** Inside a clip — truncation was deliberate, so its edges are not ours to judge. */
function clipped(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement)
    if (n.hasAttribute('clip-path') || styleProp(n, 'clip-path')) return true;
  return false;
}

function ctm(el: Element): M {
  const chain: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
  let m = IDENTITY;
  for (const n of chain.reverse()) {
    m = mul(m, parseTransform(n.getAttribute('transform')));
    const tag = n.tagName.toLowerCase();
    // A nested <svg> (not the root) offsets its children by its x/y.
    if (tag === 'svg' && n.parentElement) {
      const x = parseFloat(n.getAttribute('x') ?? '0') || 0;
      const y = parseFloat(n.getAttribute('y') ?? '0') || 0;
      m = mul(m, [1, 0, 0, 1, x, y]);
    }
  }
  return m;
}

function px(v: string | null, fontSize: number, fallback: number): number {
  if (v === null || v === '') return fallback;
  const first = v.trim().split(/[\s,]+/)[0];
  if (first.endsWith('em')) return parseFloat(first) * fontSize;
  const n = parseFloat(first);
  return Number.isFinite(n) ? n : fallback;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
  rotated: boolean;
}

function fontSizeOf(el: Element): number {
  const v = inherited(el, 'font-size');
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 16;
}

function isBold(el: Element): boolean {
  const w = inherited(el, 'font-weight');
  return (
    w === 'bold' || w === 'bolder' || (w !== null && parseInt(w, 10) >= 600)
  );
}

/** Vertical extent of a line whose baseline attribute sits at y. */
function lineSpan(el: Element, y: number, fs: number): [number, number] {
  const db =
    inherited(el, 'dominant-baseline') ?? inherited(el, 'alignment-baseline');
  if (db === 'middle' || db === 'central') return [y - fs * 0.5, y + fs * 0.5];
  if (db === 'hanging' || db === 'text-before-edge') return [y, y + fs];
  if (db === 'text-after-edge' || db === 'ideographic') return [y - fs, y];
  return [y - fs * 0.78, y + fs * 0.22]; // alphabetic: Inter's ascent/descent
}

/**
 * One box per drawn line of a <text>. A <tspan> carrying x, y or dy starts a
 * new line (the renderers' multi-line idiom); one carrying none continues the
 * current line (inline styling).
 */
function textBoxes(text: Element): Box[] {
  const fs = fontSizeOf(text);
  const m = ctm(text);
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const rotated = Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6;

  interface Line {
    x: number;
    y: number;
    anchorEl: Element;
    parts: { s: string; el: Element }[];
  }
  let x = px(text.getAttribute('x'), fs, 0);
  let y =
    px(text.getAttribute('y'), fs, 0) + px(text.getAttribute('dy'), fs, 0);
  const lines: Line[] = [{ x, y, anchorEl: text, parts: [] }];
  for (const node of Array.from(text.childNodes)) {
    if (node.nodeType === 3) {
      lines[lines.length - 1].parts.push({
        s: node.textContent ?? '',
        el: text,
      });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const t = node as Element;
    if (t.tagName.toLowerCase() !== 'tspan' || invisible(t)) continue;
    const tfs = fontSizeOf(t);
    const hasX = t.hasAttribute('x');
    const hasY = t.hasAttribute('y');
    const hasDy = t.hasAttribute('dy');
    if (hasX || hasY || hasDy) {
      if (hasX) x = px(t.getAttribute('x'), tfs, x);
      if (hasY) y = px(t.getAttribute('y'), tfs, y);
      if (hasDy) y += px(t.getAttribute('dy'), tfs, 0);
      lines.push({ x, y, anchorEl: t, parts: [] });
    }
    lines[lines.length - 1].parts.push({ s: t.textContent ?? '', el: t });
  }

  const boxes: Box[] = [];
  for (const line of lines) {
    const s = line.parts.map((p) => p.s).join('');
    if (!s.trim()) continue;
    let w = 0;
    let lineFs = 0;
    for (const p of line.parts) {
      const pfs = fontSizeOf(p.el);
      lineFs = Math.max(lineFs, pfs);
      w += measureText(p.s, pfs, { bold: isBold(p.el) });
    }
    const tl = text.getAttribute('textLength');
    if (tl && lines.length === 1) w = parseFloat(tl) || w;
    const anchor = inherited(line.anchorEl, 'text-anchor');
    const x0 =
      anchor === 'middle'
        ? line.x - w / 2
        : anchor === 'end'
          ? line.x - w
          : line.x;
    const [y0, y1] = lineSpan(line.anchorEl, line.y, lineFs);
    const corners = [
      [x0, y0],
      [x0 + w, y0],
      [x0, y1],
      [x0 + w, y1],
    ].map(([cx, cy]) => [
      m[0] * cx + m[2] * cy + m[4],
      m[1] * cx + m[3] * cy + m[5],
    ]);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    boxes.push({
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
      text: s.trim(),
      rotated,
    });
    void scale;
  }
  return boxes;
}

function quote(s: string): string {
  return JSON.stringify(s.length > 40 ? s.slice(0, 39) + '…' : s);
}

/** Lint one SVG document string. An empty array means geometry found nothing. */
export function lintSvg(svg: string): LintFinding[] {
  if (!svg.trim()) return [{ rule: 'blank', detail: 'render produced no SVG' }];
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const root = doc.documentElement;
  const findings: LintFinding[] = [];
  HIDDEN_BY_STYLE = styleHidden(doc);

  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const canvas =
    vb.length === 4 && vb.every(Number.isFinite)
      ? { x0: vb[0], y0: vb[1], x1: vb[0] + vb[2], y1: vb[1] + vb[3] }
      : {
          x0: 0,
          y0: 0,
          x1: parseFloat(root.getAttribute('width') ?? '') || Infinity,
          y1: parseFloat(root.getAttribute('height') ?? '') || Infinity,
        };

  const boxes: (Box & { clipped: boolean })[] = [];
  for (const t of Array.from(doc.getElementsByTagName('text'))) {
    if (invisible(t)) continue;
    const m = ctm(t);
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const fsPx = fontSizeOf(t) * scale;
    const own = textBoxes(t);
    if (own.length > 0 && fsPx < MIN_FONT_PX)
      findings.push({
        rule: 'text-tiny',
        detail: `${quote(own[0].text)} draws at ${fsPx.toFixed(1)}px (min ${MIN_FONT_PX})`,
      });
    const isClipped = clipped(t);
    for (const b of own) boxes.push({ ...b, clipped: isClipped });
  }

  const shapes = doc.querySelectorAll(
    'rect, path, circle, ellipse, line, polyline, polygon, image'
  );
  if (boxes.length === 0 && shapes.length === 0)
    findings.push({ rule: 'blank', detail: 'SVG draws nothing visible' });

  for (const b of boxes) {
    if (b.clipped) continue;
    const over = Math.max(
      canvas.x0 - b.x0,
      b.x1 - canvas.x1,
      canvas.y0 - b.y0,
      b.y1 - canvas.y1
    );
    if (over > OUTSIDE_TOLERANCE)
      findings.push({
        rule: 'text-outside',
        detail: `${quote(b.text)} runs ${over.toFixed(0)}px past the canvas edge`,
      });
  }

  const flat = boxes.filter((b) => !b.rotated && !b.clipped);
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i];
      const b = flat[j];
      const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (iw <= 0 || ih <= 0) continue;
      const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
      const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
      const small = areaA < areaB ? a : b;
      // The same string drawn twice in one place is a halo or outline pass.
      if (
        a.text === b.text &&
        Math.abs(a.x0 - b.x0) < 1 &&
        Math.abs(a.y0 - b.y0) < 1
      )
        continue;
      if (iw * ih < OVERLAP_AREA_SHARE * Math.min(areaA, areaB)) continue;
      if (ih < OVERLAP_HEIGHT_SHARE * (small.y1 - small.y0)) continue;
      findings.push({
        rule: 'text-overlap',
        detail: `${quote(a.text)} overlaps ${quote(b.text)}`,
      });
    }
  }
  return findings;
}
