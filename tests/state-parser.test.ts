import { describe, it, expect } from 'vitest';
import { parseState, looksLikeState } from '../src/graph/state-parser';

describe('parseState', () => {
  // === Metadata ===
  describe('metadata', () => {
    it('parses state first line', () => {
      const result = parseState('state\n[*] -> Idle');
      expect(result.type).toBe('state');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('rejects wrong chart type', () => {
      const result = parseState('flowchart\n[*] -> Idle');
      expect(result.error).toBeDefined();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain(
        'Expected chart type "state"'
      );
    });

    it('suggests correct type on typo', () => {
      const result = parseState('sttae\n[*] -> Idle');
      expect(result.error).toBeDefined();
      expect(result.diagnostics[0].message).toMatch(/state/);
    });

    it('parses title from first line', () => {
      const result = parseState('state My States\n[*] -> Idle');
      expect(result.title).toBe('My States');
    });

    it('parses direction-tb', () => {
      const result = parseState('direction-tb\n[*] -> Idle');
      expect(result.direction).toBe('TB');
    });

    it('defaults to LR when no direction specified', () => {
      const result = parseState('[*] -> Idle');
      expect(result.direction).toBe('LR');
    });
  });

  describe('solid-fill option', () => {
    it('parses bare solid-fill keyword as on', () => {
      const result = parseState('solid-fill\n[*] -> Idle');
      expect(result.options['solid-fill']).toBe('on');
    });

    it('parses solid-fill case-insensitively', () => {
      expect(parseState('Solid-Fill\n[*] -> Idle').options['solid-fill']).toBe(
        'on'
      );
      expect(parseState('SOLID-FILL\n[*] -> Idle').options['solid-fill']).toBe(
        'on'
      );
    });

    it('defaults to undefined when keyword absent', () => {
      const result = parseState('[*] -> Idle');
      expect(result.options['solid-fill']).toBeUndefined();
    });
  });

  // === States ===
  describe('states', () => {
    it('parses bare state name', () => {
      const result = parseState('Idle -> Active');
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].label).toBe('Idle');
      expect(result.nodes[0].shape).toBe('state');
    });

    it('(color) suffix is literal label text', () => {
      const result = parseState('Active(green) -> Done');
      expect(result.nodes[0].label).toBe('Active(green)');
      expect(result.nodes[0].color).toBeUndefined();
    });

    it('deduplicates states referenced multiple times', () => {
      const result = parseState('A -> B\nB -> C');
      const bNodes = result.nodes.filter((n) => n.label === 'B');
      expect(bNodes).toHaveLength(1);
    });

    it('uses case-insensitive IDs', () => {
      const result = parseState('Idle -> Active\nidle -> Done');
      const idleNodes = result.nodes.filter((n) => n.id === 'state:idle');
      expect(idleNodes).toHaveLength(1);
    });
  });

  // === Pseudostates ===
  describe('pseudostates', () => {
    it('parses [*] as source', () => {
      const result = parseState('[*] -> Idle');
      expect(result.error).toBeNull();
      const pseudo = result.nodes.find((n) => n.shape === 'pseudostate');
      expect(pseudo).toBeDefined();
      expect(pseudo!.label).toBe('[*]');
    });

    it('parses [*] as target', () => {
      const result = parseState('Done -> [*]');
      expect(result.error).toBeNull();
      const pseudo = result.nodes.find((n) => n.shape === 'pseudostate');
      expect(pseudo).toBeDefined();
      expect(result.edges[0].target).toBe(pseudo!.id);
    });

    it('shares single node identity for multiple [*] references', () => {
      const result = parseState('[*] -> Idle\nDone -> [*]');
      const pseudos = result.nodes.filter((n) => n.shape === 'pseudostate');
      expect(pseudos).toHaveLength(1);
    });
  });

  // === Transitions ===
  describe('transitions', () => {
    it('parses unlabeled transition', () => {
      const result = parseState('A -> B');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBeUndefined();
      expect(result.edges[0].color).toBeUndefined();
    });

    it('parses labeled transition', () => {
      const result = parseState('Idle -start-> Running');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('start');
    });

    it('parses colored transition', () => {
      const result = parseState('A -(red)-> B');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].color).toBeDefined();
      expect(result.edges[0].label).toBeUndefined();
    });

    it('parses labeled+colored transition', () => {
      const result = parseState('A -fail(red)-> B');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('fail');
      expect(result.edges[0].color).toBeDefined();
    });

    it('tracks source and target IDs correctly', () => {
      const result = parseState('Idle -> Active');
      expect(result.edges[0].source).toBe('state:idle');
      expect(result.edges[0].target).toBe('state:active');
    });
  });

  // === Chains ===
  describe('chains', () => {
    it('parses inline chain A -> B -> C', () => {
      const result = parseState('A -> B -> C');
      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].source).toBe('state:a');
      expect(result.edges[0].target).toBe('state:b');
      expect(result.edges[1].source).toBe('state:b');
      expect(result.edges[1].target).toBe('state:c');
    });

    it('parses chain with labels', () => {
      const result = parseState('[*] -init-> Idle -go-> Active -> [*]');
      expect(result.edges).toHaveLength(3);
      expect(result.edges[0].label).toBe('init');
      expect(result.edges[1].label).toBe('go');
      expect(result.edges[2].label).toBeUndefined();
    });
  });

  // === Indentation ===
  describe('indentation', () => {
    it('uses parent as implicit source', () => {
      const input = 'Idle\n  -start-> Running\n  -configure-> Configuring';
      const result = parseState(input);
      expect(result.error).toBeNull();
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].source).toBe('state:idle');
      expect(result.edges[0].target).toBe('state:running');
      expect(result.edges[1].source).toBe('state:idle');
      expect(result.edges[1].target).toBe('state:configuring');
    });

    it('outdent resets implicit source', () => {
      const input = 'A\n  -> B\nC\n  -> D';
      const result = parseState(input);
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].source).toBe('state:a');
      expect(result.edges[0].target).toBe('state:b');
      expect(result.edges[1].source).toBe('state:c');
      expect(result.edges[1].target).toBe('state:d');
    });
  });

  // === Groups ===
  describe('groups', () => {
    it('parses [Group](color) with indented member states', () => {
      const input = '[Processing](blue)\n  Validating -> Approved';
      const result = parseState(input);
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].label).toBe('Processing');
      expect(result.groups![0].color).toBeDefined();
      expect(result.groups![0].nodeIds).toContain('state:validating');
      expect(result.groups![0].nodeIds).toContain('state:approved');
    });

    it('group without color works', () => {
      const input = '[Backend]\n  ServiceA -> ServiceB';
      const result = parseState(input);
      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].label).toBe('Backend');
      expect(result.groups![0].color).toBeUndefined();
    });

    it('indentation closes group — state at same indent as bracket is not in group', () => {
      const input = '[MyGroup]\n  Inside -> Also Inside\nOutside -> Elsewhere';
      const result = parseState(input);
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].nodeIds).toContain('state:inside');
      expect(result.groups![0].nodeIds).toContain('state:also inside');
      expect(result.groups![0].nodeIds).not.toContain('state:outside');
      expect(result.groups![0].nodeIds).not.toContain('state:elsewhere');
    });

    it('[*] is NOT treated as a group', () => {
      const input = '[*] -> Idle -> Active -> [*]';
      const result = parseState(input);
      expect(result.error).toBeNull();
      expect(result.groups).toBeUndefined();
    });
  });

  // === Self-loops ===
  describe('self-loops', () => {
    it('parses state transitioning to itself', () => {
      const result = parseState('Running -retry-> Running');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe(result.edges[0].target);
      expect(result.edges[0].label).toBe('retry');
    });
  });

  // === Options ===
  describe('options', () => {
    it('parses color off', () => {
      const result = parseState('color off\n[*] -> Idle');
      expect(result.options.color).toBe('off');
    });

    it('parses custom options', () => {
      const result = parseState('foo bar\n[*] -> Idle');
      expect(result.options.foo).toBe('bar');
    });
  });

  // === Line numbers ===
  describe('line numbers', () => {
    it('tracks line numbers on nodes', () => {
      const input = 'state Test\n\nIdle -> Active';
      const result = parseState(input);
      expect(result.nodes[0].lineNumber).toBe(3);
      expect(result.nodes[1].lineNumber).toBe(3);
    });

    it('tracks line numbers on edges', () => {
      const input = 'state\n\nA -> B';
      const result = parseState(input);
      expect(result.edges[0].lineNumber).toBe(3);
    });

    it('tracks title line number', () => {
      const result = parseState('state My Diagram\n[*] -> Idle');
      expect(result.titleLineNumber).toBe(1);
    });
  });

  // === Errors ===
  describe('errors', () => {
    it('error on empty content', () => {
      const result = parseState('state\n');
      expect(result.error).toBeDefined();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('warns about orphaned states', () => {
      const result = parseState('A -> B\nOrphan');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('warning');
      expect(result.diagnostics[0].message).toContain('Orphan');
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseState('// a comment\n[*] -> Idle');
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(2);
    });
  });

  // === Comprehensive example ===
  describe('comprehensive example', () => {
    it('parses a full state diagram', () => {
      const input = [
        'state Order Lifecycle',
        '',
        '',
        '[Processing](blue)',
        '  Validating -valid-> Approved',
        '  Validating -invalid-> Rejected',
        '',
        '[*] -> Pending -submit-> Validating',
        'Approved -ship-> Shipped -> [*]',
        'Rejected -> [*]',
        'Shipped -return-> Pending',
      ].join('\n');

      const result = parseState(input);
      expect(result.error).toBeNull();
      expect(result.title).toBe('Order Lifecycle');
      expect(result.direction).toBe('LR');
      expect(result.groups).toHaveLength(1);
      expect(result.nodes.length).toBeGreaterThanOrEqual(6);
      expect(result.edges.length).toBeGreaterThanOrEqual(7);
    });
  });
});

describe('looksLikeState', () => {
  it('detects state diagram with [*] and ->', () => {
    expect(looksLikeState('[*] -> Idle -> Active -> [*]')).toBe(true);
  });

  it('rejects content without [*]', () => {
    expect(looksLikeState('Idle -> Active')).toBe(false);
  });

  it('rejects content without ->', () => {
    expect(looksLikeState('[*] Idle Active')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(looksLikeState('hello world')).toBe(false);
  });
});
