// Bar `sort` (#1978): `sort` = largest first, `sort asc` = smallest first,
// `sort <series>` on a multi-series bar, totals for a stack, both orientations.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';

const labels = (src: string) => parseChart(src).data.map((d) => d.label);
const warnings = (src: string) =>
  parseChart(src).diagnostics.filter((d) => d.severity === 'warning');

const SINGLE = `bar Plunder
Tortuga 30
Nassau 80
Havana 50`;

const GROUPED = `bar Ships
group
  Cannons
  Crew

Revenge 40 100
Fortune 20 300
Whydah 30 200`;

const STACKED = `bar Hauls
stack
  Gold
  Silver

Revenge 10 10
Fortune 5 40
Whydah 30 1`;

describe('bar sort (#1978)', () => {
  it('keeps source order without sort', () => {
    expect(labels(SINGLE)).toEqual(['Tortuga', 'Nassau', 'Havana']);
  });

  it('bare sort orders a single series largest first', () => {
    expect(labels(`${SINGLE}\nsort`)).toEqual(['Nassau', 'Havana', 'Tortuga']);
    expect(labels(`${SINGLE}\nsort desc`)).toEqual([
      'Nassau',
      'Havana',
      'Tortuga',
    ]);
  });

  it('sort asc orders smallest first', () => {
    expect(labels(`${SINGLE}\nsort asc`)).toEqual([
      'Tortuga',
      'Havana',
      'Nassau',
    ]);
  });

  it('grouped: bare sort uses the first series', () => {
    expect(labels(`sort\n${GROUPED}`)).toEqual([
      'Revenge',
      'Whydah',
      'Fortune',
    ]);
  });

  it('grouped: sort <series name> uses that series', () => {
    expect(labels(`${GROUPED}\nsort Crew`)).toEqual([
      'Fortune',
      'Whydah',
      'Revenge',
    ]);
    expect(labels(`${GROUPED}\nsort Crew asc`)).toEqual([
      'Revenge',
      'Whydah',
      'Fortune',
    ]);
  });

  it('stacked: sorts by the total', () => {
    // Totals: Revenge 20, Fortune 45, Whydah 31.
    expect(labels(`${STACKED}\nsort`)).toEqual([
      'Fortune',
      'Whydah',
      'Revenge',
    ]);
  });

  it('an unknown series name warns and falls back', () => {
    const src = `${GROUPED}\nsort Crw`;
    expect(labels(src)).toEqual(['Revenge', 'Whydah', 'Fortune']);
    expect(
      warnings(src).some((d) => /no series named "Crw"/.test(d.message))
    ).toBe(true);
  });

  it('the pie-only diagnostic no longer fires for bar', () => {
    expect(warnings(`${SINGLE}\nsort`)).toEqual([]);
  });

  it('still warns on a chart type without sort', () => {
    const src = `line Tide\nsort\nMon 1\nTue 2`;
    expect(
      warnings(src).some((d) => /only supported on pie and bar/.test(d.message))
    ).toBe(true);
    expect(parseChart(src).sort).toBeUndefined();
  });

  it('a data row named sort still parses as data', () => {
    const parsed = parseChart(`bar Words\nsort 5\nkeep 3`);
    expect(parsed.data.map((d) => d.label)).toEqual(['sort', 'keep']);
    expect(parsed.sort).toBeUndefined();
  });

  it('pie sort is unchanged', () => {
    const pie = parseChart(`pie Rum\nsort asc\nA 3\nB 1\nC 2`);
    expect(pie.data.map((d) => d.label)).toEqual(['B', 'C', 'A']);
  });
});

describe('bar sort renders in both orientations', () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  async function barOrder(src: string, axis: 'x' | 'y'): Promise<string[]> {
    host.innerHTML = await renderDataChartD3(src, 'light');
    const rects = [
      ...host.querySelectorAll<SVGRectElement>('rect[data-line-number]'),
    ];
    return rects
      .map((r) => ({
        name: r.getAttribute('data-name')!,
        at: parseFloat(r.getAttribute(axis)!),
      }))
      .sort((a, b) => a.at - b.at)
      .map((r) => r.name);
  }

  it('vertical: largest bar on the left', async () => {
    expect(await barOrder(`${SINGLE}\nsort`, 'x')).toEqual([
      'Nassau',
      'Havana',
      'Tortuga',
    ]);
  });

  it('horizontal: largest bar on top', async () => {
    expect(
      await barOrder(`${SINGLE}\norientation-horizontal\nsort`, 'y')
    ).toEqual(['Nassau', 'Havana', 'Tortuga']);
  });
});
