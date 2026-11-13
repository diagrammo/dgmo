// #1837: a heatmap keys its colour ramp with a colour bar in the legend, and
// `scale diverging <mid>` colours values below and above `mid` in two hues
// through a neutral at `mid`.
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';
import { renderDataChartD3 } from '../src/charts-d3';
import { parseExtendedChart } from '../src/data-chart-parser';
import { getPalette } from '../src/palettes';
import { shapeFill } from '../src/palettes/color-utils';

const slate = getPalette('slate').light;
const OPTS = { theme: 'light', palette: 'slate' } as const;

// Data from -4 to 8: with `scale diverging 0` the neutral sits a third of
// the way along the bar.
const SIGNED = `heatmap Margin vs Plan
columns Q1, Q2, Q3
North -4 0 8
South 2 -1 4`;

const PLAIN = `heatmap Support Load
columns Mon, Tue
Row1 5 8`;

function withDirective(src: string, directive: string): string {
  const lines = src.split('\n');
  lines.splice(1, 0, directive);
  return lines.join('\n');
}

function dom(svg: string): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = svg;
  return div;
}

function ramp(svg: string): {
  min: string | null;
  max: string | null;
  stops: Array<{ offset: string | null; color: string | null }>;
} | null {
  const d = dom(svg);
  const rect = d.querySelector('rect.dgmo-legend-gradient-ramp');
  if (!rect) return null;
  const id = /url\(#([^)]+)\)/.exec(rect.getAttribute('fill') ?? '')?.[1];
  const grad = id ? d.querySelector(`[id="${id}"]`) : null;
  return {
    min: rect.getAttribute('data-ramp-min'),
    max: rect.getAttribute('data-ramp-max'),
    stops: Array.from(grad?.querySelectorAll('stop') ?? []).map((s) => ({
      offset: s.getAttribute('offset'),
      color: s.getAttribute('stop-color'),
    })),
  };
}

function cellFill(svg: string, row: string, col: string): string | null {
  return (
    dom(svg)
      .querySelector(`rect[data-row-key="${row}"][data-col-key="${col}"]`)
      ?.getAttribute('fill') ?? null
  );
}

describe('heatmap colour bar (#1837)', () => {
  it('a static render keys the default ramp: data range and its four hues', async () => {
    const { svg } = await render(PLAIN, OPTS);
    const r = ramp(svg);
    expect(r).not.toBeNull();
    expect(r!.min).toBe('5');
    expect(r!.max).toBe('8');
    const hues = [
      slate.primary,
      slate.colors.cyan,
      slate.colors.yellow,
      slate.colors.orange,
    ].map((c) => shapeFill(slate, c, false));
    expect(r!.stops.map((s) => s.color)).toEqual(hues);
    // The bar's ends are the colours of the lowest and highest cells.
    expect(cellFill(svg, 'Row1', 'Mon')).toBe(hues[0]);
    expect(cellFill(svg, 'Row1', 'Tue')).toBe(hues[3]);
    // A colour bar is unreadable without the name of what it measures.
    expect(svg).toContain('>Value</text>');
  });

  it('the app preview draws the same bar inside its capsule', async () => {
    const svg = await renderDataChartD3(
      PLAIN,
      'light',
      slate,
      { width: 600, height: 400 },
      true
    );
    const r = ramp(svg);
    expect(r).not.toBeNull();
    expect(r!.stops).toHaveLength(4);
  });

  it('the grid starts below the legend, not under it', async () => {
    const { svg } = await render(PLAIN, OPTS);
    const d = dom(svg);
    // The legend's vertical place is on the nearest ancestor that moves it down.
    let legend: Element | null | undefined = d.querySelector('g.chart-legend');
    while (
      legend &&
      !/translate\(0,/.test(legend.getAttribute('transform') ?? '')
    )
      legend = legend.parentElement;
    const legendY = Number(
      /translate\(0,([\d.]+)\)/.exec(
        legend?.getAttribute('transform') ?? ''
      )?.[1]
    );
    const firstCellY = Number(
      d.querySelector('rect[data-row-key]')?.getAttribute('y')
    );
    expect(legendY).toBeGreaterThan(0);
    expect(firstCellY).toBeGreaterThan(legendY + 20);
  });

  it('no-legend draws no bar', async () => {
    const { svg } = await render(withDirective(PLAIN, 'no-legend'), OPTS);
    expect(ramp(svg)).toBeNull();
  });
});

describe('heatmap scale diverging (#1837)', () => {
  it('parses the midpoint, and defaults it to 0', () => {
    const at = parseExtendedChart(
      withDirective(SIGNED, 'scale diverging 2.5'),
      slate
    );
    expect(at.type === 'heatmap' && at.heatmapScale).toEqual({
      kind: 'diverging',
      mid: 2.5,
    });
    const bare = parseExtendedChart(
      withDirective(SIGNED, 'scale diverging'),
      slate
    );
    expect(bare.type === 'heatmap' && bare.heatmapScale).toEqual({
      kind: 'diverging',
      mid: 0,
    });
  });

  it('colours below the midpoint blue, above it red, and the midpoint neutral', async () => {
    const { svg, diagnostics } = await render(
      withDirective(SIGNED, 'scale diverging 0'),
      OPTS
    );
    expect(diagnostics).toEqual([]);
    const blue = shapeFill(slate, slate.colors.blue, false);
    const red = shapeFill(slate, slate.colors.red, false);
    expect(cellFill(svg, 'North', 'Q1')).toBe(blue); // -4, the data minimum
    expect(cellFill(svg, 'North', 'Q2')).toBe(slate.surface); // 0, the midpoint
    expect(cellFill(svg, 'North', 'Q3')).toBe(red); // 8, the data maximum
    // A value just below the midpoint and one just above are different hues.
    expect(cellFill(svg, 'South', 'Q2')).not.toBe(cellFill(svg, 'South', 'Q1'));

    const r = ramp(svg)!;
    expect(r.min).toBe('-4');
    expect(r.max).toBe('8');
    expect(r.stops.map((s) => s.color)).toEqual([blue, slate.surface, red]);
    // The neutral sits at the midpoint's place on the bar: 4 of 12.
    expect(parseFloat(r.stops[1]!.offset!)).toBeCloseTo(100 / 3, 5);
  });

  it('a midpoint outside the data widens the bar to include it', async () => {
    const { svg } = await render(
      withDirective(PLAIN, 'scale diverging 20'),
      OPTS
    );
    const r = ramp(svg)!;
    expect(r.min).toBe('5');
    expect(r.max).toBe('20');
    // Every value is below the midpoint, so no cell reaches the red end.
    const red = shapeFill(slate, slate.colors.red, false);
    expect(cellFill(svg, 'Row1', 'Mon')).not.toBe(red);
    expect(cellFill(svg, 'Row1', 'Tue')).not.toBe(red);
  });

  it('two ramps on one page never share a gradient id', async () => {
    const a = (await render(PLAIN, OPTS)).svg;
    const b = (await render(withDirective(PLAIN, 'scale diverging 6'), OPTS))
      .svg;
    const id = (svg: string) =>
      /url\(#([^)]+)\)/.exec(
        dom(svg)
          .querySelector('rect.dgmo-legend-gradient-ramp')
          ?.getAttribute('fill') ?? ''
      )?.[1];
    expect(id(a)).toBeTruthy();
    expect(id(a)).not.toBe(id(b));
  });

  it('a scale it cannot read warns, and the line is not a data row', async () => {
    const { svg, diagnostics } = await render(
      withDirective(PLAIN, 'scale binned 5'),
      OPTS
    );
    expect(diagnostics.map((d) => d.code)).toEqual(['W_HEATMAP_SCALE_INVALID']);
    expect(dom(svg).querySelector('rect[data-row-key="scale binned"]')).toBe(
      null
    );
    expect(ramp(svg)!.stops).toHaveLength(4);
  });
});
