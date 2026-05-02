import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderExtendedChartForExport } from '../../src/echarts';
import { nordPalette } from '../../src/palettes/nord';
import { boldPalette } from '../../src/palettes/bold';

// TD-4 / AC5: Sankey desaturation (75% nodes / 45% links) is the only
// documented exception to the canonical shapeFill() 25% tint. This test
// locks the baseline output before any migration so accidental sweeps
// can't quietly collapse it to 25%.

const sankeyFixture = readFileSync(
  resolve(__dirname, '../../gallery/fixtures/sankey.dgmo'),
  'utf-8'
);

describe('sankey baseline (TD-4 exception)', () => {
  it('nord light: sankey output is stable', async () => {
    const svg = await renderExtendedChartForExport(
      sankeyFixture,
      'light',
      nordPalette.light
    );
    expect(svg).toMatchSnapshot();
  });

  it('nord dark: sankey output is stable', async () => {
    const svg = await renderExtendedChartForExport(
      sankeyFixture,
      'dark',
      nordPalette.dark
    );
    expect(svg).toMatchSnapshot();
  });

  it('bold light: sankey output is stable', async () => {
    const svg = await renderExtendedChartForExport(
      sankeyFixture,
      'light',
      boldPalette.light
    );
    expect(svg).toMatchSnapshot();
  });

  it('bold dark: sankey output is stable', async () => {
    const svg = await renderExtendedChartForExport(
      sankeyFixture,
      'dark',
      boldPalette.dark
    );
    expect(svg).toMatchSnapshot();
  });

  it('echarts.ts retains literal mix(c, bg, 75) and mix(c, bg, 45) for sankey', () => {
    const echartsSrc = readFileSync(
      resolve(__dirname, '../../src/echarts.ts'),
      'utf-8'
    );
    expect(echartsSrc).toMatch(/mix\(c,\s*bg,\s*75\)/);
    expect(echartsSrc).toMatch(/mix\(c,\s*bg,\s*45\)/);
  });
});
