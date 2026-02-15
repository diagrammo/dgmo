import { describe, it, expect } from 'vitest';
import {
  parseSequenceDgmo,
  buildRenderSequence,
  computeActivations,
  type SequenceBlock,
} from '../src/index';

describe('parseReturnLabel — shorthand ` : ` syntax', () => {
  it('basic shorthand splits on " : "', () => {
    const result = parseSequenceDgmo('A -> B: hello : world');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].label).toBe('hello');
    expect(result.messages[0].returnLabel).toBe('world');
  });

  it('multi-word labels', () => {
    const result = parseSequenceDgmo(
      'Captain -> Quartermaster: Battle stations! : Aye aye'
    );
    expect(result.messages[0].label).toBe('Battle stations!');
    expect(result.messages[0].returnLabel).toBe('Aye aye');
  });

  it('multiple separators — splits on last " : "', () => {
    const result = parseSequenceDgmo('A -> B: a : b : c');
    expect(result.messages[0].label).toBe('a : b');
    expect(result.messages[0].returnLabel).toBe('c');
  });

  it('async ~> skips parseReturnLabel — no shorthand', () => {
    const result = parseSequenceDgmo('A ~> B: x : y');
    expect(result.messages[0].label).toBe('x : y');
    expect(result.messages[0].returnLabel).toBeUndefined();
  });

  it('async prefix is rejected with helpful error', () => {
    const result = parseSequenceDgmo('async A -> B: x : y');
    expect(result.error).toMatch(/Use ~> for async messages/);
    expect(result.messages).toHaveLength(0);
  });

  it('<- syntax takes priority over shorthand', () => {
    const result = parseSequenceDgmo('A -> B: L <- R');
    expect(result.messages[0].label).toBe('L');
    expect(result.messages[0].returnLabel).toBe('R');
  });

  it('UML syntax takes priority over shorthand', () => {
    const result = parseSequenceDgmo('A -> B: fn(): T');
    expect(result.messages[0].label).toBe('fn()');
    expect(result.messages[0].returnLabel).toBe('T');
  });

  it('URL with :// is not split', () => {
    const result = parseSequenceDgmo('A -> B: http://example.com');
    expect(result.messages[0].label).toBe('http://example.com');
    expect(result.messages[0].returnLabel).toBeUndefined();
  });

  it('colon without spaces splits (space-insensitive)', () => {
    const result = parseSequenceDgmo('A -> B: req:resp');
    expect(result.messages[0].label).toBe('req');
    expect(result.messages[0].returnLabel).toBe('resp');
  });

  it('self-call with shorthand', () => {
    const result = parseSequenceDgmo('A -> A: think : done');
    expect(result.messages[0].label).toBe('think');
    expect(result.messages[0].returnLabel).toBe('done');
  });

  it('inside a block', () => {
    const result = parseSequenceDgmo('if cond\n  A -> B: x : y');
    expect(result.messages[0].label).toBe('x');
    expect(result.messages[0].returnLabel).toBe('y');
  });

  it('~> async syntax continues to work', () => {
    const result = parseSequenceDgmo('A ~> B: fire and forget');
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].async).toBe(true);
    expect(result.messages[0].label).toBe('fire and forget');
  });

  it('render integration — produces call, labeled return, and activation', () => {
    const parsed = parseSequenceDgmo('A -> B: request : response');
    const steps = buildRenderSequence(parsed.messages);
    const activations = computeActivations(steps);

    // Should have call + return steps
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      type: 'call',
      from: 'A',
      to: 'B',
      label: 'request',
    });
    expect(steps[1]).toMatchObject({
      type: 'return',
      from: 'B',
      to: 'A',
      label: 'response',
    });

    // Should have activation bar on B
    expect(activations).toHaveLength(1);
    expect(activations[0].participantId).toBe('B');
  });
});

describe('Story 47.1 — syntax cleanup', () => {
  describe('async keyword prefix removed', () => {
    it('rejects "async A -> B: msg" with error pointing to ~>', () => {
      const result = parseSequenceDgmo('A -> B: setup\nasync B -> C: fire');
      expect(result.error).toMatch(/Line 2.*Use ~> for async messages/);
    });

    it('async prefix is case-insensitive', () => {
      const result = parseSequenceDgmo('ASYNC A -> B: msg');
      expect(result.error).toMatch(/Use ~> for async messages/);
    });

    it('~> async arrow still works', () => {
      const result = parseSequenceDgmo('A ~> B: fire');
      expect(result.error).toBeNull();
      expect(result.messages[0].async).toBe(true);
    });
  });

  describe('parallel blocks reject else', () => {
    it('rejects else inside parallel block', () => {
      const result = parseSequenceDgmo(
        'parallel Tasks\n  A -> B: task1\nelse\n  A -> C: task2'
      );
      expect(result.error).toMatch(
        /Line 3.*parallel blocks don't support else/
      );
    });

    it('else inside if block still works', () => {
      const result = parseSequenceDgmo(
        'if condition\n  A -> B: yes\nelse\n  A -> C: no'
      );
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('# comment syntax removed', () => {
    it('rejects # as comment', () => {
      const result = parseSequenceDgmo('A -> B: msg\n# this is a comment');
      expect(result.error).toMatch(
        /Line 2.*Use \/\/ for comments.*# is reserved/
      );
    });

    it('// comments still work', () => {
      const result = parseSequenceDgmo('// this is a comment\nA -> B: msg');
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
    });

    it('## group headings still work', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API\n  DB\nAPI -> DB: query'
      );
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Backend');
    });
  });

  describe('hex colors rejected', () => {
    it('rejects hex color in group heading', () => {
      const result = parseSequenceDgmo(
        '## Backend(#ff6b6b)\n  API\nAPI -> DB: query'
      );
      expect(result.error).toMatch(/Line 1.*Use a named color instead of hex/);
    });

    it('rejects hex color in section divider', () => {
      const result = parseSequenceDgmo(
        'A -> B: msg\n== Phase 2(#abc123) =='
      );
      expect(result.error).toMatch(/Line 2.*Use a named color instead of hex/);
    });

    it('named colors in groups still work', () => {
      const result = parseSequenceDgmo(
        '## Backend(blue)\n  API\nAPI -> DB: query'
      );
      expect(result.error).toBeNull();
      expect(result.groups[0].color).toBe('blue');
    });

    it('named colors in sections still work', () => {
      const result = parseSequenceDgmo('A -> B: msg\n== Phase 2(teal) ==');
      expect(result.error).toBeNull();
      expect(result.sections[0].color).toBe('teal');
    });
  });
});

describe('Story 47.2 — parser tolerance', () => {
  describe('space-insensitive colon return splitting', () => {
    it('splits on colon without spaces', () => {
      const result = parseSequenceDgmo('A -> B: request:response');
      expect(result.messages[0].label).toBe('request');
      expect(result.messages[0].returnLabel).toBe('response');
    });

    it('splits on colon with spaces (unchanged)', () => {
      const result = parseSequenceDgmo('A -> B: request : response');
      expect(result.messages[0].label).toBe('request');
      expect(result.messages[0].returnLabel).toBe('response');
    });

    it('splits on last colon for multiple colons', () => {
      const result = parseSequenceDgmo('A -> B: a:b:c');
      expect(result.messages[0].label).toBe('a:b');
      expect(result.messages[0].returnLabel).toBe('c');
    });

    it('does not split URL scheme (://)', () => {
      const result = parseSequenceDgmo('A -> B: http://example.com');
      expect(result.messages[0].label).toBe('http://example.com');
      expect(result.messages[0].returnLabel).toBeUndefined();
    });

    it('UML method():type takes priority over generic colon split', () => {
      const result = parseSequenceDgmo('A -> B: getUser(id):UserObj');
      expect(result.messages[0].label).toBe('getUser(id)');
      expect(result.messages[0].returnLabel).toBe('UserObj');
    });

    it('<- takes priority over colon split', () => {
      const result = parseSequenceDgmo('A -> B: POST /orders <- 201');
      expect(result.messages[0].label).toBe('POST /orders');
      expect(result.messages[0].returnLabel).toBe('201');
    });
  });

  describe('whitespace tolerance on arrows', () => {
    it('A->B:msg (no spaces)', () => {
      const result = parseSequenceDgmo('A->B:msg');
      expect(result.messages[0]).toMatchObject({
        from: 'A',
        to: 'B',
        label: 'msg',
      });
    });

    it('A ->B: msg (space before arrow only)', () => {
      const result = parseSequenceDgmo('A ->B: msg');
      expect(result.messages[0]).toMatchObject({
        from: 'A',
        to: 'B',
        label: 'msg',
      });
    });

    it('A-> B: msg (space after arrow only)', () => {
      const result = parseSequenceDgmo('A-> B: msg');
      expect(result.messages[0]).toMatchObject({
        from: 'A',
        to: 'B',
        label: 'msg',
      });
    });

    it('A  ->  B  :  msg (multiple spaces)', () => {
      const result = parseSequenceDgmo('A  ->  B  :  msg');
      expect(result.messages[0]).toMatchObject({
        from: 'A',
        to: 'B',
        label: 'msg',
      });
    });

    it('same tolerance for ~> async arrows', () => {
      const result = parseSequenceDgmo('A~>B:fire');
      expect(result.messages[0]).toMatchObject({
        from: 'A',
        to: 'B',
        label: 'fire',
        async: true,
      });
    });
  });

  describe('multi-word group names', () => {
    it('parses multi-word group name with color', () => {
      const result = parseSequenceDgmo(
        '## API Services(blue)\n  API\nAPI -> DB: query'
      );
      expect(result.groups[0].name).toBe('API Services');
      expect(result.groups[0].color).toBe('blue');
    });

    it('parses multi-word group name without color', () => {
      const result = parseSequenceDgmo(
        '## My Group\n  API\nAPI -> DB: query'
      );
      expect(result.groups[0].name).toBe('My Group');
      expect(result.groups[0].color).toBeUndefined();
    });

    it('single-word group still works', () => {
      const result = parseSequenceDgmo(
        '## Backend(red)\n  API\nAPI -> DB: query'
      );
      expect(result.groups[0].name).toBe('Backend');
      expect(result.groups[0].color).toBe('red');
    });

    it('trims trailing whitespace from group name', () => {
      const result = parseSequenceDgmo(
        '## API Services  (blue)\n  API\nAPI -> DB: query'
      );
      expect(result.groups[0].name).toBe('API Services');
    });
  });

  describe('optional trailing == on sections', () => {
    it('parses section without trailing ==', () => {
      const result = parseSequenceDgmo('A -> B: msg\n== Authentication');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].label).toBe('Authentication');
    });

    it('parses section with trailing == (unchanged)', () => {
      const result = parseSequenceDgmo('A -> B: msg\n== Authentication ==');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].label).toBe('Authentication');
    });

    it('parses section with color and no trailing ==', () => {
      const result = parseSequenceDgmo('A -> B: msg\n== Phase 2(red)');
      expect(result.sections[0].label).toBe('Phase 2');
      expect(result.sections[0].color).toBe('red');
    });

    it('parses section with color and trailing ==', () => {
      const result = parseSequenceDgmo('A -> B: msg\n== Phase 2(red) ==');
      expect(result.sections[0].label).toBe('Phase 2');
      expect(result.sections[0].color).toBe('red');
    });

    it('trailing whitespace is ignored', () => {
      const result = parseSequenceDgmo('A -> B: msg\n== Auth   ');
      expect(result.sections[0].label).toBe('Auth');
    });
  });
});

describe('Story 47.3 — parser validation', () => {
  describe('headers-before-content', () => {
    it('title before first message parses normally', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\ntitle: Auth Flow\nA -> B: login'
      );
      expect(result.error).toBeNull();
      expect(result.title).toBe('Auth Flow');
    });

    it('options before first message parse normally', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\nactivations: off\nA -> B: login'
      );
      expect(result.error).toBeNull();
      expect(result.options.activations).toBe('off');
    });

    it('title after a message produces error', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\nA -> B: login\ntitle: Too Late'
      );
      expect(result.error).toMatch(
        /Line 3.*Options like 'title: Too Late' must appear before/
      );
    });

    it('option after a section produces error', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\n== Auth\nactivations: off\nA -> B: login'
      );
      expect(result.error).toMatch(
        /Line 3.*Options like 'activations: off' must appear before/
      );
    });

    it('option after a participant declaration produces error', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\nAPI is a service\nactivations: off\nAPI -> DB: query'
      );
      expect(result.error).toMatch(/Line 3.*must appear before/);
    });

    it('option after a group produces error', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\n## Backend\n  API\nactivations: off\nAPI -> DB: query'
      );
      expect(result.error).toMatch(/Line 4.*must appear before/);
    });

    it('chart: sequence is always allowed', () => {
      const result = parseSequenceDgmo(
        'title: Flow\nchart: sequence\nA -> B: msg'
      );
      expect(result.error).toBeNull();
    });
  });

  describe('duplicate participant group membership', () => {
    it('participant in two groups produces error', () => {
      const result = parseSequenceDgmo(
        '## Backend(blue)\n  API\n\n## Frontend(red)\n  API\nAPI -> DB: query'
      );
      expect(result.error).toMatch(
        /Line 5.*Participant 'API' is already in group 'Backend'/
      );
    });

    it('participant in two groups via "is a" syntax produces error', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API is a service\n\n## Frontend\n  API is a gateway\nAPI -> DB: query'
      );
      expect(result.error).toMatch(
        /Line 5.*Participant 'API' is already in group 'Backend'/
      );
    });

    it('different participants in different groups is fine', () => {
      const result = parseSequenceDgmo(
        '## Backend(blue)\n  API\n  DB\n\n## Frontend(red)\n  App\nAPI -> DB: query\nApp -> API: request'
      );
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(2);
    });

    it('same participant listed twice in same group is fine', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API\n  API\nAPI -> DB: query'
      );
      expect(result.error).toBeNull();
    });
  });

  describe('lone # line errors (from 47.1)', () => {
    it('# produces error with correct line number', () => {
      const result = parseSequenceDgmo('A -> B: msg\n#\nB -> C: next');
      expect(result.error).toMatch(/Line 2.*Use \/\/ for comments/);
    });

    it('# with text produces error', () => {
      const result = parseSequenceDgmo('# my comment\nA -> B: msg');
      expect(result.error).toMatch(/Line 1.*Use \/\/ for comments/);
    });

    it('## group heading does not error', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API\nAPI -> DB: query'
      );
      expect(result.error).toBeNull();
    });
  });
});

describe('Story 47.4 — else if support', () => {
  describe('single else if branch', () => {
    it('parses if / else if / else with correct children', () => {
      const content = [
        'if authenticated',
        '  A -> B: proceed',
        'else if guest',
        '  A -> C: redirect',
        'else',
        '  A -> D: deny',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.elements).toHaveLength(1);
      const block = result.elements[0] as SequenceBlock;
      expect(block.type).toBe('if');
      expect(block.label).toBe('authenticated');
      expect(block.children).toHaveLength(1);
      expect(block.elseIfBranches).toHaveLength(1);
      expect(block.elseIfBranches![0].label).toBe('guest');
      expect(block.elseIfBranches![0].children).toHaveLength(1);
      expect(block.elseChildren).toHaveLength(1);
    });

    it('parses if / else if without final else', () => {
      const content = [
        'if status 200',
        '  A -> B: ok',
        'else if status 404',
        '  A -> C: not found',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const block = result.elements[0] as SequenceBlock;
      expect(block.children).toHaveLength(1);
      expect(block.elseIfBranches).toHaveLength(1);
      expect(block.elseIfBranches![0].label).toBe('status 404');
      expect(block.elseChildren).toHaveLength(0);
    });
  });

  describe('multiple else if branches', () => {
    it('parses if / else if / else if / else', () => {
      const content = [
        'if premium',
        '  A -> B: full access',
        'else if trial',
        '  A -> C: limited access',
        'else if expired',
        '  A -> D: renew prompt',
        'else',
        '  A -> E: register',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const block = result.elements[0] as SequenceBlock;
      expect(block.children).toHaveLength(1);
      expect(block.elseIfBranches).toHaveLength(2);
      expect(block.elseIfBranches![0].label).toBe('trial');
      expect(block.elseIfBranches![0].children).toHaveLength(1);
      expect(block.elseIfBranches![1].label).toBe('expired');
      expect(block.elseIfBranches![1].children).toHaveLength(1);
      expect(block.elseChildren).toHaveLength(1);
    });
  });

  describe('else if with multiple messages per branch', () => {
    it('each branch collects its own messages', () => {
      const content = [
        'if admin',
        '  A -> B: check perms',
        '  B -> C: audit log',
        'else if user',
        '  A -> D: basic check',
        '  D -> C: log',
        'else',
        '  A -> E: block',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const block = result.elements[0] as SequenceBlock;
      expect(block.children).toHaveLength(2);
      expect(block.elseIfBranches![0].children).toHaveLength(2);
      expect(block.elseChildren).toHaveLength(1);
      expect(result.messages).toHaveLength(5);
    });
  });

  describe('else if is case-insensitive', () => {
    it('Else If works', () => {
      const content = [
        'if cond1',
        '  A -> B: yes',
        'Else If cond2',
        '  A -> C: maybe',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const block = result.elements[0] as SequenceBlock;
      expect(block.elseIfBranches).toHaveLength(1);
      expect(block.elseIfBranches![0].label).toBe('cond2');
    });
  });

  describe('nested blocks inside else if', () => {
    it('nested loop inside else if branch', () => {
      const content = [
        'if ready',
        '  A -> B: go',
        'else if retry',
        '  loop 3 times',
        '    A -> B: attempt',
        'else',
        '  A -> C: fail',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const block = result.elements[0] as SequenceBlock;
      expect(block.elseIfBranches).toHaveLength(1);
      // The else-if branch contains a loop block
      const branchChildren = block.elseIfBranches![0].children;
      expect(branchChildren).toHaveLength(1);
      const nestedLoop = branchChildren[0] as SequenceBlock;
      expect(nestedLoop.type).toBe('loop');
      expect(nestedLoop.children).toHaveLength(1);
    });
  });

  describe('else if rejected in parallel blocks', () => {
    it('rejects else if inside parallel block', () => {
      const content = [
        'parallel Tasks',
        '  A -> B: task1',
        'else if fallback',
        '  A -> C: task2',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toMatch(
        /Line 3.*parallel blocks don't support else if/
      );
    });
  });

  describe('else if without parent block', () => {
    it('else if at top level is ignored (no crash)', () => {
      const content = ['A -> B: msg', 'else if stray'].join('\n');
      const result = parseSequenceDgmo(content);
      // No error — orphan else if is silently ignored like orphan else
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('render integration with else if', () => {
    it('produces correct render steps for all branches', () => {
      const content = [
        'if cond1',
        '  A -> B: branch1',
        'else if cond2',
        '  A -> C: branch2',
        'else',
        '  A -> D: branch3',
      ].join('\n');
      const parsed = parseSequenceDgmo(content);
      expect(parsed.error).toBeNull();
      const steps = buildRenderSequence(parsed.messages);
      // 3 calls + 3 returns
      expect(steps).toHaveLength(6);
      expect(steps.filter((s) => s.type === 'call')).toHaveLength(3);
    });
  });
});
