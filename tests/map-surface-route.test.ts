import { describe, it, expect, beforeAll } from 'vitest';
import { resolveSurfaceBow } from '../src/map/surface-route';
import { pointInGeometry, decodeFeatures } from '../src/map/geo';
import type { DecodedFeature } from '../src/map/geo';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap } from '../src/map/layout';
import { createMapGeoQuery } from '../src/map/geo-query';
import { loadMapData } from '../src/map/load-data';
import { getPalette } from '../src/palettes';
import type { MapData } from '../src/map/resolved-types';

// ── Synthetic-projection harness ───────────────────────────────────────────
// An identity-ish forward projection (geo == screen up to scale + y-flip). Geo
// space and screen space coincide so a returned screen `offset` maps back to the
// exact geo bow the helper verified — letting us reconstruct the drawn arc and
// re-test it against the obstacle (the honest "did it actually clear?" gate).
const S = 10;
const OX = 400;
const OY = 300;
const project = (lon: number, lat: number): [number, number] => [
  lon * S + OX,
  -lat * S + OY,
];
const invert = (x: number, y: number): [number, number] => [
  (x - OX) / S,
  -(y - OY) / S,
];

/** A closed rectangular ring [w,s,e,n]. */
const ring = (w: number, s: number, e: number, n: number): number[][] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

const polyFeature = (id: string, rings: number[][][]): DecodedFeature => ({
  type: 'Feature',
  id,
  properties: { name: id },
  geometry: { type: 'Polygon', coordinates: rings },
});

/** Reconstruct legPath's quadratic apex-control (ignoring rim trim) and sample
 *  the interior, inverting each point to geo for an obstacle re-test. */
function interiorSamplesGeo(
  a: { cx: number; cy: number },
  b: { cx: number; cy: number },
  offset: number,
  tLo = 0.18,
  tHi = 0.82,
  n = 8
): Array<[number, number]> {
  const len = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1;
  const nx = -(b.cy - a.cy) / len;
  const ny = (b.cx - a.cx) / len;
  const mx = (a.cx + b.cx) / 2;
  const my = (a.cy + b.cy) / 2;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = tLo + ((tHi - tLo) * i) / n;
    const u = 1 - t;
    const px = u * u * a.cx + 2 * u * t * cx + t * t * b.cx;
    const py = u * u * a.cy + 2 * u * t * cy + t * t * b.cy;
    out.push(invert(px, py));
  }
  return out;
}

const isLand = (feats: DecodedFeature[], lon: number, lat: number): boolean =>
  feats.some((f) => pointInGeometry(f.geometry, lon, lat));

describe('resolveSurfaceBow — water mode clearing a blocking obstacle', () => {
  // Obstacle straddles the chord midpoint; open water above it.
  const obstacle = [polyFeature('cape', [ring(4, -3, 6, 1)])];
  const A: [number, number] = [0, 0];
  const B: [number, number] = [10, 0];
  const a = { cx: project(...A)[0], cy: project(...A)[1] };
  const b = { cx: project(...B)[0], cy: project(...B)[1] };

  it('bows to a clear arc + no diagnostic', () => {
    const r = resolveSurfaceBow({
      a,
      b,
      lonLatA: A,
      lonLatB: B,
      surface: 'water',
      project,
      landFeatures: obstacle,
      fanDelta: 0,
      lineNumber: 3,
    });
    expect(r.curved).toBe(true);
    expect(r.diagnostic).toBeUndefined();
    expect(Math.abs(r.offset)).toBeGreaterThanOrEqual(6);
    // The drawn arc's interior is entirely off land.
    for (const [lon, lat] of interiorSamplesGeo(a, b, r.offset))
      expect(isLand(obstacle, lon, lat)).toBe(false);
  });

  it('is deterministic (byte-identical on repeat — F10)', () => {
    const args = {
      a,
      b,
      lonLatA: A,
      lonLatB: B,
      surface: 'water' as const,
      project,
      landFeatures: obstacle,
      fanDelta: 0,
      lineNumber: 3,
    };
    expect(JSON.stringify(resolveSurfaceBow(args))).toBe(
      JSON.stringify(resolveSurfaceBow(args))
    );
  });

  it('composes the fan delta with the same sign, larger magnitude (F12)', () => {
    const base = resolveSurfaceBow({
      a,
      b,
      lonLatA: A,
      lonLatB: B,
      surface: 'water',
      project,
      landFeatures: obstacle,
      fanDelta: 0,
      lineNumber: 3,
    });
    const fanned = resolveSurfaceBow({
      a,
      b,
      lonLatA: A,
      lonLatB: B,
      surface: 'water',
      project,
      landFeatures: obstacle,
      fanDelta: 8,
      lineNumber: 3,
    });
    expect(Math.sign(fanned.offset)).toBe(Math.sign(base.offset));
    expect(Math.abs(fanned.offset)).toBeGreaterThan(Math.abs(base.offset));
  });
});

describe('resolveSurfaceBow — fallback + skip diagnostics (ADR-5/P4)', () => {
  it('both sides blocked → smallest-deviation + W_MAP_SURFACE_UNSATISFIED', () => {
    // A wall spanning far more latitude than any bow can clear.
    const wall = [polyFeature('wall', [ring(4, -60, 6, 60)])];
    const A: [number, number] = [0, 0];
    const B: [number, number] = [10, 0];
    const r = resolveSurfaceBow({
      a: { cx: project(...A)[0], cy: project(...A)[1] },
      b: { cx: project(...B)[0], cy: project(...B)[1] },
      lonLatA: A,
      lonLatB: B,
      surface: 'water',
      project,
      landFeatures: wall,
      fanDelta: 0,
      lineNumber: 7,
    });
    expect(r.curved).toBe(true); // still draws SOMETHING (closest arc)
    expect(r.diagnostic?.code).toBe('W_MAP_SURFACE_UNSATISFIED');
    expect(r.diagnostic?.line).toBe(7);
  });

  it('sub-floor short water leg → skipped with a diagnostic (P4)', () => {
    const A: [number, number] = [0, 0];
    const B: [number, number] = [1.5, 0]; // ~15px @ S=10 → mostly rim
    const r = resolveSurfaceBow({
      a: { cx: project(...A)[0], cy: project(...A)[1] },
      b: { cx: project(...B)[0], cy: project(...B)[1] },
      lonLatA: A,
      lonLatB: B,
      surface: 'water',
      project,
      landFeatures: [polyFeature('x', [ring(0.5, -1, 1, 1)])],
      fanDelta: 0,
      lineNumber: 9,
    });
    expect(r.diagnostic?.code).toBe('W_MAP_SURFACE_UNSATISFIED');
  });
});

describe('resolveSurfaceBow — antimeridian (F6)', () => {
  it('samples the SHORT way across the seam, ignoring the long-way obstacle', () => {
    // Endpoints straddle ±180 (170 → -170, i.e. 20° east across the seam). A land
    // wall sits at lon 0 — only the WRONG (long-way) path would cross it. With
    // antimeridian wrapping the helper samples near the seam, so the water leg is
    // clear and emits no diagnostic.
    const wall = [polyFeature('antipode-wall', [ring(-5, -80, 5, 80)])];
    const A: [number, number] = [170, 5];
    const B: [number, number] = [-170, 5];
    const r = resolveSurfaceBow({
      a: { cx: project(...A)[0], cy: project(...A)[1] },
      b: { cx: project(...B)[0], cy: project(...B)[1] },
      lonLatA: A,
      lonLatB: B,
      surface: 'water',
      project,
      landFeatures: wall,
      fanDelta: 0,
      lineNumber: 5,
    });
    expect(r.diagnostic).toBeUndefined();
  });
});

describe('resolveSurfaceBow — land mode (full-span)', () => {
  it('bows around a water bay (hole) to keep the arc over land', () => {
    // Big landmass with a bay (hole) straddling the chord; land above the bay.
    const land = [
      polyFeature('continent', [
        ring(-50, -50, 50, 50), // outer land
        ring(4, -1.5, 6, 1.5), // bay (hole = water)
      ]),
    ];
    const A: [number, number] = [0, 0];
    const B: [number, number] = [10, 0];
    const a = { cx: project(...A)[0], cy: project(...A)[1] };
    const b = { cx: project(...B)[0], cy: project(...B)[1] };
    const r = resolveSurfaceBow({
      a,
      b,
      lonLatA: A,
      lonLatB: B,
      surface: 'land',
      project,
      landFeatures: land,
      fanDelta: 0,
      lineNumber: 4,
    });
    expect(r.diagnostic).toBeUndefined();
    // Every full-span sample (land mode tests the full span) is on land.
    for (const [lon, lat] of interiorSamplesGeo(a, b, r.offset, 0, 1, 8))
      expect(isLand(land, lon, lat)).toBe(true);
  });
});

// ── Real-geodata clearance gate (AC1) ───────────────────────────────────────
describe('surface: water over real geodata (AC1)', () => {
  let data: MapData;
  beforeAll(async () => {
    data = await loadMapData();
  });
  const palette = getPalette('nord').light;
  const W = 800;
  const H = 600;

  it('Miami → Havana stays off land', () => {
    const content =
      'map\nprojection mercator\nroute Miami surface: water\n  -> Havana';
    const resolved = resolveMap(parseMap(content), data);
    const layout = layoutMap(
      resolved,
      data,
      { width: W, height: H },
      { palette, isDark: false }
    );
    const q = createMapGeoQuery({
      content,
      width: W,
      height: H,
      data,
      palette,
      isDark: false,
    });
    const countries = decodeFeatures(data.worldDetail);

    expect(layout.legs.length).toBeGreaterThan(0);
    const leg = layout.legs[0]!;
    expect(leg.d).toMatch(/Q/); // surface implies arc (F9)

    // Sample the quadratic interior and confirm each point is off land.
    const m =
      /^M(-?[\d.]+),(-?[\d.]+)Q(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)$/.exec(
        leg.d
      );
    expect(m).not.toBeNull();
    const [x0, y0, cx, cy, x1, y1] = m!.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    let offLand = 0;
    let tested = 0;
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const u = 1 - t;
      const px = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const py = u * u * y0 + 2 * u * t * cy + t * t * y1;
      const ll = q.invert(px, py);
      if (!ll) continue;
      tested++;
      if (!isLand(countries, ll[0], ll[1])) offLand++;
    }
    expect(tested).toBeGreaterThan(0);
    // Allow the rim approach near the two coastal endpoints; the interior must
    // be clear of land.
    expect(offLand).toBe(tested);
  });
});
