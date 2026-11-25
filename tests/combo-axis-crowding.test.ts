import { describe, it, expect } from 'vitest';
import { renderDataChartD3 as renderRaw } from '../src/charts-d3/index';
import { LABEL_ROTATE_DEG } from '../src/charts-d3/shared';
import { MIN_TICK_GAP } from '../src/charts-d3/value-axis';
import { measureText } from '../src/utils/text-measure';
import { flattenTabular } from './helpers/tabular-text';

// Combo charts at card size (#2320): the x-axis title sat on the rotated
// category names, the value ticks stacked on a short plot, and a long y-axis
// title was cut to `…` when two lines would hold it.

const CARD = { width: 470, height: 300 };
const render = async (src: string): Promise<string> =>
  flattenTabular(await renderRaw(src, 'light', undefined, CARD));

const BAR = `bar Cannon Fire and Hits by Ship
x-axis Ship

group
  y-axis Shots
    Broadsides blue
    Chasers green
  y-right-axis Hit Rate (%)
    Hit Rate red mark: line

Queen Anne's Revenge 120 40 38
Royal Fortune        104 36 44
Whydah Gally          88 30 51
Adventure Galley     132 46 35
`;

const LINE = `line Plunder and Morale Over the Voyage
x-axis Port of Call

series
  y-axis Doubloons (thousands)
    Plunder orange mark: bar
  y-right-axis Crew Morale (%)
    Morale blue

Nassau       4.2 62
Tortuga      6.5 71
Port Royal   9.1 80
Isla Muerta  7.8 58
Kingston    11.4 86
`;

const texts = (svg: string) =>
  [...svg.matchAll(/<text([^>]*)>(.*?)<\/text>/g)].map((m) => ({
    attrs: m[1]!,
    body: m[2]!.replace(/<title>.*?<\/title>/g, ''),
  }));

/** Lowest point any rotated category label reaches. */
function rotatedFoot(svg: string): number {
  const sin = Math.sin((LABEL_ROTATE_DEG * Math.PI) / 180);
  const feet = texts(svg)
    .map((t) => {
      const m = t.attrs.match(
        new RegExp(
          `translate\\(([\\d.]+),([\\d.]+)\\) rotate\\(-${LABEL_ROTATE_DEG}\\)`
        )
      );
      return m ? Number(m[2]) + measureText(t.body, 12) * sin : null;
    })
    .filter((y): y is number => y !== null);
  expect(feet.length).toBeGreaterThan(0);
  return Math.max(...feet);
}

function titleY(svg: string, label: string): number {
  const t = texts(svg).find((x) => x.body === label && /\by="/.test(x.attrs));
  return Number(t!.attrs.match(/\by="([\d.]+)"/)![1]);
}

function tickGaps(svg: string, side: 'left' | 'right'): number[] {
  const ys = texts(svg)
    .filter(
      (t) =>
        t.attrs.includes('dgmo-tick') &&
        t.attrs.includes(`data-axis-side="${side}"`)
    )
    .map((t) => Number(t.attrs.match(/\by="([\d.-]+)"/)![1]))
    .sort((a, b) => a - b);
  expect(ys.length).toBeGreaterThan(1);
  return ys.slice(1).map((y, i) => y - ys[i]!);
}

describe('combo charts at card size (#2320)', () => {
  for (const [name, src, title] of [
    ['bar', BAR, 'Ship'],
    ['line', LINE, 'Port of Call'],
  ] as const) {
    it(`${name}: the x-axis title sits below the rotated names`, async () => {
      const svg = await render(src);
      // The title's cap height (~10px) clears the lowest name's ink.
      expect(titleY(svg, title) - 10).toBeGreaterThan(rotatedFoot(svg));
    });

    it(`${name}: value ticks keep MIN_TICK_GAP on both axes`, async () => {
      const svg = await render(src);
      for (const side of ['left', 'right'] as const)
        for (const g of tickGaps(svg, side))
          expect(g).toBeGreaterThanOrEqual(MIN_TICK_GAP);
    });
  }

  it('line: a long y-axis title breaks onto two lines, not `…`', async () => {
    const svg = await render(LINE);
    const t = texts(svg).find((x) => x.body.includes('Doubloons'))!;
    expect(t.body).not.toContain('…');
    const lines = [...t.body.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(
      (m) => m[1]
    );
    expect(lines.join(' ')).toBe('Doubloons (thousands)');
  });
});
