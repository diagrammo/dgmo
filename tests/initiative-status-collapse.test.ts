import { describe, it, expect } from 'vitest';
import { collapseInitiativeStatus } from '../src/initiative-status/collapse';
import type { ParsedInitiativeStatus } from '../src/initiative-status/types';

// ============================================================
// Fixtures
// ============================================================

function makeParsed(overrides: Partial<ParsedInitiativeStatus> = {}): ParsedInitiativeStatus {
  return {
    type: 'initiative-status',
    title: null,
    titleLineNumber: null,
    nodes: [],
    edges: [],
    groups: [],
    options: {},
    diagnostics: [],
    error: null,
    ...overrides,
  };
}

const parsed = makeParsed({
  nodes: [
    { label: 'A', status: 'done', shape: 'default', lineNumber: 1 },
    { label: 'B', status: 'todo', shape: 'default', lineNumber: 2 },
    { label: 'C', status: 'wip',  shape: 'default', lineNumber: 3 },
    { label: 'D', status: 'done', shape: 'default', lineNumber: 4 },
    { label: 'E', status: 'done', shape: 'default', lineNumber: 5 },
  ],
  edges: [
    { source: 'A', target: 'B', label: 'calls', status: null, lineNumber: 10 },
    { source: 'B', target: 'C', label: 'calls', status: null, lineNumber: 11 },
    { source: 'C', target: 'D', label: 'sends', status: null, lineNumber: 12 },
    { source: 'A', target: 'C', label: undefined, status: null, lineNumber: 13 },
    { source: 'D', target: 'E', label: undefined, status: null, lineNumber: 14 },
  ],
  groups: [
    { label: 'GroupX', nodeLabels: ['B', 'C'], lineNumber: 20 },
    { label: 'GroupY', nodeLabels: ['D', 'E'], lineNumber: 30 },
  ],
});

// ============================================================
// Tests
// ============================================================

describe('collapseInitiativeStatus', () => {
  it('returns original parsed unchanged when collapsedGroups is empty', () => {
    const result = collapseInitiativeStatus(parsed, new Set());
    expect(result.parsed).toBe(parsed);
    expect(result.collapsedGroupStatuses.size).toBe(0);
    expect(result.originalGroups).toBe(parsed.groups);
  });

  it('excludes children of collapsed group from nodes', () => {
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    const nodeLabels = result.parsed.nodes.map((n) => n.label);
    expect(nodeLabels).not.toContain('B');
    expect(nodeLabels).not.toContain('C');
    expect(nodeLabels).toContain('A');
    expect(nodeLabels).toContain('D');
    expect(nodeLabels).toContain('E');
  });

  it('keeps expanded group children in nodes', () => {
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    const nodeLabels = result.parsed.nodes.map((n) => n.label);
    expect(nodeLabels).toContain('D');
    expect(nodeLabels).toContain('E');
  });

  it('removes collapsed group from groups and keeps expanded group', () => {
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    const groupLabels = result.parsed.groups.map((g) => g.label);
    expect(groupLabels).not.toContain('GroupX');
    expect(groupLabels).toContain('GroupY');
  });

  it('originalGroups contains the full original group list', () => {
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    expect(result.originalGroups).toHaveLength(2);
    expect(result.originalGroups.map((g) => g.label)).toEqual(['GroupX', 'GroupY']);
  });

  it('drops internal edges where both endpoints are in the same collapsed group', () => {
    // B→C is internal to GroupX
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    const edgePairs = result.parsed.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).not.toContain('B→C');
  });

  it('redirects edge from external node to hidden node → to group label', () => {
    // A→B: B is in GroupX, so becomes A→GroupX with label 'calls'
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    const edge = result.parsed.edges.find(
      (e) => e.source === 'A' && e.target === 'GroupX' && e.label === 'calls'
    );
    expect(edge).toBeDefined();
  });

  it('redirects edge from hidden node to external node → source becomes group label', () => {
    // C→D: C is in GroupX, D is in GroupY (expanded), so becomes GroupX→D
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    const edge = result.parsed.edges.find(
      (e) => e.source === 'GroupX' && e.target === 'D'
    );
    expect(edge).toBeDefined();
  });

  it('handles edge between two collapsed groups: both endpoints redirected', () => {
    // C→D: C in GroupX, D in GroupY → GroupX→GroupY
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX', 'GroupY']));
    const edge = result.parsed.edges.find(
      (e) => e.source === 'GroupX' && e.target === 'GroupY'
    );
    expect(edge).toBeDefined();
  });

  it('deduplicates edges with same (source, target, label) after redirect', () => {
    // A→B (label 'calls') and A→C (label undefined) both redirect to A→GroupX
    // A→B becomes A→GroupX|calls
    // A→C becomes A→GroupX|(empty) — different label, so both kept
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    const aToGroupX = result.parsed.edges.filter(
      (e) => e.source === 'A' && e.target === 'GroupX'
    );
    // One edge with label 'calls', one without — both should appear (different labels)
    expect(aToGroupX.length).toBe(2);
  });

  it('deduplicates when multiple children produce same (src, tgt, label)', () => {
    const p = makeParsed({
      nodes: [
        { label: 'A', status: 'done', shape: 'default', lineNumber: 1 },
        { label: 'B', status: 'todo', shape: 'default', lineNumber: 2 },
        { label: 'C', status: 'wip',  shape: 'default', lineNumber: 3 },
        { label: 'Ext', status: null, shape: 'default', lineNumber: 4 },
      ],
      edges: [
        { source: 'B', target: 'Ext', label: 'ping', status: null, lineNumber: 10 },
        { source: 'C', target: 'Ext', label: 'ping', status: null, lineNumber: 11 },
      ],
      groups: [
        { label: 'G', nodeLabels: ['B', 'C'], lineNumber: 20 },
      ],
    });
    const result = collapseInitiativeStatus(p, new Set(['G']));
    const gToExt = result.parsed.edges.filter(
      (e) => e.source === 'G' && e.target === 'Ext' && e.label === 'ping'
    );
    expect(gToExt).toHaveLength(1);
  });

  it('keeps both edges when children have different labels to same target', () => {
    const p = makeParsed({
      nodes: [
        { label: 'B', status: 'todo', shape: 'default', lineNumber: 2 },
        { label: 'C', status: 'wip',  shape: 'default', lineNumber: 3 },
        { label: 'Ext', status: null, shape: 'default', lineNumber: 4 },
      ],
      edges: [
        { source: 'B', target: 'Ext', label: 'ping', status: null, lineNumber: 10 },
        { source: 'C', target: 'Ext', label: 'pong', status: null, lineNumber: 11 },
      ],
      groups: [
        { label: 'G', nodeLabels: ['B', 'C'], lineNumber: 20 },
      ],
    });
    const result = collapseInitiativeStatus(p, new Set(['G']));
    const gToExt = result.parsed.edges.filter(
      (e) => e.source === 'G' && e.target === 'Ext'
    );
    expect(gToExt).toHaveLength(2);
  });

  it('collapsedGroupStatuses: worst-case = todo for group with todo+done children', () => {
    const result = collapseInitiativeStatus(parsed, new Set(['GroupX']));
    // GroupX has B(todo) and C(wip) → worst = todo
    expect(result.collapsedGroupStatuses.get('GroupX')).toBe('todo');
  });

  it('collapsedGroupStatuses: worst-case = wip for group with wip+done children', () => {
    const p = makeParsed({
      nodes: [
        { label: 'A', status: 'wip',  shape: 'default', lineNumber: 1 },
        { label: 'B', status: 'done', shape: 'default', lineNumber: 2 },
      ],
      groups: [{ label: 'G', nodeLabels: ['A', 'B'], lineNumber: 10 }],
    });
    const result = collapseInitiativeStatus(p, new Set(['G']));
    expect(result.collapsedGroupStatuses.get('G')).toBe('wip');
  });
});
