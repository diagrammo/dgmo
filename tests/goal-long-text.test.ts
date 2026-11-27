// A long title and a long band name share the goal's top row without
// overprinting, and stay on the canvas, on every goal layout (#2443).
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseGoal } from '../src/goal/parser';
import { renderGoal } from '../src/goal/renderer';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const palette = getPalette('nord').light;
const LONG = (word: string): string =>
  Array.from({ length: 15 }, (_, i) => `${word}${i}`)
    .join(' ')
    .padEnd(150, 'x')
    .slice(0, 150);
const TITLE = LONG('Title');
const BAND = LONG('Band');

function render(src: string): SVGSVGElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 800 });
  Object.defineProperty(c, 'clientHeight', { value: 600 });
  const parsed = parseGoal(src, palette);
  renderGoal(c as HTMLDivElement, parsed, palette, false);
  return c.querySelector('svg')!;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Box of a text element from its attributes, one line per x-bearing tspan. */
function textBox(t: Element): Rect {
  const size = Number(t.getAttribute('font-size'));
  const x = Number(t.getAttribute('x'));
  const y = Number(t.getAttribute('y'));
  const anchor = t.getAttribute('text-anchor') ?? 'start';
  const lineSpans = Array.from(t.children).filter((c) => c.hasAttribute('x'));
  const lines = lineSpans.length
    ? lineSpans.map((c) => c.textContent ?? '')
    : [t.textContent ?? ''];
  const pitch =
    lineSpans.length > 1 ? Number(lineSpans[1]!.getAttribute('dy')) : 0;
  const w = Math.max(...lines.map((l) => measureText(l, size, { bold: true })));
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return {
    x0,
    x1: x0 + w,
    y0: y - size * 0.8,
    y1: y + (lines.length - 1) * pitch + size * 0.2,
  };
}

const hit = (a: Rect, b: Rect): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function check(svg: SVGSVGElement): void {
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  const inside = (r: Rect): boolean =>
    r.x0 >= vx! && r.y0 >= vy! && r.x1 <= vx! + vw! && r.y1 <= vy! + vh!;
  const title = svg.querySelector('.chart-title')!;
  expect(title).not.toBeNull();
  if ((title.textContent ?? '').includes('…'))
    expect(title.getAttribute('data-full-text')).toBe(TITLE);
  const readouts = Array.from(svg.querySelectorAll('text')).filter((t) =>
    (t.textContent ?? '').includes('Band0')
  );
  expect(readouts.length).toBeGreaterThan(0);
  const tb = textBox(title);
  expect(inside(tb)).toBe(true);
  for (const r of readouts) {
    if (r.closest('.goal-bar, .goal-ribbon')) continue; // band names in the track
    const rb = textBox(r);
    expect(hit(tb, rb)).toBe(false);
    expect(inside(rb)).toBe(true);
    if ((r.textContent ?? '').includes('…'))
      expect(r.getAttribute('data-full-text')).toContain(BAND);
  }
}

const single = (mode: string, note = ''): string =>
  `goal ${TITLE}\n${mode}\nbands\n  0 ${BAND}\n  90 Done\nactual 40\ntarget 100\n${note}`;
const multi = (mode: string): string =>
  `goal ${TITLE}\n${mode}\nbands\n  0 ${BAND}\n  90 Done\n\n[One]\nactual 40\ntarget 100\n\n[Two]\nactual 30\ntarget 100\n`;

describe('goal long title and band name (#2443)', () => {
  it.each([
    ['bar', single('')],
    ['bar with note', single('', 'note\n  A note.')],
    ['thermometer', single('thermometer')],
    ['gauge', single('gauge')],
    ['gauge with note', single('gauge', 'note\n  A note.')],
    ['bullet rows', multi('')],
    ['thermometer cells', multi('thermometer')],
    ['gauge cells', multi('gauge')],
  ])('%s: title and readout do not meet and stay on the canvas', (_n, src) => {
    check(render(src));
  });

  it('a short title and band name draw on one row as before', () => {
    const svg = render(
      'goal Short\nbands\n  0 Poor\n  60 OK\nactual 64\ntarget 100\n'
    );
    const title = svg.querySelector('.chart-title')!;
    expect(title.querySelector('tspan')).toBeNull();
    expect(title.textContent).toBe('Short');
    expect(title.hasAttribute('data-full-text')).toBe(false);
  });
});
