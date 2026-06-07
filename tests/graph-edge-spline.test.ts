import { describe, it, expect } from 'vitest';
import { edgeSplinePath } from '../src/graph/edge-spline';

// Pull the leading "M x,y" and trailing "L x,y" coordinates from a path.
const firstPoint = (d: string) => {
  const m = d.match(/^M([\d.-]+),([\d.-]+)/)!;
  return { x: Number(m[1]), y: Number(m[2]) };
};
const lastPoint = (d: string) => {
  const m = [...d.matchAll(/([\d.-]+),([\d.-]+)/g)].at(-1)!;
  return { x: Number(m[1]), y: Number(m[2]) };
};

describe('edgeSplinePath — clamped basis curve', () => {
  it('starts exactly at the first point and ends at the last (back-edge)', () => {
    // A sharply-turning edge: plain curveBasis would start at
    // (P0+4P1+P2)/6, far from P0. The clamp must pin it to P0/Pn.
    const pts = [
      { x: 403, y: 18.68 },
      { x: 360, y: 30 },
      { x: 330, y: 35 },
    ];
    const d = edgeSplinePath(pts)!;
    expect(d).not.toBeNull();
    expect(firstPoint(d)).toEqual({ x: 403, y: 18.68 });
    expect(lastPoint(d)).toEqual({ x: 330, y: 35 });
  });

  it('passes through endpoints for a straight edge too', () => {
    const pts = [
      { x: 100, y: 50 },
      { x: 150, y: 50 },
      { x: 200, y: 50 },
    ];
    const d = edgeSplinePath(pts)!;
    expect(firstPoint(d)).toEqual({ x: 100, y: 50 });
    expect(lastPoint(d)).toEqual({ x: 200, y: 50 });
  });

  it('handles a degenerate two-point edge', () => {
    const d = edgeSplinePath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(d).not.toBeNull();
    expect(firstPoint(d!)).toEqual({ x: 0, y: 0 });
    expect(lastPoint(d!)).toEqual({ x: 10, y: 10 });
  });
});
