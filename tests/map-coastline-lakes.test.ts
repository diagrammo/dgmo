import { describe, it, expect } from 'vitest';
import { coastlineOuterRings } from '../src/map/renderer';
import type { MapLayoutRegion } from '../src/map/layout';

// Parse SVG subpaths (`M…L…`) into arrays of points, one array per subpath.
function subpaths(paths: string[]): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  for (const d of paths)
    for (const sub of d.split('M').filter(Boolean)) {
      const p: Array<[number, number]> = [
        ...('M' + sub).matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g),
      ].map((m) => [parseFloat(m[1]!), parseFloat(m[2]!)]);
      if (p.length) out.push(p);
    }
  return out;
}

function inRing(
  px: number,
  py: number,
  ring: Array<[number, number]>
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function region(id: string, ring: Array<[number, number]>): MapLayoutRegion {
  const d =
    ring.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') + 'Z';
  return {
    id,
    d,
    fill: 'none',
    stroke: 'none',
    layer: 'base',
    rings: [ring],
  } as unknown as MapLayoutRegion;
}

// Count coast segments whose midpoint runs through open lake water. Tested
// against an INSET of the lake so a segment sitting ON the lake shore (the
// lake's own ring, always buffered) doesn't false-positive — only a segment
// crossing the open interior (a border seam) does.
function seamCount(paths: string[], interior: Array<[number, number]>): number {
  let n = 0;
  for (const p of subpaths(paths))
    for (let i = 1; i < p.length; i++) {
      const mx = (p[i - 1]![0] + p[i]![0]) / 2;
      const my = (p[i - 1]![1] + p[i]![1]) / 2;
      if (inRing(mx, my, interior)) n++;
    }
  return n;
}

describe('coastlineOuterRings — lake clipping (Great-Lakes seam)', () => {
  // Lake square + an inset used only for seam detection.
  const LAKE: Array<[number, number]> = [
    [40, 40],
    [60, 40],
    [60, 60],
    [40, 60],
  ];
  const LAKE_INNER: Array<[number, number]> = [
    [43, 43],
    [57, 43],
    [57, 57],
    [43, 57],
  ];
  // Land ring whose top edge (y=50) is sampled every 10px and runs straight
  // through the lake's middle — a state/country border crossing open water.
  const land: Array<[number, number]> = [
    ...Array.from({ length: 11 }, (_, i): [number, number] => [i * 10, 50]),
    [100, 200],
    [0, 200],
  ];

  it('drops land-ring segments that cross a lake interior', () => {
    const paths = coastlineOuterRings(
      [region('land', land), region('lake', LAKE)],
      0
    );
    expect(seamCount(paths, LAKE_INNER)).toBe(0);
  });

  it('keeps that same border segment when no lake is present (control)', () => {
    // Proves the emptiness above is the clip, not merely missing geometry.
    const paths = coastlineOuterRings([region('land', land)], 0);
    expect(seamCount(paths, LAKE_INNER)).toBeGreaterThan(0);
  });

  it('still buffers the lake shore (its own ring) while clipping land', () => {
    const paths = coastlineOuterRings(
      [region('land', land), region('lake', LAKE)],
      0
    );
    const flat = paths.join(' ');
    expect(flat).toContain('40,40');
    expect(flat).toContain('60,60');
  });
});
