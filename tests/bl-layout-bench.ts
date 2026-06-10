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
  countEdgeNodePierces,
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
    elkP: number;
    searchX: number;
    searchO: number;
    searchP: number;
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
      elkP: countEdgeNodePierces(elk),
      searchX: countSplineCrossings(search),
      searchO: countEdgeOverlaps(search),
      searchP: countEdgeNodePierces(search),
    });
  }
  const pad = (s: string | number, w: number) => String(s).padEnd(w);
  const num = (s: string | number, w: number) => String(s).padStart(w);
  // X = true crossings, O = overlap runs (lines stepping on each other),
  // P = edges piercing unrelated node boxes. All three count as "crossings".
  let exT = 0,
    eoT = 0,
    epT = 0,
    sxT = 0,
    soT = 0,
    spT = 0;
  console.log(
    '\n  ' +
      pad('diagram', 26) +
      num('n', 4) +
      num('e', 4) +
      num('E:X', 5) +
      num('O', 4) +
      num('P', 4) +
      num('S:X', 6) +
      num('O', 4) +
      num('P', 4)
  );
  console.log('  ' + '-'.repeat(63));
  for (const r of rows) {
    exT += r.elkX;
    eoT += r.elkO;
    epT += r.elkP;
    sxT += r.searchX;
    soT += r.searchO;
    spT += r.searchP;
    const flags =
      (r.searchO > 0 ? ' ⚠O' : '') + (r.searchP > 0 ? ' ⚠pierce' : '');
    console.log(
      '  ' +
        pad(r.name, 26) +
        num(r.n, 4) +
        num(r.e, 4) +
        num(r.elkX, 5) +
        num(r.elkO, 4) +
        num(r.elkP, 4) +
        num(r.searchX, 6) +
        num(r.searchO, 4) +
        num(r.searchP, 4) +
        flags
    );
  }
  console.log('  ' + '-'.repeat(63));
  console.log(
    '  ' +
      pad('TOTAL', 26) +
      num('', 4) +
      num('', 4) +
      num(exT, 5) +
      num(eoT, 4) +
      num(epT, 4) +
      num(sxT, 6) +
      num(soT, 4) +
      num(spT, 4)
  );
  console.log(
    `\n  search badness X+O+P = ${sxT + soT + spT}  (ELK ${exT + eoT + epT})  —  crossings ${sxT}/${exT}, overlaps ${soT}/${eoT}, pierces ${spT}/${epT}`
  );
  const dirty = rows.filter((r) => r.searchO > 0 || r.searchP > 0);
  console.log(
    `  search overlaps/pierces on ${dirty.length}/${rows.length}: ${dirty.map((r) => r.name).join(', ') || '(none)'}\n`
  );
});
