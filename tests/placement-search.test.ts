import { describe, it, expect } from 'vitest';
import {
  searchPlacement,
  type ScoredPlacement,
  type Shuffle,
} from '../src/utils/placement-search';

// Four boxes, two edges. CROSSED draws the edges as an X; CLEAN draws them
// side by side. Both run top to bottom, so neither draws an edge backward.
const box = (id: string, x: number, y: number) => ({
  id,
  x,
  y,
  width: 20,
  height: 20,
});
const CROSSED: ScoredPlacement = {
  nodes: [
    box('a', 0, 0),
    box('b', 200, 200),
    box('c', 200, 0),
    box('d', 0, 200),
  ],
  edges: [
    {
      source: 'a',
      target: 'b',
      points: [
        { x: 0, y: 0 },
        { x: 90, y: 100 },
        { x: 200, y: 200 },
      ],
    },
    {
      source: 'c',
      target: 'd',
      points: [
        { x: 200, y: 0 },
        { x: 110, y: 100 },
        { x: 0, y: 200 },
      ],
    },
  ],
};
const CLEAN: ScoredPlacement = {
  nodes: [
    box('a', 0, 0),
    box('b', 0, 200),
    box('c', 200, 0),
    box('d', 200, 200),
  ],
  edges: [
    {
      source: 'a',
      target: 'b',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 0, y: 200 },
      ],
    },
    {
      source: 'c',
      target: 'd',
      points: [
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ],
    },
  ],
};

/** A fake dagre: every call is logged; `pick` chooses each call's placement. */
function fakePlace(
  pick: (ranker: string, seedIndex?: number) => ScoredPlacement
) {
  const calls: string[] = [];
  let seeds = 0;
  const place = (ranker: string, shuffle?: Shuffle) => {
    const seedIndex = shuffle ? seeds++ : undefined;
    calls.push(seedIndex === undefined ? ranker : `seed${seedIndex}`);
    return pick(ranker, seedIndex);
  };
  return { place, calls };
}

describe('searchPlacement — when the seed-shuffles stop (#1281)', () => {
  it('a placement with nothing to fix runs dagre once', () => {
    const { place, calls } = fakePlace(() => CLEAN);
    searchPlacement('TB', place, (g) => g);
    expect(calls).toEqual(['network-simplex']);
  });

  it('stops after two seed-shuffles in a row that do not lower badness', () => {
    // A crossing no candidate removes: before #1281 all 6 seeds ran (9 layouts).
    const { place, calls } = fakePlace(() => CROSSED);
    const { g } = searchPlacement('TB', place, (p) => p);
    expect(g).toBe(CROSSED);
    expect(calls).toEqual([
      'network-simplex',
      'tight-tree',
      'longest-path',
      'seed0',
      'seed1',
    ]);
  });

  it('still finds a winner straight after one losing seed', () => {
    const { place, calls } = fakePlace((_r, seed) =>
      seed === 1 ? CLEAN : CROSSED
    );
    const { g } = searchPlacement('TB', place, (p) => p);
    expect(g).toBe(CLEAN);
    expect(calls.at(-1)).toBe('seed1');
  });
});
