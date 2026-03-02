import { describe, it, expect } from 'vitest';
import {
  parseSequenceDgmo,
  buildRenderSequence,
  computeActivations,
  isSequenceNote,
  type SequenceBlock,
  type SequenceNote,
} from '../src/index';

// ============================================================
// Old syntax produces errors
// ============================================================
describe('old syntax produces errors', () => {
  it('A -> B: msg gives migration hint', () => {
    const result = parseSequenceDgmo('A -setup-> B\nC -> D: msg');
    expect(result.error).toMatch(/Colon syntax is no longer supported/);
    expect(result.error).toMatch(/C -msg-> D/);
  });

  it('A ~> B: msg gives migration hint', () => {
    const result = parseSequenceDgmo('A -setup-> B\nC ~> D: fire');
    expect(result.error).toMatch(/Colon syntax is no longer supported/);
    expect(result.error).toMatch(/C ~fire~> D/);
  });

  it('<-> gives error', () => {
    const result = parseSequenceDgmo('A -setup-> B\nA <-> B');
    expect(result.error).toMatch(/Bidirectional arrows are no longer supported/);
  });

  it('<~> gives error', () => {
    const result = parseSequenceDgmo('A -setup-> B\nA <~> B');
    expect(result.error).toMatch(/Bidirectional arrows are no longer supported/);
  });

  it('<-label-> gives error', () => {
    const result = parseSequenceDgmo('A <-data sync-> B');
    expect(result.error).toMatch(/no longer supported/);
  });

  it('<~label~> gives error', () => {
    const result = parseSequenceDgmo('A <~heartbeat~> B');
    expect(result.error).toMatch(/no longer supported/);
  });

  it('async prefix is rejected with helpful error', () => {
    const result = parseSequenceDgmo('async A -msg-> B');
    expect(result.error).toMatch(/Use ~> for async messages/);
    expect(result.messages).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toMatch(/Use ~> for async messages/);
    expect(result.diagnostics[0].severity).toBe('error');
  });
});

// ============================================================
// New arrow syntax — labeled calls
// ============================================================
describe('labeled call arrows', () => {
  it('-label-> produces correct SequenceMessage', () => {
    const result = parseSequenceDgmo('User -login-> API');
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      from: 'User',
      to: 'API',
      label: 'login',
    });
    expect(result.messages[0].async).toBeFalsy();
    expect(result.messages[0].standaloneReturn).toBeFalsy();
  });

  it('~label~> produces async message', () => {
    const result = parseSequenceDgmo('API ~event~> Queue');
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      from: 'API',
      to: 'Queue',
      label: 'event',
      async: true,
    });
  });

  it('multi-word label in -label->', () => {
    const result = parseSequenceDgmo('User -send request-> API');
    expect(result.messages[0].label).toBe('send request');
  });

  it('error on arrow chars inside label', () => {
    const result = parseSequenceDgmo('A -bad->val-> B');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain('not allowed');
  });

  it('self-call with labeled arrow', () => {
    const result = parseSequenceDgmo('API -validate-> API');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].from).toBe('API');
    expect(result.messages[0].to).toBe('API');
  });

  it('auto-registers participants', () => {
    const result = parseSequenceDgmo('Frontend -fetch-> Backend');
    expect(result.participants.map((p) => p.id)).toEqual(['Frontend', 'Backend']);
  });
});

// ============================================================
// New arrow syntax — return arrows
// ============================================================
describe('return arrows', () => {
  it('labeled return <-msg- parses correctly', () => {
    const result = parseSequenceDgmo('Client -login-> Server\nClient <-token- Server');
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      from: 'Server',
      to: 'Client',
      label: 'token',
      standaloneReturn: true,
    });
  });

  it('bare return <- parses correctly', () => {
    const result = parseSequenceDgmo('A -msg-> B\nA <- B');
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      from: 'B',
      to: 'A',
      label: '',
      standaloneReturn: true,
    });
  });

  it('async labeled return <~msg~ parses correctly', () => {
    const result = parseSequenceDgmo('A ~fire~> B\nA <~result~ B');
    expect(result.error).toBeNull();
    expect(result.messages[1]).toMatchObject({
      from: 'B',
      to: 'A',
      label: 'result',
      async: true,
      standaloneReturn: true,
    });
  });

  it('bare async return <~ parses correctly', () => {
    const result = parseSequenceDgmo('A ~fire~> B\nA <~ B');
    expect(result.error).toBeNull();
    expect(result.messages[1]).toMatchObject({
      from: 'B',
      to: 'A',
      label: '',
      async: true,
      standaloneReturn: true,
    });
  });

  it('return auto-registers participants', () => {
    const result = parseSequenceDgmo('A <-data- B');
    expect(result.participants.map((p) => p.id)).toEqual(['B', 'A']);
  });

  it('multi-word return label', () => {
    const result = parseSequenceDgmo('Client <-200 OK + JWT- Server');
    expect(result.messages[0].label).toBe('200 OK + JWT');
    expect(result.messages[0].from).toBe('Server');
    expect(result.messages[0].to).toBe('Client');
  });
});

// ============================================================
// Bare (unlabeled) arrows
// ============================================================
describe('bare arrows', () => {
  it('A -> B parses as unlabeled call', () => {
    const result = parseSequenceDgmo('A -> B');
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      from: 'A',
      to: 'B',
      label: '',
    });
    expect(result.messages[0].standaloneReturn).toBeFalsy();
  });

  it('A ~> B parses as unlabeled async call', () => {
    const result = parseSequenceDgmo('A ~> B');
    expect(result.error).toBeNull();
    expect(result.messages[0]).toMatchObject({
      from: 'A',
      to: 'B',
      label: '',
      async: true,
    });
  });

  it('A -> B with no spaces', () => {
    const result = parseSequenceDgmo('A->B');
    expect(result.messages[0]).toMatchObject({ from: 'A', to: 'B', label: '' });
  });
});

// ============================================================
// Render integration — calls and returns
// ============================================================
describe('render integration', () => {
  it('call + explicit return produces correct steps', () => {
    const parsed = parseSequenceDgmo('A -request-> B\nA <-response- B');
    const steps = buildRenderSequence(parsed.messages);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: 'call', from: 'A', to: 'B', label: 'request' });
    expect(steps[1]).toMatchObject({ type: 'return', from: 'B', to: 'A', label: 'response' });
  });

  it('call without explicit return produces auto-return', () => {
    const parsed = parseSequenceDgmo('A -request-> B');
    const steps = buildRenderSequence(parsed.messages);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: 'call', from: 'A', to: 'B' });
    expect(steps[1]).toMatchObject({ type: 'return', from: 'B', to: 'A', label: '' });
  });

  it('explicit return suppresses auto-return', () => {
    const parsed = parseSequenceDgmo([
      'Client -login-> Server',
      '  Server -query-> DB',
      '  Server <-rows- DB',
      'Client <-token- Server',
    ].join('\n'));
    const steps = buildRenderSequence(parsed.messages);
    // 2 calls + 2 explicit returns = 4 steps
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({ type: 'call', from: 'Client', to: 'Server' });
    expect(steps[1]).toMatchObject({ type: 'call', from: 'Server', to: 'DB' });
    expect(steps[2]).toMatchObject({ type: 'return', from: 'DB', to: 'Server', label: 'rows' });
    expect(steps[3]).toMatchObject({ type: 'return', from: 'Server', to: 'Client', label: 'token' });
  });

  it('activations from explicit returns', () => {
    const parsed = parseSequenceDgmo([
      'A -call-> B',
      'A <-result- B',
    ].join('\n'));
    const steps = buildRenderSequence(parsed.messages);
    const activations = computeActivations(steps);
    expect(activations).toHaveLength(1);
    expect(activations[0].participantId).toBe('B');
  });

  it('async messages produce no activations', () => {
    const parsed = parseSequenceDgmo('A ~fire~> B');
    const steps = buildRenderSequence(parsed.messages);
    const activations = computeActivations(steps);
    expect(activations).toHaveLength(0);
  });

  it('self-call produces immediate return', () => {
    const parsed = parseSequenceDgmo('A -validate-> A');
    const steps = buildRenderSequence(parsed.messages);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: 'call', from: 'A', to: 'A' });
    expect(steps[1]).toMatchObject({ type: 'return', from: 'A', to: 'A' });
  });
});

// ============================================================
// Story 47.1 — syntax cleanup (updated for v2)
// ============================================================
describe('Story 47.1 — syntax cleanup', () => {
  describe('async keyword prefix removed', () => {
    it('rejects "async A -msg-> B" with error pointing to ~>', () => {
      const result = parseSequenceDgmo('A -setup-> B\nasync B -fire-> C');
      expect(result.error).toMatch(/Line 2.*Use ~> for async messages/);
    });

    it('async prefix is case-insensitive', () => {
      const result = parseSequenceDgmo('ASYNC A -msg-> B');
      expect(result.error).toMatch(/Use ~> for async messages/);
    });

    it('~> async arrow still works', () => {
      const result = parseSequenceDgmo('A ~fire~> B');
      expect(result.error).toBeNull();
      expect(result.messages[0].async).toBe(true);
    });
  });

  describe('parallel blocks reject else', () => {
    it('rejects else inside parallel block', () => {
      const result = parseSequenceDgmo(
        'parallel Tasks\n  A -task1-> B\nelse\n  A -task2-> C'
      );
      expect(result.error).toMatch(
        /Line 3.*parallel blocks don't support else/
      );
    });

    it('else inside if block still works', () => {
      const result = parseSequenceDgmo(
        'if condition\n  A -yes-> B\nelse\n  A -no-> C'
      );
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('# comment syntax removed', () => {
    it('rejects # as comment', () => {
      const result = parseSequenceDgmo('A -msg-> B\n# this is a comment');
      expect(result.error).toMatch(
        /Line 2.*Use \/\/ for comments.*# is reserved/
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toMatch(/Use \/\/ for comments/);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBe(2);
    });

    it('// comments still work', () => {
      const result = parseSequenceDgmo('// this is a comment\nA -msg-> B');
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
    });

    it('## group headings still work', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API\n  DB\nAPI -query-> DB'
      );
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Backend');
    });
  });

  describe('hex colors rejected', () => {
    it('rejects hex color in group heading', () => {
      const result = parseSequenceDgmo(
        '## Backend(#ff6b6b)\n  API\nAPI -query-> DB'
      );
      expect(result.error).toMatch(/Line 1.*Use a named color instead of hex/);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toMatch(/Use a named color instead of hex/);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBe(1);
    });

    it('rejects hex color in section divider', () => {
      const result = parseSequenceDgmo(
        'A -msg-> B\n== Phase 2(#abc123) =='
      );
      expect(result.error).toMatch(/Line 2.*Use a named color instead of hex/);
    });

    it('named colors in groups still work', () => {
      const result = parseSequenceDgmo(
        '## Backend(blue)\n  API\nAPI -query-> DB'
      );
      expect(result.error).toBeNull();
      expect(result.groups[0].color).toBe('blue');
    });

    it('named colors in sections still work', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Phase 2(teal) ==');
      expect(result.error).toBeNull();
      expect(result.sections[0].color).toBe('teal');
    });
  });
});

// ============================================================
// Story 47.2 — parser tolerance
// ============================================================
describe('Story 47.2 — Parser tolerance', () => {
  describe('multi-word group names', () => {
    it('two-word group name', () => {
      const result = parseSequenceDgmo(
        '## Order Service\n  API\n\nA -msg-> B'
      );
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Order Service');
    });

    it('multi-word group with color', () => {
      const result = parseSequenceDgmo(
        '## Payment Gateway(blue)\n  API\n\nA -msg-> B'
      );
      expect(result.error).toBeNull();
      expect(result.groups[0].name).toBe('Payment Gateway');
      expect(result.groups[0].color).toBe('blue');
    });

    it('single-word group still works', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API\n\nA -msg-> B'
      );
      expect(result.error).toBeNull();
      expect(result.groups[0].name).toBe('Backend');
    });

    it('trailing spaces in group name are trimmed', () => {
      const result = parseSequenceDgmo(
        '## Backend   \n  API\n\nA -msg-> B'
      );
      expect(result.error).toBeNull();
      expect(result.groups[0].name).toBe('Backend');
    });
  });

  describe('optional trailing == on sections', () => {
    it('section without trailing ==', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Phase One');
      expect(result.error).toBeNull();
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].label).toBe('Phase One');
    });

    it('section with trailing == still works', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Phase One ==');
      expect(result.error).toBeNull();
      expect(result.sections[0].label).toBe('Phase One');
    });

    it('section without trailing == and with color', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Critical(red)');
      expect(result.error).toBeNull();
      expect(result.sections[0].label).toBe('Critical');
      expect(result.sections[0].color).toBe('red');
    });

    it('section with trailing == and color', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Critical(red) ==');
      expect(result.error).toBeNull();
      expect(result.sections[0].label).toBe('Critical');
      expect(result.sections[0].color).toBe('red');
    });
  });

  describe('labeled arrow whitespace tolerance', () => {
    it('extra spaces around -label->', () => {
      const result = parseSequenceDgmo('A  -msg->  B');
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].from).toBe('A');
      expect(result.messages[0].to).toBe('B');
    });

    it('extra spaces around ~label~>', () => {
      const result = parseSequenceDgmo('A  ~fire~>  B');
      expect(result.error).toBeNull();
      expect(result.messages[0].async).toBe(true);
    });
  });
});

// ============================================================
// Story 47.3 — parser validation
// ============================================================
describe('Story 47.3 — parser validation', () => {
  describe('headers-before-content', () => {
    it('title before first message parses normally', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\ntitle: Auth Flow\nA -login-> B'
      );
      expect(result.error).toBeNull();
      expect(result.title).toBe('Auth Flow');
    });

    it('options before first message parse normally', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\nactivations: off\nA -login-> B'
      );
      expect(result.error).toBeNull();
      expect(result.options.activations).toBe('off');
    });

    it('title after a message produces error', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\nA -login-> B\ntitle: Too Late'
      );
      expect(result.error).toMatch(
        /Line 3.*Options like 'title: Too Late' must appear before/
      );
    });

    it('option after a section produces error', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\n== Auth\nactivations: off\nA -login-> B'
      );
      expect(result.error).toMatch(
        /Line 3.*Options like 'activations: off' must appear before/
      );
    });

    it('option after a participant declaration produces error', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\nAPI is a service\nactivations: off\nAPI -query-> DB'
      );
      expect(result.error).toMatch(/Line 3.*must appear before/);
    });

    it('option after a group produces error', () => {
      const result = parseSequenceDgmo(
        'chart: sequence\n## Backend\n  API\nactivations: off\nAPI -query-> DB'
      );
      expect(result.error).toMatch(/Line 4.*must appear before/);
    });

    it('chart: sequence is always allowed', () => {
      const result = parseSequenceDgmo(
        'title: Flow\nchart: sequence\nA -msg-> B'
      );
      expect(result.error).toBeNull();
    });
  });

  describe('duplicate participant group membership', () => {
    it('participant in two groups produces error', () => {
      const result = parseSequenceDgmo(
        '## Backend(blue)\n  API\n\n## Frontend(red)\n  API\nAPI -query-> DB'
      );
      expect(result.error).toMatch(
        /Line 5.*Participant 'API' is already in group 'Backend'/
      );
    });

    it('participant in two groups via "is a" syntax produces error', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API is a service\n\n## Frontend\n  API is a gateway\nAPI -query-> DB'
      );
      expect(result.error).toMatch(
        /Line 5.*Participant 'API' is already in group 'Backend'/
      );
    });

    it('different participants in different groups is fine', () => {
      const result = parseSequenceDgmo(
        '## Backend(blue)\n  API\n  DB\n\n## Frontend(red)\n  App\nAPI -query-> DB\nApp -request-> API'
      );
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(2);
    });

    it('same participant listed twice in same group is fine', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API\n  API\nAPI -query-> DB'
      );
      expect(result.error).toBeNull();
    });
  });

  describe('lone # line errors (from 47.1)', () => {
    it('# produces error with correct line number', () => {
      const result = parseSequenceDgmo('A -msg-> B\n#\nB -next-> C');
      expect(result.error).toMatch(/Line 2.*Use \/\/ for comments/);
    });

    it('# with text produces error', () => {
      const result = parseSequenceDgmo('# my comment\nA -msg-> B');
      expect(result.error).toMatch(/Line 1.*Use \/\/ for comments/);
    });

    it('## group heading does not error', () => {
      const result = parseSequenceDgmo(
        '## Backend\n  API\nAPI -query-> DB'
      );
      expect(result.error).toBeNull();
    });
  });
});

// ============================================================
// Story 47.4 — else if support
// ============================================================
describe('Story 47.4 — else if support', () => {
  describe('single else if branch', () => {
    it('parses if / else if / else with correct children', () => {
      const content = [
        'if authenticated',
        '  A -proceed-> B',
        'else if guest',
        '  A -redirect-> C',
        'else',
        '  A -deny-> D',
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
        '  A -ok-> B',
        'else if status 404',
        '  A -not found-> C',
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
        '  A -full access-> B',
        'else if trial',
        '  A -limited access-> C',
        'else if expired',
        '  A -renew prompt-> D',
        'else',
        '  A -register-> E',
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
        '  A -check perms-> B',
        '  B -audit log-> C',
        'else if user',
        '  A -basic check-> D',
        '  D -log-> C',
        'else',
        '  A -block-> E',
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
        '  A -yes-> B',
        'Else If cond2',
        '  A -maybe-> C',
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
        '  A -go-> B',
        'else if retry',
        '  loop 3 times',
        '    A -attempt-> B',
        'else',
        '  A -fail-> C',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const block = result.elements[0] as SequenceBlock;
      expect(block.elseIfBranches).toHaveLength(1);
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
        '  A -task1-> B',
        'else if fallback',
        '  A -task2-> C',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toMatch(
        /Line 3.*parallel blocks don't support else if/
      );
    });
  });

  describe('else if without parent block', () => {
    it('else if at top level is ignored (no crash)', () => {
      const content = ['A -msg-> B', 'else if stray'].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('render integration with else if', () => {
    it('produces correct render steps for all branches', () => {
      const content = [
        'if cond1',
        '  A -branch1-> B',
        'else if cond2',
        '  A -branch2-> C',
        'else',
        '  A -branch3-> D',
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

// ============================================================
// Story 47.5 — note syntax
// ============================================================
describe('Story 47.5 — note syntax', () => {
  describe('single-line note with default position', () => {
    it('parses note after a message', () => {
      const content = ['A -login-> B', 'note: Rate limited'].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.elements).toHaveLength(2);
      const note = result.elements[1] as SequenceNote;
      expect(note.kind).toBe('note');
      expect(note.text).toBe('Rate limited');
      expect(note.position).toBe('right');
      expect(note.participantId).toBe('A');
    });

    it('default position uses last message sender', () => {
      const content = [
        'A -step1-> B',
        'B -step2-> C',
        'note: about step2',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[2] as SequenceNote;
      expect(note.participantId).toBe('B');
    });
  });

  describe('single-line note with explicit position', () => {
    it('parses note right of <participant>', () => {
      const content = [
        'A -login-> B',
        'note right of B: Validates JWT',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.position).toBe('right');
      expect(note.participantId).toBe('B');
      expect(note.text).toBe('Validates JWT');
    });

    it('parses note left of <participant>', () => {
      const content = [
        'A -login-> B',
        'note left of A: Shows spinner',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.position).toBe('left');
      expect(note.participantId).toBe('A');
    });

    it('position is case-insensitive', () => {
      const content = [
        'A -login-> B',
        'Note Right Of B: case test',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.position).toBe('right');
      expect(note.participantId).toBe('B');
    });
  });

  describe('multi-line note', () => {
    it('collects indented body lines', () => {
      const content = [
        'A -login-> B',
        'note right of B',
        '  Validates the JWT token.',
        '  See auth docs for details.',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.text).toBe(
        'Validates the JWT token.\nSee auth docs for details.'
      );
    });

    it('stops collecting on blank line', () => {
      const content = [
        'A -login-> B',
        'note',
        '  Line 1',
        '',
        'B -next-> C',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.text).toBe('Line 1');
      expect(result.messages).toHaveLength(2);
    });

    it('stops collecting on dedent', () => {
      const content = [
        'A -login-> B',
        'note right of A',
        '  Note body',
        'B -next-> C',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.text).toBe('Note body');
      expect(result.messages).toHaveLength(2);
    });

    it('parses multi-line note with trailing colon', () => {
      const content = [
        'chart: sequence',
        'A -login-> B',
        'note:',
        '  - [this](http://example.com)',
        '  - _that_ is a bullet list',
        '  - and the **other**',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.kind).toBe('note');
      expect(note.text).toBe(
        '- [this](http://example.com)\n- _that_ is a bullet list\n- and the **other**'
      );
      expect(note.participantId).toBe('A');
    });

    it('parses multi-line note with "note right of X:" form', () => {
      const content = [
        'A -login-> B',
        'note right of B:',
        '  First line',
        '  Second line',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.text).toBe('First line\nSecond line');
      expect(note.position).toBe('right');
      expect(note.participantId).toBe('B');
    });

    it('skips empty multi-line note gracefully', () => {
      const content = [
        'A -login-> B',
        'note right of B',
        'B -next-> C',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('note inside blocks', () => {
    it('note inside if block is in block children', () => {
      const content = [
        'if authenticated',
        '  A -proceed-> B',
        '  note: Success path',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const block = result.elements[0] as SequenceBlock;
      expect(block.children).toHaveLength(2);
      const note = block.children[1] as SequenceNote;
      expect(note.kind).toBe('note');
      expect(note.text).toBe('Success path');
    });

    it('note inside loop block', () => {
      const content = [
        'loop 3 times',
        '  A -attempt-> B',
        '  note left of B: Retry logic',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const block = result.elements[0] as SequenceBlock;
      const note = block.children[1] as SequenceNote;
      expect(note.position).toBe('left');
      expect(note.participantId).toBe('B');
    });
  });

  describe('tolerance — incomplete notes are skipped', () => {
    it('note with no preceding message is skipped', () => {
      const orphanContent = [
        'chart: sequence',
        'note: orphan note',
        'A -hello-> B',
      ].join('\n');
      const result = parseSequenceDgmo(orphanContent);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
      expect(result.elements).toHaveLength(1);
    });

    it('note referencing unknown participant is skipped', () => {
      const content = [
        'A -login-> B',
        'note right of Z: unknown',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
      expect(result.elements).toHaveLength(1);
    });

    it('default note with no preceding message in multi-line form is skipped', () => {
      const content = ['chart: sequence', 'note', '  body text', 'A -hello-> B'].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
    });

    it('bare "note" keyword mid-diagram is skipped', () => {
      const content = [
        'chart: sequence',
        'Captain -Battle stations!-> Quartermaster',
        'Quartermaster -Load cannons-> GunCrew',
        'note',
        'Quartermaster -Close to broadside range-> Helmsman',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(3);
    });
  });

  describe('note does not interfere with message parsing', () => {
    it('messages after notes parse correctly', () => {
      const content = [
        'A -step1-> B',
        'note: annotation',
        'B -step2-> C',
        'note right of C: another',
        'C -step3-> A',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(3);
      const notes = result.elements.filter(isSequenceNote);
      expect(notes).toHaveLength(2);
    });

    it('note does not appear in messages array', () => {
      const content = ['A -msg-> B', 'note: text'].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.messages).toHaveLength(1);
      expect(result.elements).toHaveLength(2);
    });
  });

  describe('render integration with notes', () => {
    it('notes do not affect render step count', () => {
      const content = [
        'A -step1-> B',
        'note: annotation',
        'B -step2-> C',
      ].join('\n');
      const parsed = parseSequenceDgmo(content);
      const steps = buildRenderSequence(parsed.messages);
      // 2 calls + 2 returns = 4 steps
      expect(steps).toHaveLength(4);
    });
  });
});

// ============================================================
// Sequence inference with new arrow forms
// ============================================================
describe('looksLikeSequence with new arrows', () => {
  it('detects -label->', () => {
    expect(
      parseSequenceDgmo('User -login-> API').messages
    ).toHaveLength(1);
  });

  it('detects <-label-', () => {
    expect(
      parseSequenceDgmo('A <-result- B').messages
    ).toHaveLength(1);
  });

  it('detects bare ->', () => {
    expect(
      parseSequenceDgmo('A -> B').messages
    ).toHaveLength(1);
  });

  it('detects bare <-', () => {
    expect(
      parseSequenceDgmo('A -call-> B\nA <- B').messages
    ).toHaveLength(2);
  });
});
