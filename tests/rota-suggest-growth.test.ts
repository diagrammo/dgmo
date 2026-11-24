import { describe, expect, it } from 'vitest';
import { suggest } from '../src/diagnostics';
import { measureGrowth } from './perf-helpers';

describe('did-you-mean on long author strings (#2275)', () => {
  it('cost does not follow string length past the cap', () => {
    const exponent = measureGrowth({
      small: 200,
      large: 800,
      prepare: (L) => ({
        input: 'a'.repeat(L),
        cands: Array.from({ length: 20 }, (_, i) =>
          `${i}`.repeat(L).slice(0, L)
        ),
      }),
      run: ({ input, cands }) => {
        for (let k = 0; k < 20; k++) suggest(input, cands);
      },
      limit: 0.7,
    });
    expect(exponent).toBeLessThan(0.7);
  });

  it('still suggests on a normal typo', () => {
    expect(suggest('bra', ['bar', 'pie'])).toBe("Did you mean 'bar'?");
  });
});
