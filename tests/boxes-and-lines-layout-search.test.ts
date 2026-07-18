import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import {
  layoutBoxesAndLines,
  type BLLayoutResult,
} from '../src/boxes-and-lines/layout';
import {
  layoutBoxesAndLinesSearch,
  countSplineCrossings,
  type BLSearchConfig,
} from '../src/boxes-and-lines/layout-search';

// A small dense fixture (K-ish connectivity + a back-edge) — enough edges that
// the seed search has real choices to rank, so determinism is meaningful.
const DENSE = [
  'boxes-and-lines',
  'A -> B',
  'A -> C',
  'B -> D',
  'C -> D',
  'A -> D',
  'B -> C',
  'D -> A',
].join('\n');

const LABELED = [
  'boxes-and-lines',
  'API -queries the primary replica for reads-> DB',
  'API -writes through the cache invalidation path-> Cache',
  'Cache -evicts stale entries back to-> DB',
  'Worker -drains the outbox table into-> DB',
  'API -enqueues background jobs onto-> Worker',
].join('\n');

/** Geometry fingerprint — node positions + edge waypoints only. */
function geom(layout: BLLayoutResult): string {
  return JSON.stringify({
    nodes: layout.nodes.map((n) => [n.label, n.x, n.y, n.width, n.height]),
    edges: layout.edges.map((e) => [e.source, e.target, e.points]),
  });
}

/** Minimal synthetic layout for exercising countSplineCrossings directly. */
function syntheticLayout(
  nodes: { label: string; x: number; y: number }[],
  edges: {
    source: string;
    target: string;
    points: { x: number; y: number }[];
  }[]
): BLLayoutResult {
  return {
    nodes: nodes.map((n) => ({ ...n, width: 40, height: 24 })),
    edges: edges.map((e, i) => ({
      source: e.source,
      target: e.target,
      bidirectional: false,
      lineNumber: i + 1,
      points: e.points,
      yOffset: 0,
      parallelCount: 1,
      metadata: {},
    })),
    groups: [],
    width: 400,
    height: 400,
  };
}

describe('boxes-and-lines layout search', () => {
  it('is deterministic — two searches over the same input produce identical geometry', async () => {
    const a = await layoutBoxesAndLinesSearch(parseBoxesAndLines(DENSE));
    const b = await layoutBoxesAndLinesSearch(parseBoxesAndLines(DENSE));
    expect(geom(a)).toBe(geom(b));
  });

  it('reports the top-ranked candidate configs via onTopConfigs', async () => {
    let top: BLSearchConfig[] = [];
    await layoutBoxesAndLinesSearch(parseBoxesAndLines(DENSE), undefined, {
      onTopConfigs: (cfgs) => {
        top = cfgs;
      },
    });
    expect(top.length).toBeGreaterThan(0);
    // Default refineK is 6; escalation may add up to ESCALATE_REFINE more.
    expect(top.length).toBeLessThanOrEqual(16);
    for (const cfg of top) {
      expect(typeof cfg.ranker).toBe('string');
      expect(cfg.nodesep).toBeGreaterThan(0);
      expect(cfg.ranksep).toBeGreaterThan(0);
    }
  });

  it('restricting the pool to reported configs yields a complete, deterministic layout', async () => {
    const parsed = parseBoxesAndLines(LABELED);
    let top: BLSearchConfig[] = [];
    await layoutBoxesAndLinesSearch(parsed, undefined, {
      onTopConfigs: (cfgs) => {
        top = cfgs;
      },
    });
    expect(top.length).toBeGreaterThan(0);

    // The label-reserving relayout path: same configs, reservation on.
    const relaidA = await layoutBoxesAndLinesSearch(parsed, undefined, {
      configs: top,
      reserveEdgeLabels: true,
    });
    const relaidB = await layoutBoxesAndLinesSearch(parsed, undefined, {
      configs: top,
      reserveEdgeLabels: true,
    });
    expect(geom(relaidA)).toBe(geom(relaidB));
    // Every node/edge survives the restricted-pool relayout.
    expect(relaidA.nodes.map((n) => n.label).sort()).toEqual(
      parsed.nodes.map((n) => n.label).sort()
    );
    expect(relaidA.edges).toHaveLength(parsed.edges.length);
  });

  it('full layout pipeline (with the edge-label relayout escalation) is deterministic', async () => {
    const a = await layoutBoxesAndLines(parseBoxesAndLines(LABELED));
    const b = await layoutBoxesAndLines(parseBoxesAndLines(LABELED));
    expect(geom(a)).toBe(geom(b));
  });
});

describe('countSplineCrossings', () => {
  it('counts an X-crossing between two unrelated edges', () => {
    const layout = syntheticLayout(
      [
        { label: 'A', x: 0, y: 50 },
        { label: 'B', x: 200, y: 150 },
        { label: 'C', x: 0, y: 150 },
        { label: 'D', x: 200, y: 50 },
      ],
      [
        {
          source: 'A',
          target: 'B',
          points: [
            { x: 30, y: 50 },
            { x: 170, y: 150 },
          ],
        },
        {
          source: 'C',
          target: 'D',
          points: [
            { x: 30, y: 150 },
            { x: 170, y: 50 },
          ],
        },
      ]
    );
    expect(countSplineCrossings(layout)).toBe(1);
  });

  it('returns 0 for bbox-disjoint edges (AABB pair reject cannot change counts)', () => {
    const layout = syntheticLayout(
      [
        { label: 'A', x: 0, y: 0 },
        { label: 'B', x: 200, y: 0 },
        { label: 'C', x: 0, y: 500 },
        { label: 'D', x: 200, y: 500 },
      ],
      [
        {
          source: 'A',
          target: 'B',
          points: [
            { x: 30, y: 0 },
            { x: 170, y: 0 },
          ],
        },
        {
          source: 'C',
          target: 'D',
          points: [
            { x: 30, y: 500 },
            { x: 170, y: 500 },
          ],
        },
      ]
    );
    expect(countSplineCrossings(layout)).toBe(0);
  });

  it('matches counts on real search output regardless of the floor early-out', async () => {
    const layout = await layoutBoxesAndLinesSearch(parseBoxesAndLines(DENSE));
    const exact = countSplineCrossings(layout);
    expect(countSplineCrossings(layout, Infinity)).toBe(exact);
    // A floor at/above the exact count must not alter the result.
    expect(countSplineCrossings(layout, exact)).toBe(exact);
  });
});
