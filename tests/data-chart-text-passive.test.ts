import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderDataChartD3 } from '../src/charts-d3/index';

// #2086: text over a mark must not catch the pointer, or the mark's hover ends.
const FIXTURES = [
  'bar-stack',
  'funnel',
  'sankey',
  'line-highlight',
  'overlay-pareto',
  'overlay-trend-line',
  'radar',
];

describe('data-chart text is pointer-transparent (#2086)', () => {
  for (const name of FIXTURES) {
    it(`${name}: every plot text has pointer-events none`, async () => {
      const src = readFileSync(
        resolve(__dirname, '../gallery/fixtures', `${name}.dgmo`),
        'utf8'
      );
      const svg = await renderDataChartD3(src, 'dark');
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const live = [...doc.querySelectorAll('text')].filter(
        (t) => !t.closest('.dgmo-axis-label, .chart-title, [data-legend-entry]')
      );
      expect(live.length).toBeGreaterThan(0);
      const bad = live.filter(
        (t) => t.getAttribute('pointer-events') !== 'none'
      );
      expect(bad.map((t) => t.textContent)).toEqual([]);
    });
  }
});
