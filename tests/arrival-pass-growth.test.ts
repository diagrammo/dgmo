import { describe, expect, it } from 'vitest';
import { parseState } from '../src/graph/state-parser';
import { layoutGraph } from '../src/graph/layout';
import { SEARCH_SIZE_LIMIT } from '../src/utils/placement-search';
import { measureGrowth } from './perf-helpers';

// The issue's cyclic generator (#1890): state i leads to i + 1 and to
// (7i + 3) mod n, so the graph never reaches zero crossings.
function cyclic(n: number) {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(`S${i} -go${i}-> S${(i + 1) % n}`);
    lines.push(`S${i} -alt-> S${(7 * i + 3) % n}`);
  }
  const parsed = parseState(lines.join('\n'));
  expect(parsed.error).toBeNull();
  return parsed;
}

describe('the arrival pass on a large diagram (#1890)', () => {
  const small = cyclic(30);
  const large = cyclic(90);

  it('both sizes are past the size limit', () => {
    for (const p of [small, large]) {
      expect(p.nodes.length + p.edges.length).toBeGreaterThan(
        SEARCH_SIZE_LIMIT
      );
    }
  });

  it('costs well under the cube of the diagram size', () => {
    // Scoring every arrival against every other edge made the whole layout
    // grow with about the cube of the diagram (measured 3.0 on 2026-11-11);
    // past the limit the arrivals are squared at once, which leaves dagre's
    // own near-quadratic cost (measured 1.9), so the bound sits between.
    const exponent = measureGrowth({
      small: 30,
      large: 90,
      prepare: (n) => (n === 30 ? small : large),
      run: (p) => layoutGraph(p),
      limit: 2.5,
      minMs: 5,
      rounds: 3,
      attempts: 2,
    });
    expect(exponent).toBeLessThan(2.5);
  }, 120_000);
});
