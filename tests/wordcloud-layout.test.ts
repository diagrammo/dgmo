// Headless word-cloud placement (#1429). The canvas-free packer must test each
// word's box where the word is DRAWN — its baseline at y, glyphs above it — or
// a large word's top reaches into a smaller word placed above it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '../src/render';
import { lintSvg } from './stress/lint';

const GALLERY = readFileSync(
  resolve(__dirname, '../gallery/fixtures/wordcloud.dgmo'),
  'utf8'
);

const words = (source: string): string[] =>
  source
    .split('\n')
    .map((l) => /^(.+?)\s+\d+$/.exec(l.trim())?.[1])
    .filter((w): w is string => !!w);

const drawn = (svg: string): string[] =>
  [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]!);

describe('wordcloud headless layout', () => {
  it('draws every gallery word with no word over another', async () => {
    const { svg } = await render(GALLERY, { theme: 'light', palette: 'nord' });
    expect(lintSvg(svg)).toEqual([]);
    for (const w of words(GALLERY)) expect(drawn(svg)).toContain(w);
  });

  // Rotated words carry the baseline offset sideways; mixed rotation is random,
  // so render it several times.
  it('keeps rotated words apart too', async () => {
    const source = GALLERY.replace(/^(wordcloud .*)$/m, '$1\nrotate mixed');
    for (let i = 0; i < 5; i++) {
      const { svg } = await render(source, { theme: 'light', palette: 'nord' });
      expect(lintSvg(svg).filter((f) => f.rule === 'text-overlap')).toEqual([]);
    }
  });

  // A cloud too crowded for its box shrinks as a whole instead of dropping words.
  it('keeps every word when the cloud is crowded', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `Term${i} ${80 - i}`);
    const source = `wordcloud Crowded\n\n${many.join('\n')}\n`;
    const { svg } = await render(source, { theme: 'light', palette: 'nord' });
    expect(drawn(svg).filter((t) => t.startsWith('Term'))).toHaveLength(80);
  });
});
