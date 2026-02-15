import { describe, it, expect } from 'vitest';
import {
  parseSequenceDgmo,
  buildRenderSequence,
  computeActivations,
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

  it('no space around colon — no split (e.g. URLs)', () => {
    const result = parseSequenceDgmo('A -> B: http://example.com');
    expect(result.messages[0].label).toBe('http://example.com');
    expect(result.messages[0].returnLabel).toBeUndefined();
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
