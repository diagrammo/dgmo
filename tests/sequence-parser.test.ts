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

  it('async prefix skips parseReturnLabel', () => {
    const result = parseSequenceDgmo('async A -> B: x : y');
    expect(result.messages[0].label).toBe('x : y');
    expect(result.messages[0].returnLabel).toBeUndefined();
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
