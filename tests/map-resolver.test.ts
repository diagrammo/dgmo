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
    const r = resolve('map\nCalifornia value: 92');
    expect(r.regions[0]).toMatchObject({
      iso: 'US-CA',
      layer: 'us-state',
      value: 92,
    });
    expect(r.basemaps.subdivisions).toContain('us-states');
  });
  it('region miss → did-you-mean (AC3)', () => {
    const r = resolve('map\nCaliforna value: 1');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Unknown subdivision/.test(d.message)
      )
    ).toBe(true);
  });
  it('duplicate region last-wins (AC16)', () => {
    const r = resolve('map\nCalifornia value: 1\nCalifornia value: 9');
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.value).toBe(9);
    expect(r.diagnostics.some((d) => /[Dd]uplicate/.test(d.message))).toBe(
      true
    );
  });
  it('unsupported subdivision errors (AC22)', () => {
    const r = resolve('map\nBavaria value: 1');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Bavaria/.test(d.message)
      )
    ).toBe(true);
  });
  it('country-vs-state collision: US-scoped → state (silent), else country (AC20)', () => {
    const usScoped = resolve('map\nCalifornia value: 1\nGeorgia value: 2');
    expect(usScoped.regions.find((x) => x.name === 'Georgia')!.iso).toBe(
      'US-GA'
    );
    // A US context (here, the California state reference) makes the state the
    // obvious intent — resolve silently, no ambiguity warning.
    expect(
      usScoped.diagnostics.some((d) =>
        /both a country and a US state/.test(d.message)
      )
    ).toBe(false);
    const worldScoped = resolve('map\nGeorgia value: 2');
    expect(worldScoped.regions[0]!.iso).toBe('GE');
  });
  it('region us-states directive silences country-vs-state ambiguity', () => {
    const r = resolve('map\nregion us-states\nGeorgia value: 2');
    expect(r.regions[0]).toMatchObject({ iso: 'US-GA', layer: 'us-state' });
    expect(
      r.diagnostics.some((d) => /both a country and a US state/.test(d.message))
    ).toBe(false);
  });
  it('region scope qualifier forces state and silences ambiguity (§24B.8)', () => {
    for (const src of [
      'map\nGeorgia US value: 2',
      'map\nGeorgia US-GA value: 2',
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
    const r = resolve('map\nCalifornia value: 1\nGeorgia GE value: 2');
    expect(r.regions.find((x) => x.iso === 'GE')).toBeTruthy();
    expect(
      r.diagnostics.some((d) => /both a country and a US state/.test(d.message))
    ).toBe(false);
  });
  it('ambiguity warning teaches the non-redundant scope syntax', () => {
    const r = resolve('map\nGeorgia value: 2');
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
    const r = resolve('map\nGeorgia US-CA value: 2');
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
  it('bare US state postal code resolves to the state (§24B.8, 2026-06-01)', () => {
    // `OR` is a US state postal code → US-OR (Oregon), NOT a country code; it
    // also bootstraps US scope so this works standalone.
    const r = resolve('map\npoi Portland OR');
    expect(r.pois[0]!.lat).toBe(45.52); // Oregon
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
  it('edge referencing an aliased POI by NAME binds to it (no duplicate)', () => {
    const r = resolve('map\npoi Tokyo as hq\npoi Osaka as branch\nhq -> Tokyo');
    // `Tokyo` is the hq POI's name; the edge must bind to `hq`, not spawn a
    // second implicit "tokyo" dot on the same spot.
    expect(r.pois.map((p) => p.id).sort()).toEqual(['branch', 'hq']);
    expect(r.pois.some((p) => p.id === 'tokyo')).toBe(false);
    expect(r.edges[0]).toMatchObject({ fromId: 'hq', toId: 'hq' });
  });
  it('route loop: unique stop markers + explicit closing leg (AC12)', () => {
    const r = resolve('map\nroute Tokyo\n  -> Osaka\n  -> Tokyo');
    // stopIds are UNIQUE (origin not duplicated by the loop close)…
    expect(r.routes[0]!.stopIds).toEqual(['tokyo', 'osaka']);
    // …but the closing leg back to the origin is explicit.
    expect(r.routes[0]!.legs.map((l) => [l.fromId, l.toId])).toEqual([
      ['tokyo', 'osaka'],
      ['osaka', 'tokyo'],
    ]);
  });
  it('named route-stop metadata is no longer dropped (rides the stop POI)', () => {
    const r = resolve(
      'map\ntag Port as p\n  Prize orange\nroute Tokyo\n  -raid-> Osaka p: Prize'
    );
    const osaka = r.pois.find((x) => x.id === 'osaka')!;
    expect(osaka.tags).toEqual({ port: 'Prize' });
  });
});

describe('resolver — basemap / extent / projection (AC13-15, AC24)', () => {
  it('world-only → no subdivisions (AC13)', () => {
    const r = resolve('map\nUnited States m: HQ\ntag M as m\n  HQ blue');
    expect(r.basemaps.subdivisions).toHaveLength(0);
  });
  it('US-only regions → albers-usa, not natural-earth (AC15/AC24)', () => {
    const r = resolve('map\nCalifornia value: 1\nOregon value: 2');
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
    const r = resolve('map\nprojection equirectangular\nCalifornia value: 1');
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
    // Latitude widens to the populated world band even though the data sits at
    // ~10°N — so every continent shows, not a thin band that crops S. Africa /
    // Argentina / N. Russia.
    expect(r.extent[0][1]).toBeLessThanOrEqual(-55);
    expect(r.extent[1][1]).toBeGreaterThanOrEqual(75);
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
    const a = resolve('map\npoi Tokyo\nCalifornia value: 5');
    const b = resolve('map\npoi Tokyo\nCalifornia value: 5');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(() => resolve('map\nA -> \npoi 999 999')).not.toThrow();
  });
});

describe('resolver — impl-review fixes (#3/#6/#8/#13/#15)', () => {
  it('POI-only US map stays geographic, NOT albers-usa, so neighbours draw (#3)', () => {
    // No us-state regions — just US POIs. albers-usa clips out all non-US land,
    // so a pure POI/route map must stay on a geographic projection; only an
    // actual US-states basemap (state region fills / `region us-states`) picks
    // albers. (Default-country US is still inferred for POI scoping — see below.)
    const r = resolve('map\npoi New York City\npoi Office');
    expect(r.projection).not.toBe('albers-usa');
  });
  it('US region + a non-US POI does NOT pick albers-usa (#13)', () => {
    const r = resolve('map\nCalifornia value: 1\npoi Tokyo');
    expect(r.projection).not.toBe('albers-usa');
  });
  it('far-flung coordinate POI also blocks albers-usa (#13)', () => {
    const r = resolve('map\nCalifornia value: 1\npoi 35.68 139.69 as t');
    expect(r.projection).not.toBe('albers-usa');
  });
  it('region matched by ISO code (#6)', () => {
    const r = resolve('map\nJP value: 5');
    expect(r.regions[0]).toMatchObject({ iso: 'JP', layer: 'country' });
  });
  it('region matched via long-form → NE-abbrev alias (#6)', () => {
    const r = resolve('map\nDemocratic Republic of the Congo value: 7');
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
      const r = resolveMap(parseMap(`map\n${name} value: 5`), data);
      expect(r.regions[0]?.iso, name).toBe('US');
    }
  });
});
