// Uncertainty bands on line (#1981): `band <label> <low> <high>` shades
// between two declared series, tinted with the low series' colour, and the
// two bounds are not drawn as lines. One test per rule decided 2026-11-13.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { select } from 'd3-selection';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import { renderLine } from '../src/charts-d3/line';
import { getSimpleChartLegendGroups } from '../src/data-chart-parser';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

const palette = getPalette('nord').light;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string): Promise<HTMLDivElement> {
  host.innerHTML = await renderDataChartD3(src, 'light', palette);
  return host;
}

const FORECAST = `line Cargo forecast
series
  Actual blue
  Low green
  High red
band Forecast Low High

Jan 10 8 12
Feb 12 9 15
Mar 11 7 16
Apr 14 9 20`;

const bandPath = (h: HTMLElement) =>
  h.querySelector('g.dgmo-series-band path')!;
const lineNames = (h: HTMLElement) =>
  [...h.querySelectorAll('g.dgmo-series')].map((g) =>
    g.getAttribute('data-series-name')
  );

describe('series band parse', () => {
  it('resolves the label and the two bounds', () => {
    const c = parseChart(FORECAST, palette);
    expect(c.seriesBands).toEqual([
      { label: 'Forecast', low: 1, high: 2, lineNumber: 6 },
    ]);
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('takes a multi-word label and multi-word series names', () => {
    const c = parseChart(
      `line X
series
  Actual
  P10 Low
  P90 High
band Likely range P10 Low P90 High
A 1 2 3
B 2 3 4`,
      palette
    );
    expect(c.seriesBands?.[0]).toMatchObject({
      label: 'Likely range',
      low: 1,
      high: 2,
    });
  });

  it('errors on a bound that is not a declared series', () => {
    const c = parseChart(
      FORECAST.replace('band Forecast Low High', 'band Forecast Low Hihg'),
      palette
    );
    expect(c.seriesBands).toBeUndefined();
    const err = c.diagnostics.find((d) => d.severity === 'error');
    expect(err?.line).toBe(6);
    expect(err?.message).toContain('"Hihg" is not a declared series');
  });

  it('keeps a value band and a data row named band apart', () => {
    const c = parseChart('line X\nband 40..60 Normal\nband 5\nB 6', palette);
    expect(c.seriesBands).toBeUndefined();
    expect(c.annotations?.[0]?.kind).toBe('band');
    expect(c.data.map((d) => d.label)).toEqual(['band', 'B']);
  });

  it('warns and ignores a band on another chart type', () => {
    const c = parseChart(
      'bar X\ngroup\n  Low\n  High\nband F Low High\nA 1 2',
      palette
    );
    expect(c.seriesBands).toBeUndefined();
    expect(c.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });
});

describe('series band render', () => {
  it('tints the band with the low series colour at reduced opacity', async () => {
    const h = await draw(FORECAST);
    const p = bandPath(h);
    expect(p.getAttribute('fill')).toBe(palette.colors.green);
    expect(Number(p.getAttribute('fill-opacity'))).toBeLessThan(0.5);
  });

  it('does not draw the low and high series as lines', async () => {
    const h = await draw(FORECAST);
    expect(lineNames(h)).toEqual(['Actual']);
  });

  it('lists the band in the legend once, and not its bounds', () => {
    const groups = getSimpleChartLegendGroups(parseChart(FORECAST, palette), [
      palette.colors.blue,
    ]);
    expect(groups[0]!.entries.map((e) => e.value)).toEqual([
      'Actual',
      'Forecast',
    ]);
    expect(groups[0]!.entries[1]!.color).toBe(palette.colors.green);
  });

  it('follows the stepped shape under step and step-before', async () => {
    const plain = bandPath(await draw(FORECAST)).getAttribute('d')!;
    const after = bandPath(
      await draw(FORECAST.replace('band', 'step\nband'))
    ).getAttribute('d')!;
    const before = bandPath(
      await draw(FORECAST.replace('band', 'step-before\nband'))
    ).getAttribute('d')!;
    const vertices = (d: string) => d.split(/[ML]/).filter(Boolean).length;
    // Four rows, two edges: 8 vertices straight; a step adds one per gap.
    expect(vertices(plain)).toBe(8);
    expect(vertices(after)).toBe(14);
    expect(vertices(before)).toBe(14);
    expect(after).not.toBe(before);
  });

  it('counts toward the auto-fit y range', async () => {
    // The high bound (90) is far above every drawn line value.
    const h = await draw(`line X
series
  Actual
  Low
  High
band Range Low High
A 10 9 90
B 11 9 12`);
    const ticks = [...h.querySelectorAll('text.dgmo-tick')].map((t) =>
      Number(t.textContent!.replace(/,/g, ''))
    );
    expect(Math.max(...ticks.filter(Number.isFinite))).toBeGreaterThanOrEqual(
      90
    );
  });

  it('highlight greys the band when another series is the subject', async () => {
    const h = await draw(FORECAST.replace('band', 'highlight Actual\nband'));
    expect(bandPath(h).getAttribute('fill')).toBe(
      storyGround(palette, false).groundFill
    );
  });

  it('highlight on the band keeps its colour and greys the lines', async () => {
    const h = await draw(FORECAST.replace('band', 'highlight Forecast\nband'));
    expect(bandPath(h).getAttribute('fill')).toBe(palette.colors.green);
    const line = h.querySelector('g.dgmo-series path.dgmo-series-line')!;
    expect(line.getAttribute('stroke')).toBe(
      storyGround(palette, false).groundStroke
    );
  });

  it('breaks the band at a row missing either value', () => {
    // The language has no missing-value token yet, so the gap is driven
    // through the parsed chart directly.
    const chart = parseChart(FORECAST, palette);
    chart.data[2]!.extraValues = [NaN, 16];
    const svg = select(host).append('svg');
    renderLine(
      svg as never,
      chart,
      600,
      400,
      [palette.colors.blue, palette.colors.green, palette.colors.red],
      palette,
      false,
      palette.text,
      palette.textMuted,
      palette.bg,
      true
    );
    const d = bandPath(host).getAttribute('d')!;
    // Two separate runs: each closes on its own.
    expect(d.match(/M/g)).toHaveLength(2);
  });
});
