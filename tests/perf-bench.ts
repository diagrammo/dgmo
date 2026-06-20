// Performance harness for BL-102 — times representative .dgmo fixtures through
// the full render() path, plus targeted sub-stage timings for the hot paths the
// perf roadmap touches (b&l layout search, map layout/recolor).
//
// Run: pnpm bench:perf
//
// Every optimization in BL-102 ships with a before/after delta from this file.
// It is a vitest bench (not shipped in the package) and lives out of `pnpm test`.
import { test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { render } from '../src/render';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLinesSearch } from '../src/boxes-and-lines/layout-search';

const GAUNTLET =
  '/Users/demian/code/diagrammo/my-diagrams/sandbox/layout-gauntlet';
const FIXTURES = `${__dirname}/../gallery/fixtures`;

function read(p: string): string | null {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

// Synthetic POI-dense world map — many base regions × many POI labels exercises
// the renderer's per-label region-bbox loop (roadmap #2). Cities span continents
// so the basemap is the full world (~200 regions).
const POI_WORLD = `map Global POIs
poi-metric Load

poi New York value: 90
poi Los Angeles value: 70
poi London value: 80
poi Paris value: 60
poi Tokyo value: 95
poi Sydney value: 50
poi Mumbai value: 85
poi Singapore value: 75
poi Berlin value: 55
poi Madrid value: 45
poi Cairo value: 40
poi Toronto value: 65
poi Chicago value: 50
poi Moscow value: 70
poi Beijing value: 88
poi Sao Paulo value: 60
poi Mexico City value: 58
poi Lagos value: 42
poi Dubai value: 77
poi Bangkok value: 53
`;

// median of repeated timings (ms), with a warm-up pass to JIT + load map data.
async function timeMs(
  fn: () => Promise<unknown> | unknown,
  iters: number
): Promise<{ median: number; min: number }> {
  await fn(); // warm-up (loads map data, primes caches/JIT)
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    min: samples[0],
  };
}

const fmt = (n: number) => n.toFixed(1).padStart(8);
const pad = (s: string, w: number) => s.padEnd(w);

test('perf harness — render() end-to-end + hot sub-stages', async () => {
  // ── full render() end-to-end (the user-facing number) ──────────────────
  const renderFixtures: { name: string; src: string | null; iters: number }[] =
    [
      {
        name: 'b&l/marketplace (45 edges)',
        src: read(`${GAUNTLET}/30-online-marketplace.dgmo`),
        iters: 9,
      },
      {
        name: 'b&l/gallery (14 edges)',
        src: read(`${FIXTURES}/boxes-and-lines.dgmo`)
          ?.replace('tag Team t ', 'tag Team as t ')
          .replace('tag Priority p ', 'tag Priority as p ') ?? null,
        iters: 9,
      },
      {
        name: 'map/world-reference',
        src: read(`${FIXTURES}/map-reference-world.dgmo`),
        iters: 7,
      },
      {
        name: 'map/choropleth',
        src: read(`${FIXTURES}/map-choropleth.dgmo`),
        iters: 7,
      },
      {
        name: 'map/poi-world (20 POIs)',
        src: POI_WORLD,
        iters: 7,
      },
      {
        name: 'sequence/groups-complex',
        src: read(`${FIXTURES}/sequence-groups-complex.dgmo`),
        iters: 9,
      },
    ];

  const renderRows: { name: string; median: number; min: number }[] = [];
  for (const { name, src, iters } of renderFixtures) {
    if (src == null) {
      renderRows.push({ name: name + ' (MISSING)', median: NaN, min: NaN });
      continue;
    }
    const r = await timeMs(() => render(src), iters);
    renderRows.push({ name, ...r });
  }

  // ── map recolor fast-path: render light then dark (theme flip) ──────────
  const worldSrc = read(`${FIXTURES}/map-reference-world.dgmo`);
  let recolor: { median: number; min: number } | null = null;
  if (worldSrc) {
    await render(worldSrc); // prime
    recolor = await timeMs(
      () => render(worldSrc, { theme: 'dark' }),
      7
    );
  }

  // ── b&l layout-only sub-stage (parse + search; no SVG render) ───────────
  const blLayoutFixtures: { name: string; src: string | null }[] = [
    {
      name: 'b&l-layout/marketplace',
      src: read(`${GAUNTLET}/30-online-marketplace.dgmo`),
    },
    {
      name: 'b&l-layout/gallery',
      src: read(`${FIXTURES}/boxes-and-lines.dgmo`)
        ?.replace('tag Team t ', 'tag Team as t ')
        .replace('tag Priority p ', 'tag Priority as p ') ?? null,
    },
  ];
  const blRows: { name: string; median: number; min: number }[] = [];
  for (const { name, src } of blLayoutFixtures) {
    if (src == null) continue;
    const parsed = parseBoxesAndLines(src);
    const r = await timeMs(() => layoutBoxesAndLinesSearch(parsed), 7);
    blRows.push({ name, ...r });
  }

  // ── report ──────────────────────────────────────────────────────────────
  const printTable = (
    title: string,
    rows: { name: string; median: number; min: number }[]
  ) => {
    console.log(`\n  ${title}`);
    console.log('  ' + pad('fixture', 30) + '    median       min');
    console.log('  ' + '-'.repeat(50));
    for (const r of rows) {
      console.log(
        '  ' + pad(r.name, 30) + fmt(r.median) + 'ms ' + fmt(r.min) + 'ms'
      );
    }
  };

  printTable('render() end-to-end (ms)', renderRows);
  if (recolor)
    printTable('map recolor (light→dark theme flip)', [
      { name: 'map/world-reference', ...recolor },
    ]);
  printTable('b&l layout search only (parse+search)', blRows);
  console.log('');
});
