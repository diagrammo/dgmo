import { describe, it, expect } from 'vitest';
import { fitLabel, fittedWidth } from '../src/utils/fit-label';
import { measureText } from '../src/utils/text-measure';

// The label engine's first rule (#1828): wrap before truncating.

const FONT = 12;

describe('fitLabel', () => {
  it('keeps a label that fits on one line', () => {
    expect(fitLabel('Other', FONT, 100, 3)).toEqual({
      lines: ['Other'],
      truncated: false,
    });
  });

  it('wraps a long label rather than cut it when the lines allow', () => {
    const text = 'Billing disputes, refunds and invoice corrections';
    const fit = fitLabel(text, FONT, 168, 2);
    expect(fit.truncated).toBe(false);
    expect(fit.lines.length).toBe(2);
    expect(fit.lines.join(' ')).toBe(text);
    for (const l of fit.lines)
      expect(measureText(l, FONT)).toBeLessThanOrEqual(168);
  });

  it('cuts only the last line when the words need more lines than allowed', () => {
    const text = 'one two three four five six seven eight nine ten eleven';
    const fit = fitLabel(text, FONT, 60, 2);
    expect(fit.truncated).toBe(true);
    expect(fit.lines.length).toBe(2);
    expect(fit.lines[0]!.endsWith('…')).toBe(false);
    expect(fit.lines[1]!.endsWith('…')).toBe(true);
    expect(fittedWidth(fit, FONT)).toBeLessThanOrEqual(60);
  });

  it('cuts a single word wider than the width', () => {
    const fit = fitLabel('Supercalifragilisticexpialidocious', FONT, 80, 3);
    expect(fit.truncated).toBe(true);
    expect(fit.lines).toHaveLength(1);
    expect(fit.lines[0]!.endsWith('…')).toBe(true);
    expect(fittedWidth(fit, FONT)).toBeLessThanOrEqual(80);
  });
});
