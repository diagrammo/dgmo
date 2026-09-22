// A map layout carries its fitted projection as DATA so it can cross
// `postMessage` — the app lays maps out in a worker (#645). These tests hold the
// three promises that makes: the layout clones, the rebuilt projection is the
// one layout drew with (bit for bit), and drawing a cloned layout produces the
// same SVG as rendering in one call.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { geoGraticule10, geoPath } from 'd3-geo';
import type { GeoProjection } from 'd3-geo';
import type * as ProjectionModule from '../src/map/projection';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Record every live projection layout captures, keyed by the params object it
// returns, so the rebuilt projection can be compared with the real instance.
const liveByParams = vi.hoisted(() => new Map<object, GeoProjection>());
vi.mock('../src/map/projection', async (importOriginal) => {
  const orig = await importOriginal<typeof ProjectionModule>();
  return {
    ...orig,
    captureMapProjection: (
      spec: Parameters<typeof orig.captureMapProjection>[0],
      projection: GeoProjection
    ) => {
      const params = orig.captureMapProjection(spec, projection);
      liveByParams.set(params, projection);
      return params;
    },
  };
});

import { layoutMap } from '../src/map/layout';
import type { MapLayout } from '../src/map/layout';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { renderMap, renderMapLayout } from '../src/map/renderer';
import {
  createMapGeoQuery,
  createMapGeoQueryForLayout,
} from '../src/map/geo-query';
import { rebuildMapProjection } from '../src/map/projection';
import { loadMapData } from '../src/map/load-data';
import type { MapData } from '../src/map/resolved-types';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;
const FIXTURES = join(__dirname, '..', 'gallery', 'fixtures');

const US_INSETS = `map US insets
projection albers-usa
Alaska heat: 10
Hawaii heat: 40
Texas heat: 70
poi Denver`;

const SOURCES: Array<[string, string]> = [
  ...readdirSync(FIXTURES)
    .filter((f) => f.startsWith('map-') && f.endsWith('.dgmo'))
    .map((f): [string, string] => [f, readFileSync(join(FIXTURES, f), 'utf8')]),
  ['us-insets (inline)', US_INSETS],
];
const SIZES: Array<[number, number]> = [
  [1000, 700],
  [600, 900],
];

let data: MapData;

// Laid out ONCE per (source, size) and shared by every test below. The four
// tests assert different things about the SAME layouts, and laying each one out
// per test is the whole reason this file cost 79s of a 201s suite (#869) — four
// passes over every fixture where one does.
//
// 🔴 Hand a shared layout to nothing that could mutate it: the next test gets
// the same object. Every test below either only reads it or `structuredClone`s
// it first, which each was already doing for its own reasons.
const layouts = new Map<string, MapLayout>();
const layoutKey = (name: string, width: number, height: number): string =>
  `${name} @${width}x${height}`;

/** The shared layout for one (source, size). Missing means `beforeAll` did not
 *  build it — a bug in this file, not in the map code, so it throws rather than
 *  silently laying one out and putting the cost back. */
function sharedLayout(name: string, width: number, height: number): MapLayout {
  const key = layoutKey(name, width, height);
  const layout = layouts.get(key);
  if (!layout) throw new Error(`no shared layout for ${key}`);
  return layout;
}

// 🔴 The deadline is an argument here, not `vi.setConfig`, and it has to be.
// A hook's timeout is captured where the hook is REGISTERED, and the
// `vi.setConfig` below runs later in module evaluation than this line — so it
// reaches the four `it`s and never reaches this `beforeAll`. Both full-suite
// runs on 2026-09-22 that relied on it died here at exactly 10000ms, vitest's
// hook default, and reported the whole file as 5 skipped tests. See the block
// below for why a file that silently stops asserting is the failure to fear.
beforeAll(async () => {
  data = await loadMapData();
  for (const [name, src] of SOURCES)
    for (const [w, h] of SIZES)
      layouts.set(layoutKey(name, w, h), layoutOf(src, w, h));
}, 180_000);

function layoutOf(src: string, width: number, height: number): MapLayout {
  return layoutMap(
    resolveMap(parseMap(src), data),
    data,
    { width, height },
    { palette, isDark: false, legendMode: 'preview' }
  );
}

/** Same number, including NaN — `toBe` treats NaN as equal to NaN too, but
 *  distinguishes -0, which a pixel does not care about. */
function sameNumber(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function samePoint(
  a: [number, number] | null | undefined,
  b: [number, number] | null | undefined
): boolean {
  if (!a || !b) return !a && !b;
  return sameNumber(a[0], b[0]) && sameNumber(a[1], b[1]);
}

const LONLAT_GRID: Array<[number, number]> = [];
for (let lon = -180; lon <= 180; lon += 7.5)
  for (let lat = -85; lat <= 85; lat += 5) LONLAT_GRID.push([lon, lat]);

// 🔴 This file needs its own deadline. vitest.config.ts sets testTimeout to
// 30s and says, in as many words, that the number "is not tuned to the observed
// margin, deliberately. A budget a correct render can plausibly approach is not
// a safe test, it is an absent one." That held when the heaviest render in the
// repo did 5-9 seconds of work. These four do 19.4s, 26.6s, 22.0s and 21.6s on
// an IDLE anchor — measured from a release gate's own log, 2026-09-20 — so the
// worst of them had 3.4s of headroom and the global number had quietly become
// the thing it forbids: a performance assertion against the machine.
//
// It duly fired. A full ecosystem release gated dgmo while the desktop app's
// gate ran beside it on the same 8 cores; all four timed out at exactly 30000ms
// and nothing else in 9,557 tests failed. The same sha had passed alone twenty
// minutes earlier.
//
// 180s restores the ~6x margin the 30s number was chosen to give, and still
// fails a genuine hang — which the config says is the one use of a clock this
// workspace endorses. It is scoped to this file so the tight global guard keeps
// covering the other 305.
//
// The re-layout that caused those figures is gone (#869): every layout is built
// once in the `beforeAll` above. Measured on an idle `anchor`, 2026-09-22, at
// the same commit either side: the file costs 42.6s inside the full suite
// against 79.3s before, and 14.2s run alone against 20.3s. 180s stays anyway,
// because the cost that matters is the one under load and the margin is the
// point — a budget correct code can plausibly approach is not a safe test.
//
// 🔴 `testTimeout` does NOT cover hooks, and the shared layouts moved the
// expensive part into one. vitest's hook default is 10s; with the layouts in
// `beforeAll` and 308 other files running beside this one, the hook crossed it
// and the ENTIRE file reported as 5 skipped tests plus one failed suite —
// measured 2026-09-22, on the first full-suite run after the change, and again
// on the second, which set `hookTimeout` here and changed nothing because this
// line runs after the hook is registered. The deadline that works is the
// argument on `beforeAll` above. `hookTimeout` is set here anyway, for any hook
// a later edit declares BELOW this line; it is not what protects that one.
//
// A file that silently stops asserting is worse than a slow one, which is why
// both live in the file and both say so.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe('map layout projection as data (#645)', () => {
  it('covers every gallery map fixture plus an inset map', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  it('every map layout survives structuredClone', () => {
    for (const [name] of SOURCES) {
      for (const [w, h] of SIZES) {
        const layout = sharedLayout(name, w, h);
        expect(
          () => structuredClone(layout),
          `${name} @${w}x${h}`
        ).not.toThrow();
      }
    }
  });

  it('the rebuilt projection projects and inverts exactly like the one layout fitted', () => {
    let insetsChecked = 0;
    for (const [name] of SOURCES) {
      for (const [w, h] of SIZES) {
        const layout = structuredClone(sharedLayout(name, w, h));
        const pairs = [
          layout.projectionParams,
          ...layout.insets.map((i) => i.projectionParams),
        ];
        insetsChecked += layout.insets.length;
        for (const params of pairs) {
          // The clone is a different object; find the live instance by value.
          const live = [...liveByParams.entries()].find(
            ([p]) => JSON.stringify(p) === JSON.stringify(params)
          )?.[1];
          expect(live, `${name} @${w}x${h}: live projection`).toBeDefined();
          const rebuilt = rebuildMapProjection(params);
          // Paths too: clipExtent never moves a point, only what a path keeps.
          expect(
            geoPath(rebuilt)(geoGraticule10()),
            `${name} @${w}x${h}: graticule path`
          ).toBe(geoPath(live!)(geoGraticule10()));
          for (const ll of LONLAT_GRID) {
            const a = live!(ll);
            const b = rebuilt(ll);
            expect(samePoint(a, b), `${name} project ${ll}: ${a} vs ${b}`).toBe(
              true
            );
            if (a) {
              const ia = live!.invert?.(a);
              const ib = rebuilt.invert?.(a);
              expect(samePoint(ia, ib), `${name} invert ${a}`).toBe(true);
            }
          }
        }
      }
    }
    // The inline US source must actually exercise both inset projections.
    expect(insetsChecked).toBeGreaterThanOrEqual(2 * SIZES.length);
  });

  it('a geo-query over a cloned layout answers exactly as one built from source', () => {
    const [w, h] = SIZES[0]!;
    for (const [name, src] of SOURCES) {
      const fromSource = createMapGeoQuery({
        content: src,
        width: w,
        height: h,
        data,
        palette,
        isDark: false,
      });
      const fromLayout = createMapGeoQueryForLayout(
        structuredClone(sharedLayout(name, w, h)),
        data
      );
      for (let px = 0; px <= w; px += 50) {
        for (let py = 0; py <= h; py += 50) {
          expect(
            samePoint(fromSource.invert(px, py), fromLayout.invert(px, py)),
            `${name} invert ${px},${py}`
          ).toBe(true);
        }
      }
      for (const ll of LONLAT_GRID) {
        expect(
          samePoint(fromSource.project(ll), fromLayout.project(ll)),
          `${name} project ${ll}`
        ).toBe(true);
      }
    }
  });

  it('drawing a cloned layout produces the SVG renderMap draws', () => {
    // Per-render def ids carry a monotonic suffix (`__m<n>`); normalise it.
    const svgOf = (el: HTMLElement): string =>
      el.innerHTML.replace(/__m\d+/g, '__m');
    const [w, h] = SIZES[0]!;
    for (const [name, src] of SOURCES) {
      const resolved = resolveMap(parseMap(src), data);
      const a = document.createElement('div');
      const b = document.createElement('div');
      Object.defineProperty(a, 'clientWidth', { value: w });
      Object.defineProperty(a, 'clientHeight', { value: h });
      renderMap(a, resolved, data, palette, false);
      const layout = structuredClone(sharedLayout(name, w, h));
      renderMapLayout(b, layout, resolved, palette, false);
      expect(a.querySelectorAll('path').length, name).toBeGreaterThan(0);
      expect(svgOf(b), name).toBe(svgOf(a));
    }
  });
});
