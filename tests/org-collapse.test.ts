import { describe, it, expect } from 'vitest';
import { parseOrg } from '../src/org/parser';
import { collapseOrgTree, focusOrgTree } from '../src/org/collapse';

// ============================================================
// collapseOrgTree
// ============================================================

describe('collapseOrgTree', () => {
  it('returns identical result for empty collapsed set', () => {
    const parsed = parseOrg('org\nAlice\n  Bob\n  Carol');
    const { parsed: result, hiddenCounts } = collapseOrgTree(parsed, new Set());

    // Should return original object (no clone needed)
    expect(result).toBe(parsed);
    expect(hiddenCounts.size).toBe(0);
  });

  it('collapses node with 2 children → hiddenCount = 2', () => {
    const parsed = parseOrg('org\nAlice\n  Bob\n  Carol');
    const aliceId = parsed.roots[0].id;

    const { parsed: result, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([aliceId])
    );

    expect(hiddenCounts.get(aliceId)).toBe(2);
    expect(result.roots[0].children).toHaveLength(0);
  });

  it('collapses node with nested descendants → counts all nodes', () => {
    const content = `org
Alice
  Bob
    Charlie
    Dave
  Eve`;
    const parsed = parseOrg(content);
    const aliceId = parsed.roots[0].id;

    const { hiddenCounts } = collapseOrgTree(parsed, new Set([aliceId]));

    // Bob + Charlie + Dave + Eve = 4 (all non-container nodes)
    expect(hiddenCounts.get(aliceId)).toBe(4);
  });

  it('collapses intermediate node → only counts its subtree', () => {
    const content = `org
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
    const content = `org
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
    const content = `org
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
    const parsed = parseOrg('org\nAlice\n  Bob\n  Carol');
    const aliceId = parsed.roots[0].id;

    collapseOrgTree(parsed, new Set([aliceId]));

    // Original should still have children
    expect(parsed.roots[0].children).toHaveLength(2);
    expect(parsed.roots[0].children[0].label).toBe('Bob');
    expect(parsed.roots[0].children[1].label).toBe('Carol');
  });

  it('leaf node in collapsed set → no-op', () => {
    const parsed = parseOrg('org\nAlice\n  Bob');
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
    const content = `org
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

  it('excludes containers from hidden count', () => {
    const content = `org
Alice
  [Platform Team]
    Bob
    Carol
  Dave`;
    const parsed = parseOrg(content);
    const aliceId = parsed.roots[0].id;

    const { hiddenCounts } = collapseOrgTree(parsed, new Set([aliceId]));

    // Bob + Carol + Dave = 3 (container [Platform Team] not counted)
    expect(hiddenCounts.get(aliceId)).toBe(3);
  });

  it('nested collapse: parent counts all descendants from original tree', () => {
    const content = `org
Alice
  Bob
    Charlie
    Dave
  Eve`;
    const parsed = parseOrg(content);
    const aliceId = parsed.roots[0].id;
    const bobId = parsed.roots[0].children[0].id;

    // Both Alice and Bob collapsed — Alice should still count all 4 descendants
    const { hiddenCounts } = collapseOrgTree(parsed, new Set([aliceId, bobId]));

    expect(hiddenCounts.get(bobId)).toBe(2); // Charlie + Dave
    expect(hiddenCounts.get(aliceId)).toBe(4); // Bob + Charlie + Dave + Eve
  });

  it('preserves ParsedOrg metadata fields', () => {
    const content = `org My Org

tag Location
  NY(blue)

Alice
  location: NY
  Bob`;
    const parsed = parseOrg(content);
    const aliceId = parsed.roots[0].id;

    const { parsed: result } = collapseOrgTree(parsed, new Set([aliceId]));

    expect(result.title).toBe('My Org');
    expect(result.titleLineNumber).toBe(1);
    expect(result.tagGroups).toHaveLength(1);
    expect(result.error).toBeNull();
  });
});

// ============================================================
// focusOrgTree
// ============================================================

describe('focusOrgTree', () => {
  it('returns null for non-existent node', () => {
    const parsed = parseOrg('org\nAlice\n  Bob');
    expect(focusOrgTree(parsed, 'non-existent-id')).toBeNull();
  });

  it('focuses on root → returns same tree, empty ancestor path', () => {
    const parsed = parseOrg('org\nAlice\n  Bob\n  Carol');
    const aliceId = parsed.roots[0].id;

    const result = focusOrgTree(parsed, aliceId)!;
    expect(result).not.toBeNull();
    expect(result.ancestorPath).toHaveLength(0);
    expect(result.parsed.roots).toHaveLength(1);
    expect(result.parsed.roots[0].label).toBe('Alice');
    expect(result.parsed.roots[0].children).toHaveLength(2);
  });

  it('focuses on mid-level node → returns subtree + ancestor path', () => {
    const content = `org
Alice
  Bob
    Charlie
    Dave
  Eve`;
    const parsed = parseOrg(content);
    const bobId = parsed.roots[0].children[0].id;

    const result = focusOrgTree(parsed, bobId)!;
    expect(result).not.toBeNull();

    // Ancestor path should be [Alice]
    expect(result.ancestorPath).toHaveLength(1);
    expect(result.ancestorPath[0].label).toBe('Alice');

    // Focused subtree should have Bob as root with Charlie + Dave
    expect(result.parsed.roots).toHaveLength(1);
    expect(result.parsed.roots[0].label).toBe('Bob');
    expect(result.parsed.roots[0].children).toHaveLength(2);
    expect(result.parsed.roots[0].children[0].label).toBe('Charlie');
    expect(result.parsed.roots[0].children[1].label).toBe('Dave');
  });

  it('focuses on deeply nested node → full ancestor path', () => {
    const content = `org
Alice
  Bob
    Charlie
      Dave`;
    const parsed = parseOrg(content);
    const daveId = parsed.roots[0].children[0].children[0].children[0].id;

    const result = focusOrgTree(parsed, daveId)!;
    expect(result).not.toBeNull();

    // Ancestor path: Alice → Bob → Charlie
    expect(result.ancestorPath).toHaveLength(3);
    expect(result.ancestorPath[0].label).toBe('Alice');
    expect(result.ancestorPath[1].label).toBe('Bob');
    expect(result.ancestorPath[2].label).toBe('Charlie');

    // Dave is the new root (leaf)
    expect(result.parsed.roots[0].label).toBe('Dave');
    expect(result.parsed.roots[0].children).toHaveLength(0);
  });

  it('preserves tag groups and title', () => {
    const content = `org My Org

tag Location
  NY(blue)

Alice
  location: NY
  Bob
    Charlie`;
    const parsed = parseOrg(content);
    const bobId = parsed.roots[0].children[0].id;

    const result = focusOrgTree(parsed, bobId)!;
    expect(result.parsed.title).toBe('My Org');
    expect(result.parsed.tagGroups).toHaveLength(1);
    expect(result.parsed.tagGroups[0].name).toBe('Location');
  });

  it('does not mutate original tree', () => {
    const content = `org
Alice
  Bob
    Charlie`;
    const parsed = parseOrg(content);
    const bobId = parsed.roots[0].children[0].id;

    focusOrgTree(parsed, bobId);

    // Original still has Alice as root with Bob as child
    expect(parsed.roots[0].label).toBe('Alice');
    expect(parsed.roots[0].children).toHaveLength(1);
    expect(parsed.roots[0].children[0].label).toBe('Bob');
  });

  it('focused node has parentId set to null', () => {
    const content = `org
Alice
  Bob
    Charlie`;
    const parsed = parseOrg(content);
    const bobId = parsed.roots[0].children[0].id;

    const result = focusOrgTree(parsed, bobId)!;
    expect(result.parsed.roots[0].parentId).toBeNull();
  });
});
