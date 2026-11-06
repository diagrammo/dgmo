// A chart title wider than its canvas is fitted, never left to run off both
// edges (diagrammo/diagrammo#1718).
import { describe, expect, it } from 'vitest';
import * as d3Selection from 'd3-selection';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../src/render';
import {
  drawnTitleExtraHeight,
  renderChartTitle,
} from '../src/utils/d3-helpers';
import { measureText } from '../src/utils/text-measure';
import {
  TITLE_FONT_SIZE,
  TITLE_LINE_HEIGHT,
  TITLE_SIDE_PAD,
} from '../src/utils/title-constants';

const LONG = 'Incident Count by Service Owner Team and Failure Category';

function newSvg() {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  return d3Selection.select(el as SVGSVGElement);
}

const widthOf = (s: string) => measureText(s, TITLE_FONT_SIZE, { bold: true });

describe('renderChartTitle fits the title to the canvas', () => {
  it('draws a title that fits as one plain text, and reserves nothing extra', () => {
    const svg = newSvg();
    const extra = renderChartTitle(svg, 'Short title', 1, 480, '#000');
    const t = svg.select('text.chart-title');
    expect(extra).toBe(0);
    expect(t.text()).toBe('Short title');
    expect(t.selectAll('tspan').size()).toBe(0);
    expect(t.select('title').empty()).toBe(true);
  });

  it('wraps a long title to two lines inside the canvas and returns the extra line', () => {
    expect(widthOf(LONG)).toBeGreaterThan(480);
    const svg = newSvg();
    const extra = renderChartTitle(svg, LONG, 1, 480, '#000', undefined, 2);
    const lines = svg
      .selectAll<SVGTSpanElement, unknown>('text.chart-title tspan')
      .nodes()
      .map((n) => n.textContent ?? '');
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe(LONG);
    for (const l of lines)
      expect(widthOf(l)).toBeLessThanOrEqual(480 - 2 * TITLE_SIDE_PAD);
    expect(extra).toBe(TITLE_LINE_HEIGHT);
    expect(drawnTitleExtraHeight(svg)).toBe(TITLE_LINE_HEIGHT);
    // Nothing was cut, so no hover copy.
    expect(svg.select('text.chart-title title').empty()).toBe(true);
  });

  it('ends the last line in an ellipsis when two lines do not hold it, keeping the full title as a hover title', () => {
    const svg = newSvg();
    renderChartTitle(svg, LONG, 1, 240, '#000', undefined, 2);
    const t = svg.select('text.chart-title');
    const lines = t
      .selectAll<SVGTSpanElement, unknown>('tspan')
      .nodes()
      .map((n) => n.textContent ?? '');
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    for (const l of lines)
      expect(widthOf(l)).toBeLessThanOrEqual(240 - 2 * TITLE_SIDE_PAD);
    expect(t.select('title').text()).toBe(LONG);
  });

  it('truncates in place by default, so a caller that cannot push its plot down stays one line', () => {
    const svg = newSvg();
    const extra = renderChartTitle(svg, LONG, 1, 480, '#000');
    const t = svg.select('text.chart-title');
    expect(extra).toBe(0);
    expect(t.selectAll('tspan').size()).toBe(0);
    const shown = (t.node() as SVGTextElement).firstChild!.textContent!;
    expect(shown.endsWith('…')).toBe(true);
    expect(widthOf(shown)).toBeLessThanOrEqual(480 - 2 * TITLE_SIDE_PAD);
    expect(t.select('title').text()).toBe(LONG);
  });
});

describe('a wrapped title pushes the chart down', () => {
  const fixture = readFileSync(
    join(
      __dirname,
      '..',
      'stress/heatmap/long-labels--row-and-column-names.dgmo'
    ),
    'utf8'
  );
  // The first data cell: a heatmap draws cells as rects keyed by row.
  const firstCellY = (svg: string) =>
    Number(/<rect[^>]*\sy="([\d.]+)"[^>]*data-row-key=/.exec(svg)![1]);

  it('heatmap: the stress fixture title wraps and its cells start one title line lower', async () => {
    const long = await render(fixture, { theme: 'light', palette: 'nord' });
    const short = await render(
      fixture.replace(/^heatmap .*$/m, 'heatmap Incidents'),
      { theme: 'light', palette: 'nord' }
    );
    expect(long.svg).toContain(
      '<tspan x="240" dy="24">Failure Category</tspan>'
    );
    const dy = firstCellY(long.svg) - firstCellY(short.svg);
    expect(dy).toBeCloseTo(TITLE_LINE_HEIGHT, 5);
  });
});
