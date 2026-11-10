import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { layoutGraph, type LayoutResult } from '../src/graph/layout';
import { parseState } from '../src/graph/state-parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { countSplineCrossings } from '../src/boxes-and-lines/layout-search';
import { unbundleEdges } from '../src/graph/edge-ports';
import type { BLLayoutResult } from '../src/boxes-and-lines/layout';

type Pt = { x: number; y: number };

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, '../gallery/fixtures', name), 'utf8');

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

const edgesOf = (lay: LayoutResult, label: string) =>
  lay.edges.filter((e) => e.label === label);

/** Every pair of edges into one node whose arrowheads land within `gap` px. */
function bundledArrivals(lay: LayoutResult, gap: number): string[] {
  const out: string[] = [];
  const es = lay.edges.filter((e) => e.source !== e.target);
  for (let a = 0; a < es.length; a++)
    for (let b = a + 1; b < es.length; b++) {
      const A = es[a]!;
      const B = es[b]!;
      if (A.target !== B.target) continue;
      if (A.source === B.source && A.label === B.label) continue; // one edge, restated
      const d = dist(A.points.at(-1)!, B.points.at(-1)!);
      if (d < gap) out.push(`${A.source}|${B.source} -> ${A.target}`);
    }
  return out;
}

const crossings = (lay: LayoutResult): number =>
  countSplineCrossings({
    nodes: lay.nodes.map((n) => ({ ...n, label: n.id })),
    edges: lay.edges,
    groups: [],
    width: lay.width,
    height: lay.height,
  } as unknown as BLLayoutResult);

// Two transitions between the same pair of states (#1839 slice (b)).
const PARALLEL = `state Parallel

[*] -> Idle
Idle
  -start-> Running
  -resume-> Running
Running
  -stop-> Idle
  -done-> [*]
`;

describe('graph edges into one node are unbundled (#1839)', () => {
  it('routes two transitions between the same states apart', () => {
    const lay = layoutGraph(parseState(PARALLEL));
    const [start] = edgesOf(lay, 'start');
    const [resume] = edgesOf(lay, 'resume');
    expect(start && resume).toBeTruthy();
    // dagre gave both one route; each now has its own, a lane apart.
    expect(dist(start!.points.at(-1)!, resume!.points.at(-1)!)).toBeGreaterThan(
      14
    );
    expect(dist(start!.points[0]!, resume!.points[0]!)).toBeGreaterThan(14);
    const mid = (p: Pt[]) => p[Math.floor(p.length / 2)]!;
    expect(dist(mid(start!.points), mid(resume!.points))).toBeGreaterThan(14);
    expect(crossings(lay)).toBe(0);
  });

  it('spreads arrows that converge on one spot of a final state', () => {
    // Refunded and Delivered both end at [*]; dagre landed them 1 px apart.
    const lay = layoutGraph(parseState(fixture('state.dgmo')));
    expect(bundledArrivals(lay, 12)).toEqual([]);
  });

  it('spreads converging arrows in the tagged state fixture', () => {
    // Published and Rejected into [*]: 5.7 px apart before.
    const lay = layoutGraph(parseState(fixture('state-tags.dgmo')));
    expect(bundledArrivals(lay, 12)).toEqual([]);
  });

  it('keeps an edge written twice as one curve', () => {
    // The CI/CD flowchart reaches `Notify Dev -> Fix & Retry` from two
    // chains: one edge, restated, so its two copies share one route.
    const lay = layoutGraph(parseFlowchart(fixture('flowchart-complex.dgmo')));
    const twins = lay.edges.filter(
      (e) => e.source === 'io:notify dev' && e.target === 'terminal:fix & retry'
    );
    expect(twins).toHaveLength(2);
    expect(twins[0]!.points).toEqual(twins[1]!.points);
  });

  it('leaves routes with nothing to fix as they were', () => {
    const boxes = new Map([
      ['a', { x: 0, y: 0, width: 100, height: 40 }],
      ['b', { x: 0, y: 200, width: 100, height: 40 }],
      ['c', { x: 200, y: 0, width: 100, height: 40 }],
    ]);
    const routes = [
      [
        { x: 0, y: 20 },
        { x: 0, y: 100 },
        { x: -30, y: 180 },
      ],
      [
        { x: 200, y: 20 },
        { x: 120, y: 100 },
        { x: 30, y: 180 },
      ],
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'b' },
    ];
    expect(unbundleEdges(edges, routes, boxes, () => 0)).toEqual(routes);
  });

  it('drops the arrival spread when it would add a crossing', () => {
    const boxes = new Map([
      ['a', { x: 0, y: 0, width: 100, height: 40 }],
      ['b', { x: 0, y: 200, width: 100, height: 40 }],
      ['c', { x: 200, y: 0, width: 100, height: 40 }],
    ]);
    const routes = [
      [
        { x: 0, y: 20 },
        { x: 0, y: 100 },
        { x: 0, y: 180 },
      ],
      [
        { x: 200, y: 20 },
        { x: 100, y: 100 },
        { x: 2, y: 180 },
      ],
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'b' },
    ];
    // Spread on its own: the two arrows end a full gap apart.
    const spread = unbundleEdges(edges, routes, boxes, () => 0);
    expect(dist(spread[0]!.at(-1)!, spread[1]!.at(-1)!)).toBeGreaterThan(12);
    // A counter that sees a crossing in any moved route keeps them as dagre had.
    const moved = (rs: readonly (readonly Pt[])[]) =>
      rs.some((r, i) => r.at(-1)!.x !== routes[i]!.at(-1)!.x) ? 1 : 0;
    expect(unbundleEdges(edges, routes, boxes, moved)).toEqual(routes);
  });
});
