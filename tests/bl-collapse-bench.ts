// Boxes-and-lines COLLAPSE-permutation benchmark — ELK vs the experimental
// search engine across every distinct collapse state of each grouped diagram.
// Run: pnpm bench:bl-collapse   (corpus = grouped gauntlet diagrams + extras)
//
// For each diagram with N groups we enumerate all 2^N collapse subsets, then
// canonicalize each to its distinct OUTCOME (collapsing a parent group hides its
// descendants, so {AWS, aws-web} == {AWS}). For every distinct state we lay out
// with both engines and report spline crossings + layout size. This is where the
// search engine's collapse-aware behaviour and stability get stressed hardest.
import { test } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { countSplineCrossings } from '../src/boxes-and-lines/layout-search';
import type { BLGroup } from '../src/boxes-and-lines/types';

const GAUNTLET =
  '/Users/demian/code/diagrammo/my-diagrams/sandbox/layout-gauntlet';

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
  return out;
}

// Ancestor labels of a group, walking parentGroup links.
function ancestorsOf(
  label: string,
  byLabel: ReadonlyMap<string, BLGroup>
): Set<string> {
  const out = new Set<string>();
  let cur = byLabel.get(label)?.parentGroup;
  while (cur) {
    out.add(cur);
    cur = byLabel.get(cur)?.parentGroup;
  }
  return out;
}

// Reduce a collapse subset to its distinct outcome: a group whose ancestor is
// also collapsed is redundant (the ancestor already hides it).
function canonical(
  subset: string[],
  byLabel: ReadonlyMap<string, BLGroup>
): string[] {
  const set = new Set(subset);
  return subset
    .filter((g) => {
      for (const a of ancestorsOf(g, byLabel)) if (set.has(a)) return false;
      return true;
    })
    .sort();
}

test('ELK vs search crossings across all collapse permutations', async () => {
  const pad = (s: string | number, w: number) => String(s).padEnd(w);
  const num = (s: string | number, w: number) => String(s).padStart(w);

  let grandElk = 0,
    grandSearch = 0,
    grandWins = 0,
    grandLoss = 0,
    grandTie = 0,
    grandStates = 0;

  for (const { name, src } of corpus()) {
    const base = parseBoxesAndLines(src);
    if (base.groups.length === 0) continue;
    const groups = base.groups.map((g) => g.label);
    const byLabel = new Map(base.groups.map((g) => [g.label, g]));

    // Enumerate 2^G subsets → canonical distinct outcomes.
    const seen = new Set<string>();
    const states: string[][] = [];
    for (let mask = 0; mask < 1 << groups.length; mask++) {
      const subset = groups.filter((_, i) => mask & (1 << i));
      const canon = canonical(subset, byLabel);
      const key = canon.join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      states.push(canon);
    }
    states.sort(
      (a, b) => a.length - b.length || a.join().localeCompare(b.join())
    );

    console.log(
      `\n  ${name}  —  ${groups.length} groups, ${states.length} distinct collapse states`
    );
    console.log(
      '  ' +
        pad('collapsed', 40) +
        num('ELK', 5) +
        num('search', 8) +
        num('Δ', 5) +
        '   ' +
        pad('ELK size', 12) +
        pad('search size', 12)
    );
    console.log('  ' + '-'.repeat(86));

    let dElk = 0,
      dSearch = 0,
      wins = 0,
      loss = 0,
      tie = 0;
    for (const state of states) {
      const set = new Set(state);
      const { parsed, collapsedChildCounts, originalGroups } =
        collapseBoxesAndLines(base, set);
      const info = { collapsedChildCounts, originalGroups };
      const elk = await layoutBoxesAndLines(parsed, info, {
        layoutMode: 'elk',
      });
      const search = await layoutBoxesAndLines(parsed, info, {
        layoutMode: 'search',
      });
      const ec = countSplineCrossings(elk);
      const sc = countSplineCrossings(search);
      dElk += ec;
      dSearch += sc;
      const d = sc - ec;
      if (d < 0) wins++;
      else if (d > 0) loss++;
      else tie++;
      const mark = d < 0 ? '  ✓' : d > 0 ? '  ✗' : '';
      const label =
        state.length === 0 ? '(none — fully expanded)' : state.join(', ');
      console.log(
        '  ' +
          pad(label.length > 38 ? label.slice(0, 37) + '…' : label, 40) +
          num(ec, 5) +
          num(sc, 8) +
          num(d > 0 ? '+' + d : d, 5) +
          mark +
          '   ' +
          pad(`${Math.round(elk.width)}×${Math.round(elk.height)}`, 12) +
          pad(`${Math.round(search.width)}×${Math.round(search.height)}`, 12)
      );
    }
    console.log('  ' + '-'.repeat(86));
    console.log(
      '  ' +
        pad(`TOTAL (${states.length} states)`, 40) +
        num(dElk, 5) +
        num(dSearch, 8) +
        num(dSearch - dElk, 5) +
        `     search wins ${wins} / loses ${loss} / ties ${tie}`
    );
    grandElk += dElk;
    grandSearch += dSearch;
    grandWins += wins;
    grandLoss += loss;
    grandTie += tie;
    grandStates += states.length;
  }

  console.log('\n  ' + '='.repeat(86));
  console.log(
    `  GRAND TOTAL across ${grandStates} collapse states:  ELK ${grandElk}  search ${grandSearch}  (Δ ${grandSearch - grandElk})`
  );
  console.log(
    `  search wins ${grandWins} / loses ${grandLoss} / ties ${grandTie}\n`
  );
}, 300_000);
