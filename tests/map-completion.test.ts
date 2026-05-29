import { describe, it, expect } from 'vitest';
import { completeMapPlaces } from '../src/map/completion';
import { loadMapData } from '../src/map/load-data';
import type { Gazetteer } from '../src/map/data/types';

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
