// `fill-between A B [ahead] [behind]` on line (#1997): shade the gap between
// two series, one colour where A is above B and another where B is above A.
// One test per rule in the issue body.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import { fillBetweenRuns } from '../src/charts-d3/line';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string): Promise<HTMLDivElement> {
  host.innerHTML = await renderDataChartD3(src, 'light', palette);
  return host;
}

// Actual leads Plan in Jan–Feb, trails in Mar–Apr.
const SURPLUS = `line Haul vs plan
series
  Actual blue
  Plan gray
fill-between Actual Plan

Jan 12 10
Feb 14 11
Mar 9 12
Apr 8 13`;

const errors = (src: string) =>
  parseChart(src, palette).diagnostics.filter((d) => d.severity === 'error');

describe('fill-between parse', () => {
  it('defaults to green ahead and red behind', () => {
    expect(parseChart(SURPLUS, palette).fillBetween).toEqual([
      { a: 0, b: 1, ahead: 'green', behind: 'red', lineNumber: 5 },
    ]);
  });

  it('reads palette colour names, and one colour alone sets ahead', () => {
    const two = parseChart(
      SURPLUS.replace('Plan\n\n', 'Plan teal purple\n\n'),
      palette
    );
    expect(two.fillBetween?.[0]).toMatchObject({
      ahead: 'teal',
      behind: 'purple',
    });
    const one = parseChart(
      SURPLUS.replace('Plan\n\n', 'Plan blue\n\n'),
      palette
    );
    expect(one.fillBetween?.[0]).toMatchObject({
      ahead: 'blue',
      behind: 'red',
    });
  });

  it('errors on a name that is not a declared series', () => {
    const errs = errors(
      SURPLUS.replace('fill-between Actual Plan', 'fill-between Actual Budget')
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]!.line).toBe(5);
    expect(errs[0]!.message).toContain('"Budget" is not a declared series');
  });

  it('allows several fill-between lines, kept in declared order', () => {
    const c = parseChart(
      `line X
series
  A
  B
  C
fill-between A B
fill-between B C orange blue
J 1 2 3
K 3 2 1`,
      palette
    );
    expect(c.fillBetween?.map((f) => [f.a, f.b])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('is an error together with fill', () => {
    const src = SURPLUS.replace('fill-between', 'fill\nfill-between');
    const errs = errors(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('`fill` and `fill-between`');
    expect(parseChart(src, palette).fill).toBeUndefined();
  });
});

describe('fill-between render', () => {
  it('fills ahead and behind in their colours, beneath the lines', async () => {
    const h = await draw(SURPLUS);
    const ahead = h.querySelector('.dgmo-fill-between-ahead')!;
    const behind = h.querySelector('.dgmo-fill-between-behind')!;
    expect(ahead.getAttribute('fill')).toBe(palette.colors.green);
    expect(behind.getAttribute('fill')).toBe(palette.colors.red);
    // Drawn before (beneath) every series line.
    const all = [...h.querySelectorAll('.dgmo-fill-between, g.dgmo-series')];
    expect(all[0]!.classList.contains('dgmo-fill-between')).toBe(true);
  });

  it('switches colour at the interpolated crossing point', () => {
    // a above b (smaller y) at x=0, below at x=10; equal at x=4.
    const runs = fillBetweenRuns([
      { x: 0, a: 10, b: 14 },
      { x: 10, a: 25, b: 14 },
    ]);
    expect(runs.map((r) => r.ahead)).toEqual([true, false]);
    // The two runs meet at the crossing: b - a goes 4 → -11, zero at t = 4/15.
    const cross = runs[0]!.points[1]!;
    expect(cross[0]).toBeCloseTo((10 * 4) / 15, 6);
    expect(runs[1]!.points[0]).toEqual(cross);
  });

  it('breaks the fill at a row missing A or B', () => {
    const runs = fillBetweenRuns([
      { x: 0, a: 10, b: 14 },
      { x: 10, a: 11, b: 14 },
      { x: 20, a: NaN, b: 14 },
      { x: 30, a: 10, b: 14 },
      { x: 40, a: 11, b: 14 },
    ]);
    expect(runs).toHaveLength(2);
    // No fill spans the gap row.
    for (const r of runs)
      expect(r.points.some(([x]) => x > 10 && x < 30)).toBe(false);
  });

  it('follows the stepped shape under step and step-before', () => {
    const rows = [
      { x: 0, a: 10, b: 14 },
      { x: 10, a: 12, b: 14 },
    ];
    const xs = (step?: 'after' | 'before') =>
      fillBetweenRuns(rows, step)[0]!.points.map(([x, y]) => [x, y]);
    // step: A holds 10 to x=10, then jumps to 12.
    expect(xs('after').slice(0, 3)).toEqual([
      [0, 10],
      [10, 10],
      [10, 12],
    ]);
    // step-before: A reaches 12 at x=0, holds to x=10.
    expect(xs('before').slice(0, 3)).toEqual([
      [0, 10],
      [0, 12],
      [10, 12],
    ]);
  });

  it('never extends the axis range, with or without no-auto-y', async () => {
    for (const extra of ['', 'no-auto-y\n']) {
      const ticks = async (src: string) =>
        [...(await draw(src)).querySelectorAll('text.dgmo-tick')].map(
          (t) => t.textContent
        );
      const without = await ticks(
        SURPLUS.replace('fill-between Actual Plan\n', extra)
      );
      const withFill = await ticks(
        SURPLUS.replace('fill-between', `${extra}fill-between`)
      );
      expect(withFill).toEqual(without);
    }
  });

  it('draws each fill-between in declared order', async () => {
    const h = await draw(`line X
series
  A
  B
  C
fill-between A B
fill-between B C orange blue
J 1 2 3
K 3 2 1`);
    const lines = [...h.querySelectorAll('g.dgmo-fill-between')].map((g) =>
      g.getAttribute('data-line-number')
    );
    expect(lines).toEqual(['6', '7']);
  });
});
