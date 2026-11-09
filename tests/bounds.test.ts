import { describe, expect, it } from 'vitest';
import { Bounds, shiftLayout, translateInPlace } from '../src/utils/bounds';

describe('Bounds', () => {
  it('covers centred boxes, corner boxes and points', () => {
    const b = new Bounds();
    b.addCentred({ x: 10, y: 10, width: 20, height: 10 });
    b.addRect({ x: 30, y: -5, width: 5, height: 5 });
    b.addPoints([{ x: -3, y: 40 }]);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([-3, -5, 35, 40]);
  });

  it('is empty until something is added, and orZero collapses it', () => {
    const b = new Bounds();
    expect(b.empty).toBe(true);
    b.orZero();
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 0, 0]);
  });

  it('pads on every side', () => {
    const b = new Bounds();
    b.add(0, 0, 10, 20);
    expect(b.padded(5)).toEqual({ x: -5, y: -5, width: 20, height: 30 });
  });
});

describe('shifting', () => {
  it('keeps the same arrays when there is no shift', () => {
    const nodes = [{ x: 1, y: 2 }];
    const edges = [{ points: [{ x: 0, y: 0 }] }];
    const out = shiftLayout(0, 0, nodes, edges);
    expect(out.nodes).toBe(nodes);
    expect(out.edges).toBe(edges);
  });

  it('copies nodes, edge points and groups when shifted', () => {
    const out = shiftLayout(
      3,
      4,
      [{ x: 1, y: 2 }],
      [{ points: [{ x: 0, y: 0 }] }],
      [{ x: 5, y: 5 }]
    );
    expect(out.nodes[0]).toEqual({ x: 4, y: 6 });
    expect(out.edges[0]!.points[0]).toEqual({ x: 3, y: 4 });
    expect(out.groups[0]).toEqual({ x: 8, y: 9 });
  });

  it('translates in place', () => {
    const pts = [{ x: 1, y: 1 }];
    translateInPlace(pts, 2, -1);
    expect(pts[0]).toEqual({ x: 3, y: 0 });
  });
});
