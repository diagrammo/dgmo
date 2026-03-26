import { describe, it, expect } from 'vitest';
import { parseInitiativeStatus, looksLikeInitiativeStatus, parseNodeMetadata } from '../src/initiative-status/parser';

describe('parseInitiativeStatus', () => {
  // === Metadata ===
  describe('metadata', () => {
    it('parses bare initiative-status on first line', () => {
      const result = parseInitiativeStatus('initiative-status\nMobile | done');
      expect(result.type).toBe('initiative-status');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('rejects wrong chart type', () => {
      const result = parseInitiativeStatus('flowchart\nMobile | done');
      expect(result.error).toContain('Expected chart type "initiative-status"');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('parses title on first line', () => {
      const result = parseInitiativeStatus('initiative-status Project Phoenix\nMobile | done');
      expect(result.title).toBe('Project Phoenix');
      expect(result.titleLineNumber).toBe(1);
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('# is not a comment — only // is supported', () => {
      const result = parseInitiativeStatus('# this is a comment\nMobile | done');
      // # is parsed as a node, not a comment
      expect(result.nodes).toHaveLength(2);
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
      expect(result.nodes[0].status).toBe('na');
    });

    it('parses all status values', () => {
      const input = 'A | done\nB | doing\nC | todo\nD | na';
      const result = parseInitiativeStatus(input);
      expect(result.nodes.map((n) => n.status)).toEqual(['done', 'doing', 'todo', 'na']);
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
      expect(result.nodes.map((n) => n.status)).toEqual(['done', 'doing', 'todo', 'na']);
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
      const result = parseInitiativeStatus('A | done\nB | done\nA -> B | doing');
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[0].label).toBeUndefined();
      expect(result.edges[0].status).toBe('doing');
    });

    it('parses edge without status', () => {
      const result = parseInitiativeStatus('A | done\nB | done\nA -> B: getUser');
      expect(result.edges[0].label).toBe('getUser');
      expect(result.edges[0].status).toBe('na');
    });

    it('parses bare edge', () => {
      const result = parseInitiativeStatus('A | done\nB | done\nA -> B');
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[0].label).toBeUndefined();
      expect(result.edges[0].status).toBe('na');
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
      const input = `initiative-status Test
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

  // === Indented edge shorthand ===
  describe('indented edge shorthand', () => {
    it('parses indented edge with implied source', () => {
      const input = `A | done\nB | done\nA | done\n  -> B: getUser | done`;
      const result = parseInitiativeStatus(input);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[0].label).toBe('getUser');
      expect(result.edges[0].status).toBe('done');
    });

    it('parses multiple indented edges under one node', () => {
      const input = `A | done\nB | done\nC | done\nA | done\n  -> B: api | done\n  -> C: rpc | wip`;
      const result = parseInitiativeStatus(input);
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[1].source).toBe('A');
      expect(result.edges[1].target).toBe('C');
    });

    it('mixes flat and indented edge syntax', () => {
      const input = `A | done\nB | done\nC | done\nA -> B: flat | done\nC | done\n  -> A: indented | wip`;
      const result = parseInitiativeStatus(input);
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[1].source).toBe('C');
      expect(result.edges[1].target).toBe('A');
    });

    it('warns when indented edge has no preceding node', () => {
      const input = `  -> B: api | done`;
      const result = parseInitiativeStatus(input);
      expect(result.edges).toHaveLength(0);
      expect(result.diagnostics.some((d) => d.message.includes('no preceding node'))).toBe(true);
    });

    it('parses indented edges under nodes inside groups', () => {
      const input = `A | done\n[External]\n  B | wip\n    -> A: callback | done`;
      const result = parseInitiativeStatus(input);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('B');
      expect(result.edges[0].target).toBe('A');
      expect(result.edges[0].status).toBe('done');
    });

    it('parses Operation Blackbeard example', () => {
      const input = `initiative-status Operation Blackbeard

Captain
  -> CrewApp: issueOrders
  -> ShipDashboard: viewCharts
CrewApp | done
  -> Quartermaster: getCrewRoster | done
  -> Quartermaster: assignWatch | todo
ShipDashboard | todo
  -> Quartermaster: API | todo
Quartermaster | wip
  -> PortAuthority: dockRequest | done
  -> NavigationService: plotCourse | todo
  -> ShipLog: recordVoyage | done
  -> ShipLog: logMutiny | done
  -> TradingPost: tradeGoods | wip
  -> TradingPost: fenceBooty | todo
NavigationService | wip
ShipLog | done
CargoService | wip
  -> Quartermaster: inventoryUpdate | wip
[Royal Navy]
  PortAuthority
  TradingPost`;

      const result = parseInitiativeStatus(input);
      expect(result.error).toBeNull();
      expect(result.title).toBe('Operation Blackbeard');
      expect(result.nodes.map((n) => n.label)).toEqual([
        'Captain', 'CrewApp', 'ShipDashboard', 'Quartermaster',
        'NavigationService', 'ShipLog', 'CargoService',
        'PortAuthority', 'TradingPost',
      ]);
      expect(result.edges).toHaveLength(12);
      expect(result.edges[0]).toMatchObject({ source: 'Captain', target: 'CrewApp', label: 'issueOrders', status: 'na' });
      expect(result.edges[1]).toMatchObject({ source: 'Captain', target: 'ShipDashboard', label: 'viewCharts', status: 'na' });
      expect(result.edges[2]).toMatchObject({ source: 'CrewApp', target: 'Quartermaster', label: 'getCrewRoster', status: 'done' });
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].label).toBe('Royal Navy');
      expect(result.groups[0].nodeLabels).toEqual(['PortAuthority', 'TradingPost']);
      // Captain has no explicit status → defaults to 'na'
      expect(result.nodes[0]).toMatchObject({ label: 'Captain', status: 'na' });
    });
  });

  // === Full diagram ===
  describe('full diagram', () => {
    it('parses the example from the plan', () => {
      const input = `initiative-status Project Phoenix

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
      expect(result.error).toBeNull();
      expect(result.title).toBe('Project Phoenix');
      expect(result.nodes).toHaveLength(8);
      expect(result.edges).toHaveLength(10);
      expect(result.diagnostics).toEqual([]);
    });

    it('parses diagram with groups', () => {
      const input = `initiative-status Project Phoenix

User | na
Mobile | done
Back End | wip
[External]
  Identity Service | na
  Vendor | na

Mobile -> Back End: getUser | done
Back End -> Identity Service: auth | done`;

      const result = parseInitiativeStatus(input);
      expect(result.error).toBeNull();
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

  it('detects indented arrows without status markers', () => {
    expect(looksLikeInitiativeStatus('Captain\n  -> CrewApp: issueOrders\n  -> ShipDashboard: viewCharts')).toBe(true);
  });

  it('detects indented labeled arrows', () => {
    expect(looksLikeInitiativeStatus('Planning\n  -approved-> Design')).toBe(true);
  });
});

// ============================================================
// Labeled arrow syntax
// ============================================================
describe('parseInitiativeStatus — labeled arrows', () => {
  it('-label-> produces edge with label', () => {
    const result = parseInitiativeStatus('Planning | todo\nDesign | todo\nPlanning -approved-> Design');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'Planning',
      target: 'Design',
      label: 'approved',
    });
  });

  it('-label-> with status', () => {
    const result = parseInitiativeStatus('A | todo\nB | todo\nA -go-> B | done');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'A',
      target: 'B',
      label: 'go',
      status: 'done',
    });
  });

  it('indented -label-> edge', () => {
    const result = parseInitiativeStatus('Planning | todo\nDesign | todo\nPlanning\n  -approved-> Design');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'Planning',
      target: 'Design',
      label: 'approved',
    });
  });

  it('coexists with plain -> syntax', () => {
    const result = parseInitiativeStatus('A | todo\nB | todo\nC | todo\nA -go-> B\nB -> C: next');
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].label).toBe('go');
    expect(result.edges[1].label).toBe('next');
  });
});

// ============================================================
// Tag groups
// ============================================================

describe('tag groups', () => {
  describe('parseNodeMetadata', () => {
    const emptyAliasMap = new Map<string, string>();
    const aliasMap = new Map([['p', 'phase'], ['t', 'team']]);

    it('parses status-only segment', () => {
      const result = parseNodeMetadata('done', emptyAliasMap);
      expect(result.status).toBe('done');
      expect(result.metadata).toEqual({});
      expect(result.hadStatusWord).toBe(true);
    });

    it('parses status + tags', () => {
      const result = parseNodeMetadata('wip, p: Build, t: Backend', aliasMap);
      expect(result.status).toBe('doing');
      expect(result.metadata).toEqual({ phase: 'Build', team: 'Backend' });
    });

    it('parses tags-only (no status keyword)', () => {
      const result = parseNodeMetadata('p: Build', aliasMap);
      expect(result.status).toBeNull();
      expect(result.metadata).toEqual({ phase: 'Build' });
      expect(result.hadStatusWord).toBe(false);
    });

    it('handles flexible order — tags before status', () => {
      const result = parseNodeMetadata('p: Build, done', aliasMap);
      expect(result.status).toBe('done');
      expect(result.metadata).toEqual({ phase: 'Build' });
    });

    it('resolves aliases to lowercase group names', () => {
      const result = parseNodeMetadata('t: Frontend', aliasMap);
      expect(result.metadata).toEqual({ team: 'Frontend' });
    });

    it('lowercases metadata keys', () => {
      const map = new Map<string, string>();
      const result = parseNodeMetadata('Phase: Build', map);
      expect(result.metadata).toEqual({ phase: 'Build' });
    });
  });

  describe('tag block declarations', () => {
    it('parses tag block with alias and colored entries', () => {
      const input = `initiative-status
tag Phase p
  Discovery(blue)
  Build(yellow)
  Launch(green)

API | wip, p: Build`;
      const result = parseInitiativeStatus(input);
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Phase');
      expect(result.tagGroups[0].alias).toBe('p');
      expect(result.tagGroups[0].entries).toHaveLength(3);
      expect(result.tagGroups[0].entries[0]).toMatchObject({ value: 'Discovery', color: '#5e81ac' });
      expect(result.tagGroups[0].entries[1]).toMatchObject({ value: 'Build', color: '#ebcb8b' });
      expect(result.tagGroups[0].entries[2]).toMatchObject({ value: 'Launch', color: '#a3be8c' });
    });

    it('parses multiple tag groups', () => {
      const input = `initiative-status
tag Phase p
  Build(yellow)
tag Team t
  Frontend(purple)
  Backend(cyan)

API | done`;
      const result = parseInitiativeStatus(input);
      expect(result.tagGroups).toHaveLength(2);
      expect(result.tagGroups[0].name).toBe('Phase');
      expect(result.tagGroups[1].name).toBe('Team');
      expect(result.tagGroups[1].entries).toHaveLength(2);
    });

    it('parses tag entries without color', () => {
      const input = `initiative-status
tag Phase
  Build
  Launch

API | done`;
      const result = parseInitiativeStatus(input);
      expect(result.tagGroups[0].entries[0]).toMatchObject({ value: 'Build', color: '' });
    });

    it('first tag value is the default', () => {
      const input = `initiative-status
tag Phase p
  Planning(blue)
  Build(green)

API | done`;
      const result = parseInitiativeStatus(input);
      expect(result.tagGroups[0].defaultValue).toBe('Planning');
    });

    it('emits error when tag block appears after content', () => {
      const input = `initiative-status
API | done
tag Phase
  Build(yellow)`;
      const result = parseInitiativeStatus(input);
      const errors = result.diagnostics.filter(d => d.severity === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Tag groups must appear before diagram content');
      expect(result.tagGroups).toHaveLength(0);
    });
  });

  describe('node pipe metadata with tags', () => {
    it('parses node with status + tag metadata', () => {
      const input = `initiative-status
tag Phase p
  Build(yellow)

API | wip, p: Build`;
      const result = parseInitiativeStatus(input);
      expect(result.nodes[0].status).toBe('doing');
      expect(result.nodes[0].metadata).toEqual({ phase: 'Build' });
    });

    it('parses node with tags only — status defaults to na', () => {
      const input = `initiative-status
tag Phase p
  Build(yellow)

API | p: Build`;
      const result = parseInitiativeStatus(input);
      expect(result.nodes[0].status).toBe('na');
      expect(result.nodes[0].metadata).toEqual({ phase: 'Build' });
    });

    it('handles flexible order: tags before status', () => {
      const input = `initiative-status
tag Phase p
  Build(yellow)

API | p: Build, done`;
      const result = parseInitiativeStatus(input);
      expect(result.nodes[0].status).toBe('done');
      expect(result.nodes[0].metadata).toEqual({ phase: 'Build' });
    });

    it('backward compat: node with status only, no tags', () => {
      const input = 'API | done';
      const result = parseInitiativeStatus(input);
      expect(result.nodes[0].status).toBe('done');
      expect(result.nodes[0].metadata).toEqual({});
    });

    it('node with no pipe has empty metadata', () => {
      const result = parseInitiativeStatus('API');
      expect(result.nodes[0].metadata).toEqual({});
      expect(result.nodes[0].status).toBe('na');
    });
  });

  describe('edge pipe metadata with tags', () => {
    it('parses edge with status + tags', () => {
      const input = `initiative-status
tag Phase p
  Build(yellow)

A | done
B | done
A -> B | done, p: Build`;
      const result = parseInitiativeStatus(input);
      expect(result.edges[0].status).toBe('done');
      expect(result.edges[0].metadata).toEqual({ phase: 'Build' });
    });

    it('edge with status only (backward compat)', () => {
      const input = `A | done\nB | done\nA -> B | wip`;
      const result = parseInitiativeStatus(input);
      expect(result.edges[0].status).toBe('doing');
      expect(result.edges[0].metadata).toEqual({});
    });
  });

  describe('default tag values', () => {
    it('injects default tag value on untagged nodes', () => {
      const input = `initiative-status
tag Phase p
  Planning(blue)
  Build(green)

API | done
DB | done, p: Build`;
      const result = parseInitiativeStatus(input);
      // API has no phase tag → gets default (first value = "Planning")
      expect(result.nodes[0].metadata.phase).toBe('Planning');
      // DB has explicit phase → keeps "Build"
      expect(result.nodes[1].metadata.phase).toBe('Build');
    });
  });

  describe('tag validation warnings', () => {
    it('warns on unknown tag values with did-you-mean', () => {
      const input = `initiative-status
tag Phase p
  Build(yellow)
  Launch(green)

API | done, p: Buidl`;
      const result = parseInitiativeStatus(input);
      const warnings = result.diagnostics.filter(d => d.severity === 'warning');
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings.some(w => w.message.includes("Unknown value 'Buidl'"))).toBe(true);
    });
  });

  describe('hide directive', () => {
    it('parses hide with single tag-value pair', () => {
      const input = `initiative-status
hide phase Phase3

API | done`;
      const result = parseInitiativeStatus(input);
      expect(result.initialHiddenTagValues.has('phase')).toBe(true);
      expect(result.initialHiddenTagValues.get('phase')!.has('phase3')).toBe(true);
    });

    it('parses hide with multiple comma-separated pairs', () => {
      const input = `initiative-status
hide phase Phase3, team Frontend

API | done`;
      const result = parseInitiativeStatus(input);
      expect(result.initialHiddenTagValues.get('phase')!.has('phase3')).toBe(true);
      expect(result.initialHiddenTagValues.get('team')!.has('frontend')).toBe(true);
    });

    it('ignores malformed hide entries (single word — no tag-value pair)', () => {
      const input = `initiative-status
hide nocolon

API | done`;
      const result = parseInitiativeStatus(input);
      // 'nocolon' is a single word — not a valid tag-value pair
      expect(result.initialHiddenTagValues.size).toBe(0);
    });
  });
});

// ============================================================
// Task 3.4 — Status rework (doing, blocked, aliases)
// ============================================================

describe('status rework — new statuses and aliases', () => {
  it('Auth Service | doing → status is "doing"', () => {
    const result = parseInitiativeStatus('Auth Service | doing');
    expect(result.nodes[0].status).toBe('doing');
    expect(result.diagnostics).toEqual([]);
  });

  it('Auth Service | wip → status is "doing" (alias)', () => {
    const result = parseInitiativeStatus('Auth Service | wip');
    expect(result.nodes[0].status).toBe('doing');
    expect(result.diagnostics).toEqual([]);
  });

  it('Auth Service | blocked → status is "blocked"', () => {
    const result = parseInitiativeStatus('Auth Service | blocked');
    expect(result.nodes[0].status).toBe('blocked');
    expect(result.diagnostics).toEqual([]);
  });

  it('Auth Service | paused → status is "blocked" (alias)', () => {
    const result = parseInitiativeStatus('Auth Service | paused');
    expect(result.nodes[0].status).toBe('blocked');
    expect(result.diagnostics).toEqual([]);
  });

  it('Auth Service | waiting → status is "blocked" (alias)', () => {
    const result = parseInitiativeStatus('Auth Service | waiting');
    expect(result.nodes[0].status).toBe('blocked');
    expect(result.diagnostics).toEqual([]);
  });

  it('Auth Service | status: blocked → status is "blocked" (explicit form)', () => {
    const result = parseInitiativeStatus('Auth Service | status: blocked');
    expect(result.nodes[0].status).toBe('blocked');
    expect(result.diagnostics).toEqual([]);
  });

  it('explicit status: doing form', () => {
    const result = parseInitiativeStatus('Auth Service | status: doing');
    expect(result.nodes[0].status).toBe('doing');
    expect(result.diagnostics).toEqual([]);
  });

  it('explicit status: wip resolves alias', () => {
    const result = parseInitiativeStatus('Auth Service | status: wip');
    expect(result.nodes[0].status).toBe('doing');
    expect(result.diagnostics).toEqual([]);
  });

  it('aliases are case-insensitive', () => {
    const result = parseInitiativeStatus('A | WIP\nB | Paused\nC | WAITING');
    expect(result.nodes.map((n) => n.status)).toEqual(['doing', 'blocked', 'blocked']);
    expect(result.diagnostics).toEqual([]);
  });

  it('all canonical statuses including new ones', () => {
    const input = 'A | done\nB | doing\nC | blocked\nD | todo\nE | na';
    const result = parseInitiativeStatus(input);
    expect(result.nodes.map((n) => n.status)).toEqual(['done', 'doing', 'blocked', 'todo', 'na']);
    expect(result.diagnostics).toEqual([]);
  });
});

// ============================================================
// Task 3.5b — Group metadata cascading
// ============================================================

describe('group metadata cascading', () => {
  it('child inherits group metadata', () => {
    const input = `initiative-status
tag Phase p
  Build(yellow)
  Deploy(green)

[Identity] | p: Build
  Auth Service | done`;
    const result = parseInitiativeStatus(input);
    expect(result.nodes[0].label).toBe('Auth Service');
    expect(result.nodes[0].metadata.phase).toBe('Build');
  });

  it('child overrides group metadata on conflict', () => {
    const input = `initiative-status
tag Phase p
  Build(yellow)
  Deploy(green)

[Identity] | p: Build
  Auth Service | done, p: Deploy`;
    const result = parseInitiativeStatus(input);
    expect(result.nodes[0].label).toBe('Auth Service');
    expect(result.nodes[0].metadata.phase).toBe('Deploy');
  });

  it('group metadata stored on ISGroup', () => {
    const input = `[Identity] | p: Build
  Auth Service | done`;
    const result = parseInitiativeStatus(input);
    expect(result.groups[0].metadata).toEqual({ p: 'Build' });
  });

  it('group without metadata has undefined metadata field', () => {
    const input = `[Identity]
  Auth Service | done`;
    const result = parseInitiativeStatus(input);
    expect(result.groups[0].metadata).toBeUndefined();
  });

  it('multiple metadata keys cascade', () => {
    const input = `initiative-status
tag Phase p
  Build(yellow)
tag Team t
  Backend(cyan)

[Core] | p: Build, t: Backend
  API | done
  DB | done, t: Frontend`;
    const result = parseInitiativeStatus(input);
    // API inherits both
    const api = result.nodes.find((n) => n.label === 'API')!;
    expect(api.metadata.phase).toBe('Build');
    expect(api.metadata.team).toBe('Backend');
    // DB inherits phase but overrides team
    const db = result.nodes.find((n) => n.label === 'DB')!;
    expect(db.metadata.phase).toBe('Build');
    expect(db.metadata.team).toBe('Frontend');
  });
});
