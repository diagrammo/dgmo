import { describe, it, expect } from 'vitest';
import { parseFlowchart, looksLikeFlowchart } from '../src/graph/flowchart-parser';

describe('parseFlowchart', () => {
  // === AC 11: Metadata ===
  describe('metadata', () => {
    it('parses flowchart first line', () => {
      const result = parseFlowchart('flowchart\n(Start) -> (End)');
      expect(result.type).toBe('flowchart');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('parses title from first line', () => {
      const result = parseFlowchart('flowchart My Flow\n(Start) -> (End)');
      expect(result.title).toBe('My Flow');
    });

    it('parses direction TB', () => {
      const result = parseFlowchart('flowchart\ndirection TB\n(Start) -> (End)');
      expect(result.direction).toBe('TB');
    });

    it('parses direction LR', () => {
      const result = parseFlowchart('flowchart\ndirection LR\n(Start) -> (End)');
      expect(result.direction).toBe('LR');
    });

    it('defaults to TB when no direction specified', () => {
      const result = parseFlowchart('(Start) -> (End)');
      expect(result.direction).toBe('TB');
    });

    it('accepts orientation as alias for direction', () => {
      const result = parseFlowchart('flowchart\norientation horizontal\n(Start) -> (End)');
      expect(result.direction).toBe('LR');
    });

    it('normalizes direction horizontal to LR', () => {
      const result = parseFlowchart('flowchart\ndirection horizontal\n(Start) -> (End)');
      expect(result.direction).toBe('LR');
    });

    it('normalizes orientation vertical to TB', () => {
      const result = parseFlowchart('flowchart\norientation vertical\n(Start) -> (End)');
      expect(result.direction).toBe('TB');
    });
  });

  // === AC 12: Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseFlowchart('// this is a comment\n(Start) -> (End)');
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(2);
    });
  });

  // === AC 1: Shape types ===
  describe('shapes', () => {
    it('parses terminal shape (Start)', () => {
      const result = parseFlowchart('(Start)');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].shape).toBe('terminal');
      expect(result.nodes[0].label).toBe('Start');
    });

    it('parses process shape [Do Thing]', () => {
      const result = parseFlowchart('[Do Thing]');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].shape).toBe('process');
      expect(result.nodes[0].label).toBe('Do Thing');
    });

    it('parses decision shape <Valid?>', () => {
      const result = parseFlowchart('<Valid?>');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].shape).toBe('decision');
      expect(result.nodes[0].label).toBe('Valid?');
    });

    it('parses I/O shape /Read Input/', () => {
      const result = parseFlowchart('/Read Input/');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].shape).toBe('io');
      expect(result.nodes[0].label).toBe('Read Input');
    });

    it('parses subroutine shape [[Validate]]', () => {
      const result = parseFlowchart('[[Validate]]');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].shape).toBe('subroutine');
      expect(result.nodes[0].label).toBe('Validate');
    });

    it('parses document shape [Report~]', () => {
      const result = parseFlowchart('[Report~]');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].shape).toBe('document');
      expect(result.nodes[0].label).toBe('Report');
    });
  });

  // === AC 5: Inline chains ===
  describe('inline chains', () => {
    it('parses (Start) -> [Step 1] -> [Step 2] -> (End)', () => {
      const result = parseFlowchart('(Start) -> [Step 1] -> [Step 2] -> (End)');
      expect(result.nodes).toHaveLength(4);
      expect(result.edges).toHaveLength(3);
      expect(result.edges[0].source).toBe(result.nodes[0].id);
      expect(result.edges[0].target).toBe(result.nodes[1].id);
      expect(result.edges[2].target).toBe(result.nodes[3].id);
    });
  });

  // === AC 2: Edge variants ===
  describe('edges', () => {
    it('parses unlabeled edge ->', () => {
      const result = parseFlowchart('[A] -> [B]');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBeUndefined();
      expect(result.edges[0].color).toBeUndefined();
    });

    it('parses labeled edge -yes->', () => {
      const result = parseFlowchart('[A] -yes-> [B]');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('yes');
    });

    it('parses colored edge -(blue)->', () => {
      const result = parseFlowchart('[A] -(blue)-> [B]');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].color).toBeDefined();
      expect(result.edges[0].label).toBeUndefined();
    });

    it('parses labeled+colored edge -yes(red)->', () => {
      const result = parseFlowchart('[A] -yes(red)-> [B]');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('yes');
      expect(result.edges[0].color).toBeDefined();
    });
  });

  // === Arrow color inference ===
  describe('arrow color inference', () => {
    it('-yes-> infers green', () => {
      const result = parseFlowchart('[A] -yes-> [B]');
      expect(result.edges[0].color).toBe('green');
    });

    it('-no-> infers red', () => {
      const result = parseFlowchart('[A] -no-> [B]');
      expect(result.edges[0].color).toBe('red');
    });

    it('-maybe-> infers orange', () => {
      const result = parseFlowchart('[A] -maybe-> [B]');
      expect(result.edges[0].color).toBe('orange');
    });

    it('-YES-> infers green (case-insensitive)', () => {
      const result = parseFlowchart('[A] -YES-> [B]');
      expect(result.edges[0].color).toBe('green');
    });

    it('-yesterday-> does NOT infer color (not exact match)', () => {
      const result = parseFlowchart('[A] -yesterday-> [B]');
      expect(result.edges[0].color).toBeUndefined();
    });

    it('-no(blue)-> uses explicit blue, not inferred red', () => {
      const result = parseFlowchart('[A] -no(blue)-> [B]');
      expect(result.edges[0].color).toBeDefined();
      expect(result.edges[0].color).not.toBe('red');
    });

    it('-success-> infers green', () => {
      const result = parseFlowchart('[A] -success-> [B]');
      expect(result.edges[0].color).toBe('green');
    });

    it('-error-> infers red', () => {
      const result = parseFlowchart('[A] -error-> [B]');
      expect(result.edges[0].color).toBe('red');
    });
  });

  // === AC 3: Indented branching ===
  describe('indented branching', () => {
    it('branches under decision associate correctly', () => {
      const input = '<Check?>\n  -yes-> [A]\n  -no-> [B]';
      const result = parseFlowchart(input);
      expect(result.error).toBeNull();

      const decision = result.nodes.find((n) => n.shape === 'decision')!;
      expect(decision).toBeDefined();

      const edgesFromDecision = result.edges.filter((e) => e.source === decision.id);
      expect(edgesFromDecision).toHaveLength(2);
      expect(edgesFromDecision.map((e) => e.label).sort()).toEqual(['no', 'yes']);
    });
  });

  // === AC 4: Nested decisions ===
  describe('nested decisions', () => {
    it('multi-level indent parses correctly', () => {
      const input = [
        '<Auth?>',
        '  -yes-> <Admin?>',
        '    -yes-> [Dashboard]',
        '    -no-> [Profile]',
        '  -no-> [Login]',
      ].join('\n');
      const result = parseFlowchart(input);
      expect(result.error).toBeNull();

      expect(result.nodes).toHaveLength(5); // Auth?, Admin?, Dashboard, Profile, Login
      expect(result.edges).toHaveLength(4); // Auth->Admin, Admin->Dashboard, Admin->Profile, Auth->Login
    });
  });

  // === AC 6: One-per-line chains ===
  describe('one-per-line chains', () => {
    it('indented -> [B] continues from previous node', () => {
      const input = '(Start)\n  -> [Step]\n  -> (End)';
      const result = parseFlowchart(input);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
    });
  });

  // === AC 7: Convergence ===
  describe('convergence', () => {
    it('same [Merge] referenced twice produces single node', () => {
      const input = [
        '<Check?>',
        '  -yes-> [Path A] -> [Merge]',
        '  -no-> [Path B] -> [Merge]',
      ].join('\n');
      const result = parseFlowchart(input);
      expect(result.error).toBeNull();

      const mergeNodes = result.nodes.filter((n) => n.label === 'Merge');
      expect(mergeNodes).toHaveLength(1);

      const edgesToMerge = result.edges.filter((e) => e.target === mergeNodes[0].id);
      expect(edgesToMerge).toHaveLength(2);
    });
  });

  // === AC 8: Back-edges (loops) ===
  describe('back-edges', () => {
    it('referencing earlier node creates loop edge', () => {
      const input = '(Start) -> /Get Input/ -> <Valid?>\n  -yes-> [Process] -> (End)\n  -no-> /Get Input/';
      const result = parseFlowchart(input);
      expect(result.error).toBeNull();

      const inputNodes = result.nodes.filter((n) => n.label === 'Get Input');
      expect(inputNodes).toHaveLength(1); // convergence: single node

      const backEdges = result.edges.filter((e) => e.target === inputNodes[0].id);
      expect(backEdges.length).toBeGreaterThanOrEqual(2); // from Start and from the -no-> branch
    });
  });

  // === AC 9: Groups ===
  describe('groups', () => {
    it('## emits an error diagnostic', () => {
      const input = '## API(blue)\n  [Auth] -> [Route]';
      const result = parseFlowchart(input);
      expect(result.groups).toBeUndefined();
      const groupError = result.diagnostics.find((d) => d.message.includes('Use `#` for groups'));
      expect(groupError).toBeDefined();
      expect(groupError!.severity).toBe('error');
    });

    it('# GroupName creates a group with indented members', () => {
      const input = '# API\n  [Auth] -> [Route]';
      const result = parseFlowchart(input);
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].label).toBe('API');
      expect(result.groups![0].nodeIds).toContain(result.nodes[0].id);
      expect(result.groups![0].nodeIds).toContain(result.nodes[1].id);
    });

    it('# GroupName(color) creates a group with color', () => {
      const input = '# API(blue)\n  [Auth] -> [Route]';
      const result = parseFlowchart(input);
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].label).toBe('API');
      expect(result.groups![0].color).toBeDefined();
    });

    it('outdent closes the group', () => {
      const input = '# API\n  [Auth] -> [Route]\n[Outside]';
      const result = parseFlowchart(input);
      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].nodeIds).not.toContain(result.nodes.find(n => n.label === 'Outside')!.id);
    });
  });

  // === AC 10: Node colors ===
  describe('node colors', () => {
    it('parses inline color [Process(blue)]', () => {
      const result = parseFlowchart('[Process(blue)]');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('Process');
      expect(result.nodes[0].color).toBeDefined();
    });

    it('parses inline color on decision <Check?(red)>', () => {
      const result = parseFlowchart('<Check?(red)>');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('Check?');
      expect(result.nodes[0].color).toBeDefined();
    });

    it('parses inline color on document [Report(teal)~]', () => {
      const result = parseFlowchart('[Report(teal)~]');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('Report');
      expect(result.nodes[0].color).toBeDefined();
    });

    it('parses inline color on terminal (Start(green))', () => {
      const result = parseFlowchart('(Start(green)) -> (End(red))');
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].label).toBe('Start');
      expect(result.nodes[0].color).toBeDefined();
      expect(result.nodes[1].label).toBe('End');
      expect(result.nodes[1].color).toBeDefined();
    });
  });

  // === AC 13: Line numbers ===
  describe('line numbers', () => {
    it('tracks line numbers on nodes and edges', () => {
      const input = 'flowchart Test\n\n[A] -> [B]';
      const result = parseFlowchart(input);
      // Line 3 has [A] -> [B]
      expect(result.nodes[0].lineNumber).toBe(3);
      expect(result.nodes[1].lineNumber).toBe(3);
      expect(result.edges[0].lineNumber).toBe(3);
    });
  });

  // === AC 14: Error handling ===
  describe('errors', () => {
    it('error on empty content (no nodes)', () => {
      const result = parseFlowchart('flowchart\n');
      expect(result.error).toBeDefined();
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toMatch(/No nodes found/);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(0);
    });

    it('error on only comments and whitespace', () => {
      const result = parseFlowchart('// just a comment\n\n');
      expect(result.error).toBeDefined();
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(0);
    });
  });

  // === Comprehensive example from epic ===
  describe('comprehensive example', () => {
    it('parses the CI/CD pipeline example', () => {
      const input = [
        'flowchart CI/CD Pipeline',
        'direction LR',
        '',
        '(Push to Repo) -> [[Run Linter]] -> <Lint Pass?>',
        '  -yes-> [[Run Tests]]',
        '  -no-> [Lint Report~] -> /Notify Dev/ -> (Fix & Retry)',
        '',
        '[[Run Tests]] -> <Tests Pass?>',
        '  -yes-> [Build Artifact]',
        '  -no-> [Test Report~] -> /Notify Dev/ -> (Fix & Retry)',
        '',
        '[Build Artifact] -> <Environment?>',
        '  -staging-> [[Deploy to Staging]]',
        '  -production-> [[Deploy to Prod]]',
      ].join('\n');

      const result = parseFlowchart(input);
      expect(result.error).toBeNull();
      expect(result.title).toBe('CI/CD Pipeline');
      expect(result.direction).toBe('LR');
      expect(result.groups).toBeUndefined();
      expect(result.nodes.length).toBeGreaterThanOrEqual(10);
      expect(result.edges.length).toBeGreaterThanOrEqual(8);
    });
  });
});

describe('looksLikeFlowchart', () => {
  it('detects flowchart with shape delimiters + arrows', () => {
    expect(looksLikeFlowchart('[A] -> [B]')).toBe(true);
    expect(looksLikeFlowchart('(Start) -> [Process]')).toBe(true);
    expect(looksLikeFlowchart('<Check?>\n  -yes-> [A]')).toBe(true);
  });

  it('rejects plain text', () => {
    expect(looksLikeFlowchart('hello world')).toBe(false);
  });

  it('rejects sequence diagram syntax', () => {
    // Sequence uses "Alice -> Bob: message" — no shape delimiters around names
    expect(looksLikeFlowchart('Alice -> Bob: hello')).toBe(false);
  });
});
