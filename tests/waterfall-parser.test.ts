import { describe, expect, it } from 'vitest';
import { parseWaterfall } from '../src/waterfall/parser';

// The decided example (#1850, mockup 2026-11-12-waterfall).
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

const codes = (src: string) =>
  parseWaterfall(src).diagnostics.map((d) => d.code);

describe('waterfall walk (#1850)', () => {
  it('reads the title and every row in order', () => {
    const p = parseWaterfall(BRIDGE);
    expect(p.error).toBeNull();
    expect(p.diagnostics).toEqual([]);
    expect(p.title).toBe('Revenue bridge, FY24 → FY25 ($k)');
    expect(p.rows.map((r) => r.label)).toEqual([
      'FY24',
      'New logos',
      'Expansion',
      'Churn',
      'Contraction',
      'H1 subtotal',
      'Price',
      'FX',
      'FY25',
    ]);
  });

  it('walks the mockup to H1 subtotal 1505 and FY25 1560', () => {
    const rows = parseWaterfall(BRIDGE).rows;
    const at = (label: string) => rows.find((r) => r.label === label)!;
    expect(at('H1 subtotal')).toMatchObject({
      kind: 'total',
      value: 1505,
      from: 0,
      to: 1505,
    });
    expect(at('FY25')).toMatchObject({
      kind: 'total',
      value: 1560,
      from: 0,
      to: 1560,
    });
  });

  it('floats each step from the running total before it', () => {
    const rows = parseWaterfall(BRIDGE).rows;
    expect(rows[1]).toMatchObject({
      kind: 'rise',
      value: 340,
      from: 1200,
      to: 1540,
    });
    // A bare number is a change, `+` optional.
    expect(rows[2]).toMatchObject({
      kind: 'rise',
      value: 210,
      from: 1540,
      to: 1750,
    });
    expect(rows[3]).toMatchObject({
      kind: 'fall',
      value: -180,
      from: 1750,
      to: 1570,
    });
    expect(rows[6]).toMatchObject({
      kind: 'rise',
      value: 95,
      from: 1505,
      to: 1600,
    });
  });

  it('starts from 0 when the first row is not a total', () => {
    const rows = parseWaterfall('waterfall\n\nA +5\nB -8\nEnd total').rows;
    expect(rows[0]).toMatchObject({ from: 0, to: 5 });
    expect(rows[1]).toMatchObject({ from: 5, to: -3 });
    expect(rows[2]).toMatchObject({ kind: 'total', from: 0, to: -3 });
  });

  it('lets a later `N total` set the running total', () => {
    const p = parseWaterfall(
      'waterfall\n\nStart 100 total\nUp +20\nRestated 150 total\nUp +10\nEnd total'
    );
    expect(p.rows[4]).toMatchObject({ kind: 'total', to: 160 });
  });

  it('keeps a colour word as the bar colour, peeled before the number', () => {
    const row = parseWaterfall('waterfall\n\nOne-off purple +50').rows[0]!;
    expect(row).toMatchObject({ label: 'One-off', color: 'purple', value: 50 });
  });

  it('reads the true minus sign as a fall', () => {
    expect(parseWaterfall('waterfall\n\nFX −40').rows[0]!.value).toBe(-40);
  });

  it('reads the header options', () => {
    const p = parseWaterfall(
      'waterfall Costs\ndirection down\nno-connectors\nno-value\norientation-horizontal\n\nA 1 total'
    );
    expect(p).toMatchObject({
      directionDown: true,
      connectors: false,
      values: false,
      horizontal: true,
    });
    expect(parseWaterfall('waterfall\nhorizontal\n\nA 1').horizontal).toBe(
      true
    );
  });

  it('reads the number format lines', () => {
    const p = parseWaterfall('waterfall\nformat currency USD\n\nA 1');
    expect(p.numberFormat).toMatchObject({ kind: 'currency' });
  });
});

describe('waterfall diagnostics (#1850)', () => {
  it('warns when a total disagrees with the walk, naming both numbers, and draws the given number', () => {
    const p = parseWaterfall(BRIDGE.replace('FY25 total', 'FY25 1500 total'));
    expect(p.error).toBeNull();
    const d = p.diagnostics.find((x) => x.code === 'W_WATERFALL_RECONCILE')!;
    expect(d.severity).toBe('warning');
    expect(d.message).toContain('FY25 is 1500 but the steps add up to 1560');
    expect(p.rows[8]).toMatchObject({ to: 1500 });
  });

  it('does not warn when a total agrees with the walk', () => {
    expect(codes(BRIDGE.replace('FY25 total', 'FY25 1560 total'))).toEqual([]);
  });

  it('does not reconcile the first row', () => {
    expect(codes('waterfall\n\nFY24 1200 total\nUp +1')).toEqual([]);
  });

  it('errors on a row with no number that is not a total', () => {
    const p = parseWaterfall('waterfall\n\nChurn lots');
    expect(p.error).not.toBeNull();
    expect(codes('waterfall\n\nChurn lots')).toContain('E_WATERFALL_BAD_VALUE');
  });

  it('suggests the option a misspelled one-word line meant', () => {
    const d = parseWaterfall('waterfall\nno-conectors\n\nA 1').diagnostics[0]!;
    expect(d.code).toBe('E_WATERFALL_BAD_VALUE');
    expect(d.message).toContain('no-connectors');
  });

  it('warns on a total that carries a sign', () => {
    expect(codes('waterfall\n\nFY24 +1200 total')).toContain(
      'W_WATERFALL_SIGNED_TOTAL'
    );
    expect(codes('waterfall\n\nFY24 -1200 total')).toContain(
      'W_WATERFALL_SIGNED_TOTAL'
    );
  });

  it('warns on a direction other than down, and ignores it', () => {
    const p = parseWaterfall('waterfall\ndirection up\n\nA 1');
    expect(p.diagnostics.map((d) => d.code)).toContain(
      'W_WATERFALL_BAD_DIRECTION'
    );
    expect(p.directionDown).toBe(false);
  });

  it('errors on a chart with no rows', () => {
    expect(codes('waterfall Empty')).toContain('E_WATERFALL_NO_ROWS');
  });
});
