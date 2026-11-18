import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';

// On a bar, x names the CATEGORY axis and y the VALUE axis in any orientation
// (diagrammo/diagrammo#2122), so a title lands on the axis its range directive
// (the `y-axis` range and scale, §15.1.2) sets. The rotated title sits on the left.
const rotated = (svg: string, label: string) =>
  new RegExp(`rotate\\(-90\\)"[^>]*>${label}<`).test(svg);

const SRC = (orient: string) =>
  `bar Revenue by region\n${orient}x-axis Region\ny-axis Revenue\n\nNorth 120\nSouth 95\nEast 60`;

describe('bar axis titles follow the data, not the screen', () => {
  it('vertical: categories along the bottom, values up the left', async () => {
    const svg = await renderDataChartD3(SRC(''), 'light');
    expect(rotated(svg, 'Revenue')).toBe(true);
    expect(rotated(svg, 'Region')).toBe(false);
    expect(svg).toContain('>Region<');
  });

  it('authored horizontal: categories down the left, values along the bottom', async () => {
    const svg = await renderDataChartD3(
      SRC('orientation-horizontal\n'),
      'light'
    );
    expect(rotated(svg, 'Region')).toBe(true);
    expect(rotated(svg, 'Revenue')).toBe(false);
    expect(svg).toContain('>Revenue<');
  });
});
