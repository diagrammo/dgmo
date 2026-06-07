import { describe, it, expect } from 'vitest';
import { completeMapPlaces, completeMapRegions } from '../src/map/completion';
import { loadMapData } from '../src/map/load-data';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type {
  Gazetteer,
  RegionName,
  RegionNames,
  AirportData,
} from '../src/map/data/types';

// Hand-built gazetteer: Tokyo/Osaka, two Portlands (ambiguous, with `sub`),
// an NYC alias, and an accented city.
const gz: Gazetteer = {
  cities: [
    [35.68, 139.69, 'JP', 9_000_000, 'Tokyo'], // 0
    [34.69, 135.5, 'JP', 2_700_000, 'Osaka'], // 1
    [43.66, -70.25, 'US', 66_881, 'Portland', 'US-ME'], // 2 (lower pop)
    [45.52, -122.68, 'US', 652_503, 'Portland', 'US-OR'], // 3 (higher pop)
    [40.71, -74.0, 'US', 8_800_000, 'New York City', 'US-NY'], // 4
    [-23.55, -46.63, 'BR', 12_300_000, 'São Paulo', 'BR-SP'], // 5
    [37.77, -122.42, 'US', 873_965, 'San Francisco', 'US-CA'], // 6
    [29.42, -98.49, 'US', 1_500_000, 'San Antonio', 'US-TX'], // 7
  ],
  byName: {
    tokyo: [0],
    osaka: [1],
    portland: [2, 3],
    'new york city': [4],
    'sao paulo': [5],
    'san francisco': [6],
    'san antonio': [7],
  },
  alt: { nyc: 4 },
};

describe('completeMapPlaces (step 6)', () => {
  it('prefix match; empty query → [] (AC1)', () => {
    expect(completeMapPlaces('tok', gz).map((c) => c.name)).toContain('Tokyo');
    expect(completeMapPlaces('', gz)).toEqual([]);
    expect(completeMapPlaces('   ', gz)).toEqual([]);
  });

  it('population-descending, stable tie-break (AC2)', () => {
    const r = completeMapPlaces('san', gz); // San Antonio (1.5M) > San Francisco (874k)
    expect(r.map((c) => c.name)).toEqual(['San Antonio', 'San Francisco']);
  });

  it('limit caps results (AC3)', () => {
    expect(completeMapPlaces('s', gz, { limit: 1 })).toHaveLength(1);
  });

  it('ambiguous name → ISO-qualified insert + qualified label (AC4)', () => {
    const r = completeMapPlaces('portl', gz);
    expect(r).toHaveLength(2);
    // higher-pop Oregon first
    expect(r[0]).toMatchObject({
      name: 'Portland',
      insert: 'Portland US-OR',
      sub: 'US-OR',
    });
    expect(r[0]!.label).toContain('US-OR');
    expect(r[1]!.insert).toBe('Portland US-ME');
  });

  it('unique name → bare insert (AC5)', () => {
    const r = completeMapPlaces('tok', gz);
    expect(r[0]).toMatchObject({ name: 'Tokyo', insert: 'Tokyo' });
    expect(r[0]!.label).toBe('Tokyo');
  });

  it('alias resolves to canonical name (AC6)', () => {
    const r = completeMapPlaces('nyc', gz);
    expect(r.map((c) => c.name)).toContain('New York City');
  });

  it('accent-folded match (AC7)', () => {
    expect(completeMapPlaces('sao', gz).map((c) => c.name)).toContain(
      'São Paulo'
    );
  });

  it('de-dupes a city reachable by name AND alias (AC8)', () => {
    // 'n' matches both byName 'new york city' and alt 'nyc' → same index 4.
    const r = completeMapPlaces('n', gz);
    expect(r.filter((c) => c.name === 'New York City')).toHaveLength(1);
  });

  it('pure, deterministic, no throw on odd input (AC9)', () => {
    expect(() => completeMapPlaces('xyzzy', gz)).not.toThrow();
    expect(completeMapPlaces('xyzzy', gz)).toEqual([]);
    expect(JSON.stringify(completeMapPlaces('san', gz))).toBe(
      JSON.stringify(completeMapPlaces('san', gz))
    );
  });

  // IATA-coded airports (separate optional asset). LAX(US)/LAP(MX) share the `la`
  // prefix (alpha LAP<LAX, so scope reordering is observable); SAN shares `san`
  // with the two San cities; SEA is an airport-only prefix.
  const airports: AirportData = {
    airports: [
      [33.94, -118.41, 'US', 0, 'Los Angeles'], // 0 lax
      [24.07, -110.36, 'MX', 0, 'La Paz'], // 1 lap
      [47.45, -122.31, 'US', 0, 'Seattle-Tacoma'], // 2 sea
      [32.73, -117.19, 'US', 0, 'San Diego'], // 3 san
    ],
    airportIata: { lax: 0, lap: 1, sea: 2, san: 3 },
  };

  it('airport-only prefix still completes (relaxed early-return, AC9)', () => {
    const r = completeMapPlaces('sea', gz, { airports });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      insert: 'SEA',
      label: 'SEA',
      kind: 'airport',
      detail: 'Airport · Seattle-Tacoma',
    });
  });

  it('cities rank above airports for a shared prefix (AC9)', () => {
    const r = completeMapPlaces('san', gz, { airports });
    // San Antonio (city) > San Francisco (city) > SAN (airport)
    expect(r.map((c) => c.kind)).toEqual(['city', 'city', 'airport']);
    expect(r[r.length - 1]).toMatchObject({ insert: 'SAN', kind: 'airport' });
  });

  it('scopeISO biases in-region airports up; out-of-region still appears (AC9)', () => {
    // No scope: code-alpha → LAP before LAX.
    expect(
      completeMapPlaces('la', gz, { airports }).map((c) => c.insert)
    ).toEqual(['LAP', 'LAX']);
    // scopeISO US: the US airport (LAX) sorts first, the MX one (LAP) still shows.
    const scoped = completeMapPlaces('la', gz, { airports, scopeISO: 'US' });
    expect(scoped.map((c) => c.insert)).toEqual(['LAX', 'LAP']);
    // A subdivision scope (US-CA) biases by country too.
    const sub = completeMapPlaces('la', gz, { airports, scopeISO: 'US-CA' });
    expect(sub[0]!.insert).toBe('LAX');
  });

  it('absent airports asset → city-only, no throw (old DI bundle, AC9)', () => {
    expect(() => completeMapPlaces('lax', gz)).not.toThrow();
    expect(completeMapPlaces('lax', gz)).toEqual([]); // no city 'lax'
    expect(completeMapPlaces('tok', gz).every((c) => c.kind === 'city')).toBe(
      true
    );
  });

  it('real airports.json smoke', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const path = resolve(dir, '../src/map/data/airports.json');
    const air = JSON.parse(readFileSync(path, 'utf8')) as AirportData;
    const r = completeMapPlaces('jfk', gz, { airports: air });
    expect(r.some((c) => c.insert === 'JFK' && c.kind === 'airport')).toBe(
      true
    );
  });

  it('real gazetteer smoke (AC10)', async () => {
    const { gazetteer } = await loadMapData();
    const r = completeMapPlaces('san', gazetteer, { limit: 8 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(8);
    // population-descending
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1]!.pop).toBeGreaterThanOrEqual(r[i]!.pop);
    }
  });
});

const regions: readonly RegionName[] = [
  { name: 'California', iso: 'US-CA', layer: 'us-state' },
  { name: 'Texas', iso: 'US-TX', layer: 'us-state' },
  { name: 'Georgia', iso: 'US-GA', layer: 'us-state' },
  { name: 'Germany', iso: 'DE', layer: 'country' },
  { name: 'Georgia', iso: 'GE', layer: 'country' },
  { name: 'Canada', iso: 'CA', layer: 'country' },
];

describe('completeMapRegions', () => {
  it('prefix-matches region names; empty → []', () => {
    expect(completeMapRegions('cali', regions).map((r) => r.name)).toEqual([
      'California',
    ]);
    expect(completeMapRegions('', regions)).toEqual([]);
  });

  it('matches by ISO code prefix', () => {
    expect(completeMapRegions('us-t', regions).map((r) => r.iso)).toEqual([
      'US-TX',
    ]);
  });

  it('cross-layer same name returns both, distinguished by detail', () => {
    const r = completeMapRegions('georgia', regions);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.iso).sort()).toEqual(['GE', 'US-GA']);
    expect(r.find((x) => x.iso === 'US-GA')!.detail).toContain('US state');
    expect(r.find((x) => x.iso === 'GE')!.detail).toContain('Country');
  });

  it('caps + deterministic', () => {
    expect(completeMapRegions('c', regions, { limit: 1 })).toHaveLength(1);
    expect(JSON.stringify(completeMapRegions('g', regions))).toBe(
      JSON.stringify(completeMapRegions('g', regions))
    );
  });

  it('real region-names.json smoke', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const path = resolve(dir, '../src/map/data/region-names.json');
    const data = JSON.parse(readFileSync(path, 'utf8')) as RegionNames;
    expect(data.regions.length).toBeGreaterThan(200);
    const ca = completeMapRegions('calif', data.regions);
    expect(ca.some((r) => r.iso === 'US-CA')).toBe(true);
    const de = completeMapRegions('germ', data.regions);
    expect(de.some((r) => r.iso === 'DE')).toBe(true);
  });
});
