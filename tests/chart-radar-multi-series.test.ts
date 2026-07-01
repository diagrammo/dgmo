import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

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

const SINGLE = `radar Ship Combat Rating
Firepower       85
Speed           70
Armor           60
Maneuverability 90
Crew Morale     75`;

describe('radar multi-series — parser', () => {
  it('parses one value per series per axis row', () => {
    const parsed = parseChart(MULTI, palette);
    expect(parsed.error).toBeNull();
    expect(parsed.seriesNames).toEqual([
      'Black Pearl',
      "Queen Anne's Revenge",
      'Flying Dutchman',
    ]);
    const firepower = parsed.data.find((d) => d.label === 'Firepower');
    expect(firepower?.value).toBe(85); // Black Pearl
    expect(firepower?.extraValues).toEqual([70, 95]); // Queen Anne's, Dutchman
  });
});

describe('radar multi-series — D3 renderer', () => {
  it('draws one polygon group per series', async () => {
    const svg = await renderDataChartD3(MULTI, 'light', palette);
    expect((svg.match(/class="dgmo-series"/g) ?? []).length).toBe(3);
  });

  it('fills overlapping polygons with alpha so every series shows through', async () => {
    const svg = await renderDataChartD3(MULTI, 'light', palette);
    expect(svg).toContain('fill-opacity="0.2"');
  });

  it('emits the shared series legend with every series name', async () => {
    const svg = await renderDataChartD3(MULTI, 'light', palette);
    expect(svg).toContain('chart-legend');
    expect(svg).toContain('Black Pearl');
    expect(svg).toContain("Queen Anne's Revenge");
    expect(svg).toContain('Flying Dutchman');
  });

  it('single-series radar renders one group and no legend (no regression)', async () => {
    const svg = await renderDataChartD3(SINGLE, 'light', palette);
    expect((svg.match(/class="dgmo-series"/g) ?? []).length).toBe(1);
    expect(svg).not.toContain('chart-legend');
  });
});
