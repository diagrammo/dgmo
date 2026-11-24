import { describe, it, expect } from 'vitest';
import { renderDataChartD3 as renderDataChartD3Raw } from '../src/charts-d3/index';
import { parseChart } from '../src/chart';
import { flattenTabular } from './helpers/tabular-text';

// A bar axis of plain names flips horizontal at ANY count rather than thin
// them, and the drawing grows taller than its host to give each name a row
// (#2271). `orientation-vertical` keeps the columns and thins. Ordered names
// (dates, numbers) still thin (#2212).

const render = async (
  ...a: Parameters<typeof renderDataChartD3Raw>
): Promise<string> => flattenTabular(await renderDataChartD3Raw(...a));

const CITIES = [
  'Amsterdam',
  'Barcelona',
  'Berlin',
  'Bogotá',
  'Boston',
  'Brisbane',
  'Brussels',
  'Budapest',
  'Buenos Aires',
  'Cairo',
  'Calgary',
  'Cape Town',
  'Chicago',
  'Copenhagen',
  'Dallas',
  'Delhi',
  'Denver',
  'Dubai',
  'Dublin',
  'Edinburgh',
  'Florence',
  'Geneva',
  'Hamburg',
  'Helsinki',
  'Hong Kong',
  'Houston',
  'Istanbul',
  'Jakarta',
  'Johannesburg',
  'Kyoto',
  'Lagos',
  'Lima',
  'Lisbon',
  'London',
  'Los Angeles',
  'Madrid',
  'Manila',
  'Melbourne',
  'Mexico City',
  'Miami',
  'Milan',
  'Montreal',
  'Moscow',
  'Mumbai',
  'Munich',
  'Nairobi',
  'Oslo',
  'Paris',
  'Prague',
  'Rome',
  'Santiago',
  'Seattle',
  'Seoul',
  'Singapore',
  'Stockholm',
  'Sydney',
  'Tokyo',
  'Toronto',
  'Vienna',
  'Zurich',
];

function bar(names: string[], extra = ''): string {
  return [
    'bar City visits',
    ...(extra ? [extra] : []),
    ...names.map((n, i) => `${n} ${10 + ((i * 37) % 90)}`),
  ].join('\n');
}

/** Text of every `<text>` element, hover titles dropped. */
function drawn(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) =>
    m[1]!.replace(/<title>.*?<\/title>/g, '').replace(/<[^>]+>/g, '')
  );
}

function rootHeight(svg: string): number {
  return Number(svg.match(/<svg[^>]*\sheight="([\d.]+)"/)![1]);
}

const HOST = { width: 600, height: 400 };
/** Narrow enough that 13 rotated names would have to thin. */
const NARROW = { width: 360, height: 400 };

describe('bar flips horizontal at any count of plain names (#2271)', () => {
  for (const n of [13, 20, 60]) {
    it(`${n} plain names that would thin: flat, every name drawn`, async () => {
      const names = CITIES.slice(0, n);
      const svg = await render(bar(names), 'light', undefined, NARROW);
      expect(svg).not.toContain('rotate(-40)');
      const texts = drawn(svg);
      for (const name of names) expect(texts).toContain(name);
    });
  }

  it('20 names that all fit rotated stay vertical, none dropped', async () => {
    const names = CITIES.slice(0, 20);
    const svg = await render(bar(names), 'light', undefined, HOST);
    expect(svg).toContain('rotate(-40)');
    const texts = drawn(svg);
    for (const name of names) expect(texts).toContain(name);
  });

  it('60 names grow the drawing past the host height', async () => {
    const svg = await render(bar(CITIES), 'light', undefined, HOST);
    expect(rootHeight(svg)).toBeGreaterThan(HOST.height);
  });

  it('a short axis that fits keeps the host height', async () => {
    const svg = await render(bar(CITIES.slice(0, 5)), 'light', undefined, HOST);
    expect(rootHeight(svg)).toBe(HOST.height);
  });
});

describe('orientation-vertical keeps the columns (#2271)', () => {
  it('parses to a vertical orientation', () => {
    expect(parseChart(bar(CITIES, 'orientation-vertical')).orientation).toBe(
      'vertical'
    );
  });

  it('60 names stay vertical, thinned, at the host height', async () => {
    const svg = await render(
      bar(CITIES, 'orientation-vertical'),
      'light',
      undefined,
      HOST
    );
    expect(svg).toContain('rotate(-40)');
    const texts = drawn(svg);
    expect(CITIES.filter((c) => texts.includes(c)).length).toBeLessThan(
      CITIES.length
    );
    expect(rootHeight(svg)).toBe(HOST.height);
  });

  it('a short axis that would flip stays vertical too', async () => {
    const names = CITIES.slice(0, 8).map((c) => `${c} metropolitan area`);
    const svg = await render(
      bar(names, 'orientation-vertical'),
      'light',
      undefined,
      { width: 360, height: 400 }
    );
    expect(svg).toContain('rotate(-40)');
  });
});

describe('ordered names still thin (#2212)', () => {
  it('60 years stay vertical and drop labels', async () => {
    const years = Array.from({ length: 60 }, (_, i) => String(1960 + i));
    const svg = await render(bar(years), 'light', undefined, HOST);
    const texts = drawn(svg);
    expect(years.filter((y) => texts.includes(y)).length).toBeLessThan(60);
    expect(rootHeight(svg)).toBe(HOST.height);
  });
});
