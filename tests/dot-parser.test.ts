import { describe, expect, it } from 'vitest';
import { parseDot } from '../src/dot/parser';

// The decided example (#1849, mockup 2026-11-12-dot-dumbbell).
const DUMBBELL = `dot Engagement score by department
series 2020, 2025
sort gap
gap

Engineering 71 78
Sales 64 61
Support 58 72
`;

const codes = (src: string) => parseDot(src).diagnostics.map((d) => d.code);

describe('dot parser (#1849)', () => {
  it('reads the title, series, rows and options of the decided example', () => {
    const p = parseDot(DUMBBELL);
    expect(p.error).toBeNull();
    expect(p.diagnostics).toEqual([]);
    expect(p.title).toBe('Engagement score by department');
    expect(p.series.map((s) => s.name)).toEqual(['2020', '2025']);
    expect(p.gap).toBe(true);
    expect(p.sort).toEqual({ by: 'gap' });
    expect(p.connector).toBe('grey');
  });

  it('sort gap orders the rows by last − first, largest first', () => {
    const p = parseDot(DUMBBELL);
    // Support +14, Engineering +7, Sales −3.
    expect(p.rows.map((r) => r.label)).toEqual([
      'Support',
      'Engineering',
      'Sales',
    ]);
    expect(p.rows.map((r) => r.lineNumber)).toEqual([8, 6, 7]);
  });

  it('keeps the rows as written with no sort', () => {
    const p = parseDot(DUMBBELL.replace('sort gap\n', ''));
    expect(p.rows.map((r) => r.label)).toEqual([
      'Engineering',
      'Sales',
      'Support',
    ]);
    expect(p.rows[0]!.values).toEqual([71, 78]);
  });

  it('sort <series> orders by that series, largest first; sort name A–Z', () => {
    const bySeries = parseDot(DUMBBELL.replace('sort gap', 'sort 2020'));
    expect(bySeries.sort).toEqual({ by: 'series', index: 0 });
    expect(bySeries.rows.map((r) => r.label)).toEqual([
      'Engineering',
      'Sales',
      'Support',
    ]);
    const by2025 = parseDot(DUMBBELL.replace('sort gap', 'sort 2025'));
    expect(by2025.rows.map((r) => r.label)).toEqual([
      'Engineering',
      'Support',
      'Sales',
    ]);
    const byName = parseDot(
      `dot Scores\nseries a, b\nsort name\n\nZeta 1 2\nAlpha 3 4\nMid 5 6\n`
    );
    expect(byName.rows.map((r) => r.label)).toEqual(['Alpha', 'Mid', 'Zeta']);
  });

  it('reads a single value per row with no series line: a dot plot', () => {
    const p = parseDot(
      `dot Median salary by role ($k)\nStaff engineer 212\nData scientist 168\n`
    );
    expect(p.error).toBeNull();
    expect(p.diagnostics).toEqual([]);
    expect(p.series).toEqual([]);
    expect(p.rows.map((r) => [r.label, r.values])).toEqual([
      ['Staff engineer', [212]],
      ['Data scientist', [168]],
    ]);
  });

  it('reads three or more series, the block form, and series colour words', () => {
    const p = parseDot(`dot Strip
series
  Low red
  Mid
  High green

A 1 2 3
B 4 5.5 -6
`);
    expect(p.error).toBeNull();
    expect(p.series).toEqual([
      { name: 'Low', color: 'red', lineNumber: 3 },
      { name: 'Mid', lineNumber: 4 },
      { name: 'High', color: 'green', lineNumber: 5 },
    ]);
    expect(p.rows[1]!.values).toEqual([4, 5.5, -6]);
  });

  it('reads connector direction and connector direction down', () => {
    // A header line after the rows is still read, as on waterfall.
    expect(parseDot(DUMBBELL + 'connector direction\n').connector).toBe(
      'direction'
    );
    const up = parseDot(
      DUMBBELL.replace('gap\n', 'gap\nconnector direction\n')
    );
    expect(up.connector).toBe('direction');
    const down = parseDot(
      DUMBBELL.replace('gap\n', 'gap\nconnector direction down\n')
    );
    expect(down.connector).toBe('direction-down');
  });

  it('reads an x-axis range', () => {
    const p = parseDot(DUMBBELL.replace('gap\n', 'gap\nx-axis 0..100\n'));
    expect(p.xAxis).toMatchObject({ min: 0, max: 100 });
  });
});

describe('dot diagnostics (#1849)', () => {
  it('a row whose value count differs from series warns and is not drawn', () => {
    const p = parseDot(DUMBBELL + 'Legal 70\n');
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_DOT_VALUE_COUNT']);
    expect(p.diagnostics[0]!.line).toBe(9);
    expect(p.rows.map((r) => r.label)).not.toContain('Legal');
  });

  it('two values with no series line warn: the chart expects one', () => {
    expect(codes(`dot Scores\nEngineering 71 78\nSales 64\n`)).toEqual([
      'W_DOT_VALUE_COUNT',
    ]);
  });

  it('gap, sort gap and connector direction with one series warn and are dropped', () => {
    const p = parseDot(
      `dot Salary\ngap\nsort gap\nconnector direction\nStaff 212\nDesigner 141\n`
    );
    expect(p.diagnostics.map((d) => d.code).sort()).toEqual([
      'W_DOT_CONNECTOR_ONE_SERIES',
      'W_DOT_GAP_ONE_SERIES',
      'W_DOT_GAP_ONE_SERIES',
    ]);
    expect(p.gap).toBe(false);
    expect(p.sort).toBeUndefined();
    expect(p.connector).toBe('grey');
    expect(p.rows.map((r) => r.label)).toEqual(['Staff', 'Designer']);
  });

  it('sort naming an unknown series warns and keeps the written order', () => {
    const p = parseDot(DUMBBELL.replace('sort gap', 'sort 2030'));
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_DOT_SORT_UNKNOWN_SERIES',
    ]);
    expect(p.sort).toBeUndefined();
    expect(p.rows[0]!.label).toBe('Engineering');
  });

  it('an unknown connector value warns', () => {
    expect(
      codes(DUMBBELL.replace('gap\n', 'gap\nconnector rainbow\n'))
    ).toEqual(['W_DOT_BAD_CONNECTOR']);
  });

  it('a row with no number is an error; an empty chart has no rows', () => {
    const bad = parseDot(`dot Scores\nEngineering\n`);
    expect(bad.error).not.toBeNull();
    expect(bad.diagnostics.map((d) => d.code)).toContain('E_DOT_BAD_VALUE');
    expect(codes(`dot Scores\n`)).toEqual(['E_DOT_NO_ROWS']);
  });

  it('a wrong chart type is refused', () => {
    expect(parseDot(`slope Scores\nA 1 2\n`).error).toMatch(
      /Expected chart type "dot"/
    );
  });
});
