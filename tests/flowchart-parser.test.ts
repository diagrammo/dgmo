import { describe, it, expect } from 'vitest';
import {
  parseFlowchart,
  looksLikeFlowchart,
} from '../src/graph/flowchart-parser';

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

    it('parses direction-lr', () => {
      const result = parseFlowchart(
        'flowchart\ndirection-lr\n(Start) -> (End)'
      );
      expect(result.direction).toBe('LR');
    });

    it('defaults to TB when no direction specified', () => {
      const result = parseFlowchart('(Start) -> (End)');
      expect(result.direction).toBe('TB');
    });
  });

  describe('solid-fill option', () => {
    it('parses bare solid-fill keyword as on', () => {
      const result = parseFlowchart('flowchart\nsolid-fill\n(Start) -> (End)');
      expect(result.options['solid-fill']).toBe('on');
    });

    it('parses solid-fill case-insensitively', () => {
      expect(
        parseFlowchart('flowchart\nSolid-Fill\n(Start) -> (End)').options[
          'solid-fill'
        ]
      ).toBe('on');
      expect(
        parseFlowchart('flowchart\nSOLID-FILL\n(Start) -> (End)').options[
          'solid-fill'
        ]
      ).toBe('on');
    });

    it('defaults to undefined when keyword absent', () => {
      const result = parseFlowchart('flowchart\n(Start) -> (End)');
      expect(result.options['solid-fill']).toBeUndefined();
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

    it('-(blue)-> parses as literal label "(blue)" (spec §1.7: no edge color)', () => {
      const result = parseFlowchart('[A] -(blue)-> [B]');
      expect(result.edges).toHaveLength(1);
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
      expect(result.edges[0].label).toBe('(blue)');
    });

    it('-yes red-> parses with whole-token label "yes red" (no color)', () => {
      const result = parseFlowchart('[A] -yes red-> [B]');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('yes red');
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
    });

    // === AC-1 (TD-9): arrow-shape longest match ===
    describe('TD-9 longest-match arrow tokenization', () => {
      it('AC-1: [A] --foo---> [B] → label foo, no diagnostics', () => {
        const result = parseFlowchart('[A] --foo---> [B]');
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].label).toBe('foo');
        expect((result.edges[0] as { color?: string }).color).toBeUndefined();
        expect(
          result.diagnostics.filter((d) => d.severity === 'error')
        ).toHaveLength(0);
      });
      it('[A] -foo--> [B] → label foo', () => {
        const result = parseFlowchart('[A] -foo--> [B]');
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].label).toBe('foo');
      });
      it('[A] --> [B] → bare arrow, no label', () => {
        const result = parseFlowchart('[A] --> [B]');
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].label).toBeUndefined();
      });
    });

    // === Spec §1.7: edge color is not a feature. Parens are literal. ===
    describe('edge color removal (spec §1.7)', () => {
      it('-(red)-> parses as literal label "(red)", no color', () => {
        const result = parseFlowchart('[A] -(red)-> [B]');
        expect((result.edges[0] as { color?: string }).color).toBeUndefined();
        expect(result.edges[0].label).toBe('(red)');
      });
      it('-(notacolor)-> parses as literal label "(notacolor)"', () => {
        const result = parseFlowchart('[A] -(notacolor)-> [B]');
        expect((result.edges[0] as { color?: string }).color).toBeUndefined();
        expect(result.edges[0].label).toBe('(notacolor)');
      });
      it('-(red) uses-> parses as label "(red) uses"', () => {
        const result = parseFlowchart('[A] -(red) uses-> [B]');
        expect((result.edges[0] as { color?: string }).color).toBeUndefined();
        expect(result.edges[0].label).toBe('(red) uses');
      });
      it('-red-> parses as label "red", no color', () => {
        const result = parseFlowchart('[A] -red-> [B]');
        expect(result.edges[0].label).toBe('red');
        expect((result.edges[0] as { color?: string }).color).toBeUndefined();
      });
    });
  });

  // === Label-inferred edge color (yes→green, no→red, maybe→orange) ===
  // was removed by spec §1.7 alongside the broader edge-color deletion.
  describe('label-inferred edge color is removed (spec §1.7)', () => {
    it('-yes-> has no color', () => {
      const result = parseFlowchart('[A] -yes-> [B]');
      expect(result.edges[0].label).toBe('yes');
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
    });
    it('-no-> has no color', () => {
      const result = parseFlowchart('[A] -no-> [B]');
      expect(result.edges[0].label).toBe('no');
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
    });
    it('-maybe-> has no color', () => {
      const result = parseFlowchart('[A] -maybe-> [B]');
      expect(result.edges[0].label).toBe('maybe');
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
    });
    it('-success-> / -error-> / -fail-> have no color', () => {
      for (const word of ['success', 'error', 'fail']) {
        const result = parseFlowchart(`[A] -${word}-> [B]`);
        expect(result.edges[0].label).toBe(word);
        expect((result.edges[0] as { color?: string }).color).toBeUndefined();
      }
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

      const edgesFromDecision = result.edges.filter(
        (e) => e.source === decision.id
      );
      expect(edgesFromDecision).toHaveLength(2);
      expect(edgesFromDecision.map((e) => e.label).sort()).toEqual([
        'no',
        'yes',
      ]);
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

      const edgesToMerge = result.edges.filter(
        (e) => e.target === mergeNodes[0].id
      );
      expect(edgesToMerge).toHaveLength(2);
    });
  });

  // === AC 8: Back-edges (loops) ===
  describe('back-edges', () => {
    it('referencing earlier node creates loop edge', () => {
      const input =
        '(Start) -> /Get Input/ -> <Valid?>\n  -yes-> [Process] -> (End)\n  -no-> /Get Input/';
      const result = parseFlowchart(input);
      expect(result.error).toBeNull();

      const inputNodes = result.nodes.filter((n) => n.label === 'Get Input');
      expect(inputNodes).toHaveLength(1); // convergence: single node

      const backEdges = result.edges.filter(
        (e) => e.target === inputNodes[0].id
      );
      expect(backEdges.length).toBeGreaterThanOrEqual(2); // from Start and from the -no-> branch
    });
  });

  // === Color suffix in label (no extractColor on nodes) ===
  describe('color suffix in label', () => {
    it('(color) suffix is literal label text [Process blue]', () => {
      const result = parseFlowchart('[Process blue]');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('Process blue');
      expect(result.nodes[0].color).toBeUndefined();
    });

    it('(color) suffix is literal on decision <Check?(red)>', () => {
      const result = parseFlowchart('<Check?(red)>');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('Check?(red)');
      expect(result.nodes[0].color).toBeUndefined();
    });

    it('(color) suffix is literal on document [Report teal~]', () => {
      const result = parseFlowchart('[Report teal~]');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('Report teal');
      expect(result.nodes[0].color).toBeUndefined();
    });

    it('(color) suffix is literal on terminal (Start green)', () => {
      const result = parseFlowchart('(Start green) -> (End red)');
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].label).toBe('Start green');
      expect(result.nodes[0].color).toBeUndefined();
      expect(result.nodes[1].label).toBe('End red');
      expect(result.nodes[1].color).toBeUndefined();
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
        '',
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
      expect(result.direction).toBe('TB');
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

describe('flowchart parser — universal alias syntax (TD-18)', () => {
  it('extracts alias from `[Label] as <alias>` declaration', () => {
    const result = parseFlowchart(`flowchart
[Order Service] as os
[Payment Service] as ps
os -> ps`);
    expect(
      result.diagnostics.filter((d) => d.severity === 'error')
    ).toHaveLength(0);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes.map((n) => n.label)).toEqual([
      'Order Service',
      'Payment Service',
    ]);
    // node ids are `<shape>:<normalizedLabel>` — both alias-references
    // resolve to the same canonical ids the bracketed declarations made.
    expect(result.edges[0].source).toBe(result.nodes[0].id);
    expect(result.edges[0].target).toBe(result.nodes[1].id);
  });

  it('resolves alias inside a chained-arrow line', () => {
    const result = parseFlowchart(`flowchart
[Process Order] as po
[Ship] as sh
po -> sh -> [Deliver]`);
    expect(result.edges).toHaveLength(2);
    const ids = result.nodes.reduce<Record<string, string>>((acc, n) => {
      acc[n.label] = n.id;
      return acc;
    }, {});
    expect(result.edges[0].source).toBe(ids['Process Order']);
    expect(result.edges[0].target).toBe(ids['Ship']);
    expect(result.edges[1].source).toBe(ids['Ship']);
    expect(result.edges[1].target).toBe(ids['Deliver']);
  });

  it('aliases do not leak across separate parse calls', () => {
    const a = parseFlowchart(`flowchart
[Order] as o
o -> [Ship]`);
    expect(a.edges).toHaveLength(1);
    expect(a.nodes.find((n) => n.label === 'Order')).toBeDefined();

    const b = parseFlowchart(`flowchart
o -> [Ship]`);
    // `o` was never declared — falls through to a literal node ref
    // which fails parseNodeRef, so no edge created.
    expect(b.edges).toHaveLength(0);
  });

  describe('leading-arrow continuation', () => {
    it('attaches a bare-arrow line to the previous line’s node', () => {
      const result = parseFlowchart(`flowchart
(Start)
-> /Collect info/
-> <Ready?>`);
      // Start -> Collect, Collect -> Ready: nothing orphaned.
      expect(result.edges).toHaveLength(2);
      const labels = result.nodes.map((n) => n.label).sort();
      expect(labels).toEqual(['Collect info', 'Ready?', 'Start']);
      // No "not connected" warning for Start.
      expect(
        result.diagnostics.some((d) => /not connected/.test(d.message))
      ).toBe(false);
    });
  });

  describe('unsupported node suffix salvage (no tag groups)', () => {
    it('keeps a node + edge when the target carries a tag-style suffix', () => {
      const result = parseFlowchart(`flowchart
(Start) -> <Ok?>
<Ok?> -yes-> (Approved) s: Eligible
<Ok?> -no-> (Denied) s: Denied`);
      // Both terminals + their edges survive instead of being dropped.
      expect(result.edges).toHaveLength(3);
      expect(result.nodes.find((n) => n.label === 'Approved')).toBeDefined();
      expect(result.nodes.find((n) => n.label === 'Denied')).toBeDefined();
    });

    it('warns once per line about the ignored suffix', () => {
      const result = parseFlowchart(`flowchart
(Start) -> (Denied) s: Denied`);
      const warns = result.diagnostics.filter(
        (d) => d.code === 'W_FLOWCHART_NODE_SUFFIX'
      );
      expect(warns).toHaveLength(1);
      expect(warns[0].message).toMatch(/automatically by shape/);
    });
  });
});
