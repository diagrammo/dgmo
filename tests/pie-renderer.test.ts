// Pie renderer geometry — the external leader-line labels used to reserve a
// FIXED 220px horizontal gutter (radius = width/2 - 220), which collapsed the
// pie to ~0 on a narrow canvas while the labels kept their pixel size and piled
// up in the middle. Radius + label geometry are now proportional so the figure
// scales as one piece and drops the labels below a legibility floor.
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';

const PIE = `pie Crew Roles
fill-solid

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

// The pie group is translated to (cx, 0)=width/2; label <text> x is in that
// local space, so absolute x = width/2 + localX. Estimate the text's far edge
// from its anchor + a generous per-char width and return the max/min absolute x.
const labelXExtent = (
  svg: string,
  width: number
): { minX: number; maxX: number } => {
  const cx = width / 2;
  // Char width tracks the rendered font (font = 14·r/180); 0.62·font is a small
  // upper bound on Inter's average advance — generous without being 2× reality.
  const font = 14 * (radiusOf(svg) / 180);
  const charW = font * 0.62;
  let minX = cx;
  let maxX = cx;
  const re =
    /<text[^>]*\bx="([-\d.]+)"[^>]*text-anchor="(start|end|middle)"[^>]*class="dgmo-datum"[^>]*>([^<]*)</g;
  for (let m; (m = re.exec(svg)); ) {
    const x = cx + parseFloat(m[1]!);
    const anchor = m[2]!;
    const w = m[3]!.length * charW;
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    const right = anchor === 'start' ? x + w : anchor === 'end' ? x : x + w / 2;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
  }
  return { minX, maxX };
};

describe('renderPie — proportional scaling', () => {
  it('keeps the longest label inside the canvas at a medium width', async () => {
    const width = 560;
    const svg = await renderDataChartD3(PIE, 'light', undefined, {
      width,
      height: 450,
    });
    const { minX, maxX } = labelXExtent(svg, width);
    expect(minX).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(width);
  });

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
