import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  displayName,
  getOrCreateName,
  type NameEntry,
} from '../src/utils/name-normalize';

// ============================================================
// normalizeName — pinned algorithm
// ============================================================

describe('normalizeName — basics', () => {
  it('lowercases ASCII', () => {
    expect(normalizeName('Auth Service')).toBe('auth service');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeName('  Cache  ')).toBe('cache');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeName('Auth   Service')).toBe('auth service');
    expect(normalizeName('A\t\tB')).toBe('a b');
    expect(normalizeName('A \t B')).toBe('a b');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeName('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeName('   \t  ')).toBe('');
  });

  it('is idempotent', () => {
    const samples = [
      'Auth Service',
      '  ALICE  ',
      'Café',
      ' Auth　Service ',
      'AUTH\t\tSERVICE',
    ];
    for (const s of samples) {
      expect(normalizeName(normalizeName(s))).toBe(normalizeName(s));
    }
  });
});

// ============================================================
// Unicode whitespace handling
// ============================================================

describe('normalizeName — Unicode whitespace', () => {
  it('collapses no-break space (U+00A0)', () => {
    expect(normalizeName('Auth Service')).toBe('auth service');
  });

  it('collapses ideographic space (U+3000)', () => {
    expect(normalizeName('Auth　Service')).toBe('auth service');
  });

  it('collapses mixed whitespace runs', () => {
    expect(normalizeName('Auth \t　 Service')).toBe('auth service');
  });

  it('trims Unicode whitespace from edges', () => {
    expect(normalizeName(' 　Cache ')).toBe('cache');
  });

  it('preserves zero-width joiner (U+200D — not whitespace)', () => {
    // ZWJ is grapheme glue (e.g. emoji families) — must not be stripped.
    const zwj = 'A‍B';
    expect(normalizeName(zwj)).toBe('a‍b');
  });
});

// ============================================================
// Unicode normalization (NFC vs NFD)
// ============================================================

describe('normalizeName — Unicode normalization', () => {
  it('treats NFC and NFD forms as equal', () => {
    const nfc = 'Café'; // é as single codepoint
    const nfd = 'Café'; // e + combining acute
    expect(normalizeName(nfc)).toBe(normalizeName(nfd));
  });

  it('NFC equality survives lowercasing', () => {
    const nfc = 'CAFÉ'; // É single codepoint
    const nfd = 'CAFÉ'; // E + combining acute
    expect(normalizeName(nfc)).toBe(normalizeName(nfd));
    expect(normalizeName(nfc)).toBe('café');
  });
});

// ============================================================
// Locale-sensitive case folding
// ============================================================

describe('normalizeName — locale-sensitive case folding', () => {
  // Turkish dotted/dotless I — en-US locale gives stable, language-
  // neutral results (Turkish locale would collapse 'İ' to bare 'i'
  // and silently merge with ASCII 'i', a footgun across environments).
  it('lowercases Turkish capital dotted I to i + combining dot', () => {
    // 'İ' (U+0130) → 'i' + U+0307 in en-US lowercase
    expect(normalizeName('İ')).toBe('i̇');
  });

  it('preserves Turkish dotless i', () => {
    expect(normalizeName('ı')).toBe('ı');
  });

  it('lowercases capital sharp S (ẞ) to ß', () => {
    // U+1E9E LATIN CAPITAL LETTER SHARP S
    expect(normalizeName('STRAẞE')).toBe('straße');
  });

  it('leaves lowercase ß alone', () => {
    expect(normalizeName('Straße')).toBe('straße');
  });
});

// ============================================================
// Surrogate pair / emoji safety
// ============================================================

describe('normalizeName — surrogate pairs', () => {
  it('preserves emoji codepoints', () => {
    expect(normalizeName('Project 🚀 Apollo')).toBe('project 🚀 apollo');
  });

  it('preserves ZWJ-joined emoji (family glyph)', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    expect(normalizeName(`Team ${family}`)).toBe(`team ${family}`);
  });

  it('does not split surrogate pairs across whitespace collapse', () => {
    expect(normalizeName('🚀 🛰')).toBe('🚀 🛰');
  });
});

// ============================================================
// displayName — first-seen casing/spacing
// ============================================================

describe('displayName', () => {
  it('preserves casing', () => {
    expect(displayName('Auth Service')).toBe('Auth Service');
  });

  it('preserves internal whitespace runs verbatim (first-seen spacing wins)', () => {
    expect(displayName('Auth   Service')).toBe('Auth   Service');
  });

  it('trims edges', () => {
    expect(displayName('  Cache  ')).toBe('Cache');
  });

  it('NFC-normalizes', () => {
    const nfd = 'Café';
    expect(displayName(nfd)).toBe('Café');
  });
});

// ============================================================
// getOrCreateName — store interaction
// ============================================================

describe('getOrCreateName', () => {
  it('creates a new entry on first sighting', () => {
    const store = new Map<string, NameEntry>();
    const result = getOrCreateName('Auth Service', store, 5);
    expect(result.created).toBe(true);
    expect(result.merged).toBeUndefined();
    expect(result.entry.normalizedKey).toBe('auth service');
    expect(result.entry.displayLabel).toBe('Auth Service');
    expect(result.entry.declaredLine).toBe(5);
    expect(store.size).toBe(1);
  });

  it('returns the existing entry on identical re-declaration without merge', () => {
    const store = new Map<string, NameEntry>();
    getOrCreateName('Auth Service', store, 5);
    const second = getOrCreateName('Auth Service', store, 12);
    expect(second.created).toBe(false);
    expect(second.merged).toBeUndefined();
    expect(second.entry.declaredLine).toBe(5); // first-seen line wins
  });

  it('reports merge when casing differs', () => {
    const store = new Map<string, NameEntry>();
    getOrCreateName('Auth Service', store, 4);
    const merged = getOrCreateName('auth service', store, 12);
    expect(merged.created).toBe(false);
    expect(merged.merged).toEqual({
      existingLine: 4,
      existingDisplay: 'Auth Service',
      incomingDisplay: 'auth service',
    });
    expect(merged.entry.displayLabel).toBe('Auth Service');
  });

  it('reports merge when whitespace differs', () => {
    const store = new Map<string, NameEntry>();
    getOrCreateName('Auth Service', store, 4);
    const merged = getOrCreateName('Auth  Service', store, 7);
    expect(merged.merged).toBeDefined();
    expect(merged.merged?.existingDisplay).toBe('Auth Service');
    expect(merged.merged?.incomingDisplay).toBe('Auth  Service');
  });

  it('reports merge across NFC/NFD divergence', () => {
    const store = new Map<string, NameEntry>();
    getOrCreateName('Café', store, 1); // NFC
    const merged = getOrCreateName('Café', store, 2); // NFD
    expect(merged.created).toBe(false);
    // displayName NFC-normalizes, so the incoming display is also 'Café'
    expect(merged.merged).toBeUndefined();
  });

  it('preserves first-seen casing across multiple lookups', () => {
    const store = new Map<string, NameEntry>();
    getOrCreateName('AUTH SERVICE', store, 1);
    getOrCreateName('Auth Service', store, 2);
    getOrCreateName('auth service', store, 3);
    expect(store.size).toBe(1);
    const entry = store.get('auth service')!;
    expect(entry.displayLabel).toBe('AUTH SERVICE');
    expect(entry.declaredLine).toBe(1);
  });

  it('treats NBSP-separated and space-separated as the same entity', () => {
    const store = new Map<string, NameEntry>();
    getOrCreateName('Order Service', store, 1);
    const second = getOrCreateName('Order Service', store, 2);
    expect(second.created).toBe(false);
    expect(store.size).toBe(1);
  });
});
