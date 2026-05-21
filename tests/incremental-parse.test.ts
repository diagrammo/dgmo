import { describe, it, expect } from 'vitest';
import { parseSequenceDgmo } from '../src/sequence/parser';

// ============================================================
// LSP incremental-parse contract (TD-18 C8 / M6)
// ============================================================
//
// Each parse must start with a fresh alias map. Earlier parses must
// not bleed entries into later parses, and a re-parse with different
// content must NOT retain bindings from the previous parse.

describe('LSP incremental parse — alias map is per-parse, never persisted', () => {
  it('alias from parse 1 does NOT leak into parse 2', () => {
    const a = parseSequenceDgmo(`sequence
Alice is an actor as al
al -hi-> Bob`);
    expect(a.messages[0].from).toBe('Alice');

    // Second parse with NO alias declaration — same alias literal
    // `al` should be treated as a literal name, not resolved to
    // `Alice` from the previous parse.
    const b = parseSequenceDgmo(`sequence
al -hi-> Bob`);
    expect(b.messages[0].from).toBe('al');
    expect(b.messages[0].to).toBe('Bob');
  });

  it('two parses with differently-bound aliases do not interfere', () => {
    const a = parseSequenceDgmo(`sequence
Alice is an actor as x
x -hi-> Bob`);
    const b = parseSequenceDgmo(`sequence
Carol is an actor as x
x -hi-> Dan`);
    expect(a.messages[0].from).toBe('Alice');
    expect(b.messages[0].from).toBe('Carol');
  });

  it('repeating the same parse is idempotent', () => {
    const source = `sequence
Alice is an actor as a
a -hi-> Bob`;
    const a = parseSequenceDgmo(source);
    const b = parseSequenceDgmo(source);
    expect(a.messages[0].from).toBe(b.messages[0].from);
    expect(a.diagnostics).toEqual(b.diagnostics);
  });
});
