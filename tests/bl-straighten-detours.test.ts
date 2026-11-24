// An arrow between groups runs straight (#2062, rubric rule 5): a route
// dagre sent far round is redrawn centre to centre when that costs nothing.
import { describe, it, expect, vi, afterEach } from 'vitest';
import dagre from '@dagrejs/dagre';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import {
  detectEdgeNodePierces,
  layoutBoxesAndLinesSearch,
} from '../src/boxes-and-lines/layout-search';
import type { BLLayoutResult } from '../src/boxes-and-lines/layout';

const realLayout = dagre.layout;
afterEach(() => vi.restoreAllMocks());

const len = (pts: { x: number; y: number }[]) =>
  pts.reduce(
    (s, p, k) =>
      k ? s + Math.hypot(p.x - pts[k - 1]!.x, p.y - pts[k - 1]!.y) : 0,
    0
  );

const route = (src: string) => {
  const parsed = parseBoxesAndLines(src);
  vi.spyOn(dagre, 'layout').mockImplementation((g, o) => {
    realLayout(g, o);
    const box = (v: string) =>
      g.node(v) as unknown as { x: number; y: number; width: number };
    const [a, b] = [box('A'), box('B')];
    const start = { x: a.x + a.width / 2, y: a.y };
    const end = { x: b.x - b.width / 2, y: b.y };
    const points = [
      start,
      { x: start.x + 10, y: a.y + 3000 },
      { x: end.x - 10, y: b.y + 3000 },
      end,
    ];
    for (const e of g.edges()) Object.assign(g.edge(e), { points });
  });
  return layoutBoxesAndLinesSearch(parsed, undefined, {
    configs: [{ ranker: 'network-simplex', nodesep: 50, ranksep: 60 }],
    sift: false,
  });
};

describe('straightenDetours', () => {
  it('straightens a long way round out of a group', async () => {
    const lay = await route(
      ['boxes-and-lines t', '', '[G]', '  A', 'B', 'A -> B'].join('\n')
    );
    const pts = lay.edges[0]!.points;
    const chord = Math.hypot(
      pts[pts.length - 1]!.x - pts[0]!.x,
      pts[pts.length - 1]!.y - pts[0]!.y
    );
    expect(pts).toHaveLength(2);
    expect(len(pts)).toBeLessThanOrEqual(1.3 * chord);
  });

  it('leaves an arrow between two ungrouped boxes alone', async () => {
    const lay = await route(
      ['boxes-and-lines t', '', 'A', 'B', 'A -> B'].join('\n')
    );
    expect(lay.edges[0]!.points.length).toBeGreaterThan(2);
  });
});

describe('detectEdgeNodePierces on a straight line', () => {
  it('sees a two-point line through a box', () => {
    const box = (label: string, x: number, y: number) => ({
      label,
      x,
      y,
      width: 100,
      height: 60,
    });
    const layout = {
      nodes: [box('A', 0, 0), box('M', 0, 200), box('B', 0, 400)],
      groups: [],
      edges: [
        {
          source: 'A',
          target: 'B',
          points: [
            { x: 0, y: 30 },
            { x: 0, y: 370 },
          ],
        },
      ],
    } as unknown as BLLayoutResult;
    expect(detectEdgeNodePierces(layout).map((p) => p.node)).toEqual(['M']);
  });
});
