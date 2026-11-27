// funnel-honest-values.test.ts — a funnel never lies about small and zero
// stages (#2440): zero is zero wide, 0/0 is `—`, an exact 0% is `0%`, and a
// non-zero value is never printed as 0.
import { describe, it, expect } from 'vitest';
import {
  funnelConversionLabel,
  honestFormatter,
} from '../src/charts-d3/funnel';
import { fmtNum } from '../src/charts-d3/shared';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { flattenTabular } from './helpers/tabular-text';

describe('funnel conversion label', () => {
  it('0 after 0 has no conversion', () => {
    expect(funnelConversionLabel(0, 0)).toBe('—');
  });
  it('0 after 5 is 0%', () => {
    expect(funnelConversionLabel(0, 5)).toBe('0%');
  });
  it('0.5 after 100 is <1%', () => {
    expect(funnelConversionLabel(0.5, 100)).toBe('<1%');
  });
  it('ordinary shares round', () => {
    expect(funnelConversionLabel(50, 100)).toBe('50%');
  });
});

describe('funnel value formatter', () => {
  const fmt = honestFormatter(fmtNum);
  it('never prints a non-zero value as 0', () => {
    expect(fmt(0.0001)).toBe('0.0001');
    expect(fmt(1.5e-7)).toBe('1.5e-7');
    expect(fmt(-0.001)).toBe('-0.001');
  });
  it('leaves zero and ordinary values alone', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(1000)).toBe('1,000');
    expect(fmt(2.5)).toBe('2.5');
  });
});

const EXTREME = [
  'funnel Extreme values',
  '',
  'Big 1000000000000',
  'Medium 1000',
  'Small 0.0001',
  'Zero 0',
  'AfterZero 0',
].join('\n');

const bands = (svg: string) =>
  new Map(
    [
      ...svg.matchAll(
        /<polygon points="([^"]+)"[^>]*stroke-width="([^"]+)"[^>]*data-name="([^"]+)"/g
      ),
    ].map((m) => {
      const pts = m[1]!.split(' ').map((p) => p.split(',').map(Number));
      return [
        m[3]!,
        {
          top: pts[1]![0]! - pts[0]![0]!,
          bottom: pts[2]![0]! - pts[3]![0]!,
          stroke: Number(m[2]),
        },
      ];
    })
  );

describe('funnel extreme values', () => {
  it('draws zero stages zero wide and keeps every label honest', async () => {
    const svg = flattenTabular(await renderDataChartD3(EXTREME, 'light'));
    const b = bands(svg);
    expect(b.get('Zero')).toEqual({ top: 0, bottom: 0, stroke: 0 });
    expect(b.get('AfterZero')).toEqual({ top: 0, bottom: 0, stroke: 0 });
    // Small is a visible hairline, Medium visibly wider.
    expect(b.get('Small')!.top).toBeGreaterThan(0);
    expect(b.get('Medium')!.top).toBeGreaterThan(b.get('Small')!.top + 1);
    expect(svg).not.toContain('NaN');
    expect(svg).toMatch(/>0 · 0%</); // Zero after Small
    expect(svg).toMatch(/>0 · —</); // AfterZero after Zero
    expect(svg).toContain('0.0001');
    expect(svg).toContain('data-value="0.0001"');
  });
});
