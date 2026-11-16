// Bar `lollipop` (#1979): a thin stem from 0 with a dot at each value.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';

const SINGLE = `bar Plunder
lollipop
Tortuga 30
Nassau 80
Havana 50`;

const GROUPED = `bar Ships
lollipop
group
  Cannons
  Crew

Revenge 40 100
Fortune 20 300`;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string) {
  host.innerHTML = await renderDataChartD3(src, 'light');
  const svg = host.querySelector('svg')!;
  return {
    svg,
    dots: [
      ...svg.querySelectorAll<SVGCircleElement>('circle.dgmo-lollipop-dot'),
    ],
    stems: [...svg.querySelectorAll<SVGLineElement>('line.dgmo-lollipop-stem')],
    bars: [...svg.querySelectorAll('rect[data-line-number]')],
  };
}

const n = (el: Element, a: string) => parseFloat(el.getAttribute(a)!);

describe('bar lollipop (#1979)', () => {
  it('parses as a bare option with no diagnostics', () => {
    const parsed = parseChart(SINGLE);
    expect(parsed.lollipop).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('vertical: one stem and dot per bar, no rects, stems from 0 up to the dot', async () => {
    const { dots, stems, bars } = await draw(SINGLE);
    expect(bars).toHaveLength(0);
    expect(dots).toHaveLength(3);
    expect(stems).toHaveLength(3);
    const baseline = n(stems[0]!, 'y1');
    stems.forEach((s, i) => {
      expect(n(s, 'x1')).toBe(n(s, 'x2'));
      expect(n(s, 'y1')).toBeCloseTo(baseline);
      expect(n(s, 'y2')).toBeLessThan(baseline);
      expect(n(dots[i]!, 'cy')).toBeCloseTo(n(s, 'y2'));
      expect(n(dots[i]!, 'cx')).toBeCloseTo(n(s, 'x2'));
    });
    // Larger value → higher dot.
    expect(n(dots[1]!, 'cy')).toBeLessThan(n(dots[2]!, 'cy'));
    expect(dots[1]!.getAttribute('data-name')).toBe('Nassau');
  });

  it('horizontal: stems run along x from the 0 baseline', async () => {
    const { dots, stems } = await draw(`${SINGLE}\norientation-horizontal`);
    expect(dots).toHaveLength(3);
    const baseline = n(stems[0]!, 'x1');
    stems.forEach((s) => {
      expect(n(s, 'y1')).toBe(n(s, 'y2'));
      expect(n(s, 'x1')).toBeCloseTo(baseline);
      expect(n(s, 'x2')).toBeGreaterThan(baseline);
    });
  });

  it('grouped: dots side by side within a category, one stem each', async () => {
    const { dots, stems } = await draw(GROUPED);
    expect(dots).toHaveLength(4);
    expect(stems).toHaveLength(4);
    // Revenge's two dots share no x, and both sit left of Fortune's.
    const [a, b, c] = dots.map((d) => n(d, 'cx'));
    expect(a).toBeLessThan(b!);
    expect(b).toBeLessThan(c!);
    expect(dots.map((d) => d.getAttribute('data-series-name'))).toEqual([
      'Cannons',
      'Crew',
      'Cannons',
      'Crew',
    ]);
  });

  it('stack + lollipop is an error and draws ordinary stacked bars', async () => {
    const src = `bar Hauls
lollipop
stack
  Gold
  Silver

Revenge 10 10
Fortune 5 40`;
    const parsed = parseChart(src);
    expect(
      parsed.diagnostics.some(
        (d) => d.severity === 'error' && /lollipop/.test(d.message)
      )
    ).toBe(true);
    expect(parsed.lollipop).toBeUndefined();
    const { dots, bars } = await draw(src);
    expect(dots).toHaveLength(0);
    expect(bars).toHaveLength(4);
  });

  it('negative values: the stem runs from 0 down to the dot', async () => {
    const { dots, stems } = await draw(`bar Moves
lollipop
Gain 20
Loss -10`);
    const baseline = n(stems[0]!, 'y1');
    expect(n(stems[1]!, 'y1')).toBeCloseTo(baseline);
    expect(n(stems[1]!, 'y2')).toBeGreaterThan(baseline);
    expect(n(dots[1]!, 'cy')).toBeGreaterThan(baseline);
  });

  it('highlight dims the other stems and dots', async () => {
    const { dots, stems } = await draw(`${SINGLE}\nhighlight Nassau`);
    const lit = dots.findIndex((d) => d.getAttribute('data-name') === 'Nassau');
    // Story view repaints the ground; both stem and dot follow it.
    const groundStroke = stems[(lit + 1) % 3]!.getAttribute('stroke');
    expect(stems[lit]!.getAttribute('stroke')).not.toBe(groundStroke);
    expect(dots[(lit + 1) % 3]!.getAttribute('stroke')).toBe(groundStroke);
  });

  it('sorted lollipop: dots follow the sorted order', async () => {
    const { dots } = await draw(`${SINGLE}\nsort`);
    const byX = [...dots]
      .sort((a, b) => n(a, 'cx') - n(b, 'cx'))
      .map((d) => d.getAttribute('data-name'));
    expect(byX).toEqual(['Nassau', 'Havana', 'Tortuga']);
  });

  it('warns and is ignored on a non-bar chart', () => {
    const parsed = parseChart(`line Tide\nlollipop\nMon 1\nTue 2`);
    expect(parsed.lollipop).toBeUndefined();
    expect(
      parsed.diagnostics.some((d) => /only to bar charts/.test(d.message))
    ).toBe(true);
  });
});
