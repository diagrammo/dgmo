import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { focusBoxesAndLines } from '../src/boxes-and-lines/focus';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

// Unit tests for the boxes-and-lines focus (1-hop neighborhood) transform.
// Cover the contract + every failure mode (FM1–FM11) and the core acceptance
// criteria that are testable at the transform level.

const HEADER = 'boxes-and-lines';
const src = (...lines: string[]) => [HEADER, ...lines].join('\n');
const labels = (r: { parsed: { nodes: readonly { label: string }[] } }) =>
  r.parsed.nodes.map((n) => n.label);
const hasEdge = (
  r: { parsed: { edges: readonly { source: string; target: string }[] } },
  s: string,
  t: string
) => r.parsed.edges.some((e) => e.source === s && e.target === t);

describe('focusBoxesAndLines', () => {
  it('AC1: box focus keeps only the 1-hop neighbors', () => {
    const parsed = parseBoxesAndLines(src('A -> B', 'A -> C', 'D -> E'));
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'A' });
    expect(new Set(labels(r))).toEqual(new Set(['A', 'B', 'C']));
    expect(hasEdge(r, 'A', 'B')).toBe(true);
    expect(hasEdge(r, 'A', 'C')).toBe(true);
    // Unrelated subgraph hidden.
    expect(labels(r)).not.toContain('D');
    expect(labels(r)).not.toContain('E');
    expect(r.neighborIds).toEqual(new Set(['B', 'C']));
  });

  it('AC2: group focus keeps the group EXPANDED + edged neighbors, hides the rest', () => {
    const parsed = parseBoxesAndLines(
      src('[G]', '  M1', '  M2', 'X -> M1', 'Z')
    );
    const r = focusBoxesAndLines(parsed, { kind: 'group', id: '__group_G' });
    // Group stays expanded (present in groups[]) with both members visible.
    expect(r.parsed.groups.some((g) => g.label === 'G')).toBe(true);
    expect(new Set(labels(r))).toEqual(new Set(['M1', 'M2', 'X']));
    expect(hasEdge(r, 'X', 'M1')).toBe(true);
    // No-edge box hidden.
    expect(labels(r)).not.toContain('Z');
    expect(r.collapsedNeighborGroupIds.size).toBe(0);
  });

  it('AC3 / FM8: a neighbor box inside a group collapses that group + dedups edges', () => {
    const parsed = parseBoxesAndLines(
      src('[H]', '  M1', '  M2', 'A -> M1', 'A -> M2')
    );
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'A' });
    // H collapsed: not in groups[], tracked as a collapsed neighbor.
    expect(r.parsed.groups.some((g) => g.label === 'H')).toBe(false);
    expect(r.collapsedNeighborGroupIds).toEqual(new Set(['H']));
    expect(r.neighborIds).toEqual(new Set(['__group_H']));
    // Both member edges redirected to the collapsed group and deduped to one.
    expect(hasEdge(r, 'A', '__group_H')).toBe(true);
    expect(r.parsed.edges.filter((e) => e.target === '__group_H')).toHaveLength(
      1
    );
    // collapseInfo lets layout materialize the collapsed box.
    expect(r.collapseInfo.collapsedChildCounts.get('H')).toBe(2);
  });

  it('AC4 / FM1 / Dec20: ramp domain is GLOBAL (pre-filter)', () => {
    const parsed = parseBoxesAndLines(
      src(
        'box-metric Cost',
        'A value: 10',
        'B value: 50',
        'C value: 100',
        'A -> B'
      )
    );
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'A' });
    // C is hidden, but the domain still spans the whole diagram.
    expect(r.rampDomain).toEqual({ min: 10, max: 100 });
    expect(labels(r)).not.toContain('C');
  });

  it('FM3: member↔member edges inside the focused group are internal, not neighbor-producing', () => {
    const parsed = parseBoxesAndLines(
      src('[G]', '  M1', '  M2', 'M1 -> M2', 'X -> M1')
    );
    const r = focusBoxesAndLines(parsed, { kind: 'group', id: '__group_G' });
    expect(hasEdge(r, 'M1', 'M2')).toBe(true); // internal edge retained
    expect(r.neighborIds).toEqual(new Set(['X'])); // M2 is NOT a neighbor
  });

  it('FM4: a standalone neighbor box (no group) is shown as a box, not collapsed', () => {
    const parsed = parseBoxesAndLines(src('A -> X'));
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'A' });
    expect(labels(r)).toContain('X');
    expect(r.collapsedNeighborGroupIds.size).toBe(0);
    expect(r.neighborIds).toEqual(new Set(['X']));
  });

  it('FM5: a self-loop on the focused box is preserved', () => {
    const parsed = parseBoxesAndLines(src('A -> A', 'A -> B'));
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'A' });
    expect(hasEdge(r, 'A', 'A')).toBe(true);
    expect(hasEdge(r, 'A', 'B')).toBe(true);
  });

  it('FM6: nested (2-level) group membership recurses', () => {
    const parsed = parseBoxesAndLines(
      src('[G]', '  [Sub]', '    M1', 'X -> M1')
    );
    const r = focusBoxesAndLines(parsed, { kind: 'group', id: '__group_G' });
    expect(labels(r)).toContain('M1');
    expect(labels(r)).toContain('X'); // edge to a deeply-nested member counts
    expect(r.neighborIds).toEqual(new Set(['X']));
  });

  it('FM7: alias endpoints resolve to canonical labels; missing target does not throw', () => {
    const parsed = parseBoxesAndLines(src('Long Name as ln', 'ln -> B'));
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'Long Name' });
    expect(hasEdge(r, 'Long Name', 'B')).toBe(true);
    expect(labels(r)).toContain('B');
    // A target that no longer exists yields an empty (lone) result, no throw.
    const empty = focusBoxesAndLines(parsed, { kind: 'box', id: 'Nope' });
    expect(empty.parsed.nodes).toHaveLength(0);
    expect(empty.neighborIds.size).toBe(0);
  });

  it('FM9: notes follow their owner box', () => {
    const parsed = parseBoxesAndLines(
      src('A -> B', 'D -> E', 'note A hello', 'note D world')
    );
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'A' });
    const refs = (r.parsed.notes ?? []).map((n) => n.ref);
    expect(refs).toContain('A');
    expect(refs).not.toContain('D');
  });

  it('Dec21 / FM2: pinned nodePositions are cleared on the focused subset', () => {
    const parsed = parseBoxesAndLines(
      src(
        'A -> B',
        'C -> A',
        'layout',
        '  A: 10, 20',
        '  B: 100, 20',
        '  C: 50, 80'
      )
    );
    expect(parsed.nodePositions).toBeDefined();
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'A' });
    expect(r.parsed.nodePositions).toBeUndefined();
  });

  it('AC10 / Dec19: an edge-less target returns the lone element', () => {
    const parsed = parseBoxesAndLines(src('Lonely', 'B -> C'));
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'Lonely' });
    expect(labels(r)).toEqual(['Lonely']);
    expect(r.parsed.edges).toHaveLength(0);
    expect(r.neighborIds.size).toBe(0);
  });

  it('AC11 / Dec14: a hub shows all neighbors (no cap)', () => {
    const edges = Array.from({ length: 30 }, (_, i) => `Hub -> N${i}`);
    const parsed = parseBoxesAndLines(src(...edges));
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'Hub' });
    expect(r.neighborIds.size).toBe(30);
    expect(labels(r)).toHaveLength(31); // Hub + 30 neighbors
  });

  it('AC17: the filtered model lays out cleanly', async () => {
    const parsed = parseBoxesAndLines(
      src('[H]', '  M1', '  M2', 'A -> M1', 'A -> B')
    );
    const r = focusBoxesAndLines(parsed, { kind: 'box', id: 'A' });
    const layout = await layoutBoxesAndLines(r.parsed, r.collapseInfo);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    // Collapsed neighbor group materialized as a box.
    expect(layout.groups.some((g) => g.label === 'H' && g.collapsed)).toBe(
      true
    );
    // Focused box + standalone neighbor laid out.
    expect(layout.nodes.some((n) => n.label === 'A')).toBe(true);
    expect(layout.nodes.some((n) => n.label === 'B')).toBe(true);
  });
});
