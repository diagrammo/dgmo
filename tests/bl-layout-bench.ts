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
  countEdgeOverlaps,
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

test('ELK vs search — crossings AND overlaps across corpus', async () => {
  const rows: {
    name: string;
    n: number;
    e: number;
    elkX: number;
    elkO: number;
    searchX: number;
    searchO: number;
  }[] = [];
  for (const { name, src } of corpus()) {
    const parsed = parseBoxesAndLines(src);
    const elk = await layoutBoxesAndLines(parsed);
    const search = layoutBoxesAndLinesSearch(parsed);
    rows.push({
      name,
      n: parsed.nodes.length,
      e: parsed.edges.length,
      elkX: countSplineCrossings(elk),
      elkO: countEdgeOverlaps(elk),
      searchX: countSplineCrossings(search),
      searchO: countEdgeOverlaps(search),
    });
  }
  const pad = (s: string | number, w: number) => String(s).padEnd(w);
  const num = (s: string | number, w: number) => String(s).padStart(w);
  // X = true crossings, O = overlap runs (lines stepping on each other).
  let exT = 0,
    eoT = 0,
    sxT = 0,
    soT = 0;
  console.log(
    '\n  ' +
      pad('diagram', 28) +
      num('n', 4) +
      num('e', 4) +
      num('ELK X', 7) +
      num('ELK O', 7) +
      num('srch X', 8) +
      num('srch O', 8)
  );
  console.log('  ' + '-'.repeat(66));
  for (const r of rows) {
    exT += r.elkX;
    eoT += r.elkO;
    sxT += r.searchX;
    soT += r.searchO;
    const mark = r.searchO > 0 ? '  ⚠ overlap' : '';
    console.log(
      '  ' +
        pad(r.name, 28) +
        num(r.n, 4) +
        num(r.e, 4) +
        num(r.elkX, 7) +
        num(r.elkO, 7) +
        num(r.searchX, 8) +
        num(r.searchO, 8) +
        mark
    );
  }
  console.log('  ' + '-'.repeat(66));
  console.log(
    '  ' +
      pad('TOTAL', 28) +
      num('', 4) +
      num('', 4) +
      num(exT, 7) +
      num(eoT, 7) +
      num(sxT, 8) +
      num(soT, 8)
  );
  const overlapDiagrams = rows.filter((r) => r.searchO > 0);
  console.log(
    `\n  search totals — crossings ${sxT} (ELK ${exT}), overlaps ${soT} (ELK ${eoT})`
  );
  console.log(
    `  search has overlaps on ${overlapDiagrams.length}/${rows.length} diagrams: ${overlapDiagrams.map((r) => r.name).join(', ') || '(none)'}\n`
  );
});
