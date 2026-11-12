import { describe, it, expect } from 'vitest';
import {
  coastOuterRings,
  coastSources,
  traceCoastRings,
  type CoastFieldInput,
} from '../src/map/coast-rings';

type Pt = [number, number];
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Every vertex of a traced path `d`, with its subpath count and closed count. */
function parse(d: string): { pts: Pt[]; subpaths: number; closed: number } {
  const pts: Pt[] = [];
  for (const m of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g))
    pts.push([Number(m[1]), Number(m[2])]);
  return {
    pts,
    subpaths: (d.match(/M/g) ?? []).length,
    closed: (d.match(/Z/g) ?? []).length,
  };
}

/** Distance from a point to an axis-aligned box (0 inside). */
function boxDist(
  [x, y]: Pt,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

const island = box(40, 40, 60, 60);
const base = (over: Partial<CoastFieldInput> = {}): CoastFieldInput => ({
  bounds: [0, 0, 100, 100],
  sources: coastSources([island]),
  land: [[island]],
  water: [],
  masked: [],
  levels: [3, 6],
  cell: 0.5,
  ...over,
});

describe('coast rings — offset iso-lines of the distance from the coast (#1770)', () => {
  it('an island grows one closed ring per level, every vertex at that distance on the water side', () => {
    const paths = traceCoastRings(base());
    expect(paths).toHaveLength(2);
    [3, 6].forEach((L, k) => {
      const { pts, subpaths, closed } = parse(paths[k]!);
      expect(subpaths).toBe(1);
      expect(closed).toBe(1);
      expect(pts.length).toBeGreaterThan(8);
      for (const p of pts) {
        // Path coords are rounded to 0.1 px; allow that plus interpolation.
        expect(Math.abs(boxDist(p, 40, 40, 60, 60) - L)).toBeLessThan(0.15);
      }
    });
  });

  it('corners round off (union of discs), as the old round-joined stroke did', () => {
    const { pts } = parse(traceCoastRings(base({ levels: [6] }))[0]!);
    // Some vertex sits on the corner arc, diagonal from (60,60).
    const diag = pts.filter((p) => p[0] > 60.5 && p[1] > 60.5);
    expect(diag.length).toBeGreaterThan(0);
    for (const p of diag)
      expect(Math.abs(Math.hypot(p[0] - 60, p[1] - 60) - 6)).toBeLessThan(0.15);
  });

  it('no ring is ever traced on land', () => {
    // A big landmass with a far-away source: without the land sign the field
    // inside the land would read as open water and grow rings.
    const land = box(10, 10, 90, 90);
    const paths = traceCoastRings(
      base({ land: [[land]], sources: coastSources([land]) })
    );
    for (const d of paths)
      for (const p of parse(d).pts)
        expect(boxDist(p, 10, 10, 90, 90)).toBeGreaterThan(2.5);
  });

  it('two coasts closer than twice the level merge into one ring (a narrow strait closes)', () => {
    const a = box(20, 40, 48, 60);
    const b = box(52, 40, 80, 60); // 4 px strait
    const paths = traceCoastRings(
      base({
        land: [[a], [b]],
        sources: coastSources([a, b]),
        levels: [3],
      })
    );
    const { subpaths, pts } = parse(paths[0]!);
    expect(subpaths).toBe(1); // one ring around both, not two
    expect(
      pts.some((p) => p[0] > 48 && p[0] < 52 && p[1] > 41 && p[1] < 59)
    ).toBe(false);
  });

  it('a lake shore rings INWARD, on the lake water', () => {
    const land = box(10, 10, 90, 90);
    const lake = box(35, 35, 65, 65);
    const paths = traceCoastRings(
      base({
        bounds: [0, 0, 100, 100],
        land: [[land]],
        water: [[lake]],
        sources: coastSources([land, lake]),
        levels: [3],
      })
    );
    const inLake = parse(paths[0]!).pts.filter(
      (p) => p[0] > 35 && p[0] < 65 && p[1] > 35 && p[1] < 65
    );
    expect(inLake.length).toBeGreaterThanOrEqual(4); // concave corners stay sharp
    for (const p of inLake)
      expect(Math.min(p[0] - 35, 65 - p[0], p[1] - 35, 65 - p[1])).toBeCloseTo(
        3,
        0
      );
  });

  it('a frame-cut edge is not coast: land clipped at the canvas edge grows no ring along it', () => {
    const land = box(0, 30, 50, 70); // runs off the left edge
    const sources = coastSources([land], { w: 100, h: 100 });
    // The left edge (x = 0) is dropped; one open run remains.
    expect(sources).toHaveLength(1);
    expect(sources[0]!.closed).toBe(false);
    const paths = traceCoastRings(
      base({ land: [[land]], sources, levels: [3] })
    );
    const { pts, closed } = parse(paths[0]!);
    expect(closed).toBe(0); // open: it ends at the frame
    expect(Math.min(...pts.map((p) => p[0]))).toBeLessThan(0.6);
    for (const p of pts) expect(boxDist(p, 0, 30, 50, 70)).toBeCloseTo(3, 0);
  });

  it('a moat around an inset box: rings stop short of it, and nothing is drawn inside', () => {
    const quad = { points: box(62, 30, 90, 70) };
    const paths = traceCoastRings(
      base({ levels: [6], maskInside: { quads: [quad], reach: 4 } })
    );
    const { pts, closed } = parse(paths[0]!);
    expect(closed).toBe(0); // the ring is cut open by the moat
    for (const p of pts) expect(boxDist(p, 62, 30, 90, 70)).toBeGreaterThan(3);
  });

  it('keepInside (an inset box): rings fade out before the frame', () => {
    const quad = { points: box(20, 20, 80, 80) };
    const paths = traceCoastRings(
      base({
        levels: [3, 6],
        keepInside: { quad, reach: 25 },
      })
    );
    // Eroded by 25 px leaves 45..55 — inside the 40..60 island: no water left.
    expect(paths.every((d) => d === '')).toBe(true);
    const roomy = traceCoastRings(
      base({ levels: [3], keepInside: { quad, reach: 5 } })
    );
    for (const p of parse(roomy[0]!).pts)
      expect(boxDist(p, 25, 25, 75, 75)).toBe(0);
  });

  it('is deterministic', () => {
    expect(traceCoastRings(base())).toEqual(traceCoastRings(base()));
  });

  it('coastOuterRings skips holes and enclaves (odd containment depth) and degenerate rings', () => {
    const outer = box(0, 0, 50, 50);
    const hole = box(10, 10, 20, 20);
    const islandInHole = box(12, 12, 14, 14);
    const speck = box(30, 30, 30.1, 30.1);
    const rings = coastOuterRings([[outer, hole, islandInHole, speck]], 1);
    expect(rings).toEqual([outer, islandInHole]);
  });
});
