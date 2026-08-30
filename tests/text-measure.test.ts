import { describe, it, expect } from 'vitest';
import {
  breakAtoms,
  fitWrapped,
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

// ============================================================
// Break opportunities inside a single token (#586)
// ============================================================
//
// A label like `SpyglassFeedService` or `powder_store_queue` is ONE word, so
// the wrapper had nowhere to break it and fell through to `hardBreak`, which
// chops by grapheme cluster — mid-word, and unreadable.

describe('breakAtoms', () => {
  it('leaves a plain word alone', () => {
    expect(breakAtoms('Powder')).toEqual(['Powder']);
  });

  it('breaks after an underscore or hyphen, keeping the separator', () => {
    // On the end of the line it terminates, the way a hyphenated word reads.
    expect(breakAtoms('powder_store_queue')).toEqual([
      'powder_',
      'store_',
      'queue',
    ]);
    expect(breakAtoms('powder-store')).toEqual(['powder-', 'store']);
  });

  it('breaks at a camelCase boundary, inserting nothing', () => {
    expect(breakAtoms('SpyglassFeedService')).toEqual([
      'Spyglass',
      'Feed',
      'Service',
    ]);
  });

  it('breaks an acronym run before a capitalised word, not inside it', () => {
    // 🔴 `HTTPServer` gives `HTTP` + `Server`, never `HTTPS` + `erver`.
    expect(breakAtoms('HTTPServer')).toEqual(['HTTP', 'Server']);
    expect(breakAtoms('parseHTTPRequest')).toEqual([
      'parse',
      'HTTP',
      'Request',
    ]);
  });

  it('breaks between a digit and a capital', () => {
    expect(breakAtoms('queue2Store')).toEqual(['queue2', 'Store']);
  });

  it('never loses a character', () => {
    for (const w of [
      'SpyglassFeedService',
      'powder_store_queue',
      'HTTPServer',
      'a-b_cD',
      '',
      '_',
    ]) {
      expect(breakAtoms(w).join('')).toBe(w === '' ? '' : w);
    }
  });
});

describe('wrapTextToWidth uses those opportunities', () => {
  it('is byte-identical for text that fits, atoms or not', () => {
    // 🔴 Atoms CONCATENATE rather than re-joining with a space, so segmenting a
    // token that fits is a no-op. This is what lets the segmentation run
    // unconditionally without changing any existing caller's output.
    expect(wrapTextToWidth('SpyglassFeedService', 12, 10_000)).toEqual([
      'SpyglassFeedService',
    ]);
    expect(wrapTextToWidth('powder_store_queue', 12, 10_000)).toEqual([
      'powder_store_queue',
    ]);
  });

  it('breaks a camelCase name at its humps rather than mid-word', () => {
    const lines = wrapTextToWidth('SpyglassFeedService', 12, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('SpyglassFeedService');
    // Every line starts at a hump, so none begins mid-word.
    for (const l of lines.slice(1)) expect(l[0]).toBe(l[0]!.toUpperCase());
  });

  it('breaks an underscored name after its separators', () => {
    const lines = wrapTextToWidth('powder_store_queue', 12, 60);
    expect(lines.join('')).toBe('powder_store_queue');
    for (const l of lines.slice(0, -1)) expect(l.endsWith('_')).toBe(true);
  });
});

describe('fitWrapped — wrap, then shrink, then ellipsize', () => {
  it('keeps the full font when the label already fits', () => {
    const fit = fitWrapped('Bank', 500, 13, 9, 2);
    expect(fit.lines).toEqual(['Bank']);
    expect(fit.fontSize).toBe(13);
  });

  it('wraps before it shrinks', () => {
    // The order is the point: a long name stays readable across lines rather
    // than becoming tiny on one.
    const fit = fitWrapped('How Long Can Labels Be', 120, 13, 9, 2);
    expect(fit.lines.length).toBe(2);
    expect(fit.fontSize).toBe(13);
    expect(fit.lines.join(' ')).toBe('How Long Can Labels Be');
  });

  it('shrinks when wrapping alone will not fit the line cap', () => {
    const wide = fitWrapped('How Long Can Labels Be For Nodes', 120, 13, 9, 2);
    expect(wide.fontSize).toBeLessThan(13);
  });

  it('ellipsizes only once the floor font still will not fit', () => {
    const fit = fitWrapped(
      'How Long Can Labels Be For Nodes Really Quite Long Indeed',
      80,
      13,
      9,
      2
    );
    expect(fit.fontSize).toBe(9);
    expect(fit.lines).toHaveLength(2);
    expect(fit.lines[1]!.endsWith('\u2026')).toBe(true);
  });

  it('never returns a line wider than the box it was given', () => {
    const width = 100;
    for (const label of [
      'How Long Can Labels Be For Nodes',
      'SpyglassFeedService',
      'powder_store_queue',
      'Bank',
    ]) {
      const fit = fitWrapped(label, width, 13, 9, 2);
      for (const line of fit.lines) {
        expect(
          measureText(line, fit.fontSize, { bold: true })
        ).toBeLessThanOrEqual(width + 0.01);
      }
    }
  });

  it('takes a weight, and does not assume bold', () => {
    // ⚠️ The default is BOLD because every caller when this moved drew bold. A
    // caller at 400 or 500 that did not say so would reserve more room than its
    // glyphs need.
    const bold = fitWrapped('How Long Can Labels Be', 120, 13, 9, 2);
    const plain = fitWrapped('How Long Can Labels Be', 120, 13, 9, 2, {
      bold: false,
    });
    expect(plain.fontSize).toBeGreaterThanOrEqual(bold.fontSize);
  });
});
