import { describe, it, expect } from 'vitest';
import {
  rectsOverlap,
  computeQuadrantPointLabels,
  type QuadrantLabelPoint,
  type LabelRect,
} from '../src/label-layout';

const chartBounds = { left: 0, top: 0, right: 800, bottom: 600 };
const pointRadius = 6;
const fontSize = 12;

describe('computeQuadrantPointLabels', () => {
  it('places a single isolated point label without collision', () => {
    const points: QuadrantLabelPoint[] = [{ label: 'Alpha', cx: 400, cy: 300 }];
    const result = computeQuadrantPointLabels(
      points,
      chartBounds,
      [],
      pointRadius,
      fontSize
    );

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Alpha');
    // Should be placed above the point (lower y)
    expect(result[0].y).toBeLessThan(300);
    expect(result[0].anchor).toBe('middle');
  });

  it('places two overlapping points without label collision', () => {
    const points: QuadrantLabelPoint[] = [
      { label: 'A', cx: 400, cy: 300 },
      { label: 'B', cx: 400, cy: 300 },
    ];
    const result = computeQuadrantPointLabels(
      points,
      chartBounds,
      [],
      pointRadius,
      fontSize
    );

    expect(result).toHaveLength(2);

    // Build label rects and verify no overlap
    const rects = result.map((r) => {
      const w = r.label.length * fontSize * 0.6 + 8;
      const h = fontSize + 4;
      return {
        x:
          r.anchor === 'middle'
            ? r.x - w / 2
            : r.anchor === 'end'
              ? r.x - w
              : r.x,
        y: r.y - h / 2,
        w,
        h,
      };
    });
    expect(rectsOverlap(rects[0], rects[1])).toBe(false);
  });

  it('avoids obstacle rects (quadrant labels)', () => {
    // Place a large obstacle directly above the point
    const obstacle: LabelRect = { x: 350, y: 200, w: 100, h: 80 };
    const points: QuadrantLabelPoint[] = [{ label: 'Test', cx: 400, cy: 290 }];
    const result = computeQuadrantPointLabels(
      points,
      chartBounds,
      [obstacle],
      pointRadius,
      fontSize
    );

    expect(result).toHaveLength(1);
    // Label should NOT overlap with the obstacle
    const labelW = 'Test'.length * fontSize * 0.6 + 8;
    const labelH = fontSize + 4;
    const labelRect: LabelRect = {
      x: result[0].anchor === 'middle' ? result[0].x - labelW / 2 : result[0].x,
      y: result[0].y - labelH / 2,
      w: labelW,
      h: labelH,
    };
    expect(rectsOverlap(labelRect, obstacle)).toBe(false);
  });

  it('constrains labels within chart bounds', () => {
    // Point near top edge — label should go below
    const points: QuadrantLabelPoint[] = [{ label: 'Top', cx: 400, cy: 5 }];
    const result = computeQuadrantPointLabels(
      points,
      chartBounds,
      [],
      pointRadius,
      fontSize
    );

    expect(result).toHaveLength(1);
    // Label should be below the point (higher y)
    expect(result[0].y).toBeGreaterThan(5);
  });

  it('constrains labels within chart bounds at right edge', () => {
    // Point near right edge — label may go left
    const points: QuadrantLabelPoint[] = [
      { label: 'RightEdgePoint', cx: 795, cy: 300 },
    ];
    const result = computeQuadrantPointLabels(
      points,
      chartBounds,
      [],
      pointRadius,
      fontSize
    );

    expect(result).toHaveLength(1);
    // Label rect should not exceed chart right bound
    const labelW = 'RightEdgePoint'.length * fontSize * 0.6 + 8;
    let labelLeft: number;
    if (result[0].anchor === 'middle') labelLeft = result[0].x - labelW / 2;
    else if (result[0].anchor === 'end') labelLeft = result[0].x - labelW;
    else labelLeft = result[0].x;
    expect(labelLeft + labelW).toBeLessThanOrEqual(chartBounds.right);
  });

  it('produces deterministic output', () => {
    const points: QuadrantLabelPoint[] = [
      { label: 'X', cx: 200, cy: 300 },
      { label: 'Y', cx: 200, cy: 300 },
      { label: 'Z', cx: 250, cy: 310 },
    ];
    const r1 = computeQuadrantPointLabels(
      points,
      chartBounds,
      [],
      pointRadius,
      fontSize
    );
    const r2 = computeQuadrantPointLabels(
      points,
      chartBounds,
      [],
      pointRadius,
      fontSize
    );
    expect(r1).toEqual(r2);
  });

  it('draws connector lines when labels are pushed far from point', () => {
    // Dense cluster: many points at same position
    const points: QuadrantLabelPoint[] = Array.from({ length: 8 }, (_, i) => ({
      label: `Point${i}`,
      cx: 400,
      cy: 300,
    }));
    const result = computeQuadrantPointLabels(
      points,
      chartBounds,
      [],
      pointRadius,
      fontSize
    );

    expect(result).toHaveLength(8);
    // At least some labels should be pushed far enough to need connectors
    const withConnectors = result.filter((r) => r.connectorLine);
    expect(withConnectors.length).toBeGreaterThan(0);
  });

  it('no label-label overlaps in a dense cluster', () => {
    const points: QuadrantLabelPoint[] = Array.from({ length: 6 }, (_, i) => ({
      label: `Item${i}`,
      cx: 400 + (i % 3) * 15,
      cy: 300 + Math.floor(i / 3) * 15,
    }));
    const result = computeQuadrantPointLabels(
      points,
      chartBounds,
      [],
      pointRadius,
      fontSize
    );

    // Build label rects and check pairwise
    const rects: LabelRect[] = result.map((r) => {
      const w = r.label.length * fontSize * 0.6 + 8;
      const h = fontSize + 4;
      let x: number;
      if (r.anchor === 'middle') x = r.x - w / 2;
      else if (r.anchor === 'end') x = r.x - w;
      else x = r.x;
      return { x, y: r.y - h / 2, w, h };
    });

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(
          rectsOverlap(rects[i], rects[j]),
          `Labels ${i} and ${j} overlap`
        ).toBe(false);
      }
    }
  });
});
