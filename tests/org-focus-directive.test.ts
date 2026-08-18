import { describe, expect, it } from 'vitest';

import { focusOrgTree } from '../src/org/collapse';
import { layoutOrg } from '../src/org/layout';
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

// A legend row wider than the tree used to grow the layout box to the right
// only, leaving the tree where it was. Renderers centre the BOX in the canvas,
// so the chart drew off-centre by half the surplus — invisible on a full chart
// (the tree is the wider of the two), obvious under `focus`, which shrinks the
// tree to a single card. See the off-centre focused org chart (#311).
describe('org: a legend wider than the tree no longer shifts the tree', () => {
  const MARGIN = 40;
  // How far the drawn content sits left (negative) or right (positive) of the
  // centre of the layout box. Container x is the LEFT edge, unlike a node's
  // centre. A chart whose containers overhang their cards has a small standing
  // offset of its own — the invariant here is that the LEGEND does not add to
  // it, so both charts are compared against each other rather than against 0.
  const centreOffset = (layout: ReturnType<typeof layoutOrg>) => {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const n of layout.nodes) {
      minX = Math.min(minX, n.x - n.width / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
    }
    for (const c of layout.containers) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x + c.width);
    }
    return { offset: (minX + maxX) / 2 - layout.width / 2, span: maxX - minX };
  };

  // Four tag groups with real-length names, as the report had — enough legend
  // for the row to out-measure a single focused card.
  const TAGGED = `org The Dread Fleet

tag Rank as r
  Captain red
  FirstMate orange
tag Home Port as h
  Nassau
  Tortuga
tag Standing as s
  Sworn
tag Ship Assignment as a
  Queen Anne

Blackbeard r: Captain, h: Nassau, s: Sworn, a: Queen Anne
  Anne Bonny r: FirstMate, h: Tortuga, s: Sworn, a: Queen Anne
    [Gun Deck]
  Calico Rackham
    Barnacle Bob`;

  const NO_TAGS = TAGGED.replace(/tag [^\n]+\n(?: {2}[^\n]+\n)+/g, '').replace(
    /(, )?[rhsa]: [A-Za-z ]+(?=,|$)/gm,
    ''
  );

  const focusedLayout = (src: string) => {
    const parsed = parseOrg(src);
    const focusId = findOrgNodeIdByName(parsed.roots, 'Anne Bonny')!;
    return layoutOrg(focusOrgTree(parsed, focusId)!.parsed);
  };

  it('a focused subtree sits where it would with no legend at all', () => {
    const withLegend = focusedLayout(TAGGED);
    const without = focusedLayout(NO_TAGS);
    const a = centreOffset(withLegend);
    const b = centreOffset(without);

    // Guard: the legend really is the wider of the two here, otherwise this
    // test passes without exercising anything.
    expect(withLegend.width).toBeGreaterThan(a.span + MARGIN * 2 + 1);
    expect(without.width).toBeCloseTo(b.span + MARGIN * 2, 5);

    expect(a.offset).toBeCloseTo(b.offset, 5);
  });

  it('leaves a chart wider than its legend untouched', () => {
    // The unfocused chart out-measures the same legend, so nothing widens and
    // nothing shifts — the box is exactly the content plus its two margins.
    const layout = layoutOrg(parseOrg(TAGGED));
    expect(layout.width).toBeCloseTo(centreOffset(layout).span + MARGIN * 2, 5);
  });
});
