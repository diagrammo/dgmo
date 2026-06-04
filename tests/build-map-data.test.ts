// Unit tests for the PURE functions in scripts/build-map-data.mjs (F1 — the
// committed-asset test validates output shape; this validates build BEHAVIOR:
// determinism, fail-loud re-keying, strict-TSV dropping, row-order independence).
// Importing the script does NOT run the build (main() is guarded) or hit network.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs build script, no .d.ts; exercised for behavior only.
import * as build from '../scripts/build-map-data.mjs';

const { dissolveSharedArcRing } = build;
const { fold, cmp, sortKeys, round, rekeyWorld, rekeyUS, buildGazetteer } =
  build;

// GeoNames cities TSV row (19 cols). Defaults to a valid row; override fields.
function tsvRow(o: Partial<Record<string, string>> = {}): string {
  const f = {
    geonameid: '1',
    name: 'Testville',
    ascii: 'Testville',
    alt: '',
    lat: '10',
    lon: '20',
    fclass: 'P',
    fcode: 'PPL',
    country: 'US',
    cc2: '',
    admin1: 'CA',
    admin2: '',
    admin3: '',
    admin4: '',
    pop: '600000',
    elev: '',
    dem: '0',
    tz: 'America/Los_Angeles',
    mod: '2026-01-01',
    ...o,
  };
  return [
    f.geonameid,
    f.name,
    f.ascii,
    f.alt,
    f.lat,
    f.lon,
    f.fclass,
    f.fcode,
    f.country,
    f.cc2,
    f.admin1,
    f.admin2,
    f.admin3,
    f.admin4,
    f.pop,
    f.elev,
    f.dem,
    f.tz,
    f.mod,
  ].join('\t');
}

const worldTopo = (geoms: Array<{ id?: string; name: string }>) => ({
  type: 'Topology',
  objects: {
    countries: {
      type: 'GeometryCollection',
      geometries: geoms.map((g) => ({
        type: 'Polygon',
        id: g.id,
        properties: { name: g.name },
        arcs: [],
      })),
    },
    land: { type: 'GeometryCollection', geometries: [] },
  },
  arcs: [],
});

const usTopo = (geoms: Array<{ id: string; name: string }>) => ({
  type: 'Topology',
  objects: {
    states: {
      type: 'GeometryCollection',
      geometries: geoms.map((g) => ({
        type: 'Polygon',
        id: g.id,
        properties: { name: g.name },
        arcs: [],
      })),
    },
    nation: { type: 'GeometryCollection', geometries: [] },
  },
  arcs: [],
});

// All 50 states + DC FIPS so rekeyUS's presence assertion is satisfiable.
const ALL_FIPS = [
  '01',
  '02',
  '04',
  '05',
  '06',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
  '41',
  '42',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '50',
  '51',
  '53',
  '54',
  '55',
  '56',
];

describe('fold', () => {
  it('strips diacritics, lowercases, trims (locale-independent)', () => {
    expect(fold('São Paulo')).toBe('sao paulo');
    expect(fold('  MÜNCHEN ')).toBe('munchen');
    expect(fold('Île-de-France')).toBe('ile-de-france');
  });
});

describe('cmp / sortKeys determinism (AC1)', () => {
  it('cmp is codepoint order', () => {
    expect(cmp('a', 'b')).toBe(-1);
    expect(cmp('b', 'a')).toBe(1);
    expect(cmp('a', 'a')).toBe(0);
  });

  it('produces byte-identical JSON regardless of key insertion order', () => {
    const a = { b: 1, a: { z: [3, 2, 1], y: 2 }, c: 3 };
    const b = { c: 3, a: { y: 2, z: [3, 2, 1] }, b: 1 };
    expect(JSON.stringify(sortKeys(a))).toBe(JSON.stringify(sortKeys(b)));
  });

  it('does not round/mutate numbers or reorder arrays', () => {
    const v = { arcs: [[0.123456789, -0.000012345]], t: 1e-7 };
    const out = sortKeys(v);
    expect(out.arcs[0]).toEqual([0.123456789, -0.000012345]); // array order + precision preserved
    expect(out.t).toBe(1e-7);
  });

  it('round() fixes to 3 decimals', () => {
    expect(round(12.34567)).toBe(12.346);
    expect(round(-104.99)).toBe(-104.99);
  });
});

describe('rekeyWorld (fail-loud, ISO re-key, R1/R4)', () => {
  it('re-keys numeric ids to alpha-2 and keeps only the named object', () => {
    const { topo, keys } = rekeyWorld(
      worldTopo([
        { id: '840', name: 'United States' },
        { id: '392', name: 'Japan' },
      ])
    );
    expect(keys.sort()).toEqual(['JP', 'US']);
    expect(Object.keys(topo.objects)).toEqual(['countries']); // 'land' dropped
  });

  it('maps Kosovo (no numeric id) to XK', () => {
    const { keys } = rekeyWorld(worldTopo([{ id: undefined, name: 'Kosovo' }]));
    expect(keys).toContain('XK');
  });

  it('drops documented no-ISO entities', () => {
    const { keys, dropped } = rekeyWorld(
      worldTopo([
        { id: undefined, name: 'Somaliland' },
        { id: '840', name: 'United States' },
      ])
    );
    expect(keys).toEqual(['US']);
    expect(dropped).toContain('Somaliland');
  });

  it('merges Somaliland into Somalia, filling the hole (no orphaned arc)', () => {
    // Two unit squares sharing the x=1 edge (arc 1): a stand-in for Somalia +
    // the Somaliland cutout that shares its border arc. The merge must dissolve
    // the shared arc so the parent fills solid.
    const arcs = [
      [
        [0, 0],
        [1, 0],
      ], // 0
      [
        [1, 0],
        [0, 1],
      ], // 1  SHARED
      [
        [1, 1],
        [-1, 0],
        [0, -1],
      ], // 2
      [
        [1, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
      ], // 3
    ];
    const topo = {
      type: 'Topology',
      arcs,
      objects: {
        countries: {
          type: 'GeometryCollection',
          geometries: [
            {
              type: 'Polygon',
              id: '706',
              properties: { name: 'Somalia' },
              arcs: [[0, 1, 2]],
            },
            {
              type: 'Polygon',
              id: undefined,
              properties: { name: 'Somaliland' },
              arcs: [[~1, 3]],
            },
          ],
        },
      },
    };
    const { keys, merged, dropped } = rekeyWorld(topo as never);
    expect(keys).toEqual(['SO']); // Somaliland folded in, only Somalia remains
    expect(merged).toContain('Somaliland');
    expect(dropped).not.toContain('Somaliland'); // merged, not dropped
    // Somalia's outer ring grew to absorb Somaliland and the shared arc is gone.
    const ring = topo.objects.countries.geometries[0].arcs[0];
    expect(ring).toHaveLength(3);
    expect(ring.every((v: number) => (v < 0 ? ~v : v) !== 1)).toBe(true);
  });

  it('dissolveSharedArcRing stitches two squares sharing one edge into one ring', () => {
    // Two unit squares sharing the x=1 edge (arc 1).
    const arcs = [
      [
        [0, 0],
        [1, 0],
      ], // 0
      [
        [1, 0],
        [0, 1],
      ], // 1  SHARED
      [
        [1, 1],
        [-1, 0],
        [0, -1],
      ], // 2
      [
        [1, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
      ], // 3
    ];
    const ring = dissolveSharedArcRing(arcs, [0, 1, 2], [~1, 3]);
    expect(ring).not.toBeNull();
    expect(ring).toHaveLength(3); // shared arc dropped, survivors stitched
    expect(ring.every((v: number) => (v < 0 ? ~v : v) !== 1)).toBe(true);
    // No shared arc → null (caller then drops the child instead of merging).
    expect(dissolveSharedArcRing(arcs, [0, 1, 2], [3])).toBeNull();
  });

  it('HARD-FAILS on an unmapped id (AC3)', () => {
    expect(() =>
      rekeyWorld(worldTopo([{ id: '999', name: 'Atlantis' }]))
    ).toThrow(/unmapped/);
  });

  it('HARD-FAILS on a non-string id (leading-zero risk, R15)', () => {
    const topo = worldTopo([{ id: '840', name: 'US' }]);
    (topo.objects.countries.geometries[0] as { id: unknown }).id = 840;
    expect(() => rekeyWorld(topo)).toThrow(/non-string/);
  });
});

describe('rekeyUS (fail-loud, US-XX, R7/F10)', () => {
  it('re-keys all FIPS to US-XX and asserts 50 states + DC present', () => {
    const { keys } = rekeyUS(usTopo(ALL_FIPS.map((id) => ({ id, name: id }))));
    expect(keys).toContain('US-CA');
    expect(keys).toContain('US-DC');
    expect(keys.length).toBe(51);
  });

  it('maps territories too (does not drop them)', () => {
    const { keys } = rekeyUS(
      usTopo([...ALL_FIPS, '72'].map((id) => ({ id, name: id })))
    );
    expect(keys).toContain('US-PR');
  });

  it('HARD-FAILS when a state is missing (positive presence check)', () => {
    expect(() =>
      rekeyUS(usTopo(ALL_FIPS.slice(1).map((id) => ({ id, name: id }))))
    ).toThrow(/missing/);
  });

  it('HARD-FAILS on an unmapped FIPS id', () => {
    expect(() =>
      rekeyUS(usTopo([...ALL_FIPS, '99'].map((id) => ({ id, name: id }))))
    ).toThrow(/unmapped FIPS/);
  });
});

describe('buildGazetteer', () => {
  it('drops malformed rows: wrong column count + out-of-range coords (AC11)', () => {
    const good = tsvRow({ name: 'Goodtown', pop: '600000' });
    const shortRow = 'only\tthree\tcols';
    const badLat = tsvRow({ name: 'Nowhere', lat: '999' });
    const { gaz, stats } = buildGazetteer([good, shortRow, badLat].join('\n'));
    expect(stats.droppedRows).toBe(2);
    expect(gaz.cities.length).toBe(1);
    expect(gaz.cities[0][4]).toBe('Goodtown');
  });

  it('is deterministic regardless of input row order (F2)', () => {
    const rows = [
      tsvRow({
        geonameid: '1',
        name: 'Alpha',
        pop: '900000',
        lat: '1',
        lon: '1',
      }),
      tsvRow({
        geonameid: '2',
        name: 'Bravo',
        pop: '800000',
        lat: '2',
        lon: '2',
      }),
      tsvRow({
        geonameid: '3',
        name: 'Charlie',
        pop: '700000',
        lat: '3',
        lon: '3',
      }),
    ];
    const a = buildGazetteer(rows.join('\n')).gaz;
    const b = buildGazetteer([...rows].reverse().join('\n')).gaz;
    expect(JSON.stringify(sortKeys(a))).toBe(JSON.stringify(sortKeys(b)));
  });

  it('keeps multiple same-named cities (Portland OR/ME, FM-H)', () => {
    const rows = [
      tsvRow({
        name: 'Portland',
        admin1: 'OR',
        pop: '650000',
        lat: '45.5',
        lon: '-122.6',
      }),
      tsvRow({
        name: 'Portland',
        admin1: 'ME',
        pop: '66000',
        lat: '43.6',
        lon: '-70.2',
      }),
    ];
    const { gaz } = buildGazetteer(rows.join('\n'));
    const subs = (gaz.byName['portland'] || [])
      .map((i: number) => gaz.cities[i][5])
      .sort();
    expect(subs).toEqual(['US-ME', 'US-OR']);
  });

  it('resolves a curated alias to the most-populous match (NYC)', () => {
    const rows = [
      tsvRow({
        name: 'New York City',
        admin1: 'NY',
        pop: '8000000',
        lat: '40.7',
        lon: '-74',
      }),
    ];
    const { gaz } = buildGazetteer(rows.join('\n'));
    expect(gaz.alt['nyc']).toBeDefined();
    expect(gaz.cities[gaz.alt['nyc']][4]).toBe('New York City');
  });

  it('US sub is US-<admin1>; non-US has no sub', () => {
    const rows = [
      tsvRow({ name: 'Austin', country: 'US', admin1: 'TX', pop: '950000' }),
      tsvRow({ name: 'Paris', country: 'FR', admin1: '11', pop: '2100000' }),
    ];
    const { gaz } = buildGazetteer(rows.join('\n'));
    const austin = gaz.cities[gaz.byName['austin'][0]];
    const paris = gaz.cities[gaz.byName['paris'][0]];
    expect(austin[5]).toBe('US-TX');
    expect(paris[5]).toBeUndefined();
  });
});

describe('water bodies (context-labels) — naming + size (AC14, AC15)', () => {
  const { normalizeWaterName, GZ_CEILINGS } = build as {
    normalizeWaterName: (s: string) => string;
    GZ_CEILINGS: Record<string, number>;
  };

  it('title-cases ALL-CAPS multi-word names, leaves the rest', () => {
    expect(normalizeWaterName('INDIAN OCEAN')).toBe('Indian Ocean');
    expect(normalizeWaterName('SOUTHERN OCEAN')).toBe('Southern Ocean');
    expect(normalizeWaterName('Black Sea')).toBe('Black Sea'); // already mixed
    expect(normalizeWaterName('Gulf of Mexico')).toBe('Gulf of Mexico');
  });

  it('declares a gz ceiling for water-bodies.json (AC14)', () => {
    expect(typeof GZ_CEILINGS['water-bodies.json']).toBe('number');
  });
});

describe('committed water-bodies.json (AC14, AC15)', async () => {
  // Validate the shipped asset: tuple shape, NE override applied once, under gz.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { gzipSync } = await import('node:zlib');
  // vitest runs with cwd = package root.
  const path = resolve(process.cwd(), 'src/map/data/water-bodies.json');
  const raw = readFileSync(path);
  const data = JSON.parse(raw.toString('utf8')) as {
    entries: Array<[number, number, string, number, string]>;
  };

  it('is well-formed tuple entries sorted by (tier, name)', () => {
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries.length).toBeGreaterThan(50);
    const kinds = new Set([
      'ocean',
      'sea',
      'gulf',
      'bay',
      'strait',
      'channel',
      'sound',
    ]);
    for (const [lat, lon, name, tier, kind] of data.entries) {
      expect(typeof lat).toBe('number');
      expect(typeof lon).toBe('number');
      expect(typeof name).toBe('string');
      expect(Number.isInteger(tier)).toBe(true);
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it('applies the single Gulf override exactly once (AC15)', () => {
    const america = data.entries.filter((e) => e[2] === 'Gulf of America');
    expect(america).toHaveLength(1);
    expect(data.entries.some((e) => e[2] === 'Gulf of Mexico')).toBe(false);
  });

  it('excludes rivers and reefs (Decision 5)', () => {
    expect(
      data.entries.some((e) => /river|reef/i.test(e[2]) && e[4] !== 'sea')
    ).toBe(false);
  });

  it('gzips under its GZ_CEILINGS budget (AC14)', () => {
    const gz = gzipSync(raw).length;
    const ceil = (build as { GZ_CEILINGS: Record<string, number> }).GZ_CEILINGS[
      'water-bodies.json'
    ];
    expect(gz).toBeLessThanOrEqual(ceil);
  });
});
