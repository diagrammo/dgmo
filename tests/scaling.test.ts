import { describe, it, expect } from 'vitest';
import { ScaleContext, type ContentCounts } from '../src/utils/scaling';
import { REGISTRY_BY_ID } from '../src/chart-type-registry';

// Min-dimension formulas moved into the chart-type registry (Story 111.5).
// This mirrors how dimensions.ts applies them: the descriptor's `minDims`
// (counts → size) with a {300,200} fallback for types without one.
function minDims(
  chartType: string,
  counts: ContentCounts
): { width: number; height: number } {
  return (
    REGISTRY_BY_ID.get(chartType)?.minDims?.(counts) ?? {
      width: 300,
      height: 200,
    }
  );
}

describe('ScaleContext', () => {
  describe('identity()', () => {
    const ctx = ScaleContext.identity();

    it('has factor 1.0', () => {
      expect(ctx.factor).toBe(1);
    });

    it('is not below floor', () => {
      expect(ctx.isBelowFloor).toBe(false);
    });

    it('returns values unchanged', () => {
      expect(ctx.aesthetic(100)).toBe(100);
      expect(ctx.structural(160)).toBe(160);
      expect(ctx.text(14)).toBe(14);
    });
  });

  describe('from() at factor = 1.0 (container == ideal)', () => {
    const ctx = ScaleContext.from(800, 800);

    it('returns values unchanged', () => {
      expect(ctx.factor).toBe(1);
      expect(ctx.aesthetic(100)).toBe(100);
      expect(ctx.structural(160)).toBe(160);
      expect(ctx.text(14)).toBe(14);
    });
  });

  describe('from() at factor = 0.75', () => {
    const ctx = ScaleContext.from(600, 800);

    it('has factor 0.75', () => {
      expect(ctx.factor).toBe(0.75);
    });

    it('is not below floor', () => {
      expect(ctx.isBelowFloor).toBe(false);
    });

    it('aesthetic compresses more than structural', () => {
      const aesthetic = ctx.aesthetic(100);
      const structural = ctx.structural(100);
      expect(aesthetic).toBeLessThan(structural);
    });

    it('aesthetic uses factor^1.5', () => {
      expect(ctx.aesthetic(100)).toBeCloseTo(100 * 0.75 ** 1.5, 10);
    });

    it('structural uses linear factor', () => {
      expect(ctx.structural(100)).toBeCloseTo(75, 10);
    });

    it('text scales linearly above floor', () => {
      expect(ctx.text(14)).toBeCloseTo(10.5, 10);
    });
  });

  describe('from() at factor = 0.5 (text floor)', () => {
    const ctx = ScaleContext.from(400, 800);

    it('has factor 0.5', () => {
      expect(ctx.factor).toBe(0.5);
    });

    it('is at floor boundary', () => {
      expect(ctx.isBelowFloor).toBe(true);
    });

    it('clamps text at 9px floor', () => {
      expect(ctx.text(14)).toBe(9);
      expect(ctx.text(18)).toBe(9);
    });

    it('preserves text already at floor', () => {
      expect(ctx.text(9)).toBe(9);
    });

    it('allows custom text floor', () => {
      expect(ctx.text(14, 7)).toBe(7);
    });
  });

  describe('from() below min scale factor (container much smaller than ideal)', () => {
    const ctx = ScaleContext.from(200, 800);

    it('clamps factor at minScaleFactor (0.5)', () => {
      expect(ctx.factor).toBe(0.5);
    });

    it('is below floor', () => {
      expect(ctx.isBelowFloor).toBe(true);
    });
  });

  describe('from() with container larger than ideal', () => {
    const ctx = ScaleContext.from(1200, 800);

    it('clamps factor at 1.0', () => {
      expect(ctx.factor).toBe(1);
    });

    it('returns values unchanged', () => {
      expect(ctx.aesthetic(100)).toBe(100);
      expect(ctx.structural(160)).toBe(160);
      expect(ctx.text(14)).toBe(14);
    });
  });

  describe('custom minScaleFactor', () => {
    const ctx = ScaleContext.from(200, 800, 0.3);

    it('clamps at custom min', () => {
      expect(ctx.factor).toBe(0.3);
    });

    it('is below floor at custom min', () => {
      expect(ctx.isBelowFloor).toBe(true);
    });
  });

  describe('edge case: idealSize = 0', () => {
    const ctx = ScaleContext.from(800, 0);

    it('returns identity', () => {
      expect(ctx.factor).toBe(1);
    });
  });

  describe('fromBox() — fit both axes', () => {
    it('binds on the more constraining (smaller-ratio) axis', () => {
      // Width fits (1200/800=1.5), height is tight (400/800=0.5) → 0.5 wins.
      const ctx = ScaleContext.fromBox(1200, 800, 400, 800);
      expect(ctx.factor).toBe(0.5);
    });

    it('binds on width when width is the tighter axis', () => {
      const ctx = ScaleContext.fromBox(600, 800, 1000, 800);
      expect(ctx.factor).toBe(0.75);
    });

    it('stays at 1.0 when content fits both axes', () => {
      const ctx = ScaleContext.fromBox(1000, 800, 1000, 800);
      expect(ctx.factor).toBe(1);
    });

    it('clamps to the readability floor', () => {
      const ctx = ScaleContext.fromBox(1000, 800, 100, 800);
      expect(ctx.factor).toBe(0.5);
      expect(ctx.isBelowFloor).toBe(true);
    });

    it('treats a zero ideal dimension as non-binding', () => {
      const ctx = ScaleContext.fromBox(600, 800, 400, 0);
      expect(ctx.factor).toBe(0.75); // only width binds
    });
  });

  describe('fromFactor() — explicit factor', () => {
    it('uses the given factor when in range', () => {
      expect(ScaleContext.fromFactor(0.7).factor).toBeCloseTo(0.7, 10);
    });

    it('clamps above 1.0', () => {
      expect(ScaleContext.fromFactor(1.4).factor).toBe(1);
    });

    it('clamps to the floor and flags below-floor', () => {
      const ctx = ScaleContext.fromFactor(0.2);
      expect(ctx.factor).toBe(0.5);
      expect(ctx.isBelowFloor).toBe(true);
    });
  });
});

describe('chart-type minDims (registry, Story 111.5)', () => {
  it('returns content-dependent dimensions for sequence', () => {
    const result = minDims('sequence', {
      participants: 4,
      messages: 10,
    });
    expect(result.width).toBe(320);
    expect(result.height).toBe(320);
  });

  it('scales sequence width with participant count', () => {
    const small = minDims('sequence', { participants: 2 });
    const large = minDims('sequence', { participants: 8 });
    expect(large.width).toBeGreaterThan(small.width);
  });

  it('returns content-dependent dimensions for raci', () => {
    const result = minDims('raci', { roles: 5, tasks: 8 });
    expect(result.width).toBe(430);
    expect(result.height).toBe(304);
  });

  it('returns content-dependent dimensions for mindmap', () => {
    const result = minDims('mindmap', { nodes: 15, depth: 4 });
    expect(result.width).toBe(450);
    expect(result.height).toBe(240);
  });

  it('returns fixed dimensions for tech-radar', () => {
    const result = minDims('tech-radar', { blips: 27 });
    expect(result.width).toBe(360);
    expect(result.height).toBe(400);
  });

  it('returns content-dependent dimensions for heatmap', () => {
    const result = minDims('heatmap', { columns: 6, rows: 5 });
    expect(result.width).toBe(300);
    expect(result.height).toBe(210);
  });

  it('returns content-dependent dimensions for arc', () => {
    const result = minDims('arc', { nodes: 10 });
    expect(result.width).toBe(300);
    expect(result.height).toBe(320);
  });

  it('returns default fallback for unknown chart type', () => {
    const result = minDims('unknown-chart', {});
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it('returns default when counts are missing', () => {
    const result = minDims('sequence', {});
    expect(result.width).toBe(320);
    expect(result.height).toBe(200);
  });
});
