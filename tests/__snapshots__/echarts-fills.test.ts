import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderExtendedChartForExport } from '../../src/echarts';
import { nordPalette } from '../../src/palettes/nord';

const FIXTURES = [
  'pie',
  'doughnut',
  'bar',
  'bar-stacked',
  'funnel',
  'radar',
  'polar-area',
  'scatter',
  'heatmap',
  'chord',
  'line',
  'area',
] as const;

describe('echarts shapeFill snapshots (TD-7 high-risk)', () => {
  for (const name of FIXTURES) {
    it(`${name} (nord light) — stable SVG output`, async () => {
      const fixturePath = resolve(
        __dirname,
        '../../gallery/fixtures',
        `${name}.dgmo`
      );
      const content = readFileSync(fixturePath, 'utf-8');
      const svg = await renderExtendedChartForExport(
        content,
        'light',
        nordPalette.light
      );
      expect(svg).toMatchSnapshot();
    });
  }
});
