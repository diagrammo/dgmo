import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import {
  countSplineCrossings,
  countEdgeOverlaps,
} from '../src/boxes-and-lines/layout-search';
import type { BLLayoutResult } from '../src/boxes-and-lines/types';

// A two-way pair — one edge A→B and one edge B→A — is fanned by
// applyParallelEdgeOffsets into two lanes. The two lanes must not touch: the
// reader is meant to see one line out and one line back, and an X in the middle
// says the opposite. Reported on a real diagram where the two-way pairs were the
// ONLY thing crossing on the whole canvas (#642).
//
// 🔴 Score with the ENGINE's own counters, not a hand-rolled segment test. They
// flatten the curveBasis spline the renderer actually draws, and they discount
// intersections near a shared endpoint — two edges meeting at the same node
// touch there by construction, and counting that would make every pair fail.

type Finding = { pair: string; crossings: number; overlaps: number };

/** Every {A→B, B→A} pair in the layout, scored on its own two edges. */
function bidirectionalPairs(layout: BLLayoutResult): Finding[] {
  const out: Finding[] = [];
  for (let i = 0; i < layout.edges.length; i++)
    for (let j = i + 1; j < layout.edges.length; j++) {
      const a = layout.edges[i]!;
      const b = layout.edges[j]!;
      if (!(a.source === b.target && a.target === b.source)) continue;
      // A two-edge sub-layout keeps the node rects (the counters need them for
      // the shared-endpoint discount) while isolating this pair's own geometry.
      const sub: BLLayoutResult = { ...layout, edges: [a, b] };
      out.push({
        pair: `${a.source} <-> ${a.target}`,
        crossings: countSplineCrossings(sub),
        overlaps: countEdgeOverlaps(sub),
      });
    }
  return out;
}

async function pairsOf(src: string): Promise<Finding[]> {
  const layout = await layoutBoxesAndLines(parseBoxesAndLines(src));
  return bidirectionalPairs(layout);
}

// Reduced from real diagrams that carry two-way pairs. Each was confirmed to
// produce at least one such pair — a fixture with none would pass vacuously.
const CASES: { name: string; src: string }[] = [
  {
    name: 'a two-way pair on its own',
    src: `boxes-and-lines Round Trip

Client
  -request-> Server

Server
  -response-> Client
`,
  },
  {
    name: 'the reported diagram: two two-way pairs off one hub',
    src: `boxes-and-lines Nvidia's Circular AI Money

tag Role as r
  Chipmaker green
  Wall Street capital blue
  AI lab purple
  Data center orange

Nvidia r: Chipmaker
  -$500B platform-> Six asset managers
  -up to $105B-> Ohio data center
  -$30B equity-> OpenAI
  -$10B equity-> Anthropic

Six asset managers r: Wall Street capital
  -third-party capital-> Ohio data center

Ohio data center r: Data center
  -20-year lease-> OpenAI

OpenAI r: AI lab
  -buys GPUs-> Nvidia

Anthropic r: AI lab
  -buys GPUs-> Nvidia
`,
  },
  {
    name: 'a two-way pair in a TB layout, where the fan offsets along the flow',
    src: `boxes-and-lines Ecosystem

direction TB

User
  -uses-> Desktop App

Desktop App
  -submodule-> dgmo
  -releases-> GitHub Releases

GitHub Releases
  -serves-> Desktop App

dgmo
  -publishes-> npm Registry

npm Registry
`,
  },
  {
    name: 'four two-way pairs around one orchestrator',
    src: `boxes-and-lines Order Saga

direction LR

Gateway
  -routes-> OrderSvc

OrderSvc
  -reserve-> Inventory
  -charge-> Payment
  -ship-> Shipping

Payment
  -ok-> OrderSvc
  -refund-> Ledger

Inventory
  -low-> Replenish
  -confirm-> OrderSvc

Replenish
  -restock-> Inventory

Shipping
  -done-> OrderSvc
  -handoff-> Carrier

Ledger
Carrier
`,
  },
];

describe('boxes-and-lines: a two-way edge pair draws as two lanes, not an X', () => {
  for (const c of CASES) {
    it(`${c.name}`, async () => {
      const found = await pairsOf(c.src);
      // Guards the fixture itself: no two-way pair means nothing was tested.
      expect(found.length).toBeGreaterThan(0);
      expect(found.filter((f) => f.crossings > 0 || f.overlaps > 0)).toEqual(
        []
      );
    }, 60000);
  }
});
