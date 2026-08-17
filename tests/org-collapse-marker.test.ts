import { describe, expect, it } from 'vitest';

import { parseOrg, type OrgNode } from '../src/org/parser';
import { unionCollapsedOrgNodes } from '../src/org/collapse';
import { render } from '../src/render';

// `collapsed: true` (org, spec §6.4.1 / decision #55): the source spelling of
// the app's fold gesture. Org was the last chart type whose collapse was
// runtime-only, so a folded chart survived neither save, export, share link nor
// embed. The canonical export path (`render()` → exportOrg in d3.ts) must honor
// it on its own.

const SRC = `org The Dread Fleet

Blackbeard
  Anne Bonny
    Cannonball Pete
    Smokey Jack
  Calico Rackham
    Barnacle Bob`;

/** Depth-first, by label. */
function nodeByLabel(nodes: readonly OrgNode[], label: string): OrgNode | null {
  for (const n of nodes) {
    if (n.label === label) return n;
    const hit = nodeByLabel(n.children, label);
    if (hit) return hit;
  }
  return null;
}

/** Rendered person cards, by count. */
async function cardCount(src: string): Promise<number> {
  const { svg } = await render(src, { format: 'svg' });
  return (svg.match(/class="org-node"/g) ?? []).length;
}

describe('org collapse marker — parsing', () => {
  it('lifts a same-line marker off a person into a typed field', async () => {
    const parsed = parseOrg(
      SRC.replace('  Anne Bonny\n', '  Anne Bonny collapsed: true\n')
    );
    const anne = nodeByLabel(parsed.roots, 'Anne Bonny');
    expect(anne).not.toBeNull();
    expect(anne!.collapsed).toBe(true);
    // Dropped from metadata, so it never draws as an attribute row on the card.
    expect(anne!.metadata).not.toHaveProperty('collapsed');
    // The label is untouched — `collapsed` is reserved, so it is cut from the
    // name rather than becoming part of it.
    expect(anne!.label).toBe('Anne Bonny');
  });

  it('lifts an INDENTED marker under a person', () => {
    const parsed = parseOrg(
      SRC.replace('  Anne Bonny\n', '  Anne Bonny\n    collapsed: true\n')
    );
    const anne = nodeByLabel(parsed.roots, 'Anne Bonny')!;
    expect(anne.collapsed).toBe(true);
    expect(anne.metadata).not.toHaveProperty('collapsed');
  });

  it('lifts a marker on a [Container] header, both forms', () => {
    const sameLine = parseOrg(
      'org X\n\nBlackbeard\n  [Gun Deck] collapsed: true\n    Powder Monkey\n'
    );
    const deck = nodeByLabel(sameLine.roots, 'Gun Deck')!;
    expect(deck.isContainer).toBe(true);
    expect(deck.collapsed).toBe(true);

    const indented = parseOrg(
      'org X\n\nBlackbeard\n  [Gun Deck]\n    collapsed: true\n    Powder Monkey\n'
    );
    expect(nodeByLabel(indented.roots, 'Gun Deck')!.collapsed).toBe(true);
  });

  it('treats only the literal `true` as collapsed, and drops the key regardless', () => {
    for (const value of ['false', 'yes', '1', 'TRUE']) {
      const parsed = parseOrg(
        SRC.replace('  Anne Bonny\n', `  Anne Bonny collapsed: ${value}\n`)
      );
      const anne = nodeByLabel(parsed.roots, 'Anne Bonny')!;
      // `TRUE` is the one that collapses — the case-insensitive compare every
      // other chart type uses for this key.
      expect(anne.collapsed).toBe(value.toLowerCase() === 'true' || undefined);
      expect(anne.metadata).not.toHaveProperty('collapsed');
    }
  });

  it('leaves an unmarked chart with no collapsed nodes', () => {
    const parsed = parseOrg(SRC);
    expect(nodeByLabel(parsed.roots, 'Anne Bonny')!.collapsed).toBeUndefined();
    expect(unionCollapsedOrgNodes(parsed).size).toBe(0);
  });
});

describe('org collapse marker — unionCollapsedOrgNodes', () => {
  it('collects every source-marked id, at any depth', () => {
    const parsed = parseOrg(
      SRC.replace('  Anne Bonny\n', '  Anne Bonny collapsed: true\n').replace(
        '  Calico Rackham\n',
        '  Calico Rackham collapsed: true\n'
      )
    );
    const ids = unionCollapsedOrgNodes(parsed);
    expect(ids.size).toBe(2);
    expect(ids.has(nodeByLabel(parsed.roots, 'Anne Bonny')!.id)).toBe(true);
    expect(ids.has(nodeByLabel(parsed.roots, 'Calico Rackham')!.id)).toBe(true);
  });

  it('UNIONS with an interactive set rather than being replaced by it', () => {
    // Source alone must fold on a plain render, or the app and an independent
    // render disagree about the same file.
    const parsed = parseOrg(
      SRC.replace('  Anne Bonny\n', '  Anne Bonny collapsed: true\n')
    );
    const anne = nodeByLabel(parsed.roots, 'Anne Bonny')!;
    const calico = nodeByLabel(parsed.roots, 'Calico Rackham')!;
    const ids = unionCollapsedOrgNodes(parsed, [calico.id]);
    expect(ids.has(anne.id)).toBe(true);
    expect(ids.has(calico.id)).toBe(true);
  });
});

describe('org collapse marker — through render()', () => {
  it('prunes the marked subtree in a plain render', async () => {
    const full = await cardCount(SRC);
    const folded = await cardCount(
      SRC.replace('  Anne Bonny\n', '  Anne Bonny collapsed: true\n')
    );
    // Anne stays; her two reports go.
    expect(folded).toBe(full - 2);
  });

  it('draws no `collapsed` attribute row on the card', async () => {
    const { svg } = await render(
      SRC.replace('  Anne Bonny\n', '  Anne Bonny collapsed: true\n'),
      { format: 'svg' }
    );
    // Strip data-* attribute names before looking for the word as TEXT.
    const text = svg.replace(/data-[a-z-]+="[^"]*"/g, '');
    expect(text).not.toMatch(/collapsed/i);
  });

  it('honours an interactive viewState.cg alongside the source markers', async () => {
    const src = SRC.replace('  Anne Bonny\n', '  Anne Bonny collapsed: true\n');
    const parsed = parseOrg(src);
    const calico = nodeByLabel(parsed.roots, 'Calico Rackham')!;

    const sourceOnly = (await render(src, { format: 'svg' })).svg;
    const both = (
      await render(src, { format: 'svg', viewState: { cg: [calico.id] } })
    ).svg;

    const count = (s: string): number =>
      (s.match(/class="org-node"/g) ?? []).length;
    // Barnacle Bob goes too, on top of Anne's two — the union, not a swap.
    expect(count(both)).toBe(count(sourceOnly) - 1);
  });

  it('applies collapse BEFORE focus', async () => {
    // Focusing Anne after folding her leaves her subtree pruned; if focus ran
    // first, the fold would be applied to an already re-rooted tree.
    const src =
      `${SRC.replace('  Anne Bonny\n', '  Anne Bonny collapsed: true\n')}`.replace(
        'org The Dread Fleet\n',
        'org The Dread Fleet\nfocus Anne Bonny\n'
      );
    const { svg } = await render(src, { format: 'svg' });
    expect(svg).toContain('Anne Bonny');
    expect(svg).not.toContain('Cannonball Pete');
    expect(svg).not.toContain('Smokey Jack');
  });
});
