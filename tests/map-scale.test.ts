import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap } from '../src/map/layout';
import { mapLegendGroups } from '../src/map/legend-band';
import { render } from '../src/render';
import { loadMapData } from '../src/map/load-data';
import { getPalette } from '../src/palettes';
import { mix, valueRampColor } from '../src/palettes/color-utils';
import type { MapData } from '../src/map/resolved-types';
import type { BoundaryTopology, Gazetteer } from '../src/map/data/types';

// `scale diverging <mid>` on a map (diagrammo/diagrammo#1837): the region ramp
// splits at mid — the low colour below, the high colour above, the neutral ramp
// base at mid — and the legend bar carries the same three stops.

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
  airports: {
    // Three NYC-area airports — coincident at national scale (spiderfy AC).
    airports: [
      [40.69, -74.17, 'US', 0, 'Newark Liberty'], // ewr
      [40.64, -73.78, 'US', 0, 'John F. Kennedy'], // jfk
      [40.78, -73.87, 'US', 0, 'LaGuardia'], // lga
    ],
    airportIata: { ewr: 0, jfk: 1, lga: 2 },
  },
  gazetteer,
};

const P = getPalette('nord').light;
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

const fillOf = (r: ReturnType<typeof lay>, id: string): string =>
  r.regions.find((x) => x.id === id)!.fill;

describe('map scale diverging — parser', () => {
  it('reads `scale diverging` with and without a midpoint', () => {
    expect(
      parseMap('map\nscale diverging\nCalifornia heat: 1').directives
        .regionScale
    ).toEqual({ kind: 'diverging', mid: 0 });
    expect(
      parseMap('map\nscale diverging 2.5\nCalifornia heat: 1').directives
        .regionScale
    ).toEqual({ kind: 'diverging', mid: 2.5 });
    expect(
      parseMap('map\nscale diverging -10\nCalifornia heat: 1').directives
        .regionScale
    ).toEqual({ kind: 'diverging', mid: -10 });
  });

  it('warns W_MAP_SCALE_INVALID on any other form and never reads it as a region', () => {
    for (const line of ['scale binned 5', 'scale', 'scale diverging x']) {
      const p = parseMap(`map\n${line}\nCalifornia heat: 1`);
      expect(p.directives.regionScale).toBeUndefined();
      expect(p.diagnostics.map((d) => d.code)).toEqual(['W_MAP_SCALE_INVALID']);
      expect(p.regions.map((r) => r.name)).toEqual(['California']);
    }
  });
});

describe('map scale diverging — region fills and legend', () => {
  const SRC =
    'map\nscale diverging 0\nCalifornia heat: -4\nMaine heat: 0\nOregon heat: 8';

  it('colours below mid in blue, above in red, mid in the neutral ramp base', () => {
    const r = lay(SRC);
    expect(fillOf(r, 'US-CA')).toBe(P.colors.blue);
    expect(fillOf(r, 'US-OR')).toBe(P.colors.red);
    expect(fillOf(r, 'US-ME')).toBe(P.bg);
  });

  it('each side spans its own distance from mid', () => {
    // -2 is half way from 0 to the lowest value (-4); 4 is half way to 8.
    const below = lay(
      'map\nscale diverging 0\nCalifornia heat: -4\nMaine heat: -2\nOregon heat: 8'
    );
    expect(fillOf(below, 'US-ME')).toBe(
      valueRampColor(P.bg, P.colors.blue, 0.5, { isDark: false })
    );
    const above = lay(
      'map\nscale diverging 0\nCalifornia heat: -4\nMaine heat: 4\nOregon heat: 8'
    );
    expect(fillOf(above, 'US-ME')).toBe(
      valueRampColor(P.bg, P.colors.red, 0.5, { isDark: false })
    );
  });

  it('the legend bar carries the same three stops, neutral at mid', () => {
    const r = lay(SRC);
    expect(r.legend?.ramp).toMatchObject({
      min: -4,
      max: 8,
      low: P.colors.blue,
      high: P.colors.red,
    });
    const [group] = mapLegendGroups(r.legend!);
    expect(group!.gradient?.stops).toEqual([
      { offset: 0, color: P.colors.blue },
      { offset: 4 / 12, color: P.bg },
      { offset: 1, color: P.colors.red },
    ]);
  });

  it('takes the two region-heat colours as its low and high sides', () => {
    const r = lay(
      'map\nregion-heat Net green purple\nscale diverging 0\nCalifornia heat: -4\nOregon heat: 8'
    );
    expect(fillOf(r, 'US-CA')).toBe(P.colors.green);
    expect(fillOf(r, 'US-OR')).toBe(P.colors.purple);
  });

  it('a mid outside the data widens the range to take it in', () => {
    const r = lay(
      'map\nscale diverging 0\nCalifornia heat: 5\nOregon heat: 10'
    );
    expect(r.legend?.ramp).toMatchObject({ min: 0, max: 10 });
    expect(fillOf(r, 'US-CA')).toBe(
      valueRampColor(P.bg, P.colors.red, 0.5, { isDark: false })
    );
  });

  it('without `scale` the one-way ramp and its two-stop legend are unchanged', () => {
    const r = lay('map\nCalifornia heat: 0\nOregon heat: 100');
    expect(fillOf(r, 'US-OR')).toBe(P.colors.red);
    expect(fillOf(r, 'US-CA')).toBe(mix(P.colors.red, P.bg, 15));
    expect(r.legend?.ramp?.stops).toBeUndefined();
  });
});

describe('map scale diverging — rendered legend', () => {
  it('draws the three-stop bar in the SVG', async () => {
    const { svg } = await render(
      'map Margin by State\nscale diverging 0\nCalifornia heat: -4\nTexas heat: 0\nFlorida heat: 8',
      { mapData: loadMapData }
    );
    const grad = svg.match(
      /<linearGradient[^>]*dgmo-legend-ramp[\s\S]*?<\/linearGradient>/
    );
    expect(grad).not.toBeNull();
    expect(grad![0].match(/<stop /g)).toHaveLength(3);
    expect(grad![0]).toContain('offset="33.33');
  });
});
