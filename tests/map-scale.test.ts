import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap } from '../src/map/layout';
import { mapLegendGroups } from '../src/map/legend-band';
import { computeMapBins } from '../src/map/binning';
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
    for (const line of [
      'scale binned',
      'scale binned 1',
      'scale binned 10',
      'scale binned 2.5',
      'scale binned 10 5',
      'scale binned 1 2 3 4 5 6 7 8 9',
      'scale',
      'scale diverging x',
    ]) {
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

// `scale binned` (diagrammo/diagrammo#1988): quantile classes from a count,
// or the author's thresholds; flat colours and a stepped legend.
describe('map scale binned — parser', () => {
  it('reads a count of 2–9 as quantile classes', () => {
    expect(
      parseMap('map\nscale binned 5\nCalifornia heat: 1').directives.regionScale
    ).toEqual({ kind: 'binned', count: 5, line: 2 });
  });

  it('reads two or more rising numbers as thresholds', () => {
    expect(
      parseMap('map\nscale binned 0 10 50 100\nCalifornia heat: 1').directives
        .regionScale
    ).toEqual({ kind: 'binned', thresholds: [0, 10, 50, 100], line: 2 });
  });
});

describe('map scale binned — class breaks', () => {
  const values = [
    0.6, 1, 2, 2.1, 3, 4.2, 5.9, 8, 10.8, 11, 12, 13, 19.6, 25, 39,
  ];

  it('quantile breaks are rounded to two significant figures', () => {
    const b = computeMapBins(values, { kind: 'binned', count: 5, line: 1 })!;
    expect(b.bins.map((x) => x.label)).toEqual([
      'under 2.1',
      '2.1–5.2',
      '5.2–11',
      '11–14',
      '14 and up',
    ]);
    expect(b.requested).toBeUndefined();
  });

  it('a value on a break starts the upper class', () => {
    const b = computeMapBins([1, 10, 20], {
      kind: 'binned',
      thresholds: [10],
      line: 1,
    } as never)!;
    expect(b.bins[b.binOf(10)]!.label).toBe('10 and up');
    expect(b.bins[b.binOf(9.99)]!.label).toBe('under 10');
  });

  it('ties merge empty quantile classes and report the count asked for', () => {
    const tied = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 7];
    const b = computeMapBins(tied, { kind: 'binned', count: 5, line: 1 })!;
    expect(b.bins.length).toBeLessThan(5);
    expect(b.requested).toBe(5);
    // Every drawn class holds a value.
    for (let i = 0; i < b.bins.length; i++)
      expect(tied.some((v) => b.binOf(v) === i)).toBe(true);
  });

  it('threshold classes keep their colour slot; unused open ends leave the legend', () => {
    const b = computeMapBins([5, 20, 60], {
      kind: 'binned',
      thresholds: [0, 10, 50, 100],
      line: 1,
    })!;
    expect(b.slots).toBe(5);
    expect(b.bins.map((x) => [x.label, x.slot])).toEqual([
      ['0–10', 1],
      ['10–50', 2],
      ['50–100', 3],
    ]);
  });
});

describe('map scale binned — fills, legend and warning', () => {
  const SRC =
    'map\nregion-heat Rate\nscale binned 3\nCalifornia heat: 1\nOregon heat: 5\nMaine heat: 9';

  it('each class is one flat colour, the lowest still off the page colour', () => {
    const r = lay(SRC);
    const fills = ['US-CA', 'US-OR', 'US-ME'].map((id) => fillOf(r, id));
    expect(new Set(fills).size).toBe(3);
    expect(fills[0]).not.toBe(P.bg);
    expect(fills[2]).toBe(P.colors.red);
  });

  it('the legend is one swatch per class with its range, not a gradient', () => {
    const r = lay(SRC);
    const [group] = mapLegendGroups(r.legend!);
    expect(group!.name).toBe('Rate');
    expect(group!.gradient).toBeUndefined();
    expect(group!.entries.map((e) => e.value)).toEqual([
      'under 3.7',
      '3.7–6.3',
      '6.3 and up',
    ]);
    expect(group!.entries[2]!.color).toBe(fillOf(r, 'US-ME'));
  });

  it('regions carry their class for legend hover', () => {
    const r = lay(SRC);
    expect(r.regions.find((x) => x.id === 'US-OR')!.tags).toMatchObject({
      Rate: '3.7–6.3',
    });
  });

  it('warns W_MAP_BINNED_CLASSES_MERGED when ties leave classes empty', () => {
    const r = lay(
      'map\nscale binned 3\nCalifornia heat: 0\nOregon heat: 0\nMaine heat: 0\nGeorgia heat: 4'
    );
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      'W_MAP_BINNED_CLASSES_MERGED',
    ]);
    expect(r.diagnostics[0]!.line).toBe(2);
  });
});
