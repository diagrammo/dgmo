import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { lintSvg } from './stress/lint';
import { placeLabels } from '../src/utils/place-labels';

// A line chart's point values once printed wherever the point was, so two
// series a few pixels apart printed "1.1" over "0.6" (#1828). All series'
// values are now placed together: above the point, else below, right or
// left; a value with no clear spot is dropped, smallest first.

const FIXTURE = readFileSync(
  resolve(__dirname, '../stress/line/extreme-values--close-series.dgmo'),
  'utf8'
);

/** The values the fixture's data rows carry, as drawn by `fmtNum`. */
function valuesOf(src: string): string[] {
  return src
    .split('\n')
    .filter((l) => /^[A-Z][\w ]*?\s+\d/.test(l) && !/^(line|era)\b/.test(l))
    .flatMap((l) =>
      l
        .trim()
        .split(/\s+/)
        .filter((t) => /^\d/.test(t))
    )
    .map((t) => String(Number(t)));
}

/** Text drawn by the value labels (12px, never a tick or a title). */
function valueTexts(svg: string): string[] {
  return [
    ...svg.matchAll(
      /<text(?![^>]*class=)[^>]*font-size="12"[^>]*>([^<]*)<\/text>/g
    ),
  ].map((m) => m[1]!);
}

describe('line point values never print over each other (#1828)', () => {
  it('the close-series fixture draws every value, none over another', async () => {
    const svg = await renderDataChartD3(FIXTURE, 'light');
    expect(lintSvg(svg).filter((f) => f.rule === 'text-overlap')).toEqual([]);
    const drawn = valueTexts(svg);
    for (const v of valuesOf(FIXTURE)) expect(drawn).toContain(v);
  });

  it('in a small container a crowded value is dropped, never overprinted', async () => {
    const svg = await renderDataChartD3(FIXTURE, 'light', undefined, {
      width: 320,
      height: 280,
    });
    expect(lintSvg(svg).filter((f) => f.rule === 'text-overlap')).toEqual([]);
    const drawn = valueTexts(svg).filter((t) => /^\d/.test(t));
    // Some values had no clear spot and were dropped; the largest survives,
    // and every point keeps its value for hover.
    expect(drawn.length).toBeLessThan(valuesOf(FIXTURE).length);
    expect(drawn).toContain('11.4');
    expect(svg.match(/class="dgmo-pt"/g)).toHaveLength(
      valuesOf(FIXTURE).length
    );
  });
});

describe('placeLabels', () => {
  const at = (x: number, y: number) => ({ x, y, anchor: 'middle' as const });

  it('moves a label to its next spot when the first is taken', () => {
    const out = placeLabels(
      [
        { text: '10', priority: 10, spots: [at(50, 50)] },
        { text: '9', priority: 9, spots: [at(50, 52), at(50, 80)] },
      ],
      { fontSize: 12 }
    );
    expect(out.map((o) => o.spot?.y)).toEqual([50, 80]);
  });

  it('drops the smaller label when no spot is clear', () => {
    const out = placeLabels(
      [
        { text: '9', priority: 9, spots: [at(50, 52)] },
        { text: '10', priority: 10, spots: [at(50, 50)] },
      ],
      { fontSize: 12 }
    );
    expect(out[0]!.spot).toBeNull();
    expect(out[1]!.spot?.y).toBe(50);
  });

  it('breaks a priority tie in favour of an end point', () => {
    const out = placeLabels(
      [
        { text: '5', priority: 5, spots: [at(50, 50)] },
        { text: '5', priority: 5, endpoint: true, spots: [at(52, 50)] },
      ],
      { fontSize: 12 }
    );
    expect(out[0]!.spot).toBeNull();
    expect(out[1]!.spot).not.toBeNull();
  });

  it('refuses a spot outside the bounds or on a marker', () => {
    const out = placeLabels(
      [{ text: '1', priority: 1, spots: [at(5, 5), at(50, 50), at(50, 90)] }],
      {
        fontSize: 12,
        markers: [{ cx: 50, cy: 46, r: 4 }],
        bounds: { left: 10, top: 10, right: 100, bottom: 100 },
      }
    );
    expect(out[0]!.spot?.y).toBe(90);
  });
});
