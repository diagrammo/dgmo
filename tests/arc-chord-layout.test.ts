// arc-chord-layout.test.ts — consolidation #26, narrowed by #29.
//
// The circular ("chord") layout is reachable ONLY through the arc engine via a
// `layout chord` directive over the same pairwise edges. `chord` is no longer a
// chart-type keyword (#29): a source whose first token is `chord` is not the
// circular preset — it is treated as an unknown/removed type like any other.

import { describe, it, expect } from 'vitest';
import { renderForExport } from '../src/d3';
import { render } from '../src/render';
import { parseDgmoChartType, getRenderCategory } from '../src/dgmo-router';

/** Distinct rounded circle-cy values: 1 ⇒ nodes share a baseline (arc/linear),
 *  >1 ⇒ nodes are spread around a circle (chord/circular). */
function distinctNodeRows(svg: string): number {
  const cys = [...svg.matchAll(/<circle[^>]*cy="([\d.]+)"/g)].map((m) =>
    Math.round(parseFloat(m[1]!))
  );
  return new Set(cys).size;
}

const EDGES = 'A -> B 5\nB -> C 4\nC -> A 3\n';

describe('arc circular layout override (#26 / #29)', () => {
  it('bare arc is linear', async () => {
    const arc = await renderForExport(`arc D\n${EDGES}`, 'light');
    expect(distinctNodeRows(arc)).toBe(1);
  });

  it('arc + `layout chord` renders circular (renderForExport)', async () => {
    const svg = await renderForExport(`arc D\nlayout chord\n${EDGES}`, 'light');
    expect(svg).toContain('<svg');
    expect(distinctNodeRows(svg)).toBeGreaterThan(1);
  });

  it('arc + `layout chord` renders circular via the public render() entry', async () => {
    // Guards the render.ts dispatch: the override re-emits `chord …` content,
    // but `chord` is not a registry type — render() must still route it to the
    // circular data-chart renderer, not re-detect it as a sequence diagram.
    const { svg, diagnostics } = await render(`arc D\nlayout chord\n${EDGES}`, {
      palette: 'slate',
    });
    expect(diagnostics.length).toBe(0);
    expect(svg).not.toContain('sequence-diagram');
    expect(distinctNodeRows(svg)).toBeGreaterThan(1);
  });

  it('`chord` is no longer a chart-type keyword (#29)', () => {
    // First-token `chord` must not resolve to the removed chord type. (With an
    // arrow body it falls through to headerless inference like any unknown type,
    // exactly as `doughnut`/`area` do — it is never the chord preset.)
    expect(parseDgmoChartType(`chord D\n${EDGES}`)).not.toBe('chord');
    expect(getRenderCategory('chord')).toBeNull();
  });
});
