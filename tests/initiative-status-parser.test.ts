import { describe, it, expect } from 'vitest';
import { parseInitiativeStatus, looksLikeInitiativeStatus } from '../src/initiative-status/parser';

describe('parseInitiativeStatus', () => {
  // === Metadata ===
  describe('metadata', () => {
    it('parses chart: initiative-status', () => {
      const result = parseInitiativeStatus('chart: initiative-status\nMobile | done');
      expect(result.type).toBe('initiative-status');
      expect(result.error).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    });

    it('rejects wrong chart type', () => {
      const result = parseInitiativeStatus('chart: flowchart\nMobile | done');
      expect(result.error).toContain('Expected chart type "initiative-status"');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('parses title', () => {
      const result = parseInitiativeStatus('chart: initiative-status\ntitle: Project Phoenix\nMobile | done');
      expect(result.title).toBe('Project Phoenix');
      expect(result.titleLineNumber).toBe(2);
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores # comments', () => {
      const result = parseInitiativeStatus('# this is a comment\nMobile | done');
      expect(result.diagnostics).toEqual([]);
      expect(result.nodes).toHaveLength(1);
    });

    it('ignores // comments', () => {
      const result = parseInitiativeStatus('// this is a comment\nMobile | done');
      expect(result.diagnostics).toEqual([]);
      expect(result.nodes).toHaveLength(1);
    });

    it('skips blank lines', () => {
      const result = parseInitiativeStatus('Mobile | done\n\nBack End | wip');
      expect(result.nodes).toHaveLength(2);
    });
  });

  // === Nodes ===
  describe('nodes', () => {
    it('parses node with status', () => {
      const result = parseInitiativeStatus('Mobile | done');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('Mobile');
      expect(result.nodes[0].status).toBe('done');
      expect(result.nodes[0].lineNumber).toBe(1);
    });

    it('parses node without status', () => {
      const result = parseInitiativeStatus('Back End');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('Back End');
      expect(result.nodes[0].status).toBeNull();
    });

    it('parses all status values', () => {
      const input = 'A | done\nB | wip\nC | todo\nD | na';
      const result = parseInitiativeStatus(input);
      expect(result.nodes.map((n) => n.status)).toEqual(['done', 'wip', 'todo', 'na']);
    });

    it('warns on duplicate node labels', () => {
      const result = parseInitiativeStatus('Mobile | done\nMobile | wip');
      expect(result.nodes).toHaveLength(2);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('warning');
      expect(result.diagnostics[0].message).toContain('Duplicate node');
    });

    it('warns on unknown status', () => {
      const result = parseInitiativeStatus('Mobile | inprogress');
      expect(result.nodes[0].status).toBeNull();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('warning');
      expect(result.diagnostics[0].message).toContain('Unknown status');
    });

    it('status is case-insensitive', () => {
      const result = parseInitiativeStatus('A | Done\nB | WIP\nC | TODO\nD | NA');
      expect(result.nodes.map((n) => n.status)).toEqual(['done', 'wip', 'todo', 'na']);
      expect(result.diagnostics).toEqual([]);
    });
  });

  // === Edges ===
  describe('edges', () => {
    it('parses edge with label and status', () => {
      const result = parseInitiativeStatus('A | done\nB | done\nA -> B: getUser | done');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[0].label).toBe('getUser');
      expect(result.edges[0].status).toBe('done');
    });

    it('parses edge without label', () => {
      const result = parseInitiativeStatus('A | done\nB | done\nA -> B | wip');
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[0].label).toBeUndefined();
      expect(result.edges[0].status).toBe('wip');
    });

    it('parses edge without status', () => {
      const result = parseInitiativeStatus('A | done\nB | done\nA -> B: getUser');
      expect(result.edges[0].label).toBe('getUser');
      expect(result.edges[0].status).toBeNull();
    });

    it('parses bare edge', () => {
      const result = parseInitiativeStatus('A | done\nB | done\nA -> B');
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[0].label).toBeUndefined();
      expect(result.edges[0].status).toBeNull();
    });

    it('parses multiple edges between same pair', () => {
      const input = 'A | done\nB | done\nA -> B: getUser | done\nA -> B: getEvent | todo';
      const result = parseInitiativeStatus(input);
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].label).toBe('getUser');
      expect(result.edges[1].label).toBe('getEvent');
    });

    it('warns on edge referencing undeclared node', () => {
      const result = parseInitiativeStatus('A | done\nA -> B: api | done');
      expect(result.diagnostics.some((d) => d.message.includes('not a declared node'))).toBe(true);
      // Auto-creates the implicit node
      expect(result.nodes.some((n) => n.label === 'B')).toBe(true);
    });
  });

  // === Groups ===
  describe('groups', () => {
    it('parses a group with indented children', () => {
      const input = `chart: initiative-status
title: Test
User | na
[External]
  Identity Service | na
  Vendor | na`;
      const result = parseInitiativeStatus(input);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].label).toBe('External');
      expect(result.groups[0].nodeLabels).toEqual(['Identity Service', 'Vendor']);
      expect(result.nodes).toHaveLength(3);
    });

    it('closes group on non-indented line', () => {
      const input = `[Group A]
  A | done
B | wip`;
      const result = parseInitiativeStatus(input);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].nodeLabels).toEqual(['A']);
      expect(result.nodes).toHaveLength(2);
    });

    it('supports multiple groups', () => {
      const input = `[First]
  A | done
[Second]
  B | wip
  C | todo`;
      const result = parseInitiativeStatus(input);
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].label).toBe('First');
      expect(result.groups[0].nodeLabels).toEqual(['A']);
      expect(result.groups[1].label).toBe('Second');
      expect(result.groups[1].nodeLabels).toEqual(['B', 'C']);
    });

    it('records group line number', () => {
      const input = `A | done\n[MyGroup]\n  B | wip`;
      const result = parseInitiativeStatus(input);
      expect(result.groups[0].lineNumber).toBe(2);
    });

    it('does not add non-indented nodes to group', () => {
      const input = `[Group]
  A | done
B | wip`;
      const result = parseInitiativeStatus(input);
      expect(result.groups[0].nodeLabels).toEqual(['A']);
    });

    it('closes trailing group at end of input', () => {
      const input = `[Trailing]
  X | na`;
      const result = parseInitiativeStatus(input);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].nodeLabels).toEqual(['X']);
    });

    it('edges inside groups are parsed normally', () => {
      const input = `A | done
[External]
  B | wip
  A -> B | done`;
      const result = parseInitiativeStatus(input);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('A');
      expect(result.groups[0].nodeLabels).toEqual(['B']);
    });
  });

  // === Full diagram ===
  describe('full diagram', () => {
    it('parses the example from the plan', () => {
      const input = `chart: initiative-status
title: Project Phoenix

Mobile | done
Web Front End | todo
Back End | wip
Identity Service | na
Some Service | wip
Database | done
Another Service | wip
Vendor | na

Mobile -> Back End: getUser | done
Mobile -> Back End: getEvent | todo
Back End -> Identity Service: auth | done
Back End -> Some Service: getData | todo
Back End -> Database: query | done
Back End -> Database: migrate | done
Back End -> Vendor: processPayment | wip
Back End -> Vendor: getReceipt | todo
Another Service -> Back End: callback | wip
Web Front End -> Back End: API | todo`;

      const result = parseInitiativeStatus(input);
      expect(result.error).toBeUndefined();
      expect(result.title).toBe('Project Phoenix');
      expect(result.nodes).toHaveLength(8);
      expect(result.edges).toHaveLength(10);
      expect(result.diagnostics).toEqual([]);
    });

    it('parses diagram with groups', () => {
      const input = `chart: initiative-status
title: Project Phoenix

User | na
Mobile | done
Back End | wip
[External]
  Identity Service | na
  Vendor | na

Mobile -> Back End: getUser | done
Back End -> Identity Service: auth | done`;

      const result = parseInitiativeStatus(input);
      expect(result.error).toBeUndefined();
      expect(result.nodes).toHaveLength(5);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].label).toBe('External');
      expect(result.groups[0].nodeLabels).toEqual(['Identity Service', 'Vendor']);
      expect(result.edges).toHaveLength(2);
    });
  });
});

describe('looksLikeInitiativeStatus', () => {
  it('detects arrows with status markers', () => {
    expect(looksLikeInitiativeStatus('A | done\nA -> B: api | done')).toBe(true);
  });

  it('rejects content without status markers', () => {
    expect(looksLikeInitiativeStatus('A -> B\nB -> C')).toBe(false);
  });

  it('rejects content without arrows', () => {
    expect(looksLikeInitiativeStatus('A | done\nB | wip')).toBe(false);
  });
});
