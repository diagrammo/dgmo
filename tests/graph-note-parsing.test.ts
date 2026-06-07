import { describe, it, expect } from 'vitest';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseState } from '../src/graph/state-parser';
import { resolveNotes } from '../src/graph/notes';

const errors = (d: { severity: string }[]) =>
  d.filter((x) => x.severity === 'error');
const warnings = (d: { severity: string }[]) =>
  d.filter((x) => x.severity === 'warning');

describe('graph notes — parsing', () => {
  // AC1
  it('collects a single-line node note with no errors', () => {
    const parsed = parseFlowchart(
      [
        'flowchart',
        '(Start) -> [Validate] -> (Done)',
        'note Validate a comment',
      ].join('\n')
    );
    expect(parsed.error).toBeNull();
    expect(parsed.notes?.length).toBe(1);
    expect(parsed.notes![0]!.ref).toBe('Validate');
    expect(parsed.notes![0]!.body).toBe('a comment');
    expect(errors([...parsed.diagnostics])).toHaveLength(0);

    // The ref resolves to the Validate node's id.
    const byNode = resolveNotes(parsed.notes!, parsed.nodes);
    const validate = parsed.nodes.find((n) => n.label === 'Validate')!;
    expect(byNode.get(validate.id)?.body).toBe('a comment');
  });

  // AC2
  it('collects an indented multi-line body and tracks endLineNumber', () => {
    const parsed = parseFlowchart(
      ['flowchart', '(A) -> (B)', 'note A', '  line one', '  line two'].join(
        '\n'
      )
    );
    expect(parsed.notes?.length).toBe(1);
    const note = parsed.notes![0]!;
    expect(note.body).toBe('line one\nline two');
    expect(note.lineNumber).toBe(3);
    expect(note.endLineNumber).toBe(5);
  });

  it('joins an inline body with following indented lines', () => {
    const parsed = parseFlowchart(
      ['flowchart', '(A) -> (B)', 'note A inline start', '  more detail'].join(
        '\n'
      )
    );
    expect(parsed.notes![0]!.body).toBe('inline start\nmore detail');
    expect(parsed.notes![0]!.endLineNumber).toBe(4);
  });

  // AC3
  it('resolves a forward reference declared before its node', () => {
    const parsed = parseFlowchart(
      ['flowchart', 'note Done finish here', '(Start) -> (Done)'].join('\n')
    );
    expect(parsed.error).toBeNull();
    expect(errors([...parsed.diagnostics])).toHaveLength(0);
    expect(parsed.notes?.length).toBe(1);
  });

  // AC4
  it('state: note resolves and is not swallowed by [Group] parsing', () => {
    const parsed = parseState(
      ['state', '[Region]', '  Idle -> Active', 'note Idle waiting'].join('\n')
    );
    expect(parsed.error).toBeNull();
    expect(parsed.notes?.length).toBe(1);
    expect(parsed.notes![0]!.ref).toBe('Idle');
    expect(errors([...parsed.diagnostics])).toHaveLength(0);
    const byNode = resolveNotes(parsed.notes!, parsed.nodes);
    const idle = parsed.nodes.find((n) => n.label === 'Idle')!;
    expect(byNode.has(idle.id)).toBe(true);
  });

  it('state: `note -> Active` stays a transition, not an annotation', () => {
    const parsed = parseState(['state', 'note -> Active'].join('\n'));
    // "note" is a state, edge to Active — no note collected.
    expect(parsed.notes ?? []).toHaveLength(0);
    expect(parsed.edges.length).toBe(1);
  });

  // AC5
  it('emits an error with a suggest hint for an unknown ref (no silent drop)', () => {
    const parsed = parseFlowchart(
      ['flowchart', '(Start) -> [Process] -> (Done)', 'note Proces typo'].join(
        '\n'
      )
    );
    // Raw note is retained...
    expect(parsed.notes?.length).toBe(1);
    // ...but resolution emits an error mentioning the unknown id + suggestion.
    const errs = errors([...parsed.diagnostics]);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    const msg = errs.map((e) => e.message).join(' ');
    expect(msg).toContain('unknown node id');
    expect(msg).toContain("Did you mean 'Process'");
  });

  // AC6
  it('warns and keeps the first when a node has two notes', () => {
    const parsed = parseFlowchart(
      [
        'flowchart',
        '(Start) -> [Validate] -> (Done)',
        'note Validate first',
        'note Validate second',
      ].join('\n')
    );
    expect(parsed.notes?.length).toBe(2);
    const warns = warnings([...parsed.diagnostics]);
    expect(warns.some((w) => /multiple notes/i.test(w.message))).toBe(true);

    const byNode = resolveNotes(parsed.notes!, parsed.nodes);
    const validate = parsed.nodes.find((n) => n.label === 'Validate')!;
    expect(byNode.get(validate.id)?.body).toBe('first');
  });

  it('parses `no-notes` as a boolean option', () => {
    const parsed = parseFlowchart(
      ['flowchart', 'no-notes', '(A) -> (B)', 'note A x'].join('\n')
    );
    expect(parsed.options['no-notes']).toBe('on');
  });

  // AC7 (second clause): parse+resolve run even with no-notes, so a
  // typo'd ref still errors (suppression is render-time only — ADR-4).
  it('still errors on an unknown ref under no-notes', () => {
    const parsed = parseFlowchart(
      [
        'flowchart',
        'no-notes',
        '(Start) -> [Process] -> (Done)',
        'note Proces typo',
      ].join('\n')
    );
    expect(
      errors([...parsed.diagnostics]).some((e) =>
        /unknown node id/.test(e.message)
      )
    ).toBe(true);
  });

  it('allows arrows inside a note body (no silent drop)', () => {
    const parsed = parseFlowchart(
      [
        'flowchart',
        '(Start) -> [Validate] -> (Done)',
        'note Validate flows A -> B internally',
      ].join('\n')
    );
    expect(parsed.notes?.length).toBe(1);
    expect(parsed.notes![0]!.body).toBe('flows A -> B internally');
    expect(errors([...parsed.diagnostics])).toHaveLength(0);
  });

  it('warns and skips a note with no text', () => {
    const parsed = parseFlowchart(
      ['flowchart', '(Start) -> [Validate] -> (Done)', 'note Validate'].join(
        '\n'
      )
    );
    expect(parsed.notes ?? []).toHaveLength(0);
    expect(
      warnings([...parsed.diagnostics]).some((w) => /no text/.test(w.message))
    ).toBe(true);
  });

  it('supports a quoted multi-word ref', () => {
    const parsed = parseFlowchart(
      [
        'flowchart',
        '(Order Received) -> (Done)',
        'note "Order Received" ok',
      ].join('\n')
    );
    expect(errors([...parsed.diagnostics])).toHaveLength(0);
    const byNode = resolveNotes(parsed.notes!, parsed.nodes);
    const node = parsed.nodes.find((n) => n.label === 'Order Received')!;
    expect(byNode.get(node.id)?.body).toBe('ok');
  });
});
