import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap, isSubNationalUsExtent } from '../src/map/resolver';
import { featureBbox, featureBboxPrimary } from '../src/map/geo';
import { loadMapData } from '../src/map/load-data';
import type { MapData } from '../src/map/resolved-types';
import type {
  BoundaryTopology,
  Gazetteer,
  AirportData,
} from '../src/map/data/types';

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
    [43.65, -79.38, 'CA', 2_700_000, 'Toronto'], // 6 — Canadian neighbour
    [25.67, -100.32, 'MX', 1_100_000, 'Monterrey'], // 7 — Mexican neighbour
    [54.74, 55.97, 'RU', 1_100_000, 'Ufa'], // 8 — city that ALSO is IATA code UFA
  ],
  byName: {
    tokyo: [0],
    osaka: [1],
    portland: [2, 3], // ME before OR — NOT pop-ordered (R11)
    'new york city': [4],
    office: [5],
    toronto: [6],
    monterrey: [7],
    ufa: [8],
  },
  alt: { nyc: 4 },
};

// IATA-coded airports (separate optional asset, ADR-1). Three NYC-area airports
// (EWR/JFK/LGA — coincident at national scale, for the spiderfy AC), LAX, LHR,
// and UFA (collides with the gazetteer city `Ufa` → shadow-hint test).
const airports: AirportData = {
  airports: [
    [40.64, -73.78, 'US', 0, 'John F. Kennedy'], // 0 jfk
    [33.94, -118.41, 'US', 0, 'Los Angeles'], // 1 lax
    [40.69, -74.17, 'US', 0, 'Newark Liberty'], // 2 ewr
    [40.78, -73.87, 'US', 0, 'LaGuardia'], // 3 lga
    [51.47, -0.46, 'GB', 0, 'London Heathrow'], // 4 lhr
    [54.56, 55.87, 'RU', 0, 'Ufa International'], // 5 ufa
  ],
  airportIata: { jfk: 0, lax: 1, ewr: 2, lga: 3, lhr: 4, ufa: 5 },
};

const DATA: MapData = {
  worldCoarse: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'CA', name: 'Canada', box: [-141, 49, -52, 70] }, // northern neighbour
    { id: 'MX', name: 'Mexico', box: [-117, 14, -86, 33] }, // southern neighbour
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
    { id: 'GE', name: 'Georgia', box: [40, 41, 47, 44] }, // country Georgia
    { id: 'CD', name: 'Dem. Rep. Congo', box: [12, -13, 31, 5] }, // NE-abbreviated
  ]),
  worldDetail: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'CA', name: 'Canada', box: [-141, 49, -52, 70] },
    { id: 'MX', name: 'Mexico', box: [-117, 14, -86, 33] },
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
  airports,
  gazetteer,
};

const resolve = (src: string) => resolveMap(parseMap(src), DATA);

describe('resolver — regions (AC1-3, AC16, AC22)', () => {
  it('region → country (AC1)', () => {
    const r = resolve('map\ntag M as m\n  HQ blue\nUnited States m: HQ');
    expect(r.regions[0]).toMatchObject({ iso: 'US', layer: 'country' });
  });
  it('region → us-state + basemap (AC2)', () => {
    const r = resolve('map\nCalifornia heat: 92');
    expect(r.regions[0]).toMatchObject({
      iso: 'US-CA',
      layer: 'us-state',
      value: 92,
    });
    expect(r.basemaps.subdivisions).toContain('us-states');
  });
  it('region miss → did-you-mean (AC3)', () => {
    const r = resolve('map\nCaliforna heat: 1');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Unknown region/.test(d.message)
      )
    ).toBe(true);
  });
  it('duplicate region last-wins (AC16)', () => {
    const r = resolve('map\nCalifornia heat: 1\nCalifornia heat: 9');
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.value).toBe(9);
    expect(r.diagnostics.some((d) => /[Dd]uplicate/.test(d.message))).toBe(
      true
    );
  });
  it('unsupported subdivision errors (AC22)', () => {
    const r = resolve('map\nBavaria heat: 1');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Bavaria/.test(d.message)
      )
    ).toBe(true);
  });
  it('country-vs-state collision: US-scoped → state (silent), else country (AC20)', () => {
    const usScoped = resolve('map\nCalifornia heat: 1\nGeorgia heat: 2');
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
    const worldScoped = resolve('map\nGeorgia heat: 2');
    expect(worldScoped.regions[0]!.iso).toBe('GE');
  });
  it('`locale US` silences country-vs-state ambiguity', () => {
    const r = resolve('map\nlocale US\nGeorgia heat: 2');
    expect(r.regions[0]).toMatchObject({ iso: 'US-GA', layer: 'us-state' });
    expect(
      r.diagnostics.some((d) => /both a country and a US state/.test(d.message))
    ).toBe(false);
  });
  it('region scope qualifier forces state and silences ambiguity (§24B.8)', () => {
    for (const src of [
      'map\nGeorgia US heat: 2',
      'map\nGeorgia US-GA heat: 2',
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
    const r = resolve('map\nCalifornia heat: 1\nGeorgia GE heat: 2');
    expect(r.regions.find((x) => x.iso === 'GE')).toBeTruthy();
    expect(
      r.diagnostics.some((d) => /both a country and a US state/.test(d.message))
    ).toBe(false);
  });
  it('ambiguity warning teaches the non-redundant scope syntax', () => {
    const r = resolve('map\nGeorgia heat: 2');
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
    const r = resolve('map\nGeorgia US-CA heat: 2');
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
  it('a leg tag colours the LINE; label: still rides the stop POI (§24B.6)', () => {
    const r = resolve(
      'map\ntag Port as p\n  Prize orange\nroute Tokyo\n  -raid-> Osaka p: Prize, label: Hideout'
    );
    const osaka = r.pois.find((x) => x.id === 'osaka')!;
    expect(osaka.tags).toEqual({}); // the tag colours the leg LINE, not the stop
    expect(osaka.label).toBe('Hideout'); // label: still names the destination
    expect(r.routes[0]!.legs[0]!.tags).toEqual({ port: 'Prize' }); // rides the line
  });
});

describe('resolver — POI referenced by label (route/edge reuse)', () => {
  it('a route leg binds to a coord POI by its label', () => {
    const r = resolve(
      'map\npoi 50 30 label: Kyiv Hub\npoi 55 37 label: Moscow Refinery\nroute Kyiv Hub\n  ~> Moscow Refinery'
    );
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(r.routes[0]!.legs).toHaveLength(1);
    const kyiv = r.pois.find((p) => p.label === 'Kyiv Hub')!;
    const moscow = r.pois.find((p) => p.label === 'Moscow Refinery')!;
    const [leg] = r.routes[0]!.legs;
    expect(leg!.fromId).toBe(kyiv.id);
    expect(leg!.toId).toBe(moscow.id);
    expect(r.pois).toHaveLength(2); // no duplicate implicit POI spawned
  });
  it('an edge binds to a coord POI by its label', () => {
    const r = resolve(
      'map\npoi 50 30 label: A Site\npoi 55 37 label: B Site\nA Site -> B Site'
    );
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const a = r.pois.find((p) => p.label === 'A Site')!;
    const b = r.pois.find((p) => p.label === 'B Site')!;
    expect(r.edges[0]).toMatchObject({ fromId: a.id, toId: b.id });
    expect(r.pois).toHaveLength(2);
  });
  it('a label shared by two POIs errors as ambiguous (asks for an alias)', () => {
    const r = resolve(
      'map\npoi 50 30 label: Depot\npoi 55 37 label: Depot\nroute 10 10\n  ~> Depot'
    );
    const errs = r.diagnostics.filter(
      (d) => d.code === 'E_MAP_AMBIGUOUS_LABEL'
    );
    expect(errs).toHaveLength(1);
    expect(r.routes[0]!.legs).toHaveLength(0); // ambiguous leg dropped
  });
  it('id/name/alias still win over a colliding label (precedence)', () => {
    // `Tokyo` is a gazetteer name AND another POI carries the label "Tokyo".
    // A reference to `Tokyo` must bind the NAME POI, not the labeled coord POI.
    const r = resolve(
      'map\npoi Tokyo\npoi 50 30 label: Tokyo\nroute Tokyo\n  ~> Osaka'
    );
    expect(r.routes[0]!.stopIds[0]).toBe('tokyo');
  });
});

describe('resolver — airport IATA codes (map-airport-iata-codes)', () => {
  it('poi JFK resolves to the airport; POI label = typed token (AC1)', () => {
    const r = resolve('map\npoi JFK');
    const jfk = r.pois.find((p) => p.id === 'jfk')!;
    expect(jfk).toBeDefined();
    expect(jfk.name).toBe('JFK'); // typed token → renders "JFK" (no label work)
    expect([jfk.lat, jfk.lon]).toEqual([40.64, -73.78]);
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('route JFK -> LAX resolves both endpoints to airports + US projection (AC1/AC2)', () => {
    const r = resolve('map\nroute JFK\n  -> LAX');
    expect(r.routes[0]!.stopIds).toEqual(['jfk', 'lax']);
    const jfk = r.pois.find((p) => p.id === 'jfk')!;
    const lax = r.pois.find((p) => p.id === 'lax')!;
    expect(jfk.name).toBe('JFK');
    expect(lax.name).toBe('LAX');
    expect([lax.lat, lax.lon]).toEqual([33.94, -118.41]);
    // US-airport iso is honored for projection inference (G2 — not dropped).
    expect(r.projection).toBe('albers-usa');
  });

  it('case-insensitive: jfk / Jfk / JFK all resolve (ADR-3)', () => {
    for (const tok of ['jfk', 'Jfk', 'JFK']) {
      const r = resolve(`map\npoi ${tok}`);
      expect(r.pois.find((p) => p.id === 'jfk')).toBeDefined();
    }
  });

  it('exact IATA hit never enters the ambiguity defer branch (#10)', () => {
    // An airport code resolves directly in pass A — no W_MAP_AMBIGUOUS_NAME, and
    // the POI is placed (a deferred POI that never resolves would be absent).
    const r = resolve('map\npoi JFK');
    expect(r.pois.find((p) => p.id === 'jfk')).toBeDefined();
    expect(r.diagnostics.some((d) => d.code === 'W_MAP_AMBIGUOUS_NAME')).toBe(
      false
    );
  });

  it('city wins a shared token + shadow hint (AC4, ADR-2)', () => {
    // `Ufa` is both a gazetteer city (RU) and IATA code UFA. The CITY wins…
    const r = resolve('map\npoi Ufa');
    const ufa = r.pois.find((p) => p.id === 'ufa')!;
    expect([ufa.lat, ufa.lon]).toEqual([54.74, 55.97]); // city coords, not airport
    // …and a non-blocking shadow hint names the airport escape hatch.
    const hint = r.diagnostics.find(
      (d) => d.code === 'W_MAP_AIRPORT_SHADOWED_BY_CITY'
    );
    expect(hint).toBeDefined();
    expect(hint!.severity).toBe('warning');
  });

  it('unknown 3-letter code → E_MAP_UNKNOWN_AIRPORT_CODE (AC5)', () => {
    const r = resolve('map\npoi ZZZ');
    const e = r.diagnostics.find(
      (d) => d.code === 'E_MAP_UNKNOWN_AIRPORT_CODE'
    );
    expect(e).toBeDefined();
    expect(e!.message).toMatch(/as ZZZ/); // suggests the coords escape hatch
    expect(r.pois.find((p) => p.id === 'zzz')).toBeUndefined();
  });

  it('same-metro route resolves 3 distinct near-coincident airports (AC6)', () => {
    const r = resolve('map\nroute EWR\n  -> JFK\n  -> LGA');
    expect(r.routes[0]!.stopIds).toEqual(['ewr', 'jfk', 'lga']);
    const names = r.pois
      .filter((p) => ['ewr', 'jfk', 'lga'].includes(p.id))
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(['EWR', 'JFK', 'LGA']);
  });
});

describe('resolver — surface removed (AC9)', () => {
  it('`surface:` is unrecognized — it folds into the endpoint name and errors', () => {
    // `surface: water` is no longer split off as metadata, so `Osaka surface:
    // water` becomes the destination NAME, which fails to resolve (AC9 — surface
    // errors as unknown rather than silently bowing the leg).
    const r = resolve('map\nTokyo -> Osaka surface: water');
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
  it('a plain route (no surface) resolves with straight legs', () => {
    const r = resolve('map\nroute Tokyo\n  -> Osaka\n  -> Tokyo');
    expect(r.routes[0]!.legs.every((l) => l.style === 'straight')).toBe(true);
  });
});

describe('resolver — basemap / extent / projection (AC13-15, AC24)', () => {
  it('world-only → no subdivisions (AC13)', () => {
    const r = resolve('map\nUnited States m: HQ\ntag M as m\n  HQ blue');
    expect(r.basemaps.subdivisions).toHaveLength(0);
  });
  it('US regions with `locale US` → albers-usa national frame (AC15/AC24)', () => {
    // `locale US` (no subdivision) forces the whole-country frame even on compact
    // data (map-us-subnational-zoom escape hatch). Without it, a compact US
    // region map now auto-zooms to conic-equal-area — covered by the real-data
    // sub-national-zoom suite below (the hand-built rect topo's geoBounds returns
    // a whole-sphere bbox, so it can't exercise the area-fraction gate faithfully).
    const r = resolve('map\nlocale US\nCalifornia heat: 1\nOregon heat: 2');
    expect(r.projection).toBe('albers-usa');
    expect(r.basemaps.subdivisions).toContain('us-states');
  });
  it('dataless world span → equirectangular (AC5)', () => {
    const r = resolve('map\npoi Tokyo\npoi 40 -74 as ny');
    expect(r.projection).toBe('equirectangular');
  });
  it('data world span → equirectangular (consistent rectangular frame, AC5)', () => {
    // A choropleth spanning the globe (US + China, beyond North America so not
    // US-oriented) is a DATA map — but world maps now use equirectangular too,
    // for one consistent rectangular look across data + reference maps.
    const r = resolve(
      'map\nregion-heat Sales\nUnited States heat: 5\nChina heat: 3'
    );
    expect(r.projection).toBe('equirectangular');
  });
  it('tight cluster → conic-equal-area (AC15)', () => {
    // Non-US coords (London) so the cluster isn't pulled to the national
    // albers-usa frame (US content is US-oriented — §24B.2). Non-US regional
    // frames use a per-extent conic equal-area (Albers), not Mercator.
    const r = resolve('map\npoi 51.50 -0.12 as a\npoi 51.51 -0.13 as b');
    expect(r.projection).toBe('conic-equal-area');
  });
  it('single-continent regional span → conic-equal-area, not equirectangular (familiar shapes)', () => {
    // A ~40°-span mid-latitude continental frame (think Europe) reads with its
    // conventional shape under a conic equal-area; equirectangular squashes it
    // and Mercator inflates high-latitude land (pushing the data low).
    const r = resolve('map\npoi 35 -10 as sw\npoi 60 30 as ne');
    expect(r.projection).toBe('conic-equal-area');
  });
  it('polar-reaching wide frame (dataless) → equirectangular (Mercator area blow-up guard)', () => {
    // Sub-world longitude span but the frame reaches past ~80° latitude — Mercator
    // would grossly inflate the high-latitude land, so fall back to a world
    // projection. Dataless → equirectangular.
    const r = resolve('map\npoi 84 -40 as a\npoi 60 40 as b');
    expect(r.projection).toBe('equirectangular');
  });
  it('equirectangular for all world maps (data + dataless), not US/cluster', () => {
    const cases: Array<[string, string]> = [
      ['map\npoi Tokyo\npoi 40 -74 as ny', 'equirectangular'], // dataless world
      [
        'map\nregion-heat Sales\nUnited States heat: 5\nChina heat: 3',
        'equirectangular',
      ], // data world
      ['map\nlocale US\nCalifornia heat: 1\nOregon heat: 2', 'albers-usa'], // US national (locale-forced)
      ['map\npoi 51.50 -0.12 as a\npoi 51.51 -0.13 as b', 'conic-equal-area'], // tight cluster (non-US)
    ];
    for (const [src, expected] of cases) {
      expect(resolve(src).projection).toBe(expected);
    }
  });
  it('world-scale frame snaps to full Greenwich longitude, not an antimeridian wrap (no US split)', () => {
    // POIs spanning the globe (Americas + Europe + Asia). The world-scale frame
    // must be the conventional full [-180, 180] Greenwich rectangle — NOT a
    // wrapped window (east > 180) that splits the Americas at the seam. Dataless
    // POIs → equirectangular.
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
    expect(r.projection).toBe('conic-equal-area'); // tight non-US → conic, not natural-earth
  });
});

describe('resolver — POI-only fit-to-cluster zoom floor (#poi-fit)', () => {
  const longerAxis = (r: ReturnType<typeof resolve>) =>
    Math.max(r.extent[1][0] - r.extent[0][0], r.extent[1][1] - r.extent[0][1]);

  it('tight US POI cluster zooms to the floor + goes mercator (not the national frame)', () => {
    // A Bay-Area-like cluster (~0.3° span). Without the floor this snaps to the
    // albers-usa national frame; with it, the frame is a multi-state window and
    // the projection is regional mercator. locale US makes it US-oriented.
    const r = resolve(
      'map\nlocale US\npoi 37.77 -122.42 as sf\npoi 37.80 -122.27 as oak\npoi 37.34 -121.89 as sj'
    );
    expect(r.projection).toBe('mercator');
    expect(longerAxis(r)).toBeCloseTo(7, 5); // floored to POI_ZOOM_FLOOR_DEG
    // centred on the POI centroid (~37.6°N, −122.2°W)
    const cx = (r.extent[0][0] + r.extent[1][0]) / 2;
    const cy = (r.extent[0][1] + r.extent[1][1]) / 2;
    expect(cx).toBeCloseTo(-122.2, 0);
    expect(cy).toBeCloseTo(37.6, 0);
    // us-states mesh still drawn so the home state + neighbours frame the dots
    expect(r.basemaps.subdivisions).toContain('us-states');
  });

  it('floor is a no-op for a cluster already wider than the floor', () => {
    // CA + CO POIs span ~22° lon — wider than the floor, narrower than national.
    const r = resolve(
      'map\nlocale US\npoi 37.77 -122.42 as sf\npoi 39.74 -104.99 as den'
    );
    expect(r.projection).toBe('mercator');
    expect(longerAxis(r)).toBeGreaterThan(7); // untouched by the floor
    expect(r.extent[0][0]).toBeLessThan(-122.42); // still bounds the POIs + pad
    expect(r.extent[1][0]).toBeGreaterThan(-104.99);
  });

  it('national-span US POIs stay on the albers-usa composite', () => {
    // SF + NYC + Miami span ≳ 48° lon → genuinely national → national frame.
    const r = resolve(
      'map\nlocale US\npoi 37.77 -122.42 as sf\npoi 40.71 -74.0 as ny\npoi 25.76 -80.19 as mia'
    );
    expect(r.projection).toBe('albers-usa');
    expect(longerAxis(r)).toBeGreaterThan(7); // not floored
  });

  it('national-region map (locale US) stays albers-usa', () => {
    // The zoom floor now ALSO extends to sub-national US region maps
    // (map-us-subnational-zoom), but a `locale US`-forced national frame keeps
    // albers-usa regardless — the floor only mutates the (irrelevant) extent.
    const r = resolve('map\nlocale US\nCalifornia heat: 1\nOregon heat: 2');
    expect(r.projection).toBe('albers-usa');
  });

  it('floor applies to non-US POI-only clusters too (no zoom into emptiness)', () => {
    // London pair (~0.01° span): conic equal-area (non-US), and the floor still
    // expands the extent so the dots aren’t framed on a near-empty box.
    const r = resolve('map\npoi 51.50 -0.12 as a\npoi 51.51 -0.13 as b');
    expect(r.projection).toBe('conic-equal-area');
    expect(longerAxis(r)).toBeCloseTo(7, 5);
  });

  it('single POI floors to a centred window without NaN', () => {
    const r = resolve('map\nlocale US\npoi 37.6 -122.1 as a');
    expect(r.projection).toBe('mercator');
    expect(longerAxis(r)).toBeCloseTo(7, 5);
    const cx = (r.extent[0][0] + r.extent[1][0]) / 2;
    const cy = (r.extent[0][1] + r.extent[1][1]) / 2;
    expect(cx).toBeCloseTo(-122.1, 5);
    expect(cy).toBeCloseTo(37.6, 5);
  });
});

describe('isSubNationalUsExtent — pure area-fraction gate (map-us-subnational-zoom, AC11)', () => {
  // Pure helper: area-fraction of CONUS (≈1416 deg²), threshold f = 0.4 (so the
  // threshold area is ≈566 deg²). Synthetic bboxes — lon/lat positions are
  // irrelevant, only the rectangular area matters.
  it('null bbox → false (no data / reference-only)', () => {
    expect(isSubNationalUsExtent(null)).toBe(false);
  });
  it('compact NE-sized bbox → true', () => {
    expect(
      isSubNationalUsExtent([
        [-80, 38],
        [-67, 47],
      ])
    ).toBe(true); // 13×9 = 117 deg² → 0.08 of CONUS
  });
  it('coast-to-coast (all-50) bbox → false', () => {
    expect(
      isSubNationalUsExtent([
        [-124, 25],
        [-66, 49],
      ])
    ).toBe(false); // ≈58×24 → ~0.98 of CONUS
  });
  it('WA+FL near-national diagonal → false (area guard, not lon-span)', () => {
    expect(
      isSubNationalUsExtent([
        [-124, 25],
        [-80, 49],
      ])
    ).toBe(false); // 44×24 = 1056 → 0.75 of CONUS
  });
  it('boundary determinism: just-under f → true, just-over f → false (AC6)', () => {
    // threshold area = 0.4 × 1416 = 566.4 deg²
    expect(
      isSubNationalUsExtent([
        [0, 0],
        [20, 28],
      ])
    ).toBe(true); // 560 deg² → 0.395 < 0.4
    expect(
      isSubNationalUsExtent([
        [0, 0],
        [20, 29],
      ])
    ).toBe(false); // 580 deg² → 0.41 > 0.4
  });
  it('no side effects — same input, same output (purity, AC11)', () => {
    const bbox: [[number, number], [number, number]] = [
      [-80, 38],
      [-67, 47],
    ];
    expect(isSubNationalUsExtent(bbox)).toBe(isSubNationalUsExtent(bbox));
  });
});

describe('resolver — sub-national US auto-zoom, real geometry (map-us-subnational-zoom)', () => {
  // The hand-built rect-topo mock above can't produce faithful state/country
  // bboxes (its geoBounds returns a whole-sphere box), so the area-fraction gate
  // is exercised here against the SHIPPED geometry.
  const NE8 =
    'New York heat: 196\nMassachusetts heat: 70\nConnecticut heat: 36\nVermont heat: 6\nNew Hampshire heat: 14\nMaine heat: 13\nPennsylvania heat: 128\nNew Jersey heat: 93';

  it('AC1: compact Northeast choropleth → mercator (North-up) + us-states mesh', async () => {
    // Sub-national US zoom uses Mercator (straight vertical meridians = North-up);
    // a conic would fan its meridians and visibly tilt the region. Non-US regional
    // views still use conic-equal-area (see the AC10 case below).
    const data = await loadMapData();
    const r = resolveMap(parseMap(`map Northeast\n${NE8}`), data);
    expect(r.projection).toBe('mercator');
    expect(r.basemaps.subdivisions).toContain('us-states');
    // Fit extent is the compact region, NOT the whole CONUS (~58° lon).
    expect(r.extent[1][0] - r.extent[0][0]).toBeLessThan(30);
  });

  it('AC2: coast-to-coast spread → albers-usa national frame', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap(
        'map\nCalifornia heat: 1\nMaine heat: 2\nFlorida heat: 3\nWashington heat: 4\nTexas heat: 5'
      ),
      data
    );
    expect(r.projection).toBe('albers-usa');
  });

  it('AC2: WA+FL near-national diagonal stays albers-usa (area guard)', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap('map\nWashington heat: 1\nFlorida heat: 2'),
      data
    );
    expect(r.projection).toBe('albers-usa');
  });

  it('AC3: a Hawaii-only choropleth stays albers-usa (ISO guard, not bbox)', async () => {
    const data = await loadMapData();
    const r = resolveMap(parseMap('map\nHawaii heat: 5'), data);
    expect(r.projection).toBe('albers-usa');
  });

  it('AC3: Alaska in the data forces albers-usa even alongside a compact state', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap('map\nAlaska heat: 5\nCalifornia heat: 3'),
      data
    );
    expect(r.projection).toBe('albers-usa');
  });

  it('AC4: `locale US` forces the national frame on compact data', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap('map\nlocale US\nNew York heat: 1\nMassachusetts heat: 2'),
      data
    );
    expect(r.projection).toBe('albers-usa');
  });

  it('AC5: `locale US` with zero data regions → albers-usa national reference map', async () => {
    const data = await loadMapData();
    const r = resolveMap(parseMap('map\nlocale US'), data);
    expect(r.projection).toBe('albers-usa');
  });

  it('R6: a single tiny state floors to ~7° and stays mercator', async () => {
    const data = await loadMapData();
    const r = resolveMap(parseMap('map\nRhode Island heat: 5'), data);
    expect(r.projection).toBe('mercator');
    const longer = Math.max(
      r.extent[1][0] - r.extent[0][0],
      r.extent[1][1] - r.extent[0][1]
    );
    expect(longer).toBeGreaterThanOrEqual(7 - 1e-6);
  });

  it('AC7: compact regions + a near POI → mercator, pin inside the frame', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap(
        'map\nNew York heat: 1\nMassachusetts heat: 2\npoi 42.36 -71.06 as bos'
      ),
      data
    );
    expect(r.projection).toBe('mercator');
    const bos = r.pois.find((p) => p.id === 'bos')!;
    expect(bos.lon).toBeGreaterThanOrEqual(r.extent[0][0]);
    expect(bos.lon).toBeLessThanOrEqual(r.extent[1][0]);
  });

  it('AC7: compact regions + a far cross-country POI → albers-usa', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap(`map\n${NE8}\npoi 34.05 -118.24 as la`),
      data
    );
    expect(r.projection).toBe('albers-usa');
  });

  it('AC10: a compact NON-US region is unaffected — tight frame, no US zoom floor', async () => {
    // `isSubNationalUsExtent` is a pure area-vs-CONUS ratio (true for any small
    // bbox), so the zoom floor must be gated on `usOriented` or a tiny European
    // country would get the 7° US floor. A small-country choropleth stays tight.
    const data = await loadMapData();
    const r = resolveMap(parseMap('map\nNetherlands heat: 5'), data);
    const longer = Math.max(
      r.extent[1][0] - r.extent[0][0],
      r.extent[1][1] - r.extent[0][1]
    );
    expect(r.projection).toBe('conic-equal-area');
    expect(longer).toBeLessThan(7); // NOT floored to the US POI/region floor
  });
});

const WORLD_SPAN_DEG = 90;

describe('featureBboxPrimary — drop far-detached territories from framing (R5)', () => {
  // Real committed geometry (hand-built rect rings confuse geoBounds' winding —
  // see the world-scale test above — so assert on the shipped data).
  it('France: full bbox reaches the overseas territories; primary frames on the mainland', async () => {
    const data = await loadMapData();
    const full = featureBbox(data.worldCoarse, 'FR')!;
    const primary = featureBboxPrimary(data.worldCoarse, 'FR')!;
    // Full bbox is dragged across the Atlantic by French Guiana / Caribbean DOM.
    expect(full[0][0]).toBeLessThan(-50);
    // Primary stays on metropolitan France (west of Brittany ≈ −5°, not −58°).
    expect(primary[0][0]).toBeGreaterThan(-15);
    expect(primary[0][0]).toBeGreaterThan(full[0][0]);
  });
  it('single-part features are unchanged (falls back to full bbox)', async () => {
    const data = await loadMapData();
    expect(featureBboxPrimary(data.worldCoarse, 'DE')).toEqual(
      featureBbox(data.worldCoarse, 'DE')
    );
  });
  it('a Europe choropleth naming France frames on Europe, not the Atlantic', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap(
        'map\nregion-heat V\nFrance heat: 1\nGermany heat: 2\nSpain heat: 3'
      ),
      data
    );
    // Pre-fix the west edge sat near −58° (French Guiana); now it stays on the
    // Atlantic-European margin and the span is sub-continental, not world-scale.
    expect(r.extent[0][0]).toBeGreaterThan(-20);
    expect(r.extent[1][0] - r.extent[0][0]).toBeLessThan(WORLD_SPAN_DEG);
  });
});

describe('POI-only region framing — real geometry (#poi-region)', () => {
  // Reverse-geocode POIs to their containing region, then frame to that region's
  // bbox. Requires shipped geometry — hand-built rect rings confuse geoBounds'
  // winding (every featureBbox returns the whole sphere), so assert on real data.
  it('a Bay-Area POI cluster frames the whole of California (not a tiny window)', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap(
        'map\npoi 37.77 -122.42 as sf\npoi 37.80 -122.27 as oak\npoi 37.34 -121.89 as sj'
      ),
      data
    );
    // California spans ≈ −124.4°…−114.1° lon, 32.5°…42° lat. The frame must be the
    // whole state (+pad), far wider than the ~0.5° POI cluster.
    expect(r.poiFrameContainers).toContain('US-CA');
    expect(r.extent[0][0]).toBeLessThan(-123); // reaches the Pacific coast
    expect(r.extent[1][0]).toBeGreaterThan(-115); // reaches the Nevada border
    expect(r.extent[0][1]).toBeLessThan(34); // reaches SoCal / the south
    expect(r.extent[1][1]).toBeGreaterThan(41); // reaches the Oregon border
    expect(r.projection).toBe('mercator');
  });

  it('a POI at the edge of a tall country crops the empty interior (overshoot clamp)', async () => {
    const data = await loadMapData();
    // A Caribbean route: the southernmost dot (Cartagena, ≈10.4°N) sits at the
    // NORTH tip of Colombia, whose bbox runs to ≈−4°S in the Amazon. Without the
    // clamp the frame would chase Colombia's far edge ~15° below the dots. The
    // clamp caps the southern reveal at CONTAINER_OVERSHOOT_DEG (8°) below the
    // cluster, so the frame stays north of the equator — northern Colombia for
    // context, no empty Amazon.
    const r = resolveMap(
      parseMap(
        'map\npoi 25.79 -80.19 as miami\npoi 23.11 -82.36 as havana\npoi 17.97 -76.79 as kingston\npoi 18.47 -69.89 as santo-domingo\npoi 10.39 -75.51 as cartagena'
      ),
      data
    );
    expect(r.poiFrameContainers).toContain('CO'); // Cartagena → Colombia
    // Southernmost POI is 10.39°N; the frame must not dive more than ~8° below it.
    expect(r.extent[0][1]).toBeGreaterThan(0); // stays north of the equator
    expect(r.extent[0][1]).toBeLessThan(10.39); // but still reveals land south of the dots
  });

  it('records the containing country for a non-US cluster', async () => {
    const data = await loadMapData();
    // Two French cities (Paris, Lyon) → framed to France, container recorded.
    const r = resolveMap(
      parseMap('map\npoi 48.85 2.35 as paris\npoi 45.76 4.83 as lyon'),
      data
    );
    expect(r.poiFrameContainers).toContain('FR');
  });

  it('a LARGE non-US cluster in a huge container frames tight (overshoot decay)', async () => {
    const data = await loadMapData();
    // A Ukraine→Russia strike cluster (≈14° lon) sits inside Russia's enormous
    // bbox. The per-cluster overshoot decays for big clusters, so the frame must
    // hug the dots (≤~6° of empty container beyond the northernmost POI), not the
    // old fixed-8° band (which left ~9° of dead space below the title).
    const r = resolveMap(
      parseMap(
        'map\npoi 50.91 34.80 as src\npoi 55.63 37.79 as msk\npoi 46.35 48.04 as astr\npoi 51.53 46.03 as sar'
      ),
      data
    );
    const northMargin = r.extent[1][1] - 55.63; // frame north edge − northernmost POI
    expect(northMargin).toBeGreaterThan(0); // still shows context above the dots
    expect(northMargin).toBeLessThan(6); // but not the old ~9° empty band
  });

  it('a Canadian neighbour POI on a US map frames by its point, not all of Canada (§24B.2)', async () => {
    const data = await loadMapData();
    // US cities coast-to-coast + a Toronto POI. Toronto reverse-geocodes to country
    // Canada, whose bbox runs to ~83°N — but on a US-oriented map a neighbour POI
    // must expand the frame by just its POINT (43.6°N), never drag it up into the
    // Arctic. Without the fix the north edge balloons past 55°N.
    const r = resolveMap(
      parseMap(
        'map\npoi 47.61 -122.33 as seattle\npoi 25.78 -80.22 as miami\npoi 42.36 -71.06 as boston\npoi 43.64 -79.39 as toronto'
      ),
      data
    );
    // Container is still recorded (for labelling), but its bbox is not framed.
    expect(r.poiFrameContainers).toContain('CA');
    // North edge stays near the northernmost POI (Seattle ~47.6, Toronto ~43.6) +
    // its containing US states' tops (~49) + pad — comfortably south of 53°N, not
    // chasing Canada's ~83°N bbox.
    expect(r.extent[1][1]).toBeLessThan(53);
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
    const a = resolve('map\npoi Tokyo\nCalifornia heat: 5');
    const b = resolve('map\npoi Tokyo\nCalifornia heat: 5');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(() => resolve('map\nA -> \npoi 999 999')).not.toThrow();
  });
});

describe('resolver — impl-review fixes (#3/#6/#8/#13/#15)', () => {
  it('national-span POI-only US map IS US-oriented → albers-usa + full state mesh (§24B.2)', () => {
    // No us-state regions — just US cities spanning the nation (NYC + SF). A
    // POI map whose content actually spans the country renders as the national
    // US states map (every state outlined). A *local* cluster instead fit-zooms
    // to a regional mercator frame — see the "fit-to-cluster zoom floor" suite.
    const r = resolve(
      'map\nlocale US\npoi 40.71 -74.0 as ny\npoi 37.77 -122.42 as sf'
    );
    expect(r.projection).toBe('albers-usa');
    expect(r.basemaps.subdivisions).toContain('us-states');
  });
  it('`locale US` alone makes a map US-oriented (albers-usa)', () => {
    const r = resolve('map\nlocale US\npoi Chicago');
    expect(r.projection).toBe('albers-usa');
    expect(r.basemaps.subdivisions).toContain('us-states');
  });
  it('US region + a non-US POI does NOT pick albers-usa (#13)', () => {
    const r = resolve('map\nCalifornia heat: 1\npoi Tokyo');
    expect(r.projection).not.toBe('albers-usa');
  });
  it('far-flung coordinate POI also blocks albers-usa (#13)', () => {
    const r = resolve('map\nCalifornia heat: 1\npoi 35.68 139.69 as t');
    expect(r.projection).not.toBe('albers-usa');
  });

  // ── North-American-neighbour relaxation (map-us-orientation-north-america) ──
  it('AC1: US states + a Canadian city POI → albers-usa + us-states', () => {
    const r = resolve('map\nCalifornia heat: 1\npoi Toronto');
    expect(r.projection).toBe('albers-usa');
    expect(r.basemaps.subdivisions).toContain('us-states');
  });
  it('AC3: US states + a Mexican city POI → albers-usa', () => {
    const r = resolve('map\nCalifornia heat: 1\npoi Monterrey');
    expect(r.projection).toBe('albers-usa');
  });
  it('AC3: US state fill + a Mexico country fill → albers-usa', () => {
    // `locale US` pins the national frame (the rect-topo mock can't produce a
    // faithful MX bbox for the area gate); the point here is that a Mexico country
    // fill keeps the map US-oriented rather than flipping it to a world projection.
    const r = resolve('map\nlocale US\nCalifornia heat: 1\nMexico heat: 2');
    expect(r.projection).toBe('albers-usa');
  });
  it('AC4: US POIs + a non-NA POI (Tokyo) → NOT albers-usa, and NO state mesh (global map)', () => {
    // A US POI on an otherwise-global map (e.g. a worldwide backbone) must NOT
    // explode the US into 50 states — the map spans beyond NA, so country-only
    // reads as signal, not noise. States only draw when US states are referenced
    // as data, or the whole map stays within North America (usOriented).
    const r = resolve('map\npoi New York City\npoi Tokyo');
    expect(r.projection).not.toBe('albers-usa');
    expect(r.basemaps.subdivisions).toHaveLength(0);
  });
  it('AC4b: US state DATA + a non-NA POI → states still draw (states are the subject)', () => {
    // Contrast with AC4: here the US state is referenced as data, so the mesh
    // stays even on a global projection.
    const r = resolve('map\nCalifornia heat: 5\npoi Tokyo');
    expect(r.projection).not.toBe('albers-usa');
    expect(r.basemaps.subdivisions).toContain('us-states');
  });
  it('AC5: US state fill + a non-NA country fill (Japan) → NOT albers-usa', () => {
    const r = resolve('map\nCalifornia heat: 1\nJP heat: 2');
    expect(r.projection).not.toBe('albers-usa');
  });
  it('AC6: US state fill + a bare coord POI inside Canada (Vancouver) → albers-usa', () => {
    const r = resolve('map\nCalifornia heat: 1\npoi 49 -123 as van');
    expect(r.projection).toBe('albers-usa');
  });
  it('AC6: US state fill + a bare coord POI outside NA (Tokyo) → NOT albers-usa', () => {
    const r = resolve('map\nCalifornia heat: 1\npoi 35 139 as tk');
    expect(r.projection).not.toBe('albers-usa');
  });
  it('AC10: a `United States` country fill alone is NOT US-oriented (no state mesh)', () => {
    const r = resolve('map\nUnited States heat: 1');
    expect(r.projection).not.toBe('albers-usa');
    expect(r.basemaps.subdivisions).toHaveLength(0);
  });
  it('region matched by ISO code (#6)', () => {
    const r = resolve('map\nJP heat: 5');
    expect(r.regions[0]).toMatchObject({ iso: 'JP', layer: 'country' });
  });
  it('region matched via long-form → NE-abbrev alias (#6)', () => {
    const r = resolve('map\nDemocratic Republic of the Congo heat: 7');
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

describe('resolver — POI-only cluster in an antimeridian-crossing container, real geometry (map-poi-only-antimeridian)', () => {
  // A western-Russia drone-strike cluster (lon ~34–48°E). Russia's container
  // bbox crosses the antimeridian (Chukotka reaches the seam), which used to
  // bypass the longitude clamp entirely and blow the frame out to a world view
  // (equirectangular). The per-side clamp now reins the wrapped east back to
  // cluster ± overshoot, so the map stays a tight regional conic.
  const RU_CLUSTER =
    'map\npoi 55.63 37.79 as msk\npoi 53.24 34.36 as bryansk\npoi 51.53 46.03 as saratov\npoi 46.35 48.04 as astrakhan';

  it('frames to the cluster (regional conic), not the whole globe', async () => {
    const data = await loadMapData();
    const r = resolveMap(parseMap(RU_CLUSTER), data);
    expect(r.projection).toBe('conic-equal-area'); // was equirectangular (world)
    const lonSpan = r.extent[1][0] - r.extent[0][0];
    const latSpan = r.extent[1][1] - r.extent[0][1];
    expect(lonSpan).toBeLessThan(40); // NOT Russia's ~170° width
    expect(Math.max(lonSpan, latSpan)).toBeLessThan(90); // < WORLD_SPAN
    // centred over the cluster (~34–48°E), well east of Greenwich — proves the
    // frame followed the dots, not Russia's antimeridian-spanning bbox.
    const cx = (r.extent[0][0] + r.extent[1][0]) / 2;
    expect(cx).toBeGreaterThan(25);
    expect(cx).toBeLessThan(55);
  });

  it('an eastern-Russia cluster (Vladivostok) also stays regional, not world', async () => {
    const data = await loadMapData();
    const r = resolveMap(
      parseMap('map\npoi 43.12 131.89 as vvo\npoi 48.48 135.07 as khv'),
      data
    );
    expect(r.projection).not.toBe('equirectangular');
    expect(r.extent[1][0] - r.extent[0][0]).toBeLessThan(40);
    const cx = (r.extent[0][0] + r.extent[1][0]) / 2;
    expect(cx).toBeGreaterThan(120); // framed in the Far East, not Greenwich-centred
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
      const r = resolveMap(parseMap(`map\n${name} heat: 5`), data);
      expect(r.regions[0]?.iso, name).toBe('US');
    }
  });
});
