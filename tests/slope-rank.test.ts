// `rank` on slope (#1854): the values are positions as written (1 = first),
// drawn as a bump chart — one row per position with 1 at the top, a
// horizontal-tangent S-curve per segment, each point a dot showing its
// position, the name at both ends, and tied items side by side on their row.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '../src/render';
import { parseSlope } from '../src/slope/parser';
import { rankTieOffsets } from '../src/slope/renderer';
import '../src/palettes/index';

const BUMP = `slope League position
rank

period W1 W2 W3

Arsenal 3 1 1
City 1 2 2
Liverpool 2 3 2
`;

describe('rank — parser', () => {
  it('sets the flag and keeps the positions as written', () => {
    const r = parseSlope(BUMP);
    expect(r.rank).toBe(true);
    expect(r.error).toBeNull();
    expect(r.diagnostics).toEqual([]);
    expect(r.data.map((d) => d.values)).toEqual([
      [3, 1, 1],
      [1, 2, 2],
      [2, 3, 2],
    ]);
  });

  it('is off on a plain slope', () => {
    expect(parseSlope(BUMP.replace('rank\n', '')).rank).toBeUndefined();
  });

  it.each([
    ['0', 'W2', '0'],
    ['-1', 'W2', '-1'],
    ['1.5', 'W2', '1.5'],
  ])(
    'refuses a position of %s, naming the row and the period',
    (bad, period, shown) => {
      const r = parseSlope(BUMP.replace('City 1 2 2', `City 1 ${bad} 2`));
      const errs = r.diagnostics.filter((d) => d.severity === 'error');
      expect(errs).toHaveLength(1);
      expect(errs[0]!.line).toBe(7);
      expect(errs[0]!.message).toContain('"City"');
      expect(errs[0]!.message).toContain(`position ${shown} in ${period}`);
      expect(r.data.map((d) => d.label)).toEqual(['Arsenal', 'Liverpool']);
    }
  );

  it('does not convert values to ranks — a plain slope takes 1.5', () => {
    const r = parseSlope(
      BUMP.replace('rank\n', '').replace('City 1 2 2', 'City 1 1.5 2')
    );
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('warns that y-axis does nothing under rank', () => {
    const r = parseSlope(BUMP.replace('rank\n', 'rank\ny-axis 0..10\n'));
    expect(
      r.diagnostics.some(
        (d) =>
          d.severity === 'warning' && /y-axis has no effect/.test(d.message)
      )
    ).toBe(true);
  });
});

describe('rankTieOffsets', () => {
  it('is zero for every lone item', () => {
    expect(rankTieOffsets([3, 1, 2])).toEqual([0, 0, 0]);
  });
  it('centres tied items side by side on their period', () => {
    expect(rankTieOffsets([1, 2, 2])).toEqual([0, -0.5, 0.5]);
    expect(rankTieOffsets([4, 4, 4, 1])).toEqual([-1, 0, 1, 0]);
  });
});

describe('rank — renderer', () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  async function series(src: string): Promise<Map<string, Element>> {
    host.innerHTML = (await render(src, { theme: 'light' })).svg;
    const out = new Map<string, Element>();
    for (const g of host.querySelectorAll('g.slope-series'))
      out.set(g.getAttribute('data-series-name')!, g);
    return out;
  }
  const dots = (g: Element) =>
    [...g.querySelectorAll('circle')].map((c) => ({
      x: Number(c.getAttribute('cx')),
      y: Number(c.getAttribute('cy')),
    }));
  const texts = (g: Element) =>
    [...g.querySelectorAll('text')].map((t) => t.textContent);

  it('puts position 1 at the top, one evenly spaced row per position', async () => {
    const s = await series(BUMP);
    // W1: City 1, Liverpool 2, Arsenal 3.
    const y1 = dots(s.get('City')!)[0]!.y;
    const y2 = dots(s.get('Liverpool')!)[0]!.y;
    const y3 = dots(s.get('Arsenal')!)[0]!.y;
    expect(y1).toBeLessThan(y2);
    expect(y2).toBeLessThan(y3);
    expect(y3 - y2).toBeCloseTo(y2 - y1, 6);
  });

  it('draws each segment as a curve, a plain slope as straight lines', async () => {
    const d = (g: Element) => g.querySelector('path')!.getAttribute('d')!;
    const ranked = await series(BUMP);
    expect(d(ranked.get('Arsenal')!)).toMatch(/C/);
    const plain = await series(BUMP.replace('rank\n', ''));
    expect(d(plain.get('Arsenal')!)).not.toMatch(/C/);
  });

  it('shows the position in every dot and the name at both ends', async () => {
    const t = texts((await series(BUMP)).get('Arsenal')!);
    expect(t.filter((x) => x === 'Arsenal')).toHaveLength(2);
    expect(t).toEqual(expect.arrayContaining(['3', '1', '1']));
    // No value is printed beside the name.
    expect(t.some((x) => x?.includes('—'))).toBe(false);
  });

  it('sets tied items side by side on their shared row', async () => {
    const s = await series(BUMP);
    // W3: City 2 and Liverpool 2.
    const c = dots(s.get('City')!)[2]!;
    const l = dots(s.get('Liverpool')!)[2]!;
    expect(c.y).toBeCloseTo(l.y, 6);
    expect(Math.abs(c.x - l.x)).toBeGreaterThan(0);
  });
});
