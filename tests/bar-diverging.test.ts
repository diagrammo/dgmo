// Bar `stack diverging` with an inline `neutral` flag (#1980).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { divergingSpans } from '../src/utils/diverging';

const LIKERT = `bar Crew Morale Survey
orientation-horizontal
stack diverging
  Strongly disagree red
  Disagree orange
  Neutral gray neutral
  Agree green
  Strongly agree blue

Rations 10 20 10 30 30
Shore leave 5 15 20 40 20`;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string) {
  host.innerHTML = await renderDataChartD3(src, 'light');
  const svg = host.querySelector('svg')!;
  const rects = [
    ...svg.querySelectorAll<SVGRectElement>('rect[data-line-number]'),
  ];
  return { svg, rects };
}
const n = (el: Element, a: string) => parseFloat(el.getAttribute(a)!);
/** Rects of one category, in series order. */
const ofCategory = (rects: SVGRectElement[], cat: string) =>
  rects.filter((r) => r.getAttribute('data-name')!.startsWith(`${cat} · `));

describe('stack diverging parsing (#1980)', () => {
  it('`stack diverging` is a stack with a mode, not an inline series', () => {
    const p = parseChart(LIKERT);
    expect(p.barLayout).toBe('stack');
    expect(p.diverging).toBe(true);
    expect(p.seriesNames).toEqual([
      'Strongly disagree',
      'Disagree',
      'Neutral',
      'Agree',
      'Strongly agree',
    ]);
    expect(p.neutralSeries).toBe(2);
    expect(p.seriesNameColors?.[2]).toBeDefined();
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('no flag, odd count: the middle series is neutral', () => {
    const p = parseChart(
      `bar S\nstack diverging\n  No\n  Meh\n  Yes\n\nA 1 2 3`
    );
    expect(p.neutralSeries).toBe(1);
  });

  it('no flag, even count: no neutral, the split falls in the middle', () => {
    const p = parseChart(`bar S\nstack diverging\n  No\n  Yes\n\nA 1 2`);
    expect(p.neutralSeries).toBeUndefined();
    expect(divergingSpans([4, 6], undefined)).toEqual([
      [-4, 0],
      [0, 6],
    ]);
    expect(divergingSpans([1, 2, 3, 4], undefined)).toEqual([
      [-3, -2],
      [-2, 0],
      [0, 3],
      [3, 7],
    ]);
  });

  it('more than one neutral flag is an error', () => {
    const p = parseChart(
      `bar S\nstack diverging\n  No\n  Meh neutral\n  Shrug neutral\n  Yes\n\nA 1 2 3 4`
    );
    expect(
      p.diagnostics.some(
        (d) => d.severity === 'error' && /Only one series/.test(d.message)
      )
    ).toBe(true);
  });

  it('`neutral` is only a flag under stack diverging', () => {
    const p = parseChart(`bar S\nstack\n  Meh neutral\n  Yes\n\nA 1 2`);
    expect(p.seriesNames).toEqual(['Meh neutral', 'Yes']);
    expect(p.diverging).toBeUndefined();
  });

  it('spans: before neutral grow left, after grow right, neutral split', () => {
    expect(divergingSpans([10, 20, 10, 30, 30], 2)).toEqual([
      [-35, -25],
      [-25, -5],
      [-5, 5],
      [5, 35],
      [35, 65],
    ]);
  });

  it('sort orders by the total', () => {
    const p = parseChart(`${LIKERT}\nsort asc`);
    expect(p.data.map((d) => d.label)).toEqual(['Rations', 'Shore leave']);
  });
});

describe('stack diverging rendering (#1980)', () => {
  it('horizontal: left series left of 0, neutral straddles 0, right series right', async () => {
    const { svg, rects } = await draw(LIKERT);
    const row = ofCategory(rects, 'Rations');
    expect(row).toHaveLength(5);
    const left = (r: Element) => n(r, 'x');
    const right = (r: Element) => n(r, 'x') + n(r, 'width');
    const neutral = row[2]!;
    const zero = (left(neutral) + right(neutral)) / 2;
    // Declared order reads left to right; segments abut.
    expect(right(row[0]!)).toBeCloseTo(left(row[1]!));
    expect(right(row[1]!)).toBeCloseTo(left(neutral));
    expect(right(neutral)).toBeCloseTo(left(row[3]!));
    expect(right(row[3]!)).toBeCloseTo(left(row[4]!));
    expect(right(row[1]!)).toBeLessThan(zero);
    expect(left(row[3]!)).toBeGreaterThan(zero);
    // The 0 tick sits at the neutral segment's centre.
    const zeroTick = [...svg.querySelectorAll('text')].find(
      (t) => t.textContent === '0'
    );
    expect(zeroTick).toBeTruthy();
    expect(n(zeroTick!, 'x')).toBeCloseTo(zero, 0);
  });

  it('vertical: left series below 0, right series above', async () => {
    const { rects } = await draw(
      LIKERT.replace('orientation-horizontal\n', '')
    );
    const row = ofCategory(rects, 'Rations');
    const top = (r: Element) => n(r, 'y');
    const bottom = (r: Element) => n(r, 'y') + n(r, 'height');
    // Strongly disagree is lowest, Strongly agree highest.
    expect(top(row[0]!)).toBeCloseTo(bottom(row[1]!));
    expect(top(row[3]!)).toBeCloseTo(bottom(row[4]!));
    expect(top(row[0]!)).toBeGreaterThan(top(row[4]!));
  });

  it('value labels and hover values are each segment’s own, never negative', async () => {
    const { svg, rects } = await draw(LIKERT);
    const row = ofCategory(rects, 'Rations');
    expect(row.map((r) => r.getAttribute('data-value'))).toEqual([
      '10',
      '20',
      '10',
      '30',
      '30',
    ]);
    const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts.some((t) => /^[-−]\d/.test(t ?? ''))).toBe(false);
  });

  it('the axis reads positive both directions from 0', async () => {
    const { svg } = await draw(LIKERT);
    const ticks = [...svg.querySelectorAll('text')]
      .map((t) => t.textContent ?? '')
      .filter((t) => /^[-−]?\d+$/.test(t));
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.every((t) => !/^[-−]/.test(t))).toBe(true);
  });

  it('the legend lists series in declared order', async () => {
    const { svg } = await draw(LIKERT);
    const all = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    const order = [
      'Strongly disagree',
      'Disagree',
      'Neutral',
      'Agree',
      'Strongly agree',
    ].map((name) => all.indexOf(name));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
