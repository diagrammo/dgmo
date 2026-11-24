import { describe, expect, it } from 'vitest';
import { parseOwnership } from '../src/ownership/parser';
import { measureGrowth } from './perf-helpers';

describe('ownership stake line on a long digit run (#2270)', () => {
  it('cost grows about linearly with the digit run', () => {
    const exponent = measureGrowth({
      small: 4000,
      large: 16000,
      prepare: (n) => `ownership\nAcme\n  ${'1'.repeat(n)} x\n`,
      run: (src) => parseOwnership(src),
      limit: 1.5,
    });
    expect(exponent).toBeLessThan(1.5);
  });

  it('still reads stakes', () => {
    const p = parseOwnership('ownership\nAcme\n  60% Foo\n  .5 % Bar\n');
    expect(p.error ?? null).toBeNull();
  });
});
