import { describe, it } from 'vitest';
import fc from 'fast-check';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';

/**
 * Property-based test for cycle detection: random DAGs with optional
 * cycle injection. Cyclic graphs must produce a "cycle detected"
 * diagnostic; acyclic graphs must succeed.
 */
describe('pert cycle-detection invariant (property-based)', () => {
  it('cycles are diagnosed; DAGs are not', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 6 }),
        fc.float({ min: Math.fround(0.3), max: Math.fround(0.8), noNaN: true }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.boolean(),
        (n, sparsity, seed, injectCycle) => {
          const rng = mulberry32(seed);
          type Node = { name: string; outgoing: number[] };
          const nodes: Node[] = Array.from({ length: n }, (_, i) => ({
            name: `n${i}`,
            outgoing: [],
          }));
          // DAG-only edges from i → j > i, then guarantee a 0→1→…→n-1
          // chain so that the optional back-edge actually creates a cycle.
          for (let i = 0; i < n - 1; i++) {
            nodes[i].outgoing.push(i + 1);
          }
          for (let i = 0; i < n; i++) {
            for (let j = i + 2; j < n; j++) {
              if (rng() < sparsity) nodes[i].outgoing.push(j);
            }
          }
          // Optionally inject a back-edge to create a cycle: n_last → n_0
          if (injectCycle && n >= 2) {
            nodes[n - 1].outgoing.push(0);
          }

          const lines: string[] = ['pert', 'time-unit d'];
          for (const node of nodes) {
            lines.push(`${node.name} 1 2 3`);
            for (const j of node.outgoing) lines.push(`  -> n${j}`);
          }
          const parsed = parsePert(lines.join('\n'));
          if (parsed.error) return;
          const resolved = analyzePert(parsed);

          const cycleDiag = resolved.diagnostics.find((d) =>
            d.message.toLowerCase().includes('cycle')
          );

          if (injectCycle) {
            if (!cycleDiag) {
              throw new Error(
                `Expected a cycle diagnostic for injected cycle:\n${lines.join('\n')}`
              );
            }
          } else {
            // No cycle injected — must NOT diagnose one (graph is DAG-only by construction).
            if (cycleDiag) {
              throw new Error(
                `Unexpected cycle diagnostic for DAG:\n${lines.join('\n')}\n${cycleDiag.message}`
              );
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
