// One placer for every overlay label (#2217): mean, median, target, trend,
// moving-average and the extremes (on by default, #2213). None prints over
// another label, a point or a line; a crowded label slides along its line or
// takes a leader into open space; an extreme with no room hands its value
// back to the point.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';
import { overlayPlacement, pickSpot, type Spot } from '../src/overlays/place';
import { lintSvg } from './stress/lint';

const palette = getPalette('nord').light;
const DENSE = readFileSync('gallery/fixtures/line-dense.dgmo', 'utf8');

const texts = (svg: string, cls: string) =>
  [
    ...svg.matchAll(
      new RegExp(`<text[^>]*class="[^"]*${cls}[^"]*"[^>]*>([^<]*)</text>`, 'g')
    ),
  ].map((m) => m[1]!);

describe('overlay labels — placement (#2217)', () => {
  it('a dense two-series line with means draws both labels, over nothing', async () => {
    const src = DENSE.replace('\nseries', '\nmean\nseries');
    const svg = await renderDataChartD3(src, 'light', palette, { width: 900 });
    expect(lintSvg(svg).filter((f) => f.rule === 'text-overlap')).toEqual([]);
    const means = texts(svg, 'dgmo-overlay-mean-label');
    expect(means).toHaveLength(2);
    for (const t of means) expect(t).toMatch(/mean \d/);
  });

  it('every gallery line and overlay chart prints no text over other text', async () => {
    const files = readdirSync('gallery/fixtures').filter((f) =>
      /^(line|overlay)-.*\.dgmo$/.test(f)
    );
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const svg = await renderDataChartD3(
        readFileSync(`gallery/fixtures/${f}`, 'utf8'),
        'light',
        palette
      );
      expect(
        lintSvg(svg).filter((x) => x.rule === 'text-overlap'),
        f
      ).toEqual([]);
    }
  });

  it('marks the high and low of a line by default, and no-extremes hides them', async () => {
    const src = 'line X\n\nA 3\nB 9\nC 1\nD 5';
    const on = await renderDataChartD3(src, 'light', palette);
    expect(texts(on, 'dgmo-overlay-extremes-label').sort()).toEqual(['1', '9']);
    const off = await renderDataChartD3(
      src.replace('line X', 'line X\nno-extremes'),
      'light',
      palette
    );
    expect(texts(off, 'dgmo-overlay-extremes-label')).toEqual([]);
  });
});

describe('line values by default (#2220)', () => {
  // Plain point values carry no class; the extremes carry their own.
  const plain = (svg: string) =>
    [
      ...svg.matchAll(
        /<text(?![^>]*class=)[^>]*font-size="12"[^>]*>(.*?)<\/text>/g
      ),
    ].map((m) => m[1]!.replace(/<[^>]+>/g, ''));
  const SRC = 'line X\n\nA 3\nB 9\nC 1\nD 4\nE 5';

  it('prints the high, the low and the latest value, not every point', async () => {
    const svg = await renderDataChartD3(SRC, 'light', palette);
    expect(texts(svg, 'dgmo-overlay-extremes-label').sort()).toEqual([
      '1',
      '9',
    ]);
    expect(plain(svg)).toContain('5');
    for (const v of ['3', '4']) expect(plain(svg)).not.toContain(v);
  });

  it('values prints every point', async () => {
    const svg = await renderDataChartD3(
      SRC.replace('line X', 'line X\nvalues'),
      'light',
      palette
    );
    for (const v of ['3', '4', '5']) expect(plain(svg)).toContain(v);
  });
});

describe('pickSpot', () => {
  const bounds = { left: 0, top: 0, right: 200, bottom: 200 };
  const spot = (x: number, cost: number, leader = false): Spot => ({
    x,
    baseline: 50,
    anchor: 'start',
    rect: { x, y: 40, w: 20, h: 10 },
    cost,
    ...(leader && {
      leader: [x, 80, x, 50] as [number, number, number, number],
    }),
  });

  it('takes the cheapest clear spot', () => {
    const p = overlayPlacement({ markers: [{ cx: 10, cy: 45, r: 3 }] });
    expect(pickSpot(p, [spot(0, 0), spot(60, 1)], bounds)?.x).toBe(60);
  });

  it('prefers a roomy hug to a tight one, but not a leader to a hug', () => {
    // A mark just past the first spot's edge: clear, but tight.
    const tight = overlayPlacement({ markers: [{ cx: 22, cy: 45, r: 1 }] });
    expect(pickSpot(tight, [spot(0, 0), spot(100, 1)], bounds)?.x).toBe(100);
    expect(pickSpot(tight, [spot(0, 0), spot(100, 1, true)], bounds)?.x).toBe(
      0
    );
  });

  it('returns null when every spot is blocked or out of bounds', () => {
    const p = overlayPlacement({ reserved: [{ x: 0, y: 0, w: 200, h: 200 }] });
    expect(pickSpot(p, [spot(0, 0), spot(300, 1)], bounds)).toBeNull();
  });
});
