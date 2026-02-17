import { describe, it, expect } from 'vitest';
import { parseFlowchart, looksLikeFlowchart } from '../src/graph/flowchart-parser';

describe('parseFlowchart', () => {
  // === AC 11: Metadata ===
  describe('metadata', () => {
    it('parses chart: flowchart', () => {
      const result = parseFlowchart('chart: flowchart\n(Start) -> (End)');
      expect(result.type).toBe('flowchart');
      expect(result.error).toBeUndefined();
    });

    it('parses title', () => {
      const result = parseFlowchart('chart: flowchart\ntitle: My Flow\n(Start) -> (End)');
      expect(result.title).toBe('My Flow');
    });

    it('parses direction: TB', () => {
      const result = parseFlowchart('chart: flowchart\ndirection: TB\n(Start) -> (End)');
      expect(result.direction).toBe('TB');
    });

    it('parses direction: LR', () => {
      const result = parseFlowchart('chart: flowchart\ndirection: LR\n(Start) -> (End)');
      expect(result.direction).toBe('LR');
    });

    it('defaults to TB when no direction specified', () => {
      const result = parseFlowchart('(Start) -> (End)');
      expect(result.direction).toBe('TB');
    });
  });

  // === AC 12: Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseFlowchart('// this is a comment\n(Start) -> (End)');
      expect(result.error).toBeUndefined();
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

  // === AC 3: Indented branching ===
  describe('indented branching', () => {
    it('branches under decision associate correctly', () => {
      const input = '<Check?>\n  -yes-> [A]\n  -no-> [B]';
      const result = parseFlowchart(input);
      expect(result.error).toBeUndefined();

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
      expect(result.error).toBeUndefined();

      expect(result.nodes).toHaveLength(5); // Auth?, Admin?, Dashboard, Profile, Login
      expect(result.edges).toHaveLength(4); // Auth->Admin, Admin->Dashboard, Admin->Profile, Auth->Login
    });
  });

  // === AC 6: One-per-line chains ===
  describe('one-per-line chains', () => {
    it('indented -> [B] continues from previous node', () => {
      const input = '(Start)\n  -> [Step]\n  -> (End)';
      const result = parseFlowchart(input);
      expect(result.error).toBeUndefined();
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
      expect(result.error).toBeUndefined();

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
      expect(result.error).toBeUndefined();

      const inputNodes = result.nodes.filter((n) => n.label === 'Get Input');
      expect(inputNodes).toHaveLength(1); // convergence: single node

      const backEdges = result.edges.filter((e) => e.target === inputNodes[0].id);
      expect(backEdges.length).toBeGreaterThanOrEqual(2); // from Start and from the -no-> branch
    });
  });

  // === AC 9: Groups ===
  describe('groups', () => {
    it('parses ## Group(color) with member nodes', () => {
      const input = '## API(blue)\n  [Auth] -> [Route]';
      const result = parseFlowchart(input);
      expect(result.error).toBeUndefined();
      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].label).toBe('API');
      expect(result.groups![0].color).toBeDefined();
      expect(result.groups![0].nodeIds).toContain(result.nodes[0].id);
      expect(result.groups![0].nodeIds).toContain(result.nodes[1].id);
    });

    it('group without color works', () => {
      const input = '## Backend\n  [Service]';
      const result = parseFlowchart(input);
      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].label).toBe('Backend');
      expect(result.groups![0].color).toBeUndefined();
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
      const input = 'chart: flowchart\ntitle: Test\n\n[A] -> [B]';
      const result = parseFlowchart(input);
      // Line 4 has [A] -> [B]
      expect(result.nodes[0].lineNumber).toBe(4);
      expect(result.nodes[1].lineNumber).toBe(4);
      expect(result.edges[0].lineNumber).toBe(4);
    });
  });

  // === AC 14: Error handling ===
  describe('errors', () => {
    it('error on empty content (no nodes)', () => {
      const result = parseFlowchart('chart: flowchart\n');
      expect(result.error).toBeDefined();
    });

    it('error on only comments and whitespace', () => {
      const result = parseFlowchart('// just a comment\n\n');
      expect(result.error).toBeDefined();
    });
  });

  // === Comprehensive example from epic ===
  describe('comprehensive example', () => {
    it('parses the CI/CD pipeline example', () => {
      const input = [
        'chart: flowchart',
        'title: CI/CD Pipeline',
        'direction: LR',
        '',
        '## Source(blue)',
        '  (Push to Repo) -> [[Run Linter]] -> <Lint Pass?>',
        '    -yes-> [[Run Tests]]',
        '    -no-> [Lint Report~] -> /Notify Dev/ -> (Fix & Retry)',
        '',
        '## Test(green)',
        '  [[Run Tests]] -> <Tests Pass?>',
        '    -yes-> [Build Artifact]',
        '    -no-> [Test Report~] -> /Notify Dev/ -> (Fix & Retry)',
        '',
        '## Deploy(purple)',
        '  [Build Artifact] -> <Environment?>',
        '    -staging-> [[Deploy to Staging]]',
        '    -production-> [[Deploy to Prod]]',
      ].join('\n');

      const result = parseFlowchart(input);
      expect(result.error).toBeUndefined();
      expect(result.title).toBe('CI/CD Pipeline');
      expect(result.direction).toBe('LR');
      expect(result.groups).toHaveLength(3);
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
