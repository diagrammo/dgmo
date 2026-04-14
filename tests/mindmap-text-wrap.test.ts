import { describe, it, expect } from 'vitest';
import { wrapText, computeNodeText } from '../src/mindmap/text-wrap';

describe('wrapText', () => {
  it('short text: single line, original font size', () => {
    const result = wrapText('Hello', 150, 14, 9);
    expect(result.lines).toEqual(['Hello']);
    expect(result.fontSize).toBe(14);
  });

  it('text that fits exactly: no wrapping', () => {
    // 150px width - 16px pad = 134px. At fontSize 14, charWidth ≈ 8.12, maxChars ≈ 16
    const result = wrapText('Short label here', 150, 14, 9);
    expect(result.lines).toHaveLength(1);
    expect(result.fontSize).toBe(14);
  });

  it('long text wraps to multiple lines', () => {
    const result = wrapText(
      'This is a very long label that should wrap',
      150,
      14,
      9
    );
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines.length).toBeLessThanOrEqual(3);
  });

  it('breaks on hyphens', () => {
    const result = wrapText('well-known-fact-about-things', 120, 14, 9);
    expect(result.lines.length).toBeGreaterThan(1);
    // Hyphens should stay with the left word
    const joined = result.lines.join(' ');
    expect(joined).toContain('-');
  });

  it('reduces font size when text cannot fit in max lines', () => {
    const result = wrapText(
      'Extremely long label text that absolutely cannot possibly fit within three lines at normal font size',
      120,
      17,
      9
    );
    expect(result.fontSize).toBeLessThan(17);
    expect(result.fontSize).toBeGreaterThanOrEqual(9);
  });

  it('truncates with ellipsis as last resort', () => {
    // Many words that can't all fit in 3 lines even at min font size
    const veryLong = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const result = wrapText(veryLong, 120, 14, 9, 3);
    expect(result.lines.length).toBeLessThanOrEqual(3);
    expect(result.fontSize).toBe(9);
    const lastLine = result.lines[result.lines.length - 1];
    expect(lastLine).toContain('\u2026');
  });

  it('truncates a single very long token with ellipsis', () => {
    const veryLong = 'A'.repeat(200);
    const result = wrapText(veryLong, 120, 14, 9, 3);
    expect(result.lines.length).toBe(1);
    const lastLine = result.lines[0];
    expect(lastLine).toContain('\u2026');
    expect(lastLine.length).toBeLessThan(200);
  });

  it('empty text returns single empty line', () => {
    const result = wrapText('', 150, 14, 9);
    expect(result.lines).toEqual(['']);
    expect(result.fontSize).toBe(14);
  });

  it('single very long word gets placed on a line', () => {
    const result = wrapText('Supercalifragilisticexpialidocious', 120, 14, 9);
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe('computeNodeText', () => {
  it('short label at root depth', () => {
    const result = computeNodeText('Root', undefined, 0, 180, false);
    expect(result.labelLines).toEqual(['Root']);
    expect(result.labelFontSize).toBe(17);
    expect(result.descLines).toEqual([]);
  });

  it('wraps label at leaf depth (smaller node)', () => {
    const result = computeNodeText(
      'A longer leaf node label',
      undefined,
      2,
      120,
      false
    );
    expect(result.labelLines.length).toBeGreaterThanOrEqual(1);
    expect(result.labelFontSize).toBeLessThanOrEqual(11); // 17 - 2*3
  });

  it('includes description when not hidden', () => {
    const result = computeNodeText(
      'Node',
      'Some description text here',
      1,
      150,
      false
    );
    expect(result.descLines.length).toBeGreaterThan(0);
    expect(result.descFontSize).toBe(10);
  });

  it('hides description when hideDescriptions is true', () => {
    const result = computeNodeText('Node', 'Description', 1, 150, true);
    expect(result.descLines).toEqual([]);
  });
});
