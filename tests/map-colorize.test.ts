// Colorize engine: pure adjacency coloring (assignColors), political pastel
// generation (politicalTints), and the real-asset adjacency builder + the AC9
// no-collision guarantee on the shipped world/us-states topologies.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assignColors } from '../src/map/colorize';
import { buildAdjacency } from '../src/map/geo';
import { politicalTints, mix } from '../src/palettes/color-utils';
import { getPalette, getAvailablePalettes } from '../src/palettes';
import type { BoundaryTopology } from '../src/map/data/types';

const DATA = resolve(__dirname, '../src/map/data');
const load = (name: string): BoundaryTopology =>
  JSON.parse(readFileSync(resolve(DATA, name), 'utf8')) as BoundaryTopology;

const adjMap = (pairs: Array<[string, string[]]>): Map<string, string[]> =>
  new Map(pairs);

describe('assignColors — first-fit collision-free, minimal colours (AC9)', () => {
  it('no two arc-neighbours share a hue on a degree-16 hub (and uses only 2 colours)', () => {
    const neighbours = Array.from({ length: 16 }, (_, i) => `L${i}`);
    const adj = adjMap([
      ['H', neighbours],
      ...neighbours.map((n): [string, string[]] => [n, ['H']]),
    ]);
    const { byIso, huesNeeded } = assignColors([...adj.keys()], adj);
    // A star is bipartite → first-fit uses just 2 colours, NOT Δ+1=17.
    expect(huesNeeded).toBe(2);
    for (const n of neighbours) expect(byIso.get(n)).not.toBe(byIso.get('H'));
  });

  it('properly colours a clique K6 with exactly 6 colours', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E', 'F'];
    const adj = adjMap(
      nodes.map((n): [string, string[]] => [n, nodes.filter((m) => m !== n)])
    );
    const { byIso, huesNeeded } = assignColors([...adj.keys()], adj);
    expect(huesNeeded).toBe(6); // a clique needs all distinct
    const used = new Set([...byIso.values()]);
    expect(used.size).toBe(6);
  });

  it('every input ISO gets an index — incl. zero-degree islands', () => {
    const adj = adjMap([
      ['A', ['B']],
      ['B', ['A']],
      ['ISLAND', []], // no neighbour entry at all
    ]);
    // 'LONE' isn't even in the adjacency map — still must be coloured.
    const { byIso } = assignColors(['A', 'B', 'ISLAND', 'LONE'], adj);
    for (const iso of ['A', 'B', 'ISLAND', 'LONE'])
      expect(byIso.get(iso)).toBeTypeOf('number');
  });

  it('is deterministic across runs (stable order)', () => {
    const adj = adjMap([
      ['US-CA', ['US-NV', 'US-OR', 'US-AZ']],
      ['US-NV', ['US-CA', 'US-OR', 'US-AZ']],
      ['US-OR', ['US-CA', 'US-NV']],
      ['US-AZ', ['US-CA', 'US-NV']],
    ]);
    const a = assignColors([...adj.keys()], adj);
    const b = assignColors([...adj.keys()].reverse(), adj);
    expect([...a.byIso.entries()].sort()).toEqual(
      [...b.byIso.entries()].sort()
    );
  });
});

describe('politicalTints — on-palette pale tints (AC13)', () => {
  const atlas = getPalette('atlas').light;
  const rosePine = getPalette('rose-pine').light; // thinnest palette

  it("tints are soft versions of the palette's OWN hues, land-first", () => {
    // First-band tints are mix(swatch, bg, 32) of actual palette hues, ordered
    // land-first (green leads; blue/cyan trail) so they never read as ocean.
    const c = atlas.colors;
    expect(politicalTints(atlas, 1, false)[0]).toBe(mix(c.green, atlas.bg, 32));
    expect(politicalTints(atlas, 2, false)[1]).toBe(
      mix(c.yellow, atlas.bg, 32)
    );
  });

  it('no tint coincides with the water backdrop colour (blue/cyan trail)', () => {
    // The water backdrop is mix(blue, bg, WATER_TINT) — a country fill must never
    // equal it, or it vanishes into the sea (regression: pale-blue land == ocean).
    const water = mix(atlas.colors.blue, atlas.bg, 24); // WATER_TINT_LIGHT
    const tints = politicalTints(atlas, 8, false); // exhaust all 8 hues
    expect(tints).not.toContain(water);
  });

  it('returns exactly `count` distinct colours, even past the palette hue count', () => {
    // Overflow beyond the palette's distinct hues falls to a second lightness
    // band of the SAME hues (still on-palette), staying all-distinct.
    const count = 12;
    const tints = politicalTints(rosePine, count, false);
    expect(tints).toHaveLength(count);
    expect(new Set(tints).size).toBe(count);
  });

  it('is deterministic and works at any count incl. 1', () => {
    expect(politicalTints(rosePine, 1, false)).toHaveLength(1);
    expect(politicalTints(rosePine, 6, true)).toEqual(
      politicalTints(rosePine, 6, true)
    );
  });

  // Colorize must look right on EVERY palette, not just Atlas — the feature reads
  // the active palette's own hues, so this guards all 13 at once.
  it('every palette yields 6 distinct land tints, none equal to its water', () => {
    const WATER = 24; // WATER_TINT_LIGHT / WATER_TINT_DARK (both 24)
    const palettes = getAvailablePalettes();
    expect(palettes.length).toBeGreaterThanOrEqual(13); // guard: really iterating
    for (const config of palettes) {
      for (const mode of ['light', 'dark'] as const) {
        const p = config[mode];
        const isDark = mode === 'dark';
        const base = isDark ? p.surface : p.bg;
        const water = mix(p.colors.blue, base, WATER);
        // A real-world map needs 6 colours (first-fit on world-detail).
        const tints = politicalTints(p, 6, isDark);
        expect(new Set(tints).size, `${config.name}/${mode} distinct`).toBe(6);
        expect(tints, `${config.name}/${mode} land==water`).not.toContain(
          water
        );
      }
    }
  });
});

describe('buildAdjacency — real assets (data hygiene G1 + known neighbours)', () => {
  const detail = load('world-detail.json');
  const usStates = load('us-states.json');

  it('world-detail: AU is ONE node (two geometries unioned, null stub skipped)', () => {
    // world-detail ships two AU geometries: real Australia + a `type:null`
    // "Ashmore & Cartier" stub. The builder must union them into one AU node and
    // skip the null (no spurious node, no clobber).
    const adj = buildAdjacency(detail);
    expect(adj.has('AU')).toBe(true);
    // One key per ISO (union, not duplicated).
    const auKeys = [...adj.keys()].filter((k) => k === 'AU');
    expect(auKeys).toHaveLength(1);
    // No self-edges, no `null`-typed phantom id.
    expect(adj.get('AU')).not.toContain('AU');
  });

  it('known land neighbours present (FR, US-CA)', () => {
    const world = buildAdjacency(detail);
    const states = buildAdjacency(usStates);
    for (const n of ['DE', 'ES', 'IT', 'BE'])
      expect(world.get('FR')).toContain(n);
    for (const n of ['US-NV', 'US-OR', 'US-AZ'])
      expect(states.get('US-CA')).toContain(n);
  });

  it('no node lists itself as a neighbour', () => {
    for (const topo of [detail, usStates]) {
      const adj = buildAdjacency(topo);
      for (const [iso, ns] of adj) expect(ns).not.toContain(iso);
    }
  });

  it('memoizes per topology (same Map instance returned)', () => {
    expect(buildAdjacency(detail)).toBe(buildAdjacency(detail));
  });
});

describe('colorize integration — AC9 guarantee on the real graphs', () => {
  it('no arc-adjacent region shares a hue index (world-detail + us-states)', () => {
    for (const name of [
      'world-detail.json',
      'world-coarse.json',
      'us-states.json',
    ]) {
      const adj = buildAdjacency(load(name));
      const { byIso } = assignColors([...adj.keys()], adj);
      for (const [iso, neighbours] of adj)
        for (const n of neighbours)
          expect(
            byIso.get(iso),
            `${iso} vs neighbour ${n} in ${name}`
          ).not.toBe(byIso.get(n));
    }
  });

  it('sampled neighbours get different hues (FR≠DE, US-CA≠US-NV)', () => {
    const world = buildAdjacency(load('world-detail.json'));
    const wc = assignColors([...world.keys()], world).byIso;
    expect(wc.get('FR')).not.toBe(wc.get('DE'));
    const states = buildAdjacency(load('us-states.json'));
    const sc = assignColors([...states.keys()], states).byIso;
    expect(sc.get('US-CA')).not.toBe(sc.get('US-NV'));
  });
});
