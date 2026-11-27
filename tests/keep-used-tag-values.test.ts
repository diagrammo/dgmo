// keep-used-tag-values.test.ts — the shared "legend shows only used values"
// rule (diagrammo/diagrammo#2422).

import { describe, it, expect } from 'vitest';
import { keepUsedTagValues, type TagGroup } from '../src/utils/tag-groups';

const group = (name: string, values: string[], defaultValue?: string) =>
  ({
    name,
    entries: values.map((value) => ({ value, color: 'blue', lineNumber: 1 })),
    lineNumber: 1,
    ...(defaultValue !== undefined && { defaultValue }),
  }) as unknown as TagGroup;

describe('keepUsedTagValues (#2422)', () => {
  it('keeps only values an item carries, case-insensitively', () => {
    const g = group('Effort', ['Low', 'High', 'Mid']);
    const out = keepUsedTagValues([g], [g], [{ effort: 'high' }, {}]);
    expect(out.map((x) => x.entries.map((e) => e.value))).toEqual([['High']]);
  });

  it('drops a group with no used value', () => {
    const a = group('A', ['x', 'y']);
    const b = group('B', ['p']);
    const out = keepUsedTagValues([a, b], [a, b], [{ b: 'p' }]);
    expect(out.map((x) => x.name)).toEqual(['B']);
  });

  it('counts the default value for an item that names none', () => {
    const g = group('Status', ['Open', 'Done'], 'Open');
    const out = keepUsedTagValues([g], [g], [{}, { status: 'Done' }]);
    expect(out[0]!.entries.map((e) => e.value)).toEqual(['Open', 'Done']);
  });

  it('a container counts only a value written on it, never the default', () => {
    const g = group('Status', ['Open', 'Done'], 'Open');
    const out = keepUsedTagValues(
      [g],
      [g],
      [{ status: 'Done' }],
      [{ other: 'x' }]
    );
    expect(out[0]!.entries.map((e) => e.value)).toEqual(['Done']);
    const tagged = keepUsedTagValues([g], [g], [], [{ status: 'open' }]);
    expect(tagged[0]!.entries.map((e) => e.value)).toEqual(['Open']);
  });

  it('passes gradient groups through', () => {
    const ramp = { name: 'Pop', entries: [], gradient: { min: 0, max: 1 } };
    expect(keepUsedTagValues([ramp], [], [])).toEqual([ramp]);
  });
});
