import { describe, it, expect, beforeAll } from 'vitest';
import { createMapGeoQuery } from '../src/map/geo-query';
import type { MapGeoQuery } from '../src/map/geo-query';
import { decodeFeatures, regionAt } from '../src/map/geo';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { loadMapData } from '../src/map/load-data';
import type { MapData } from '../src/map/resolved-types';
import { getPalette } from '../src/palettes';

// Real gazetteer + topology (no hand-built fixtures) — the geocode/inversion
// math is only meaningful against the shipped boundary data. Assertion-based, no
// snapshots, no TZ concern (the pipeline is pure + deterministic).
const palette = getPalette('nord').light;
const W = 900;
const H = 650;

let data: MapData;
beforeAll(async () => {
  data = await loadMapData();
});

/** A US albers-usa map (references two states → us-states + insets present). */
function usQuery(): MapGeoQuery {
  return createMapGeoQuery({
    content:
      'map\nprojection albers-usa\nFlorida heat: 50\nCalifornia heat: 80',
    width: W,
    height: H,
    data,
    palette,
    isDark: false,
  });
}

describe('createMapGeoQuery — invert/project round-trip', () => {
  it('CONUS point round-trips through pixel space (≈ original)', () => {
    const q = usQuery();
    const slc: [number, number] = [-111.891, 40.7608];
    const px = q.project(slc);
    expect(px).not.toBeNull();
    expect(px![0]).toBeGreaterThanOrEqual(0);
    expect(px![0]).toBeLessThanOrEqual(W);
    const back = q.invert(px![0], px![1]);
    expect(back).not.toBeNull();
    expect(back![0]).toBeCloseTo(slc[0], 1);
    expect(back![1]).toBeCloseTo(slc[1], 1);
  });

  it('AC2 (composite): a pixel in the Alaska inset inverts to Alaska, not CONUS', () => {
    const q = usQuery();
    const ak: [number, number] = [-150, 64];
    const px = q.project(ak);
    expect(px).not.toBeNull();
    const back = q.invert(px![0], px![1]);
    expect(back).not.toBeNull();
    // Inverted against the FITTED inset projection → real Alaska coords, NOT a
    // lower-48 / ocean coordinate.
    expect(back![1]).toBeGreaterThan(55); // far north — unmistakably Alaska
    expect(back![0]).toBeCloseTo(ak[0], 0);
    expect(back![1]).toBeCloseTo(ak[1], 0);
  });

  it('AC2 (composite): a pixel in the Hawaii inset inverts to Hawaii', () => {
    const q = usQuery();
    const hi: [number, number] = [-157.86, 21.3];
    const px = q.project(hi);
    expect(px).not.toBeNull();
    const back = q.invert(px![0], px![1]);
    expect(back).not.toBeNull();
    expect(back![1]).toBeLessThan(25); // tropical latitude — Hawaii
    expect(back![0]).toBeCloseTo(hi[0], 0);
    expect(back![1]).toBeCloseTo(hi[1], 0);
  });
});

describe('regionAt — point-in-polygon reverse geocode (F4)', () => {
  it('a point in Florida → country US, state US-FL', () => {
    const countries = decodeFeatures(data.worldDetail);
    const states = decodeFeatures(data.usStates);
    const hit = regionAt([-81.5, 28.0], countries, states);
    expect(hit.country?.iso).toBe('US');
    expect(hit.state?.iso).toBe('US-FL');
  });

  it('a point in France → country FR, no state', () => {
    const countries = decodeFeatures(data.worldDetail);
    const states = decodeFeatures(data.usStates);
    const hit = regionAt([2.35, 48.85], countries, states);
    expect(hit.country?.iso).toBe('FR');
    expect(hit.state).toBeNull();
  });

  it('an open-ocean point → country null, state null (no guessing)', () => {
    const countries = decodeFeatures(data.worldDetail);
    const states = decodeFeatures(data.usStates);
    const hit = regionAt([-140, 5], countries, states);
    expect(hit.country).toBeNull();
    expect(hit.state).toBeNull();
  });

  // F3: deterministic on-boundary handling — a point exactly on a shared edge or
  // vertex must resolve (to the first iterated country), never fall through to
  // null over land.
  const SQUARE = {
    type: 'Feature' as const,
    id: 'AA',
    properties: { name: 'Alpha' },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
  };

  it('a point exactly on a polygon edge resolves (not null)', () => {
    expect(regionAt([5, 0], [SQUARE], null).country?.iso).toBe('AA'); // on bottom edge
    expect(regionAt([10, 5], [SQUARE], null).country?.iso).toBe('AA'); // on right edge
    expect(regionAt([0, 0], [SQUARE], null).country?.iso).toBe('AA'); // on a vertex
  });

  it('a point clearly outside the polygon is still null', () => {
    expect(regionAt([20, 20], [SQUARE], null).country).toBeNull();
    expect(regionAt([5, 5], [SQUARE], null).country?.iso).toBe('AA'); // interior
  });

  it('a point inside a hole is excluded, but on the hole edge is included', () => {
    const donut = {
      ...SQUARE,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          SQUARE.geometry.coordinates[0]!,
          [
            [3, 3],
            [7, 3],
            [7, 7],
            [3, 7],
            [3, 3],
          ],
        ],
      },
    };
    expect(regionAt([5, 5], [donut], null).country).toBeNull(); // inside the hole
    expect(regionAt([3, 5], [donut], null).country?.iso).toBe('AA'); // on hole edge = land
  });
});

describe('locate — unified result card', () => {
  it('nearest city near Salt Lake → Salt Lake City, sane distance (A4)', () => {
    const q = usQuery();
    const px = q.project([-111.891, 40.7608]);
    const card = q.locate(px![0], px![1]);
    expect(card).not.toBeNull();
    expect(card!.nearestCity?.name).toBe('Salt Lake City');
    expect(card!.nearestCity!.distanceKm).toBeLessThan(30);
  });

  it('clicking Florida yields the scoped region tokens (AC3)', () => {
    const q = usQuery();
    const px = q.project([-81.5, 28.0]);
    const card = q.locate(px![0], px![1]);
    expect(card!.country?.iso).toBe('US');
    expect(card!.state?.iso).toBe('US-FL');
    expect(card!.tokens.state?.primary).toBe('Florida US-FL');
    // Bare `FL` is intentionally absent — it fails to resolve ("Unknown
    // subdivision"); only `US-FL` and the bare name resolve.
    expect(card!.tokens.state?.alternates).toEqual(
      expect.arrayContaining(['US-FL', 'Florida'])
    );
    expect(card!.tokens.state?.alternates).not.toContain('FL');
    // Country leads with its bare name (the scoped form fails to resolve).
    expect(card!.tokens.country?.primary).toMatch(/^United States/);
    expect(card!.tokens.country?.alternates).toContain('US');
    // City token is a positional POI line, not a bare region.
    expect(card!.tokens.city?.token).toMatch(/^poi /);
  });

  it('coordPoiLine is positional `poi <lat> <lon>`, never `@lat,lon` (A5)', () => {
    const q = usQuery();
    const px = q.project([-81.5, 28.0]);
    const card = q.locate(px![0], px![1]);
    expect(card!.tokens.coordPoiLine).toMatch(
      /^poi -?\d+(\.\d+)? -?\d+(\.\d+)?$/
    );
    expect(card!.tokens.coordPoiLine).not.toContain('@');
  });
});

describe('token validity (AC5) — every emitted token RESOLVES with zero errors', () => {
  // Round-trip through resolveMap (not just parseMap): a token can be
  // syntactically valid yet fail to resolve to a real region/POI.
  it('region/coord/city tokens resolve to a real region or POI, zero errors', () => {
    const q = usQuery();
    const px = q.project([-81.5, 28.0]);
    const card = q.locate(px![0], px![1])!;
    const tokens = [
      card.tokens.coordPoiLine,
      card.tokens.state!.primary,
      ...card.tokens.state!.alternates,
      card.tokens.country!.primary,
      ...card.tokens.country!.alternates,
      card.tokens.city!.token,
    ];
    for (const tok of tokens) {
      const resolved = resolveMap(parseMap(`map\n${tok}`), data);
      const errors = resolved.diagnostics.filter((d) => d.severity === 'error');
      expect(
        errors,
        `token "${tok}" produced: ${JSON.stringify(errors)}`
      ).toHaveLength(0);
      // It must actually bind to something (region or POI), not silently vanish.
      expect(
        resolved.regions.length + resolved.pois.length,
        `token "${tok}" resolved to nothing`
      ).toBeGreaterThan(0);
    }
  });

  it('coordPoiLine is positional `poi <lat> <lon>`, never `@lat,lon`', () => {
    const q = usQuery();
    const px = q.project([-81.5, 28.0]);
    const card = q.locate(px![0], px![1])!;
    expect(card.tokens.coordPoiLine).toMatch(/^poi -?\d/);
    expect(card.tokens.coordPoiLine).not.toContain('@');
  });
});

describe('determinism', () => {
  it('same (content, dims, data) → identical locate output', () => {
    const a = usQuery();
    const b = usQuery();
    const pxA = a.project([-81.5, 28.0])!;
    const pxB = b.project([-81.5, 28.0])!;
    expect(pxA).toEqual(pxB);
    expect(a.locate(pxA[0], pxA[1])).toEqual(b.locate(pxB[0], pxB[1]));
  });
});

describe('cities — culled + projected overlay layer (F5)', () => {
  it('returns on-canvas, population-ranked dots, capped well under the full gazetteer', () => {
    const q = usQuery();
    const dots = q.cities();
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.length).toBeLessThanOrEqual(250);
    for (const d of dots) {
      expect(d.px).toBeGreaterThanOrEqual(0);
      expect(d.px).toBeLessThanOrEqual(W);
      expect(d.py).toBeGreaterThanOrEqual(0);
      expect(d.py).toBeLessThanOrEqual(H);
    }
  });
});
