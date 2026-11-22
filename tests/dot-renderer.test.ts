// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseDot } from '../src/dot/parser';
import { renderDot } from '../src/dot/renderer';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { getSeriesColors } from '../src/palettes/color-utils';

const palette = getPalette('nord').light;

const DUMBBELL = `dot Engagement score by department
series 2020, 2025
gap

Engineering 71 78
Sales 64 61
Support 58 72
`;

function draw(src: string): HTMLDivElement {
  const parsed = parseDot(src);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  renderDot(container, parsed, palette, false, undefined, {
    width: 960,
    height: 480,
  });
  return container;
}

const num = (el: Element, a: string) => Number(el.getAttribute(a));
const rowsOf = (c: Element) => [...c.querySelectorAll('.dot-row')];
const texts = (c: Element, sel: string) =>
  [...c.querySelectorAll(sel)].map((e) => e.textContent);

describe('dot renderer (#1849)', () => {
  it('draws one row per data row, each carrying its source line', () => {
    const c = draw(DUMBBELL);
    expect(rowsOf(c).map((g) => g.getAttribute('data-line-number'))).toEqual([
      '5',
      '6',
      '7',
    ]);
    expect(c.querySelectorAll('.dot-dot')).toHaveLength(6);
  });

  it('a dumbbell joins its row lowest to highest, under the dots', () => {
    const c = draw(DUMBBELL);
    const sales = rowsOf(c)[1]!;
    const connector = sales.querySelector('.dot-connector')!;
    const dots = [...sales.querySelectorAll('.dot-dot')];
    const xs = dots.map((d) => num(d, 'cx'));
    expect(num(connector, 'x1')).toBeCloseTo(Math.min(...xs), 5);
    expect(num(connector, 'x2')).toBeCloseTo(Math.max(...xs), 5);
    // Drawn before the dots, so the dots sit over it.
    expect(sales.firstElementChild!.nextElementSibling).toBe(connector);
    // 2025 (61) is left of 2020 (64) on Sales.
    expect(xs[1]!).toBeLessThan(xs[0]!);
  });

  it('a dot plot has no connectors and no series names', () => {
    const c = draw(
      `dot Median salary ($k)\nStaff engineer 212\nDesigner 141\n`
    );
    expect(c.querySelectorAll('.dot-dot')).toHaveLength(2);
    expect(c.querySelectorAll('.dot-connector')).toHaveLength(0);
    expect(c.querySelectorAll('.dot-series-label')).toHaveLength(0);
    // One series takes the primary colour, as a single-series bar does.
    expect(c.querySelector('.dot-dot')!.getAttribute('fill')).toBe(
      palette.primary
    );
  });

  it('fits the axis to the data, so zero is not required', () => {
    const c = draw(DUMBBELL);
    const ticks = texts(c, '.dot-tick').map(Number);
    expect(Math.min(...ticks)).toBeGreaterThan(0);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(58);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(78);
  });

  it('x-axis overrides the range', () => {
    const c = draw(DUMBBELL.replace('gap\n', 'gap\nx-axis 0..100\n'));
    const ticks = texts(c, '.dot-tick').map(Number);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(100);
  });

  it('names each series above its dot in the first row, in its colour', () => {
    const c = draw(DUMBBELL);
    const labels = [...c.querySelectorAll('.dot-series-label')];
    expect(labels.map((l) => l.textContent)).toEqual(['2020', '2025']);
    const colors = getSeriesColors(palette);
    expect(labels.map((l) => l.getAttribute('fill'))).toEqual([
      colors[0],
      colors[1],
    ]);
    const firstDots = [...rowsOf(c)[0]!.querySelectorAll('.dot-dot')];
    expect(firstDots.map((d) => d.getAttribute('fill'))).toEqual([
      colors[0],
      colors[1],
    ]);
    const cy = num(firstDots[0]!, 'cy');
    for (const l of labels) expect(num(l, 'y')).toBeLessThan(cy);
    // Engineering 71 → 78: each name over its own dot.
    expect(num(labels[0]!, 'x')).toBeLessThan(num(labels[1]!, 'x'));
  });

  it('gap prints last − first, signed, at each row end', () => {
    const c = draw(DUMBBELL);
    expect(texts(c, '.dot-gap')).toEqual(['+7', '−3', '+14']);
    const noGap = draw(DUMBBELL.replace('gap\n', ''));
    expect(noGap.querySelectorAll('.dot-gap')).toHaveLength(0);
  });

  it('connectors are grey by default and coloured by direction on request', () => {
    const stroke = (c: Element) =>
      [...c.querySelectorAll('.dot-connector')].map((l) =>
        l.getAttribute('stroke')
      );
    const grey = stroke(draw(DUMBBELL));
    expect(new Set(grey).size).toBe(1);
    expect(grey[0]).not.toBe(palette.colors.green);
    const { green, red } = palette.colors;
    const up = DUMBBELL.replace('gap\n', 'gap\nconnector direction\n');
    expect(stroke(draw(up))).toEqual([green, red, green]);
    const down = DUMBBELL.replace('gap\n', 'gap\nconnector direction down\n');
    expect(stroke(draw(down))).toEqual([red, green, red]);
  });

  it('rings each dot in the ground colour', () => {
    const c = draw(DUMBBELL);
    const dot = c.querySelector('.dot-dot')!;
    expect(dot.getAttribute('stroke-width')).toBe('1.5');
    expect(dot.getAttribute('stroke')).toBe(palette.bg);
  });

  it('draws three or more values on one line, connector spanning them all', () => {
    const c = draw(`dot Strip\nseries Low, Mid, High\nA 10 30 20\nB 5 6 7\n`);
    const a = rowsOf(c)[0]!;
    const xs = [...a.querySelectorAll('.dot-dot')].map((d) => num(d, 'cx'));
    expect(xs).toHaveLength(3);
    const conn = a.querySelector('.dot-connector')!;
    expect(num(conn, 'x1')).toBeCloseTo(Math.min(...xs), 5);
    expect(num(conn, 'x2')).toBeCloseTo(Math.max(...xs), 5);
    const cys = new Set(
      [...a.querySelectorAll('.dot-dot')].map((d) => d.getAttribute('cy'))
    );
    expect(cys.size).toBe(1);
  });

  it('exports through renderForExport', async () => {
    const svg = await renderForExport(DUMBBELL, 'light');
    expect(svg).toContain('dot-dot');
    expect(svg).toContain('Engagement score by department');
  });
});
