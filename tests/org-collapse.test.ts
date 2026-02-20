import { describe, it, expect } from 'vitest';
import { parseOrg } from '../src/org/parser';
import { collapseOrgTree } from '../src/org/collapse';

// ============================================================
// collapseOrgTree
// ============================================================

describe('collapseOrgTree', () => {
  it('returns identical result for empty collapsed set', () => {
    const parsed = parseOrg('chart: org\nAlice\n  Bob\n  Carol');
    const { parsed: result, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set()
    );

    // Should return original object (no clone needed)
    expect(result).toBe(parsed);
    expect(hiddenCounts.size).toBe(0);
  });

  it('collapses node with 2 children → hiddenCount = 2', () => {
    const parsed = parseOrg('chart: org\nAlice\n  Bob\n  Carol');
    const aliceId = parsed.roots[0].id;

    const { parsed: result, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([aliceId])
    );

    expect(hiddenCounts.get(aliceId)).toBe(2);
    expect(result.roots[0].children).toHaveLength(0);
  });

  it('collapses node with nested descendants → counts all', () => {
    const content = `chart: org
Alice
  Bob
    Charlie
    Dave
  Eve`;
    const parsed = parseOrg(content);
    const aliceId = parsed.roots[0].id;

    const { hiddenCounts } = collapseOrgTree(parsed, new Set([aliceId]));

    // Bob + Charlie + Dave + Eve = 4
    expect(hiddenCounts.get(aliceId)).toBe(4);
  });

  it('collapses intermediate node → only counts its subtree', () => {
    const content = `chart: org
Alice
  Bob
    Charlie
    Dave
  Eve`;
    const parsed = parseOrg(content);
    const bobId = parsed.roots[0].children[0].id;

    const { parsed: result, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([bobId])
    );

    // Only Charlie + Dave = 2
    expect(hiddenCounts.get(bobId)).toBe(2);
    // Alice still has both Bob and Eve
    expect(result.roots[0].children).toHaveLength(2);
    // Bob's children are pruned
    expect(result.roots[0].children[0].children).toHaveLength(0);
    // Eve is untouched
    expect(result.roots[0].children[1].label).toBe('Eve');
  });

  it('collapses container → hides children', () => {
    const content = `chart: org
[Engineering]
  Alice
  Bob`;
    const parsed = parseOrg(content);
    const containerId = parsed.roots[0].id;

    const { parsed: result, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([containerId])
    );

    expect(hiddenCounts.get(containerId)).toBe(2);
    expect(result.roots[0].children).toHaveLength(0);
  });

  it('handles multiple collapsed nodes independently', () => {
    const content = `chart: org
Alice
  Bob
    Charlie
  Dave
    Eve`;
    const parsed = parseOrg(content);
    const bobId = parsed.roots[0].children[0].id;
    const daveId = parsed.roots[0].children[1].id;

    const { parsed: result, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([bobId, daveId])
    );

    expect(hiddenCounts.get(bobId)).toBe(1);
    expect(hiddenCounts.get(daveId)).toBe(1);
    expect(result.roots[0].children[0].children).toHaveLength(0);
    expect(result.roots[0].children[1].children).toHaveLength(0);
  });

  it('does not mutate original ParsedOrg', () => {
    const parsed = parseOrg('chart: org\nAlice\n  Bob\n  Carol');
    const aliceId = parsed.roots[0].id;

    collapseOrgTree(parsed, new Set([aliceId]));

    // Original should still have children
    expect(parsed.roots[0].children).toHaveLength(2);
    expect(parsed.roots[0].children[0].label).toBe('Bob');
    expect(parsed.roots[0].children[1].label).toBe('Carol');
  });

  it('leaf node in collapsed set → no-op', () => {
    const parsed = parseOrg('chart: org\nAlice\n  Bob');
    const bobId = parsed.roots[0].children[0].id;

    const { parsed: result, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([bobId])
    );

    // Bob has no children so nothing to hide
    expect(hiddenCounts.size).toBe(0);
    // Structure unchanged (though deep-cloned)
    expect(result.roots[0].children).toHaveLength(1);
    expect(result.roots[0].children[0].label).toBe('Bob');
  });

  it('preserves non-collapsed subtrees', () => {
    const content = `chart: org
Alice
  Bob
    Charlie
  Dave
    Eve
    Frank`;
    const parsed = parseOrg(content);
    const bobId = parsed.roots[0].children[0].id;

    const { parsed: result } = collapseOrgTree(parsed, new Set([bobId]));

    // Dave's children should be intact
    expect(result.roots[0].children[1].children).toHaveLength(2);
    expect(result.roots[0].children[1].children[0].label).toBe('Eve');
    expect(result.roots[0].children[1].children[1].label).toBe('Frank');
  });

  it('preserves ParsedOrg metadata fields', () => {
    const content = `chart: org
title: My Org

## Location
  NY(blue)

Alice
  location: NY
  Bob`;
    const parsed = parseOrg(content);
    const aliceId = parsed.roots[0].id;

    const { parsed: result } = collapseOrgTree(parsed, new Set([aliceId]));

    expect(result.title).toBe('My Org');
    expect(result.titleLineNumber).toBe(2);
    expect(result.tagGroups).toHaveLength(1);
    expect(result.error).toBeNull();
  });
});
