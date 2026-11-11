import dagre from '@dagrejs/dagre';
import { describe, expect, it } from 'vitest';
import { dagreScored, searchPlacement } from '../src/utils/placement-search';
import { measureGrowth } from './perf-helpers';

// The issue's cyclic generator (#1890): node i leads to i + 1 and to
// (7i + 3) mod n, so the graph never reaches zero crossings and a search
// would try every candidate.
function cyclic(n: number) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `S${i}` }));
  const edges = nodes.flatMap((_, i) => [
    { source: `S${i}`, target: `S${(i + 1) % n}`, name: String(2 * i) },
    { source: `S${i}`, target: `S${(7 * i + 3) % n}`, name: String(2 * i + 1) },
  ]);
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) g.setNode(node.id, { width: 120, height: 40 });
  for (const e of edges) g.setEdge(e.source, e.target, {}, e.name);
  dagre.layout(g);
  return { g, nodes, edges };
}

// Every candidate returns the same laid-out graph, so what is timed is the
// search's own work — scoring and comparing candidates — and not dagre's.
function search(d: ReturnType<typeof cyclic>): number {
  let placed = 0;
  searchPlacement(
    'TB',
    () => {
      placed++;
      return d.g;
    },
    (g) => dagreScored(g, d.nodes, d.edges, (e) => e.name)
  );
  return placed;
}

describe('searchPlacement on a large diagram (#1890)', () => {
  const small = cyclic(30);
  const large = cyclic(90);

  it('lays a diagram past the size limit out once, with no candidates', () => {
    expect(search(large)).toBe(1);
  });

  it('costs about linearly in the diagram size, not with its square', () => {
    // A search past the size limit takes microseconds; measureGrowth repeats
    // each sample past timer resolution and interleaves the sizes.
    const exponent = measureGrowth({
      small: 30,
      large: 90,
      prepare: (n) => (n === 30 ? small : large),
      run: search,
      limit: 1.5,
      minMs: 20,
    });
    expect(exponent).toBeLessThan(1.5);
  });
});
