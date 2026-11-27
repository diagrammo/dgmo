// Long step names, descriptions and centre text stay inside their shapes
// (#2431): wrap first, then cut the last line with `…`; a cut step keeps its
// full text in data-full-text.
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseCycle } from '../src/cycle/parser';
import { computeCycleLayout } from '../src/cycle/layout';
import { renderCycle } from '../src/cycle/renderer';
import { getPalette } from '../src/palettes';
import { FULL_TEXT_ATTR } from '../src/utils/full-text';
import { elementBox, textOutsideNodes } from './helpers/cycle-extent';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [k, v] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  }))
    Object.defineProperty(globalThis, k, { value: v, configurable: true });
});

const palette = getPalette('nord').light;

/** A name of exactly 150 characters. */
const NAME150 = (
  'Gather every requirement from every stakeholder across the whole ' +
  'organisation and write them all down in one very long document that ' +
  'nobody will ever read again'
)
  .slice(0, 149)
  .concat('.');
const LONG_DESC =
  'Interview the users, read the support tickets, study the analytics and ' +
  'the competitors, then write a summary for the team.';
const FORTY_LINES = Array.from(
  { length: 40 },
  (_, i) => `  Point ${i + 1} of a description that runs on for forty lines\\`
).join('\n');

function render(src: string, w = 800, h = 600): SVGSVGElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: w });
  Object.defineProperty(container, 'clientHeight', { value: h });
  document.body.appendChild(container);
  renderCycle(container, parseCycle(src), palette, false, undefined, {
    width: w,
    height: h,
  });
  return container.querySelector('svg')!;
}

const steps = (n: number, body = '') =>
  Array.from({ length: n }, (_, i) => `Step ${i + 1} ${NAME150}${body}`).join(
    '\n'
  );

// Stand-in for the pressure file cycle-pressure-09-break-long-labels.
const PRESSURE = `cycle Long Labels
center ${NAME150}

${steps(5, `\n  ${LONG_DESC}\n  ${LONG_DESC}`)}`;

describe('cycle — long text stays in its shape (#2431)', () => {
  expect(NAME150).toHaveLength(150);

  const cases: Record<string, string> = {
    'the pressure file': PRESSURE,
    '150-character names': `cycle Names\n\n${steps(5)}`,
    '150-character names, circle nodes': `cycle Names\ncircle-nodes\n\n${steps(5)}`,
    'the pressure file, circle nodes': PRESSURE.replace(
      'center',
      'circle-nodes\ncenter'
    ),
    'a 40-line description': `cycle Forty\n\nPlan\n${FORTY_LINES}\nBuild\nShip`,
    'a 40-line description, circle nodes': `cycle Forty\ncircle-nodes\n\nPlan\n${FORTY_LINES}\nBuild\nShip`,
  };
  for (const [name, src] of Object.entries(cases)) {
    for (const [w, h] of [
      [800, 600],
      [1200, 800],
      [500, 400],
    ] as const) {
      it(`${name} at ${w}x${h}: every name and description line is inside its step`, () => {
        const svg = render(src, w, h);
        expect(svg.querySelectorAll('.cycle-node text').length).toBeGreaterThan(
          0
        );
        expect(textOutsideNodes(svg)).toEqual([]);
      });
    }
  }

  it('wraps a 150-character name to at most three lines, then cuts it', () => {
    const svg = render(`cycle Names\n\n${steps(3)}`);
    const node = svg.querySelector('.cycle-node')!;
    const lines = Array.from(node.querySelectorAll('text')).map(
      (t) => t.textContent ?? ''
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[lines.length - 1]!.endsWith('…')).toBe(true);
    expect(node.getAttribute(FULL_TEXT_ATTR)).toBe(`Step 1 ${NAME150}`);
  });

  it('cuts a 40-line description at the line budget, inside the box', () => {
    const parsed = parseCycle(
      `cycle Forty\n\nPlan\n${FORTY_LINES}\nBuild\nShip`
    );
    const layout = computeCycleLayout(parsed, { width: 1200, height: 800 });
    const plan = layout.nodes[0]!;
    expect(plan.wrappedDesc.length).toBeLessThanOrEqual(12);
    expect(plan.wrappedDesc[plan.wrappedDesc.length - 1]!.text).toMatch(/…$/);
    const svg = render(
      `cycle Forty\n\nPlan\n${FORTY_LINES}\nBuild\nShip`,
      1200,
      800
    );
    const node = svg.querySelector('.cycle-node')!;
    expect(node.getAttribute(FULL_TEXT_ATTR)).toContain('Point 40 of');
    expect(textOutsideNodes(svg)).toEqual([]);
  });

  it('wraps a 150-character centre text inside the ring clearance', () => {
    for (const src of [PRESSURE, `cycle C\ncenter ${NAME150}\n\nA\nB\nC\nD`]) {
      const parsed = parseCycle(src);
      const svg = render(src);
      const texts = Array.from(svg.querySelectorAll('.cycle-center'));
      expect(texts.length).toBeGreaterThan(1);
      expect(parsed.nodes.length).toBeGreaterThan(0);
      // The clearance: the ring's radius (read off a ring arc) less the
      // largest node's half-size, around the ring's centre.
      const nodes = Array.from(
        svg.querySelectorAll('.cycle-node > rect, .cycle-node > circle')
      ).map((e) => elementBox(e)!);
      const arc = /A ([\d.]+) /.exec(
        svg.querySelector('.cycle-edge path')!.getAttribute('d')!
      );
      const radius = Number(arc![1]);
      const maxHalf = Math.max(
        ...nodes.map((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2)
      );
      const clearance = radius - maxHalf;
      const boxes = texts.map((t) => elementBox(t)!);
      // The renderer centres the block on the ring's centre.
      const cx =
        (Math.min(...boxes.map((b) => b.x0)) +
          Math.max(...boxes.map((b) => b.x1))) /
        2;
      const lh =
        Number(texts[1]!.getAttribute('y')) -
        Number(texts[0]!.getAttribute('y'));
      const font = Number(texts[0]!.getAttribute('font-size'));
      const firstY = elementBox(texts[0]!)!.y0 + font * 0.8 - font / 3;
      const cy = firstY + ((texts.length - 1) * lh) / 2;
      for (const b of boxes)
        for (const [x, y] of [
          [b.x0, b.y0],
          [b.x1, b.y0],
          [b.x0, b.y1],
          [b.x1, b.y1],
        ] as const)
          expect(Math.hypot(x - cx, y - cy)).toBeLessThanOrEqual(clearance);
      // Cut text keeps the whole of it for hover; wrapped-only text needs none.
      const block = svg.querySelector('.cycle-center-block')!;
      const cut = (texts[texts.length - 1]!.textContent ?? '').endsWith('…');
      expect(block.getAttribute(FULL_TEXT_ATTR)).toBe(cut ? NAME150 : null);
    }
  });

  it('draws short names exactly as before: one line, no full-text attribute', () => {
    const svg = render(
      `cycle Short\ncenter PDCA\n\nPlan\n  Pick the work\nDo\nCheck\nAct`
    );
    for (const node of Array.from(svg.querySelectorAll('.cycle-node'))) {
      expect(node.hasAttribute(FULL_TEXT_ATTR)).toBe(false);
    }
    expect(svg.querySelectorAll('.cycle-center')).toHaveLength(1);
    expect(svg.querySelector('.cycle-center-block')).toBeNull();
  });
});
