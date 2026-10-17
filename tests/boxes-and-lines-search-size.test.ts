import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import {
  layoutBoxesAndLinesSearch,
  searchBudget,
} from '../src/boxes-and-lines/layout-search';

// #1088: a 13-node diagram was given twice the seed-shuffles of a 12-node one
// (40 vs 20), so gallery/boxes-and-lines.dgmo placed 49 dagre candidates a
// search and took ~1.5 s to render. Graphs up to 22 nodes now get 20 seeds.
describe('boxes-and-lines search size', () => {
  it('gives every graph of up to 22 nodes 20 seed-shuffles', () => {
    for (const n of [1, 12, 13, 18, 22])
      expect(searchBudget(n, n).seeds).toBe(20);
    expect(searchBudget(23, 23).seeds).toBe(22);
    expect(searchBudget(36, 36).seeds).toBe(10);
  });

  it('places 29 base candidates for the 13-node gallery fixture', async () => {
    const src = readFileSync(
      `${__dirname}/../gallery/fixtures/boxes-and-lines.dgmo`,
      'utf8'
    );
    const parsed = parseBoxesAndLines(src);
    expect(parsed.nodes).toHaveLength(13);
    // The progress total is the candidate configs plus the refine set (6):
    // 9 ranker x spacing configs + 20 seeds + 6.
    let total = 0;
    await layoutBoxesAndLinesSearch(parsed, undefined, {
      onProgress: (_done, t) => {
        total = t;
      },
    });
    expect(total).toBe(9 + 20 + 6);
  });
});
