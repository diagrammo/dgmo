import { describe, it, expect } from 'vitest';
import {
  measureIndent,
  extractColor,
  OPTION_NOCOLON_RE,
  ALL_CHART_TYPES,
  parseFirstLine,
  prescanOptions,
  normalizeNumericToken,
  stripQuotes,
  tokenizeQuoteAware,
  peelRampColors,
  detectBadChartTypeDeclaration,
} from '../src/utils/parsing';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseDgmo } from '../src/dgmo-router';

describe('peelRampColors', () => {
  it('peels two trailing colors → low (left) + high (right)', () => {
    expect(peelRampColors('Sales green red')).toEqual({
      label: 'Sales',
      low: 'green',
      high: 'red',
    });
  });
  it('peels one trailing color → high only', () => {
    expect(peelRampColors('Coverage blue')).toEqual({
      label: 'Coverage',
      high: 'blue',
    });
  });
  it('peels nothing when there is no trailing color', () => {
    expect(peelRampColors('Density')).toEqual({ label: 'Density' });
    expect(peelRampColors('Sales 2024')).toEqual({ label: 'Sales 2024' });
  });
  it('respects order (no sorting)', () => {
    expect(peelRampColors('Risk red green')).toEqual({
      label: 'Risk',
      low: 'red',
      high: 'green',
    });
  });
  it('never empties the label — a color-word label survives a 2nd peel', () => {
    expect(peelRampColors('Red blue')).toEqual({ label: 'Red', high: 'blue' });
  });
  it('stops the peel at the first non-color token', () => {
    expect(peelRampColors('Q3 2024 red')).toEqual({
      label: 'Q3 2024',
      high: 'red',
    });
  });
  it('preserves parenthetical label text', () => {
    expect(peelRampColors('Sales ($M) green red')).toEqual({
      label: 'Sales ($M)',
      low: 'green',
      high: 'red',
    });
  });
});

describe('measureIndent', () => {
  it('counts spaces', () => expect(measureIndent('    hello')).toBe(4));
  it('counts tabs as 4', () => expect(measureIndent('\thello')).toBe(4));
  it('handles mixed', () => expect(measureIndent('  \tx')).toBe(6));
  it('returns 0 for no indent', () => expect(measureIndent('hello')).toBe(0));
  it('returns 0 for empty string', () => expect(measureIndent('')).toBe(0));
});

describe('extractColor — trailing-token rule', () => {
  it('extracts trailing color word from single-word + color', () => {
    const r = extractColor('Done green');
    expect(r.label).toBe('Done');
    expect(r.color).toBeDefined();
  });
  it('extracts trailing color word from multi-word label', () => {
    const r = extractColor('Senior Engineer red');
    expect(r.label).toBe('Senior Engineer');
    expect(r.color).toBeDefined();
  });
  it('returns label unchanged when no color word', () => {
    expect(extractColor('NoColor')).toEqual({ label: 'NoColor' });
  });
  it('returns label unchanged for capitalized color word (escape hatch)', () => {
    expect(extractColor('Red')).toEqual({ label: 'Red' });
    expect(extractColor('Status Yellow')).toEqual({ label: 'Status Yellow' });
  });
  it('returns label unchanged on silent typo (no diagnostic)', () => {
    expect(extractColor('Done grren')).toEqual({ label: 'Done grren' });
  });
  it('treats old parens form as literal label text', () => {
    // Hard break: `Done(green)` no longer parses as colored — parens stay literal.
    expect(extractColor('Done(green)')).toEqual({ label: 'Done(green)' });
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

  // The former "covers every id registered in chart-types.ts" drift guard is
  // gone: ALL_CHART_TYPES is now built FROM chart-types.ts, so the two cannot
  // disagree and the test could only assert a tautology. The remaining spot
  // checks above still prove the derivation produced a usable set.
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
    expect(normalizeNumericToken('9495,725')).toBe('9495725');
    expect(normalizeNumericToken('28869,376')).toBe('28869376');
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

// ── Unsupported chart type on line 1 (decision #48 regression) ──────────
//
// #48 made line 1 the title-bearing declaration line for every chart type.
// The unsupported-type branch in parseChart/parseExtendedChart used to fire
// only for a BARE unknown token, so `bubble Empty` parsed as a title-bearing
// declaration of an unsupported type and silently succeeded.

describe('detectBadChartTypeDeclaration', () => {
  const NO_OPTIONS = new Set<string>();

  it('flags a bare unknown chart type', () => {
    expect(detectBadChartTypeDeclaration('bubble', NO_OPTIONS)).toBe('bubble');
  });

  it('flags an unknown chart type carrying a title (#48)', () => {
    expect(detectBadChartTypeDeclaration('bubble Empty', NO_OPTIONS)).toBe(
      'bubble'
    );
    expect(
      detectBadChartTypeDeclaration('squiggle Quarterly Revenue', NO_OPTIONS)
    ).toBe('squiggle');
  });

  it('ignores data rows — a numeric remainder is not a title', () => {
    expect(detectBadChartTypeDeclaration('Apples 30', NO_OPTIONS)).toBeNull();
    expect(
      detectBadChartTypeDeclaration('Alice 165, 60', NO_OPTIONS)
    ).toBeNull();
  });

  it('ignores options, both parser-local and registry directives', () => {
    expect(
      detectBadChartTypeDeclaration('series Revenue', new Set(['series']))
    ).toBeNull();
    // `direction` comes from the shared directives registry.
    expect(
      detectBadChartTypeDeclaration('direction LR', NO_OPTIONS)
    ).toBeNull();
  });

  it('ignores link and container syntax', () => {
    expect(detectBadChartTypeDeclaration('A -> B', NO_OPTIONS)).toBeNull();
    expect(
      detectBadChartTypeDeclaration('[Group Name]', NO_OPTIONS)
    ).toBeNull();
    expect(detectBadChartTypeDeclaration('key: value', NO_OPTIONS)).toBeNull();
  });
});

describe('unsupported chart type surfaces an error', () => {
  it.each([
    ['bare', 'bubble'],
    ['with a title (#48)', 'bubble Empty'],
  ])('parseChart — unsupported type %s', (_label, src) => {
    const result = parseChart(src);
    expect(result.error).toMatch(/Unsupported chart type: bubble/);
  });

  it.each([
    ['bare', 'bubble'],
    ['with a title (#48)', 'bubble Empty'],
  ])('parseExtendedChart — unsupported type %s', (_label, src) => {
    const result = parseExtendedChart(src);
    expect(result.error).toMatch(/Unsupported chart type: bubble/);
  });

  it('keeps a VALID chart type with a title working', () => {
    const chart = parseChart('bar Sales Report\nJan 120\nFeb 200');
    expect(chart.error).toBeNull();
    expect(chart.type).toBe('bar');
    expect(chart.title).toBe('Sales Report');

    const ext = parseExtendedChart('scatter Sales Report\nAlice 165, 60');
    expect(ext.error).toBeNull();
    expect(ext.type).toBe('scatter');
    expect(ext.title).toBe('Sales Report');
  });

  it('does not disturb inference for content with no declaration line', () => {
    // The router infers the type from content patterns when line 1 is not a
    // chart type; an unknown-type error must not pre-empt that.
    expect(parseDgmo('A -> B\nB -> C').chartType).toBe('sequence');
    expect(parseDgmo('A -> B\nB -> C').diagnostics).toHaveLength(0);
    // A declaration-less data table still parses as chart data, not as a
    // botched `Apples` declaration.
    expect(parseChart('Apples 30\nPears 20').error).toBeNull();
  });
});
