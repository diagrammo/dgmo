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

// Strip zrender's per-render CSS class numbering and `ecmeta_silent` flag
// before snapshotting. Those attributes drift with global render-count state,
// so the same chart fixture can produce different output depending on how
// many other tests rendered first. We only care that the fill values + paths
// are stable, not the auto-generated class names.
function sanitize(svg: string): string {
  return svg
    .replace(/\s*class="zr\d+-cls-\d+"/g, '')
    .replace(/\s*ecmeta_silent="(?:true|false)"/g, '');
}

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
      expect(sanitize(svg)).toMatchSnapshot();
    });
  }
});
