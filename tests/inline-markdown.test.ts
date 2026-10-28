import { describe, it, expect } from 'vitest';
import {
  parseInlineMarkdown,
  stripInlineMarkdown,
  truncateBareUrl,
} from '../src/utils/inline-markdown';
import { fastestOf, growthExponent } from './perf-helpers';

describe('parseInlineMarkdown', () => {
  it('returns plain text as a single span', () => {
    expect(parseInlineMarkdown('hello world')).toEqual([
      { text: 'hello world' },
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(parseInlineMarkdown('')).toEqual([]);
  });

  it('parses **bold** (asterisks)', () => {
    expect(parseInlineMarkdown('**bold**')).toEqual([
      { text: 'bold', bold: true },
    ]);
  });

  it('parses __bold__ (underscores)', () => {
    expect(parseInlineMarkdown('__bold__')).toEqual([
      { text: 'bold', bold: true },
    ]);
  });

  it('parses *italic* (single asterisk)', () => {
    expect(parseInlineMarkdown('*italic*')).toEqual([
      { text: 'italic', italic: true },
    ]);
  });

  it('parses _italic_ (single underscore)', () => {
    expect(parseInlineMarkdown('_italic_')).toEqual([
      { text: 'italic', italic: true },
    ]);
  });

  it('parses `code`', () => {
    expect(parseInlineMarkdown('`code`')).toEqual([
      { text: 'code', code: true },
    ]);
  });

  it('parses [link](url)', () => {
    expect(parseInlineMarkdown('[docs](https://example.com)')).toEqual([
      { text: 'docs', href: 'https://example.com' },
    ]);
  });

  it('parses bare https:// URL', () => {
    expect(parseInlineMarkdown('https://example.com')).toEqual([
      { text: 'https://example.com', href: 'https://example.com' },
    ]);
  });

  it('parses bare www. URL and prepends https://', () => {
    expect(parseInlineMarkdown('www.example.com')).toEqual([
      { text: 'www.example.com', href: 'https://www.example.com' },
    ]);
  });

  it('handles mixed formatting', () => {
    const spans = parseInlineMarkdown('Use **bold** and *italic* and `code`');
    expect(spans).toEqual([
      { text: 'Use ' },
      { text: 'bold', bold: true },
      { text: ' and ' },
      { text: 'italic', italic: true },
      { text: ' and ' },
      { text: 'code', code: true },
    ]);
  });

  it('handles text with inline URL', () => {
    const spans = parseInlineMarkdown('visit https://example.com today');
    expect(spans).toEqual([
      { text: 'visit ' },
      { text: 'https://example.com', href: 'https://example.com' },
      { text: ' today' },
    ]);
  });

  it('handles bold alongside a link', () => {
    const spans = parseInlineMarkdown('**important** [link](http://x.com)');
    expect(spans).toEqual([
      { text: 'important', bold: true },
      { text: ' ' },
      { text: 'link', href: 'http://x.com' },
    ]);
  });

  it('keeps a [ that opens no link as text (#1557)', () => {
    expect(parseInlineMarkdown('a [b c')).toEqual([
      { text: 'a ' },
      { text: '[' },
      { text: 'b c' },
    ]);
    expect(parseInlineMarkdown('[optional]')).toEqual([
      { text: '[' },
      { text: 'optional]' },
    ]);
  });

  it('starts a link at the bracket nearest its text (#1557)', () => {
    expect(parseInlineMarkdown('see [a [b](http://x.com)')).toEqual([
      { text: 'see ' },
      { text: '[' },
      { text: 'a ' },
      { text: 'b', href: 'http://x.com' },
    ]);
  });

  it('keeps one balanced pair of parentheses in a link URL', () => {
    expect(
      parseInlineMarkdown('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))')
    ).toEqual([
      { text: 'Foo', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
    ]);
  });
});

// Lazy `.+?` in the link branch rescanned the rest of the line from every
// `[` and every `](`: quadratic for `[`, cubic for `[](` (#1557).
describe('inline markdown on a line of unmatched link openers', () => {
  const lines: Record<string, (n: number) => string> = {
    '[': (n) => '['.repeat(n),
    '[](': (n) => '[]('.repeat(n),
    '[a](': (n) => '[a]('.repeat(n),
    '[a](x(': (n) => '[a](x('.repeat(n),
  };
  const run: Record<string, (line: string) => unknown> = {
    parseInlineMarkdown,
    stripInlineMarkdown,
  };

  for (const [unit, makeLine] of Object.entries(lines)) {
    for (const [name, fn] of Object.entries(run)) {
      it(`${name} grows linearly in a line of ${unit}`, () => {
        const cost = (n: number) => {
          const line = makeLine(n);
          return fastestOf(5, () => fn(line));
        };
        const small = 2_000;
        const large = 20_000;
        const exponent = growthExponent(
          { n: small, ms: cost(small) },
          { n: large, ms: cost(large) }
        );
        expect(exponent).toBeLessThan(1.5);
      });
    }
  }

  it('keeps every character of a line of [ as text', () => {
    const spans = parseInlineMarkdown('['.repeat(50));
    expect(spans.map((s) => s.text).join('')).toBe('['.repeat(50));
  });
});

describe('truncateBareUrl', () => {
  it('strips https:// protocol', () => {
    expect(truncateBareUrl('https://example.com')).toBe('example.com');
  });

  it('strips http:// protocol', () => {
    expect(truncateBareUrl('http://example.com')).toBe('example.com');
  });

  it('strips www. prefix', () => {
    expect(truncateBareUrl('https://www.example.com')).toBe('example.com');
  });

  it('keeps short URLs intact', () => {
    expect(truncateBareUrl('https://api.example.com/v2')).toBe(
      'api.example.com/v2'
    );
  });

  it('truncates long URLs with ellipsis', () => {
    const long =
      'https://api.example.com/v2/users/authentication/oauth2/callback';
    const result = truncateBareUrl(long);
    expect(result.length).toBe(35);
    expect(result.endsWith('\u2026')).toBe(true);
  });
});
