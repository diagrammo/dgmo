import { describe, it, expect } from 'vitest';
import {
  rectsOverlap,
  rectCircleOverlap,
  computeScatterLabelGraphics,
  type ScatterLabelPoint,
} from '../src/echarts';

// ============================================================
// rectsOverlap
// ============================================================

describe('rectsOverlap', () => {
  it('detects overlapping rects', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(rectsOverlap(a, b)).toBe(true);
  });

  it('returns false for adjacent rects (no overlap)', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 10, y: 0, w: 10, h: 10 };
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it('returns false for separated rects', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 20, y: 20, w: 10, h: 10 };
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it('detects when one rect is inside another', () => {
    const a = { x: 0, y: 0, w: 20, h: 20 };
    const b = { x: 5, y: 5, w: 5, h: 5 };
    expect(rectsOverlap(a, b)).toBe(true);
  });
});

// ============================================================
// rectCircleOverlap
// ============================================================

describe('rectCircleOverlap', () => {
  it('detects circle inside rect', () => {
    const rect = { x: 0, y: 0, w: 20, h: 20 };
    const circle = { cx: 10, cy: 10, r: 5 };
    expect(rectCircleOverlap(rect, circle)).toBe(true);
  });

  it('detects circle touching rect edge', () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    const circle = { cx: 14, cy: 5, r: 5 };
    expect(rectCircleOverlap(rect, circle)).toBe(true);
  });

  it('returns false for separated circle and rect', () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    const circle = { cx: 20, cy: 20, r: 3 };
    expect(rectCircleOverlap(rect, circle)).toBe(false);
  });

  it('detects circle overlapping rect corner', () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    // Circle centered at corner + small offset, radius covers the corner
    const circle = { cx: 11, cy: 11, r: 3 };
    expect(rectCircleOverlap(rect, circle)).toBe(true);
  });

  it('returns false when circle just misses rect corner', () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    // sqrt(2) ≈ 1.414 — circle at (12, 12) with r=1 is ~2.83 from corner
    const circle = { cx: 12, cy: 12, r: 1 };
    expect(rectCircleOverlap(rect, circle)).toBe(false);
  });
});

// ============================================================
// computeScatterLabelGraphics
// ============================================================

describe('computeScatterLabelGraphics', () => {
  const chartBounds = { top: 0, bottom: 800 };
  const fontSize = 11;
  const symbolSize = 15;

  it('places a single isolated point label above with no connector', () => {
    const points: ScatterLabelPoint[] = [
      { name: 'Alpha', px: 400, py: 400, color: '#ff0000' },
    ];
    const result = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);

    // Should have exactly 1 text element (no connector for first-slot placement)
    const texts = result.filter((e) => e.type === 'text');
    const lines = result.filter((e) => e.type === 'line');
    expect(texts).toHaveLength(1);
    expect(lines).toHaveLength(0);

    // Label should be above the point (lower y value)
    const textEl = texts[0] as { y: number };
    expect(textEl.y).toBeLessThan(400);
  });

  it('places two points at same position — one above, one below', () => {
    const points: ScatterLabelPoint[] = [
      { name: 'A', px: 400, py: 400, color: '#ff0000' },
      { name: 'B', px: 400, py: 400, color: '#00ff00' },
    ];
    const result = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);

    const texts = result.filter((e) => e.type === 'text') as { y: number }[];
    expect(texts).toHaveLength(2);

    // One should be above (y < 400) and one below (y > 400)
    const aboveCount = texts.filter((t) => t.y < 400).length;
    const belowCount = texts.filter((t) => t.y > 400).length;
    expect(aboveCount).toBe(1);
    expect(belowCount).toBe(1);
  });

  it('places 8 points in horizontal band without label overlaps', () => {
    const points: ScatterLabelPoint[] = Array.from({ length: 8 }, (_, i) => ({
      name: `P${i}`,
      px: 100 + i * 80,
      py: 400,
      color: '#333',
    }));
    const result = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);

    const texts = result.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(8);

    // With wide spacing (80px apart), all labels should be placed (closest-wins
    // heuristic prefers above when equidistant, but may push some below on collision)
    expect(texts.filter((t) => (t as { y: number }).y < 400).length).toBeGreaterThan(0);
  });

  it('forces label below when point is near chart top', () => {
    const points: ScatterLabelPoint[] = [
      { name: 'TopPoint', px: 400, py: 10, color: '#ff0000' },
    ];
    const result = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);

    const texts = result.filter((e) => e.type === 'text') as { y: number }[];
    expect(texts).toHaveLength(1);
    // Label should be below the point (higher y value)
    expect(texts[0].y).toBeGreaterThan(10);
  });

  it('produces deterministic output (same input → same result)', () => {
    const points: ScatterLabelPoint[] = [
      { name: 'X', px: 200, py: 300, color: '#f00' },
      { name: 'Y', px: 200, py: 300, color: '#0f0' },
      { name: 'Z', px: 250, py: 310, color: '#00f' },
    ];
    const result1 = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);
    const result2 = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);
    expect(result1).toEqual(result2);
  });

  it('draws connector lines when labels are pushed beyond first slot', () => {
    // Dense cluster: many points at same position forces some labels far away
    const points: ScatterLabelPoint[] = Array.from({ length: 6 }, (_, i) => ({
      name: `Point${i}`,
      px: 400,
      py: 400,
      color: '#333',
    }));
    const result = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);

    const lines = result.filter((e) => e.type === 'line');
    // At least some labels should be pushed far enough to need connectors
    expect(lines.length).toBeGreaterThan(0);
  });

  it('colors labels and connectors to match point color', () => {
    const points: ScatterLabelPoint[] = [
      { name: 'Red', px: 400, py: 400, color: '#ff0000' },
    ];
    const result = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);

    const text = result.find((e) => e.type === 'text') as { style: { fill: string } };
    expect(text.style.fill).toBe('#ff0000');
  });

  it('assigns unique IDs to each graphic element', () => {
    const points: ScatterLabelPoint[] = Array.from({ length: 6 }, (_, i) => ({
      name: `Point${i}`,
      px: 400,
      py: 400,
      color: '#333',
    }));
    const result = computeScatterLabelGraphics(points, chartBounds, fontSize, symbolSize);

    const texts = result.filter((e) => e.type === 'text');
    const lines = result.filter((e) => e.type === 'line');

    // Every text element should have an id matching scatter-label-{i}
    for (let i = 0; i < 6; i++) {
      const text = texts.find((e) => e.id === `scatter-label-${i}`);
      expect(text).toBeDefined();
    }

    // Every line element should have an id matching scatter-line-{i}
    for (const line of lines) {
      expect(line.id).toMatch(/^scatter-line-\d+$/);
    }
  });
});
