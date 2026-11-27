// Drawn-extent helpers for cycle tests (#2429, #2431). jsdom has no getBBox,
// so each drawn element's box is computed from its attributes: rects, circles,
// lines, ring paths (M / L / A / Q / C, arcs sampled) and text (measured).

import { measureText } from '../../src/utils/text-measure';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const num = (el: Element, a: string): number =>
  parseFloat(el.getAttribute(a) ?? '0');

/** Sum of every `translate(x, y)` on the element and its ancestors. */
export function offsetOf(el: Element): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const t = e.getAttribute('transform');
    const m = t && /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(t);
    if (m) {
      dx += parseFloat(m[1]!);
      dy += parseFloat(m[2]!);
    }
  }
  return { dx, dy };
}

/** Points on an SVG endpoint-parameterised arc (spec appendix F.6.5). */
function arcPoints(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number
): Array<[number, number]> {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const numr = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const den = rx * rx * dy * dy + ry * ry * dx * dx;
  const co = sign * Math.sqrt(Math.max(0, numr / den));
  const cxp = (co * rx * dy) / ry;
  const cyp = (-co * ry * dx) / rx;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number) => Math.atan2(uy, ux);
  const t1 = ang((dx - cxp) / rx, (dy - cyp) / ry);
  let dt = ang((-dx - cxp) / rx, (-dy - cyp) / ry) - t1;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 64; i++) {
    const t = t1 + (dt * i) / 64;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

/** Every point a path's outline passes through (curves sampled). */
export function pathPoints(d: string): Array<[number, number]> {
  const toks = d.match(/[a-zA-Z]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
  const pts: Array<[number, number]> = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  const n = () => parseFloat(toks[i++]!);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i]!)) cmd = toks[i++]!;
    if (cmd === 'M' || cmd === 'L') {
      x = n();
      y = n();
      pts.push([x, y]);
    } else if (cmd === 'A') {
      const rx = n();
      const ry = n();
      n();
      const large = n();
      const sweep = n();
      const x2 = n();
      const y2 = n();
      pts.push(...arcPoints(x, y, rx, ry, large, sweep, x2, y2));
      x = x2;
      y = y2;
    } else if (cmd === 'Q') {
      const qx = n();
      const qy = n();
      const x2 = n();
      const y2 = n();
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        pts.push([
          (1 - t) ** 2 * x + 2 * (1 - t) * t * qx + t * t * x2,
          (1 - t) ** 2 * y + 2 * (1 - t) * t * qy + t * t * y2,
        ]);
      }
      x = x2;
      y = y2;
    } else if (cmd === 'C') {
      const ax = n();
      const ay = n();
      const bx = n();
      const by = n();
      const x2 = n();
      const y2 = n();
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const u = 1 - t;
        pts.push([
          u ** 3 * x + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * x2,
          u ** 3 * y + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * y2,
        ]);
      }
      x = x2;
      y = y2;
    } else if (cmd === 'Z' || cmd === 'z') {
      // closes to the start; adds no new point
    } else {
      i++; // an unexpected token: skip it
    }
  }
  return pts;
}

/** The box a text element draws, measured at its own font size. */
export function textBox(el: Element): Box {
  const fs = num(el, 'font-size') || 12;
  const bold = /bold|[6-9]00/.test(el.getAttribute('font-weight') ?? '');
  const w = measureText(el.textContent ?? '', fs, { bold });
  const x = num(el, 'x');
  const y = num(el, 'y');
  const anchor = el.getAttribute('text-anchor') ?? 'start';
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { x0, y0: y - fs * 0.8, x1: x0 + w, y1: y + fs * 0.25 };
}

/** The box of one drawn element, in SVG coordinates (translates applied). */
export function elementBox(el: Element): Box | null {
  const { dx, dy } = offsetOf(el);
  const tag = el.tagName.toLowerCase();
  let b: Box | null = null;
  if (tag === 'rect') {
    const x = num(el, 'x');
    const y = num(el, 'y');
    b = { x0: x, y0: y, x1: x + num(el, 'width'), y1: y + num(el, 'height') };
  } else if (tag === 'circle') {
    const r = num(el, 'r');
    b = {
      x0: num(el, 'cx') - r,
      y0: num(el, 'cy') - r,
      x1: num(el, 'cx') + r,
      y1: num(el, 'cy') + r,
    };
  } else if (tag === 'line') {
    b = {
      x0: Math.min(num(el, 'x1'), num(el, 'x2')),
      y0: Math.min(num(el, 'y1'), num(el, 'y2')),
      x1: Math.max(num(el, 'x1'), num(el, 'x2')),
      y1: Math.max(num(el, 'y1'), num(el, 'y2')),
    };
  } else if (tag === 'path') {
    const pts = pathPoints(el.getAttribute('d') ?? '');
    if (pts.length === 0) return null;
    // Half the stroke, plus the arrowhead's reach past the path's end.
    const pad =
      num(el, 'stroke-width') / 2 + (el.getAttribute('marker-end') ? 8 : 0);
    b = {
      x0: Math.min(...pts.map((p) => p[0])) - pad,
      y0: Math.min(...pts.map((p) => p[1])) - pad,
      x1: Math.max(...pts.map((p) => p[0])) + pad,
      y1: Math.max(...pts.map((p) => p[1])) + pad,
    };
  } else if (tag === 'text') {
    b = textBox(el);
  }
  if (!b) return null;
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

/**
 * Every drawn element of the diagram body (nodes, ring, arrows, labels,
 * badges, centre text) whose box leaves the SVG's [0, w] × [0, h].
 */
export function overflowingElements(
  svg: SVGSVGElement,
  w: number,
  h: number
): Array<{ tag: string; box: Box }> {
  const out: Array<{ tag: string; box: Box }> = [];
  for (const el of Array.from(
    svg.querySelectorAll(
      '.cycle-node *, .cycle-edge *, .cycle-step-numbers *, .cycle-center'
    )
  )) {
    const b = elementBox(el);
    if (!b) continue;
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > w || b.y1 > h)
      out.push({ tag: el.tagName.toLowerCase(), box: b });
  }
  return out;
}
