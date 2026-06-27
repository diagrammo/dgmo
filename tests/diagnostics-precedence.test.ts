import { describe, it, expect } from 'vitest';
import { extractAlias } from '../src/utils/extract-alias';
import type { DgmoError } from '../src/diagnostics';

// ============================================================
// Diagnostic precedence (Q3 / C1)
// ============================================================
//
// Locks the C1 rule: when one source line could trigger multiple
// alias-related diagnostics, the most-specific one wins (single
// emission per line).
//
// Priority bands (highest first):
//   1. Alias-format codes (ALIAS_RESERVED_KEYWORD outranks ALIAS_INVALID_FORMAT)
//   2. Alias-semantic codes (BEFORE_DECL, COLLISION, REBINDING, …)

describe('diagnostic precedence — reserved outranks invalid-format', () => {
  it('`Alice as as` fires RESERVED_KEYWORD (not INVALID_FORMAT, even though both could apply)', () => {
    // `as` passes the format regex but is reserved.
    const sink: DgmoError[] = [];
    extractAlias('Alice as as', { lineNumber: 1, diagnostics: sink });
    expect(sink).toHaveLength(1);
    expect(sink[0].code).toBe('E_ALIAS_RESERVED_KEYWORD');
  });

  it('`Alice as flowchart` fires RESERVED_KEYWORD (chart-type token)', () => {
    const sink: DgmoError[] = [];
    extractAlias('Alice as flowchart', { lineNumber: 1, diagnostics: sink });
    expect(sink).toHaveLength(1);
    expect(sink[0].code).toBe('E_ALIAS_RESERVED_KEYWORD');
  });
});

describe('diagnostic precedence — single emission per line', () => {
  it('extract-alias never emits both RESERVED and INVALID_FORMAT', () => {
    const sink: DgmoError[] = [];
    // `Alice as as` — `as` is reserved AND well-formed → reserved wins, not both.
    extractAlias('Alice as as', { lineNumber: 1, diagnostics: sink });
    const codes = sink.map((d) => d.code);
    expect(codes).toEqual(['E_ALIAS_RESERVED_KEYWORD']);
  });

  it('extract-alias emits exactly one INVALID_FORMAT for `Alice as 1pm`', () => {
    const sink: DgmoError[] = [];
    extractAlias('Alice as 1pm', { lineNumber: 1, diagnostics: sink });
    const codes = sink.map((d) => d.code);
    expect(codes).toEqual(['E_ALIAS_INVALID_FORMAT']);
  });
});
