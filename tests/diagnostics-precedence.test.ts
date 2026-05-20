import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { parseVisualization } from '../src/d3';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { extractAlias } from '../src/utils/extract-alias';
import { getPalette } from '../src/palettes';
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
//   1. Legacy-syntax codes (TAG_SHORTHAND_REMOVED, VENN_ALIAS_KEYWORD_REMOVED, AKA_REMOVED)
//   2. Alias-format codes (ALIAS_RESERVED_KEYWORD outranks ALIAS_INVALID_FORMAT)
//   3. Alias-semantic codes (BEFORE_DECL, COLLISION, REBINDING, …)

const palette = getPalette('nord').light;

describe('diagnostic precedence — legacy-syntax outranks alias semantics', () => {
  it('venn `Name(color) alias x` fires E_VENN_ALIAS_KEYWORD_REMOVED, not alias collisions', () => {
    const r = parseVisualization(
      `venn
Frontend blue alias fe
Backend green alias fe`,
      palette
    );
    const codes = r.diagnostics.map((d) => d.code);
    // Both lines fire the legacy diagnostic.
    expect(
      codes.filter((c) => c === 'E_VENN_ALIAS_KEYWORD_REMOVED')
    ).toHaveLength(2);
    // No alias-collision is emitted because the legacy form is rejected first.
    expect(codes).not.toContain('E_ALIAS_COLLISION');
  });

  it('infra `tag Name x` fires E_TAG_SHORTHAND_REMOVED on the bare-shorthand form', () => {
    const r = parseInfra(`infra
tag Team t
[Backend]
  API`);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain('E_TAG_SHORTHAND_REMOVED');
  });

  it('sequence `Alice is a service aka X` fires E_AKA_REMOVED, not alias-format', () => {
    const r = parseSequenceDgmo(`sequence
Alice is a service aka Authenticator`);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain('E_AKA_REMOVED');
    // No alias-format diagnostic — `aka` rejection is a strict pre-check.
    expect(codes).not.toContain('E_ALIAS_INVALID_FORMAT');
  });
});

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
