// Pie renderer geometry — the external leader-line labels used to reserve a
// FIXED 220px horizontal gutter (radius = width/2 - 220), which collapsed the
// pie to ~0 on a narrow canvas while the labels kept their pixel size and piled
// up in the middle. Radius + label geometry are now proportional so the figure
// scales as one piece and drops the labels below a legibility floor.
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';

const PIE = `pie Crew Roles
solid-fill

Sailors 45
Gunners 20
Marines 15
Officers 8
Specialists 7
Cooks & Surgeons 5`;

const radiusOf = (svg: string): number => {
  // The wedge <path d="M…A…"> — pull the arc radius from the first `A rx ry`.
  const m = svg.match(/<path[^>]*\bd="[^"]*?A\s*([\d.]+)/);
  return m ? parseFloat(m[1]!) : 0;
};
const labelCount = (svg: string): number =>
  (svg.match(/<text[^>]*class="dgmo-datum"/g) ?? []).length;

describe('renderPie — proportional scaling', () => {
  it('keeps a real pie (non-collapsed radius) on a narrow canvas', async () => {
    const svg = await renderDataChartD3(PIE, 'light', undefined, {
      width: 440,
      height: 340,
    });
    // Old formula: 440/2 - 220 = 0 radius. New: ~440/2/2.2 = 100.
    expect(radiusOf(svg)).toBeGreaterThan(60);
  });

  it('radius shrinks with the canvas but never goes non-positive', async () => {
    const big = radiusOf(
      await renderDataChartD3(PIE, 'light', undefined, {
        width: 800,
        height: 600,
      })
    );
    const small = radiusOf(
      await renderDataChartD3(PIE, 'light', undefined, {
        width: 300,
        height: 240,
      })
    );
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThanOrEqual(8);
  });

  it('drops external labels once too small to place legibly', async () => {
    const roomy = await renderDataChartD3(PIE, 'light', undefined, {
      width: 800,
      height: 600,
    });
    const tiny = await renderDataChartD3(PIE, 'light', undefined, {
      width: 160,
      height: 130,
    });
    expect(labelCount(roomy)).toBe(6);
    expect(labelCount(tiny)).toBe(0);
    // …but the pie itself still renders.
    expect(tiny).toContain('class="dgmo-datum"');
    expect(radiusOf(tiny)).toBeGreaterThan(8);
  });
});
