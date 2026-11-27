// @vitest-environment jsdom
// dot-long-series-names.test.ts — long series names wrap, then end in `…`,
// never overlapping each other, the first row's name or the canvas edge
// (#2433).

import { describe, expect, it } from 'vitest';
import { parseDot } from '../src/dot/parser';
import { renderDot } from '../src/dot/renderer';
import { TICK_FONT, VALUE_FONT } from '../src/charts-d3/shared';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';

const palette = getPalette('nord').light;
const LONG = (w: string) =>
  `${w} measured across every regional office and every reporting quarter of the fiscal year in review`;

const src = [
  'dot Long labels',
  `series ${LONG('Baseline')}, ${LONG('Follow-up')}`,
  '',
  `${LONG('Northern')} 40 72`,
  `${LONG('Southern')} 55 61`,
].join('\n');

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
/** One box per drawn line of a `<text>`, measured as drawn. */
function boxes(t: Element, font: number, bold: boolean): Box[] {
  const anchor = t.getAttribute('text-anchor') ?? 'start';
  const spans = [...t.querySelectorAll('tspan')];
  const parts = spans.length ? spans : [t];
  let y = 0;
  return parts.map((el, k) => {
    const x = Number(el.getAttribute('x') ?? t.getAttribute('x'));
    const ownY = el.getAttribute('y');
    const dy = el.getAttribute('dy');
    if (ownY !== null) y = Number(ownY) + (dy === '0.33em' ? 0.33 * font : 0);
    else if (k > 0) y += Number(dy);
    const w = measureText(el.textContent ?? '', font, { bold });
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    return { x0, x1: x0 + w, y0: y - 0.75 * font, y1: y + 0.2 * font };
  });
}
const overlap = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('dot long series names (#2433)', () => {
  for (const [width, height] of [
    [960, 480],
    [600, 400],
  ] as const)
    it(`wrap, cut and keep clear at ${width}×${height}`, () => {
      const parsed = parseDot(src);
      expect(parsed.error).toBeNull();
      const c = document.createElement('div');
      renderDot(c, parsed, palette, false, undefined, { width, height });
      const labels = [...c.querySelectorAll('.dot-series-label')];
      expect(labels).toHaveLength(2);
      const series = labels.map((t) => boxes(t, VALUE_FONT, true));
      // Wrapped to at most two lines, cut, the full text kept.
      for (const [s, t] of labels.entries()) {
        expect(t.querySelectorAll('tspan').length).toBeLessThanOrEqual(2);
        expect(t.getAttribute('data-full-text')).toBe(parsed.series[s]!.name);
        expect(t.textContent).toContain('…');
      }
      expect(c.querySelectorAll('title')).toHaveLength(0);
      // Not on each other.
      for (const a of series[0]!)
        for (const b of series[1]!) expect(overlap(a, b)).toBe(false);
      // Inside the SVG.
      for (const b of series.flat()) {
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.x1).toBeLessThanOrEqual(width);
        expect(b.y0).toBeGreaterThanOrEqual(0);
      }
      // Not on any row name, nor on the first row's dots.
      const names = [...c.querySelectorAll('.dot-row text.dot-label')].flatMap(
        (t) => boxes(t, TICK_FONT, false)
      );
      for (const a of series.flat())
        for (const b of names) expect(overlap(a, b)).toBe(false);
      const dot = c.querySelector('.dot-row .dot-dot')!;
      const dotTop =
        Number(dot.getAttribute('cy')) - Number(dot.getAttribute('r'));
      for (const b of series.flat()) expect(b.y1).toBeLessThanOrEqual(dotTop);
    });

  it('short series names draw as one plain line, as before', () => {
    const parsed = parseDot(
      'dot Engagement\nseries 2020, 2025\n\nEngineering 71 78\nSales 64 61\n'
    );
    const c = document.createElement('div');
    renderDot(c, parsed, palette, false, undefined, {
      width: 960,
      height: 480,
    });
    for (const t of c.querySelectorAll('.dot-series-label')) {
      expect(t.querySelectorAll('tspan')).toHaveLength(0);
      expect(t.hasAttribute('data-full-text')).toBe(false);
    }
  });
});
