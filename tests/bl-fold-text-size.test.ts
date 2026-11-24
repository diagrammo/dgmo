// Rubric rule 8 (diagrammo/diagrammo#2062): folding a group never makes text
// bigger. A fold shrinks the layout, so the fit-to-pane scale alone grows; the
// app passes the scale it drew before the fold as `maxScale`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import type { BLLayoutResult } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { getPalette } from '../src/palettes';

const P = getPalette('nord').light;
// A pane both fixtures fill by height, so their folds would scale up.
const DIMS = { width: 1000, height: 700 };

function drawnScale(
  parsed: ReturnType<typeof parseBoxesAndLines>,
  layout: BLLayoutResult,
  maxScale?: number
): number {
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: DIMS,
    ...(maxScale !== undefined && { maxScale }),
  });
  return Number(el.querySelector('svg')!.getAttribute('data-scale'));
}

const FIXTURES = {
  'storefront-rebuild': ['Frontends', 'Identity'],
  'box-office-platform': ['Ticketing Core', 'Media'],
} as const;

describe('boxes-and-lines — folding keeps text size (rule 8)', () => {
  for (const [name, groups] of Object.entries(FIXTURES)) {
    it(`${name}: a fold drawn with the pinned scale keeps it`, async () => {
      const src = readFileSync(
        `stress/boxes-and-lines/grouped-flow--${name}.dgmo`,
        'utf8'
      );
      const parsed = parseBoxesAndLines(src);
      const ex = await layoutBoxesAndLines(parsed);
      const s0 = drawnScale(parsed, ex);
      expect(s0).toBeGreaterThan(0);
      const prev = new Map(ex.nodes.map((n) => [n.label, { x: n.x, y: n.y }]));
      for (const g of groups) {
        const cr = collapseBoxesAndLines(parseBoxesAndLines(src), new Set([g]));
        const folded = await layoutBoxesAndLines(
          cr.parsed,
          {
            collapsedChildCounts: cr.collapsedChildCounts,
            originalGroups: cr.originalGroups,
          },
          { previousPositions: prev, stableCollapse: true }
        );
        // The fault the option exists for: unpinned, the fold scales up.
        expect(drawnScale(cr.parsed, folded)).toBeGreaterThan(s0);
        expect(drawnScale(cr.parsed, folded, s0)).toBe(s0);
      }
    }, 300_000);
  }

  it('a pin larger than the fit never overflows the pane', async () => {
    const parsed = parseBoxesAndLines('boxes-and-lines\nA -> B\nB -> C');
    const layout = await layoutBoxesAndLines(parsed);
    const fit = drawnScale(parsed, layout);
    expect(drawnScale(parsed, layout, fit * 4)).toBe(fit);
    expect(drawnScale(parsed, layout, fit / 2)).toBe(fit / 2);
  });

  it('export output carries no data-scale', async () => {
    const parsed = parseBoxesAndLines('boxes-and-lines\nA -> B');
    const layout = await layoutBoxesAndLines(parsed);
    const el = document.createElement('div');
    renderBoxesAndLines(el, parsed, layout, P, false, {
      exportDims: DIMS,
      exportMode: true,
    });
    expect(el.querySelector('svg')!.hasAttribute('data-scale')).toBe(false);
  });
});
