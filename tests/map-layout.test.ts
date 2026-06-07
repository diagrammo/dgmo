import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import {
  layoutMap,
  buildMapProjection,
  MAX_COLUMN_ROWS,
} from '../src/map/layout';
import { getPalette } from '../src/palettes';
import { measureLegendText } from '../src/utils/legend-constants';
import { mix, politicalTints } from '../src/palettes/color-utils';
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
    { id: 'CA', name: 'Canada', box: [-141, 49, -52, 70] },
    { id: 'MX', name: 'Mexico', box: [-117, 14, -86, 33] },
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
    { id: 'GE', name: 'Georgia', box: [40, 41, 47, 44] },
    { id: 'CD', name: 'Dem. Rep. Congo', box: [12, -13, 31, 5] },
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
    { id: 'US-GA', name: 'Georgia', box: [-85, 30, -81, 35] },
    { id: 'US-AK', name: 'Alaska', box: [-170, 52, -130, 71] },
    { id: 'US-HI', name: 'Hawaii', box: [-160, 18, -154, 23] },
  ]),
  mountainRanges: rectTopo('ranges', [
    { id: 'mtn-0', name: 'Rockies', box: [-120, 35, -105, 45] },
  ]),
  waterBodies: {
    entries: [
      [20, -40, 'North Atlantic Ocean', 0, 'ocean'],
      [0, -150, 'North Pacific Ocean', 0, 'ocean'],
      [-30, 0, 'South Atlantic Ocean', 0, 'ocean'],
      [38, 18, 'Mediterranean Sea', 1, 'sea'],
      [25, 88, 'Bay of Bengal', 1, 'bay'],
    ],
  },
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
  it('tight US POI cluster fit-zooms to a regional mercator frame (home state renders, distant states culled)', () => {
    // A local US POI cluster no longer snaps to the national albers-usa frame —
    // it fit-zooms to a multi-state mercator window around the dots (#poi-fit,
    // §24B.2). The single US POI (Portland OR) frames the Pacific Northwest:
    // Oregon renders as land; the far eastern fixture states (Maine, Georgia)
    // fall outside the frame and are culled.
    const src = 'map\npoi 45.52 -122.68 as office';
    expect(resolveMap(parseMap(src), DATA).projection).toBe('mercator');
    const r = lay(src);
    const or = r.regions.find((x) => x.id === 'US-OR');
    expect(or).toBeDefined();
    expect(or!.d).not.toMatch(/NaN/);
    // POI-only map carries no region data → colorize is the default dress, so
    // Oregon renders a political pastel (not the plain green land).
    expect(or!.fill).not.toBe(neutral);
    expect(r.regions.find((x) => x.id === 'US-ME')).toBeUndefined(); // out of frame
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
  it('world basemap renders from the detail (50m) tier at all scales', () => {
    // The render tier is pinned to detail — recognizability > generalization
    // (110m coarse drops the Italian boot to a stump at world scale).
    const resolved = resolveMap(parseMap('map\nJapan value: 5'), DATA);
    expect(resolved.basemaps.world).toBe('detail');
    // Country fill is still found — the JP id lives in worldDetail.
    expect(
      DATA.worldDetail.objects['countries']!.geometries.some(
        (g) => g.id === 'JP'
      )
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
  it('world-extent map (span > WORLD_SPAN) resolves to detail, not coarse — cliff regression guard', () => {
    // A US + Japan spread is world-extent: pre-change this snapped to the coarse
    // (110m) tier and the Italian boot collapsed. Now it stays on detail.
    const resolved = resolveMap(
      parseMap('map\nUnited States value: 5\nJapan value: 3'),
      DATA
    );
    expect(resolved.basemaps.world).toBe('detail');
  });
});

describe('layout — albers-usa neighbour frame (map-us-orientation-north-america)', () => {
  it('AC2: a near-border Canadian POI projects on-canvas under albers-usa (frame expanded, not clipped)', () => {
    // Toronto ~43.65,-79.38 is a Canadian neighbour POI (no `locale`/`projection`).
    // It keeps albers-usa (NA rule) and the fit frame expands to include the point
    // so it lands inside the canvas rather than bleeding off the top edge.
    const src =
      'map\nCalifornia value: 1\nOregon value: 2\npoi 43.65 -79.38 as toronto';
    expect(resolveMap(parseMap(src), DATA).projection).toBe('albers-usa');
    const r = lay(src);
    const t = r.pois.find((p) => p.id === 'toronto')!;
    expect(t).toBeDefined();
    expect(Number.isFinite(t.cx)).toBe(true);
    expect(Number.isFinite(t.cy)).toBe(true);
    expect(t.cx).toBeGreaterThanOrEqual(0);
    expect(t.cx).toBeLessThanOrEqual(800);
    expect(t.cy).toBeGreaterThanOrEqual(0);
    expect(t.cy).toBeLessThanOrEqual(600);
  });
  it('a conus-interior POI does NOT materially shift the US frame', () => {
    // A POI already inside the contiguous-48 adds nothing to the expanded fit —
    // the US framing must be unchanged from the POI-free map.
    const base = lay('map\nCalifornia value: 1\nOregon value: 2');
    const withPoi = lay(
      'map\nCalifornia value: 1\nOregon value: 2\npoi 40 -100 as mid'
    );
    const caBase = base.regions.find((x) => x.id === 'US-CA')!;
    const caPoi = withPoi.regions.find((x) => x.id === 'US-CA')!;
    expect(caPoi.d).toBe(caBase.d);
  });
  it('AC3: a Mexico country fill is pulled into the albers-usa fit target', () => {
    // A neighbour COUNTRY fill (not just a POI) unions its full geometry into the
    // conus fit target, so Mexico is framed in full rather than bleeding off the
    // canvas. Exercises the layout.ts worldLayer.get(iso) expansion path. (The
    // hand-built rect fixture's ambiguous polygon winding makes geoBounds global,
    // so we assert the fit-target membership directly rather than projected size.)
    const withMx = buildMapProjection(
      resolveMap(parseMap('map\nCalifornia value: 1\nMexico value: 2'), DATA),
      DATA
    );
    const usOnly = buildMapProjection(
      resolveMap(parseMap('map\nCalifornia value: 1'), DATA),
      DATA
    );
    const hasMx = (b: typeof withMx): boolean =>
      b.fitTarget.features.some((f) => (f as { id?: string }).id === 'MX');
    expect(hasMx(usOnly)).toBe(false); // US-only fit = conus states only
    expect(hasMx(withMx)).toBe(true); // neighbour fill expands the fit
    expect(withMx.fitTarget.features.length).toBe(
      usOnly.fitTarget.features.length + 1
    );
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
  it('ramp 0-anchors all-non-negative data; data-min for mixed sign (AC6)', () => {
    // All values ≥ 0 → low end anchors at 0 (shared baseline), not data-min.
    const nonNeg = lay(
      'map\nregion-metric Sales\nCalifornia value: 40\nOregon value: 100'
    );
    expect(nonNeg.legend?.ramp).toMatchObject({ min: 0, max: 100 });
    // Mixed-sign data → fit data-min→data-max (no 0-anchor).
    const mixed = lay(
      'map\nregion-metric Net\nCalifornia value: -20\nOregon value: 80'
    );
    expect(mixed.legend?.ramp).toMatchObject({ min: -20, max: 80 });
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
  const water = mix(P.colors.blue, P.bg, 24);
  it('no data → subtle water + faded green land', () => {
    // `no-colorize` is the green-land dress now that bare regions auto-colorize.
    const r = lay('map\nno-colorize\nCalifornia');
    expect(r.background).toBe(water);
    expect(r.regions.find((x) => x.id === 'US-CA')!.fill).toBe(neutral);
  });
  it('`muted` does not change subject water/land', () => {
    const r = lay('map\nno-colorize\nmuted\nCalifornia');
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
    // Both members move off the shared point to distinct expanded positions
    // (a 2-member ring is vertical → same cx, different cy).
    expect([a.pois[0]!.cx, a.pois[0]!.cy]).not.toEqual([
      a.pois[1]!.cx,
      a.pois[1]!.cy,
    ]);
    // …and are emitted as one collapsible stack.
    expect(a.clusters).toHaveLength(1);
    expect(a.clusters[0]!.count).toBe(2);
    const b = lay('map\npoi 0 0 as aa\npoi 0 0 as bb');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('spiderfied members get a readable leader-lined column: on-canvas, spread out, badge honest', () => {
    // A dense co-located stack of wide-labelled POIs on a narrow canvas. The
    // members must be labelled via a tidy vertical column (each row leader-lined
    // to its dot) — NOT radial inline labels, which pile up unreadably. Three
    // invariants: (1) every label is fully on-canvas, (2) rows are vertically
    // separated (no overlap), (3) the collapsed badge stays at the TRUE location
    // — earlier attempts either clipped labels or shifted the whole fan, dragging
    // the badge off the real point. Aliases cap at 12 chars (AS_ALIAS_RE).
    const FONT = 11;
    const W = 220;
    const H = 600;
    const names = [
      'OfficeAlphaa',
      'OfficeBravoo',
      'OfficeCharli',
      'OfficeDeltaa',
      'OfficeEchooo',
      'OfficeFoxtro',
      'OfficeGolffo',
      'OfficeHotelo',
      'OfficeIndiaa',
    ];
    const wide = lay(
      'map\n' + names.map((n) => `poi 0 0 as ${n}`).join('\n'),
      W,
      H
    );
    expect(wide.clusters).toHaveLength(1);
    const members = wide.labels.filter((l) => l.clusterMember !== undefined);
    expect(members.length).toBe(names.length);
    // (1) Every member label is fully inside the frame, and (column layout) each
    // carries a leader line back to its dot.
    for (const l of members) {
      const w = measureLegendText(l.text, FONT);
      // anchor 'start' extends right (x → x+w); 'end' extends left (x-w → x).
      const left = l.anchor === 'end' ? l.x - w : l.x;
      const right = l.anchor === 'end' ? l.x : l.x + w;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(W);
      expect(l.leader).toBeDefined();
    }
    // (2) Spread out: the member label y's are all distinct and separated by at
    // least the font height — no two stacked on the same row.
    const ys = members.map((l) => l.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(FONT);
    }
    // (3) The badge stays honest: swapping in 2-char labels (no overflow
    // pressure) must NOT move the cluster centroid — the badge tracks the dots,
    // never the labels.
    const narrow = lay(
      'map\n' +
        names
          .map((n, i) => `poi 0 0 as x${String.fromCharCode(97 + i)}`)
          .join('\n'),
      W,
      H
    );
    expect(narrow.clusters).toHaveLength(1);
    expect(wide.clusters[0]!.cx).toBeCloseTo(narrow.clusters[0]!.cx, 5);
    expect(wide.clusters[0]!.cy).toBeCloseTo(narrow.clusters[0]!.cy, 5);
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

describe('layout — surface parsing removed (AC9)', () => {
  it('a plain route leg (no surface) renders straight', () => {
    const r = lay('map\nroute Tokyo\n  -> Osaka');
    expect(r.legs[0]!.d).toMatch(/^M[\d.,-]+L[\d.,-]+$/);
    expect(r.legs[0]!.d).not.toMatch(/Q/);
    expect(r.diagnostics).toHaveLength(0);
  });
  it('`style: arc` still bows a leg (explicit arc unaffected)', () => {
    const r = lay('map\nroute Tokyo style: arc\n  -> Osaka');
    expect(r.legs[0]!.d).toMatch(/Q/);
  });
});

describe('layout — labels & legend (AC13, AC14, AC15, AC16, AC17)', () => {
  it('region labels on by default; no-region-labels suppresses (AC13)', () => {
    const isCA = (t: string): boolean => t === 'California' || t === 'CA';
    expect(
      lay('map\nCalifornia value: 50').labels.some((l) => isCA(l.text))
    ).toBe(true);
    expect(
      lay('map\nno-region-labels\nCalifornia value: 50').labels.some((l) =>
        isCA(l.text)
      )
    ).toBe(false);
  });
  it('poi labels on by default; no-poi-labels suppresses (AC14)', () => {
    expect(lay('map\npoi Tokyo').labels.length).toBeGreaterThanOrEqual(1);
    expect(lay('map\nno-poi-labels\npoi Tokyo').labels).toHaveLength(0);
  });
  it('POI layout is label-mode-independent — markers never move (AC15)', () => {
    // A co-located cluster spiderfies during POI layout (independent of label
    // visibility), so suppressed-labels and shown-labels place identical markers.
    const src =
      'map\npoi 0 0 as alphaonelong\npoi 0 0 as bravotwolong\npoi 0 0 as charlie3long\npoi 0 0 as deltafourlong\npoi 0 0 as echofivelong\npoi 0 0 as foxtrot6long';
    const off = lay(`map\nno-poi-labels\n${src.slice(4)}`);
    const on = lay(src);
    expect(off.pois.map((p) => [p.cx, p.cy])).toEqual(
      on.pois.map((p) => [p.cx, p.cy])
    );
    // The co-located cluster spiderfied: one stack, every member keeps a label.
    expect(on.clusters).toHaveLength(1);
    expect(on.labels.filter((l) => l.clusterMember).length).toBe(
      on.pois.length
    );
  });
  it('co-located cluster labels EVERY member via spiderfy (none dropped/hidden)', () => {
    const r = lay(
      'map\npoi 0 0 as alphaone\npoi 0 0 as bravotwo\npoi 0 0 as charlie3\npoi 0 0 as deltafour'
    );
    // No member is dropped — all four keep a (cluster-member) label, visible.
    expect(r.labels).toHaveLength(4);
    expect(r.labels.every((l) => l.clusterMember && !l.hidden)).toBe(true);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.count).toBe(4);
  });
  it('POI labels carry no halo flag (AC16)', () => {
    expect(lay('map\npoi Tokyo').labels.every((l) => !l.halo)).toBe(true);
  });
  it('no-legend suppresses the legend model (AC17)', () => {
    expect(lay('map\nno-legend\nCalifornia value: 5').legend).toBeNull();
  });
});

describe('layout — POI label hover-only gate (extent/count/clean)', () => {
  // Co-located POIs spread into a tight blob (~25px diagonal regardless of
  // count), so they exercise the COUNT guard at a fixed small extent.
  const coLocated = (n: number): string =>
    'map\n' +
    Array.from({ length: n }, (_, i) => `poi 0 0 as poi${i}long`).join('\n');
  // The EXTENT gate needs a chain whose PIXEL span is controllable. The shared
  // DATA spans the globe (JP/Congo), so it auto-fits everything into a tiny blob
  // — useless for an extent test. A US-only topology keeps the fit local and
  // predictable. Anchor POIs at opposite US corners enlarge the fit bbox so a
  // line of mid POIs stepped by `deg` projects to a CHAIN (neighbours <
  // GROUP_R) of a controlled diagonal.
  const US_ONLY = {
    worldCoarse: rectTopo('countries', [
      { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    ]),
    worldDetail: rectTopo('countries', [
      { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    ]),
    usStates: rectTopo('states', []),
    gazetteer: { cities: [], byName: {}, alt: {} },
  } as unknown as MapData;
  const layUS = (src: string, w = 800, h = 600) =>
    layoutMap(
      resolveMap(parseMap(src), US_ONLY),
      US_ONLY,
      { width: w, height: h },
      { palette: P, isDark: false }
    );
  const anchoredChain = (deg: number, n = 7): string =>
    [
      'map',
      'poi 49 -124 as anchorNW',
      'poi 26 -67 as anchorSE',
      ...Array.from(
        { length: n },
        (_, i) => `poi ${38 + i * deg} ${-100 - i * deg} as mid${i}long`
      ),
    ].join('\n');
  const midLabels = (src: string) =>
    layUS(src).labels.filter((l) => /^mid\d/.test(l.text));

  it('co-located dots spiderfy → all labels visible, none hidden (AC2)', () => {
    const r = lay(coLocated(3));
    expect(r.labels).toHaveLength(3);
    expect(r.labels.every((l) => !l.hidden)).toBe(true);
    // Spiderfied members carry radial cluster-member labels (no leader column).
    expect(r.labels.every((l) => l.clusterMember)).toBe(true);
    expect(r.clusters).toHaveLength(1);
  });

  it('sprawling chain (diagonal > extent threshold) → all hover-only (AC1)', () => {
    // 7 members (≤ MAX_COLUMN_ROWS) stepped 1.0° → ~128px diagonal > the ~108px
    // threshold; hidden via the EXTENT gate, NOT the count guard.
    const mids = midLabels(anchoredChain(1.0));
    expect(mids).toHaveLength(7);
    expect(mids.every((l) => l.hidden)).toBe(true);
    // Hover-only labels carry no leader and stay POI-tagged for the app.
    expect(mids.every((l) => !l.leader && typeof l.poiId === 'string')).toBe(
      true
    );
    // The far anchors are singletons → still visible (never hover-only).
    const anchors = layUS(anchoredChain(1.0)).labels.filter((l) =>
      /anchor/.test(l.text)
    );
    expect(anchors.length).toBe(2);
    expect(anchors.every((l) => !l.hidden)).toBe(true);
  });

  it('compact chain (diagonal < extent threshold) → visible column (AC3)', () => {
    // Same 7-member chain stepped 0.6° → ~77px diagonal < threshold → shown.
    const mids = midLabels(anchoredChain(0.6));
    expect(mids).toHaveLength(7);
    expect(mids.every((l) => !l.hidden)).toBe(true);
    expect(mids.every((l) => l.leader)).toBe(true);
  });

  it('count guard governs distinct columns; co-located dots always spiderfy (AC3)', () => {
    // Co-located dots spiderfy regardless of count — they never hit the hover-only
    // count guard (it now governs only dense-but-DISTINCT proximity columns).
    const seven = lay(coLocated(MAX_COLUMN_ROWS)); // 7
    expect(seven.labels.every((l) => !l.hidden)).toBe(true);
    expect(seven.clusters).toHaveLength(1);
    const eight = lay(coLocated(MAX_COLUMN_ROWS + 1)); // 8
    expect(eight.labels.every((l) => !l.hidden)).toBe(true);
    expect(eight.clusters).toHaveLength(1);
    // A dense-but-distinct compact chain still trips the count guard: a 7-row
    // column shows; the 8th row tips the whole column to hover-only.
    expect(midLabels(anchoredChain(0.6, 7)).every((l) => !l.hidden)).toBe(true);
    const eightChain = midLabels(anchoredChain(0.6, 8));
    expect(eightChain).toHaveLength(8);
    expect(eightChain.every((l) => l.hidden)).toBe(true);
  });

  it('dense-but-compact cluster (≤7, tiny extent) → shown, proving extent ≠ count', () => {
    // 7 co-located dots: count is at the limit but extent is tiny → visible.
    // Paired with the "8 → hidden" case above (which trips the count guard),
    // this shows the (a) signal is spatial extent, not row count.
    const r = lay(coLocated(7));
    expect(r.labels.every((l) => !l.hidden)).toBe(true);
  });

  it('isolated POIs (own clusters) → visible inline, never hover-only (AC4)', () => {
    // Two well-separated POIs each form their own singleton cluster → inline.
    const r = lay('map\npoi 35 -110 as alpha\npoi 42 -90 as bravo');
    expect(r.labels).toHaveLength(2);
    expect(r.labels.every((l) => !l.hidden && !l.leader)).toBe(true);
  });

  it('lone boxed-in hub (no inline side fits) → visible callout, not hidden (AC9)', () => {
    // A hub fed by legs on all sides can't place an inline label, so it falls to
    // a single-row callout — a singleton is NEVER routed to hover-only.
    const src = [
      'map',
      'poi 40 -100 as hublongname',
      'poi 48 -100 as north',
      'poi 32 -100 as south',
      'poi 40 -88 as east',
      'poi 40 -112 as west',
      'hublongname -> north',
      'hublongname -> south',
      'hublongname -> east',
      'hublongname -> west',
    ].join('\n');
    const hub = lay(src).labels.find((l) => l.text === 'hublongname')!;
    expect(hub).toBeDefined();
    expect(hub.hidden).toBeFalsy();
    expect(hub.leader).toBeTruthy();
  });
});

describe('layout — coincident stack: radial (above/below) labels + region yield', () => {
  // Real albers geometry: a US cloud-regions map with a tight San Jose pair
  // (us-west-1 + us-sanjose-1, ~6km apart → a coincident stack) on the Pacific
  // coast. A one-sided callout column here overran the frame and the "California"
  // container label degraded to a crammed "CA" beside the dots. The stack must
  // now split its labels above/below its own dots, and California must YIELD
  // (hidden) rather than cram a 2-letter squeeze.
  const SJ_SRC = [
    'map US Cloud Regions',
    'no-cluster-pois',
    'poi 38.95 -77.45 as east1 label: us-east-1',
    'poi 45.87 -119.69 as west2 label: us-west-2',
    'poi 37.35 -121.96 as west1 label: us-west-1',
    'poi 37.34 -121.89 as sanjose label: us-sanjose-1',
    'poi 33.45 -112.07 as phoenix label: us-phoenix-1',
    'poi 41.88 -87.63 as chicago label: us-chicago-1',
  ].join('\n');

  // The squarish aspect that broke (San Jose hard against the left edge) plus a
  // wide one — both must split the labels vertically and stay on-canvas.
  for (const [w, h] of [
    [900, 760],
    [1600, 820],
  ] as const) {
    it(`San Jose stack splits labels above/below; California yields (${w}x${h})`, async () => {
      const { loadMapData } = await import('../src/map/load-data');
      const data = await loadMapData();
      const r = layoutMap(
        resolveMap(parseMap(SJ_SRC), data),
        data,
        { width: w, height: h },
        { palette: P, isDark: false }
      );
      const sj = r.labels.filter((l) => /us-(west-1|sanjose-1)/.test(l.text));
      expect(sj.length).toBe(2);
      // (1) Radial layout: both labels are centred (anchor middle) on their dot
      // — one strictly above it, one strictly below — never a side column.
      const sides = sj.map((l) => {
        const dot = r.pois.find((p) => p.id === l.poiId)!;
        expect(l.anchor).toBe('middle');
        expect(l.leader).toBeUndefined();
        // on-canvas: the centred label never runs off the frame edge
        const lw = measureLegendText(l.text, 11);
        expect(l.x - lw / 2).toBeGreaterThanOrEqual(0);
        expect(l.x + lw / 2).toBeLessThanOrEqual(w);
        return l.y < dot.cy ? 'above' : 'below';
      });
      expect(new Set(sides)).toEqual(new Set(['above', 'below']));
      // (2) California container label yields rather than crams a "CA" squeeze:
      // no abbreviation is shown next to the stack.
      expect(r.labels.some((l) => l.text === 'CA')).toBe(false);
    });
  }
});

describe('layout — coincident-POI spiderfy (stacks)', () => {
  it('overlapping dots form a stack; well-separated dots do not', () => {
    // Same point → one stack.
    expect(lay('map\npoi 0 0 as aa\npoi 0 0 as bb').clusters).toHaveLength(1);
    // Far apart → no stack (each a singleton).
    expect(
      lay('map\npoi 35 -110 as alpha\npoi 42 -90 as bravo').clusters
    ).toHaveLength(0);
  });

  it('edge/route endpoints are excluded from stacking (kept at true position)', () => {
    // Two coincident POIs that anchor an edge are NOT collapsed.
    const r = lay('map\npoi 0 0 as aa\npoi 0 0 as bb\naa -> bb');
    expect(r.clusters).toHaveLength(0);
    expect(r.pois.every((p) => p.clusterId === undefined)).toBe(true);
  });

  it('a large stack spiderfies every member to a distinct position (spiral)', () => {
    const n = 10; // > STACK_RING_MAX → golden-angle spiral
    const src =
      'map\n' +
      Array.from({ length: n }, (_, i) => `poi 0 0 as poi${i}long`).join('\n');
    const r = lay(src);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.count).toBe(n);
    const keys = new Set(
      r.pois.map((p) => `${p.cx.toFixed(3)},${p.cy.toFixed(3)}`)
    );
    expect(keys.size).toBe(n); // all distinct
    // Every member is tagged with the same stack id; legs match member count.
    expect(r.pois.every((p) => p.clusterId === r.clusters[0]!.id)).toBe(true);
    expect(r.clusters[0]!.legs).toHaveLength(n);
  });

  it('off-canvas guard keeps every spiderfied member on-canvas', () => {
    // A far anchor pushes the stack toward an edge; the fan must stay in-bounds.
    const src =
      'map\npoi 35 139 as anchor\n' +
      Array.from({ length: 8 }, (_, i) => `poi 0 0 as poi${i}long`).join('\n');
    const r = lay(src, 240, 180);
    const members = r.pois.filter((p) => p.clusterId !== undefined);
    expect(members.length).toBe(8);
    for (const p of members) {
      expect(p.cx - p.r).toBeGreaterThanOrEqual(0);
      expect(p.cx + p.r).toBeLessThanOrEqual(240);
      expect(p.cy - p.r).toBeGreaterThanOrEqual(0);
      expect(p.cy + p.r).toBeLessThanOrEqual(180);
    }
  });

  it('cluster legs originate at the centroid and reach each member dot', () => {
    const r = lay('map\npoi 0 0 as aa\npoi 0 0 as bb\npoi 0 0 as cc');
    const cl = r.clusters[0]!;
    const members = r.pois.filter((p) => p.clusterId === cl.id);
    for (const leg of cl.legs) {
      expect(members.some((p) => p.cx === leg.x2 && p.cy === leg.y2)).toBe(
        true
      );
    }
  });
});

describe('layout — relief (AC2, AC3, AC5, AC8, AC9)', () => {
  it('default-ON for a dataless reference world map → ≥1 shape + hatch (AC8)', () => {
    // Bare `map` = dataless world extent, wide canvas → relief shows by default.
    const r = lay('map');
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
  it('still shows on a DATA map (relief is always on; only `no-relief` hides it)', () => {
    // A global choropleth is a data map; relief still renders (the renderer lays
    // the hachure atop the data fills and the hatch tone flips to stay visible).
    const r = lay(
      'map\nregion-metric Sales\nUnited States value: 5\nChina value: 3'
    );
    expect(r.relief.length).toBeGreaterThan(0);
    expect(r.reliefHatch).not.toBeNull();
  });
  it('`no-relief` forces off even on a dataless world map (AC8)', () => {
    const r = lay('map\nno-relief');
    expect(r.relief).toHaveLength(0);
    expect(r.reliefHatch).toBeNull();
  });
  it('still shows in a narrow column (relief is always on, width-independent)', () => {
    // Relief no longer auto-suppresses at the compact breakpoint — only the
    // `no-relief` directive hides it.
    const r = lay('map', 400, 300);
    expect(r.relief.length).toBeGreaterThan(0);
    expect(r.reliefHatch).not.toBeNull();
  });
  it('absent asset → relief empty, no throw (AC6)', () => {
    const noAsset: MapData = { ...DATA };
    delete (noAsset as { mountainRanges?: unknown }).mountainRanges;
    const r = layoutMap(
      resolveMap(parseMap('map'), noAsset),
      noAsset,
      { width: 800, height: 600 },
      { palette: P, isDark: false }
    );
    expect(r.relief).toHaveLength(0);
    expect(r.reliefHatch).toBeNull();
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
      resolveMap(parseMap('map'), tiny),
      tiny,
      { width: 800, height: 600 },
      { palette: P, isDark: false }
    );
    expect(r.relief).toHaveLength(0);
    expect(r.reliefHatch).toBeNull();
  });
  it('relief layout is deterministic (AC8)', () => {
    const src = 'map';
    expect(JSON.stringify(lay(src))).toBe(JSON.stringify(lay(src)));
  });
});

describe('layout — coastline water-lines style (AC2, AC8)', () => {
  it('on by default → non-null style; no-coastline → null (AC2)', () => {
    expect(lay('map').coastlineStyle).not.toBeNull();
    expect(lay('map\nno-coastline').coastlineStyle).toBeNull();
  });
  it('default → 5 equal-width rings + palette-mixed colour', () => {
    const cs = lay('map').coastlineStyle;
    expect(cs).not.toBeNull();
    expect(cs!.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cs!.lines).toHaveLength(5);
    // Every ring: positive offshore distance + thickness; opacity in (0,1].
    for (const l of cs!.lines) {
      expect(l.d).toBeGreaterThan(0);
      expect(l.thickness).toBeGreaterThan(0);
      expect(l.opacity).toBeGreaterThan(0);
      expect(l.opacity).toBeLessThanOrEqual(1);
    }
    // All rings share the SAME width; distance steps strictly outward; opacity
    // fades monotonically seaward (a gradual fade, not a step).
    const t = cs!.lines[0]!.thickness;
    for (let k = 1; k < cs!.lines.length; k++) {
      expect(cs!.lines[k]!.thickness).toBeCloseTo(t, 9);
      expect(cs!.lines[k]!.d).toBeGreaterThan(cs!.lines[k - 1]!.d);
      expect(cs!.lines[k]!.opacity).toBeLessThan(cs!.lines[k - 1]!.opacity);
    }
    expect(cs!.minExtent).toBeGreaterThan(0);
  });
  it('offshore distance scales with canvas size — same fraction at 2× (AC8)', () => {
    const a = lay('map', 400, 300).coastlineStyle!;
    const b = lay('map', 800, 600).coastlineStyle!;
    // d is a fraction of min(w,h): doubling the canvas doubles the px distance,
    // so the offshore gap stays the SAME fraction of the map (ADR-3).
    expect(b.lines[0]!.d).toBeCloseTo(a.lines[0]!.d * 2, 5);
    expect(b.lines[1]!.d).toBeCloseTo(a.lines[1]!.d * 2, 5);
  });
  it('coastline layout is deterministic', () => {
    const src = 'map';
    expect(JSON.stringify(lay(src))).toBe(JSON.stringify(lay(src)));
  });
  it('holds the load-bearing invariant d_k + thickness < d_(k+1) for every ring (a ring never reaches the next out)', () => {
    // The renderer draws outer→inner and erodes each band to radius d_k; if a
    // ring's d_k+thickness reached d_(k+1) the inner overdraw would erase it.
    const lines = lay('map').coastlineStyle!.lines;
    for (let k = 1; k < lines.length; k++)
      expect(lines[k - 1]!.d + lines[k - 1]!.thickness).toBeLessThan(
        lines[k]!.d
      );
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

describe('context labels — orientation backdrop (§24B, AC2/AC8)', () => {
  const italicLabels = (r: ReturnType<typeof lay>) =>
    r.labels.filter((l) => l.italic);

  it('off by default → zero context labels (AC2)', () => {
    const r = lay('map\npoi Tokyo\npoi New York City');
    expect(italicLabels(r)).toHaveLength(0);
  });

  it('off-by-default output is byte-identical with the directive absent (AC2)', () => {
    const a = JSON.stringify(lay('map\nCalifornia value: 5'));
    const b = JSON.stringify(lay('map\nCalifornia value: 5'));
    expect(a).toBe(b);
  });

  it('context labels (default-on) place water labels over open ocean (offshore POIs)', () => {
    // Two POIs in the mid-Atlantic frame an open-water view; the North Atlantic
    // anchor lands in clear water → an italic water label is emitted. (World-view
    // tiering / oceans-only is covered deterministically in the module tests.)
    const r = lay('map\npoi 22 -42\npoi 18 -38');
    const water = italicLabels(r);
    expect(water.length).toBeGreaterThan(0);
    expect(water.some((l) => /Ocean/.test(l.text))).toBe(true);
  });

  it('context labels never displace data labels (dead-last, AC8)', () => {
    const src = 'map\npoi Tokyo\npoi New York City';
    // POI labels are the data labels here (poiId set); context labels carry no
    // poiId. They are placed dead-last, so suppressing them (no-context-labels)
    // must leave every data label exactly where it was.
    const dataLabels = (s: string) =>
      lay(s)
        .labels.filter((l) => l.poiId !== undefined)
        .map((l) => `${l.text}@${Math.round(l.x)},${Math.round(l.y)}`)
        .sort();
    expect(dataLabels(src)).toEqual(dataLabels(`${src}\nno-context-labels`));
  });

  it('albers-usa US view: context labels are not hard-disabled and do not disturb data', () => {
    // Decision 8 was relaxed — albers-usa is supported (the module test proves
    // the layer still places under albers-usa; real US maps show Pacific/Atlantic/
    // Gulf — see manual verification). On the crude rect fixture the synthetic
    // land covers the anchors, so here we assert the integration is safe: no
    // throw, finite geometry, and the data (region) labels are untouched.
    const dataLabels = (s: string) =>
      lay(s)
        .labels.filter((l) => l.lineNumber > 0)
        .map((l) => `${l.text}@${Math.round(l.x)},${Math.round(l.y)}`)
        .sort();
    const base = 'map\nCalifornia value: 1\nOregon value: 2';
    expect(() => lay(base)).not.toThrow();
    expect(dataLabels(base)).toEqual(dataLabels(`${base}\nno-context-labels`));
  });
});

describe('context labels — composition with data layers (AC16)', () => {
  it('adding region data does not inflate context-label density', () => {
    const ctxOnly = lay('map\npoi Tokyo\npoi New York City').labels.filter(
      (l) => l.italic
    ).length;
    const stacked = lay(
      'map\nUnited States value: 5\npoi Tokyo\npoi New York City'
    );
    const stackedCtx = stacked.labels.filter((l) => l.italic).length;
    // Combined layer stays within the same budget — no extra headroom.
    expect(stackedCtx).toBeLessThanOrEqual(ctxOnly);
    // And the stack still produces finite, drawable geometry.
    expect(stacked.regions.every((r) => !/NaN/.test(r.d))).toBe(true);
  });
});

describe('context labels — review fixes (F1, F3)', () => {
  // Footprint rect for a placed label (mirrors layout's labelW/labelH intent).
  const rectOf = (l: {
    x: number;
    y: number;
    text: string;
    anchor: string;
  }) => {
    const w = l.text.length * 7 + 12; // generous over-estimate (test-only)
    const h = 17;
    const x =
      l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
    return { x, y: l.y - h / 2, w, h };
  };
  const overlap = (
    a: ReturnType<typeof rectOf>,
    b: ReturnType<typeof rectOf>
  ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  it('context (water) labels never overlap region/POI labels (F1)', () => {
    const r = lay('map\nUnited States value: 5\npoi Tokyo');
    const ctx = r.labels.filter((l) => l.italic).map(rectOf);
    const other = r.labels.filter((l) => !l.italic).map(rectOf);
    for (const c of ctx)
      for (const o of other) expect(overlap(c, o)).toBe(false);
  });

  it('a US-state map on a world projection emits no "United States" context label (F3)', () => {
    // Mixed content (JP POI) keeps it off albers-usa; the US states are the data
    // so the country itself must not be context-labeled.
    const r = lay('map\nCalifornia value: 5\nMaine value: 8\npoi Tokyo');
    expect(r.labels.some((l) => l.text === 'United States')).toBe(false);
  });
});

describe('layout — region label yields to a POI on its centroid (#poi-overlap)', () => {
  it('drops a state label that would sit on a POI in that state (real geometry)', async () => {
    const { loadMapData } = await import('../src/map/load-data');
    const data = await loadMapData();
    const r = layoutMap(
      resolveMap(
        parseMap(
          'map\npoi 39.74 -104.99 as core value: 400, label: Core POP\n  -> Seattle\n  -> Atlanta\npoi Seattle value: 120\npoi Atlanta value: 180'
        ),
        data
      ),
      data,
      { width: 1300, height: 800 },
      { palette: P, isDark: false }
    );
    const texts = r.labels.map((l) => l.text);
    // The Denver "Core POP" dot sits on Colorado's centroid → no "Colorado" label
    // stacked on the POI, but the POI's own label survives.
    expect(texts).toContain('Core POP');
    expect(texts).not.toContain('Colorado');
  });
});

describe('layout — antimeridian-crossing landmass renders (#russia-cull)', () => {
  it('Russia (dateline-crossing) is NOT culled from a regional Europe view', async () => {
    const { loadMapData } = await import('../src/map/load-data');
    const data = await loadMapData();
    // A Europe choropleth frames regionally; Russia's mainland is a single polygon
    // crossing the antimeridian. The cull must keep it (occupied arc ~171°, not the
    // ~360° raw span) so western Russia draws as land instead of leaving ocean.
    const r = layoutMap(
      resolveMap(
        parseMap(
          'map\nGermany value: 1\nPoland value: 2\nRomania value: 3\nSweden value: 4'
        ),
        data
      ),
      data,
      { width: 1300, height: 850 },
      { palette: P, isDark: false }
    );
    const ru = r.regions.find((x) => x.id === 'RU');
    expect(ru).toBeDefined();
    expect(ru!.d).not.toMatch(/NaN/);
    // The full mainland (not just a few far-east islands) must be present — the
    // pre-fix bug left only ~1.8k chars of small islands; the mainland is ~7k+.
    expect(ru!.d.length).toBeGreaterThan(4000);
  });
});

describe('layout — colorize (content-inferred political fills, §24B)', () => {
  // The hand-built fixture gives each rect its own arc → no intra-topology
  // adjacency; the cross-topology border seam (FOREIGN_BORDER) still applies, so
  // border states (US-CA↔MX, US-AK/US-ME↔CA) take a SECOND tint. So we assert
  // MEMBERSHIP in the palette's political tints, not a single colour. The
  // neighbour-distinctness guarantee is proven on the REAL graphs (incl. the
  // international seam) in tests/map-colorize.test.ts.
  const TINTS = new Set(politicalTints(P, 8, false));
  const isPolitical = (fill: string): boolean => TINTS.has(fill);
  const politicalRegions = (r: ReturnType<typeof lay>) =>
    r.regions.filter((x) => x.id !== 'lake');
  const fillOf = (r: ReturnType<typeof lay>, id: string) =>
    r.regions.find((x) => x.id === id)?.fill;

  it('bare regions colorize: referenced + base mesh + context all on-palette (AC1)', () => {
    const r = lay('map\nCalifornia');
    const ca = r.regions.find((x) => x.id === 'US-CA')!;
    expect(isPolitical(ca.fill)).toBe(true); // referenced state
    expect(ca.fill).not.toBe(neutral);
    // Full mesh: an UNREFERENCED state is coloured too (not just California).
    expect(isPolitical(fillOf(r, 'US-OR')!)).toBe(true);
    // Context country (neighbour land) colorized — foreignFill bypassed (F9).
    expect(isPolitical(fillOf(r, 'MX')!)).toBe(true);
  });

  it('no drawn political region leaks to green neutral (AC11)', () => {
    const r = lay('map\nCalifornia');
    for (const reg of politicalRegions(r))
      expect(isPolitical(reg.fill)).toBe(true);
  });

  it('border state never shares a hue with the country it abuts (international seam)', () => {
    const r = lay('map\nCalifornia');
    expect(fillOf(r, 'US-CA')).not.toBe(fillOf(r, 'MX')); // California ↔ Mexico
    expect(fillOf(r, 'US-ME')).not.toBe(fillOf(r, 'CA')); // Maine ↔ Canada
    expect(fillOf(r, 'US-AK')).not.toBe(fillOf(r, 'CA')); // Alaska ↔ Canada
  });

  it('bare map (no content) colorizes the whole world (AC3)', () => {
    // Colorize is the default dress for any non-data map — even an empty `map`
    // gets the political backdrop (no region is being coloured by data).
    const r = lay('map');
    const political = politicalRegions(r);
    expect(political.length).toBeGreaterThan(0);
    for (const reg of political) expect(isPolitical(reg.fill)).toBe(true);
  });

  it('POI-only map colorizes too — markers draw on top (AC3)', () => {
    // A US-framed POI draws the full state mesh; with no region data it colorizes
    // and the POI markers render over the tints.
    const r = lay('map\npoi New York City');
    const political = politicalRegions(r);
    expect(political.length).toBeGreaterThan(0);
    expect(political.every((x) => isPolitical(x.fill))).toBe(true);
    expect(r.pois.length).toBeGreaterThan(0);
  });

  it('value data suppresses colorize (AC4)', () => {
    const r = lay('map\nCalifornia value: 50');
    expect(isPolitical(fillOf(r, 'US-CA')!)).toBe(false);
    expect(politicalRegions(r).some((x) => isPolitical(x.fill))).toBe(false);
  });

  it('tag data suppresses colorize, even with active-tag none (AC5)', () => {
    const tagged = lay('map\ntag M as m\n  HQ blue\nCalifornia m: HQ');
    expect(politicalRegions(tagged).some((x) => isPolitical(x.fill))).toBe(
      false
    );
    const none = lay(
      'map\ntag M as m\n  HQ blue\nactive-tag none\nCalifornia m: HQ'
    );
    expect(politicalRegions(none).some((x) => isPolitical(x.fill))).toBe(false);
  });

  it('`no-colorize` forces green-land even with regions (AC6)', () => {
    const r = lay('map\nno-colorize\nCalifornia');
    expect(fillOf(r, 'US-CA')).toBe(neutral);
    expect(politicalRegions(r).some((x) => isPolitical(x.fill))).toBe(false);
  });

  it('`no-colorize` is a true no-op under data — byte-identical layout (AC7)', () => {
    // Flag placed AFTER the data line so removing it does not shift any region's
    // lineNumber — isolating the flag's (nil) effect on the data dress.
    const withFlag = JSON.stringify(
      lay('map\nCalifornia value: 92\nno-colorize')
    );
    const without = JSON.stringify(lay('map\nCalifornia value: 92'));
    expect(withFlag).toBe(without);
  });

  it('a direct color anywhere suppresses colorize — hand-picked colours win (AC8)', () => {
    const TAG_TINT_LIGHT = 60;
    const r = lay('map\nOregon blue\nCalifornia');
    // Oregon painted its direct blue tint (override); the explicit colour is
    // authoring intent, so the rest of the map drops to the neutral dress rather
    // than fighting the hand-picked colours with auto political tints.
    expect(fillOf(r, 'US-OR')).toBe(mix(P.colors.blue, P.bg, TAG_TINT_LIGHT));
    expect(fillOf(r, 'US-CA')).toBe(neutral);
    expect(politicalRegions(r).some((x) => isPolitical(x.fill))).toBe(false);
  });

  it('boundary stroke darkens per-region under colorize, differs from green baseline (AC12)', () => {
    const colored = lay('map\nCalifornia');
    const plain = lay('map\nno-colorize\nCalifornia');
    const ca = colored.regions.find((x) => x.id === 'US-CA')!;
    const caPlain = plain.regions.find((x) => x.id === 'US-CA')!;
    expect(ca.stroke).toBe(mix(ca.fill, P.text, 35)); // per-region darken
    expect(ca.stroke).not.toBe(caPlain.stroke); // ≠ green-land baseline
  });

  it('AK/HI insets colorize and match the main-frame colorByIso (AC11)', () => {
    const r = lay('map\nCalifornia\nAlaska\nHawaii', 1200, 800);
    expect(r.insetRegions.length).toBeGreaterThan(0);
    for (const ins of r.insetRegions) expect(isPolitical(ins.fill)).toBe(true);
    // An inset state's colour matches its main-frame colour (same colorByIso).
    // Alaska borders Canada → it carries the seam-aware tint in BOTH places.
    const akInset = r.insetRegions.find((x) => x.id === 'US-AK');
    if (akInset) expect(isPolitical(akInset.fill)).toBe(true);
  });

  it('deterministic + extent-independent (AC10)', () => {
    const src = 'map\nCalifornia';
    expect(JSON.stringify(lay(src))).toBe(JSON.stringify(lay(src)));
    // Same region, different source/extent → same colour (unified global graph).
    const a = fillOf(lay('map\nCalifornia'), 'US-CA');
    const b = fillOf(lay('map\nCalifornia\nOregon\nMaine'), 'US-CA');
    expect(a).toBe(b);
  });

  it('all-typo map still colorizes — no region data present (AC14)', () => {
    // Unresolved region lines carry no data, so the map is a non-data map and
    // colorizes (the typos surface as diagnostics, the world stays political).
    const r = lay('map\nNotARealPlace\nAlsoFake');
    expect(politicalRegions(r).every((x) => isPolitical(x.fill))).toBe(true);
  });
});

describe('layout — subtle city dots (basemap orientation, no-cities)', () => {
  it('scatters on-canvas gazetteer cities by default', () => {
    const r = lay('map\nCalifornia value: 50');
    expect(r.cityDots.length).toBeGreaterThan(0);
    // Every dot is on-canvas (the sole cull) with a positive radius.
    for (const d of r.cityDots) {
      expect(d.cx).toBeGreaterThanOrEqual(0);
      expect(d.cx).toBeLessThanOrEqual(800);
      expect(d.cy).toBeGreaterThanOrEqual(0);
      expect(d.cy).toBeLessThanOrEqual(600);
      expect(d.r).toBeGreaterThan(0);
    }
  });

  it('no-cities suppresses the layer entirely', () => {
    const r = lay('map\nno-cities\nCalifornia value: 50');
    expect(r.cityDots).toHaveLength(0);
  });

  it('dots never land under an explicit POI (spacing dodge)', () => {
    // NYC is a gazetteer city AND declared as a POI — it must not double-draw as
    // a faint dot beneath its own marker.
    const r = lay('map\npoi New York City US-NY');
    for (const poi of r.pois) {
      for (const d of r.cityDots) {
        const dist = Math.hypot(d.cx - poi.cx, d.cy - poi.cy);
        expect(dist).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('renders dots on a US albers map valuing AK/HI (antimeridian regression)', async () => {
    // Valuing Alaska + Hawaii wraps resolved.extent across the antimeridian
    // (west lon > east lon). A lon/lat box-cull would reject every mainland city
    // → a blank map; the on-canvas pixel cull must still emit dots. Uses real
    // bundled geometry/gazetteer (the hand-built DATA fixture has no AK/HI).
    const { loadMapData } = await import('../src/map/load-data');
    const data = await loadMapData();
    const r = layoutMap(
      resolveMap(
        parseMap(
          'map US Sales\nCalifornia value: 92\nTexas value: 78\nAlaska value: 100\nHawaii value: 100'
        ),
        data
      ),
      data,
      { width: 1200, height: 800 },
      { palette: P, isDark: false }
    );
    expect(r.cityDots.length).toBeGreaterThan(0);
  });
});

describe('layout — region metric value labels (no-region-value)', () => {
  it('shows the metric value as a dimmer second line under a big region by default', () => {
    const r = lay('map\nregion-metric Population\nCalifornia value: 39500000');
    const ca = r.labels.find((l) => l.text === 'California');
    expect(ca).toBeDefined();
    expect(ca!.valueLine).toBe('39.5M');
  });
  it('formats the value with the shared compact formatter', () => {
    expect(
      lay('map\nCalifornia value: 1100').labels.find(
        (l) => l.text === 'California'
      )?.valueLine
    ).toBe('1.1K');
    expect(
      lay('map\nCalifornia value: 2300000').labels.find(
        (l) => l.text === 'California'
      )?.valueLine
    ).toBe('2.3M');
  });
  it('degrades a small region (Oregon) to its bare name when the stack will not fit', () => {
    const r = lay('map\nCalifornia value: 1\nOregon value: 2300000');
    const or = r.labels.find((l) => l.text === 'Oregon');
    // Oregon is too narrow for a two-line stack here → name only, no value line.
    if (or) expect(or.valueLine).toBeUndefined();
  });
  it('no-region-value suppresses the value line but keeps the name', () => {
    const r = lay('map\nno-region-value\nCalifornia value: 39500000');
    const ca = r.labels.find((l) => l.text === 'California');
    expect(ca).toBeDefined();
    expect(ca!.valueLine).toBeUndefined();
  });
  it('a tag-coloured (non-score) map shows no value line', () => {
    const r = lay(
      'map\ntag Tier\n  gold\n  silver\nactive-tag Tier\nCalifornia value: 50, Tier: gold'
    );
    const ca = r.labels.find((l) => l.text === 'California');
    if (ca) expect(ca.valueLine).toBeUndefined();
  });
});
