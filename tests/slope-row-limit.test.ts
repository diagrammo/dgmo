import { describe, it, expect } from 'vitest';
import { parseSlope } from '../src/slope/parser';
import { renderSlopeChart } from '../src/slope/renderer';
import { MAX_SLOPE_ROWS, SLOPE_MIN_LABEL_PX } from '../src/slope/limits';
import { EXPORT_HEIGHT, EXPORT_WIDTH } from '../src/utils/d3-helpers';
import { measureTabular } from '../src/utils/tabular-figures';
import { getPalette } from '../src/palettes';
import type { ParsedSlope } from '../src/visualizations/types';
import '../src/palettes/index';

// #2465: a slope chart holds MAX_SLOPE_ROWS rows; every end label fits.
const palette = getPalette('nord').light;

const source = (rows: number): string =>
  [
    'slope Revenue by product',
    'period 2020 2025',
    '',
    ...Array.from(
      { length: rows },
      (_, i) => `Product ${i + 1} ${100 + i * 7} ${400 - i * 5}`
    ),
  ].join('\n');

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Every end label's box, in canvas coordinates, and the plot top. */
function endLabels(parsed: ParsedSlope): { boxes: Box[]; plotTop: number } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  renderSlopeChart(host, parsed, palette, false, undefined, {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  });
  const g = host.querySelector('svg > g')!;
  const [tx, ty] = g
    .getAttribute('transform')!
    .match(/translate\(([^,]+),([^)]+)\)/)!
    .slice(1)
    .map(Number) as [number, number];
  // Two periods: each series draws exactly its two end labels. Tabular
  // figures centre the text on x (tabularText).
  const boxes = [...host.querySelectorAll('g.slope-series > text')].map((t) => {
    const font = Number(t.getAttribute('font-size'));
    const cy = ty + Number(t.getAttribute('y'));
    const x = tx + Number(t.getAttribute('x'));
    const w = measureTabular(t.textContent ?? '', font);
    expect(font).toBeGreaterThanOrEqual(SLOPE_MIN_LABEL_PX);
    return {
      top: cy - font * 0.7,
      bottom: cy + font * 0.7,
      left: x - w / 2,
      right: x + w / 2,
    };
  });
  host.remove();
  return { boxes, plotTop: ty };
}

describe('slope row limit (#2465)', () => {
  it('at the limit every end label lies inside the canvas, under the headers', () => {
    const parsed = parseSlope(source(MAX_SLOPE_ROWS), palette);
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    );
    const { boxes, plotTop } = endLabels(parsed);
    expect(boxes).toHaveLength(MAX_SLOPE_ROWS * 2);
    for (const b of boxes) {
      expect(b.top).toBeGreaterThanOrEqual(plotTop);
      expect(b.bottom).toBeLessThanOrEqual(EXPORT_HEIGHT);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(EXPORT_WIDTH);
    }
  });

  it('the limit is the most that fit: one row more runs past the plot', () => {
    const parsed = parseSlope(source(MAX_SLOPE_ROWS), palette);
    const extra = { ...parsed.data[0]!, label: 'Extra', lineNumber: 999 };
    const { boxes, plotTop } = endLabels({
      ...parsed,
      data: [...parsed.data, extra],
    });
    expect(Math.min(...boxes.map((b) => b.top))).toBeLessThan(plotTop);
  });

  it('one row over the limit raises an error on that row and draws the first rows', () => {
    const parsed = parseSlope(source(MAX_SLOPE_ROWS + 1), palette);
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('E_SLOPE_TOO_MANY_ROWS');
    // Rows start on line 4: the title, the period line and a blank line.
    expect(errors[0]!.line).toBe(4 + MAX_SLOPE_ROWS);
    expect(errors[0]!.message).toContain(`${MAX_SLOPE_ROWS + 1} rows`);
    expect(errors[0]!.message).toContain(`first ${MAX_SLOPE_ROWS}`);
    expect(errors[0]!.message).toContain('highlight');
    expect(errors[0]!.message).toContain('line chart');
    expect(parsed.data).toHaveLength(MAX_SLOPE_ROWS);
    expect(parsed.error).toBeNull();
  });
});
