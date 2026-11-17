// The annotation vocabulary on data charts (#2039): `marker` on either axis,
// `era` on bar, `note` on bar, line, scatter and slope, and the end-of-line
// series names on line (#1950).
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseVisualization } from '../src/visualizations/parse';
import { renderDataChartD3 } from '../src/charts-d3';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { labelBox } from '../src/utils/place-labels';
import { flattenTabular } from './helpers/tabular-text';

const palette = getPalette('nord').light;
const messages = (d: { diagnostics: { message: string }[] }) =>
  d.diagnostics.map((x) => x.message);

/** The [x1, x2, y1, y2] of every marker line. */
function markerLines(svg: string): number[][] {
  return [
    ...svg.matchAll(
      /class="dgmo-annotation-marker"[^>]*><line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="([\d.]+)"/g
    ),
  ].map((m) => m.slice(1).map(Number));
}

const noteCount = (svg: string) =>
  (svg.match(/class="dgmo-chart-note"/g) ?? []).length;

describe('marker', () => {
  it('a known category is a category-axis line on bar and line', async () => {
    const c = parseChart('bar S\nmarker Q3 Price change\nQ1 4\nQ2 5\nQ3 6');
    expect(c.annotations).toEqual([
      expect.objectContaining({
        axis: 'cross',
        at: 'Q3',
        label: 'Price change',
      }),
    ]);
    for (const type of ['bar', 'line']) {
      const svg = await renderDataChartD3(
        `${type} S\nmarker Q2 Launch\nQ1 4\nQ2 5\nQ3 6`,
        'light',
        palette
      );
      const [[x1, x2, y1, y2]] = markerLines(svg) as [number[]];
      expect(x1).toBe(x2);
      expect(y2).toBeGreaterThan(y1!);
      expect(svg).toContain('>Launch</text>');
    }
  });

  it('a multi-word category matches before the label', () => {
    const c = parseChart(
      'line S\nmarker Port Royal Raid\nNassau 4\nPort Royal 5'
    );
    expect(c.annotations?.[0]).toMatchObject({
      at: 'Port Royal',
      label: 'Raid',
    });
  });

  it('numeric categories need marker x or marker y, and say so', () => {
    const src = 'line S\n2020 4\n2021 5\n2022 6';
    const bare = parseChart(`${src}\nmarker 2021 Launch`);
    expect(bare.annotations).toBeUndefined();
    expect(messages(bare).join()).toContain('marker x 2021');
    const x = parseChart(`${src}\nmarker x 2021 Launch`);
    expect(x.annotations?.[0]).toMatchObject({ axis: 'cross', at: '2021' });
    const y = parseChart(`${src}\nmarker y 5 Target`);
    expect(y.annotations?.[0]).toMatchObject({ axis: 'value', at: 5 });
  });

  it('a name that matches no category warns and draws nothing', () => {
    const c = parseChart('bar S\nmarker Q9 Never\nQ1 4');
    expect(c.annotations).toBeUndefined();
    expect(messages(c)).toEqual([
      expect.stringContaining('no category by that name'),
    ]);
  });

  it('ref-line is gone', () => {
    const c = parseChart('bar S\nref-line 50\nA 4');
    expect(c.annotations).toBeUndefined();
  });

  it('scatter: marker is y, marker x is x, band x shades an x range', async () => {
    const src =
      'scatter S\nmarker 5 Target\nmarker x 3 Launch\nband x 1..2 Early\nA 1 2\nB 4 8';
    const p = parseExtendedChart(src);
    expect(p.diagnostics).toEqual([]);
    const svg = await renderDataChartD3(src, 'light', palette);
    const lines = markerLines(svg);
    expect(lines).toHaveLength(2);
    expect(lines.filter(([x1, x2]) => x1 === x2)).toHaveLength(1);
    expect(svg).toContain('dgmo-annotation-band');
    expect(svg).toContain('>Early</text>');
  });

  it('band x warns on a chart whose x axis is categories', () => {
    expect(messages(parseChart('bar S\nband x 1..2\nA 4')).join()).toContain(
      'band x needs a numeric x axis'
    );
  });

  it('slope: marker and band draw on the value range', async () => {
    const src =
      'slope S\nperiod 2020 2024\nmarker y 50 Target\nband 10..20 Low\nA 40 60\nB 30 15';
    expect(parseVisualization(src).diagnostics).toEqual([]);
    const svg = await renderForExport(src, 'light', palette);
    expect(svg).toContain('dgmo-annotation-marker');
    expect(svg).toContain('dgmo-annotation-band');
  });
});

describe('era on bar', () => {
  it('draws a span over the named categories', async () => {
    const svg = await renderDataChartD3(
      'bar S\nera Tortuga -> Nassau Golden age\nPort Royal 3\nTortuga 4\nNassau 5',
      'light',
      palette
    );
    expect(svg).toContain('class="dgmo-era"');
    expect(svg).toContain('>Golden age</text>');
  });

  it('warns on a chart with no ordered axis', () => {
    expect(messages(parseChart('pie P\nera A -> B Span\nA 1\nB 2'))).toEqual([
      expect.stringContaining('"era" is only supported on line and bar'),
    ]);
  });
});

describe('note', () => {
  it('names one bar, or one point with series @ position', () => {
    const bar = parseChart('bar S\nnote Q2 Frankfurt opens\nQ1 4\nQ2 5');
    expect(bar.notes).toEqual([
      expect.objectContaining({ series: 0, index: 1, text: 'Frankfurt opens' }),
    ]);
    const line = parseChart(
      'line S\nseries EMEA, APAC\nnote APAC @ Q2 Frankfurt opens\nQ1 4 5\nQ2 5 6'
    );
    expect(line.notes?.[0]).toMatchObject({ series: 1, index: 1 });
  });

  it('quotes a multi-word name and takes an indented body', () => {
    const c = parseChart(
      'bar S\nnote "Port Royal" Sacked\n  by **Morgan**\nNassau 4\nPort Royal 5'
    );
    expect(c.notes?.[0]).toMatchObject({
      index: 1,
      text: 'Sacked\nby **Morgan**',
    });
    expect(c.data).toHaveLength(2);
  });

  it('warns on no target, no match, a whole column and a whole series', () => {
    const c = parseChart(
      [
        'line S',
        'series EMEA, APAC',
        'note',
        '  A caption',
        'note Q9 Lost',
        'note Q1 Column',
        'note EMEA Series',
        'note EMEA @ Q1',
        'Q1 4 5',
      ].join('\n')
    );
    expect(c.notes).toBeUndefined();
    expect(messages(c)).toEqual([
      expect.stringContaining('use footnote'),
      expect.stringContaining('matches nothing'),
      expect.stringContaining('marker Q1'),
      expect.stringContaining('names a whole series'),
      expect.stringContaining('has no text'),
    ]);
  });

  it('draws a ring, a leader and the text on bar, line, scatter and slope', async () => {
    const cases = [
      'bar S\nnote Q2 Frankfurt opens\nQ1 4\nQ2 5\nQ3 3',
      'line S\nnote Q2 Frankfurt opens\nQ1 4\nQ2 5\nQ3 3',
      'scatter S\nnote B Frankfurt opens\nA 1 2\nB 4 8\nC 6 3',
    ];
    for (const src of cases) {
      const svg = await renderDataChartD3(src, 'light', palette);
      expect(noteCount(svg)).toBe(1);
      expect(svg).toContain('dgmo-chart-note-ring');
      expect(svg).toContain('Frankfurt opens');
    }
    const slope = await renderForExport(
      'slope S\nperiod 2020 2024\nnote Rust @ 2024 Overtakes Go\nRust 20 60\nGo 40 50',
      'light',
      palette
    );
    expect(noteCount(slope)).toBe(1);
  });

  it('every note is drawn, even when the plot is crowded', async () => {
    const notes = ['Q1', 'Q2', 'Q3', 'Q4']
      .map((q) => `note ${q} A long note about what happened in ${q}`)
      .join('\n');
    const svg = await renderDataChartD3(
      `bar S\n${notes}\nQ1 4\nQ2 5\nQ3 6\nQ4 7`,
      'light',
      palette,
      { width: 360, height: 240 }
    );
    expect(noteCount(svg)).toBe(4);
  });

  it('no-notes hides them', async () => {
    const svg = await renderDataChartD3(
      'line S\nno-notes\nnote Q2 Hidden\nQ1 4\nQ2 5',
      'light',
      palette
    );
    expect(noteCount(svg)).toBe(0);
  });

  it('stays full strength under highlight', async () => {
    const svg = await renderDataChartD3(
      'bar S\nhighlight Q1\nnote Q2 Still here\nQ1 4\nQ2 5',
      'light',
      palette
    );
    expect(svg).toMatch(/class="dgmo-chart-note" data-line-number="3">/);
  });

  it('a point value under a note yields to it', async () => {
    const svg = await renderDataChartD3(
      'line S\nnote Q2 Frankfurt opens\nQ1 4\nQ2 5\nQ3 4.5',
      'light',
      palette
    );
    const note = svg.match(
      /class="dgmo-chart-note"[\s\S]*?<text x="([\d.]+)" y="([\d.]+)"/
    )!;
    const box = labelBox(
      'Frankfurt opens',
      { x: Number(note[1]), y: Number(note[2]), anchor: 'start' },
      11
    );
    for (const m of svg.matchAll(
      /<text x="([\d.]+)" y="([\d.]+)" text-anchor="(\w+)"[^>]*font-size="12"[^>]*>([\d.]+)<\/text>/g
    )) {
      const v = labelBox(
        m[4]!,
        { x: Number(m[1]), y: Number(m[2]), anchor: m[3] as 'middle' },
        12
      );
      const overlap =
        v.x < box.x + box.w &&
        box.x < v.x + v.w &&
        v.y < box.y + box.h &&
        box.y < v.y + v.h;
      expect(overlap).toBe(false);
    }
  });

  it('warns on a chart type that does not take notes', () => {
    expect(messages(parseChart('pie P\nnote A Big\nA 1\nB 2'))).toEqual([
      expect.stringContaining('"note" is only supported on bar, line'),
    ]);
  });
});

describe('end-of-line series names on line (#1950)', () => {
  const src = [
    'line Fleet',
    'series',
    '  Cutlass Crew',
    '  Powder Monkeys',
    '  Rigging Rats',
    'Nassau 4.2 1.1 0.6',
    'Tortuga 6.5 1.9 0.9',
    'Kingston 11.4 5.1 3.0',
  ].join('\n');

  it('draws each name at the right end of its line, clear of the others', async () => {
    const svg = await renderDataChartD3(src, 'light', palette);
    const names = [
      ...svg.matchAll(
        /class="dgmo-series-end-label" data-series-name="([^"]+)" x="([\d.]+)" y="([\d.]+)"/g
      ),
    ].map((m) => ({ name: m[1]!, x: Number(m[2]), y: Number(m[3]) }));
    expect(names.map((n) => n.name)).toEqual([
      'Cutlass Crew',
      'Powder Monkeys',
      'Rigging Rats',
    ]);
    const ys = names.map((n) => n.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++)
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(12);
    // Point values stay on by default.
    expect(flattenTabular(svg)).toContain('>11.4</text>');
  });

  it('a single line keeps its plain look', async () => {
    const svg = await renderDataChartD3('line S\nA 1\nB 2', 'light', palette);
    expect(svg).not.toContain('dgmo-series-end-label');
  });
});
