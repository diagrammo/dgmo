import { describe, it, expect } from 'vitest';
import {
  collapseTree,
  collectTreeIds,
  type TreeCollapseShape,
} from '../src/utils/collapse-engine/tree';
import {
  reterminateEdges,
  type EdgeEndpointShape,
} from '../src/utils/collapse-engine/tree-edges';

// Tests the collapse engine THROUGH ITS INTERFACE (descriptor invariants) with a
// synthetic node/edge type — not through any one chart type. The per-chart tests
// (org/sitemap/mindmap/sequence/boxes) cover the wiring; these cover the engine.

interface TNode {
  id: string;
  isContainer: boolean;
  children: TNode[];
}
interface TEdge {
  from: string;
  to: string;
  tag?: string;
}

const node = (
  id: string,
  children: TNode[] = [],
  isContainer = false
): TNode => ({ id, isContainer, children });

const cloneTNode = (n: TNode): TNode => ({
  id: n.id,
  isContainer: n.isContainer,
  children: n.children.map(cloneTNode),
});

const makeShape = (countAll: boolean): TreeCollapseShape<TNode> => ({
  getId: (n) => n.id,
  getChildren: (n) => n.children,
  clone: cloneTNode,
  setChildren: (n, children) => {
    n.children = children as TNode[];
  },
  countsAsHidden: (n) => (countAll ? true : !n.isContainer),
});

const edgeShape: EdgeEndpointShape<TEdge> = {
  getSource: (e) => e.from,
  getTarget: (e) => e.to,
  withEndpoints: (e, from, to) => ({ ...e, from, to }),
};

describe('collapseTree (engine interface)', () => {
  it('hides exactly the descendants of a collapsed node (count-all rule)', () => {
    const roots = [node('root', [node('a', [node('a1')]), node('b')])];
    const { roots: out, hiddenCounts } = collapseTree(
      roots,
      new Set(['root']),
      makeShape(true)
    );
    expect(hiddenCounts.get('root')).toBe(3); // a, a1, b
    expect(out[0].children).toHaveLength(0);
  });

  it('count rule excludes containers when the descriptor says so', () => {
    const roots = [node('root', [node('grp', [node('x')], true), node('y')])];
    const { hiddenCounts } = collapseTree(
      roots,
      new Set(['root']),
      makeShape(false)
    );
    // grp is a container → 0; x → 1; y → 1 = 2 (vs 3 under count-all).
    expect(hiddenCounts.get('root')).toBe(2);
  });

  it('filtered output contains no hidden descendant', () => {
    const roots = [node('root', [node('a', [node('a1')])])];
    const { roots: out } = collapseTree(roots, new Set(['a']), makeShape(true));
    const visible = collectTreeIds(out, makeShape(true));
    expect(visible.has('a')).toBe(true);
    expect(visible.has('a1')).toBe(false); // pruned
  });

  it('tallies from the original tree for a nested collapse', () => {
    const roots = [node('root', [node('a', [node('a1', [node('a2')])])])];
    const { hiddenCounts } = collapseTree(
      roots,
      new Set(['a']),
      makeShape(true)
    );
    expect(hiddenCounts.get('a')).toBe(2); // a1, a2
  });

  it('never mutates the input tree', () => {
    const roots = [node('root', [node('a'), node('b')])];
    collapseTree(roots, new Set(['root']), makeShape(true));
    expect(roots[0].children).toHaveLength(2);
  });

  it('deep-clones even when nothing matches (no shared node refs)', () => {
    const roots = [node('root', [node('a')])];
    const { roots: out, hiddenCounts } = collapseTree(
      roots,
      new Set(['absent']),
      makeShape(true)
    );
    expect(hiddenCounts.size).toBe(0);
    expect(out[0]).not.toBe(roots[0]);
    expect(out[0].children[0]).not.toBe(roots[0].children[0]);
  });

  it('records no count for a collapsed leaf', () => {
    const roots = [node('root', [node('leaf')])];
    const { hiddenCounts } = collapseTree(
      roots,
      new Set(['leaf']),
      makeShape(true)
    );
    expect(hiddenCounts.has('leaf')).toBe(false);
  });
});

describe('reterminateEdges (engine interface)', () => {
  it('re-terminates hidden endpoints, drops self-loops, keeps visible edges', () => {
    const roots = [
      node('root', [
        node('grp', [node('x'), node('y')], true),
        node('outside'),
      ]),
    ];
    const shape = makeShape(false);
    const collapsed = new Set(['grp']);
    const { roots: pruned } = collapseTree(roots, collapsed, shape);

    const edges: TEdge[] = [
      { from: 'outside', to: 'x', tag: 'in' }, // x hidden → reterminate to grp
      { from: 'x', to: 'y', tag: 'internal' }, // both → grp → self-loop dropped
      { from: 'outside', to: 'root', tag: 'keep' }, // both visible → kept
    ];

    const out = reterminateEdges(
      roots,
      pruned,
      edges,
      collapsed,
      shape,
      edgeShape
    );

    expect(out).toHaveLength(2);
    const inEdge = out.find((e) => e.tag === 'in')!;
    expect(inEdge.to).toBe('grp');
    expect(out.find((e) => e.tag === 'internal')).toBeUndefined();
    expect(out.find((e) => e.tag === 'keep')).toBeDefined();
    // No edge terminates on a hidden node.
    const visible = collectTreeIds(pruned, shape);
    for (const e of out) {
      expect(visible.has(e.from)).toBe(true);
      expect(visible.has(e.to)).toBe(true);
    }
  });

  it('does not dedup parallel edges that re-terminate to the same pair', () => {
    const roots = [
      node('root', [
        node('grp', [node('x'), node('y')], true),
        node('outside'),
      ]),
    ];
    const shape = makeShape(false);
    const collapsed = new Set(['grp']);
    const { roots: pruned } = collapseTree(roots, collapsed, shape);

    const edges: TEdge[] = [
      { from: 'outside', to: 'x', tag: 'a' },
      { from: 'outside', to: 'y', tag: 'b' },
    ];
    const out = reterminateEdges(
      roots,
      pruned,
      edges,
      collapsed,
      shape,
      edgeShape
    );
    // Both reroute to outside→grp but keep distinct labels (no dedup).
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.to === 'grp')).toBe(true);
  });
});
