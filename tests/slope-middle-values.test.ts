import { describe, it, expect } from 'vitest';
import { middleValueSide } from '../src/slope/renderer';

// #1946 — a middle-period value sits beside its point on the side its own
// line segments leave clear. SVG y grows downward.
describe('middleValueSide', () => {
  const p = { x: 100, y: 100 };
  const hw = 10;
  const gap = 8;

  it('goes above when both segments fall away (a peak)', () => {
    expect(
      middleValueSide(
        p,
        [
          { x: 0, y: 200 },
          { x: 200, y: 200 },
        ],
        hw,
        gap
      )
    ).toBe('above');
  });

  it('flips below when both segments rise toward it (a valley)', () => {
    expect(
      middleValueSide(
        p,
        [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
        hw,
        gap
      )
    ).toBe('below');
  });

  it('stays above on a flat line', () => {
    expect(
      middleValueSide(
        p,
        [
          { x: 0, y: 100 },
          { x: 200, y: 100 },
        ],
        hw,
        gap
      )
    ).toBe('above');
  });

  it('picks the side the steeper segment leaves clear', () => {
    // Steep rise on the left, gentle fall on the right.
    expect(
      middleValueSide(
        p,
        [
          { x: 0, y: -400 },
          { x: 200, y: 140 },
        ],
        hw,
        gap
      )
    ).toBe('below');
  });
});
