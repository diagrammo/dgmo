import { describe, expect, it } from 'vitest';
import { parseMindmap } from '../src/mindmap/parser';
import { measureGrowth } from './perf-helpers';

describe('mindmap description lines on one node (#2273)', () => {
  it('cost grows about linearly with the line count', () => {
    const exponent = measureGrowth({
      small: 5000,
      large: 20000,
      prepare: (n) =>
        `mindmap\nRoot\n${'  description: some text\n'.repeat(n)}`,
      run: (src) => parseMindmap(src),
      limit: 1.5,
    });
    expect(exponent).toBeLessThan(1.5);
  });

  it('keeps every description line in order', () => {
    const p = parseMindmap(
      'mindmap\nRoot\n  description: a\n  description: b\n'
    );
    expect(p.roots[0]?.description).toEqual(['a', 'b']);
  });
});
