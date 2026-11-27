// quadrant-long-labels.test.ts — very long axis labels, quadrant names and
// point names fit the canvas and never overprint one another (#2459): shrink,
// wrap to a line cap, then cut with `…` and keep the words in data-full-text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseQuadrant } from '../src/quadrant/parser';
import {
  renderQuadrant,
  AXIS_MAX_LINES,
  QUADRANT_LABEL_MAX_LINES,
  POINT_LABEL_MAX_LINES,
} from '../src/quadrant/renderer';
import { measureText } from '../src/utils/text-measure';
import { FULL_TEXT_ATTR } from '../src/utils/full-text';
import { getPalette } from '../src/palettes';

const SRC = readFileSync(
  join(__dirname, 'fixtures/quadrant/pressure-09-long-labels.dgmo'),
  'utf8'
);

interface Box {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function render(width: number, height: number): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const palette = getPalette('nord').light;
  renderQuadrant(
    container,
    parseQuadrant(SRC, palette),
    palette,
    false,
    undefined,
    {
      width,
      height,
    }
  );
  return container;
}

const num = (el: Element, a: string): number => Number(el.getAttribute(a) ?? 0);

/** Sum of translate(x, y) on the ancestors of `el`. */
function offset(el: Element): [number, number] {
  let dx = 0;
  let dy = 0;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const m = p
      .getAttribute('transform')
      ?.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    if (m) {
      dx += Number(m[1]);
      dy += Number(m[2]);
    }
  }
  return [dx, dy];
}

/** The drawn lines of a <text>, with each line's y, skipping hidden tspans. */
function lines(text: Element): { s: string; y: number }[] {
  const tspans = [...text.querySelectorAll('tspan')];
  const y = num(text, 'y');
  if (tspans.length === 0) return [{ s: text.textContent ?? '', y }];
  let cy = y;
  const out: { s: string; y: number }[] = [];
  for (const t of tspans) {
    cy += parseFloat(t.getAttribute('dy') ?? '0') || 0;
    if (t.getAttribute('visibility') === 'hidden') continue;
    out.push({ s: t.textContent ?? '', y: cy });
  }
  return out;
}

/** One box per drawn line of a <text>, in canvas coordinates. */
function boxes(text: Element, name: string): Box[] {
  const fs = num(text, 'font-size');
  const bold = text.getAttribute('font-weight') === 'bold';
  const anchor = text.getAttribute('text-anchor') ?? 'start';
  const central = text.getAttribute('dominant-baseline') === 'central';
  const x = num(text, 'x');
  const [ox, oy] = offset(text);
  const rot = text
    .getAttribute('transform')
    ?.match(/rotate\(-90,\s*([-\d.]+),\s*([-\d.]+)\)/);
  return lines(text).map(({ s, y }) => {
    const w = measureText(s, fs, { bold });
    const lx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    // Ascent/descent of Inter, roughly: cap height above, a little below.
    const top = central ? y - fs / 2 : y - fs * 0.8;
    const bottom = central ? y + fs / 2 : y + fs * 0.2;
    let b = { x0: lx, y0: top, x1: lx + w, y1: bottom };
    if (rot) {
      // rotate(-90, cx, cy): (x, y) → (cx + (y - cy), cy - (x - cx)).
      const cx = Number(rot[1]);
      const cy = Number(rot[2]);
      b = {
        x0: cx + (b.y0 - cy),
        x1: cx + (b.y1 - cy),
        y0: cy - (b.x1 - cx),
        y1: cy - (b.x0 - cx),
      };
    }
    return {
      name: `${name}: ${s}`,
      x0: b.x0 + ox,
      y0: b.y0 + oy,
      x1: b.x1 + ox,
      y1: b.y1 + oy,
    };
  });
}

function textBoxes(c: HTMLDivElement): {
  all: Box[];
  byText: Map<Element, Box[]>;
} {
  const byText = new Map<Element, Box[]>();
  const add = (sel: string, name: string) =>
    c
      .querySelectorAll(sel)
      .forEach((t, i) => byText.set(t, boxes(t, `${name}${i}`)));
  add('text.chart-title', 'title');
  add('text.quadrant-axis-label', 'axis');
  add('text.quadrant-label', 'quadrant');
  add('g.point-group > text', 'point');
  return { all: [...byText.values()].flat(), byText };
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('quadrant long labels (#2459)', () => {
  for (const [w, h] of [
    [1200, 800],
    [600, 400],
    [420, 320],
  ] as const) {
    it(`keeps every text box on a ${w}×${h} canvas and apart`, () => {
      const c = render(w, h);
      const { all, byText } = textBoxes(c);
      expect(c.querySelectorAll('text.quadrant-axis-label')).toHaveLength(4);
      expect(c.querySelectorAll('g.point-group > text')).toHaveLength(3);
      for (const b of all) {
        expect(b.x0, b.name).toBeGreaterThanOrEqual(0);
        expect(b.y0, b.name).toBeGreaterThanOrEqual(0);
        expect(b.x1, b.name).toBeLessThanOrEqual(w);
        expect(b.y1, b.name).toBeLessThanOrEqual(h);
      }
      // Lines of one <text> may touch each other; boxes of two texts may not.
      const entries = [...byText.values()];
      for (let i = 0; i < entries.length; i++)
        for (let j = i + 1; j < entries.length; j++)
          for (const a of entries[i]!)
            for (const b of entries[j]!)
              expect(overlaps(a, b), `${a.name}  ×  ${b.name}`).toBe(false);

      const count = (sel: string) =>
        [...c.querySelectorAll(sel)].map((t) => lines(t).length);
      for (const n of count('text.quadrant-axis-label'))
        expect(n).toBeLessThanOrEqual(AXIS_MAX_LINES);
      for (const n of count('text.quadrant-label'))
        expect(n).toBeLessThanOrEqual(QUADRANT_LABEL_MAX_LINES);
      for (const n of count('g.point-group > text'))
        expect(n).toBeLessThanOrEqual(POINT_LABEL_MAX_LINES);
    });
  }

  it('cuts with … and keeps the full words in data-full-text', () => {
    const c = render(420, 320);
    const cut = [...c.querySelectorAll(`[${FULL_TEXT_ATTR}]`)];
    // Both long point names, both long quadrant names and all four axis
    // halves are cut at this size.
    expect(cut.length).toBeGreaterThanOrEqual(8);
    for (const el of cut) expect(el.textContent).toContain('…');
    // The only <title> is the chart title's own (renderChartTitle).
    expect(c.querySelectorAll('title')).toHaveLength(
      c.querySelectorAll('text.chart-title > title').length
    );
  });

  it('short labels draw on one line, uncut', () => {
    const src = [
      'quadrant T',
      'x-axis Low, High',
      'y-axis Low, High',
      'top-left Quick Wins',
      'A 0.2 0.8',
    ].join('\n');
    const container = document.createElement('div');
    const palette = getPalette('nord').light;
    renderQuadrant(
      container,
      parseQuadrant(src, palette),
      palette,
      false,
      undefined,
      {
        width: 600,
        height: 400,
      }
    );
    expect(container.querySelector(`[${FULL_TEXT_ATTR}]`)).toBeNull();
    expect(
      container.querySelectorAll('.quadrant-axis-label tspan')
    ).toHaveLength(0);
  });
});
