// Boxes-and-lines layout benchmark — ELK vs the experimental search engine,
// scored with the SAME crossing counter the engine optimizes against.
// Run: pnpm bench:bl   (corpus = gauntlet + gallery fixtures)
//
// Use this to tune layout-search.ts against numbers, not vibes.
import { test } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import {
  layoutBoxesAndLinesSearch,
  countSplineCrossings,
} from '../src/boxes-and-lines/layout-search';

const GAUNTLET =
  '/Users/demian/code/diagrammo/my-diagrams/sandbox/layout-gauntlet';
const FIXTURES = `${__dirname}/../gallery/fixtures`;

function corpus(): { name: string; src: string }[] {
  const out: { name: string; src: string }[] = [];
  if (existsSync(GAUNTLET))
    for (const f of readdirSync(GAUNTLET)
      .filter((f) => f.endsWith('.dgmo'))
      .sort())
      out.push({
        name: f.replace(/\.dgmo$/, ''),
        src: readFileSync(`${GAUNTLET}/${f}`, 'utf8'),
      });
  for (const f of ['boxes-and-lines.dgmo', 'boxes-and-lines-diverging.dgmo']) {
    const p = `${FIXTURES}/${f}`;
    if (existsSync(p))
      out.push({
        name: 'fixture/' + f.replace(/\.dgmo$/, ''),
        // the gallery fixture still uses the removed `tag X y` shorthand
        src: readFileSync(p, 'utf8')
          .replace('tag Team t ', 'tag Team as t ')
          .replace('tag Priority p ', 'tag Priority as p '),
      });
  }
  return out;
}

test('ELK vs search crossings across corpus', async () => {
  const rows: {
    name: string;
    n: number;
    e: number;
    elk: number;
    search: number;
  }[] = [];
  for (const { name, src } of corpus()) {
    const parsed = parseBoxesAndLines(src);
    const elk = await layoutBoxesAndLines(parsed);
    const search = layoutBoxesAndLinesSearch(parsed);
    rows.push({
      name,
      n: parsed.nodes.length,
      e: parsed.edges.length,
      elk: countSplineCrossings(elk),
      search: countSplineCrossings(search),
    });
  }
  const pad = (s: string | number, w: number) => String(s).padEnd(w);
  const num = (s: string | number, w: number) => String(s).padStart(w);
  let elkTot = 0,
    searchTot = 0,
    wins = 0,
    losses = 0;
  console.log(
    '\n  ' +
      pad('diagram', 30) +
      num('nodes', 6) +
      num('edges', 6) +
      num('ELK', 6) +
      num('search', 8) +
      num('Δ', 6)
  );
  console.log('  ' + '-'.repeat(62));
  for (const r of rows) {
    elkTot += r.elk;
    searchTot += r.search;
    const d = r.search - r.elk;
    if (d < 0) wins++;
    else if (d > 0) losses++;
    const mark = d < 0 ? '  ✓' : d > 0 ? '  ✗' : '';
    console.log(
      '  ' +
        pad(r.name, 30) +
        num(r.n, 6) +
        num(r.e, 6) +
        num(r.elk, 6) +
        num(r.search, 8) +
        num(d > 0 ? '+' + d : d, 6) +
        mark
    );
  }
  console.log('  ' + '-'.repeat(62));
  console.log(
    '  ' +
      pad('TOTAL', 30) +
      num('', 6) +
      num('', 6) +
      num(elkTot, 6) +
      num(searchTot, 8) +
      num(searchTot - elkTot, 6)
  );
  console.log(
    `\n  search beats ELK on ${wins}, loses on ${losses}, ties on ${rows.length - wins - losses} of ${rows.length}\n`
  );
});
