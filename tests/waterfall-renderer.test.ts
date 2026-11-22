// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseWaterfall } from '../src/waterfall/parser';
import { renderWaterfall } from '../src/waterfall/renderer';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { shapeFill } from '../src/palettes/color-utils';

const palette = getPalette('nord').light;

const BRIDGE = `waterfall Revenue bridge, FY24 → FY25 ($k)

FY24 1200 total
New logos +340
Expansion 210
Churn -180
Contraction -65
H1 subtotal total
Price +95
FX -40
FY25 total
`;

function draw(src: string): HTMLDivElement {
  const parsed = parseWaterfall(src);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  renderWaterfall(container, parsed, palette, false, undefined, {
    width: 960,
    height: 480,
  });
  return container;
}

const bars = (c: Element) => [...c.querySelectorAll('.waterfall-bar')];
const num = (el: Element, a: string) => Number(el.getAttribute(a));

describe('waterfall renderer (#1850)', () => {
  it('draws one bar per row, each row carrying its source line', () => {
    const c = draw(BRIDGE);
    expect(bars(c)).toHaveLength(9);
    const lines = [...c.querySelectorAll('.waterfall-row')].map((g) =>
      g.getAttribute('data-line-number')
    );
    expect(lines).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11']);
  });

  it('floats a step between the running totals and runs a total from 0', () => {
    const c = draw(BRIDGE);
    const [fy24, newLogos, , , , h1] = bars(c);
    // New logos starts where FY24 ends: its bottom edge is FY24's top edge.
    expect(num(newLogos!, 'y') + num(newLogos!, 'height')).toBeCloseTo(
      num(fy24!, 'y'),
      5
    );
    // Totals share the zero baseline.
    expect(num(fy24!, 'y') + num(fy24!, 'height')).toBeCloseTo(
      num(h1!, 'y') + num(h1!, 'height'),
      5
    );
    // H1 subtotal (1505) is taller than FY24 (1200), in proportion.
    expect(num(h1!, 'height') / num(fy24!, 'height')).toBeCloseTo(
      1505 / 1200,
      2
    );
  });

  it('colours rises green, falls red and totals grey', () => {
    const c = draw(BRIDGE);
    const strokes = bars(c).map((b) => b.getAttribute('stroke'));
    expect(strokes[0]).toBe(palette.colors.gray);
    expect(strokes[1]).toBe(palette.colors.green);
    expect(strokes[3]).toBe(palette.colors.red);
    expect(bars(c)[1]!.getAttribute('fill')).toBe(
      shapeFill(palette, palette.colors.green, false)
    );
  });

  it('swaps rise and fall colours under `direction down`', () => {
    const c = draw(BRIDGE.replace('\n\nFY24', '\ndirection down\n\nFY24'));
    const strokes = bars(c).map((b) => b.getAttribute('stroke'));
    expect(strokes[1]).toBe(palette.colors.red);
    expect(strokes[3]).toBe(palette.colors.green);
    expect(strokes[0]).toBe(palette.colors.gray);
  });

  it('lets a colour word on a row win', () => {
    const c = draw('waterfall\n\nStart 10 total\nOne-off purple +5');
    expect(bars(c)[1]!.getAttribute('stroke')).toBe(palette.colors.purple);
  });

  it('prints signed values on steps and plain bold values on totals', () => {
    const c = draw(BRIDGE);
    const values = [...c.querySelectorAll('.waterfall-value')];
    const texts = values.map((v) => v.textContent);
    expect(texts).toEqual([
      '1,200',
      '+340',
      '+210',
      '−180',
      '−65',
      '1,505',
      '+95',
      '−40',
      '1,560',
    ]);
    expect(values[0]!.getAttribute('font-weight')).toBe('bold');
    expect(values[1]!.getAttribute('fill')).toBe(palette.colors.green);
  });

  it('draws a dashed connector at each running total, and none with `no-connectors`', () => {
    const c = draw(BRIDGE);
    const conn = [...c.querySelectorAll('.waterfall-connector')];
    expect(conn).toHaveLength(8);
    const [fy24, newLogos] = bars(c);
    // Level with FY24's top, from FY24's right edge to New logos' left edge.
    expect(num(conn[0]!, 'y1')).toBeCloseTo(num(fy24!, 'y'), 5);
    expect(num(conn[0]!, 'x1')).toBeCloseTo(
      num(fy24!, 'x') + num(fy24!, 'width'),
      5
    );
    expect(num(conn[0]!, 'x2')).toBeCloseTo(num(newLogos!, 'x'), 5);
    expect(conn[0]!.getAttribute('stroke-dasharray')).toBeTruthy();
    const off = draw(BRIDGE.replace('\n\nFY24', '\nno-connectors\n\nFY24'));
    expect(off.querySelectorAll('.waterfall-connector')).toHaveLength(0);
  });

  it('drops the value labels under `no-value`', () => {
    const c = draw(BRIDGE.replace('\n\nFY24', '\nno-value\n\nFY24'));
    expect(c.querySelectorAll('.waterfall-value')).toHaveLength(0);
  });

  it('runs the steps down the left under `orientation-horizontal`', () => {
    const c = draw(
      BRIDGE.replace('\n\nFY24', '\norientation-horizontal\n\nFY24')
    );
    const [fy24, newLogos] = bars(c);
    expect(num(newLogos!, 'y')).toBeGreaterThan(num(fy24!, 'y'));
    // New logos starts at FY24's right end.
    expect(num(newLogos!, 'x')).toBeCloseTo(
      num(fy24!, 'x') + num(fy24!, 'width'),
      5
    );
  });

  it('draws a bar that crosses zero through the zero line', () => {
    const c = draw('waterfall\n\nStart 50 total\nLoss -80\nEnd total');
    const [start, loss, end] = bars(c);
    const zeroY = num(start!, 'y') + num(start!, 'height');
    expect(num(loss!, 'y')).toBeLessThan(zeroY);
    expect(num(loss!, 'y') + num(loss!, 'height')).toBeGreaterThan(zeroY);
    // The end total (-30) hangs below zero.
    expect(num(end!, 'y')).toBeCloseTo(zeroY, 5);
  });

  it('keeps every bar and label inside the canvas', () => {
    const c = draw(BRIDGE);
    for (const b of bars(c)) {
      expect(num(b, 'x')).toBeGreaterThanOrEqual(0);
      expect(num(b, 'x') + num(b, 'width')).toBeLessThanOrEqual(960);
      expect(num(b, 'y')).toBeGreaterThan(0);
      expect(num(b, 'y') + num(b, 'height')).toBeLessThanOrEqual(480);
    }
  });

  it('exports through renderForExport', async () => {
    const svg = await renderForExport(BRIDGE, 'light', palette);
    expect(svg).toContain('waterfall-bar');
    expect(svg).toContain('Revenue bridge');
  });
});
