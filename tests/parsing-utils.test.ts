import { describe, it, expect } from 'vitest';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  OPTION_NOCOLON_RE,
  COLOR_SUFFIX_RE,
  ALL_CHART_TYPES,
  parseFirstLine,
  prescanOptions,
  normalizeNumericToken,
  stripQuotes,
  tokenizeQuoteAware,
} from '../src/utils/parsing';

describe('measureIndent', () => {
  it('counts spaces', () => expect(measureIndent('    hello')).toBe(4));
  it('counts tabs as 4', () => expect(measureIndent('\thello')).toBe(4));
  it('handles mixed', () => expect(measureIndent('  \tx')).toBe(6));
  it('returns 0 for no indent', () => expect(measureIndent('hello')).toBe(0));
  it('returns 0 for empty string', () => expect(measureIndent('')).toBe(0));
});

describe('extractColor', () => {
  it('extracts trailing color suffix', () => {
    const r = extractColor('Server (red)');
    expect(r.label).toBe('Server');
    expect(r.color).toBeDefined();
  });
  it('returns label unchanged when no suffix', () => {
    expect(extractColor('NoColor')).toEqual({ label: 'NoColor' });
  });
});

describe('parsePipeMetadata', () => {
  it('parses key:value pairs from single pipe segment', () => {
    const m = parsePipeMetadata(['Name', 'role: Dev, loc: NY']);
    expect(m).toEqual({ role: 'Dev', loc: 'NY' });
  });
  it('applies aliasMap', () => {
    const aliases = new Map([['r', 'role']]);
    const m = parsePipeMetadata(['X', 'r: Dev'], aliases);
    expect(m).toEqual({ role: 'Dev' });
  });
  it('handles comma-separated within a segment', () => {
    const m = parsePipeMetadata(['X', 'a: 1, b: 2']);
    expect(m).toEqual({ a: '1', b: '2' });
  });
  it('errors when more than one pipe segment is present', () => {
    let errored = false;
    const m = parsePipeMetadata(
      ['Name', 'role: Dev', 'loc: NY'],
      new Map(),
      () => {
        errored = true;
      }
    );
    expect(errored).toBe(true);
    expect(m).toEqual({});
  });
  it('does not error for single pipe segment', () => {
    let errored = false;
    parsePipeMetadata(['Name', 'role: Dev, loc: NY'], new Map(), () => {
      errored = true;
    });
    expect(errored).toBe(false);
  });
});

describe('header regexes', () => {
  it('COLOR_SUFFIX_RE matches trailing parens', () => {
    expect('Label (blue)'.match(COLOR_SUFFIX_RE)?.[1]).toBe('blue');
  });
});

// ── New syntax utilities ─────────────────────────────────────

describe('ALL_CHART_TYPES', () => {
  it('contains all expected chart types', () => {
    expect(ALL_CHART_TYPES.has('gantt')).toBe(true);
    expect(ALL_CHART_TYPES.has('sequence')).toBe(true);
    expect(ALL_CHART_TYPES.has('bar')).toBe(true);
    expect(ALL_CHART_TYPES.has('scatter')).toBe(true);
    expect(ALL_CHART_TYPES.has('unknown')).toBe(false);
  });

  it('covers every id registered in chart-types.ts', async () => {
    // Drift guard: chart-types.ts is the canonical registry. Anything
    // listed there must be a valid first-line token, otherwise users
    // following AI suggestions get an "expected chart type X" error.
    const { chartTypes } = await import('../src/chart-types');
    const missing = chartTypes
      .map((c) => c.id)
      .filter((id) => !ALL_CHART_TYPES.has(id));
    expect(
      missing,
      `chart-types.ts ids missing from ALL_CHART_TYPES: ${missing.join(', ')}`
    ).toEqual([]);
  });
});

describe('OPTION_NOCOLON_RE', () => {
  it('matches space-separated key value', () => {
    const m = 'direction LR'.match(OPTION_NOCOLON_RE);
    expect(m?.[1]).toBe('direction');
    expect(m?.[2]).toBe('LR');
  });
  it('matches hyphenated keys', () => {
    const m = 'sub-node-label Team'.match(OPTION_NOCOLON_RE);
    expect(m?.[1]).toBe('sub-node-label');
    expect(m?.[2]).toBe('Team');
  });
  it('does not match bare keywords (no value)', () => {
    expect('critical-path'.match(OPTION_NOCOLON_RE)).toBeNull();
  });
  it('does not match lines starting with numbers', () => {
    expect('10bd Database Schema'.match(OPTION_NOCOLON_RE)).toBeNull();
  });
});

describe('parseFirstLine', () => {
  it('extracts chart type and title from new syntax', () => {
    const r = parseFirstLine('gantt Product Launch 2026');
    expect(r).toEqual({ chartType: 'gantt', title: 'Product Launch 2026' });
  });

  it('extracts chart type without title', () => {
    const r = parseFirstLine('sequence');
    expect(r).toEqual({ chartType: 'sequence', title: undefined });
  });

  it('handles case-insensitive chart types', () => {
    const r = parseFirstLine('Gantt My Title');
    expect(r).toEqual({ chartType: 'gantt', title: 'My Title' });
  });

  it('handles hyphenated chart types', () => {
    const r = parseFirstLine('boxes-and-lines Dashboard');
    expect(r).toEqual({ chartType: 'boxes-and-lines', title: 'Dashboard' });
  });

  it('returns null for unknown first token', () => {
    expect(parseFirstLine('unknown thing')).toBeNull();
  });

  it('returns null for empty/comment lines', () => {
    expect(parseFirstLine('')).toBeNull();
    expect(parseFirstLine('   ')).toBeNull();
    expect(parseFirstLine('// comment')).toBeNull();
  });

  it('returns null for old chart: syntax (no longer supported)', () => {
    expect(parseFirstLine('chart: gantt')).toBeNull();
    expect(parseFirstLine('chart: bar')).toBeNull();
  });

  it('extracts multi-line chart type', () => {
    expect(parseFirstLine('multi-line')).toEqual({
      chartType: 'multi-line',
      title: undefined,
    });
  });

  it('extracts bar-stacked with title', () => {
    expect(parseFirstLine('bar-stacked Revenue by Quarter')).toEqual({
      chartType: 'bar-stacked',
      title: 'Revenue by Quarter',
    });
  });
});

describe('prescanOptions', () => {
  const knownOptions = new Set([
    'direction',
    'start',
    'notation',
    'sort',
    'today-marker',
  ]);
  const knownBooleans = new Set([
    'critical-path',
    'dependencies',
    'animate',
    'today-marker',
  ]);

  it('collects key-value options from non-indented lines', () => {
    const lines = [
      'gantt Product Launch',
      'direction LR',
      'start 2026-04-01',
      '',
      '  10bd Database Schema',
    ];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.options).toEqual({ direction: 'LR', start: '2026-04-01' });
  });

  it('collects presence-based booleans', () => {
    const lines = ['gantt', 'critical-path', '10bd Task'];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.booleans.has('critical-path')).toBe(true);
  });

  it('collects negated booleans', () => {
    const lines = ['gantt', 'no-dependencies', '10bd Task'];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.negated.has('dependencies')).toBe(true);
  });

  it('skips comment lines', () => {
    const lines = ['gantt', '// direction LR', 'start 2026-01-01'];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.options.direction).toBeUndefined();
    expect(result.options.start).toBe('2026-01-01');
  });

  it('strips inline comments from option values', () => {
    const lines = ['direction LR // override default'];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.options.direction).toBe('LR');
  });

  it('skips indented lines', () => {
    const lines = ['gantt', '  direction LR'];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.options.direction).toBeUndefined();
  });

  it('handles boolean with value (e.g., today-marker 2026-03-26)', () => {
    const lines = ['today-marker 2026-03-26'];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.booleans.has('today-marker')).toBe(true);
    expect(result.options['today-marker']).toBe('2026-03-26');
  });

  it('options can appear anywhere in the file', () => {
    const lines = [
      'gantt Title',
      '',
      '[Planning]',
      '  10bd Task A',
      '',
      'direction LR',
      '',
      '[Development]',
      '  20bd Task B',
    ];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.options.direction).toBe('LR');
  });

  it('ignores unknown bare keywords', () => {
    const lines = ['gantt', 'unknown-thing'];
    const result = prescanOptions(lines, knownOptions, knownBooleans);
    expect(result.booleans.size).toBe(0);
    expect(result.negated.size).toBe(0);
  });
});

describe('normalizeNumericToken', () => {
  it('normalizes comma-grouped integers', () => {
    expect(normalizeNumericToken('1,000')).toBe('1000');
    expect(normalizeNumericToken('1,087')).toBe('1087');
    expect(normalizeNumericToken('1,234,567')).toBe('1234567');
    expect(normalizeNumericToken('10,000')).toBe('10000');
    expect(normalizeNumericToken('100,000,000')).toBe('100000000');
  });

  it('normalizes comma-grouped decimals', () => {
    expect(normalizeNumericToken('1,234.56')).toBe('1234.56');
    expect(normalizeNumericToken('1,000,000.99')).toBe('1000000.99');
  });

  it('normalizes underscore-separated integers', () => {
    expect(normalizeNumericToken('1_000')).toBe('1000');
    expect(normalizeNumericToken('1_234_567')).toBe('1234567');
    expect(normalizeNumericToken('10_00_000')).toBe('1000000');
  });

  it('normalizes underscore-separated decimals', () => {
    expect(normalizeNumericToken('1_234.56')).toBe('1234.56');
    expect(normalizeNumericToken('1_000_000.5')).toBe('1000000.5');
  });

  it('handles negative numbers', () => {
    expect(normalizeNumericToken('-1,000')).toBe('-1000');
    expect(normalizeNumericToken('-1_000')).toBe('-1000');
    expect(normalizeNumericToken('-1,234.56')).toBe('-1234.56');
    expect(normalizeNumericToken('-1_234.56')).toBe('-1234.56');
  });

  it('returns null for no separators (passthrough)', () => {
    expect(normalizeNumericToken('1000')).toBeNull();
    expect(normalizeNumericToken('3.14')).toBeNull();
    expect(normalizeNumericToken('-42')).toBeNull();
  });

  it('rejects invalid comma grouping', () => {
    expect(normalizeNumericToken('1,00')).toBeNull();
    expect(normalizeNumericToken('1,08,7')).toBeNull();
    expect(normalizeNumericToken('1,0877')).toBeNull();
    expect(normalizeNumericToken(',087')).toBeNull();
    expect(normalizeNumericToken('1,')).toBeNull();
    expect(normalizeNumericToken('1,,000')).toBeNull();
  });

  it('rejects invalid underscore placement', () => {
    expect(normalizeNumericToken('_1000')).toBeNull();
    expect(normalizeNumericToken('1000_')).toBeNull();
  });

  it('rejects mixed separators', () => {
    expect(normalizeNumericToken('1_000,000')).toBeNull();
    expect(normalizeNumericToken('1,000_000')).toBeNull();
  });

  it('rejects underscore in decimal part', () => {
    expect(normalizeNumericToken('1_000.5_6')).toBeNull();
  });

  it('handles edge cases', () => {
    expect(normalizeNumericToken('')).toBeNull();
    expect(normalizeNumericToken('abc')).toBeNull();
  });
});

describe('stripQuotes', () => {
  it('strips double quotes', () => {
    expect(stripQuotes('"hello"')).toBe('hello');
  });
  it('strips single quotes', () => {
    expect(stripQuotes("'hello'")).toBe('hello');
  });
  it('does not strip mismatched quotes', () => {
    expect(stripQuotes('"hello\'')).toBe('"hello\'');
  });
  it('returns original for unquoted strings', () => {
    expect(stripQuotes('hello')).toBe('hello');
  });
  it('handles empty quoted string', () => {
    expect(stripQuotes('""')).toBe('');
  });
  it('handles single-char string (not quoted)', () => {
    expect(stripQuotes('"')).toBe('"');
  });
});

describe('tokenizeQuoteAware', () => {
  it('splits simple whitespace-separated tokens', () => {
    expect(tokenizeQuoteAware('tag Priority p')).toEqual([
      'tag',
      'Priority',
      'p',
    ]);
  });
  it('keeps double-quoted substrings as single token', () => {
    expect(tokenizeQuoteAware('tag "Marketing mktg" p')).toEqual([
      'tag',
      '"Marketing mktg"',
      'p',
    ]);
  });
  it('keeps single-quoted substrings as single token', () => {
    expect(tokenizeQuoteAware("tag 'Risk Level' lo")).toEqual([
      'tag',
      "'Risk Level'",
      'lo',
    ]);
  });
  it('handles mixed quotes', () => {
    expect(tokenizeQuoteAware('"A Team" at')).toEqual(['"A Team"', 'at']);
  });
  it('handles empty input', () => {
    expect(tokenizeQuoteAware('')).toEqual([]);
  });
  it('handles only whitespace', () => {
    expect(tokenizeQuoteAware('   ')).toEqual([]);
  });
  it('handles unclosed quote (takes rest of string)', () => {
    expect(tokenizeQuoteAware('"unclosed string')).toEqual([
      '"unclosed string',
    ]);
  });
});
