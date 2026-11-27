// A tag legend lists only the tag values something in the diagram uses
// (owner's rule 2026-11-26, diagrammo/diagrammo#2422). Declaring an unused
// value stays legal. Charts here: er, state, boxes-and-lines, ownership, pert,
// sequence, c4.
import { describe, expect, it } from 'vitest';
import { render } from '../src/render';

const entries = (svg: string, group: string): string[] => {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const g = doc.querySelector(`[data-legend-group="${group}"]`);
  return g
    ? [...g.querySelectorAll('[data-legend-entry]')].map(
        (e) => e.getAttribute('data-legend-entry') ?? ''
      )
    : [];
};

const TAG = 'tag Concern as s\n  Used red\n  Spare blue\nactive-tag Concern\n';

const CASES: Record<string, string> = {
  er: `er\n\n${TAG}\nusers s: Used\n  id int pk\n\norders\n  id int pk\n`,
  state: `state\n${TAG}\n[*] -> Draft\nDraft s: Used\nDraft -> Done\n`,
  'boxes-and-lines': `boxes-and-lines\n${TAG}\nApi s: Used\nDb\nApi -> Db\n`,
  ownership: `ownership\n${TAG}\nHoldings Ltd  s: Used\n  100% Sub Ltd\n`,
  pert: `pert\n${TAG}\nDesign 2 4 6\n  s: Used\nBuild 3 5 9\n  -> Design\n`,
  sequence: `sequence\n${TAG}\nAPI | s: Used\nDB is a database\nAPI -query-> DB\n`,
  c4: `c4 T\n${TAG}\nWeb is a system s: Used\nDb is a system\n`,
};

describe('legend lists only used tag values (b)', () => {
  for (const [chart, src] of Object.entries(CASES)) {
    it(`${chart}: the unused value is not drawn`, async () => {
      const { svg } = await render(src, { theme: 'light' });
      const got = entries(svg, 'concern');
      expect(got).toEqual(['used']);
      expect(got).not.toContain('spare');
    });
  }
});
