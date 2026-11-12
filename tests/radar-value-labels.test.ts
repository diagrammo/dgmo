import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { lintSvg } from './stress/lint';

// A radar's vertex values once printed just past each dot whatever was there,
// so two series a few tenths apart printed "7.8" over "7.6", and in a small
// view over the axis names (#1828). All series' values are now placed
// together: past the dot, else inside it, beside, above or below; a value
// with no clear spot is dropped, smallest first, and keeps its hover.

const FIXTURE = readFileSync(
  resolve(__dirname, '../stress/radar/extreme-values--close-series.dgmo'),
  'utf8'
);
const VALUES = [
  '7.8',
  '7.6',
  '6.1',
  '6.3',
  '8.4',
  '8.2',
  '5',
  '5.1',
  '3.2',
  '3',
];

const MULTI = `radar Ship Combat Ratings by Vessel
series
  Black Pearl blue
  Queen Anne's Revenge green
  Flying Dutchman purple

Firepower       85  70  95
Speed           90  65  55
Armor           60  80  90
Maneuverability 88  62  50
Crew Morale     75  85  70
Cannon Range    70  78  92`;

/** Text drawn by the vertex values (12px, never a scale or an axis name). */
function valueTexts(svg: string): string[] {
  return [
    ...svg.matchAll(
      /<text(?![^>]*class=)[^>]*font-size="12"[^>]*>([^<]*)<\/text>/g
    ),
  ].map((m) => m[1]!);
}

const overlaps = (svg: string) =>
  lintSvg(svg).filter((f) => f.rule === 'text-overlap');

describe('radar vertex values never print over each other (#1828)', () => {
  it('the close-series fixture draws every value, none over another', async () => {
    const svg = await renderDataChartD3(FIXTURE, 'light');
    expect(overlaps(svg)).toEqual([]);
    expect(valueTexts(svg).sort()).toEqual([...VALUES].sort());
  });

  it('three series draw no value over another or over an axis name', async () => {
    for (const dims of [undefined, { width: 480, height: 360 }]) {
      const svg = await renderDataChartD3(MULTI, 'light', undefined, dims);
      expect(overlaps(svg)).toEqual([]);
    }
  });

  it('in a small container a crowded value is dropped, never overprinted', async () => {
    const svg = await renderDataChartD3(FIXTURE, 'light', undefined, {
      width: 320,
      height: 280,
    });
    expect(overlaps(svg)).toEqual([]);
    const drawn = valueTexts(svg);
    expect(drawn.length).toBeLessThanOrEqual(VALUES.length);
    expect(drawn).toContain('8.4');
    // Every vertex keeps its value for hover.
    expect(svg.match(/data-value="/g)?.length ?? 0).toBeGreaterThanOrEqual(
      VALUES.length
    );
  });
});
