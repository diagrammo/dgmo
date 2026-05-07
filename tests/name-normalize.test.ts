import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  displayName,
  getOrCreateName,
  bindAlias,
  createAliasMap,
  createParseContext,
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

// ============================================================
// AliasMap + alias-aware getOrCreateName (TD-18)
// ============================================================

describe('AliasMap — bindAlias', () => {
  it('binds an alias to its canonical entry', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    const { entry } = getOrCreateName('Product Manager', nameStore, 1);
    const result = bindAlias('pm', entry, aliasMap, nameStore);
    expect(result.bound).toEqual({ alias: 'pm', entry });
    expect(aliasMap.get('pm')).toBe(entry);
  });

  it('detects collision when same alias binds to a different canonical', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    const { entry: pm } = getOrCreateName('Product Manager', nameStore, 1);
    const { entry: prj } = getOrCreateName('Project Manager', nameStore, 4);
    bindAlias('pm', pm, aliasMap, nameStore);
    const result = bindAlias('pm', prj, aliasMap, nameStore);
    expect(result.conflict?.kind).toBe('collision');
    if (result.conflict?.kind === 'collision') {
      expect(result.conflict.existingEntry).toBe(pm);
    }
  });

  it('detects rebinding when same canonical gets a different alias', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    const { entry } = getOrCreateName('Product Manager', nameStore, 1);
    bindAlias('pm', entry, aliasMap, nameStore);
    const result = bindAlias('boss', entry, aliasMap, nameStore);
    expect(result.conflict?.kind).toBe('rebinding');
    if (result.conflict?.kind === 'rebinding') {
      expect(result.conflict.existingAlias).toBe('pm');
    }
  });

  it('detects shadows-name when alias literal collides with an existing canonical', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    getOrCreateName('Bar', nameStore, 1);
    const { entry } = getOrCreateName('Foo', nameStore, 2);
    const result = bindAlias('Bar', entry, aliasMap, nameStore);
    expect(result.conflict?.kind).toBe('shadows-name');
  });

  it('treats `pm` and `PM` as distinct alias tokens (case-sensitive)', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    const { entry: a } = getOrCreateName('Product Manager', nameStore, 1);
    const { entry: b } = getOrCreateName('Project Manager', nameStore, 2);
    expect(bindAlias('pm', a, aliasMap, nameStore).bound).toBeDefined();
    expect(bindAlias('PM', b, aliasMap, nameStore).bound).toBeDefined();
    expect(aliasMap.get('pm')).toBe(a);
    expect(aliasMap.get('PM')).toBe(b);
  });

  it('idempotent re-binding (alias→entry already exists) succeeds silently', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    const { entry } = getOrCreateName('Product Manager', nameStore, 1);
    bindAlias('pm', entry, aliasMap, nameStore);
    const result = bindAlias('pm', entry, aliasMap, nameStore);
    expect(result.bound).toBeDefined();
    expect(result.conflict).toBeUndefined();
  });
});

describe('getOrCreateName — alias-aware resolution', () => {
  it('alias and canonical resolve to the same NameEntry (F7)', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    const { entry } = getOrCreateName('Product Manager', nameStore, 1);
    bindAlias('pm', entry, aliasMap, nameStore);
    const aliasHit = getOrCreateName('pm', nameStore, 5, aliasMap);
    const canonicalHit = getOrCreateName(
      'Product Manager',
      nameStore,
      6,
      aliasMap
    );
    expect(aliasHit.entry).toBe(entry);
    expect(canonicalHit.entry).toBe(entry);
    expect(aliasHit.entry.normalizedKey).toBe(canonicalHit.entry.normalizedKey);
  });

  it('Unicode canonical with ASCII alias (`Цена as p`) resolves identically (M5)', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    const { entry } = getOrCreateName('Цена', nameStore, 1);
    bindAlias('p', entry, aliasMap, nameStore);
    const aliasHit = getOrCreateName('p', nameStore, 2, aliasMap);
    const canonicalHit = getOrCreateName('Цена', nameStore, 3, aliasMap);
    expect(aliasHit.entry).toBe(entry);
    expect(canonicalHit.entry).toBe(entry);
  });

  it('alias resolution is case-sensitive (`pm` ≠ `PM`)', () => {
    const nameStore = new Map<string, NameEntry>();
    const aliasMap = createAliasMap();
    const { entry } = getOrCreateName('Product Manager', nameStore, 1);
    bindAlias('PM', entry, aliasMap, nameStore);
    // `pm` is NOT in the alias map; falls through to UNH.
    const result = getOrCreateName('pm', nameStore, 2, aliasMap);
    // Falls through and creates a brand-new entity since `pm`
    // doesn't normalize to anything existing.
    expect(result.entry).not.toBe(entry);
    expect(result.created).toBe(true);
  });
});

describe('createParseContext — fresh state per parse (C8)', () => {
  it('returns independent context objects with empty maps', () => {
    const ctx1 = createParseContext();
    const ctx2 = createParseContext();
    expect(ctx1.nameStore).not.toBe(ctx2.nameStore);
    expect(ctx1.nameAliasMap).not.toBe(ctx2.nameAliasMap);
    expect(ctx1.diagnostics).not.toBe(ctx2.diagnostics);
    expect(ctx1.nameAliasMap.size).toBe(0);
  });
});
