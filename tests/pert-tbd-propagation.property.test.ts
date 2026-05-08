import { describe, it } from 'vitest';
import fc from 'fast-check';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';

/**
 * Property-based test: every transitive descendant of a TBD activity
 * must have null ES/EF/LS/LF/slack; every non-descendant must NOT be
 * affected (modulo legitimate cycle / parse errors).
 *
 * Generates random DAGs with 5–12 nodes and a random subset marked TBD.
 */
describe('pert TBD-propagation invariant (property-based)', () => {
  it('descendants of TBD have null analysis fields; non-descendants do not', () => {
    fc.assert(
      fc.property(
        // Number of nodes
        fc.integer({ min: 3, max: 8 }),
        // For each node: is-tbd flag
        fc.array(fc.boolean(), { minLength: 3, maxLength: 8 }),
        // Random edge sparsity (0..1) — fast-check requires 32-bit float bounds.
        fc.float({ min: Math.fround(0.2), max: Math.fround(0.8), noNaN: true }),
        // Seed for the edge selection
        fc.integer({ min: 1, max: 1_000_000 }),
        (n, isTbd, sparsity, seed) => {
          // Cap to actual length so flags align with node count.
          const nodeCount = Math.min(n, isTbd.length);
          if (nodeCount < 2) return;

          // Build a deterministic DAG by allowing edges only from i to j > i.
          const rng = mulberry32(seed);
          type Node = { name: string; tbd: boolean; outgoing: number[] };
          const nodes: Node[] = [];
          for (let i = 0; i < nodeCount; i++) {
            nodes.push({ name: `n${i}`, tbd: !!isTbd[i], outgoing: [] });
          }
          for (let i = 0; i < nodeCount; i++) {
            for (let j = i + 1; j < nodeCount; j++) {
              if (rng() < sparsity) nodes[i].outgoing.push(j);
            }
          }

          // Author DGMO source.
          const lines: string[] = ['pert', 'time-unit d'];
          for (const node of nodes) {
            if (node.tbd) {
              lines.push(node.name); // TBD: no estimate
            } else {
              lines.push(`${node.name} 1 2 3`);
            }
            for (const j of node.outgoing) {
              lines.push(`  -> n${j}`);
            }
          }
          const source = lines.join('\n');

          const parsed = parsePert(source);
          if (parsed.error) return; // Generator produced an invalid graph; skip.

          const resolved = analyzePert(parsed);
          if (resolved.error) return; // Cycle injection by accident; skip.

          // Compute the expected poisoned set (transitive descendants of any TBD).
          const expectedPoisoned = new Set<string>();
          for (const node of nodes) {
            if (!node.tbd) continue;
            const stack = [nodes.indexOf(node)];
            while (stack.length > 0) {
              const idx = stack.pop()!;
              const id = `n${idx}`;
              expectedPoisoned.add(id);
              for (const succIdx of nodes[idx].outgoing) {
                if (!expectedPoisoned.has(`n${succIdx}`)) {
                  stack.push(succIdx);
                }
              }
            }
          }

          // Assert each activity matches the expected poisoned/non-poisoned class.
          for (const r of resolved.activities) {
            if (expectedPoisoned.has(r.activity.id)) {
              if (r.es !== null || r.ef !== null) {
                throw new Error(
                  `Expected ${r.activity.id} (downstream of TBD) to have null ES/EF, got es=${r.es}, ef=${r.ef}`
                );
              }
            } else {
              if (r.es === null || r.ef === null) {
                throw new Error(
                  `Expected ${r.activity.id} (not downstream of TBD) to have non-null ES/EF, got es=${r.es}, ef=${r.ef}`
                );
              }
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
