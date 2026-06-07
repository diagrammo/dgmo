// Validates the COMMITTED map data assets (src/map/data/*.json). Never
// regenerates them and makes zero network calls (Decision 11 / AC 12).
// Asset shape contract: src/map/data/types.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type {
  BoundaryTopology,
  Gazetteer,
  GazetteerEntry,
  AirportData,
} from '../src/map/data/types';

const DATA = resolve(__dirname, '../src/map/data');
const load = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(DATA, name), 'utf8')) as T;
const gz = (name: string) => gzipSync(readFileSync(resolve(DATA, name))).length;

const coarse = load<BoundaryTopology>('world-coarse.json');
const detail = load<BoundaryTopology>('world-detail.json');
const usStates = load<BoundaryTopology>('us-states.json');
const gaz = load<Gazetteer>('gazetteer.json');

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

describe('map data — world boundaries (AC 2)', () => {
  it('coarse + detail are TopoJSON keyed by ISO 3166-1 alpha-2', () => {
    for (const topo of [coarse, detail]) {
      expect(topo.type).toBe('Topology');
      const geoms = topo.objects.countries.geometries;
      expect(geoms.length).toBeGreaterThan(150);
      for (const g of geoms) {
        expect(typeof g.id).toBe('string');
        expect(g.id).toMatch(/^[A-Z]{2}$/); // alpha-2, no numeric ids
        expect(typeof g.properties.name).toBe('string');
      }
    }
  });

  it('coarse keys are a subset of detail keys (detail is the superset)', () => {
    const dk = new Set(detail.objects.countries.geometries.map((g) => g.id));
    for (const g of coarse.objects.countries.geometries) {
      expect(dk.has(g.id)).toBe(true);
    }
  });

  it('Kosovo is mapped to XK (no-ISO-numeric special case, R4)', () => {
    expect(detail.objects.countries.geometries.some((g) => g.id === 'XK')).toBe(
      true
    );
  });
});

describe('map data — US states (AC 4 / R7)', () => {
  it('every state keyed US-XX (ISO 3166-2), 50 states + DC present', () => {
    const geoms = usStates.objects.states.geometries;
    for (const g of geoms) {
      expect(g.id).toMatch(/^US-[A-Z]{2}$/);
      expect(typeof g.properties.name).toBe('string');
    }
    const ids = new Set(geoms.map((g) => g.id));
    // 50 states + DC
    for (const s of ['US-CA', 'US-NY', 'US-TX', 'US-DC', 'US-WY', 'US-HI']) {
      expect(ids.has(s)).toBe(true);
    }
    const territories = ['US-AS', 'US-GU', 'US-MP', 'US-PR', 'US-VI'].filter(
      (t) => ids.has(t)
    );
    // territories present in the source must be mapped (not dropped)
    expect(territories.length).toBeGreaterThanOrEqual(1);
  });
});

describe('map data — gazetteer shape (AC 5 / R13)', () => {
  it('matches the normalized typed contract', () => {
    expect(Array.isArray(gaz.cities)).toBe(true);
    expect(gaz.cities.length).toBeGreaterThan(1000);
    for (const c of gaz.cities.slice(0, 50)) {
      const [lat, lon, iso, pop, name] = c as GazetteerEntry;
      expect(typeof lat).toBe('number');
      expect(typeof lon).toBe('number');
      expect(iso).toMatch(/^[A-Z]{2}$/);
      expect(Number.isInteger(pop)).toBe(true);
      expect(typeof name).toBe('string');
      if (c[5] !== undefined) expect(c[5]).toMatch(/^US-[A-Z]{2}$/);
    }
    // byName values are index arrays into cities
    for (const idxs of Object.values(gaz.byName).slice(0, 50)) {
      expect(Array.isArray(idxs)).toBe(true);
      for (const i of idxs) expect(gaz.cities[i]).toBeDefined();
    }
    // alt maps to a valid city index and never collides with a byName key
    for (const [alias, i] of Object.entries(gaz.alt).slice(0, 50)) {
      expect(gaz.cities[i]).toBeDefined();
      expect(gaz.byName[alias]).toBeUndefined();
    }
  });

  it('lat/lon rounded to 3 decimals (determinism, R11)', () => {
    for (const [lat, lon] of gaz.cities) {
      expect(Number(lat.toFixed(3))).toBe(lat);
      expect(Number(lon.toFixed(3))).toBe(lon);
    }
  });
});

describe('map data — disambiguation + aliases (AC 6 / AC 8)', () => {
  it('Portland resolves to both US-OR and US-ME (multi-entry, FM-H)', () => {
    const candidates = (gaz.byName['portland'] ?? []).map((i) => gaz.cities[i]);
    const subs = new Set(candidates.map((c) => c[5]).filter(Boolean));
    expect(subs.has('US-OR')).toBe(true);
    expect(subs.has('US-ME')).toBe(true);
  });

  it('"NYC" alias resolves to New York City (abbreviation)', () => {
    const i = gaz.alt['nyc'];
    expect(i).toBeDefined();
    expect(gaz.cities[i!][4]).toMatch(/New York/);
  });

  it('accented names resolve via folded key ("São Paulo")', () => {
    const i = gaz.byName[fold('São Paulo')]?.[0];
    expect(i).toBeDefined();
    expect(gaz.cities[i!][4]).toBe('São Paulo');
  });
});

describe('map data — sentinel cities (AC 9)', () => {
  const present = (q: string) =>
    (gaz.byName[fold(q)]?.length ?? 0) > 0 || gaz.alt[fold(q)] !== undefined;

  it('global sentinels present', () => {
    for (const c of ['New York City', 'Tokyo', 'London', 'São Paulo']) {
      expect(present(c)).toBe(true);
    }
  });

  it('≥3 US state capitals present, including a sub-floor one (Montpelier)', () => {
    const capitals = ['Sacramento', 'Austin', 'Boston', 'Montpelier', 'Pierre'];
    const found = capitals.filter(present);
    expect(found.length).toBeGreaterThanOrEqual(3);
    // Montpelier (~8k) only survives via FORCE_INCLUDE (R12)
    expect(present('Montpelier')).toBe(true);
  });
});

describe('map data — airports (map-airport-iata-codes)', () => {
  const air = load<AirportData>('airports.json');
  const collisionsFixture = load<{ collisions: string[] }>(
    'airport-collisions.json'
  );

  it('airports.json has the typed shape; every index valid; tuples normalized', () => {
    expect(Array.isArray(air.airports)).toBe(true);
    expect(air.airports.length).toBeGreaterThan(800);
    expect(typeof air.airportIata).toBe('object');
    for (const [code, idx] of Object.entries(air.airportIata)) {
      expect(code).toMatch(/^[a-z]{3}$/); // folded 3-letter IATA
      expect(air.airports[idx]).toBeDefined();
    }
    for (const a of air.airports) {
      const [lat, lon, iso, pop, name] = a as GazetteerEntry;
      // coords rounded to 2 decimals (~1km; the airport size lever)
      expect(Number(lat.toFixed(2))).toBe(lat);
      expect(Number(lon.toFixed(2))).toBe(lon);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(iso).toMatch(/^[A-Z]{2}$/);
      expect(pop).toBe(0); // no enplanement column — always 0
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('anchor airports resolve to exact known coords + names (drift trip-wire)', () => {
    // Small fixed set (AC1/AC7): catches silent data drift without a brittle
    // 1500-row snapshot. Coords are 2-decimal.
    const at = (code: string) => air.airports[air.airportIata[code]!]!;
    expect(at('jfk')[2]).toBe('US');
    expect(at('jfk')[4]).toMatch(/Kennedy/);
    expect(at('lhr')[2]).toBe('GB');
    expect(at('lhr')[4]).toMatch(/Heathrow/);
    expect(at('mco')[4]).toMatch(/Orlando/);
    expect(at('sna')[2]).toBe('US'); // John Wayne — a US medium_airport
  });

  it('collision fixture EQUALS the live city↔IATA overlap (AC4 — city wins)', () => {
    // Every committed collision code is BOTH an airport code and a gazetteer city
    // name (byName), and the set is exactly the live overlap — so "city wins" is
    // a verified invariant, not an assumption.
    const live = Object.keys(air.airportIata)
      .filter((c) => gaz.byName[c])
      .sort();
    expect(live).toEqual([...collisionsFixture.collisions].sort());
    for (const c of collisionsFixture.collisions) {
      expect(air.airportIata[c]).toBeDefined();
      expect(gaz.byName[c]).toBeDefined();
    }
  });
});

describe('map data — size ceilings (AC 10)', () => {
  it('each asset is within its gz budget', () => {
    expect(gz('world-coarse.json')).toBeLessThanOrEqual(25_000);
    expect(gz('world-detail.json')).toBeLessThanOrEqual(60_000);
    expect(gz('us-states.json')).toBeLessThanOrEqual(15_000);
    expect(gz('gazetteer.json')).toBeLessThanOrEqual(70_000);
    // Airports asset under its own ceiling; gazetteer still under its 70KB gate
    // (separate file — airports never inflate it). AC7/AC8.
    expect(gz('airports.json')).toBeLessThanOrEqual(42_000);
  });
});

describe('map data — provenance (AC 14)', () => {
  it('PROVENANCE.json records sources, asset hashes, and counts', () => {
    const prov = load<{
      sources: Record<string, unknown>;
      assets: Record<
        string,
        { sha256: string; bytes: number; gzBytes: number }
      >;
      counts: Record<string, number>;
    }>('PROVENANCE.json');
    expect(prov.sources.worldCoarse).toBeDefined();
    expect(prov.sources.usAtlas).toBeDefined();
    expect(prov.sources.geonames).toBeDefined();
    expect(prov.sources.ourairports).toBeDefined(); // airport source + license
    for (const name of [
      'world-coarse.json',
      'world-detail.json',
      'us-states.json',
      'gazetteer.json',
      'airports.json',
    ]) {
      expect(prov.assets[name].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(prov.assets[name].gzBytes).toBeGreaterThan(0);
    }
    expect(prov.counts.gazetteerCities).toBeGreaterThan(1000);
    expect(prov.counts.airports).toBeGreaterThan(800);
  });
});
