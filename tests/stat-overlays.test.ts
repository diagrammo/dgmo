// Statistics overlays (#1954). Expected numbers are worked by hand from the
// ecosystem docs mockup 2026-11-12-statistics-overlays, never re-derived
// here with the code under test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';
import {
  mean,
  median,
  reachesTarget,
  roundStat,
} from '../src/overlays/compute';

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

const LINE = `line New sign-ups, 2026\nmean\nmedian\n\n${rows(SIGNUPS)}`;
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
    expect(p.diagnostics[0]!.message).toContain('line and bar');
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
