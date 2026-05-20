import { describe, it, expect } from 'vitest';
import {
  parseSequenceDgmo,
  buildRenderSequence,
  computeActivations,
  isSequenceNote,
  type SequenceBlock,
  type SequenceNote,
} from '../src/internal';

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
    expect(result.error).toMatch(
      /Bidirectional arrows are no longer supported/
    );
  });

  it('<~> gives error', () => {
    const result = parseSequenceDgmo('A -setup-> B\nA <~> B');
    expect(result.error).toMatch(
      /Bidirectional arrows are no longer supported/
    );
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
    expect(result.participants.map((p) => p.id)).toEqual([
      'Frontend',
      'Backend',
    ]);
  });

  describe('whitespace is optional around labeled arrows', () => {
    it('no spaces: User-login->API', () => {
      const result = parseSequenceDgmo('User-login->API');
      expect(result.error).toBeNull();
      expect(result.messages[0]).toMatchObject({
        from: 'User',
        to: 'API',
        label: 'login',
      });
    });

    it('no leading space: User-login-> API', () => {
      const result = parseSequenceDgmo('User-login-> API');
      expect(result.error).toBeNull();
      expect(result.messages[0]).toMatchObject({
        from: 'User',
        to: 'API',
        label: 'login',
      });
    });

    it('async no spaces: API~event~>Queue', () => {
      const result = parseSequenceDgmo('API~event~>Queue');
      expect(result.error).toBeNull();
      expect(result.messages[0]).toMatchObject({
        from: 'API',
        to: 'Queue',
        label: 'event',
        async: true,
      });
    });
  });

  describe('dashes in labels', () => {
    it('hyphenated label: A -pre-process-> B', () => {
      const result = parseSequenceDgmo('A -pre-process-> B');
      expect(result.error).toBeNull();
      expect(result.messages[0]).toMatchObject({
        from: 'A',
        to: 'B',
        label: 'pre-process',
      });
    });

    it('hyphenated to name: A -call-> my-api', () => {
      const result = parseSequenceDgmo('A -call-> my-api');
      expect(result.error).toBeNull();
      expect(result.messages[0]).toMatchObject({
        from: 'A',
        to: 'my-api',
        label: 'call',
      });
    });
  });
});

// ============================================================
// Deprecated return arrows — produce errors
// ============================================================
describe('return arrows produce errors', () => {
  it('labeled return <-msg- gives error with migration hint', () => {
    const result = parseSequenceDgmo('Client <-token- Server');
    expect(result.error).toContain('no longer supported');
    expect(result.error).toContain("'Server -token-> Client'");
  });

  it('bare return <- gives error', () => {
    const result = parseSequenceDgmo('A -msg-> B\nA <- B');
    expect(result.error).toContain('no longer supported');
  });

  it('async labeled return <~msg~ gives error', () => {
    const result = parseSequenceDgmo('A <~result~ B');
    expect(result.error).toContain('no longer supported');
  });

  it('bare async return <~ gives error', () => {
    const result = parseSequenceDgmo('A ~fire~> B\nA <~ B');
    expect(result.error).toContain('no longer supported');
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

  it('A~>B with no spaces', () => {
    const result = parseSequenceDgmo('A~>B');
    expect(result.messages[0]).toMatchObject({
      from: 'A',
      to: 'B',
      label: '',
      async: true,
    });
  });

  it('hyphenated target with bare arrow: A -> my-svc', () => {
    const result = parseSequenceDgmo('A -> my-svc');
    expect(result.error).toBeNull();
    expect(result.messages[0]).toMatchObject({
      from: 'A',
      to: 'my-svc',
      label: '',
    });
  });
});

// ============================================================
// Render integration — calls and returns
// ============================================================
describe('render integration', () => {
  it('call + response produces correct steps', () => {
    const parsed = parseSequenceDgmo('A -request-> B\nB -response-> A');
    const steps = buildRenderSequence(parsed.messages);
    // B -response-> A is a nested call (B calls A back), with auto-returns
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({
      type: 'call',
      from: 'A',
      to: 'B',
      label: 'request',
    });
    expect(steps[1]).toMatchObject({
      type: 'call',
      from: 'B',
      to: 'A',
      label: 'response',
    });
    expect(steps[2]).toMatchObject({
      type: 'return',
      from: 'A',
      to: 'B',
      label: '',
    });
    expect(steps[3]).toMatchObject({
      type: 'return',
      from: 'B',
      to: 'A',
      label: '',
    });
  });

  it('call without explicit return produces auto-return', () => {
    const parsed = parseSequenceDgmo('A -request-> B');
    const steps = buildRenderSequence(parsed.messages);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: 'call', from: 'A', to: 'B' });
    expect(steps[1]).toMatchObject({
      type: 'return',
      from: 'B',
      to: 'A',
      label: '',
    });
  });

  it('forward-only multi-step flow', () => {
    const parsed = parseSequenceDgmo(
      [
        'Client -login-> Server',
        '  Server -query-> DB',
        '  DB -rows-> Server',
        'Server -token-> Client',
      ].join('\n')
    );
    const steps = buildRenderSequence(parsed.messages);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps[0]).toMatchObject({
      type: 'call',
      from: 'Client',
      to: 'Server',
    });
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
      expect(result.error).toMatch(/Line 2.*Use \/\/ for comments/);
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

    it('[Group] headings work', () => {
      const result = parseSequenceDgmo(
        '[Backend]\n  API\n  DB\nAPI -query-> DB'
      );
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Backend');
    });
  });

  describe('color syntax produces deprecation warnings', () => {
    it('warns on hex color in group heading', () => {
      const result = parseSequenceDgmo(
        '[Backend(#ff6b6b)]\n  API\nAPI -query-> DB'
      );
      expect(result.error).toBeNull();
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(
        warnings.some((w) => w.message.includes('color syntax removed'))
      ).toBe(true);
      expect(result.groups[0].name).toBe('Backend');
    });

    // Sequence deprecation warnings are scoped to the recognized 11-name
    // palette only — `funcCall(arg)` and hex codes pass through.
    it('hex color in section divider does NOT warn (not a palette word)', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Phase 2(#abc123) ==');
      expect(result.error).toBeNull();
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(
        warnings.some((w) => w.message.includes('parens-color syntax removed'))
      ).toBe(false);
    });

    it('warns on named color in group (no longer stored)', () => {
      const result = parseSequenceDgmo(
        '[Backend(blue)]\n  API\nAPI -query-> DB'
      );
      expect(result.error).toBeNull();
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings.some((w) => w.message.includes('(blue)'))).toBe(true);
      expect(result.groups[0].name).toBe('Backend');
    });

    it('warns on named color in section (no longer stored)', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Phase 2(teal) ==');
      expect(result.error).toBeNull();
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings.some((w) => w.message.includes('(teal)'))).toBe(true);
      expect(result.sections[0].label).toBe('Phase 2');
    });
  });

  describe('empty group warning', () => {
    it('suggests section syntax for empty group', () => {
      const result = parseSequenceDgmo('[EmptyGroup]\nA -> B: hello');
      const warn = result.diagnostics.find(
        (d) => d.severity === 'warning' && d.message.includes('EmptyGroup')
      );
      expect(warn).toBeTruthy();
      expect(warn!.message).toContain('== EmptyGroup ==');
    });
  });
});

// ============================================================
// Story 47.2 — parser tolerance
// ============================================================
describe('Story 47.2 — Parser tolerance', () => {
  describe('multi-word group names', () => {
    it('two-word group name', () => {
      const result = parseSequenceDgmo('[Order Service]\n  API\n\nA -msg-> B');
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Order Service');
    });

    it('multi-word group with legacy parens-color emits warning', () => {
      const result = parseSequenceDgmo(
        '[Payment Gateway(blue)]\n  API\n\nA -msg-> B'
      );
      expect(result.error).toBeNull();
      expect(result.groups[0].name).toBe('Payment Gateway');
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings.some((w) => w.message.includes('(blue)'))).toBe(true);
    });

    it('single-word group still works', () => {
      const result = parseSequenceDgmo('[Backend]\n  API\n\nA -msg-> B');
      expect(result.error).toBeNull();
      expect(result.groups[0].name).toBe('Backend');
    });

    it('trailing spaces in group name are trimmed', () => {
      const result = parseSequenceDgmo('[Backend]   \n  API\n\nA -msg-> B');
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

    it('section without trailing == and with legacy parens-color emits warning', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Critical(red)');
      expect(result.error).toBeNull();
      expect(result.sections[0].label).toBe('Critical');
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings.some((w) => w.message.includes('(red)'))).toBe(true);
    });

    it('section with trailing == and legacy parens-color emits warning', () => {
      const result = parseSequenceDgmo('A -msg-> B\n== Critical(red) ==');
      expect(result.error).toBeNull();
      expect(result.sections[0].label).toBe('Critical');
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings.some((w) => w.message.includes('(red)'))).toBe(true);
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
    it('title on first line parses normally', () => {
      const result = parseSequenceDgmo('sequence Auth Flow\nA -login-> B');
      expect(result.error).toBeNull();
      expect(result.title).toBe('Auth Flow');
    });

    it('options before first message parse normally', () => {
      const result = parseSequenceDgmo(
        'sequence\nno-activations\nA -login-> B'
      );
      expect(result.error).toBeNull();
      expect(result.options.activations).toBe('off');
    });

    it('option after a section produces error', () => {
      const result = parseSequenceDgmo(
        'sequence\n== Auth\nno-activations\nA -login-> B'
      );
      expect(result.error).toMatch(/Line 3.*must appear before/);
    });

    it('option after a participant declaration produces error', () => {
      const result = parseSequenceDgmo(
        'sequence\nAPI is a service\nno-activations\nAPI -query-> DB'
      );
      expect(result.error).toMatch(/Line 3.*must appear before/);
    });

    it('option after a group produces error', () => {
      const result = parseSequenceDgmo(
        'sequence\n[Backend]\n  API\nno-activations\nAPI -query-> DB'
      );
      expect(result.error).toMatch(/Line 4.*must appear before/);
    });
  });

  describe('duplicate participant group membership', () => {
    it('participant in two groups produces error', () => {
      const result = parseSequenceDgmo(
        '[Backend]\n  API\n\n[Frontend]\n  API\nAPI -query-> DB'
      );
      expect(result.error).toMatch(
        /Line 5.*Participant 'API' is already in group 'Backend'/
      );
    });

    it('participant in two groups via "is a" syntax produces error', () => {
      const result = parseSequenceDgmo(
        '[Backend]\n  API is a service\n\n[Frontend]\n  API is a gateway\nAPI -query-> DB'
      );
      expect(result.error).toMatch(
        /Line 5.*Participant 'API' is already in group 'Backend'/
      );
    });

    it('different participants in different groups is fine', () => {
      const result = parseSequenceDgmo(
        '[Backend]\n  API\n  DB\n\n[Frontend]\n  App\nAPI -query-> DB\nApp -request-> API'
      );
      expect(result.error).toBeNull();
      expect(result.groups).toHaveLength(2);
    });

    it('same participant listed twice in same group is fine', () => {
      const result = parseSequenceDgmo(
        '[Backend]\n  API\n  API\nAPI -query-> DB'
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

    it('## group heading produces migration error', () => {
      const result = parseSequenceDgmo('## Backend\n  API\nAPI -query-> DB');
      expect(result.error).toMatch(/no longer supported.*\[Backend\]/);
    });

    it('[Group] heading does not error', () => {
      const result = parseSequenceDgmo('[Backend]\n  API\nAPI -query-> DB');
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
      const content = ['A -login-> B', 'note Rate limited'].join('\n');
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
      const content = ['A -step1-> B', 'B -step2-> C', 'note about step2'].join(
        '\n'
      );
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[2] as SequenceNote;
      expect(note.participantId).toBe('B');
    });
  });

  describe('single-line note with explicit position', () => {
    it('parses note right of <participant>', () => {
      const content = ['A -login-> B', 'note right of B Validates JWT'].join(
        '\n'
      );
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.position).toBe('right');
      expect(note.participantId).toBe('B');
      expect(note.text).toBe('Validates JWT');
    });

    it('parses note left of <participant>', () => {
      const content = ['A -login-> B', 'note left of A Shows spinner'].join(
        '\n'
      );
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      const note = result.elements[1] as SequenceNote;
      expect(note.position).toBe('left');
      expect(note.participantId).toBe('A');
    });

    it('position is case-insensitive', () => {
      const content = ['A -login-> B', 'Note Right Of B case test'].join('\n');
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

    it('parses multi-line note with bare note keyword', () => {
      const content = [
        'sequence',
        'A -login-> B',
        'note',
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

    it('parses multi-line note with "note right of X" form', () => {
      const content = [
        'A -login-> B',
        'note right of B',
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
      const content = ['A -login-> B', 'note right of B', 'B -next-> C'].join(
        '\n'
      );
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
        '  note Success path',
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
        '  note left of B Retry logic',
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
        'sequence',
        'note orphan note',
        'A -hello-> B',
      ].join('\n');
      const result = parseSequenceDgmo(orphanContent);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
      expect(result.elements).toHaveLength(1);
    });

    it('note referencing unknown participant is skipped', () => {
      const content = ['A -login-> B', 'note right of Z unknown'].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
      expect(result.elements).toHaveLength(1);
    });

    it('default note with no preceding message in multi-line form is skipped', () => {
      const content = ['sequence', 'note', '  body text', 'A -hello-> B'].join(
        '\n'
      );
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(1);
    });

    it('bare "note" keyword mid-diagram is skipped', () => {
      const content = [
        'sequence',
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
        'note annotation',
        'B -step2-> C',
        'note right of C another',
        'C -step3-> A',
      ].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.error).toBeNull();
      expect(result.messages).toHaveLength(3);
      const notes = result.elements.filter(isSequenceNote);
      expect(notes).toHaveLength(2);
    });

    it('note does not appear in messages array', () => {
      const content = ['A -msg-> B', 'note text'].join('\n');
      const result = parseSequenceDgmo(content);
      expect(result.messages).toHaveLength(1);
      expect(result.elements).toHaveLength(2);
    });
  });

  describe('render integration with notes', () => {
    it('notes do not affect render step count', () => {
      const content = ['A -step1-> B', 'note annotation', 'B -step2-> C'].join(
        '\n'
      );
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
    expect(parseSequenceDgmo('User -login-> API').messages).toHaveLength(1);
  });

  it('<-label- produces error, not message', () => {
    const parsed = parseSequenceDgmo('A <-result- B');
    expect(parsed.messages).toHaveLength(0);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it('detects bare ->', () => {
    expect(parseSequenceDgmo('A -> B').messages).toHaveLength(1);
  });

  it('bare <- produces error, not message', () => {
    const parsed = parseSequenceDgmo('A -call-> B\nA <- B');
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Tag group declarations
// ============================================================
describe('tag group declarations', () => {
  it('parses a single tag group with entries', () => {
    const content = [
      'tag Concern c',
      '  Caching blue',
      '  Auth green',
      '',
      'A -req-> B',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.error).toBeNull();
    expect(result.tagGroups).toHaveLength(1);
    expect(result.tagGroups[0].name).toBe('Concern');
    expect(result.tagGroups[0].alias).toBe('c');
    expect(result.tagGroups[0].entries).toHaveLength(2);
    expect(result.tagGroups[0].entries[0].value).toBe('Caching');
    expect(result.tagGroups[0].entries[1].value).toBe('Auth');
  });

  it('parses multiple tag groups', () => {
    const content = [
      'tag Concern c',
      '  Caching blue',
      '  Auth green',
      'tag Team t',
      '  Platform purple',
      '  Product orange',
      '',
      'A -req-> B',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.error).toBeNull();
    expect(result.tagGroups).toHaveLength(2);
    expect(result.tagGroups[0].name).toBe('Concern');
    expect(result.tagGroups[1].name).toBe('Team');
  });

  it('first tag entry is the default', () => {
    const content = [
      'tag Role',
      '  Gateway blue',
      '  Service green',
      '',
      'A -req-> B',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.tagGroups[0].defaultValue).toBe('Gateway');
  });

  it('registers aliases in aliasMap', () => {
    const content = [
      'tag Concern c',
      '  Caching blue',
      '',
      'A -req-> B | c: Caching',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    // The alias "c" should resolve to "concern" in the metadata
    expect(result.messages[0].metadata).toEqual({ concern: 'Caching' });
  });

  it('errors when tag group appears after content', () => {
    const content = ['A -req-> B', 'tag Concern', '  Caching blue'].join('\n');
    const result = parseSequenceDgmo(content);
    expect(
      result.diagnostics.some((d) =>
        d.message.includes('before sequence content')
      )
    ).toBe(true);
  });

  it('errors on entry without color', () => {
    const content = ['tag Concern', '  Caching', '', 'A -req-> B'].join('\n');
    const result = parseSequenceDgmo(content);
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("Expected 'Value color'")
      )
    ).toBe(true);
  });

  it('does not treat ## as tag group in sequence diagrams', () => {
    const content = ['## Backend', '  API', '', 'A -req-> B'].join('\n');
    const result = parseSequenceDgmo(content);
    // ## in sequence is a legacy group syntax error, not a tag group
    expect(result.tagGroups).toHaveLength(0);
  });
});

// ============================================================
// Pipe metadata on participants
// ============================================================
describe('pipe metadata on participants', () => {
  it('parses metadata on "is a" declaration', () => {
    const content = [
      'API is a gateway | role: Gateway, team: Platform',
      'DB is a database',
      'API -query-> DB',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.error).toBeNull();
    const api = result.participants.find((p) => p.id === 'API');
    expect(api?.metadata).toEqual({ role: 'Gateway', team: 'Platform' });
    const db = result.participants.find((p) => p.id === 'DB');
    expect(db?.metadata).toBeUndefined();
  });

  it('parses metadata on legacy parens-colored participant (color stripped with error)', () => {
    const content = ['API(blue) | role: Gateway', 'API -req-> DB'].join('\n');
    const result = parseSequenceDgmo(content);
    const api = result.participants.find((p) => p.id === 'API');
    expect(api?.metadata).toEqual({ role: 'Gateway' });
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.message.includes('(blue)'))).toBe(true);
  });

  it('parses metadata on bare participant in group', () => {
    const content = [
      '[Backend]',
      '  API | role: Gateway',
      '',
      'API -req-> DB',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    const api = result.participants.find((p) => p.id === 'API');
    expect(api?.metadata).toEqual({ role: 'Gateway' });
    expect(result.groups[0].participantIds).toContain('API');
  });

  it('parses metadata on bare top-level participant', () => {
    const content = [
      'tag Location l',
      '  Park red',
      '  Cloud blue',
      '',
      'Tapin2 | l:Park',
      '',
      'User -push-> Tapin2',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    const tapin = result.participants.find((p) => p.id === 'Tapin2');
    expect(tapin?.metadata).toEqual({ location: 'Park' });
  });

  it('parses metadata on bare top-level participant after groups', () => {
    const content = [
      'tag Location l',
      '  Park red',
      '  Cloud blue',
      '',
      '[Backend]',
      '  API',
      '',
      'Tapin2 | l:Park',
      '',
      'User -push-> Tapin2',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    const tapin = result.participants.find((p) => p.id === 'Tapin2');
    expect(tapin?.metadata).toEqual({ location: 'Park' });
    // Should not be added to the Backend group
    expect(result.groups[0].participantIds).not.toContain('Tapin2');
  });

  it('parses bare top-level participant without metadata', () => {
    const content = ['MyService', '', 'User -call-> MyService'].join('\n');
    const result = parseSequenceDgmo(content);
    const svc = result.participants.find((p) => p.id === 'MyService');
    expect(svc).toBeDefined();
    expect(svc?.metadata).toBeUndefined();
  });

  it('parses metadata on position declaration', () => {
    const content = ['DB position -1 | role: Storage', 'API -req-> DB'].join(
      '\n'
    );
    const result = parseSequenceDgmo(content);
    const db = result.participants.find((p) => p.id === 'DB');
    expect(db?.position).toBe(-1);
    expect(db?.metadata).toEqual({ role: 'Storage' });
  });

  it('resolves in participant metadata', () => {
    const content = [
      'tag Concern c',
      '  Caching blue',
      '',
      'API is a gateway | c: Caching',
      'API -req-> DB',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    const api = result.participants.find((p) => p.id === 'API');
    expect(api?.metadata).toEqual({ concern: 'Caching' });
  });
});

// ============================================================
// Pipe metadata on messages
// ============================================================
describe('pipe metadata on messages', () => {
  it('parses metadata on labeled arrow', () => {
    const content = 'A -request-> B | c: Caching';
    const result = parseSequenceDgmo(content);
    expect(result.error).toBeNull();
    expect(result.messages[0].metadata).toEqual({ c: 'Caching' });
    expect(result.messages[0].label).toBe('request');
    expect(result.messages[0].from).toBe('A');
    expect(result.messages[0].to).toBe('B');
  });

  it('parses metadata on async arrow', () => {
    const content = 'A ~fire~> B | c: Async';
    const result = parseSequenceDgmo(content);
    expect(result.messages[0].async).toBe(true);
    expect(result.messages[0].metadata).toEqual({ c: 'Async' });
  });

  it('parses metadata on bare arrow', () => {
    const content = 'A -> B | c: Caching';
    const result = parseSequenceDgmo(content);
    expect(result.messages[0].metadata).toEqual({ c: 'Caching' });
    expect(result.messages[0].label).toBe('');
  });

  it('parses metadata on bare async arrow', () => {
    const content = 'A ~> B | c: Async';
    const result = parseSequenceDgmo(content);
    expect(result.messages[0].async).toBe(true);
    expect(result.messages[0].metadata).toEqual({ c: 'Async' });
  });

  it('parses multiple metadata keys', () => {
    const content = 'A -req-> B | c: Caching, t: Platform';
    const result = parseSequenceDgmo(content);
    expect(result.messages[0].metadata).toEqual({
      c: 'Caching',
      t: 'Platform',
    });
  });

  it('errors on multiple pipe-separated metadata', () => {
    const content = 'A -req-> B | c: Caching | t: Platform';
    const result = parseSequenceDgmo(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('single "|"');
  });

  it('resolves in message metadata', () => {
    const content = [
      'tag Concern c',
      '  Caching blue',
      '',
      'A -req-> B | c: Caching',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.messages[0].metadata).toEqual({ concern: 'Caching' });
  });

  it('no metadata when no pipe present', () => {
    const content = 'A -req-> B';
    const result = parseSequenceDgmo(content);
    expect(result.messages[0].metadata).toBeUndefined();
  });
});

// ============================================================
// Pipe metadata on group headers
// ============================================================
describe('pipe metadata on group headers', () => {
  it('parses metadata outside brackets on group heading', () => {
    const content = [
      '[Backend] | t: Engineering',
      '  API',
      '',
      'API -req-> DB',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.groups[0].name).toBe('Backend');
    expect(result.groups[0].metadata).toEqual({ t: 'Engineering' });
  });

  it('parses multiple metadata keys outside brackets', () => {
    const content = [
      '[Backend] | t: Product, color: blue',
      '  API',
      '',
      'API -req-> DB',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.groups[0].name).toBe('Backend');
    expect(result.groups[0].metadata).toEqual({ t: 'Product', color: 'blue' });
  });

  it('pipe inside brackets emits error with migration hint', () => {
    const content = [
      '[Backend | t: Engineering]',
      '  API',
      '',
      'API -req-> DB',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.error).toMatch(/Pipe metadata must go outside brackets/);
    expect(result.error).toMatch(/\[Backend\] \| t: Engineering/);
  });

  it('pipe inside brackets with legacy parens-color emits error', () => {
    const content = [
      '[Backend(blue) | t: Product]',
      '  API',
      '',
      'API -req-> DB',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.error).toMatch(/Pipe metadata must go outside brackets/);
    expect(result.error).toMatch(/\[Backend\] \| t: Product/);
  });

  it('group without pipe has no metadata', () => {
    const content = ['[Backend]', '  API', '', 'API -req-> DB'].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.groups[0].metadata).toBeUndefined();
  });

  it('[Backend(blue)] still emits legacy color deprecation warning', () => {
    const content = ['[Backend(blue)]', '  API', '', 'API -req-> DB'].join(
      '\n'
    );
    const result = parseSequenceDgmo(content);
    expect(result.error).toBeNull();
    expect(result.groups[0].name).toBe('Backend');
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.some((w) => w.message.includes('(blue)'))).toBe(true);
  });

  it('[Backend] | t: Product, color: blue parses both metadata keys', () => {
    const content = [
      '[Backend] | t: Product, color: blue',
      '  API',
      '',
      'API -req-> DB',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    expect(result.error).toBeNull();
    expect(result.groups[0].name).toBe('Backend');
    expect(result.groups[0].metadata).toEqual({ t: 'Product', color: 'blue' });
  });
});

// ============================================================
// Collapse keyword on group headers
// ============================================================
describe('collapse keyword on group headers', () => {
  it('[Backend] collapse sets collapsed: true', () => {
    const result = parseSequenceDgmo(
      '[Backend] collapse\n  API\n  DB\nAPI -query-> DB'
    );
    expect(result.error).toBeNull();
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('Backend');
    expect(result.groups[0].collapsed).toBe(true);
  });

  it('[Backend] collapse with pipe metadata', () => {
    const result = parseSequenceDgmo(
      '[Backend] collapse | t: Eng\n  API\n  DB\nAPI -query-> DB'
    );
    expect(result.error).toBeNull();
    expect(result.groups[0].collapsed).toBe(true);
    expect(result.groups[0].metadata).toEqual({ t: 'Eng' });
  });

  it('[Backend] without collapse has no collapsed field', () => {
    const result = parseSequenceDgmo('[Backend]\n  API\n  DB\nAPI -query-> DB');
    expect(result.error).toBeNull();
    expect(result.groups[0].collapsed).toBeUndefined();
  });

  it('[Backend] | t: Eng without collapse has no collapsed field', () => {
    const result = parseSequenceDgmo(
      '[Backend] | t: Eng\n  API\n  DB\nAPI -query-> DB'
    );
    expect(result.error).toBeNull();
    expect(result.groups[0].collapsed).toBeUndefined();
    expect(result.groups[0].metadata).toEqual({ t: 'Eng' });
  });

  it('COLLAPSE is case-insensitive', () => {
    const result = parseSequenceDgmo(
      '[Backend] COLLAPSE\n  API\n  DB\nAPI -query-> DB'
    );
    expect(result.error).toBeNull();
    expect(result.groups[0].collapsed).toBe(true);
  });

  it('[Backend] collapse with indented participants', () => {
    const result = parseSequenceDgmo(
      '[Backend] collapse\n  API\n  DB\nUser -request-> API'
    );
    expect(result.error).toBeNull();
    expect(result.groups[0].collapsed).toBe(true);
    expect(result.groups[0].participantIds).toContain('API');
    expect(result.groups[0].participantIds).toContain('DB');
  });
});

// ============================================================
// Tag validation
// ============================================================
describe('tag validation on sequence diagrams', () => {
  it('warns on unknown tag value in message', () => {
    const content = [
      'tag Concern',
      '  Caching blue',
      '  Auth green',
      '',
      'A -req-> B | concern: Typo',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(
      warnings.some((w) => w.message.includes("Unknown value 'Typo'"))
    ).toBe(true);
  });

  it('no warning for valid tag value', () => {
    const content = [
      'tag Concern',
      '  Caching blue',
      '',
      'A -req-> B | concern: Caching',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(0);
  });

  it('warns on unknown value with did-you-mean', () => {
    const content = [
      'tag Concern',
      '  Caching blue',
      '',
      'A -req-> B | concern: Cachng',
    ].join('\n');
    const result = parseSequenceDgmo(content);
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
    // Should contain either a did-you-mean or list of defined values
    expect(warnings[0].message).toMatch(/Caching/);
  });
});

// ============================================================
describe('multi-word participant names', () => {
  it('declares a participant with spaces using is-a syntax', () => {
    const result = parseSequenceDgmo(
      'Auth Server is a service\nAuth Server -ping-> App'
    );
    expect(result.error).toBeNull();
    expect(result.participants.some((p) => p.id === 'Auth Server')).toBe(true);
  });

  it('accepts "is a" and "is an" identically (grammar forgiveness)', () => {
    const r1 = parseSequenceDgmo('User is a actor\nUser -msg-> App');
    const r2 = parseSequenceDgmo('User is an actor\nUser -msg-> App');
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    expect(r1.participants[0].type).toBe('actor');
    expect(r2.participants[0].type).toBe('actor');
  });

  it('parses labeled arrow with multi-word source', () => {
    const result = parseSequenceDgmo('Auth Server -Token valid-> App');
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].from).toBe('Auth Server');
    expect(result.messages[0].to).toBe('App');
    expect(result.messages[0].label).toBe('Token valid');
  });

  it('parses labeled arrow with multi-word target', () => {
    const result = parseSequenceDgmo(
      'App -Redirect to /authorize-> Auth Server'
    );
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].from).toBe('App');
    expect(result.messages[0].to).toBe('Auth Server');
    expect(result.messages[0].label).toBe('Redirect to /authorize');
  });

  it('parses labeled arrow with multi-word source and target', () => {
    const result = parseSequenceDgmo(
      'Auth Server -Token valid + claims-> Resource Server'
    );
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].from).toBe('Auth Server');
    expect(result.messages[0].to).toBe('Resource Server');
    expect(result.messages[0].label).toBe('Token valid + claims');
  });

  it('parses bare arrow with multi-word source and target', () => {
    const result = parseSequenceDgmo('Auth Server -> Resource Server');
    expect(result.error).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].from).toBe('Auth Server');
    expect(result.messages[0].to).toBe('Resource Server');
  });

  it('parses message with special chars: slashes, parens, quotes', () => {
    const result = parseSequenceDgmo(
      'App -POST /token (code, client_secret)-> Auth Server'
    );
    expect(result.error).toBeNull();
    expect(result.messages[0].label).toBe('POST /token (code, client_secret)');
  });

  it('parses note right of with multi-word participant', () => {
    const result = parseSequenceDgmo(
      'Auth Server -ping-> App\nnote right of Auth Server some note text'
    );
    expect(result.error).toBeNull();
    const notes = result.elements.filter(
      (e) => 'kind' in e && e.kind === 'note'
    );
    expect(notes).toHaveLength(1);
    expect((notes[0] as SequenceNote).participantId).toBe('Auth Server');
    expect((notes[0] as SequenceNote).text).toBe('some note text');
  });

  it('renders full OAuth-style diagram without errors', () => {
    const diagram = [
      'sequence OAuth 2.0 — Authorization Code Flow',
      '',
      'User is an actor',
      'App is a service',
      'Auth Server is a service',
      'Resource Server is a service',
      '',
      '== 1. Initiate Login ==',
      '',
      'User -Click "Login with Google"-> App',
      'App -Redirect to /authorize-> Auth Server',
      '',
      '== 2. User Authenticates ==',
      '',
      'Auth Server -Show login + consent screen-> User',
      'User -Enter credentials + grant consent-> Auth Server',
      '',
      '== 4. Exchange Code for Tokens ==',
      '',
      'App -POST /token (code, client_secret)-> Auth Server',
      'Auth Server -access_token + refresh_token-> App',
      '',
      '== 5. Access Protected Resource ==',
      '',
      'App -GET /api/user (Bearer access_token)-> Resource Server',
      'Resource Server -Validate token-> Auth Server',
      'Auth Server -Token valid + claims-> Resource Server',
      'Resource Server -User data-> App',
    ].join('\n');
    const result = parseSequenceDgmo(diagram);
    expect(result.error).toBeNull();
    expect(result.participants).toHaveLength(4);
    expect(result.messages.length).toBeGreaterThan(5);
  });
});

describe('aka removal (Phase D)', () => {
  it('emits E_AKA_REMOVED when aka appears in a participant declaration', () => {
    const result = parseSequenceDgmo(`sequence
Alice is a service aka Authenticator
Alice -hi-> Bob`);
    const akaErrors = result.diagnostics.filter(
      (d) => d.code === 'E_AKA_REMOVED'
    );
    expect(akaErrors).toHaveLength(1);
    expect(akaErrors[0].severity).toBe('error');
    expect(akaErrors[0].message).toMatch(/aka.*no longer supported/);
  });

  it('does not register a participant when its declaration uses aka', () => {
    const result = parseSequenceDgmo(`sequence
Alice is a service aka Authenticator`);
    expect(result.participants).toHaveLength(0);
  });

  it('treats aka inside a quoted name as literal (not a keyword)', () => {
    const result = parseSequenceDgmo(`sequence
"aka something" -hi-> Bob`);
    expect(
      result.diagnostics.filter((d) => d.code === 'E_AKA_REMOVED')
    ).toHaveLength(0);
  });
});

describe('sequence parser — universal alias syntax (TD-18)', () => {
  it('extracts alias from `Name is a TYPE as <alias>` declaration', () => {
    const result = parseSequenceDgmo(`sequence
Alice is a service as a
Bob is a database as b
a -hello-> b
b -ack-> a`);
    expect(
      result.diagnostics.filter((d) => d.severity === 'error')
    ).toHaveLength(0);
    expect(result.participants).toHaveLength(2);
    expect(result.participants[0].id).toBe('Alice');
    expect(result.participants[1].id).toBe('Bob');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].from).toBe('Alice');
    expect(result.messages[0].to).toBe('Bob');
    expect(result.messages[1].from).toBe('Bob');
    expect(result.messages[1].to).toBe('Alice');
  });

  it('alias resolves via case-sensitive exact match', () => {
    const result = parseSequenceDgmo(`sequence
Alice is a service as a
a -hello-> Bob`);
    expect(result.messages[0].from).toBe('Alice');
    expect(result.messages[0].to).toBe('Bob');
  });

  it('keeps `position N as <alias>` working', () => {
    const result = parseSequenceDgmo(`sequence
Alice is a service position 1 as a
a -hi-> Bob`);
    expect(result.participants[0].position).toBe(1);
    expect(result.messages[0].from).toBe('Alice');
  });

  it('aliases do not leak across separate parse calls (C8)', () => {
    const a = parseSequenceDgmo(`sequence
Alice is a service as x
x -hi-> Bob`);
    expect(a.messages[0].from).toBe('Alice');
    const b = parseSequenceDgmo(`sequence
x -hi-> y`);
    // 'x' was never declared in `b` — should be treated as a literal name.
    expect(b.messages[0].from).toBe('x');
    expect(b.messages[0].to).toBe('y');
  });

  it('uppercase aliases resolve (spec §2A.2: aliases are never UNH-normalized)', () => {
    const result = parseSequenceDgmo(`sequence
Lookout is an actor as L
Captain is an actor as C
L -spotted-> C`);
    expect(
      result.diagnostics.filter((d) => d.severity === 'error')
    ).toHaveLength(0);
    expect(result.participants).toHaveLength(2);
    expect(result.participants.map((p) => p.id)).toEqual([
      'Lookout',
      'Captain',
    ]);
    expect(result.messages[0].from).toBe('Lookout');
    expect(result.messages[0].to).toBe('Captain');
  });

  it('case-sensitive: lowercase lookup misses uppercase-declared alias', () => {
    const result = parseSequenceDgmo(`sequence
Alice is a service as A
a -hi-> Bob`);
    // `a` was never declared — should be a literal participant, not Alice
    expect(result.messages[0].from).toBe('a');
    expect(result.messages[0].to).toBe('Bob');
  });
});
