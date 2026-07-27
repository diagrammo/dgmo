// E_VALUE_NEGATIVE: charts whose value channel encodes magnitude (share,
// radius, area, ribbon/flow width, font weight) reject negative values with
// an error instead of silently rendering garbage. Signed charts (bar, line,
// scatter, slope, quadrant, heatmap, map heat:) stay untouched.
import { describe, it, expect } from 'vitest';
import { validate } from '../src/index';

const CODE = 'E_VALUE_NEGATIVE';

function negatives(src: string) {
  return validate(src).diagnostics.filter((d) => d.code === CODE);
}

describe('E_VALUE_NEGATIVE — magnitude charts reject negative values', () => {
  it('pie', () => {
    const found = negatives(`pie Budget\nRent 1200\nRefunds -300`);
    expect(found.length).toBe(1);
    expect(found[0]!.severity).toBe('error');
    expect(found[0]!.line).toBe(3);
    expect(found[0]!.message).toContain('-300');
    expect(found[0]!.message).toContain('Refunds');
  });

  it('polar-area', () => {
    expect(negatives(`polar-area T\nA 10\nB -4`).length).toBe(1);
  });

  it('radar (including extra series values)', () => {
    expect(negatives(`radar T\nSpeed 8\nPower -4\nRange 6`).length).toBe(1);
    const multi = negatives(`radar T\nseries\n  X\n  Y\nSpeed 8 -2\nRange 6 5`);
    expect(multi.length).toBe(1);
  });

  it('funnel', () => {
    const found = negatives(`funnel T\nVisits 100\nRefunds -20`);
    expect(found.length).toBe(1);
    expect(found[0]!.message).toContain('funnel stage sizes');
  });

  it('sankey (edge and indented-child forms)', () => {
    expect(negatives(`sankey T\nA -> B 30\nB -> C -10`).length).toBe(1);
    expect(negatives(`sankey T\nA\n  B 30\n  C -10`).length).toBe(1);
  });

  it('arc link weight', () => {
    expect(negatives(`arc T\nA -> B -5`).length).toBe(1);
  });

  it('wordcloud weight (not swallowed as freeform text)', () => {
    const found = negatives(`wordcloud T\nalpha -30\nbeta 20`);
    expect(found.length).toBe(1);
    expect(found[0]!.message).toContain('alpha');
  });

  it('treemap leaf size (pre-existing chart-specific code)', () => {
    // Treemap predates E_VALUE_NEGATIVE with its own error — still an error,
    // so the editor + error-card behavior is identical.
    const diags = validate(`treemap T\nA\n  Bad -5`).diagnostics;
    const neg = diags.find((d) => d.code === 'E_TREEMAP_NEGATIVE_VALUE');
    expect(neg).toBeTruthy();
    expect(neg!.severity).toBe('error');
  });

  it('map poi size: and edge width:', () => {
    expect(negatives(`map T\npoi Austin size: -5`).length).toBe(1);
    expect(negatives(`map T\nDenver -> Austin width: -3`).length).toBe(1);
  });
});

describe('signed charts stay signed (no E_VALUE_NEGATIVE)', () => {
  const SIGNED = [
    `bar T\nIntel -8\nAMD -3.3`,
    `line T\nJan -5\nFeb 3`,
    `slope T\nperiod 2024 2025\nA 10 -5`,
    `scatter T\nA -3 4`,
    `heatmap T\ncolumns Mon Tue\nRow1 -2 5`,
    `map T\nregion-heat Anomaly\nTexas heat: -3\nUtah heat: 2`,
  ];
  for (const src of SIGNED) {
    const type = src.split(/\s/)[0]!;
    it(type, () => {
      expect(negatives(src).length).toBe(0);
    });
  }
});
