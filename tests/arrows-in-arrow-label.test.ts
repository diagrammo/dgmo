import { describe, it, expect } from 'vitest';
import {
  parseInArrowLabel,
  validateLabelCharacters,
  matchColorParens,
  ARROW_DIAGNOSTIC_CODES,
} from '../src/utils/arrows';

describe('parseInArrowLabel', () => {
  describe('TD-8 whitespace', () => {
    it('trims leading and trailing whitespace', () => {
      expect(parseInArrowLabel('   hello   ', 1).label).toBe('hello');
    });
    it('preserves internal whitespace runs (spaces)', () => {
      expect(parseInArrowLabel('foo    bar', 1).label).toBe('foo    bar');
    });
    it('preserves tab (U+0009)', () => {
      expect(parseInArrowLabel('foo\tbar', 1).label).toBe('foo\tbar');
    });
    it('preserves NBSP (U+00A0)', () => {
      expect(parseInArrowLabel('foo\u00A0bar', 1).label).toBe('foo\u00A0bar');
    });
    it('preserves ZWSP (U+200B)', () => {
      expect(parseInArrowLabel('foo\u200Bbar', 1).label).toBe('foo\u200Bbar');
    });
  });

  describe('TD-10 empty label normalization', () => {
    it('returns undefined for empty string', () => {
      expect(parseInArrowLabel('', 1).label).toBeUndefined();
    });
    it('returns undefined for whitespace-only string', () => {
      expect(parseInArrowLabel('   ', 1).label).toBeUndefined();
    });
    it('returns undefined for tab-only string', () => {
      // Current trim implementation strips only space and tab; tab becomes empty.
      expect(parseInArrowLabel('\t', 1).label).toBeUndefined();
    });
  });

  describe('TD-13 forbidden arrow substrings', () => {
    it('rejects -> inside label', () => {
      const r = parseInArrowLabel('uses -> to chain', 5);
      expect(r.label).toBe('uses -> to chain');
      expect(r.diagnostics).toHaveLength(1);
      expect(r.diagnostics[0].code).toBe(
        ARROW_DIAGNOSTIC_CODES.ARROW_SUBSTRING_IN_LABEL
      );
      expect(r.diagnostics[0].line).toBe(5);
      expect(r.diagnostics[0].message).toMatch(/post-colon|arrow/i);
    });
    it('rejects ~> inside label', () => {
      const r = parseInArrowLabel('async ~> chain', 7);
      expect(r.diagnostics[0].code).toBe(
        ARROW_DIAGNOSTIC_CODES.ARROW_SUBSTRING_IN_LABEL
      );
    });
    it('allows `>` alone (not an arrow)', () => {
      expect(parseInArrowLabel('a>b', 1).diagnostics).toHaveLength(0);
    });
    it('allows `-` alone (not an arrow)', () => {
      expect(parseInArrowLabel('a-b', 1).diagnostics).toHaveLength(0);
    });
  });

  describe('TD-14 control characters', () => {
    it('rejects U+0000 NUL', () => {
      const r = parseInArrowLabel('foo\u0000bar', 3);
      expect(r.diagnostics[0].code).toBe(
        ARROW_DIAGNOSTIC_CODES.CONTROL_CHAR_IN_LABEL
      );
      expect(r.diagnostics[0].message).toContain('U+0000');
    });
    it('rejects U+0001', () => {
      const r = parseInArrowLabel('x\u0001y', 1);
      expect(r.diagnostics[0].message).toContain('U+0001');
    });
    it('rejects U+001F', () => {
      const r = parseInArrowLabel('x\u001Fy', 1);
      expect(r.diagnostics[0].message).toContain('U+001F');
    });
    it('rejects U+007F DEL', () => {
      const r = parseInArrowLabel('x\u007Fy', 1);
      expect(r.diagnostics[0].message).toContain('U+007F');
    });
    it('allows U+0009 tab', () => {
      const r = parseInArrowLabel('a\tb', 1);
      expect(r.diagnostics).toHaveLength(0);
      expect(r.label).toBe('a\tb');
    });
  });

  describe('TD-11 color parens (via shared matchColorParens helper)', () => {
    // `parseInArrowLabel` deliberately does NOT implement color-parens
    // recognition — it's a chart-agnostic label validator. Flowchart and
    // state implement TD-11 in `parseArrowToken` using the shared
    // `matchColorParens` helper exported from utils/arrows.ts.
    it('recognizes (red) as a palette color', () => {
      expect(matchColorParens('(red)')).toBe('red');
    });
    it('recognizes all 11 palette colors', () => {
      const all = [
        'red',
        'orange',
        'yellow',
        'green',
        'blue',
        'purple',
        'teal',
        'cyan',
        'gray',
        'black',
        'white',
      ];
      for (const c of all) {
        expect(matchColorParens(`(${c})`)).toBe(c);
      }
    });
    it('returns null for non-palette color names', () => {
      expect(matchColorParens('(notacolor)')).toBeNull();
    });
    it('returns null for mixed content (TD-11 fall-through)', () => {
      expect(matchColorParens('(red) uses')).toBeNull();
    });
    it('is case-insensitive', () => {
      expect(matchColorParens('(RED)')).toBe('red');
      expect(matchColorParens('(Blue)')).toBe('blue');
    });
    it('parseInArrowLabel itself never recognizes color parens', () => {
      // The whole point of the split is: validator doesn't touch color.
      const r = parseInArrowLabel('(red)', 1);
      expect(r.label).toBe('(red)');
      expect((r as { color?: string }).color).toBeUndefined();
    });
  });

  describe('Unicode labels (TD-7)', () => {
    it('preserves non-Latin scripts', () => {
      expect(parseInArrowLabel('café', 1).label).toBe('café');
      expect(parseInArrowLabel('日本語', 1).label).toBe('日本語');
      expect(parseInArrowLabel('한국어', 1).label).toBe('한국어');
      expect(parseInArrowLabel('עברית', 1).label).toBe('עברית');
      expect(parseInArrowLabel('العربية', 1).label).toBe('العربية');
    });
    it('preserves mixed LTR/RTL', () => {
      expect(parseInArrowLabel('hello שלום world', 1).label).toBe(
        'hello שלום world'
      );
    });
    it('preserves emoji and ZWJ sequences', () => {
      expect(parseInArrowLabel('🎉', 1).label).toBe('🎉');
      expect(parseInArrowLabel('👨\u200D👩\u200D👧', 1).label).toBe(
        '👨\u200D👩\u200D👧'
      );
    });
  });

  describe('Happy-path punctuation (TD-1 — plain text)', () => {
    it('passes bracket/brace/paren literals through', () => {
      expect(parseInArrowLabel('location[]', 1).label).toBe('location[]');
      expect(parseInArrowLabel('a[b]c', 1).label).toBe('a[b]c');
      expect(parseInArrowLabel('{json}', 1).label).toBe('{json}');
      expect(parseInArrowLabel('(parenthetical)', 1).label).toBe(
        '(parenthetical)'
      );
    });
    it('passes markdown/html metacharacters through', () => {
      expect(parseInArrowLabel('a|b', 1).label).toBe('a|b');
      expect(parseInArrowLabel('a*b', 1).label).toBe('a*b');
      expect(parseInArrowLabel('a_b', 1).label).toBe('a_b');
      expect(parseInArrowLabel('`code`', 1).label).toBe('`code`');
      expect(parseInArrowLabel('a<b>c', 1).label).toBe('a<b>c');
      expect(parseInArrowLabel('a&b', 1).label).toBe('a&b');
    });
    it('passes general punctuation through', () => {
      for (const s of [
        '"quoted"',
        "'apostrophe'",
        'a,b,c',
        'a;b',
        'a:b',
        'a=b',
        'a+b',
        'a/b',
        'a\\b',
      ]) {
        expect(parseInArrowLabel(s, 1).label).toBe(s);
      }
    });
  });
});

describe('validateLabelCharacters', () => {
  it('returns empty diagnostics for a clean label', () => {
    expect(validateLabelCharacters('hello world', 1)).toEqual([]);
  });
  it('emits both forbidden-substring and control-char diagnostics', () => {
    // Helper emits at most one control-char diagnostic but both classes.
    const ds = validateLabelCharacters('a -> b\u0000c', 1);
    const codes = ds.map((d) => d.code);
    expect(codes).toContain(ARROW_DIAGNOSTIC_CODES.ARROW_SUBSTRING_IN_LABEL);
    expect(codes).toContain(ARROW_DIAGNOSTIC_CODES.CONTROL_CHAR_IN_LABEL);
  });
});
