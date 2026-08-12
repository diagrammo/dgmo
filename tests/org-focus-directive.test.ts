import { describe, expect, it } from 'vitest';

import { findOrgNodeIdByName, parseOrg } from '../src/org/parser';
import { render } from '../src/render';

// `focus <name>` (org, spec §6.5): re-root the chart to one person's (or
// team's) subtree with the ancestor breadcrumb trail — the source-backed
// spelling of the app's subtree drill-down. The canonical export path
// (`render()` → exportOrg in d3.ts) must honor it on its own, so a focused
// chart reproduces anywhere: CLI, share link, embed.

const SRC = `org The Dread Fleet
focus Anne Bonny

tag Rank as r
  Captain red
  FirstMate orange
  Gunner teal

Blackbeard r: Captain
  Anne Bonny r: FirstMate
    [Gun Deck]
      Cannonball Pete r: Gunner
  Calico Rackham
    Barnacle Bob`;

describe('org: focus directive parsing', () => {
  it('is cut as an option, not a person node', () => {
    const parsed = parseOrg(SRC);
    expect(parsed.options['focus']).toBe('Anne Bonny');
    expect(parsed.roots).toHaveLength(1);
    expect(parsed.roots[0]!.label).toBe('Blackbeard');
  });

  it('warns (never errors) when the target does not exist', () => {
    const parsed = parseOrg(SRC.replace('Anne Bonny\n', 'Mary Read\n'));
    expect(parsed.error).toBeNull();
    const warning = parsed.diagnostics.find((d) => d.severity === 'warning');
    expect(warning?.message).toContain('"Mary Read" not found');
    expect(warning?.line).toBe(2);
  });

  it('resolves names case-insensitively, containers included', () => {
    const parsed = parseOrg(SRC);
    const anne = findOrgNodeIdByName(parsed.roots, 'anne bonny');
    expect(anne).not.toBeNull();
    const deck = findOrgNodeIdByName(parsed.roots, 'Gun Deck');
    expect(deck).not.toBeNull();
    expect(findOrgNodeIdByName(parsed.roots, 'Nobody')).toBeNull();
  });
});

describe('org: focus directive honored by render()', () => {
  it('exports only the focused subtree, with the ancestor trail', async () => {
    const { svg } = await render(SRC, { theme: 'light', palette: 'slate' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('Anne Bonny');
    expect(svg).toContain('Cannonball Pete');
    // Outside the subtree — gone from the cards…
    expect(svg).not.toContain('Barnacle Bob');
    expect(svg).not.toContain('Calico Rackham');
    // …while the ancestor survives as a breadcrumb, not a card.
    expect(svg).toContain('org-ancestor-trail');
    expect(svg).toContain('Blackbeard');
  });

  it('renders the whole chart when the target is missing', async () => {
    const src = SRC.replace('Anne Bonny\n', 'Mary Read\n');
    const { svg } = await render(src, { theme: 'light', palette: 'slate' });
    expect(svg).toContain('Barnacle Bob');
    expect(svg).toContain('Blackbeard');
    expect(svg).not.toContain('org-ancestor-trail');
  });

  it('focusing a root renders that subtree with no trail', async () => {
    const src = SRC.replace('focus Anne Bonny', 'focus Blackbeard');
    const { svg } = await render(src, { theme: 'light', palette: 'slate' });
    expect(svg).toContain('Blackbeard');
    expect(svg).toContain('Barnacle Bob');
    expect(svg).not.toContain('org-ancestor-trail');
  });
});
