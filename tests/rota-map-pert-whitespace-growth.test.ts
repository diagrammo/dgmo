import { describe, expect, it } from 'vitest';
import { stripInlineComment } from '../src/map/parser';
import { stripTrailingComment } from '../src/pert/parser';
import { measureGrowth } from './perf-helpers';

const run = (n: number) => `x${' '.repeat(n)}y`;

// The sinks are measured through the two strip helpers: a whole-parse run is
// dominated by the shared alias regexes in src/utils/alias-registry.ts.
describe('whitespace-run line stripping (#2272)', () => {
  it('map: cost grows about linearly with the space run', () => {
    const exponent = measureGrowth({
      small: 2000,
      large: 8000,
      prepare: (n) => run(n),
      run: (src) => stripInlineComment(src),
      limit: 1.5,
    });
    expect(exponent).toBeLessThan(1.5);
  });

  it('pert: cost grows about linearly with the space run', () => {
    const exponent = measureGrowth({
      small: 2000,
      large: 8000,
      prepare: (n) => run(n),
      run: (src) => stripTrailingComment(src),
      limit: 1.5,
    });
    expect(exponent).toBeLessThan(1.5);
  });
});
