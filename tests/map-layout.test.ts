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
  mountainRanges: rectTopo('ranges', [
    { id: 'mtn-0', name: 'Rockies', box: [-120, 35, -105, 45] },
  ]),
  gazetteer,
};

const P = getPalette('nord').light;
// Unscored/untagged subject land — a VERY faded green, uniform whether or not a
// colouring dimension is active (see layout.ts mapNeutralLandColor /
// LAND_TINT_LIGHT). Data activity no longer changes the subject dress.
const neutral = mix(P.colors.green, P.bg, 12);
const mutedNeutral = neutral;
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
    const r = lay('map\nCalifornia value: 50');
    expect(r.regions.some((x) => x.layer === 'us-state')).toBe(true);
  });
  it('empty map → base regions only, no pois (AC23)', () => {
    const r = lay('map');
    expect(r.regions.length).toBeGreaterThan(0);
    expect(r.pois).toHaveLength(0);
    expect(r.legend).toBeNull();
  });
  it('US-only → albers-usa, finite paths (AC19)', () => {
    const r = lay('map\nCalifornia value: 1\nOregon value: 2');
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    expect(ca.d.length).toBeGreaterThan(0);
    expect(ca.d).not.toMatch(/NaN/);
  });
  it('us-states insets are flat-top rectangles (AK/HI)', () => {
    // NOTE: faithful placement is geometry/projection-dependent and verified
    // visually; the hand-built rect fixture can't reproduce real albers bounds,
    // so this only asserts the structural contract of whatever frames render.
    const r = lay(
      'map\nCalifornia value: 1\nAlaska value: 2\nHawaii value: 3',
      1200,
      800
    );
    expect(r.insets.length).toBeLessThanOrEqual(2);
    expect(r.insetRegions).toHaveLength(r.insets.length);
    for (const reg of r.insetRegions)
      expect(['US-AK', 'US-HI']).toContain(reg.id);
    for (const box of r.insets) {
      // Each frame is a 4-corner axis-aligned rectangle.
      expect(box.points).toHaveLength(4);
      const [tl, tr, br, bl] = box.points;
      expect(tl[0]).toBeCloseTo(bl[0], 1); // left side vertical
      expect(tr[0]).toBeCloseTo(br[0], 1); // right side vertical
      expect(tl[1]).toBeCloseTo(tr[1], 1); // top flat
      expect(br[1]).toBeCloseTo(bl[1], 1); // bottom flat
    }
  });
  it('AK/HI insets are inferred — absent when neither is referenced', () => {
    // A US-oriented map that names no AK/HI content frames the contiguous states
    // alone, with no empty inset boxes (§24B.2 — replaces the old `no-insets`).
    const r = lay('map\nCalifornia value: 1\nTexas value: 2', 1200, 800);
    expect(r.insets).toHaveLength(0);
    expect(r.insetRegions).toHaveLength(0);
  });
  it('only the referenced AK/HI inset renders (Hawaii alone)', () => {
    const r = lay('map\nCalifornia value: 1\nHawaii value: 2', 1200, 800);
    expect(r.insetRegions.map((x) => x.id)).toEqual(['US-HI']);
  });
  it('us-states view draws ALL conus states even with a tight POI cluster (cull box = conus, not the cluster)', () => {
    // Regression: a US-oriented map fits the projection to the whole contiguous
    // US, but the cull box was the POI extent — so a metro-sized cluster blanked
    // every far state, leaving gray gaps where land should be. The cull box must
    // be the conus bounds. The single US POI (Portland OR) makes the map
    // US-oriented (albers-usa); the eastern fixture states (Maine, Georgia) must
    // still render as land.
    const r = lay('map\npoi 45.52 -122.68 as office');
    const me = r.regions.find((x) => x.id === 'US-ME');
    const ga = r.regions.find((x) => x.id === 'US-GA');
    expect(me).toBeDefined();
    expect(ga).toBeDefined();
    expect(me!.d).not.toMatch(/NaN/);
    expect(me!.fill).toBe(neutral); // unscored → plain land, not culled away
  });
  it('non-albers cluster zooms to fill the canvas (extent-corner fit, not globe)', () => {
    // Regression: a tight mercator cluster must NOT render tiny on a world map.
    // A lat/lon Polygon fit target was being read as the whole-globe complement.
    // Non-US coords (Paris/Berlin) keep it off albers-usa so we test the
    // geographic-cluster fit path.
    const r = lay('map\npoi 48.85 2.35 as a\npoi 52.52 13.4 as b', 800, 600);
    expect(r.projection).not.toBe('albers-usa');
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
  it('antimeridian seam-sliver (Fiji-like) is dropped, not painted across the frame', () => {
    // A country crossing the dateline whose true arc is tiny (177°E..178°W)
    // inverts under equirectangular to fill the WHOLE ocean as land. It must be
    // dropped from the world layer (the global view skips view-culling, so the
    // frame-fill guard has to run regardless). Regression for the green-ocean.
    const seamWorld = rectTopo('countries', [
      { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
      { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
      { id: 'FJ', name: 'Fiji', box: [177, -19, -178, -16] }, // wraps the seam
    ]);
    const data = { ...DATA, worldCoarse: seamWorld, worldDetail: seamWorld };
    const r = layoutMap(
      resolveMap(parseMap('map\nUnited States value: 5\nJapan value: 3'), data),
      data,
      { width: 800, height: 600 },
      { palette: P, isDark: false }
    );
    // Fiji is gone entirely — its only ring is a seam sliver, so it would have
    // been the frame-filling polygon. US/JP (no seam crossing) are unaffected.
    expect(r.regions.some((x) => x.id === 'FJ')).toBe(false);
    expect(r.regions.some((x) => x.id === 'US')).toBe(true);
  });
  it('country fill found on the resolver-chosen tier (AC27 / AR7 invariant)', () => {
    const resolved = resolveMap(parseMap('map\nJapan value: 5'), DATA);
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
    const r = lay(
      'map\nregion-metric Sales\nCalifornia value: 0\nOregon value: 100'
    );
    expect(r.legend?.ramp).toMatchObject({ metric: 'Sales', min: 0, max: 100 });
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    const or = r.regions.find((x) => x.id === 'US-OR')!;
    expect(or.fill).toBe(P.colors.red); // t=1 → 100% hue (red ramp)
    expect(ca.fill).toBe(mix(P.colors.red, P.bg, 15)); // floor: ramp base (bg), not land
  });
  it('scale override sets ramp anchors (AC3)', () => {
    const r = lay('map\nscale 0 200\nCalifornia value: 100');
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
  it('active colouring dimension decides fill — value vs tag (AC5, bivariate)', () => {
    const src = 'map\ntag M as m\n  HQ blue\nCalifornia value: 50, m: HQ';
    // Default: values present → colour by the value ramp (sole value → full hue).
    expect(lay(src).regions.find((x) => x.id === 'US-CA')!.fill).toBe(
      P.colors.red
    );
    // `active-tag M` flips to the tag dimension → NOT the value ramp.
    expect(
      lay(`${src}\nactive-tag M`).regions.find((x) => x.id === 'US-CA')!.fill
    ).not.toBe(P.colors.red);
    // `active-tag Value` flips back to the ramp by its default group name (the
    // old `active-tag score` token was dropped — selecting the ramp uses its
    // legend name, "Value", or the region-metric label).
    expect(
      lay(`${src}\nactive-tag Value`).regions.find((x) => x.id === 'US-CA')!
        .fill
    ).toBe(P.colors.red);
  });
  it('unknown tag value → neutral, no throw (AC25)', () => {
    const r = lay(
      'map\ntag M as m\n  HQ blue\nactive-tag M\nCalifornia m: Ghost'
    );
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    expect(ca.fill).toBe(mutedNeutral);
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

describe('layout — direct trailing colors & ramp hue (§1.5, §24B.3)', () => {
  const TAG_TINT_LIGHT = 60;
  it('region trailing color → flat override fill, ignores active dimension', () => {
    const r = lay('map\nCalifornia blue');
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    expect(ca.fill).toBe(mix(P.colors.blue, P.bg, TAG_TINT_LIGHT));
  });
  it('region trailing color overrides the value ramp on the same region', () => {
    const r = lay('map\nregion-metric Sales\nCalifornia blue value: 100');
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    // Painted blue (direct), not the red ramp full-hue it would otherwise get.
    expect(ca.fill).toBe(mix(P.colors.blue, P.bg, TAG_TINT_LIGHT));
  });
  it('region-metric trailing color sets the choropleth ramp hue', () => {
    const r = lay(
      'map\nregion-metric Sales blue\nCalifornia value: 0\nOregon value: 100'
    );
    const or = r.regions.find((x) => x.id === 'US-OR')!;
    expect(or.fill).toBe(P.colors.blue); // t=1 → full hue, now blue not red
    expect(r.legend?.ramp).toMatchObject({ metric: 'Sales' });
  });
  it('POI trailing color → flat marker fill, overrides default orange', () => {
    const r = lay('map\npoi Tokyo red');
    expect(r.pois[0]!.fill).toBe(P.colors.red);
    expect(r.pois[0]!.fill).not.toBe(P.colors.orange);
  });
  it('POI trailing color wins over a tag color', () => {
    const r = lay('map\ntag M as m\n  Office blue\npoi Tokyo red m: Office');
    expect(r.pois[0]!.fill).toBe(P.colors.red);
  });
});

describe('layout — uniform subtle basemap dress (subject water + land)', () => {
  // Subject water + land wear the SAME faded blue/green dress regardless of data
  // activity or the muted/natural flags — only neighbour land changes (below).
  const water = mix(P.colors.blue, P.bg, 13);
  it('no data → subtle water + faded green land', () => {
    const r = lay('map\nCalifornia');
    expect(r.background).toBe(water);
    expect(r.regions.find((x) => x.id === 'US-CA')!.fill).toBe(neutral);
  });
  it('`muted` does not change subject water/land', () => {
    const r = lay('map\nmuted\nCalifornia');
    expect(r.background).toBe(water);
    expect(r.regions.find((x) => x.id === 'US-CA')!.fill).toBe(neutral);
  });
  it('tag dimension active → subject water/land unchanged', () => {
    const r = lay('map\ntag M as m\n  HQ blue\nactive-tag M\nCalifornia m: HQ');
    expect(r.background).toBe(water);
    // unscored/untagged subject land stays the same faded green
    expect(r.regions.find((x) => x.id === 'US-OR')!.fill).toBe(neutral);
  });
});

describe('layout — POIs (AC6, AC7, AC8, AC18)', () => {
  it('POI marker + on-map label (AC6)', () => {
    const r = lay('map\npoi Tokyo');
    expect(r.pois[0]).toMatchObject({ id: 'tokyo' });
    expect(Number.isFinite(r.pois[0]!.cx)).toBe(true);
    expect(r.labels.some((l) => l.text === 'Tokyo')).toBe(true);
  });
  it('size scaling: larger value → larger radius, no size legend key (AC7)', () => {
    const r = lay(
      'map\npoi-metric Pop\npoi 40 -74 as a value: 10\npoi 41 -73 as b value: 100'
    );
    const a = r.pois.find((p) => p.id === 'a')!;
    const b = r.pois.find((p) => p.id === 'b')!;
    expect(b.r).toBeGreaterThan(a.r);
    // POI size is self-evident from the marker scale — no legend key for it.
    expect(r.legend).toBeNull();
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
    const r = lay('map\nroute Tokyo\n  -> Osaka\n  -> Tokyo');
    expect(r.pois.filter((p) => p.id === 'tokyo')).toHaveLength(1);
    expect(r.pois.find((p) => p.id === 'tokyo')!.isOrigin).toBe(true);
    expect(r.pois.find((p) => p.id === 'tokyo')!.routeNumber).toBe(1);
    expect(r.legs).toHaveLength(2); // tokyo→osaka, osaka→tokyo (closing)
  });
  it('arc route → curved leg path (AC10)', () => {
    const r = lay('map\nroute Tokyo style: arc\n  -> Osaka');
    expect(r.legs[0]!.d).toMatch(/Q/);
  });
  it('route leg carries an in-arrow label + value→thickness (AC11)', () => {
    const r = lay('map\nroute Tokyo\n  -ferry-> Osaka value: 40');
    expect(r.legs[0]!.label).toBe('ferry');
    expect(r.legs[0]!.width).toBeGreaterThan(1.25); // value lifts it above W_MIN
  });
  it('edge weight + arrow + label (AC11)', () => {
    const r = lay('map\npoi Tokyo\npoi Osaka\nTokyo -ships-> Osaka value: 22');
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

describe('layout — surface-route avoidance (§24B.6)', () => {
  it('opt-out: no surface anywhere → no surface path, deterministic (AC3/P6)', () => {
    const r = lay('map\nroute Tokyo\n  -> Osaka');
    // Plain straight leg (no surface code path engaged).
    expect(r.legs[0]!.d).toMatch(/^M[\d.,-]+L[\d.,-]+$/);
    expect(r.legs[0]!.d).not.toMatch(/Q/);
    // No surface diagnostics, and byte-identical across runs.
    expect(r.diagnostics).toHaveLength(0);
    expect(JSON.stringify(lay('map\nroute Tokyo\n  -> Osaka'))).toBe(
      JSON.stringify(lay('map\nroute Tokyo\n  -> Osaka'))
    );
  });
  it('surface: water leg is drawn as an arc (F9 implies arc)', () => {
    const r = lay('map\nroute Tokyo surface: water\n  -> Osaka');
    expect(r.legs[0]!.d).toMatch(/Q/);
  });
  it('determinism: identical surface input → byte-identical legs (AC9)', () => {
    const src = 'map\nroute Tokyo surface: water\n  -> Osaka';
    expect(JSON.stringify(lay(src).legs)).toBe(JSON.stringify(lay(src).legs));
  });
  it('unsatisfiable water leg over land → smallest-deviation + diagnostic (AC7)', () => {
    // Tokyo→Osaka both sit inside the Japan land rect → no bow clears.
    const r = lay('map\nroute Tokyo surface: water\n  -> Osaka');
    expect(r.legs[0]!.d).toMatch(/Q/); // still drawn (closest arc)
    expect(
      r.diagnostics.some((d) => d.code === 'W_MAP_SURFACE_UNSATISFIED')
    ).toBe(true);
  });
  it('parallel surface edges fan out to distinct arcs (AC11/F12)', () => {
    const r = lay(
      'map\npoi Tokyo\npoi Osaka\nTokyo -> Osaka surface: water\nOsaka -> Tokyo surface: water'
    );
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0]!.d).toMatch(/Q/);
    expect(r.legs[1]!.d).toMatch(/Q/);
    expect(r.legs[0]!.d).not.toBe(r.legs[1]!.d);
  });
  it('albers-usa projection guard: surface skipped with a diagnostic (AC12/F7)', () => {
    const r = lay(
      'map\nprojection albers-usa\npoi 40 -100 as x\npoi 45 -110 as y\nx -> y surface: water'
    );
    expect(
      r.diagnostics.some(
        (d) =>
          d.code === 'W_MAP_SURFACE_UNSATISFIED' && /albers-usa/.test(d.message)
      )
    ).toBe(true);
    expect(r.legs).toHaveLength(1); // still drawn
  });
});

describe('layout — labels & legend (AC13, AC14, AC15, AC16, AC17)', () => {
  it('region labels off by default, on with full (AC13)', () => {
    expect(
      lay('map\nCalifornia value: 50').labels.some(
        (l) => l.text === 'California'
      )
    ).toBe(false);
    expect(
      lay('map\nregion-labels full\nCalifornia value: 50').labels.some(
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
    // A dense co-located cluster: more labels than the two inline sides can
    // hold, so at least one must escalate to a leader/pin.
    const src =
      'map\npoi 0 0 as alphaonelong\npoi 0 0 as bravotwolong\npoi 0 0 as charlie3long\npoi 0 0 as deltafourlong\npoi 0 0 as echofivelong\npoi 0 0 as foxtrot6long';
    const off = lay(`map\npoi-labels off\n${src.slice(4)}`);
    const all = lay(`map\npoi-labels all\n${src.slice(4)}`);
    expect(off.pois.map((p) => [p.cx, p.cy])).toEqual(
      all.pois.map((p) => [p.cx, p.cy])
    );
    // The colliding cluster escalated: at least one label gets a leader, or an
    // unplaceable label is dropped (fewer labels than POIs).
    expect(
      all.labels.some((l) => l.leader) || all.labels.length < all.pois.length
    ).toBe(true);
  });
  it('dense cluster labels EVERY POI in a leader-lined callout column', () => {
    const r = lay(
      'map\npoi-labels all\npoi 0 0 as alphaone\npoi 0 0 as bravotwo\npoi 0 0 as charlie3\npoi 0 0 as deltafour'
    );
    // No POI is dropped — all four keep a label.
    expect(r.labels).toHaveLength(4);
    // Each is called out with a leader tinted to its own dot colour.
    expect(
      r.labels.every((l) => l.leader && typeof l.leaderColor === 'string')
    ).toBe(true);
  });
  it('labels carry a halo flag (AC16)', () => {
    expect(lay('map\npoi Tokyo').labels.every((l) => l.halo)).toBe(true);
  });
  it('no-legend suppresses the legend model (AC17)', () => {
    expect(lay('map\nno-legend\nCalifornia value: 5').legend).toBeNull();
  });
});

describe('layout — relief (AC2, AC3, AC5, AC8, AC9)', () => {
  it('off by default → no relief shapes, no hatch (AC2)', () => {
    const r = lay('map');
    expect(r.relief).toHaveLength(0);
    expect(r.reliefHatch).toBeNull();
  });
  it('`relief` on → ≥1 shape with finite path + palette-mixed hatch (AC3, AC5)', () => {
    const r = lay('map\nrelief');
    expect(r.relief.length).toBeGreaterThan(0);
    expect(r.relief[0]!.d.length).toBeGreaterThan(0);
    expect(r.relief[0]!.d).not.toMatch(/NaN/);
    expect(r.reliefHatch).not.toBeNull();
    // Line colour is a palette-mixed hex (no hardcoded colour); spacing/width
    // are positive screen-space numbers.
    expect(r.reliefHatch!.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(r.reliefHatch!.spacing).toBeGreaterThan(0);
    expect(r.reliefHatch!.width).toBeGreaterThan(0);
  });
  it('absent asset → relief empty, no throw (AC6)', () => {
    const noAsset: MapData = { ...DATA };
    delete (noAsset as { mountainRanges?: unknown }).mountainRanges;
    const r = layoutMap(
      resolveMap(parseMap('map\nrelief'), noAsset),
      noAsset,
      { width: 800, height: 600 },
      { palette: P, isDark: false }
    );
    expect(r.relief).toHaveLength(0);
    expect(r.reliefHatch).toBeNull();
  });
  it('layout keeps ranges even over data regions (ADR-2 is a render clip)', () => {
    // Suppression is polygon-level at render (land-minus-data clip), NOT a
    // whole-range drop here — else a range crossing one valued state would
    // vanish over the un-valued land around it too. So the range stays emitted.
    expect(lay('map\nrelief').relief.length).toBeGreaterThan(0);
    expect(
      lay('map\nrelief\nUnited States value: 50').relief.length
    ).toBeGreaterThan(0);
  });
  it('a sub-min-area range is dropped (AC9 sliver gate)', () => {
    const tiny: MapData = {
      ...DATA,
      // Zero-width box → projected area 0, dropped regardless of map scale.
      mountainRanges: rectTopo('ranges', [
        { id: 'mtn-0', name: 'Speck', box: [10, 10, 10, 12] },
      ]),
    };
    const r = layoutMap(
      resolveMap(parseMap('map\nrelief'), tiny),
      tiny,
      { width: 800, height: 600 },
      { palette: P, isDark: false }
    );
    expect(r.relief).toHaveLength(0);
    expect(r.reliefHatch).toBeNull();
  });
  it('relief layout is deterministic (AC8)', () => {
    const src = 'map\nrelief';
    expect(JSON.stringify(lay(src))).toBe(JSON.stringify(lay(src)));
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
    const src = 'map\npoi Tokyo\nCalifornia value: 5';
    expect(JSON.stringify(lay(src))).toBe(JSON.stringify(lay(src)));
  });
});
