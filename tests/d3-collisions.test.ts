import { describe, it, expect } from 'vitest';
import { resolveVerticalCollisions } from '../src/d3';

describe('resolveVerticalCollisions', () => {
  it('returns empty array for empty input', () => {
    expect(resolveVerticalCollisions([], 4)).toEqual([]);
  });

  it('returns natural positions when no overlap', () => {
    const items = [
      { naturalY: 10, height: 10 },
      { naturalY: 50, height: 10 },
      { naturalY: 90, height: 10 },
    ];
    const result = resolveVerticalCollisions(items, 4);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(50);
    expect(result[2]).toBe(90);
  });

  it('pushes overlapping items apart', () => {
    const items = [
      { naturalY: 50, height: 20 },
      { naturalY: 55, height: 20 },
    ];
    const result = resolveVerticalCollisions(items, 4);
    // First item at its natural position
    expect(result[0]).toBe(50);
    // Second item pushed down: first bottom (60) + gap (4) + halfH (10) = 74
    expect(result[1]).toBe(74);
  });

  it('preserves original index mapping when items are unsorted', () => {
    const items = [
      { naturalY: 100, height: 20 }, // index 0, higher Y
      { naturalY: 10, height: 20 },  // index 1, lower Y
    ];
    const result = resolveVerticalCollisions(items, 4);
    // index 1 (naturalY=10) should stay at 10
    expect(result[1]).toBe(10);
    // index 0 (naturalY=100) should stay at 100 (no overlap)
    expect(result[0]).toBe(100);
  });

  it('clamps items at maxY', () => {
    const items = [
      { naturalY: 90, height: 20 },
      { naturalY: 95, height: 20 },
    ];
    const result = resolveVerticalCollisions(items, 4, 100);
    // First item: natural center 90, halfH=10, top=80, bottom=100 — at maxY boundary
    expect(result[0]).toBe(90);
    // Second item clamped: maxY (100) - height (20) = top 80, center = 90
    // But it also needs to be after first item, so: max(85, 80+20+4)=104 → clamped to 80
    expect(result[1]).toBeLessThanOrEqual(100);
  });

  it('handles single item', () => {
    const items = [{ naturalY: 50, height: 20 }];
    const result = resolveVerticalCollisions(items, 4);
    expect(result[0]).toBe(50);
  });

  it('handles three-way collision cascade', () => {
    const items = [
      { naturalY: 50, height: 20 },
      { naturalY: 52, height: 20 },
      { naturalY: 54, height: 20 },
    ];
    const result = resolveVerticalCollisions(items, 2);
    // Each should be pushed further down
    expect(result[0]).toBe(50);
    expect(result[1]).toBeGreaterThan(result[0]);
    expect(result[2]).toBeGreaterThan(result[1]);
    // No overlap: each center should be at least (height + gap) apart
    const gap01 = result[1] - result[0];
    expect(gap01).toBeGreaterThanOrEqual(20 + 2); // height + minGap
  });
});
