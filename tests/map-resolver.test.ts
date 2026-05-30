import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { loadMapData } from '../src/map/load-data';
import type { MapData } from '../src/map/resolved-types';
import type { BoundaryTopology, Gazetteer } from '../src/map/data/types';

// ── Tiny hand-built MapData fixture (no I/O; pure unit testing). ──
// A minimal world topo (US, JP, GE=Georgia country) + us-states (CA, OR, ME, GA)
// + a small gazetteer incl. two Portlands + an NYC alias.
// Non-quantized topology with real `arcs` (topojson-client decodes these).
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
  cities: [
    [35.68, 139.69, 'JP', 9_000_000, 'Tokyo'], // 0
    [34.69, 135.5, 'JP', 2_700_000, 'Osaka'], // 1
    [43.66, -70.25, 'US', 66_881, 'Portland', 'US-ME'], // 2 (lower pop)
    [45.52, -122.68, 'US', 652_503, 'Portland', 'US-OR'], // 3 (higher pop)
    [40.71, -74.0, 'US', 8_800_000, 'New York City', 'US-NY'], // 4
    [38.9, -77.04, 'US', 5_000, 'Office', 'US-DC'], // 5
  ],
  byName: {
    tokyo: [0],
    osaka: [1],
    portland: [2, 3], // ME before OR — NOT pop-ordered (R11)
    'new york city': [4],
    office: [5],
  },
  alt: { nyc: 4 },
};

const DATA: MapData = {
  worldCoarse: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
    { id: 'GE', name: 'Georgia', box: [40, 41, 47, 44] }, // country Georgia
    { id: 'CD', name: 'Dem. Rep. Congo', box: [12, -13, 31, 5] }, // NE-abbreviated
  ]),
  worldDetail: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
    { id: 'GE', name: 'Georgia', box: [40, 41, 47, 44] },
    { id: 'CD', name: 'Dem. Rep. Congo', box: [12, -13, 31, 5] },
  ]),
  usStates: rectTopo('states', [
    { id: 'US-CA', name: 'California', box: [-124, 32, -114, 42] },
    { id: 'US-OR', name: 'Oregon', box: [-124, 42, -116, 46] },
    { id: 'US-ME', name: 'Maine', box: [-71, 43, -67, 47] },
    { id: 'US-GA', name: 'Georgia', box: [-85, 30, -81, 35] }, // state Georgia (collides)
  ]),
  gazetteer,
};

const resolve = (src: string) => resolveMap(parseMap(src), DATA);

describe('resolver — regions (AC1-3, AC16, AC22)', () => {
  it('region → country (AC1)', () => {
    const r = resolve('map\ntag M as m\n  HQ blue\nUnited States m: HQ');
    expect(r.regions[0]).toMatchObject({ iso: 'US', layer: 'country' });
  });
  it('region → us-state + basemap (AC2)', () => {
    const r = resolve('map\nCalifornia score: 92');
    expect(r.regions[0]).toMatchObject({
      iso: 'US-CA',
      layer: 'us-state',
      score: 92,
    });
    expect(r.basemaps.subdivisions).toContain('us-states');
  });
  it('region miss → did-you-mean (AC3)', () => {
    const r = resolve('map\nCaliforna score: 1');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Unknown subdivision/.test(d.message)
      )
    ).toBe(true);
  });
  it('duplicate region last-wins (AC16)', () => {
    const r = resolve('map\nCalifornia score: 1\nCalifornia score: 9');
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.score).toBe(9);
    expect(r.diagnostics.some((d) => /[Dd]uplicate/.test(d.message))).toBe(
      true
    );
  });
  it('unsupported subdivision errors (AC22)', () => {
    const r = resolve('map\nBavaria score: 1');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Bavaria/.test(d.message)
      )
    ).toBe(true);
  });
  it('country-vs-state collision: US-scoped → state, else country (AC20)', () => {
    const usScoped = resolve('map\nCalifornia score: 1\nGeorgia score: 2');
    expect(usScoped.regions.find((x) => x.name === 'Georgia')!.iso).toBe(
      'US-GA'
    );
    expect(
      usScoped.diagnostics.some((d) =>
        /both a country and a US state/.test(d.message)
      )
    ).toBe(true);
    const worldScoped = resolve('map\nGeorgia score: 2');
    expect(worldScoped.regions[0]!.iso).toBe('GE');
  });
  it('region scope qualifier forces state and silences ambiguity (§24B.8)', () => {
    for (const src of [
      'map\nGeorgia US score: 2',
      'map\nGeorgia US-GA score: 2',
    ]) {
      const r = resolve(src);
      expect(r.regions[0]).toMatchObject({ iso: 'US-GA', layer: 'us-state' });
      expect(
        r.diagnostics.some((d) =>
          /both a country and a US state/.test(d.message)
        )
      ).toBe(false);
    }
  });
  it('region country-code scope forces country even in US context', () => {
    const r = resolve('map\nCalifornia score: 1\nGeorgia GE score: 2');
    expect(r.regions.find((x) => x.iso === 'GE')).toBeTruthy();
    expect(
      r.diagnostics.some((d) => /both a country and a US state/.test(d.message))
    ).toBe(false);
  });
  it('ambiguity warning teaches the non-redundant scope syntax', () => {
    const r = resolve('map\nCalifornia score: 1\nGeorgia score: 2');
    const w = r.diagnostics.find((d) =>
      /both a country and a US state/.test(d.message)
    );
    // bare ISO codes + name-and-scope, NOT the redundant "Georgia US-GA"
    expect(w!.message).toContain('US-GA');
    expect(w!.message).toContain('GE');
    expect(w!.message).toContain('"Georgia US"');
    expect(w!.message).not.toContain('Georgia US-GA');
  });
  it('region subdivision-scope mismatch errors', () => {
    const r = resolve('map\nGeorgia US-CA score: 2');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /scope US-CA/.test(d.message)
      )
    ).toBe(true);
  });
});

describe('resolver — POIs (AC4-9, AC23)', () => {
  it('POI by name (AC4)', () => {
    const r = resolve('map\npoi Tokyo');
    expect(r.pois[0]).toMatchObject({ id: 'tokyo', lat: 35.68, lon: 139.69 });
  });
  it('scope disambiguation US-ME not US-OR (AC5)', () => {
    const r = resolve('map\npoi Portland US-ME');
    expect(r.pois[0]!.lat).toBe(43.66); // Maine
  });
  it('most-populous + warning for ambiguous (AC6)', () => {
    const r = resolve('map\npoi Portland');
    expect(r.pois[0]!.lat).toBe(45.52); // Oregon, higher pop
    expect(r.diagnostics.some((d) => /ambiguous/.test(d.message))).toBe(true);
  });
  it('alias resolution (AC7)', () => {
    const r = resolve('map\npoi NYC');
    expect(r.pois[0]).toMatchObject({ lat: 40.71, lon: -74.0 });
  });
  it('coords pass through (AC8)', () => {
    const r = resolve('map\npoi 39.74 -104.99 as dcw');
    expect(r.pois[0]).toMatchObject({ id: 'dcw', lat: 39.74, lon: -104.99 });
  });
  it('POI miss → error, dropped (AC9)', () => {
    const r = resolve('map\npoi Nowheresville\npoi Tokyo');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Nowheresville/.test(d.message)
      )
    ).toBe(true);
    expect(r.pois.map((p) => p.id)).toEqual(['tokyo']);
  });
});

describe('resolver — edges & routes (AC10-12, AC23)', () => {
  it('implicit POIs from an edge (AC10)', () => {
    const r = resolve('map\nTokyo -> Osaka');
    expect(r.pois.map((p) => p.id).sort()).toEqual(['osaka', 'tokyo']);
    expect(r.pois.every((p) => p.implicit)).toBe(true);
    expect(r.edges[0]).toMatchObject({ fromId: 'tokyo', toId: 'osaka' });
  });
  it('edge binds to a declared POI; folded match (AC11/AC23)', () => {
    const r = resolve('map\npoi Tokyo\ntokyo -> Osaka');
    const tokyo = r.pois.find((p) => p.id === 'tokyo')!;
    expect(tokyo.implicit).toBeFalsy(); // the declared one
    expect(r.edges[0]!.fromId).toBe('tokyo');
    expect(r.pois.filter((p) => p.id === 'tokyo')).toHaveLength(1); // no duplicate
  });
  it('route loop preserved (AC12)', () => {
    const r = resolve('map\nroute\n  Tokyo\n  Osaka\n  Tokyo');
    expect(r.routes[0]!.stopIds).toEqual(['tokyo', 'osaka', 'tokyo']);
  });
});

describe('resolver — basemap / extent / projection (AC13-15, AC24)', () => {
  it('world-only → no subdivisions (AC13)', () => {
    const r = resolve('map\nUnited States m: HQ\ntag M as m\n  HQ blue');
    expect(r.basemaps.subdivisions).toHaveLength(0);
  });
  it('US-only regions → albers-usa, not natural-earth (AC15/AC24)', () => {
    const r = resolve('map\nCalifornia score: 1\nOregon score: 2');
    expect(r.projection).toBe('albers-usa');
  });
  it('world span → equirectangular (AC15)', () => {
    const r = resolve('map\npoi Tokyo\npoi 40 -74 as ny');
    expect(r.projection).toBe('equirectangular');
  });
  it('tight cluster → mercator (AC15)', () => {
    const r = resolve('map\npoi 40.70 -74.00 as a\npoi 40.75 -74.02 as b');
    expect(r.projection).toBe('mercator');
  });
  it('projection directive overrides (AC15)', () => {
    const r = resolve('map\nprojection mercator\npoi Tokyo\npoi 40 -74 as ny');
    expect(r.projection).toBe('mercator');
  });
  it('projection equirectangular is a valid override (AC15)', () => {
    const r = resolve('map\nprojection equirectangular\nCalifornia score: 1');
    expect(r.projection).toBe('equirectangular');
  });
  it('world-scale frame snaps to full Greenwich longitude, not an antimeridian wrap (no US split)', () => {
    // POIs spanning the globe (Americas + Europe + Asia). The world-scale
    // equirectangular frame must be the conventional full [-180, 180] Greenwich
    // rectangle — NOT a wrapped window (east > 180) that splits the Americas at
    // the seam (the real US country box wraps via its Aleutians). POIs (not the
    // hand-built rect fixtures, whose ring winding confuses geoBounds) so the
    // extent is asserted on real coordinates.
    const r = resolve('map\npoi 10 -120 as a\npoi 10 20 as b\npoi 10 150 as c');
    expect(r.projection).toBe('equirectangular');
    expect(r.extent[0][0]).toBe(-180);
    expect(r.extent[1][0]).toBe(180);
  });
  it('extent bounds POIs with padding (AC14)', () => {
    const r = resolve('map\npoi 40 -74 as a\npoi 42 -71 as b');
    expect(r.extent[0][0]).toBeLessThan(-74);
    expect(r.extent[1][0]).toBeGreaterThan(-71);
  });
  it('antimeridian POI pair gets a TIGHT extent, not a globe-spanning one (R5/#1)', () => {
    // two points either side of the dateline (178°E and 178°W) span ~4°, not 356°
    const r = resolve('map\npoi 0 178 as a\npoi 0 -178 as b');
    const lonSpan = r.extent[1][0] - r.extent[0][0];
    expect(lonSpan).toBeLessThan(30); // tight wrap, not ~356
    expect(r.projection).toBe('mercator'); // tight → mercator, not natural-earth
  });
});

describe('resolver — robustness (AC17, AC18, AC21)', () => {
  it('empty map is valid (AC17)', () => {
    const r = resolve('map');
    expect(r.error).toBeNull();
    expect(r.regions).toHaveLength(0);
    expect(r.pois).toHaveLength(0);
  });
  it('parse diagnostics carried into resolved (AC21)', () => {
    const r = resolve('map\npoi Denver at: 1,2'); // parser emits an `at:` error
    expect(r.diagnostics.some((d) => /at:/.test(d.message))).toBe(true);
  });
  it('resolveMap is sync, pure, never throws, deterministic (AC18)', () => {
    const a = resolve('map\npoi Tokyo\nCalifornia score: 5');
    const b = resolve('map\npoi Tokyo\nCalifornia score: 5');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(() => resolve('map\nA -> \npoi 999 999')).not.toThrow();
  });
});

describe('resolver — impl-review fixes (#3/#6/#8/#13/#15)', () => {
  it('POI-only US map infers default-country US → albers-usa (#3)', () => {
    // No regions; both POIs are US. Before #3, POI ISOs were voided so US was
    // never inferred and the tight extent fell through to mercator.
    const r = resolve('map\npoi New York City\npoi Office');
    expect(r.projection).toBe('albers-usa');
  });
  it('US region + a non-US POI does NOT pick albers-usa (#13)', () => {
    const r = resolve('map\nCalifornia score: 1\npoi Tokyo');
    expect(r.projection).not.toBe('albers-usa');
  });
  it('far-flung coordinate POI also blocks albers-usa (#13)', () => {
    const r = resolve('map\nCalifornia score: 1\npoi 35.68 139.69 as t');
    expect(r.projection).not.toBe('albers-usa');
  });
  it('region matched by ISO code (#6)', () => {
    const r = resolve('map\nJP score: 5');
    expect(r.regions[0]).toMatchObject({ iso: 'JP', layer: 'country' });
  });
  it('region matched via long-form → NE-abbrev alias (#6)', () => {
    const r = resolve('map\nDemocratic Republic of the Congo score: 7');
    expect(r.regions[0]).toMatchObject({ iso: 'CD', layer: 'country' });
  });
  it('ambiguous-name warning uses the W_ code (#15)', () => {
    const r = resolve('map\npoi Portland');
    expect(r.diagnostics.some((d) => d.code === 'W_MAP_AMBIGUOUS_NAME')).toBe(
      true
    );
    expect(r.diagnostics.some((d) => d.code === 'I_MAP_AMBIGUOUS_NAME')).toBe(
      false
    );
  });
  it('edge to a declared POI never demotes it to implicit (#8)', () => {
    const r = resolve('map\npoi Tokyo\nTokyo -> Osaka');
    const tokyo = r.pois.filter((p) => p.id === 'tokyo');
    expect(tokyo).toHaveLength(1);
    expect(tokyo[0]!.implicit).toBeFalsy();
  });
});

describe('loadMapData — real committed assets (AC19)', () => {
  it('loads the four assets in MapData shape', async () => {
    const data = await loadMapData();
    expect(data.worldCoarse.type).toBe('Topology');
    expect(data.usStates.objects.states).toBeDefined();
    expect(Array.isArray(data.gazetteer.cities)).toBe(true);
    expect(data.gazetteer.cities.length).toBeGreaterThan(1000);
  });

  it('common US aliases resolve against the real NE name "United States of America" (#6)', async () => {
    const data = await loadMapData();
    for (const name of ['United States', 'USA', 'America']) {
      const r = resolveMap(parseMap(`map\n${name} score: 5`), data);
      expect(r.regions[0]?.iso, name).toBe('US');
    }
  });
});
