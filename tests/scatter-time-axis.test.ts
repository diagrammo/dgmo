// Time-x scatter (#2208): a scatter whose every x is a date or time places
// points on a to-scale time axis.
import { describe, it, expect } from 'vitest';
import { parseScatter } from '../src/data-chart-parser';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;
const render = async (src: string) => renderDataChartD3(src, 'light', palette);

function cxs(svg: string): number[] {
  return [...svg.matchAll(/<circle cx="([\d.]+)"[^>]*class="dgmo-datum"/g)].map(
    (m) => Number(m[1])
  );
}
function tickLabels(svg: string): string[] {
  return [
    ...svg.matchAll(/<text[^>]*class="dgmo-tick"[^>]*>(.*?)<\/text>/g),
  ].map((m) => m[1]!.replace(/<[^>]*>/g, ''));
}

describe('scatter time x parse', () => {
  it('parses a date-time x', async () => {
    const p = parseScatter('scatter T\nDeploy 42 2026-11-21 06:30, 12');
    expect(p.scatterPoints).toHaveLength(1);
    expect(p.scatterPoints![0]).toMatchObject({
      name: 'Deploy 42',
      xLabel: '2026-11-21 06:30',
      y: 12,
    });
  });
  it('parses the T form and a size', async () => {
    const p = parseScatter('scatter T\nA 2026-11-21T06:30:15, 3, 9');
    expect(p.scatterPoints![0]).toMatchObject({
      name: 'A',
      xLabel: '2026-11-21T06:30:15',
      y: 3,
      size: 9,
    });
  });
  it('parses a bare time', async () => {
    const p = parseScatter('scatter T\nLunch 12:30, 5');
    expect(p.scatterPoints![0]).toMatchObject({
      name: 'Lunch',
      xLabel: '12:30',
      y: 5,
    });
  });
  it('leaves numeric x unchanged', async () => {
    const p = parseScatter('scatter T\nAlice 165 60\nBob 180 85 4');
    expect(p.scatterPoints![0]).toMatchObject({ name: 'Alice', x: 165, y: 60 });
    expect(p.scatterPoints![0]!.xLabel).toBeUndefined();
    expect(p.scatterPoints![1]).toMatchObject({ x: 180, y: 85, size: 4 });
  });
});

describe('scatter time x render', () => {
  const dates = `scatter Deploys
A 2026-01-01, 1
B 2026-01-02, 2
C 2026-01-11, 3
D 2026-01-06, 4`;
  it('spaces points by time, rows out of order', async () => {
    const [a, b, c, d] = cxs(await render(dates));
    expect(c! - a!).toBeGreaterThan(0);
    expect((b! - a!) / (c! - a!)).toBeCloseTo(0.1, 1);
    expect((d! - a!) / (c! - a!)).toBeCloseTo(0.5, 1);
  });
  it('draws time labels, not numbers, as ticks', async () => {
    const svg = await render(dates);
    const labels = tickLabels(svg);
    const svgHasTooltipLabel = svg.includes('data-value="(2026-01-11, 3)"');
    expect(labels.some((l) => /Jan|01-|2026/.test(l))).toBe(true);
    expect(svgHasTooltipLabel).toBe(true);
  });
  it('places bare times on one day without wrapping', async () => {
    const svg = await render(
      'scatter Day\nLate 23:00, 1\nEarly 01:00, 2\nNoon 12:00, 3'
    );
    const [late, early, noon] = cxs(svg);
    expect(early!).toBeLessThan(noon!);
    expect(noon!).toBeLessThan(late!);
    expect(tickLabels(svg).some((l) => /^\d{2}:\d{2}$/.test(l))).toBe(true);
  });
  it('warns on a mixed column and keeps the numeric points', async () => {
    const src = 'scatter M\nAlice 1 2\nBob 3 4\nCy 2026-01-01, 5';
    const p = parseScatter(src);
    expect(p.scatterPoints).toHaveLength(2);
    expect(p.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    expect(cxs(await render(src))).toHaveLength(2);
  });
  it('ignores a trend on a time axis without crashing', async () => {
    await expect(
      render(`${dates}
trend`)
    ).resolves.toBeTypeOf('string');
  });
});
