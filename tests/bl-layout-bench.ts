// Boxes-and-lines layout benchmark — the search engine's badness across the
// corpus, scored with the SAME crossing counter the engine optimizes against.
// Run: pnpm bench:bl   (corpus = gauntlet + gallery fixtures)
//
// Use this to tune layout-search.ts against numbers, not vibes. (ELK was the
// historical baseline; it has since been removed — search is the only engine.)
import { test } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
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

test('search engine — crossings + overlaps + pierces across corpus', async () => {
  const rows: {
    name: string;
    n: number;
    e: number;
    x: number;
    o: number;
    p: number;
  }[] = [];
  for (const { name, src } of corpus()) {
    const parsed = parseBoxesAndLines(src);
    const search = await layoutBoxesAndLinesSearch(parsed);
    rows.push({
      name,
      n: parsed.nodes.length,
      e: parsed.edges.length,
      x: countSplineCrossings(search),
      o: countEdgeOverlaps(search),
      p: countEdgeNodePierces(search),
    });
  }
  const pad = (s: string | number, w: number) => String(s).padEnd(w);
  const num = (s: string | number, w: number) => String(s).padStart(w);
  // X = true crossings, O = overlap runs (lines stepping on each other),
  // P = edges piercing unrelated node boxes. All three count as "crossings".
  let xT = 0,
    oT = 0,
    pT = 0;
  console.log(
    '\n  ' +
      pad('diagram', 26) +
      num('n', 4) +
      num('e', 4) +
      num('X', 5) +
      num('O', 4) +
      num('P', 4)
  );
  console.log('  ' + '-'.repeat(47));
  for (const r of rows) {
    xT += r.x;
    oT += r.o;
    pT += r.p;
    const flags = (r.o > 0 ? ' ⚠O' : '') + (r.p > 0 ? ' ⚠pierce' : '');
    console.log(
      '  ' +
        pad(r.name, 26) +
        num(r.n, 4) +
        num(r.e, 4) +
        num(r.x, 5) +
        num(r.o, 4) +
        num(r.p, 4) +
        flags
    );
  }
  console.log('  ' + '-'.repeat(47));
  console.log(
    '  ' +
      pad('TOTAL', 26) +
      num('', 4) +
      num('', 4) +
      num(xT, 5) +
      num(oT, 4) +
      num(pT, 4)
  );
  console.log(
    `\n  badness X+O+P = ${xT + oT + pT}  —  X ${xT}, O ${oT}, P ${pT}`
  );
  const dirty = rows.filter((r) => r.o > 0 || r.p > 0);
  console.log(
    `  overlaps/pierces on ${dirty.length}/${rows.length}: ${dirty.map((r) => r.name).join(', ') || '(none)'}\n`
  );
});
