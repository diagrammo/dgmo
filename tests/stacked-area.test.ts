// Stacked area (`line` + `stack`) and `stack 100%` on bar and line (#1846).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { shareText, stackSpans, toShares } from '../src/utils/stack-share';

const AREA = `line Stores in the hold
stack
  Rum
  Powder
  Salt pork

Jan 120 60 20
Feb 140 70 30
Mar 160 80 40`;

const AREA_100 = AREA.replace('stack\n', 'stack 100%\n');
const BAR_100 = AREA_100.replace('line ', 'bar ');

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string) {
  host.innerHTML = await renderDataChartD3(src, 'light');
  return host.querySelector('svg')!;
}
const errors = (src: string) =>
  parseChart(src).diagnostics.filter((d) => d.severity === 'error');
const n = (el: Element, a: string) => parseFloat(el.getAttribute(a)!);

describe('stack-share helpers', () => {
  it('shares add up to 100 and spans accumulate', () => {
    expect(toShares([1, 1, 2])).toEqual([25, 25, 50]);
    expect(toShares([0, 0])).toEqual([0, 0]);
    expect(stackSpans([2, 3, 5])).toEqual([
      [0, 2],
      [2, 5],
      [5, 10],
    ]);
    expect(shareText(46.2)).toBe('46%');
    expect(shareText(4.25)).toBe('4.3%');
  });
});

describe('stacked area parsing', () => {
  it('`stack` on a line chart is valid and draws as a stack', () => {
    const p = parseChart(AREA);
    expect(p.barLayout).toBe('stack');
    expect(p.seriesNames).toEqual(['Rum', 'Powder', 'Salt pork']);
    expect(p.diagnostics).toEqual([]);
  });

  it('`stack 100%` is a mode, not an inline series, on line and bar', () => {
    for (const src of [AREA_100, BAR_100]) {
      const p = parseChart(src);
      expect(p.stackPercent).toBe(true);
      expect(p.seriesNames).toEqual(['Rum', 'Powder', 'Salt pork']);
      expect(errors(src)).toEqual([]);
    }
  });

  it('`group 100%` is an error', () => {
    const e = errors(BAR_100.replace('stack 100%', 'group 100%'));
    expect(e[0]?.message).toMatch(/group 100%/);
  });

  it('`stack` and `series` together on a line chart is an error', () => {
    const e = errors(AREA.replace('stack\n', 'series\n  A\n  B\n  C\nstack\n'));
    expect(e.some((d) => /not both/.test(d.message))).toBe(true);
  });

  it('`y-right-axis` is an error on a stacked area', () => {
    const e = errors(`${AREA}\ny-right-axis Other`);
    expect(e.some((d) => /y-right-axis/.test(d.message))).toBe(true);
  });

  it('a negative value in a stacked area is E_VALUE_NEGATIVE naming row and series', () => {
    const p = parseChart(AREA.replace('Feb 140 70 30', 'Feb 140 -70 30'));
    const e = p.diagnostics.filter((d) => d.severity === 'error');
    expect(e).toHaveLength(1);
    expect(e[0]!.code).toBe('E_VALUE_NEGATIVE');
    expect(e[0]!.message).toContain('Feb · Powder');
    expect(e[0]!.line).toBe(8);
    expect(p.data.map((d) => d.label)).toEqual(['Jan', 'Mar']);
  });

  it('a negative value in `stack 100%` bar is an error; plain stacked bar keeps it', () => {
    const neg = (src: string) => src.replace('Feb 140 70 30', 'Feb 140 -70 30');
    expect(errors(neg(BAR_100))[0]?.code).toBe('E_VALUE_NEGATIVE');
    expect(errors(neg(BAR_100.replace('stack 100%', 'stack')))).toEqual([]);
  });

  it('a stacked area refuses a log scale; `stack 100%` ignores axis directives', () => {
    const log = parseChart(`${AREA}\ny-axis log`);
    expect(log.axes?.y?.scale).toBeUndefined();
    expect(log.diagnostics.some((d) => /stacked area/.test(d.message))).toBe(
      true
    );
    const fixed = parseChart(`${AREA_100}\ny-axis ..50`);
    expect(fixed.axes?.y).toBeUndefined();
    expect(fixed.diagnostics.some((d) => /0–100%/.test(d.message))).toBe(true);
  });

  it('`group` on a line chart still warns', () => {
    const p = parseChart(AREA.replace('stack\n', 'group\n'));
    expect(p.diagnostics.some((d) => /bar layout header/.test(d.message))).toBe(
      true
    );
  });
});

describe('stacked area rendering', () => {
  it('each band sits on the one below; top edge is the total', async () => {
    const svg = await draw(AREA);
    const areas = [...svg.querySelectorAll('.dgmo-series-area')];
    expect(areas).toHaveLength(3);
    const pts = [...svg.querySelectorAll('.dgmo-pt')];
    const at = (series: number, x: number) =>
      pts.find(
        (p) =>
          p.getAttribute('data-series-index') === String(series) &&
          p.getAttribute('data-x-index') === String(x)
      )!;
    // Higher in the stack means a smaller y.
    expect(n(at(1, 0), 'cy')).toBeLessThan(n(at(0, 0), 'cy'));
    expect(n(at(2, 0), 'cy')).toBeLessThan(n(at(1, 0), 'cy'));
    // Hover carries the raw value and its share: 60 of 200 = 30%.
    expect(at(1, 0).getAttribute('data-value')).toBe('60 · 30%');
    // No point values are printed on a stacked area.
    expect(svg.querySelectorAll('.dgmo-ptlabel')).toHaveLength(0);
  });

  it('`stack 100%` line: every top edge meets at 100% and ticks read %', async () => {
    const svg = await draw(AREA_100);
    const tops = [...svg.querySelectorAll('.dgmo-pt')]
      .filter((p) => p.getAttribute('data-series-index') === '2')
      .map((p) => n(p, 'cy'));
    expect(new Set(tops).size).toBe(1);
    const ticks = [...svg.querySelectorAll('.dgmo-tick')].map(
      (t) => t.textContent
    );
    expect(ticks).toContain('100%');
    expect(ticks).toContain('0%');
  });

  it('`stack 100%` bar: segments print shares, bars share one height', async () => {
    const svg = await draw(BAR_100);
    const rects = [...svg.querySelectorAll('rect[data-line-number]')];
    const tops = ['Jan', 'Feb', 'Mar'].map((c) =>
      Math.min(
        ...rects
          .filter((r) => r.getAttribute('data-name')!.startsWith(`${c} · `))
          .map((r) => n(r, 'y'))
      )
    );
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(0.01);
    const jan = rects.find((r) => r.getAttribute('data-name') === 'Jan · Rum')!;
    expect(jan.getAttribute('data-value')).toBe('120 · 60%');
    const ticks = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(ticks).toContain('100%');
    expect(ticks).toContain('60%');
  });
});

describe('gallery fixtures', () => {
  it('the stacked fixtures parse with no diagnostics', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['line-stack', 'line-stack-100', 'bar-stack-100']) {
      const src = readFileSync(`gallery/fixtures/${f}.dgmo`, 'utf8');
      expect(parseChart(src).diagnostics, f).toEqual([]);
    }
  });
});
