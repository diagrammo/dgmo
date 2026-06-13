import { describe, it, expect } from 'vitest';
import { parseMindmap } from '../src/mindmap/parser';
import { collapseMindmapTree } from '../src/mindmap/collapse';

// Characterization tests for mindmap collapse. Mindmap had no dedicated
// collapse test before Story 110.1 — these pin current behavior (notably the
// "count ALL children" tally rule, which differs from org/sitemap's
// container-excluding rule) as the safety net for the collapse-engine refactor.

describe('collapseMindmapTree', () => {
  it('returns roots (shallow-copied) and empty counts when nothing collapsed', () => {
    const parsed = parseMindmap('mindmap Root\n  Child');
    const { roots, hiddenCounts } = collapseMindmapTree(
      parsed.roots,
      new Set()
    );
    expect(hiddenCounts.size).toBe(0);
    expect(roots).toHaveLength(parsed.roots.length);
    expect(roots[0].children).toHaveLength(1);
  });

  it('prunes children of a collapsed node and counts ALL descendants', () => {
    const parsed = parseMindmap('mindmap Root\n  A\n    A1\n  B');
    const rootId = parsed.roots[0].id;
    const { roots, hiddenCounts } = collapseMindmapTree(
      parsed.roots,
      new Set([rootId])
    );
    expect(roots[0].children).toHaveLength(0);
    // Unlike org/sitemap, mindmap has no isContainer exclusion: A, A1, B = 3.
    expect(hiddenCounts.get(rootId)).toBe(3);
  });

  it('does not mutate the original roots', () => {
    const parsed = parseMindmap('mindmap Root\n  A\n  B');
    const rootId = parsed.roots[0].id;
    collapseMindmapTree(parsed.roots, new Set([rootId]));
    expect(parsed.roots[0].children).toHaveLength(2);
  });

  it('computes the hidden count from the ORIGINAL tree for a nested collapse', () => {
    const parsed = parseMindmap('mindmap Root\n  A\n    A1\n      A2');
    const aId = parsed.roots[0].children[0].id;
    const { roots, hiddenCounts } = collapseMindmapTree(
      parsed.roots,
      new Set([aId])
    );
    // A1 + A2 are hidden under A = 2; Root stays expanded.
    expect(hiddenCounts.get(aId)).toBe(2);
    expect(roots[0].children[0].children).toHaveLength(0);
  });

  it('does not record a count for a collapsed leaf (no children)', () => {
    const parsed = parseMindmap('mindmap Root\n  A');
    const aId = parsed.roots[0].children[0].id;
    const { hiddenCounts } = collapseMindmapTree(parsed.roots, new Set([aId]));
    expect(hiddenCounts.has(aId)).toBe(false);
  });
});
