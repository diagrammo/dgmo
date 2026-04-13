import { describe, it, expect } from 'vitest';
import { collapseStateGroups } from '../src/graph/state-collapse';
import { parseState } from '../src/graph/state-parser';

const GROUPED_DIAGRAM = `state Order Flow

[Fulfillment]
  Processing
    -pack-> Shipping
  Shipping
    -delivered-> Delivered

[Resolution]
  Delivered
    -return request-> Returning
  Returning
    -refund-> Refunded

[*] -> Processing
Refunded -> [*]
`;

function parse(content: string) {
  return parseState(content);
}

describe('collapseStateGroups', () => {
  it('passes through unchanged when no groups are collapsed', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const result = collapseStateGroups(parsed, new Set());

    expect(result.parsed).toBe(parsed); // same reference
    expect(result.collapsedChildCounts.size).toBe(0);
  });

  it('passes through unchanged when collapsedGroups is empty set', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const result = collapseStateGroups(parsed, new Set(['nonexistent']));

    // nonexistent group ID — no effect
    expect(result.collapsedChildCounts.size).toBe(0);
  });

  it('removes nodes belonging to a collapsed group', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const fulfillmentGroup = parsed.groups!.find(
      (g) => g.label === 'Fulfillment'
    )!;

    const result = collapseStateGroups(parsed, new Set([fulfillmentGroup.id]));

    const nodeIds = result.parsed.nodes.map((n) => n.id);
    // Fulfillment members (Processing, Shipping, Delivered) should be removed
    expect(nodeIds).not.toContain('state:processing');
    expect(nodeIds).not.toContain('state:shipping');
    // But Resolution members should remain
    expect(nodeIds).toContain('state:returning');
    expect(nodeIds).toContain('state:refunded');
  });

  it('remaps edges to collapsed group ID', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const fulfillmentGroup = parsed.groups!.find(
      (g) => g.label === 'Fulfillment'
    )!;

    const result = collapseStateGroups(parsed, new Set([fulfillmentGroup.id]));

    // [*] -> Processing becomes [*] -> group:fulfillment
    const startEdge = result.parsed.edges.find(
      (e) => e.source === 'pseudostate:[*]' && e.target === fulfillmentGroup.id
    );
    expect(startEdge).toBeDefined();
  });

  it('drops internal edges within a collapsed group', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const fulfillmentGroup = parsed.groups!.find(
      (g) => g.label === 'Fulfillment'
    )!;

    const result = collapseStateGroups(parsed, new Set([fulfillmentGroup.id]));

    // Processing -pack-> Shipping is internal — should be dropped
    const internalEdge = result.parsed.edges.find((e) => e.label === 'pack');
    expect(internalEdge).toBeUndefined();
  });

  it('deduplicates remapped edges', () => {
    // Two edges from different nodes in the same group to the same external target
    // would become duplicates after remapping
    const content = `state

Outside

[Group A]
  A1 -> Outside
  A2 -> Outside
`;
    const parsed = parse(content);
    const groupA = parsed.groups!.find((g) => g.label === 'Group A')!;

    // Outside is defined at root indent before the group, so it shouldn't be a member
    expect(groupA.nodeIds).not.toContain('state:outside');

    const result = collapseStateGroups(parsed, new Set([groupA.id]));

    // Both A1 -> Outside and A2 -> Outside remap to group:group a -> state:outside
    // Only one should survive
    const edgesToOutside = result.parsed.edges.filter(
      (e) => e.target === 'state:outside'
    );
    expect(edgesToOutside).toHaveLength(1);
  });

  it('removes collapsed groups from groups list', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const fulfillmentGroup = parsed.groups!.find(
      (g) => g.label === 'Fulfillment'
    )!;

    const result = collapseStateGroups(parsed, new Set([fulfillmentGroup.id]));

    const groupIds = result.parsed.groups!.map((g) => g.id);
    expect(groupIds).not.toContain(fulfillmentGroup.id);
    // Resolution should remain
    expect(groupIds).toContain('group:resolution');
  });

  it('tracks child counts for collapsed groups', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const fulfillmentGroup = parsed.groups!.find(
      (g) => g.label === 'Fulfillment'
    )!;

    const result = collapseStateGroups(parsed, new Set([fulfillmentGroup.id]));

    expect(result.collapsedChildCounts.get(fulfillmentGroup.id)).toBe(
      fulfillmentGroup.nodeIds.length
    );
  });

  it('preserves originalGroups reference', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const fulfillmentGroup = parsed.groups!.find(
      (g) => g.label === 'Fulfillment'
    )!;

    const result = collapseStateGroups(parsed, new Set([fulfillmentGroup.id]));

    expect(result.originalGroups).toBe(parsed.groups);
  });

  it('handles collapsing all groups', () => {
    const parsed = parse(GROUPED_DIAGRAM);
    const allGroupIds = new Set(parsed.groups!.map((g) => g.id));

    const result = collapseStateGroups(parsed, allGroupIds);

    // Only pseudostate nodes should remain (not in any group)
    for (const node of result.parsed.nodes) {
      expect(node.group).toBeUndefined();
    }
    // No groups in the output
    expect(result.parsed.groups).toHaveLength(0);
  });

  it('handles diagram with no groups', () => {
    const parsed = parse('[*] -> Idle\nIdle -> Active\nActive -> [*]');
    const result = collapseStateGroups(parsed, new Set(['group:nonexistent']));

    expect(result.parsed).toBe(parsed);
    expect(result.collapsedChildCounts.size).toBe(0);
  });
});
