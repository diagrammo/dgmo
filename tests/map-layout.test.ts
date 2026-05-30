import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap } from '../src/map/layout';
import { getPalette } from '../src/palettes';
import { mix } from '../src/palettes/color-utils';
import type { MapData } from '../src/map/resolved-types';
import type { BoundaryTopology, Gazetteer } from '../src/map/data/types';

// Shared hand-built MapData fixture (matches the step-3 resolver fixture).
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
    [35.68, 139.69, 'JP', 9_000_000, 'Tokyo'],
    [34.69, 135.5, 'JP', 2_700_000, 'Osaka'],
    [43.66, -70.25, 'US', 66_881, 'Portland', 'US-ME'],
    [45.52, -122.68, 'US', 652_503, 'Portland', 'US-OR'],
    [40.71, -74.0, 'US', 8_800_000, 'New York City', 'US-NY'],
    [38.9, -77.04, 'US', 5_000, 'Office', 'US-DC'],
  ],
  byName: {
    tokyo: [0],
    osaka: [1],
    portland: [2, 3],
    'new york city': [4],
    office: [5],
  },
  alt: { nyc: 4 },
};

const DATA: MapData = {
  worldCoarse: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
    { id: 'GE', name: 'Georgia', box: [40, 41, 47, 44] },
    { id: 'CD', name: 'Dem. Rep. Congo', box: [12, -13, 31, 5] },
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
    { id: 'US-GA', name: 'Georgia', box: [-85, 30, -81, 35] },
    { id: 'US-AK', name: 'Alaska', box: [-170, 52, -130, 71] },
    { id: 'US-HI', name: 'Hawaii', box: [-160, 18, -154, 23] },
  ]),
  gazetteer,
};

const P = getPalette('nord').light;
// Land is a muted yellow (see layout.ts LAND_TINT_LIGHT); backdrop stays bg.
const neutral = mix(P.colors.green, P.bg, 58);
const lay = (src: string, w = 800, h = 600) =>
  layoutMap(
    resolveMap(parseMap(src), DATA),
    DATA,
    { width: w, height: h },
    {
      palette: P,
      isDark: false,
    }
  );

describe('layout — basemap & projection (AC2, AC19, AC20, AC23, AC27)', () => {
  it('us-states layer decoded + drawn (AC2)', () => {
    const r = lay('map\nCalifornia score: 50');
    expect(r.regions.some((x) => x.layer === 'us-state')).toBe(true);
  });
  it('empty map → base regions only, no pois (AC23)', () => {
    const r = lay('map');
    expect(r.regions.length).toBeGreaterThan(0);
    expect(r.pois).toHaveLength(0);
    expect(r.legend).toBeNull();
  });
  it('US-only → albers-usa, finite paths (AC19)', () => {
    const r = lay('map\nCalifornia score: 1\nOregon score: 2');
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    expect(ca.d.length).toBeGreaterThan(0);
    expect(ca.d).not.toMatch(/NaN/);
  });
  it('us-states → AK/HI insets with coast-hugging angled tops', () => {
    const r = lay(
      'map\nregion us-states\nCalifornia score: 1\nAlaska score: 2\nHawaii score: 3',
      1200,
      800
    );
    expect(r.insets).toHaveLength(2);
    expect(r.insetRegions.map((x) => x.id).sort()).toEqual(['US-AK', 'US-HI']);
    const yB = 800 - 24; // height - FIT_PAD
    for (const box of r.insets) {
      // Polyline top (more than the 4 corners of a plain rectangle) → angled.
      expect(box.points.length).toBeGreaterThan(4);
      const xs = box.points.map((p) => p[0]);
      const ys = box.points.map((p) => p[1]);
      // Lower-left anchored, fully on-canvas.
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(1200);
      expect(Math.max(...ys)).toBeLessThanOrEqual(800);
      // Exactly the two bottom corners sit on the shared bottom edge; the rest
      // form the angled top above it.
      expect(box.points.filter((p) => Math.abs(p[1] - yB) < 0.5)).toHaveLength(
        2
      );
      expect(Math.min(...ys)).toBeLessThan(yB - 40); // box has real height
    }
  });
  it('non-albers cluster zooms to fill the canvas (extent-corner fit, not globe)', () => {
    // Regression: a tight mercator cluster must NOT render tiny on a world map.
    // A lat/lon Polygon fit target was being read as the whole-globe complement.
    const r = lay('map\npoi 40 -74 as a\npoi 42 -71 as b', 800, 600);
    const a = r.pois.find((p) => p.id === 'a')!;
    const b = r.pois.find((p) => p.id === 'b')!;
    const span = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    expect(span).toBeGreaterThan(150); // zoomed in, not clustered at center
  });
  it('antimeridian POI pair → finite, on-canvas coords (AC20)', () => {
    const r = lay('map\npoi 0 178 as a\npoi 0 -178 as b');
    for (const p of r.pois) {
      expect(Number.isFinite(p.cx)).toBe(true);
      expect(Number.isFinite(p.cy)).toBe(true);
      expect(p.cx).toBeGreaterThanOrEqual(0);
      expect(p.cx).toBeLessThanOrEqual(800);
    }
  });
  it('country fill found on the resolver-chosen tier (AC27 / AR7 invariant)', () => {
    const resolved = resolveMap(parseMap('map\nJapan score: 5'), DATA);
    // AR7: country isos exist in BOTH tiers (coarse ⊆ detail), so the fill is
    // found whichever tier the resolver picks.
    const tier =
      resolved.basemaps.world === 'detail'
        ? DATA.worldDetail
        : DATA.worldCoarse;
    expect(
      tier.objects['countries']!.geometries.some((g) => g.id === 'JP')
    ).toBe(true);
    const r = layoutMap(
      resolved,
      DATA,
      { width: 800, height: 600 },
      {
        palette: P,
        isDark: false,
      }
    );
    const jp = r.regions.find((x) => x.id === 'JP' && x.layer === 'country')!;
    expect(jp).toBeDefined();
    expect(jp.fill).not.toBe(neutral);
  });
});

describe('layout — region fills (AC3, AC4, AC5, AC25, AC26)', () => {
  it('choropleth ramp: min at floor, max at full hue (AC3)', () => {
    const r = lay('map\nmetric Sales\nCalifornia score: 0\nOregon score: 100');
    expect(r.legend?.ramp).toMatchObject({ metric: 'Sales', min: 0, max: 100 });
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    const or = r.regions.find((x) => x.id === 'US-OR')!;
    expect(or.fill).toBe(P.colors.red); // t=1 → 100% hue (red ramp)
    expect(ca.fill).toBe(mix(P.colors.red, P.bg, 15)); // floor: ramp base (bg), not land
  });
  it('scale override sets ramp anchors (AC3)', () => {
    const r = lay('map\nscale 0 200\nCalifornia score: 100');
    expect(r.legend?.ramp).toMatchObject({ min: 0, max: 200 });
  });
  it('categorical fill + active-tag + legend group (AC4)', () => {
    const r = lay(
      'map\ntag Market as m\n  HQ blue\n  Region teal\nactive-tag Market\nUnited States m: HQ\nJapan m: Region'
    );
    const us = r.regions.find((x) => x.id === 'US' && x.layer === 'country')!;
    expect(us.fill).not.toBe(neutral);
    expect(r.legend?.tagGroups.some((g) => g.name === 'Market')).toBe(true);
    expect(r.legend?.activeGroup).toBe('Market');
  });
  it('score wins over tag (AC5)', () => {
    const r = lay(
      'map\ntag M as m\n  HQ blue\nactive-tag M\nCalifornia score: 50, m: HQ'
    );
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    expect(ca.fill).toBe(P.colors.red); // single score → ramp full hue, NOT tag blue
  });
  it('unknown tag value → neutral, no throw (AC25)', () => {
    const r = lay(
      'map\ntag M as m\n  HQ blue\nactive-tag M\nCalifornia m: Ghost'
    );
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    expect(ca.fill).toBe(neutral);
  });
  it('auto-first-group colors with no active-tag; none suppresses (AC26)', () => {
    const auto = lay('map\ntag M as m\n  HQ blue\nUnited States m: HQ');
    expect(auto.legend?.activeGroup).toBe('M');
    expect(auto.regions.find((x) => x.id === 'US')!.fill).not.toBe(neutral);
    const none = lay(
      'map\ntag M as m\n  HQ blue\nactive-tag none\nUnited States m: HQ'
    );
    expect(none.regions.find((x) => x.id === 'US')!.fill).toBe(neutral);
  });
});

describe('layout — POIs (AC6, AC7, AC8, AC18)', () => {
  it('POI marker + on-map label (AC6)', () => {
    const r = lay('map\npoi Tokyo');
    expect(r.pois[0]).toMatchObject({ id: 'tokyo' });
    expect(Number.isFinite(r.pois[0]!.cx)).toBe(true);
    expect(r.labels.some((l) => l.text === 'Tokyo')).toBe(true);
  });
  it('size scaling: larger value → larger radius + size legend (AC7)', () => {
    const r = lay(
      'map\nsize-metric Pop\npoi 40 -74 as a size: 10\npoi 41 -73 as b size: 100'
    );
    const a = r.pois.find((p) => p.id === 'a')!;
    const b = r.pois.find((p) => p.id === 'b')!;
    expect(b.r).toBeGreaterThan(a.r);
    expect(r.legend?.size).toMatchObject({ metric: 'Pop' });
  });
  it('coords POI placed + labeled by alias (AC8)', () => {
    const r = lay('map\npoi 39.74 -104.99 as dcw');
    const dcw = r.pois.find((p) => p.id === 'dcw')!;
    expect(dcw).toBeDefined();
    expect(Number.isFinite(dcw.cx)).toBe(true);
    expect(r.labels.some((l) => l.text === 'dcw')).toBe(true);
  });
  it('co-located POIs spiderfy to distinct, deterministic positions (AC18)', () => {
    const a = lay('map\npoi 0 0 as aa\npoi 0 0 as bb');
    expect(a.pois[0]!.cx).not.toBe(a.pois[1]!.cx);
    const b = lay('map\npoi 0 0 as aa\npoi 0 0 as bb');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('layout — routes & edges (AC9, AC10, AC11, AC12, AC28)', () => {
  it('route: shared origin once, numbered, closing leg (AC9)', () => {
    const r = lay('map\nroute\n  Tokyo\n  Osaka\n  Tokyo');
    expect(r.pois.filter((p) => p.id === 'tokyo')).toHaveLength(1);
    expect(r.pois.find((p) => p.id === 'tokyo')!.isOrigin).toBe(true);
    expect(r.pois.find((p) => p.id === 'tokyo')!.routeNumber).toBe(1);
    expect(r.legs).toHaveLength(2); // tokyo→osaka, osaka→tokyo (closing)
  });
  it('arc route → curved leg path (AC10)', () => {
    const r = lay('map\nroute style: arc\n  Tokyo\n  Osaka');
    expect(r.legs[0]!.d).toMatch(/Q/);
  });
  it('edge weight + arrow + label (AC11)', () => {
    const r = lay('map\npoi Tokyo\npoi Osaka\nTokyo -ships-> Osaka weight: 22');
    const leg = r.legs[0]!;
    expect(leg.arrow).toBe(true);
    expect(leg.label).toBe('ships');
    expect(leg.width).toBeGreaterThan(1.25);
  });
  it('parallel edges fan out to distinct curved paths (AC12)', () => {
    const r = lay('map\npoi Tokyo\npoi Osaka\nTokyo -> Osaka\nOsaka -> Tokyo');
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0]!.d).toMatch(/Q/);
    expect(r.legs[1]!.d).toMatch(/Q/);
    expect(r.legs[0]!.d).not.toBe(r.legs[1]!.d);
  });
  it('parallel edges + colliding cluster is byte-deterministic (AC28)', () => {
    const src =
      'map\npoi 0 0 as aaaa\npoi 0 0 as bbbb\naaaa -> bbbb\nbbbb -> aaaa';
    expect(JSON.stringify(lay(src))).toBe(JSON.stringify(lay(src)));
  });
});

describe('layout — labels & legend (AC13, AC14, AC15, AC16, AC17)', () => {
  it('region labels off by default, on with full (AC13)', () => {
    expect(
      lay('map\nCalifornia score: 50').labels.some(
        (l) => l.text === 'California'
      )
    ).toBe(false);
    expect(
      lay('map\nregion-labels full\nCalifornia score: 50').labels.some(
        (l) => l.text === 'California'
      )
    ).toBe(true);
  });
  it('poi-labels off → none; all → every POI labeled (AC14)', () => {
    expect(lay('map\npoi-labels off\npoi Tokyo').labels).toHaveLength(0);
    const all = lay('map\npoi-labels all\npoi 0 0 as aa\npoi 0 0 as bb');
    expect(all.labels.length).toBeGreaterThanOrEqual(2);
  });
  it('label escalation never moves markers (AC15)', () => {
    const src =
      'map\npoi 0 0 as alphaone\npoi 0 0 as bravotwo\npoi 0 0 as charlie3';
    const off = lay(`map\npoi-labels off\n${src.slice(4)}`);
    const all = lay(`map\npoi-labels all\n${src.slice(4)}`);
    expect(off.pois.map((p) => [p.cx, p.cy])).toEqual(
      all.pois.map((p) => [p.cx, p.cy])
    );
    // The colliding cluster escalated (leader or pin) for at least one label.
    expect(all.labels.some((l) => l.leader || l.pin !== undefined)).toBe(true);
  });
  it('labels carry a halo flag (AC16)', () => {
    expect(lay('map\npoi Tokyo').labels.every((l) => l.halo)).toBe(true);
  });
  it('no-legend suppresses the legend model (AC17)', () => {
    expect(lay('map\nno-legend\nCalifornia score: 5').legend).toBeNull();
  });
});

describe('layout — purity & determinism (AC22)', () => {
  it('deterministic, never throws on a resolved map with errors (AC22)', () => {
    const resolved = resolveMap(parseMap('map\npoi Nowheresville'), DATA);
    expect(resolved.error).not.toBeNull();
    expect(() =>
      layoutMap(
        resolved,
        DATA,
        { width: 800, height: 600 },
        {
          palette: P,
          isDark: false,
        }
      )
    ).not.toThrow();
    const src = 'map\npoi Tokyo\nCalifornia score: 5';
    expect(JSON.stringify(lay(src))).toBe(JSON.stringify(lay(src)));
  });
});
