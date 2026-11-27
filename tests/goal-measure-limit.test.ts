// A goal draws at most GOAL_MAX_MEASURES bar rows (GOAL_MAX_CELLS cells),
// raises one error past it, and on screen fits the pane's height (#2444).
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseGoal } from '../src/goal/parser';
import { renderGoal } from '../src/goal/renderer';
import { GOAL_MAX_CELLS, GOAL_MAX_MEASURES } from '../src/goal/limits';
import { getPalette } from '../src/palettes';
import { MIN_READABLE_TYPE_PX } from '../src/utils/text-measure';

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

const goal = (n: number, mode = ''): string =>
  `goal Many measures\n${mode}\n` +
  Array.from(
    { length: n },
    (_, i) => `[Measure ${i}]\nactual ${i * 3}\ntarget 100\n`
  ).join('\n');

function draw(
  src: string,
  exportDims?: { width: number; height: number }
): SVGSVGElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 800 });
  Object.defineProperty(c, 'clientHeight', { value: 600 });
  renderGoal(
    c as HTMLDivElement,
    parseGoal(src, palette),
    palette,
    false,
    exportDims
  );
  return c.querySelector('svg')!;
}

const errs = (src: string) =>
  parseGoal(src, palette).diagnostics.filter((d) => d.severity === 'error');

describe('goal measure limit (#2444)', () => {
  it.each([
    ['bar', '', GOAL_MAX_MEASURES],
    ['thermometer', 'thermometer', GOAL_MAX_CELLS],
    ['gauge', 'gauge', GOAL_MAX_CELLS],
  ])('%s: N measures draw with no error', (_n, mode, max) => {
    const p = parseGoal(goal(max, mode), palette);
    expect(p.diagnostics).toEqual([]);
    expect(p.measures).toHaveLength(max);
  });

  it.each([
    ['bar', '', GOAL_MAX_MEASURES, '.goal-row'],
    ['thermometer', 'thermometer', GOAL_MAX_CELLS, '.goal-cell'],
    ['gauge', 'gauge', GOAL_MAX_CELLS, '.goal-cell'],
  ])('%s: N+1 measures draw N with one error', (_n, mode, max, sel) => {
    const src = goal(max + 1, mode);
    const e = errs(src);
    expect(e).toHaveLength(1);
    expect(e[0]!.code).toBe('E_GOAL_TOO_MANY_MEASURES');
    expect(e[0]!.message).toContain(`${max + 1} measures`);
    expect(e[0]!.message).toContain(`first ${max}`);
    expect(draw(src).querySelectorAll(sel)).toHaveLength(max);
  });

  it('60 measures draw the first N with one error', () => {
    const src = goal(60);
    expect(errs(src)).toHaveLength(1);
    expect(draw(src).querySelectorAll('.goal-row')).toHaveLength(
      GOAL_MAX_MEASURES
    );
  });

  it('on screen, N bar measures fit within the container height', () => {
    const svg = draw(goal(GOAL_MAX_MEASURES));
    expect(Number(svg.getAttribute('height'))).toBeLessThanOrEqual(600);
  });

  it('at N, the values stay readable on the default 1200x800 canvas', () => {
    const svg = draw(goal(GOAL_MAX_MEASURES), { width: 1200, height: 800 });
    const [, , vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const scale = Math.min(1200 / vw!, 800 / vh!);
    // The row values are drawn at 18px.
    expect(18 * scale).toBeGreaterThanOrEqual(MIN_READABLE_TYPE_PX);
  });

  it('a single goal still exports fitted to its content, not the canvas', () => {
    const svg = draw('goal One\nactual 3\ntarget 5\n', {
      width: 1200,
      height: 800,
    });
    const [, , vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(Number(svg.getAttribute('height'))).toBe(
      Math.round((1200 * vh!) / vw!)
    );
    expect(Number(svg.getAttribute('height'))).toBeLessThan(400);
  });
});
