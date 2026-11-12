import { describe, it, expect, beforeAll, vi } from 'vitest';
import { feature } from 'topojson-client';
import type * as TopojsonClient from 'topojson-client';
import { decodeFeatures } from '../src/map/geo';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { loadMapData } from '../src/map/load-data';
import type { MapData } from '../src/map/resolved-types';

// A POI-only map resolves by reverse-geocoding each POI against both basemaps.
// That decode once ran on every resolve — every keystroke in the app's map
// preview — and cost ~10 ms of each keystroke's main-thread task on anchor
// (#1943). It now runs once per topology.
vi.mock('topojson-client', async (importOriginal) => {
  const real = await importOriginal<typeof TopojsonClient>();
  return { ...real, feature: vi.fn(real.feature) };
});

const POI_ONLY = [
  'map Follow-the-Sun Support Desk',
  '',
  'poi San Francisco label: West Coast',
  'poi London label: EMEA',
  'poi Singapore label: APAC',
  'poi Sydney label: Pacific',
].join('\n');

let data: MapData;
beforeAll(async () => {
  data = await loadMapData();
});

describe('decodeFeatures decodes a topology once (#1943)', () => {
  it('returns the same array for the same topology', () => {
    const first = decodeFeatures(data.worldDetail);
    expect(decodeFeatures(data.worldDetail)).toBe(first);
    expect(decodeFeatures(data.usStates)).toBe(decodeFeatures(data.usStates));
    expect(decodeFeatures(data.usStates)).not.toBe(first);
  });

  it('a repeat resolve of a POI-only map does not re-decode the basemaps', () => {
    const decode = vi.mocked(feature);
    const before = resolveMap(parseMap(POI_ONLY), data);
    decode.mockClear();
    const after = resolveMap(parseMap(POI_ONLY), data);
    // Only the framing bbox of each POI's containing region is decoded (one
    // feature per region, `featureBbox`); the whole-basemap decode is gone.
    expect(decode.mock.calls.length).toBeLessThanOrEqual(4);
    expect(after.extent).toEqual(before.extent);
    expect(after.diagnostics).toEqual(before.diagnostics);
  });
});
