// arc-chord-layout.test.ts — consolidation #26.
//
// arc and chord are one concept behind a `layout arc|chord` directive: the same
// pairwise edges render linear (arc) or circular (chord). Verifies the override
// flips the geometry in BOTH directions and leaves the bare presets unchanged.

import { describe, it, expect } from 'vitest';
import { renderForExport } from '../src/d3';

/** Distinct rounded circle-cy values: 1 ⇒ nodes share a baseline (arc/linear),
 *  >1 ⇒ nodes are spread around a circle (chord/circular). */
function distinctNodeRows(svg: string): number {
  const cys = [...svg.matchAll(/<circle[^>]*cy="([\d.]+)"/g)].map((m) =>
    Math.round(parseFloat(m[1]!))
  );
  return new Set(cys).size;
}

const EDGES = 'A -> B 5\nB -> C 4\nC -> A 3\n';

describe('arc ↔ chord layout override (#26)', () => {
  it('bare arc is linear, bare chord is circular', async () => {
    const arc = await renderForExport(`arc D\n${EDGES}`, 'light');
    const chord = await renderForExport(`chord D\n${EDGES}`, 'light');
    expect(distinctNodeRows(arc)).toBe(1);
    expect(distinctNodeRows(chord)).toBeGreaterThan(1);
  });

  it('arc + `layout chord` renders circular', async () => {
    const svg = await renderForExport(`arc D\nlayout chord\n${EDGES}`, 'light');
    expect(svg).toContain('<svg');
    expect(distinctNodeRows(svg)).toBeGreaterThan(1);
  });

  it('chord + `layout arc` renders linear', async () => {
    const svg = await renderForExport(`chord D\nlayout arc\n${EDGES}`, 'light');
    expect(svg).toContain('<svg');
    expect(distinctNodeRows(svg)).toBe(1);
  });
});
