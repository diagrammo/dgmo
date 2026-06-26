import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

function build(input: string) {
  return { parsed: parseChart(input, palette) };
}

const DUAL = `line Oil Price vs Reserve
series
  y-label $ / barrel
    Oil Price blue
  y-right-label Million barrels
    SPR Size green
    China Reserves orange

2020 40 640 500
2021 68 620 420
2022 95 372 690`;

describe('dual-axis line — parser', () => {
  it('assigns each series to its group axis in document order', () => {
    const { parsed } = build(DUAL);
    expect(parsed.seriesNames).toEqual([
      'Oil Price',
      'SPR Size',
      'China Reserves',
    ]);
    expect(parsed.seriesAxes).toEqual(['left', 'right', 'right']);
  });

  it('uses the axis headers as the left/right axis labels', () => {
    const { parsed } = build(DUAL);
    expect(parsed.ylabel).toBe('$ / barrel');
    expect(parsed.yrlabel).toBe('Million barrels');
  });

  it('still peels per-series trailing colors in grouped form', () => {
    const { parsed } = build(DUAL);
    expect(parsed.seriesNameColors).toBeDefined();
    expect(parsed.seriesNameColors?.filter(Boolean).length).toBe(3);
  });

  it('maps data-row values positionally across both groups', () => {
    const { parsed } = build(DUAL);
    const row2020 = parsed.data.find((d) => d.label === '2020');
    expect(row2020?.value).toBe(40); // Oil (left)
    expect(row2020?.extraValues).toEqual([640, 500]); // SPR, China (right)
  });

  it('series before any header default to the left axis', () => {
    const { parsed } = build(
      `line\nseries\n  Early red\n  y-right-label Secondary\n    Late green\n\nA 1 2\nB 3 4`
    );
    expect(parsed.seriesAxes).toEqual(['left', 'right']);
  });

  it('caps at two axes — a second y-right-label header merges into right', () => {
    const { parsed } = build(
      `line\nseries\n  y-label L\n    A blue\n  y-right-label R1\n    B green\n  y-right-label R2\n    C orange\n\nx 1 2 3`
    );
    expect(parsed.seriesAxes).toEqual(['left', 'right', 'right']);
  });

  it('leaves seriesAxes undefined for a flat single-axis series block', () => {
    const { parsed } = build(
      `line\nseries\n  A blue\n  B green\n\nJan 10 20\nFeb 30 40`
    );
    expect(parsed.seriesAxes).toBeUndefined();
  });

  it('leaves seriesAxes undefined when a group block has only a left axis', () => {
    const { parsed } = build(
      `line\nseries\n  y-label Only Left\n    A blue\n    B green\n\nJan 10 20\nFeb 30 40`
    );
    expect(parsed.seriesAxes).toBeUndefined();
    expect(parsed.ylabel).toBe('Only Left');
  });
});

describe('dual-axis line — diagnostics', () => {
  it('drops the secondary axis and warns on a non-line chart type', () => {
    const { parsed } = build(
      `bar\nseries\n  y-label L\n    A blue\n  y-right-label R\n    B green\n\nJan 10 20`
    );
    expect(parsed.seriesAxes).toBeUndefined();
    expect(parsed.yrlabel).toBeUndefined();
    expect(
      parsed.diagnostics.some((d) => /only supported on line/i.test(d.message))
    ).toBe(true);
  });

  it('warns when y-right-label has no series assigned to the right', () => {
    const { parsed } = build(`line\ny-right-label Orphan\n\nJan 10\nFeb 20`);
    expect(
      parsed.diagnostics.some((d) =>
        /no series is assigned to the right axis/i.test(d.message)
      )
    ).toBe(true);
  });
});

describe('dual-axis line — D3 renderer', () => {
  it('renders both axis titles in the SVG', async () => {
    const svg = await renderDataChartD3(DUAL, 'light', palette);
    expect(svg).toContain('$ / barrel');
    expect(svg).toContain('Million barrels');
    // three series groups
    expect((svg.match(/class="dgmo-series"/g) ?? []).length).toBe(3);
  });

  it('a flat single-axis chart has no right-axis label', async () => {
    const svg = await renderDataChartD3(
      `line\nseries\n  A blue\n  B green\nx-label X\ny-label Y\n\nJan 10 20\nFeb 30 40`,
      'light',
      palette
    );
    expect(svg).toContain('Y');
    expect(svg).not.toContain('Million barrels');
  });
});
