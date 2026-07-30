import { describe, it, expect } from 'vitest';
import {
  reflowDescriptionLines,
  wrapDescriptionLines,
} from '../src/utils/wrapped-desc';
import { stripInlineMarkdown } from '../src/utils/inline-markdown';

const texts = (lines: { text: string }[]): string[] => lines.map((l) => l.text);

describe('reflowDescriptionLines', () => {
  it('joins consecutive plain lines into one paragraph', () => {
    const blocks = reflowDescriptionLines([
      'OpenAI runs a second unreleased model through',
      'ExploitGym, a cyber-capability benchmark.',
    ]);
    expect(blocks).toEqual([
      {
        kind: 'plain',
        segments: [
          'OpenAI runs a second unreleased model through ExploitGym, a cyber-capability benchmark.',
        ],
        gapBefore: false,
      },
    ]);
  });

  it('starts a new paragraph after a blank line', () => {
    const blocks = reflowDescriptionLines(['first para', '', 'second para']);
    expect(blocks).toEqual([
      { kind: 'plain', segments: ['first para'], gapBefore: false },
      { kind: 'plain', segments: ['second para'], gapBefore: true },
    ]);
  });

  it('never marks a gap before the first block', () => {
    const blocks = reflowDescriptionLines(['', '', 'body']);
    expect(blocks).toEqual([
      { kind: 'plain', segments: ['body'], gapBefore: false },
    ]);
  });

  it('gives every bullet its own block', () => {
    const blocks = reflowDescriptionLines(['• one', '• two']);
    expect(blocks).toEqual([
      { kind: 'bullet', segments: ['one'], gapBefore: false },
      { kind: 'bullet', segments: ['two'], gapBefore: false },
    ]);
  });

  it('lazily continues a bullet with the plain line under it', () => {
    const blocks = reflowDescriptionLines([
      '• probe the proxy',
      'not the task',
    ]);
    expect(blocks).toEqual([
      {
        kind: 'bullet',
        segments: ['probe the proxy not the task'],
        gapBefore: false,
      },
    ]);
  });

  it('a blank line ends a bullet, returning to prose', () => {
    const blocks = reflowDescriptionLines(['• a bullet', '', 'back to prose']);
    expect(blocks).toEqual([
      { kind: 'bullet', segments: ['a bullet'], gapBefore: false },
      { kind: 'plain', segments: ['back to prose'], gapBefore: true },
    ]);
  });

  it('a trailing backslash breaks the line without ending the paragraph', () => {
    const blocks = reflowDescriptionLines([
      'roses are red\\',
      'violets are blue',
    ]);
    expect(blocks).toEqual([
      {
        kind: 'plain',
        segments: ['roses are red', 'violets are blue'],
        gapBefore: false,
      },
    ]);
  });

  it('ignores trailing blank lines', () => {
    expect(reflowDescriptionLines(['body', '', ''])).toEqual([
      { kind: 'plain', segments: ['body'], gapBefore: false },
    ]);
  });
});

describe('wrapDescriptionLines', () => {
  it('rewraps a paragraph to the limit, ignoring the source line breaks', () => {
    const wrapped = wrapDescriptionLines(
      ['one two three', 'four five six'],
      14
    );
    expect(texts(wrapped)).toEqual(['one two three', 'four five six']);
    expect(wrapped.every((l) => l.kind === 'plain')).toBe(true);
  });

  it('reflows short source lines into full ones', () => {
    expect(texts(wrapDescriptionLines(['one', 'two', 'three'], 20))).toEqual([
      'one two three',
    ]);
  });

  it('emits an empty line between paragraphs', () => {
    expect(texts(wrapDescriptionLines(['first', '', 'second'], 20))).toEqual([
      'first',
      '',
      'second',
    ]);
  });

  it('never leads with a spacer line', () => {
    expect(texts(wrapDescriptionLines(['', 'first'], 20))).toEqual(['first']);
  });

  it('classifies a wrapped bullet as first + continuation', () => {
    const wrapped = wrapDescriptionLines(['• alpha beta gamma delta'], 14);
    expect(wrapped).toEqual([
      { text: 'alpha beta', kind: 'bullet-first' },
      { text: 'gamma delta', kind: 'bullet-cont' },
    ]);
  });

  it('keeps hard-break segments of one bullet in the same block', () => {
    const wrapped = wrapDescriptionLines(['• alpha\\', 'beta'], 20);
    expect(wrapped).toEqual([
      { text: 'alpha', kind: 'bullet-first' },
      { text: 'beta', kind: 'bullet-cont' },
    ]);
  });

  it('measures display width, not markdown source width', () => {
    // "**Artifactory** is" renders 18 wide but is 22 characters of source;
    // measuring the source would break the line early.
    expect(texts(wrapDescriptionLines(['**Artifactory** is'], 20))).toEqual([
      '**Artifactory** is',
    ]);
  });

  it('honours a caller-supplied length function', () => {
    const wrapped = wrapDescriptionLines(['aa bb cc'], 10, (s) => s.length * 2);
    expect(texts(wrapped)).toEqual(['aa bb', 'cc']);
  });
});

describe('stripInlineMarkdown', () => {
  it('drops emphasis and code markers', () => {
    expect(stripInlineMarkdown('**a** _b_ `c` *d*')).toBe('a b c d');
  });

  it('drops an unterminated marker — wrapping measures partial strings', () => {
    expect(stripInlineMarkdown('safety **features')).toBe('safety features');
  });

  it('keeps a link label and drops its target', () => {
    expect(stripInlineMarkdown('see [the docs](https://example.com/x)')).toBe(
      'see the docs'
    );
  });

  it('shortens a bare URL the way the renderer draws it', () => {
    expect(stripInlineMarkdown('at https://example.com')).toBe(
      'at example.com'
    );
  });
});
