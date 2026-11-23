// Statistics overlays (#1954). Expected numbers are worked by hand from the
// ecosystem docs mockup 2026-11-12-statistics-overlays, never re-derived
// here with the code under test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';
import {
  extremes,
  linearFit,
  mean,
  median,
  movingAverage,
  paretoCumulative,
  reachesTarget,
  roundStat,
} from '../src/overlays/compute';
import { clipToDomain, trendUnit } from '../src/overlays/draw';

/** New sign-ups, 2026 (mockup picture 1). Sum 5295 over 12 months. */
const SIGNUPS = [310, 295, 340, 1180, 360, 355, 390, 370, 410, 405, 430, 450];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const rows = (vals: number[]) =>
  vals.map((v, i) => `${MONTHS[i]} ${v}`).join('\n');

const LINE = `line New sign-ups, 2026\nno-extremes\nmean\nmedian\n\n${rows(SIGNUPS)}`;
const SALES = `bar Q3 sales by region (% of plan)
target 100

North 118
South 86
East 104
West 72
Central 97
Online 131`;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());
async function draw(src: string): Promise<SVGSVGElement> {
  host.innerHTML = await renderDataChartD3(src, 'light');
  return host.querySelector('svg')!;
}
const texts = (svg: Element, sel: string) =>
  [...svg.querySelectorAll(sel)].map((t) => t.textContent);

describe('overlay numbers', () => {
  it('mean of the sign-ups is 441.25', () => {
    expect(mean(SIGNUPS)).toBe(441.25);
  });
  it('median of the sign-ups is 380 (370 and 390 in the middle)', () => {
    expect(median(SIGNUPS)).toBe(380);
  });
  it('odd count takes the middle value; missing values are skipped', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(mean([2, NaN, 4])).toBe(3);
    expect(mean([])).toBeNaN();
  });
  it('two-series means from the mockup (EU 56.875, US 35.625)', () => {
    expect(mean([54, 56, 52, 58, 60, 57, 61, 57])).toBe(56.875);
    expect(mean([38, 36, 40, 37, 34, 36, 32, 32])).toBe(35.625);
  });
  it('labels round to whole above 100, else 3 significant figures', () => {
    expect(roundStat(441.25)).toBe(441);
    expect(roundStat(56.875)).toBe(56.9);
    expect(roundStat(35.625)).toBe(35.6);
  });
  it('target is reached at or over it, or at or under it with below', () => {
    expect(reachesTarget(100, 100)).toBe(true);
    expect(reachesTarget(97, 100)).toBe(false);
    expect(reachesTarget(100, 100, true)).toBe(true);
    expect(reachesTarget(104, 100, true)).toBe(false);
  });
});

describe('overlay parsing', () => {
  it('reads mean, median and target', () => {
    const p = parseChart(`${LINE}\ntarget 500 below`);
    expect(p.diagnostics).toEqual([]);
    expect(p.overlays?.map((o) => o.kind)).toEqual([
      'mean',
      'median',
      'target',
    ]);
    expect(p.overlays?.[2]).toMatchObject({ value: 500, below: true });
    expect(p.data).toHaveLength(12);
  });
  it('a capitalised name stays a data row', () => {
    const p = parseChart(`bar X\nTarget 120\nMean 40`);
    expect(p.overlays).toBeUndefined();
    expect(p.data.map((d) => d.label)).toEqual(['Target', 'Mean']);
  });
  it('a bare overlay word followed by a number is a data row', () => {
    const p = parseChart(`bar X\nmean 40\nB 2`);
    expect(p.overlays).toBeUndefined();
    expect(p.data[0]).toMatchObject({ label: 'mean', value: 40 });
  });
  it('target without a number is an error and is ignored', () => {
    const p = parseChart(`bar X\ntarget lots\nA 1`);
    expect(p.overlays).toBeUndefined();
    expect(p.diagnostics.map((d) => d.code)).toEqual(['E_OVERLAY_BAD_N']);
    expect(p.data).toHaveLength(1);
  });
  it('target with a stray word after the number is an error', () => {
    const p = parseChart(`bar X\ntarget 100 above\nA 1`);
    expect(p.diagnostics.map((d) => d.code)).toEqual(['E_OVERLAY_BAD_N']);
  });
  it('target takes a trailing colour, with or without below', () => {
    const a = parseChart(`bar X\ntarget 100 green\nA 1`);
    expect(a.overlays).toEqual([
      { kind: 'target', value: 100, color: 'green', lineNumber: 2 },
    ]);
    const b = parseChart(`bar X\ntarget 5 below Red\nA 1`);
    expect(b.overlays).toEqual([
      { kind: 'target', value: 5, below: true, color: 'red', lineNumber: 2 },
    ]);
    expect(a.diagnostics).toEqual([]);
  });
  it('target with an unknown colour word is an error', () => {
    const p = parseChart(`bar X\ntarget 100 teal-ish\nA 1`);
    expect(p.diagnostics.map((d) => d.code)).toEqual(['E_OVERLAY_BAD_N']);
  });
  it('average is not a synonym for mean', () => {
    const p = parseChart(`line X\naverage\nA 1\nB 2`);
    expect(p.overlays).toBeUndefined();
    expect(p.diagnostics).toHaveLength(1);
    expect(p.diagnostics[0]!.code).toBe('W_OVERLAY_UNKNOWN');
    expect(p.diagnostics[0]!.message).toContain("Did you mean 'mean'?");
  });
  it('mode is not offered', () => {
    const p = parseChart(`line X\nmode\nA 1\nB 2`);
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_OVERLAY_UNKNOWN']);
  });
  it('a typo of an overlay name is an unknown overlay', () => {
    const p = parseChart(`line X\nmedain\nA 1\nB 2`);
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_OVERLAY_UNKNOWN']);
    expect(p.diagnostics[0]!.message).toContain("'median'");
  });
  it('an overlay on pie warns and is dropped', () => {
    const p = parseChart(`pie X\nmean\nA 1\nB 2`);
    expect(p.overlays).toBeUndefined();
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_OVERLAY_UNSUPPORTED']);
    expect(p.diagnostics[0]!.message).toContain('line, bar and histogram');
  });
  it('an overlay on a stacked bar warns and is dropped', () => {
    const p = parseChart(`bar X\nmean\nstack\n  A\n  B\n\nQ1 1 2\nQ2 3 4`);
    expect(p.overlays).toBeUndefined();
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_OVERLAY_UNSUPPORTED']);
  });
  it('a repeated target replaces the earlier one', () => {
    const p = parseChart(`bar X\ntarget 5\ntarget 7\nA 1`);
    expect(p.overlays).toEqual([{ kind: 'target', value: 7, lineNumber: 3 }]);
  });
});

describe('overlay rendering', () => {
  it('draws mean and median lines labelled with their values', async () => {
    const svg = await draw(LINE);
    expect(svg.querySelectorAll('g.dgmo-overlay-mean line')).toHaveLength(1);
    expect(svg.querySelectorAll('g.dgmo-overlay-median line')).toHaveLength(1);
    expect(texts(svg, '.dgmo-overlay-label')).toEqual([
      'mean 441',
      'median 380',
    ]);
  });
  it('mean sits above median, both behind the series', async () => {
    const svg = await draw(LINE);
    const y = (sel: string) =>
      Number(svg.querySelector(sel)!.getAttribute('y1'));
    expect(y('g.dgmo-overlay-mean line')).toBeLessThan(
      y('g.dgmo-overlay-median line')
    );
    const all = [...svg.querySelectorAll('g.dgmo-overlay, g.dgmo-series')];
    expect(all[0]!.classList.contains('dgmo-overlay')).toBe(true);
  });
  it('a two-series line gets one mean per series in its colour', async () => {
    const svg = await draw(`line Net promoter score
no-extremes
mean
series
  EU blue
  US orange

Q1 54 38
Q2 56 36
Q3 52 40
Q4 58 37
Q5 60 34
Q6 57 36
Q7 61 32
Q8 57 32`);
    expect(texts(svg, '.dgmo-overlay-label')).toEqual([
      'EU mean 56.9',
      'US mean 35.6',
    ]);
    const strokes = [...svg.querySelectorAll('g.dgmo-overlay-mean line')].map(
      (l) => l.getAttribute('stroke')
    );
    expect(new Set(strokes).size).toBe(2);
  });
  it('target lights the bars that reach it and greys the rest', async () => {
    const svg = await draw(SALES);
    expect(texts(svg, '.dgmo-overlay-label')).toEqual(['target 100']);
    const fill = (name: string) =>
      [...svg.querySelectorAll('rect.dgmo-datum')]
        .find((r) => r.getAttribute('data-name') === name)!
        .getAttribute('fill');
    const lit = ['North', 'East', 'Online'].map(fill);
    const grey = ['South', 'West', 'Central'].map(fill);
    expect(new Set(lit).size).toBe(1);
    expect(new Set(grey).size).toBe(1);
    expect(lit[0]).not.toBe(grey[0]);
  });
  it('target below flips which bars are lit', async () => {
    const svg = await draw(SALES.replace('target 100', 'target 100 below'));
    const fill = (name: string) =>
      [...svg.querySelectorAll('rect.dgmo-datum')]
        .find((r) => r.getAttribute('data-name') === name)!
        .getAttribute('fill');
    expect(fill('South')).toBe(fill('West'));
    expect(fill('South')).not.toBe(fill('North'));
  });
  it('a coloured target paints lit bars, the line and its label', async () => {
    const plain = await draw(SALES);
    const svg = await draw(SALES.replace('target 100', 'target 100 green'));
    const fillOf = (s: Element, name: string) =>
      [...s.querySelectorAll('rect.dgmo-datum')]
        .find((r) => r.getAttribute('data-name') === name)!
        .getAttribute('fill');
    expect(fillOf(svg, 'North')).not.toBe(fillOf(plain, 'North'));
    expect(fillOf(svg, 'South')).toBe(fillOf(plain, 'South'));
    const line = svg.querySelector('g.dgmo-overlay-target line')!;
    const plainLine = plain.querySelector('g.dgmo-overlay-target line')!;
    expect(line.getAttribute('stroke')).not.toBe(
      plainLine.getAttribute('stroke')
    );
  });
  it('a coloured target on a line paints the points that reach it', async () => {
    const svg = await draw(`line X\ntarget 400 green\n\n${rows(SIGNUPS)}`);
    const pts = [...svg.querySelectorAll('circle.dgmo-pt')];
    const filled = pts.filter(
      (c) => c.getAttribute('fill') === c.getAttribute('stroke')
    );
    expect(filled.length).toBeGreaterThan(0);
    expect(new Set(filled.map((c) => c.getAttribute('stroke'))).size).toBe(1);
  });
  it('a target beyond the data widens the value axis to it', async () => {
    const svg = await draw(`bar X\ntarget 500\nA 100\nB 120`);
    const line = svg.querySelector('g.dgmo-overlay-target line')!;
    expect(line).not.toBeNull();
  });
  it('target on a line fills the points that reach it', async () => {
    const svg = await draw(`line X\ntarget 400\n\n${rows(SIGNUPS)}`);
    const pts = [...svg.querySelectorAll('circle.dgmo-pt')];
    const filled = pts.filter(
      (c) => c.getAttribute('fill') === c.getAttribute('stroke')
    );
    // Apr 1180, Sep 410, Oct 405, Nov 430, Dec 450.
    expect(filled.map((c) => c.getAttribute('data-x-label'))).toEqual([
      'Apr',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
  });
});

// Hand-worked: y = 2 4 5 4 5 at x = 0..4. x̄ = 2, ȳ = 4; Σdxdy = 6,
// Σdx² = 10, Σdy² = 6 → slope 0.6, intercept 2.8, R² = 36 / 60 = 0.6.
const WOBBLE = [2, 4, 5, 4, 5];

describe('trend numbers', () => {
  it('least squares on a hand-worked series', () => {
    const fit = linearFit([0, 1, 2, 3, 4], WOBBLE)!;
    expect(fit.slope).toBeCloseTo(0.6, 12);
    expect(fit.intercept).toBeCloseTo(2.8, 12);
    expect(fit.r2).toBeCloseTo(0.6, 12);
  });
  it('a straight line fits with R² 1', () => {
    const fit = linearFit([1, 2, 3, 4], [2, 4, 6, 8])!;
    expect(fit.slope).toBe(2);
    expect(fit.intercept).toBe(0);
    expect(fit.r2).toBe(1);
  });
  it('skips missing values; null below two points or one x', () => {
    expect(linearFit([0, 1, 2], [1, NaN, 3])!.slope).toBe(1);
    expect(linearFit([0], [1])).toBeNull();
    expect(linearFit([2, 2], [1, 3])).toBeNull();
  });
  it('a line is cut where it leaves the axis', () => {
    expect(
      clipToDomain(
        [
          { at: 0, v: -5 },
          { at: 10, v: 15 },
        ],
        [0, 10]
      )
    ).toEqual([
      { at: 2.5, v: 0 },
      { at: 7.5, v: 10 },
    ]);
  });
  it('slope unit comes from a one-word x-axis title', () => {
    expect(trendUnit('Week')).toBe('week');
    expect(trendUnit('Week of year')).toBe('step');
    expect(trendUnit(undefined)).toBe('step');
  });
});

describe('trend', () => {
  const LINE_TREND = `line Weekly active teams\ntrend\nno-extremes\n\n${WOBBLE.map((v, i) => `W${i + 1} ${v}`).join('\n')}`;
  it('parses on line, bar and scatter', () => {
    expect(parseChart(LINE_TREND).overlays).toEqual([
      { kind: 'trend', lineNumber: 2 },
    ]);
    expect(parseChart('bar X\ntrend\nA 1\nB 2').overlays).toHaveLength(1);
  });
  it('labels a line trend with its slope per step', async () => {
    const svg = await draw(LINE_TREND);
    expect(svg.querySelectorAll('g.dgmo-overlay-trend path')).toHaveLength(1);
    expect(texts(svg, '.dgmo-overlay-label')).toEqual(['trend +0.6/step']);
  });
  it('takes the slope unit from x-axis title', async () => {
    const svg = await draw(LINE_TREND.replace('trend', 'trend\nx-axis Week'));
    expect(texts(svg, '.dgmo-overlay-label')).toEqual(['trend +0.6/week']);
  });
  it('a falling bar trend carries its minus sign', async () => {
    const svg = await draw('bar X\ntrend\nA 5\nB 4\nC 3');
    expect(texts(svg, '.dgmo-overlay-label')).toEqual(['trend -1/step']);
  });
  it('the trend runs from the first row to the last', async () => {
    const svg = await draw(LINE_TREND);
    const d = svg
      .querySelector('g.dgmo-overlay-trend path')!
      .getAttribute('d')!;
    const pts = [...svg.querySelectorAll('circle.dgmo-pt')].map((c) =>
      Number(c.getAttribute('cx'))
    );
    const xs = [...d.matchAll(/[ML]([-\d.]+),/g)].map((m) => Number(m[1]));
    expect(xs[0]).toBeCloseTo(pts[0]!, 6);
    expect(xs.at(-1)).toBeCloseTo(pts.at(-1)!, 6);
  });
  it('scatter draws one line per category labelled with R²', async () => {
    const svg = await draw(`scatter Skill score vs training hours
trend

[Mentored] blue
  A 1 2
  B 2 4
  C 3 6
  D 4 8
[Self-taught] orange
  E 1 2
  F 2 4
  G 3 5
  H 4 4
  I 5 5`);
    expect(svg.querySelectorAll('g.dgmo-overlay-trend path')).toHaveLength(2);
    expect(texts(svg, '.dgmo-overlay-label')).toEqual([
      'Mentored R² 1.00',
      'Self-taught R² 0.60',
    ]);
  });
  it('one scatter group is labelled without a name', async () => {
    const svg = await draw(
      'scatter X\ntrend\nA 1 2\nB 2 4\nC 3 5\nD 4 4\nE 5 5'
    );
    expect(texts(svg, '.dgmo-overlay-label')).toEqual(['R² 0.60']);
  });
  it('mean on scatter warns and is dropped', async () => {
    const { parseScatter } = await import('../src/data-chart-parser');
    const p = parseScatter('scatter X\nmean\nA 1 2\nB 2 3');
    expect(p.overlays).toBeUndefined();
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_OVERLAY_UNSUPPORTED']);
  });
  it('trendline on scatter is an unknown overlay', async () => {
    const { parseScatter } = await import('../src/data-chart-parser');
    const p = parseScatter('scatter X\ntrendline\nA 1 2\nB 2 3');
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_OVERLAY_UNKNOWN']);
    expect(p.diagnostics[0]!.message).toContain("'trend'");
  });
});

/** Phoenix average daily highs (°C), Jan–Dec. Peak 41 in Jul; 19 in Jan and
 *  Dec ties for the low, and the first one wins. */
const PHOENIX = [19, 21, 25, 29, 34, 39, 41, 40, 37, 31, 24, 19];

describe('moving average and extremes numbers', () => {
  it('trailing 3-point average of 2 4 5 4 5', () => {
    const ma = movingAverage(WOBBLE, 3);
    expect(ma.slice(0, 2)).toEqual([NaN, NaN]);
    // (2+4+5)/3, (4+5+4)/3, (5+4+5)/3
    expect(ma[2]).toBeCloseTo(11 / 3, 12);
    expect(ma[3]).toBeCloseTo(13 / 3, 12);
    expect(ma[4]).toBeCloseTo(14 / 3, 12);
  });
  it('a window over a missing row is missing', () => {
    expect(movingAverage([1, NaN, 3, 5, 7], 2)).toEqual([NaN, NaN, NaN, 4, 6]);
  });
  it('extremes are the first highest and first lowest rows', () => {
    expect(extremes(PHOENIX)).toEqual({ high: 6, low: 0 });
    expect(extremes([NaN, NaN])).toBeNull();
  });
});

describe('moving-average and extremes', () => {
  const PHX = `line Average daily high, Phoenix\n\n${rows(PHOENIX)}`;
  it('parses moving-average N and refuses a bad N', () => {
    expect(parseChart('line X\nmoving-average 3\nA 1').overlays).toEqual([
      { kind: 'moving-average', value: 3, lineNumber: 2 },
    ]);
    for (const bad of [
      'moving-average',
      'moving-average 1',
      'moving-average 2.5',
      'moving-average x',
    ])
      expect(
        parseChart(`line X\n${bad}\nA 1`).diagnostics.map((d) => d.code)
      ).toEqual(['E_OVERLAY_BAD_N']);
  });
  it('moving-average is line only', () => {
    const p = parseChart('bar X\nmoving-average 3\nA 1');
    expect(p.overlays).toBeUndefined();
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_OVERLAY_UNSUPPORTED']);
  });
  it('extremes is on by default and is never written (#2213)', () => {
    const p = parseChart('line X\nextremes\nA 1\nB 2');
    expect(p.overlays).toBeUndefined();
    const d = p.diagnostics.find((x) => x.code === 'W_OVERLAY_UNKNOWN');
    expect(d?.message).toContain('no-extremes');
  });
  it('no-extremes hides the high and low marks (#2213)', async () => {
    const on = await draw(PHX);
    expect(on.querySelectorAll('circle.dgmo-extreme-high')).toHaveLength(1);
    const off = await draw(
      `line Average daily high, Phoenix\nno-extremes\n\n${rows(PHOENIX)}`
    );
    expect(off.querySelectorAll('[class*="extreme"]')).toHaveLength(0);
  });
  it('draws the average heavier and the raw line thinner', async () => {
    const svg = await draw(
      `line Teams\nno-extremes\nmoving-average 3\n\n${WOBBLE.map((v, i) => `W${i + 1} ${v}`).join('\n')}`
    );
    const avg = svg.querySelector('g.dgmo-overlay-moving-average path')!;
    const raw = svg.querySelector('path.dgmo-series-line')!;
    expect(Number(avg.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(raw.getAttribute('stroke-width'))
    );
    expect(avg.getAttribute('stroke')).toBe(raw.getAttribute('stroke'));
    // Three averaged rows: W3, W4, W5.
    expect(avg.getAttribute('d')!.match(/[ML]/g)).toHaveLength(3);
    expect(texts(svg, '.dgmo-overlay-label')).toEqual(['3-pt avg']);
  });
  it('names the window after a one-word x-axis title', async () => {
    const svg = await draw(
      `line Teams\nno-extremes\nx-axis Week\nmoving-average 3\n\n${WOBBLE.map((v, i) => `W${i + 1} ${v}`).join('\n')}`
    );
    expect(texts(svg, '.dgmo-overlay-label')).toEqual(['3-week avg']);
  });
  it('marks the peak and the low with just their value (#2213)', async () => {
    const svg = await draw(PHX);
    expect(svg.querySelectorAll('circle.dgmo-extreme-high')).toHaveLength(1);
    expect(svg.querySelectorAll('circle.dgmo-extreme-low')).toHaveLength(1);
    expect(texts(svg, '.dgmo-overlay-extremes-label')).toEqual(['19', '41']);
  });
  it('the high and low dots let the pointer through to their point (#2227)', async () => {
    const svg = await draw(PHX);
    const marks = svg.querySelectorAll('g.dgmo-overlay-extremes');
    expect(marks.length).toBeGreaterThan(0);
    for (const g of marks)
      expect(g.getAttribute('pointer-events')).toBe('none');
  });
  it('the marked points lose their plain value label', async () => {
    const svg = await draw(PHX);
    // The one '41' left is the extremes label itself.
    const values = texts(svg, 'text').filter((t) => t === '41');
    expect(values).toEqual(['41']);
  });
  it('a multi-series line marks each series', async () => {
    const svg = await draw(`line X
series
  A
  B

P 1 9
Q 3 7
R 2 8`);
    expect(svg.querySelectorAll('circle.dgmo-extreme-high')).toHaveLength(2);
    expect(svg.querySelectorAll('circle.dgmo-extreme-low')).toHaveLength(2);
  });
});

// Failed deliveries by cause (mockup picture 6), total 400:
// 176 → 44%, +104 → 70%, +52 → 83%, +32 → 91%, +20 → 96%, +12 → 99%, +4 → 100%.
const CAUSES = `bar Failed deliveries by cause
pareto

Other 4
Damaged 104
Customs 20
Bad address 176
Weather 12
Late pickup 52
Wrong item 32`;

describe('pareto', () => {
  it('cumulative shares of a hand-worked total', () => {
    expect(paretoCumulative([176, 104, 52, 32, 20, 12, 4])).toEqual([
      44, 70, 83, 91, 96, 99, 100,
    ]);
    expect(paretoCumulative([0, 0])).toEqual([0, 0]);
  });
  it('sorts the bars largest first', () => {
    const p = parseChart(CAUSES);
    expect(p.diagnostics).toEqual([]);
    expect(p.data.map((d) => d.value)).toEqual([176, 104, 52, 32, 20, 12, 4]);
  });
  it('a stacked or grouped bar is an error and keeps its order', () => {
    for (const layout of ['stack', 'group']) {
      const p = parseChart(
        `bar X\npareto\n${layout}\n  A\n  B\n\nP 1 2\nQ 5 6`
      );
      expect(p.overlays).toBeUndefined();
      expect(p.diagnostics.map((d) => d.code)).toEqual([
        'E_OVERLAY_PARETO_SERIES',
      ]);
      expect(p.data.map((d) => d.label)).toEqual(['P', 'Q']);
    }
  });
  it('pareto on line warns as unsupported', () => {
    const p = parseChart('line X\npareto\nA 1\nB 2');
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_OVERLAY_UNSUPPORTED']);
  });
  it('horizontal is ignored with a warning', () => {
    const p = parseChart(
      CAUSES.replace('pareto', 'pareto\norientation-horizontal')
    );
    expect(p.orientation).toBeUndefined();
    expect(p.diagnostics.map((d) => d.severity)).toEqual(['warning']);
  });
  it('draws a right percent axis, the 80% guide and the cumulative line', async () => {
    const svg = await draw(CAUSES);
    expect(texts(svg, '.dgmo-overlay-pareto-axis text')).toEqual([
      '0%',
      '20%',
      '40%',
      '60%',
      '80%',
      '100%',
    ]);
    expect(svg.querySelectorAll('line.dgmo-pareto-guide')).toHaveLength(1);
    const pts = [...svg.querySelectorAll('circle.dgmo-pareto-pt')];
    expect(pts.map((c) => c.getAttribute('data-value'))).toEqual([
      '44%',
      '70%',
      '83%',
      '91%',
      '96%',
      '99%',
      '100%',
    ]);
    // Each point sits over its bar, and the line only climbs.
    const ys = pts.map((c) => Number(c.getAttribute('cy')));
    for (let i = 1; i < ys.length; i++)
      expect(ys[i]!).toBeLessThanOrEqual(ys[i - 1]!);
    const guide = svg.querySelector('line.dgmo-pareto-guide')!;
    const top = Number(
      [...svg.querySelectorAll('circle.dgmo-pareto-pt')]
        .at(-1)!
        .getAttribute('cy')
    );
    const zeroY = ys[0]! + ((44 / 100) * (ys[0]! - top)) / (1 - 0.44);
    // 80% sits 80% of the way from the 0% line to the 100% point.
    expect(Number(guide.getAttribute('y1'))).toBeCloseTo(
      zeroY - 0.8 * (zeroY - top),
      6
    );
    expect(texts(svg, '.dgmo-pareto-label')[0]).toBe('44%');
  });
  it('a long-named pareto never turns horizontal', async () => {
    const svg = await draw(CAUSES);
    const bars = [...svg.querySelectorAll('rect.dgmo-datum')];
    const w = Number(bars[0]!.getAttribute('width'));
    const h = Number(bars[0]!.getAttribute('height'));
    expect(h).toBeGreaterThan(w);
  });
});
