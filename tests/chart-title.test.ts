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
import { JSDOM } from 'jsdom';
import { lintSvg, parseTransform } from './stress/lint';
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
    // The second line hangs under the first, on the title's left edge.
    expect(long.svg).toMatch(
      /<tspan x="[\d.]+" dy="24">Failure Category<\/tspan>/
    );
    const dy = firstCellY(long.svg) - firstCellY(short.svg);
    expect(dy).toBeCloseTo(TITLE_LINE_HEIGHT, 5);
  });
});

// The top edge of everything drawn below the title: circles, rects and text,
// in canvas coordinates. Full-width backgrounds and the title are skipped.
function plotTop(svg: string): number {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const root = doc.documentElement;
  const vbW = Number((root.getAttribute('viewBox') ?? '').split(/[\s,]+/)[2]);
  const yOf = (el: Element, x: number, y: number) => {
    let m = [1, 0, 0, 1, 0, 0];
    const chain: Element[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
    for (const n of chain.reverse()) {
      const t = parseTransform(n.getAttribute('transform'));
      m = [
        m[0]! * t[0] + m[2]! * t[1],
        m[1]! * t[0] + m[3]! * t[1],
        m[0]! * t[2] + m[2]! * t[3],
        m[1]! * t[2] + m[3]! * t[3],
        m[0]! * t[4] + m[2]! * t[5] + m[4]!,
        m[1]! * t[4] + m[3]! * t[5] + m[5]!,
      ];
    }
    return m[1]! * x + m[3]! * y + m[5]!;
  };
  const num = (el: Element, a: string) => parseFloat(el.getAttribute(a) ?? '');
  let top = Infinity;
  for (const el of Array.from(doc.querySelectorAll('circle, rect, text'))) {
    if (el.closest('text.chart-title, defs, clipPath, mask, title')) continue;
    if (el.getAttribute('opacity') === '0') continue;
    const tag = el.tagName.toLowerCase();
    let y: number;
    if (tag === 'circle') {
      const cx = num(el, 'cx') || 0;
      y = yOf(el, cx, (num(el, 'cy') || 0) - num(el, 'r'));
    } else if (tag === 'rect') {
      const w = num(el, 'width');
      if (!(w > 0) || w >= vbW * 0.95) continue;
      y = yOf(el, num(el, 'x') || 0, num(el, 'y') || 0);
    } else {
      // Positioned by its own y, its first tspan's, or its own transform.
      const at = el.hasAttribute('y') ? el : el.querySelector('tspan[y]');
      if (!el.textContent?.trim()) continue;
      if (!at && !el.hasAttribute('transform')) continue;
      const fs = parseFloat(el.getAttribute('font-size') ?? '') || 12;
      y = at
        ? yOf(el, num(at, 'x') || 0, num(at, 'y')) - fs * 0.8
        : yOf(el, 0, 0) - fs * 0.8;
    }
    if (Number.isFinite(y)) top = Math.min(top, y);
  }
  return top;
}

describe('every renderer that draws a chart title wraps it and pushes its plot down', () => {
  // Wider than any export canvas, so every renderer must wrap it.
  const HUGE =
    'Quarterly Incident Count by Service Owner Team and Failure Category Across Every Production Region With Escalations and Rollbacks Broken Out Separately';
  const cases = [
    'arc',
    'slope',
    'quadrant',
    'venn',
    'wordcloud',
    'timeline',
    'timeline-grouped',
  ];
  const opts = { theme: 'light', palette: 'nord' } as const;
  const titleLines = (svg: string) => {
    const t = /<text class="chart-title"[^>]*>([\s\S]*?)<\/text>/.exec(svg);
    return t ? (t[1]!.match(/<tspan/g) ?? []).length : -1;
  };
  const key = (f: { rule: string; detail: string }) => `${f.rule}: ${f.detail}`;

  it.each(cases)(
    '%s: a title wider than the canvas takes two lines, pushes the plot down and adds no lint finding',
    async (name) => {
      const src = readFileSync(
        join(__dirname, '..', 'gallery', 'fixtures', `${name}.dgmo`),
        'utf8'
      );
      const withTitle = (t: string) =>
        src.replace(/^(\w+) .*$/m, (_m, kw: string) => `${kw} ${t}`);
      const long = await render(withTitle(HUGE), opts);
      const short = await render(withTitle('Short'), opts);
      expect(long.svg).not.toBe('');
      expect(titleLines(long.svg)).toBe(2);
      const before = new Set(lintSvg(short.svg).map(key));
      const added = lintSvg(long.svg)
        .map(key)
        .filter((k) => !before.has(k) && !k.includes('Short'));
      expect(added).toEqual([]);
      // The plot moves down: by the whole extra line where it is top-anchored,
      // by about half where it is centred in what is left (wordcloud).
      expect(plotTop(long.svg) - plotTop(short.svg)).toBeGreaterThanOrEqual(
        TITLE_LINE_HEIGHT / 2 - 1
      );
    }
  );
});
