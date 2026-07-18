import { describe, it, expect } from 'vitest';
import {
  measureText,
  truncateText,
  wrapTextToWidth,
} from '../src/utils/text-measure';

// ============================================================
// Reference implementations — the pre-optimization algorithms,
// re-measuring whole strings per step. The shipped versions must
// produce byte-identical output on every input.
// ============================================================

function referenceWrap(
  text: string,
  fontSize: number,
  maxWidth: number,
  opts?: { hardBreak?: boolean }
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const hardBreak = opts?.hardBreak ?? false;
  const lines: string[] = [];
  let current = '';
  const pushWord = (word: string) => {
    const test = current ? `${current} ${word}` : word;
    if (measureText(test, fontSize) <= maxWidth || !current) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  };
  for (const word of words) {
    if (hardBreak && measureText(word, fontSize) > maxWidth) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let chunk = '';
      for (const ch of word) {
        if (chunk && measureText(chunk + ch, fontSize) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
      continue;
    }
    pushWord(word);
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function referenceTruncate(
  text: string,
  fontSize: number,
  maxWidth: number
): string {
  if (measureText(text, fontSize) <= maxWidth) return text;
  const ellipsis = '…';
  const ellipsisW = measureText(ellipsis, fontSize);
  if (ellipsisW > maxWidth) return '';
  // Longest prefix whose width + ellipsis fits (linear scan — the binary
  // search's predicate is monotonic, so this is the same answer).
  let best = 0;
  for (let k = 1; k <= text.length; k++) {
    if (measureText(text.slice(0, k), fontSize) + ellipsisW <= maxWidth) {
      best = k;
    }
  }
  return best === 0 ? ellipsis : text.slice(0, best) + ellipsis;
}

const SAMPLES = [
  'Deploy the ingest service to the staging cluster',
  'a b c d e f g',
  'Short',
  'WWWWWW iiiiii MMMM llll',
  'punctuation, (parens) & sym#bols @scale 100%',
  'multi   spaced\twhitespace\nnewlines too',
  'Antidisestablishmentarianism supercalifragilistic word',
  'emoji 🎉🎉 and ünïcödé glyphs',
  '',
  '   ',
];
const FONT_SIZES = [10, 12, 13.5, 16];
const WIDTHS = [1, 20, 47.3, 80, 120, 500];

describe('measureText — memoization', () => {
  it('repeated calls return the identical value', () => {
    const first = measureText('Hello wide World', 13);
    expect(measureText('Hello wide World', 13)).toBe(first);
  });

  it('is additive per character (fold from zero)', () => {
    const fs = 12;
    expect(measureText('ab', fs)).toBe(
      measureText('a', fs) + measureText('b', fs)
    );
    expect(measureText('', fs)).toBe(0);
  });

  it('distinguishes font sizes for the same text', () => {
    expect(measureText('same', 10)).not.toBe(measureText('same', 20));
  });
});

describe('wrapTextToWidth — equivalence with whole-string measurement', () => {
  it('matches the reference greedy wrap on every sample × size × width', () => {
    for (const text of SAMPLES) {
      for (const fontSize of FONT_SIZES) {
        for (const maxWidth of WIDTHS) {
          expect(wrapTextToWidth(text, fontSize, maxWidth)).toEqual(
            referenceWrap(text, fontSize, maxWidth)
          );
          expect(
            wrapTextToWidth(text, fontSize, maxWidth, { hardBreak: true })
          ).toEqual(
            referenceWrap(text, fontSize, maxWidth, { hardBreak: true })
          );
        }
      }
    }
  });

  it('keeps a line whose width equals maxWidth exactly (<= boundary)', () => {
    const fs = 12;
    const w = measureText('foo bar', fs);
    expect(wrapTextToWidth('foo bar', fs, w)).toEqual(['foo bar']);
    expect(wrapTextToWidth('foo bar', fs, w - 0.001)).toEqual(['foo', 'bar']);
  });

  it('returns [""] for empty/whitespace input', () => {
    expect(wrapTextToWidth('', 12, 100)).toEqual(['']);
    expect(wrapTextToWidth('   ', 12, 100)).toEqual(['']);
  });

  it('every wrapped line joined back equals the normalized input', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const lines = wrapTextToWidth(text, 12, 90);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(text);
  });
});

describe('truncateText — equivalence with whole-string measurement', () => {
  it('matches the reference truncation on every sample × size × width', () => {
    for (const text of SAMPLES) {
      for (const fontSize of FONT_SIZES) {
        for (const maxWidth of WIDTHS) {
          expect(truncateText(text, fontSize, maxWidth)).toBe(
            referenceTruncate(text, fontSize, maxWidth)
          );
        }
      }
    }
  });

  it('returns the input untouched when it fits', () => {
    expect(truncateText('fits', 12, 1000)).toBe('fits');
  });

  it('returns "" when even the ellipsis alone overflows', () => {
    expect(truncateText('anything at all', 12, 0.001)).toBe('');
  });

  it('truncated output always fits and one more char would not', () => {
    const fs = 12;
    const maxWidth = 60;
    const text = 'Deployment pipeline configuration';
    const out = truncateText(text, fs, maxWidth);
    expect(out.endsWith('…')).toBe(true);
    expect(measureText(out, fs)).toBeLessThanOrEqual(maxWidth);
    const kept = out.slice(0, -1);
    const oneMore = text.slice(0, kept.length + 1) + '…';
    expect(measureText(oneMore, fs)).toBeGreaterThan(maxWidth);
  });
});
