import { describe, it, expect } from 'vitest';
import { extractAlias, isReservedAliasToken } from '../src/utils/extract-alias';
import type { DgmoError } from '../src/diagnostics';

describe('extractAlias — no-alias branch', () => {
  it('returns the full input as canonical when no `as` postfix is present', () => {
    expect(extractAlias('Alice')).toEqual({ canonical: 'Alice' });
    expect(extractAlias('Auth Service')).toEqual({ canonical: 'Auth Service' });
  });

  it('trims surrounding whitespace on the canonical', () => {
    expect(extractAlias('  Alice  ')).toEqual({ canonical: 'Alice' });
  });

  it('does NOT match SaaS-naming `Storage as a Service` (F2 worked example)', () => {
    expect(extractAlias('Storage as a Service')).toEqual({
      canonical: 'Storage as a Service',
    });
    expect(extractAlias('Backend as a Service')).toEqual({
      canonical: 'Backend as a Service',
    });
    expect(extractAlias('Functions as a Service')).toEqual({
      canonical: 'Functions as a Service',
    });
  });

  it('returns full input when `as` appears mid-line with multiple trailing tokens', () => {
    expect(extractAlias('Alice as a service is fine')).toEqual({
      canonical: 'Alice as a service is fine',
    });
  });

  it('does NOT match when `as` has no trailing token', () => {
    expect(extractAlias('Alice as ')).toEqual({ canonical: 'Alice as' });
  });
});

describe('extractAlias — happy-path', () => {
  it('extracts a single-letter alias', () => {
    expect(extractAlias('Alice as a')).toEqual({
      canonical: 'Alice',
      alias: 'a',
    });
  });

  it('extracts a multi-character alias', () => {
    expect(extractAlias('Product Manager as pm')).toEqual({
      canonical: 'Product Manager',
      alias: 'pm',
    });
  });

  it('preserves color and type modifiers in canonical', () => {
    expect(extractAlias('Alice red is a service as a')).toEqual({
      canonical: 'Alice red is a service',
      alias: 'a',
    });
  });

  it('accepts mixed-case aliases (PM, PmDb)', () => {
    expect(extractAlias('Product Manager as PM')).toEqual({
      canonical: 'Product Manager',
      alias: 'PM',
    });
    expect(extractAlias('Database as DB_v2')).toEqual({
      canonical: 'Database',
      alias: 'DB_v2',
    });
  });

  it('accepts an alias at maximum length (12 chars)', () => {
    expect(extractAlias('Foo as abcdefghijkl')).toEqual({
      canonical: 'Foo',
      alias: 'abcdefghijkl',
    });
  });

  it('handles Unicode canonical names (`Цена as p`)', () => {
    expect(extractAlias('Цена as p')).toEqual({
      canonical: 'Цена',
      alias: 'p',
    });
  });

  it('preserves quoted canonical names verbatim', () => {
    expect(extractAlias('"Storage as a Service" as s3')).toEqual({
      canonical: '"Storage as a Service"',
      alias: 's3',
    });
  });

  it('tolerates trailing pipe metadata (caller may not have stripped)', () => {
    expect(extractAlias('Alice as a | tech: HTTP')).toEqual({
      canonical: 'Alice',
      alias: 'a',
    });
  });
});

describe('extractAlias — invalid format diagnostics', () => {
  it('rejects a digit-start alias', () => {
    const diagnostics: DgmoError[] = [];
    const result = extractAlias('Alice as 1pm', { lineNumber: 7, diagnostics });
    expect(result).toEqual({ canonical: 'Alice as 1pm' });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('E_ALIAS_INVALID_FORMAT');
    expect(diagnostics[0].line).toBe(7);
  });

  it('rejects a hyphenated alias', () => {
    const diagnostics: DgmoError[] = [];
    const result = extractAlias('Alice as pm-cluster', {
      lineNumber: 3,
      diagnostics,
    });
    expect(result).toEqual({ canonical: 'Alice as pm-cluster' });
    expect(diagnostics[0].code).toBe('E_ALIAS_INVALID_FORMAT');
  });

  it('rejects an alias longer than 12 chars', () => {
    const diagnostics: DgmoError[] = [];
    const result = extractAlias('Alice as productmanager2', {
      lineNumber: 1,
      diagnostics,
    });
    expect(result).toEqual({ canonical: 'Alice as productmanager2' });
    expect(diagnostics[0].code).toBe('E_ALIAS_INVALID_FORMAT');
  });

  it('emits no diagnostic when no sink is provided', () => {
    expect(() => extractAlias('Alice as 1pm')).not.toThrow();
  });
});

describe('extractAlias — reserved keyword diagnostics', () => {
  it('rejects `as` as alias', () => {
    const diagnostics: DgmoError[] = [];
    const result = extractAlias('Alice as as', { lineNumber: 5, diagnostics });
    expect(result).toEqual({ canonical: 'Alice as as' });
    expect(diagnostics[0].code).toBe('E_ALIAS_RESERVED_KEYWORD');
  });

  it('rejects `is` as alias', () => {
    const diagnostics: DgmoError[] = [];
    const result = extractAlias('Alice as is', { lineNumber: 1, diagnostics });
    expect(diagnostics[0].code).toBe('E_ALIAS_RESERVED_KEYWORD');
    expect(result.alias).toBeUndefined();
  });

  it('rejects chart-type tokens (`bar`, `flowchart`) as aliases', () => {
    const d1: DgmoError[] = [];
    extractAlias('Alice as bar', { lineNumber: 1, diagnostics: d1 });
    expect(d1[0].code).toBe('E_ALIAS_RESERVED_KEYWORD');

    const d2: DgmoError[] = [];
    extractAlias('Alice as flowchart', { lineNumber: 1, diagnostics: d2 });
    expect(d2[0].code).toBe('E_ALIAS_RESERVED_KEYWORD');
  });

  it('rejects `alias` and `aka` (legacy keywords still reserved)', () => {
    const d1: DgmoError[] = [];
    extractAlias('Alice as alias', { lineNumber: 1, diagnostics: d1 });
    expect(d1[0].code).toBe('E_ALIAS_RESERVED_KEYWORD');

    const d2: DgmoError[] = [];
    extractAlias('Alice as aka', { lineNumber: 1, diagnostics: d2 });
    expect(d2[0].code).toBe('E_ALIAS_RESERVED_KEYWORD');
  });
});

describe('isReservedAliasToken', () => {
  it('reports DGMO grammar keywords as reserved', () => {
    expect(isReservedAliasToken('as')).toBe(true);
    expect(isReservedAliasToken('is')).toBe(true);
    expect(isReservedAliasToken('tag')).toBe(true);
    expect(isReservedAliasToken('alias')).toBe(true);
    expect(isReservedAliasToken('aka')).toBe(true);
  });

  it('reports chart-type tokens as reserved', () => {
    expect(isReservedAliasToken('flowchart')).toBe(true);
    expect(isReservedAliasToken('bar')).toBe(true);
    expect(isReservedAliasToken('venn')).toBe(true);
  });

  it('does NOT reserve English articles — `Alice as a` must work', () => {
    expect(isReservedAliasToken('a')).toBe(false);
    expect(isReservedAliasToken('an')).toBe(false);
    expect(isReservedAliasToken('the')).toBe(false);
  });

  it('does NOT mark ordinary tokens as reserved', () => {
    expect(isReservedAliasToken('pm')).toBe(false);
    expect(isReservedAliasToken('PM')).toBe(false);
    expect(isReservedAliasToken('db')).toBe(false);
  });
});
