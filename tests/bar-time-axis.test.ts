// Bars on a to-scale time axis (#2208). A vertical bar chart whose every row
// is a time label places each bar at its time, not in an even slot.
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;
const render = (src: string) => renderDataChartD3(src, 'light', palette);

interface Bar {
  x: number;
  w: number;
  name: string;
}

/** Every bar rect, in drawing order. */
function bars(svg: string): Bar[] {
  const re =
    /<rect x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)"[^>]*data-name="([^"]*)"/g;
  const out: Bar[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)))
    out.push({ x: Number(m[1]), w: Number(m[2]), name: m[3]! });
  return out;
}
const centres = (svg: string) => bars(svg).map((b) => b.x + b.w / 2);
const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]!);
const tickLabels = (svg: string) =>
  [...svg.matchAll(/class="dgmo-tick"[^>]*>([^<]*)</g)].map((m) => m[1]!);
/** Text of every <text> element. */
const texts = (svg: string) =>
  [...svg.matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1]!);

const MONTHS = `bar Sales
2024-01 5
2024-02 7
2024-06 3`;

// 24-minute readings with a 6 h hole between 02:00 and 08:00.
const READINGS = `bar Load
00:00 4
00:24 5
00:48 6
01:12 5
01:36 7
02:00 6
08:00 3
08:24 4
08:48 5
09:12 6`;

describe('bar time axis (#2208)', () => {
  it('spaces bars by time, not evenly', async () => {
    const [a, b] = gaps(centres(await render(MONTHS)));
    // Jan→Feb is one month, Feb→Jun four.
    expect(b! / a!).toBeGreaterThan(3.5);
    expect(b! / a!).toBeLessThan(4.5);
  });

  it('leaves empty space for a missing period', async () => {
    const g = gaps(centres(await render(READINGS)));
    const sorted = [...g].sort((x, y) => x - y);
    const median = sorted[sorted.length >> 1]!;
    expect(g[5]!).toBeGreaterThan(10 * median);
  });

  it('keeps every bar narrower than the smallest interval', async () => {
    const svg = await render(READINGS);
    const smallest = Math.min(...gaps(centres(svg)));
    for (const b of bars(svg)) expect(b.w).toBeLessThanOrEqual(smallest);
    // Neighbours never overlap.
    const bs = bars(svg);
    for (let i = 1; i < bs.length; i++)
      expect(bs[i]!.x).toBeGreaterThan(bs[i - 1]!.x + bs[i - 1]!.w);
  });

  it('splits the width among grouped bars', async () => {
    const svg = await render(`bar Ships
group
  Gold
  Silver

2024-01 5 3
2024-02 7 4
2024-04 3 2`);
    const bs = bars(svg);
    expect(bs).toHaveLength(6);
    const jan = bs.filter((b) => b.name.startsWith('2024-01'));
    const feb = bs.filter((b) => b.name.startsWith('2024-02'));
    const span = (g: Bar[]) =>
      Math.max(...g.map((b) => b.x + b.w)) - Math.min(...g.map((b) => b.x));
    const febAt = Math.min(...feb.map((b) => b.x));
    expect(jan).toHaveLength(2);
    // The pair shares one bar's width, and stays clear of February.
    expect(span(jan)).toBeLessThan(febAt - Math.min(...jan.map((b) => b.x)));
    expect(Math.max(...jan.map((b) => b.x + b.w))).toBeLessThan(febAt);
  });

  it('draws time ticks instead of row labels', async () => {
    const svg = await render(READINGS);
    const ticks = tickLabels(svg);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => /^\d{2}:\d{2}$|^Day \d+$/.test(t))).toBe(true);
    // The row label 00:24 is not a round tick, so it is not drawn.
    expect(texts(svg)).not.toContain('00:24');
  });

  it('keeps category labels on the even axis', async () => {
    const svg = await render(`bar Plunder
Tortuga 30
Nassau 80
Havana 50`);
    const g = gaps(centres(svg));
    expect(Math.abs(g[0]! - g[1]!)).toBeLessThan(0.01);
    expect(tickLabels(svg)).toEqual(['Tortuga', 'Nassau', 'Havana']);
  });

  it('keeps a horizontal bar chart categorical', async () => {
    const svg = await render(`bar Sales
orientation-horizontal
2024-01 5
2024-02 7
2024-06 3`);
    const t = texts(svg);
    expect(t).toContain('2024-06');
    expect(t).not.toContain('Jun');
  });
});
