import { describe, it, expect } from 'vitest';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  CHART_TYPE_RE,
  TITLE_RE,
  OPTION_RE,
  COLOR_SUFFIX_RE,
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
  it('parses key:value pairs from pipe segments', () => {
    const m = parsePipeMetadata(['Name', 'role: Dev', 'loc: NY']);
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
  it('treats multiple pipes as commas (backward compat)', () => {
    const m = parsePipeMetadata(['Name', 'role: Dev', 'loc: NY']);
    expect(m).toEqual({ role: 'Dev', loc: 'NY' });
  });
  it('warns when more than one pipe segment is present', () => {
    let warned = false;
    parsePipeMetadata(['Name', 'role: Dev', 'loc: NY'], new Map(), () => { warned = true; });
    expect(warned).toBe(true);
  });
  it('does not warn for single pipe segment', () => {
    let warned = false;
    parsePipeMetadata(['Name', 'role: Dev, loc: NY'], new Map(), () => { warned = true; });
    expect(warned).toBe(false);
  });
});

describe('header regexes', () => {
  it('CHART_TYPE_RE matches chart headers', () => {
    expect('chart: org'.match(CHART_TYPE_RE)?.[1]).toBe('org');
  });
  it('TITLE_RE matches title headers', () => {
    expect('title: My Title'.match(TITLE_RE)?.[1]).toBe('My Title');
  });
  it('OPTION_RE matches option headers', () => {
    const m = 'direction: lr'.match(OPTION_RE);
    expect(m?.[1]).toBe('direction');
    expect(m?.[2]).toBe('lr');
  });
  it('COLOR_SUFFIX_RE matches trailing parens', () => {
    expect('Label (blue)'.match(COLOR_SUFFIX_RE)?.[1]).toBe('blue');
  });
});
