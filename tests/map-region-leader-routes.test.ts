import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap } from '../src/map/layout';
import { loadMapData } from '../src/map/load-data';
import { getPalette } from '../src/palettes';
import { segmentsCross } from '../src/label-layout';

// #2389: North Carolina's leader ran from its centroid to the coast straight
// across the Charles Town → Bath Town route.
const SRC = `map Blackbeard's Last Season on the Carolina Coast

tag Colony as c
  Blockaded red
  Safe Harbour green
  Hunting Us purple

tag Event as e
  Raid orange
  Refuge blue

South Carolina c: Blockaded
North Carolina c: Safe Harbour
Virginia c: Hunting Us

tag Voyage as v
  Plunder orange
  Pardon blue
  The Hunt purple

poi 33.4 -73.6 as prize label: Prizes taken at sea, e: Raid
poi Charleston US-SC label: Charles Town blockaded, e: Raid
  note Nine ships held a week
    Ransom: one chest of medicine.
poi 35.55 -76.81 as bath label: Bath Town pardon, e: Refuge
  note The Governor looks away
poi 35.11 -75.98 as ocracoke label: Blackbeard falls at Ocracoke, e: Raid
poi 37.27 -76.71 as williamsburg label: Williamsburg sends Maynard, e: Refuge

prize ~> Charleston v: Plunder, label: blockade
Charleston ~> bath v: Plunder, label: sail north
bath ~> ocracoke v: Plunder
williamsburg ~> ocracoke v: The Hunt, width: 6
  note Maynard's sloops
    Two sloops close in at dawn.
`;

const legPolyline = (d: string): Array<[number, number]> => {
  const q = d.match(
    /^M([-\d.]+),([-\d.]+)Q([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)$/
  );
  const l = d.match(/^M([-\d.]+),([-\d.]+)L([-\d.]+),([-\d.]+)$/);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const u = 1 - t;
    if (q) {
      const [ax, ay, px, py, bx, by] = q.slice(1).map(Number) as number[];
      pts.push([
        u * u * ax! + 2 * u * t * px! + t * t * bx!,
        u * u * ay! + 2 * u * t * py! + t * t * by!,
      ]);
    } else if (l) {
      const [ax, ay, bx, by] = l.slice(1).map(Number) as number[];
      pts.push([ax! + (bx! - ax!) * t, ay! + (by! - ay!) * t]);
    }
  }
  return pts;
};

describe('map region leaders vs route legs (#2389)', () => {
  it.each([
    [1220, 716],
    [800, 600],
    [1200, 800],
  ])('no region leader crosses a leg at %ix%i', async (w, h) => {
    const data = await loadMapData();
    const r = layoutMap(
      resolveMap(parseMap(SRC), data),
      data,
      { width: w, height: h },
      { palette: getPalette('nord').light, isDark: false }
    );
    expect(r.legs.length).toBeGreaterThan(0);
    const polys = r.legs.map((lg) => legPolyline(lg.d));
    for (const lab of r.labels) {
      if (!lab.leader) continue;
      const L = lab.leader;
      for (const p of polys)
        for (let i = 1; i < p.length; i++)
          expect(
            segmentsCross(
              L.x1,
              L.y1,
              L.x2,
              L.y2,
              p[i - 1]![0],
              p[i - 1]![1],
              p[i]![0],
              p[i]![1]
            ),
            `${lab.text} leader crosses a leg`
          ).toBe(false);
    }
    // The subject keeps its name — it slides in-shape rather than dropping.
    expect(r.labels.some((l) => l.text === 'North Carolina')).toBe(true);
  });
});
