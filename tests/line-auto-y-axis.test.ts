import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

// Squat Est. 1RM — the motivating case: all values in 315–395, so a forced
// 0 baseline crushes the trend into the top ~20% of the plot.
const SQUAT = `line Squat Est. 1RM
Week 1 315
Week 2 325
Week 3 340
Week 4 355
Week 5 370
Week 6 385
Week 7 395`;

/** Pull numeric y-axis tick values out of the rendered SVG. */
function tickValues(svg: string): number[] {
  const out: number[] = [];
  const re = /class="dgmo-tick"[^>]*>([^<]+)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

describe('line chart — data-driven y-axis (auto-fit)', () => {
  it('parses the no-auto-y opt-out flag', () => {
    const r = parseChart(`line X\nno-auto-y\nA 315\nB 395`, palette);
    expect(r.noAutoY).toBe(true);
  });

  it('leaves noAutoY undefined by default', () => {
    const r = parseChart(`line X\nA 315\nB 395`, palette);
    expect(r.noAutoY).toBeUndefined();
  });

  it('by default fits the axis near the data, not to 0', async () => {
    const svg = await renderDataChartD3(SQUAT, 'light', palette);
    const ticks = tickValues(svg);
    // The lowest tick sits well above 0 (near the 315 data minimum), and no
    // 0 baseline is drawn.
    expect(Math.min(...ticks)).toBeGreaterThan(200);
    expect(ticks).not.toContain(0);
  });

  it('no-auto-y restores the 0 baseline', async () => {
    const svg = await renderDataChartD3(
      `line Squat Est. 1RM\nno-auto-y\nWeek 1 315\nWeek 7 395`,
      'light',
      palette
    );
    expect(tickValues(svg)).toContain(0);
  });
});
