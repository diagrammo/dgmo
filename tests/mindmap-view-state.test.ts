import { describe, it, expect } from 'vitest';
import { render } from '../src/render';
import { parseMindmap } from '../src/mindmap/parser';
import type { MindmapNode } from '../src/mindmap/parser';

// Source-authored `collapsed: true` is view-state that travels in the `.dgmo`
// text: any consumer (CLI, remark-dgmo, Obsidian, embeds) must reproduce the
// app's collapsed view from source alone. `exportMindmap` unions the source
// `node.collapsed` set with the runtime `viewState.cg` (additive). A collapsed
// node's descendant labels are pruned from layout, so their absence in the SVG
// is a precise proof of end-to-end wiring.

const findId = (nodes: MindmapNode[], label: string): string | undefined => {
  for (const n of nodes) {
    if (n.label === label) return n.id;
    const hit = findId(n.children, label);
    if (hit) return hit;
  }
  return undefined;
};

describe('mindmap source view-state — `collapsed: true`', () => {
  it('AC1: honors source `collapsed: true` with no viewState (descendant hidden)', async () => {
    const { svg } = await render(
      'mindmap Root\n  Alpha collapsed: true\n    Apple\n  Bravo\n    Banana'
    );
    expect(svg).not.toContain('Apple'); // Alpha collapsed → subtree pruned
    expect(svg).toContain('Banana'); // Bravo expanded
  });

  it('control: without the marker the descendant renders', async () => {
    const { svg } = await render(
      'mindmap Root\n  Alpha\n    Apple\n  Bravo\n    Banana'
    );
    expect(svg).toContain('Apple');
    expect(svg).toContain('Banana');
  });

  it('AC6 (decision #48): a bare trailing `collapsed` is the canonical collapse flag', async () => {
    const { svg } = await render('mindmap Root\n  Alpha collapsed\n    Apple');
    expect(svg).not.toContain('Apple'); // Alpha collapsed → subtree pruned
    expect(svg).toContain('Alpha'); // flag token stripped from the label
  });

  it('AC6b: capitalized `Collapsed` stays part of the label (no fold)', async () => {
    const { svg } = await render('mindmap Root\n  Alpha Collapsed\n    Apple');
    expect(svg).toContain('Apple'); // name is "Alpha Collapsed"; nothing folds
    expect(svg).toContain('Alpha Collapsed');
  });

  it('AC6c: a lone `collapsed` line stays a node label (never-empty rule)', async () => {
    const parsed = parseMindmap('mindmap Root\n  collapsed\n    Apple');
    const node = parsed.roots[0]!.children[0]!;
    expect(node.label).toBe('collapsed');
    expect(node.collapsed).toBeUndefined();
  });

  it('AC2: incoming viewState.cg is additive with source markers', async () => {
    const content =
      'mindmap Root\n  Alpha collapsed: true\n    Apple\n  Bravo\n    Banana';
    const bravoId = findId(parseMindmap(content).roots, 'Bravo');
    expect(bravoId).toBeDefined();
    const { svg } = await render(content, {
      viewState: { cg: [bravoId as string] },
    });
    expect(svg).not.toContain('Apple'); // collapsed via source marker
    expect(svg).not.toContain('Banana'); // collapsed via viewState.cg
  });

  it('AC5: the marker stays on its node when a sibling is inserted above', async () => {
    const { svg } = await render(
      'mindmap Root\n  Zebra\n  Alpha collapsed: true\n    Apple'
    );
    expect(svg).toContain('Zebra');
    expect(svg).not.toContain('Apple'); // Alpha still collapsed despite Zebra above
  });
});
