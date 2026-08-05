import { describe, it, expect } from 'vitest';
import {
  createLabelPlacement,
  rectsOverlap,
  type LabelRect,
  type Leader,
} from '../src/label-layout';

// Placement bookkeeping used to live in `map/layout.ts` as three bare arrays the
// greedy loop had to remember to push onto. Testing it meant rendering a map.
// It is state now, so it can be driven directly: commit something, assert what
// the next candidate sees.

const rect = (x: number, y: number, w = 20, h = 10): LabelRect => ({
  x,
  y,
  w,
  h,
});

describe('label placement state', () => {
  it('an empty pass blocks nothing', () => {
    const p = createLabelPlacement();
    expect(p.hitsPlaced(rect(0, 0))).toBe(false);
    expect(p.hitsObstacle(rect(0, 0))).toBe(false);
    expect(p.hitsMarker(rect(0, 0))).toBe(false);
    expect(p.placed).toHaveLength(0);
  });

  it('a committed box blocks the next candidate that overlaps it', () => {
    const p = createLabelPlacement();
    expect(p.hitsPlaced(rect(10, 10))).toBe(false);
    p.commit(rect(10, 10));
    expect(p.hitsPlaced(rect(15, 12))).toBe(true); // overlapping
    expect(p.hitsPlaced(rect(40, 40))).toBe(false); // clear
  });

  it('reserved boxes block from the very first candidate', () => {
    // The map seeds this with the title band and legend overlay, which must
    // block a region label placed before anything else has been committed.
    const p = createLabelPlacement({ reserved: [rect(0, 0, 200, 30)] });
    expect(p.hitsPlaced(rect(50, 10))).toBe(true);
    expect(p.placed).toHaveLength(1);
  });

  it('static obstacles and markers are separate questions from placed boxes', () => {
    // The map asks these separately: a region name yields to a POI dot but is
    // measured against other region labels with a different footprint.
    const p = createLabelPlacement({
      obstacles: [rect(100, 100, 30, 30)],
      markers: [{ cx: 200, cy: 200, r: 8 }],
    });
    const onObstacle = rect(105, 105);
    const onMarker = rect(195, 195);

    expect(p.hitsObstacle(onObstacle)).toBe(true);
    expect(p.hitsPlaced(onObstacle)).toBe(false);

    expect(p.hitsMarker(onMarker)).toBe(true);
    expect(p.hitsPlaced(onMarker)).toBe(false);
  });

  it('a committed leader blocks a later one that would cross it', () => {
    const p = createLabelPlacement();
    const first: Leader = [0, 0, 100, 100];
    p.commit(rect(100, 100), first);

    const crossing: Leader = [0, 100, 100, 0];
    const parallel: Leader = [0, 40, 100, 140];
    expect(p.leaderCrosses(crossing)).toBe(true);
    expect(p.leaderCrosses(parallel)).toBe(false);
  });

  it('a leader is blocked by a label box already placed', () => {
    const p = createLabelPlacement();
    p.commit(rect(40, 40, 20, 20));
    // Runs straight through the committed box.
    expect(p.leaderHitsPlaced([0, 50, 100, 50])).toBe(true);
    // Passes well below it.
    expect(p.leaderHitsPlaced([0, 90, 100, 90])).toBe(false);
  });

  it('committing without a leader leaves leader state untouched', () => {
    // In-place region names commit a box and no leader; only a short-hop
    // callout draws one. A box-only commit must not make the next leader think
    // it is crossing something.
    const p = createLabelPlacement();
    p.commit(rect(0, 0, 200, 200));
    expect(p.leaderCrosses([10, 10, 20, 20])).toBe(false);
  });

  it('greedy first-wins: the loser of a contested spot leaves the winner placed', () => {
    // Two regions want the same spot. The pass commits the first and the second
    // must see it — the exact invariant a forgotten push used to break.
    const p = createLabelPlacement();
    const contested = rect(50, 50, 40, 20);
    const winner = { ...contested };
    const loser = { ...contested, x: 60 };

    expect(p.hitsPlaced(winner)).toBe(false);
    p.commit(winner);

    expect(p.hitsPlaced(loser)).toBe(true);
    expect(p.placed).toHaveLength(1);
    expect(rectsOverlap(p.placed[0]!, loser)).toBe(true);
  });
});
