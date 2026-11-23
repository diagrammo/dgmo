// #2256: two bar or line rows with the same category label share one x slot —
// bars overlap and a line doubles back — so the parser warns on the later row.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';

const dupes = (src: string) =>
  parseChart(src).diagnostics.filter((d) => d.code === 'W_DUPLICATE_CATEGORY');

describe('W_DUPLICATE_CATEGORY', () => {
  it('warns on the repeated row of a line chart, naming the first line', () => {
    const found = dupes('line Vitals\n07:00 4\n08:00 6\n07:00 5');
    expect(found).toHaveLength(1);
    expect(found[0]!.line).toBe(4);
    expect(found[0]!.severity).toBe('warning');
    expect(found[0]!.message).toContain('"07:00"');
    expect(found[0]!.message).toContain('line 2');
    expect(found[0]!.hint).toContain('2026-11-22 07:00');
  });

  it('warns once per repeat, on every later row', () => {
    const found = dupes('line L\nA 1\nA 2\nA 3');
    expect(found.map((d) => d.line)).toEqual([3, 4]);
  });

  it('warns on a bar chart too', () => {
    expect(dupes('bar B\nA 1\nB 2\nA 3')).toHaveLength(1);
  });

  it('treats the same label in two clusters as two slots', () => {
    const src =
      'bar Revenue\nstack\n  Hardware blue\n  Software green\n\nNorth\n  2024 40 22\n  2025 44 30\nSouth\n  2024 31 18\n  2025 29 26';
    expect(dupes(src)).toEqual([]);
    expect(dupes(src.replace('2025 44 30', '2024 44 30'))).toHaveLength(1);
  });

  it('stays quiet when labels are unique', () => {
    expect(dupes('line L\n2026-11-22 07:00 4\n2026-11-23 07:00 5')).toEqual([]);
    expect(dupes('bar B\nA 1\nB 2')).toEqual([]);
  });

  it('keeps the merge: the parse still holds both rows', () => {
    expect(parseChart('line L\nA 1\nB 2\nA 3').data).toHaveLength(3);
  });

  it('does not fire on pie, where each row is its own slice', () => {
    expect(dupes('pie P\nA 1\nA 2')).toEqual([]);
  });
});
