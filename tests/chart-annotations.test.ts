// Chart annotations (#1832, #2039): `marker` and `band`, parsed by one shared
// module and drawn through each chart's own axes.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 as renderDataChartD3Raw } from '../src/charts-d3';
import { flattenTabular } from './helpers/tabular-text';
import { parseAnnotationLine } from '../src/annotations/parse';
import { getPalette } from '../src/palettes';

// Labels are digit cells (#2035); read their text as one string.
const renderDataChartD3 = async (
  ...a: Parameters<typeof renderDataChartD3Raw>
): Promise<string> => flattenTabular(await renderDataChartD3Raw(...a));

const palette = getPalette('nord').light;

const parse = (line: string) => parseAnnotationLine(line, 1, [], palette);

/** The y (or x, horizontal) of the value tick labelled `text`. */
function tickPos(svg: string, text: string, axis: 'x' | 'y'): number {
  const re = new RegExp(`<text[^>]*${axis}="([\\d.]+)"[^>]*>${text}</text>`);
  const m = svg.match(re);
  if (!m) throw new Error(`no tick ${text}`);
  return Number(m[1]);
}

function markerLine(svg: string) {
  const m = svg.match(
    /class="dgmo-annotation-marker"[^>]*><line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="([\d.]+)"/
  );
  return m ? m.slice(1).map(Number) : null;
}

function bandRect(svg: string) {
  const m = svg.match(
    /class="dgmo-annotation-band"[^>]*><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/
  );
  return m ? m.slice(1).map(Number) : null;
}

describe('parseAnnotationLine', () => {
  it('reads a marker with a bare label and a trailing color', () => {
    const a = parse('marker 50 Sales target red');
    expect(a).toMatchObject({
      kind: 'marker',
      axisHint: null,
      text: '50 Sales target',
    });
    expect(a!.color).toBe(palette.colors.red);
  });

  it('keeps a final color word inside a quoted label', () => {
    expect(parse('marker 50 "Code red"')).toMatchObject({
      text: '50 "Code red"',
      color: null,
    });
    expect(parse('marker x 2020 Launch')).toMatchObject({ axisHint: 'x' });
  });

  it('reads a band and orders its ends', () => {
    expect(parse('band 60..40 Normal range')).toMatchObject({
      kind: 'band',
      from: 40,
      to: 60,
      label: 'Normal range',
    });
    expect(parse('band -1 .. 1')).toMatchObject({ from: -1, to: 1 });
  });

  it('leaves other lines alone', () => {
    expect(parse('band 5')).toBeNull();
    expect(parse('Jan 40')).toBeNull();
    expect(parse('markers 50')).toBeNull();
  });
});

describe('parseChart annotations', () => {
  it('keeps them on bar and line', () => {
    const c = parseChart('bar S\nmarker 50\nband 10..20\nA 40', palette);
    expect(c.annotations?.map((a) => a.kind)).toEqual(['marker', 'band']);
    expect(c.annotations![0]).toMatchObject({ axis: 'value', at: 50 });
    expect(c.data).toHaveLength(1);
    expect(c.diagnostics).toHaveLength(0);
  });

  it('warns and drops them on a chart with no value axis', () => {
    const c = parseChart('pie P\nmarker 5\nA 1\nB 2', palette);
    expect(c.annotations).toBeUndefined();
    expect(c.diagnostics[0]!.message).toContain(
      'only supported on bar, line, scatter and slope'
    );
  });

  it('says what a malformed one needs', () => {
    const c = parseChart('bar S\nmarker\nband 1..x\nA 4', palette);
    expect(c.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('marker needs a position'),
      expect.stringContaining('band needs two numbers'),
    ]);
    expect(c.data.map((d) => d.label)).toEqual(['A']);
  });

  it('still reads `band 5` as a data row', () => {
    const c = parseChart('bar S\nband 5\nA 4', palette);
    expect(c.data.map((d) => d.label)).toEqual(['band', 'A']);
  });
});

describe('drawn on the value axis', () => {
  it('bar: the marker sits on its value and the band spans its range', async () => {
    const svg = await renderDataChartD3(
      'bar S\nmarker 40 Target\nband 20..30 Normal\nA 50\nB 60\nC 10',
      'light',
      palette
    );
    const [, , y1, y2] = markerLine(svg)!;
    expect(y1).toBe(y2);
    // Tick labels sit 4px under their gridline.
    expect(y1).toBeCloseTo(tickPos(svg, '40', 'y') - 4, 5);
    const [, by, , bh] = bandRect(svg)!;
    expect(by).toBeCloseTo(tickPos(svg, '30', 'y') - 4, 5);
    expect(by + bh).toBeCloseTo(tickPos(svg, '20', 'y') - 4, 5);
    expect(svg).toContain('>Target</text>');
    expect(svg).toContain('>Normal</text>');
  });

  it('bar: a marker above the data widens the axis to reach it', async () => {
    const svg = await renderDataChartD3(
      'bar S\nmarker 100 Goal\nA 20\nB 30',
      'light',
      palette
    );
    const [, , y1] = markerLine(svg)!;
    expect(y1).toBeCloseTo(tickPos(svg, '100', 'y') - 4, 5);
  });

  it('horizontal bar: the marker is vertical, at its value', async () => {
    const svg = await renderDataChartD3(
      'bar S\norientation-horizontal\nmarker 40\nA 50\nB 60',
      'light',
      palette
    );
    const [x1, x2, y1, y2] = markerLine(svg)!;
    expect(x1).toBe(x2);
    expect(y2).toBeGreaterThan(y1);
    expect(x1).toBeCloseTo(tickPos(svg, '40', 'x'), 5);
  });

  it('line: a marker outside the data widens the auto-fit axis', async () => {
    const plain = await renderDataChartD3(
      'line T\nMon 12\nTue 18\nWed 25',
      'light',
      palette
    );
    expect(plain).not.toContain('>40</text>');
    const svg = await renderDataChartD3(
      'line T\nmarker 40 Limit\nband 0..5 Low\nMon 12\nTue 18\nWed 25',
      'light',
      palette
    );
    const [, , y1] = markerLine(svg)!;
    expect(y1).toBeCloseTo(tickPos(svg, '40', 'y') - 4, 5);
    const [, by, , bh] = bandRect(svg)!;
    expect(by + bh).toBeCloseTo(tickPos(svg, '0', 'y') - 4, 5);
  });

  it('a fixed axis end hides a marker past it, never pins it to the edge', async () => {
    const bar = await renderDataChartD3(
      'bar S\ny-max 100\nmarker 150 Limit\nA 50\nB 60',
      'light',
      palette
    );
    expect(markerLine(bar)).toBeNull();
    expect(bar).not.toContain('>Limit</text>');
    const line = await renderDataChartD3(
      'line S\ny-min 0\ny-max 100\nmarker 150 Hi\nmarker -20 Lo\nmarker 50 Mid\nA 10\nB 90',
      'light',
      palette
    );
    expect(line).not.toContain('>Hi</text>');
    expect(line).not.toContain('>Lo</text>');
    // 50 is halfway between the 40 and 60 gridlines.
    const mid = (tickPos(line, '40', 'y') + tickPos(line, '60', 'y')) / 2 - 4;
    expect(markerLine(line)![2]).toBeCloseTo(mid, 5);
  });

  it('a band off a fixed axis is not drawn; one partly on it is cut to the axis', async () => {
    const off = await renderDataChartD3(
      'bar S\ny-max 100\nband 160..200 Off\nA 50',
      'light',
      palette
    );
    expect(bandRect(off)).toBeNull();
    expect(off).not.toContain('>Off</text>');
    const part = await renderDataChartD3(
      'bar S\ny-max 100\nband 80..150 Part\nA 50',
      'light',
      palette
    );
    const [, by, , bh] = bandRect(part)!;
    expect(by).toBeCloseTo(tickPos(part, '100', 'y') - 4, 5);
    expect(by + bh).toBeCloseTo(tickPos(part, '80', 'y') - 4, 5);
  });

  it('a log axis widens to reach a marker above the data', async () => {
    for (const type of ['bar', 'line']) {
      const svg = await renderDataChartD3(
        `${type} S\ny-scale log\nmarker 5000 Goal\nA 20\nB 300`,
        'light',
        palette
      );
      expect(svg).toContain('>Goal</text>');
      const [, , y1] = markerLine(svg)!;
      // Decade ticks: 5000 sits between the 1K and 10K gridlines.
      expect(y1).toBeLessThan(tickPos(svg, '1,000', 'y') - 4);
      expect(y1).toBeGreaterThan(tickPos(svg, '10,000', 'y') - 4);
    }
  });

  it('a chart without annotations draws none', async () => {
    const svg = await renderDataChartD3('bar S\nA 1\nB 2', 'light', palette);
    expect(svg).not.toContain('dgmo-annotation');
  });
});
