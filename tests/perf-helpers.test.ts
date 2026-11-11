import { describe, expect, it } from 'vitest';
import { measureGrowth } from './perf-helpers';

// The helper retries and keeps the lowest exponent (#1921). That must never
// let a genuinely quadratic cost read as subquadratic.
let sink = 0;
const linear = (xs: number[]) => {
  let total = 0;
  for (const x of xs) total += x;
  sink += total;
};
const quadratic = (xs: number[]) => {
  let total = 0;
  for (const x of xs) for (const y of xs) total += x ^ y;
  sink += total;
};
const prepare = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('measureGrowth', () => {
  it('reads a linear cost as below 1.5', () => {
    const exponent = measureGrowth({
      small: 2_000,
      large: 20_000,
      prepare,
      run: linear,
      limit: 1.5,
    });
    expect(exponent).toBeLessThan(1.5);
  });

  it('never lets a quadratic cost pass a 1.5 limit, retries included', () => {
    const exponent = measureGrowth({
      small: 200,
      large: 4_000,
      prepare,
      run: quadratic,
      limit: 1.5,
    });
    // Reads ~2 on a quiet machine; the property is that it never gets under
    // the limit a caller would set, even with every attempt spent.
    expect(exponent).toBeGreaterThanOrEqual(1.5);
    expect(sink).not.toBe(0.5);
  });
});
