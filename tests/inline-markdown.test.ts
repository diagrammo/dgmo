import { describe, it, expect } from 'vitest';
import { parseInlineMarkdown, truncateBareUrl } from '../src/utils/inline-markdown';

describe('parseInlineMarkdown', () => {
  it('returns plain text as a single span', () => {
    expect(parseInlineMarkdown('hello world')).toEqual([{ text: 'hello world' }]);
  });

  it('returns empty array for empty string', () => {
    expect(parseInlineMarkdown('')).toEqual([]);
  });

  it('parses **bold** (asterisks)', () => {
    expect(parseInlineMarkdown('**bold**')).toEqual([{ text: 'bold', bold: true }]);
  });

  it('parses __bold__ (underscores)', () => {
    expect(parseInlineMarkdown('__bold__')).toEqual([{ text: 'bold', bold: true }]);
  });

  it('parses *italic* (single asterisk)', () => {
    expect(parseInlineMarkdown('*italic*')).toEqual([{ text: 'italic', italic: true }]);
  });

  it('parses _italic_ (single underscore)', () => {
    expect(parseInlineMarkdown('_italic_')).toEqual([{ text: 'italic', italic: true }]);
  });

  it('parses `code`', () => {
    expect(parseInlineMarkdown('`code`')).toEqual([{ text: 'code', code: true }]);
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
    expect(truncateBareUrl('https://api.example.com/v2')).toBe('api.example.com/v2');
  });

  it('truncates long URLs with ellipsis', () => {
    const long = 'https://api.example.com/v2/users/authentication/oauth2/callback';
    const result = truncateBareUrl(long);
    expect(result.length).toBe(35);
    expect(result.endsWith('\u2026')).toBe(true);
  });
});
