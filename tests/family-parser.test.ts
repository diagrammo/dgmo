import { describe, it, expect } from 'vitest';
import { parseFamily } from '../src/family/parser';

const codes = (src: string): string[] =>
  parseFamily(src).diagnostics.map((d) => d.code ?? '');

describe('family parser — happy path (AC1)', () => {
  it('parses a union line with year + two children, zero diagnostics', () => {
    const p = parseFamily(`family
Anne + Jack m: 1701
  Carol
  Dave`);
    expect(p.diagnostics).toHaveLength(0);
    expect(p.error).toBeFalsy();
    expect(p.unions).toHaveLength(1);
    const u = p.unions[0]!;
    expect(u.parents).toHaveLength(2);
    expect(u.metadata['m']).toBe('1701');
    expect(u.children.map((c) => c.personId)).toEqual(['carol', 'dave']);
  });

  it('merges a standalone person declaration into the union reference (one card)', () => {
    const p = parseFamily(`family
Anne b: 1665, sex: f
Anne + Jack m: 1701
  Carol`);
    expect(p.persons.size).toBe(3); // Anne, Jack, Carol
    const anne = p.persons.get('anne')!;
    expect(anne.sex).toBe('f');
    expect(anne.metadata['b']).toBe('1665');
    expect(p.unions[0]!.parents).toContain('anne');
  });
});

describe('family parser — structure variants', () => {
  it('remarriage: one person, two unions', () => {
    const p = parseFamily(`family
Alice + Bob
  Carol
Carol + Evan
  Frank`);
    expect(p.persons.has('carol')).toBe(true);
    expect(p.unions).toHaveLength(2);
    // Carol is a child of union 0 and a parent of union 1.
    expect(p.unions[0]!.children.map((c) => c.personId)).toContain('carol');
    expect(p.unions[1]!.parents).toContain('carol');
  });

  it('single parent: lone person line with indented children', () => {
    const p = parseFamily(`family
Mary sex: f
  Tom
  Sue`);
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(p.unions).toHaveLength(1);
    expect(p.unions[0]!.parents).toEqual(['mary']);
    expect(p.unions[0]!.children).toHaveLength(2);
  });

  it('bare `adopted` marks the child, not the name', () => {
    const p = parseFamily(`family
Alice + Bob
  Carol adopted
  Dave`);
    const u = p.unions[0]!;
    expect(p.persons.has('carol')).toBe(true);
    expect(p.persons.has('carol adopted')).toBe(false);
    expect(u.children.find((c) => c.personId === 'carol')!.adopted).toBe(true);
    expect(u.children.find((c) => c.personId === 'dave')!.adopted).toBe(false);
  });

  it('a quoted "Adopted" survives as a name', () => {
    const p = parseFamily(`family
Alice + Bob
  "Adopted"`);
    expect(p.persons.has('adopted')).toBe(true);
    expect(p.unions[0]!.children[0]!.adopted).toBe(false);
  });
});

describe('family parser — union split edge cases (AC8b)', () => {
  it('` + ` inside a quoted name is one person', () => {
    const p = parseFamily(`family
"Anne + Jack" + Bob`);
    expect(
      codes(`family
"Anne + Jack" + Bob`)
    ).not.toContain('E_FAMILY_TOO_MANY_PARENTS');
    expect(p.persons.has('anne + jack')).toBe(true);
    expect(p.unions[0]!.parents).toHaveLength(2);
  });

  it('` + ` inside a union metadata value does not split parents', () => {
    const src = `family
Bob + Sue m: 1701 note: eloped + reconciled`;
    expect(codes(src)).not.toContain('E_FAMILY_TOO_MANY_PARENTS');
    const p = parseFamily(src);
    expect(p.unions[0]!.parents).toHaveLength(2);
  });

  it('tab / multi-space `+` separators split', () => {
    const p = parseFamily('family\nAlice  +  Bob');
    expect(p.unions).toHaveLength(1);
    expect(p.unions[0]!.parents).toEqual(['alice', 'bob']);
  });

  it('`as` alias resolves to the same person', () => {
    const p = parseFamily(`family
Alexander as Alex sex: m
Alex + Bianca`);
    // Alexander declared, then referenced by alias Alex.
    expect(p.persons.has('alexander')).toBe(true);
    expect(p.unions[0]!.parents).toContain('alexander');
  });
});

describe('family parser — malformed union operands (review F1/F2/F3)', () => {
  it('a trailing `+` with a blank side errors and makes no phantom person', () => {
    const p = parseFamily('family\nAnne +');
    expect(p.diagnostics.map((d) => d.code)).toContain(
      'E_FAMILY_MISSING_OPERAND'
    );
    expect(p.persons.has('')).toBe(false);
    expect(p.persons.has('anne')).toBe(true);
  });

  it('a leading `+` errors and makes no phantom person', () => {
    const p = parseFamily('family\n+ Bob');
    expect(p.diagnostics.map((d) => d.code)).toContain(
      'E_FAMILY_MISSING_OPERAND'
    );
    expect(p.persons.has('')).toBe(false);
  });

  it('a doubled `+` drops the blank middle, keeps BOTH real operands', () => {
    const p = parseFamily('family\nA + + B');
    expect(p.diagnostics.map((d) => d.code)).not.toContain(
      'E_FAMILY_TOO_MANY_PARENTS'
    );
    expect(p.persons.has('')).toBe(false);
    expect(p.unions[0]!.parents).toEqual(['a', 'b']); // Bob NOT dropped
  });

  it('an unquoted leading `word:` name is not erased to an empty person', () => {
    const p = parseFamily('family\nDr: Smith + Bob');
    expect(p.persons.has('')).toBe(false);
    expect(p.persons.has('dr: smith')).toBe(true);
  });

  it('color before `adopted` is stored as a RAW name, not a hex', () => {
    const p = parseFamily(`family
Alice + Bob
  Carol red adopted`);
    expect(p.persons.get('carol')!.color).toBe('red');
  });
});

describe('family parser — diagnostics (AC8)', () => {
  it('self-union', () => {
    expect(codes('family\nAnne + Anne')).toContain('E_FAMILY_SELF_UNION');
  });

  it('too many parents', () => {
    expect(codes('family\nA + B + C')).toContain('E_FAMILY_TOO_MANY_PARENTS');
  });

  it('child outside a union', () => {
    expect(codes('family\n  Carol')).toContain('E_FAMILY_CHILD_OUTSIDE_UNION');
  });

  it('unknown metadata key is a warning, not an error', () => {
    const p = parseFamily('family\nAnne favouritecolor: red');
    const d = p.diagnostics.find((x) => x.code === 'W_FAMILY_UNKNOWN_KEY');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(p.error).toBeFalsy();
  });
});

describe('family parser — ancestry cycle (AC8c)', () => {
  it('parent-child union is a fatal cycle', () => {
    const p = parseFamily(`family
Anne + Bob
  Carol
Carol + Anne`);
    expect(p.error).toBeTruthy();
    expect(p.diagnostics.map((d) => d.code)).toContain(
      'E_FAMILY_ANCESTRY_CYCLE'
    );
  });

  it('cousin marriage (pedigree collapse) is NOT a cycle', () => {
    const p = parseFamily(`family
GrandA + GrandB
  ParentX
  ParentY
ParentX + SpouseX
  CousinA
ParentY + SpouseY
  CousinB
CousinA + CousinB
  Child`);
    expect(p.error).toBeFalsy();
    expect(p.diagnostics.map((d) => d.code)).not.toContain(
      'E_FAMILY_ANCESTRY_CYCLE'
    );
  });
});
