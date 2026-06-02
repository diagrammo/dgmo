import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap, buildMapProjection } from '../src/map/layout';
import { mapContentAspect, mapExportDimensions } from '../src/map/dimensions';
import { getPalette } from '../src/palettes';
import type { MapData } from '../src/map/resolved-types';
import type { BoundaryTopology, Gazetteer } from '../src/map/data/types';

// Reuse the hand-built rectangular MapData fixture shape from map-layout.test.ts.
function rectTopo(
  obj: string,
  geoms: Array<{
    id: string;
    name: string;
    box: [number, number, number, number];
  }>
): BoundaryTopology {
  const arcs = geoms.map((g) => {
    const [w, s, e, n] = g.box;
    return [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ];
  });
  return {
    type: 'Topology',
    arcs,
    objects: {
      [obj]: {
        type: 'GeometryCollection',
        geometries: geoms.map((g, i) => ({
          type: 'Polygon',
          id: g.id,
          properties: { name: g.name },
          arcs: [[i]],
        })),
      },
    },
  } as unknown as BoundaryTopology;
}

const gazetteer: Gazetteer = {
  cities: [[40.71, -74.0, 'US', 8_800_000, 'New York City', 'US-NY']],
  byName: { 'new york city': [0] },
  alt: {},
};

const DATA: MapData = {
  worldCoarse: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
    { id: 'CD', name: 'Dem. Rep. Congo', box: [12, -13, 31, 5] },
  ]),
  worldDetail: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
    { id: 'CD', name: 'Dem. Rep. Congo', box: [12, -13, 31, 5] },
  ]),
  usStates: rectTopo('states', [
    { id: 'US-CA', name: 'California', box: [-124, 32, -114, 42] },
    { id: 'US-OR', name: 'Oregon', box: [-124, 42, -116, 46] },
  ]),
  mountainRanges: rectTopo('ranges', []),
  gazetteer,
};

const P = getPalette('nord').light;
const resolve = (src: string) => resolveMap(parseMap(src), DATA);

const ASPECT_MIN = 0.9;
const ASPECT_MAX = 3.0;

describe('map dimensions — buildMapProjection', () => {
  it('returns a FRESH projection each call (not a shared mutated instance)', () => {
    const r = resolve('map\nCalifornia value: 1');
    const a = buildMapProjection(r, DATA);
    const b = buildMapProjection(r, DATA);
    expect(a.projection).not.toBe(b.projection);
  });

  it('exposes decoded layers + classification', () => {
    const r = resolve('map\nCalifornia value: 1\nOregon value: 2');
    const built = buildMapProjection(r, DATA);
    expect(built.worldLayer.size).toBeGreaterThan(0);
    expect(built.usLayer).not.toBeNull();
    expect(typeof built.fitIsGlobal).toBe('boolean');
  });
});

describe('map dimensions — mapContentAspect', () => {
  it('is finite and positive for a normal map', () => {
    const a = mapContentAspect(resolve('map\nCalifornia value: 1'), DATA);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
  });

  it('is finite for an empty map (no regions referenced)', () => {
    const a = mapContentAspect(resolve('map'), DATA);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
  });

  it('(AC10) is invariant to the square reference-box size', () => {
    const r = resolve('map\nUnited States value: 1\nJapan value: 2');
    const a500 = mapContentAspect(r, DATA, 500);
    const a2000 = mapContentAspect(r, DATA, 2000);
    expect(a500).toBeCloseTo(a2000, 4);
  });

  // NOTE: aspect MAGNITUDES are verified against REAL map data via the CLI (see the
  // spec's baseline table: world ~2.45, US albers ~1.59). The hand-built rectangular
  // fixture distorts world-spanning extents under the mercator rotation, so these
  // tests assert only the robust structural contracts (finite, invariant, clamped).
  it('is deterministic for identical input', () => {
    const r = resolve('map\nCalifornia value: 1');
    expect(mapContentAspect(r, DATA)).toBe(mapContentAspect(r, DATA));
  });
});

describe('map dimensions — mapExportDimensions', () => {
  it('width equals baseWidth; height is a positive finite integer', () => {
    const d = mapExportDimensions(
      resolve('map\nCalifornia value: 1'),
      DATA,
      1200
    );
    expect(d.width).toBe(1200);
    expect(Number.isInteger(d.height)).toBe(true);
    expect(d.height).toBeGreaterThan(0);
    expect(Number.isFinite(d.height)).toBe(true);
  });

  it('never emits NaN/0 dimensions for an empty map', () => {
    const d = mapExportDimensions(resolve('map'), DATA, 1200);
    expect(d.height).toBeGreaterThan(0);
    expect(Number.isNaN(d.height)).toBe(false);
  });

  it('respects baseWidth as a resolution knob', () => {
    const r = resolve('map\nCalifornia value: 1');
    const a = mapExportDimensions(r, DATA, 1200);
    const b = mapExportDimensions(r, DATA, 600);
    expect(a.width).toBe(1200);
    expect(b.width).toBe(600);
    // Same aspect ⇒ proportional height (within rounding).
    expect(a.height / b.height).toBeCloseTo(2, 1);
  });

  it('(AC4) clamps an extreme extent and sets preferContain', () => {
    // US + JP: lonSpan ≥ 180 makes the resolver snap to the full world extent,
    // which in this synthetic rect fixture collapses to an extreme (near-zero-width)
    // aspect → clamp fires → preferContain true; canvas aspect lands within the
    // clamp band [ASPECT_MIN, ASPECT_MAX].
    const d = mapExportDimensions(
      resolve('map\nUnited States value: 1\nJapan value: 2'),
      DATA,
      1200
    );
    const aspect = d.width / d.height;
    expect(d.preferContain).toBe(true);
    expect(aspect).toBeLessThanOrEqual(ASPECT_MAX + 0.001);
    expect(aspect).toBeGreaterThanOrEqual(ASPECT_MIN - 0.001);
  });

  it('(F7) albers-usa forced without us-state content yields finite dims', () => {
    // projection override with no us-states subdivision → usLayer null → fit falls
    // to the extent outline through the conic. Must still produce a finite canvas.
    const d = mapExportDimensions(
      resolve('map\nprojection albers-usa\nUnited States value: 1'),
      DATA,
      1200
    );
    expect(Number.isFinite(d.height)).toBe(true);
    expect(d.height).toBeGreaterThan(0);
  });

  it('does NOT set preferContain for an in-range aspect', () => {
    // A single US state via albers → conus-ish aspect, comfortably in range.
    const d = mapExportDimensions(
      resolve('map\nCalifornia value: 1\nOregon value: 2'),
      DATA,
      1200
    );
    const aspect = d.width / d.height;
    if (aspect > ASPECT_MIN + 0.01 && aspect < ASPECT_MAX - 0.01) {
      expect(d.preferContain).toBe(false);
    }
  });
});

describe('map dimensions — renderer honors preferContain (Task 4)', () => {
  const globalSrc = 'map\nUnited States value: 1\nJapan value: 2';

  it('global extent WITHOUT preferContain → stretch-fill (layout.stretch set)', () => {
    const r = resolve(globalSrc);
    const built = buildMapProjection(r, DATA);
    expect(built.fitIsGlobal).toBe(true); // precondition: this IS a global extent
    const lay = layoutMap(
      r,
      DATA,
      { width: 1200, height: 800 },
      {
        palette: P,
        isDark: false,
      }
    );
    expect(lay.stretch).not.toBeNull();
  });

  it('global extent WITH preferContain → contain-fit (layout.stretch null)', () => {
    const r = resolve(globalSrc);
    const lay = layoutMap(
      r,
      DATA,
      { width: 1200, height: 800 },
      {
        palette: P,
        isDark: false,
        preferContain: true,
      }
    );
    expect(lay.stretch).toBeNull();
  });
});
