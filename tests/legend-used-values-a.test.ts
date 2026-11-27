// A tag legend lists only the tag values something in the diagram uses
// (owner's rule 2026-11-26, diagrammo/diagrammo#2422). Declaring an unused
// value stays legal; a group with no used value draws no pill.
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
const hasGroup = (svg: string, group: string): boolean =>
  new DOMParser()
    .parseFromString(svg, 'image/svg+xml')
    .querySelector(`[data-legend-group="${group}"]`) !== null;

const CASES: Record<string, string> = {
  body: `body
tag Effort as e
  Primary red
  Spare blue
active-tag Effort
chest e: Primary`,
  family: `family
tag Allegiance as loyalty
  Crown blue
  Brethren red
active-tag Allegiance
Anne sex: f, loyalty: Crown`,
  'event-line': `event-line T
no-scale
tag Genre as g
  Pop blue
  Rock teal
active-tag Genre

2012 Alpha  g: Pop
  body`,
  cycle: `cycle C
tag Phase as p
  Plan blue
  Spare green
active-tag Phase

A p: Plan
B p: Plan`,
  'journey-map': `journey-map J
tag Channel as ch
  Web blue
  Mobile purple
active-tag Channel

[Research]
  Compare specs score: 4, ch: Web`,
  kanban: `kanban
tag Priority
  High red
  Low green
active-tag Priority

[To Do]
  Fix login priority: High`,
  swot: `swot T
tag Priority as p
  High red
  Low gray
active-tag Priority
strengths
  A p: High
weaknesses
  B
opportunities
  C
threats
  D`,
};
const GROUPS: Record<string, string> = {
  body: 'effort',
  family: 'allegiance',
  'event-line': 'genre',
  cycle: 'phase',
  'journey-map': 'channel',
  kanban: 'priority',
  swot: 'priority',
};
const USED: Record<string, [string, string]> = {
  body: ['primary', 'spare'],
  family: ['crown', 'brethren'],
  'event-line': ['pop', 'rock'],
  cycle: ['plan', 'spare'],
  'journey-map': ['web', 'mobile'],
  kanban: ['high', 'low'],
  swot: ['high', 'low'],
};

describe('legend lists only used tag values', () => {
  for (const [chart, src] of Object.entries(CASES)) {
    it(`${chart}: the unused value is not drawn`, async () => {
      const { svg } = await render(src, { theme: 'light' });
      const [used, unused] = USED[chart]!;
      const got = entries(svg, GROUPS[chart]!);
      expect(got).toEqual([used]);
      expect(got).not.toContain(unused);
    });
  }

  it('a group with no used value draws no pill', async () => {
    // The first value is the default, so only a board with no cards leaves
    // every value unused.
    const src = `kanban
tag Priority
  High red
  Low green
active-tag Priority

[To Do]`;
    const { svg } = await render(src, { theme: 'light' });
    expect(hasGroup(svg, 'priority')).toBe(false);
  });
});
