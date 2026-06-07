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

// The last two distinct coordinate pairs in a path — used to assert the
// final segment is non-degenerate (so marker-end orients correctly in
// WebKit; a zero-length final segment gives WKWebView a bad arrow angle).
const lastTwoPoints = (d: string) => {
  const all = [...d.matchAll(/([\d.-]+),([\d.-]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  const last = all.at(-1)!;
  for (let i = all.length - 2; i >= 0; i--) {
    const p = all[i]!;
    if (p.x !== last.x || p.y !== last.y) return [p, last] as const;
  }
  return [last, last] as const;
};

describe('edgeSplinePath — basis curve through endpoints', () => {
  it('starts at the first point and ends at the last (back-edge)', () => {
    // curveBasis already moveTo(P0) and lineTo(Pn), so the path reaches
    // both node borders without any endpoint-clamping hack.
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

  it('ends with a non-degenerate segment (WebKit arrowhead orientation)', () => {
    // Regression for the triplicated-endpoint clamp: it appended
    // zero-length trailing segments and WebKit drew arrowheads askew.
    const d = edgeSplinePath([
      { x: 372.25, y: 50 },
      { x: 372.25, y: 80 },
      { x: 372.25, y: 110 },
    ])!;
    const [penultimate, last] = lastTwoPoints(d);
    expect(penultimate).not.toEqual(last);
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
