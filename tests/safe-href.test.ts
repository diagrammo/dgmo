import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3-selection';
import { safeHref } from '../src/utils/safe-href';
import { renderInlineText } from '../src/utils/inline-markdown';
import '../src/palettes';
import { getPalette } from '../src/palettes/registry';

describe('safeHref', () => {
  describe('allowed', () => {
    const allowed = [
      'http://example.com',
      'https://example.com/path?q=1',
      'HTTPS://EXAMPLE.com',
      'mailto:user@example.com',
      'MAILTO:user@example.com',
      '/absolute/path',
      './relative/path',
      '../parent',
      '#anchor',
      '?query=only',
      'just-a-word', // treated as relative
    ];
    for (const url of allowed) {
      it(`accepts ${JSON.stringify(url)}`, () => {
        expect(safeHref(url)).toBe(url);
      });
    }
  });

  describe('rejected', () => {
    const rejected = [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'JaVaScRiPt:alert(1)',
      '\tjavascript:alert(1)',
      '\njavascript:alert(1)',
      '  javascript:alert(1)',
      '\x00javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
      'ftp://example.com',
      'about:blank',
    ];
    for (const url of rejected) {
      it(`rejects ${JSON.stringify(url)}`, () => {
        expect(safeHref(url)).toBeNull();
      });
    }
  });

  describe('edge cases', () => {
    it('rejects empty string', () => {
      expect(safeHref('')).toBeNull();
    });
    it('rejects whitespace-only', () => {
      expect(safeHref('   ')).toBeNull();
    });
    it('rejects undefined', () => {
      expect(safeHref(undefined)).toBeNull();
    });
    it('rejects null', () => {
      expect(safeHref(null)).toBeNull();
    });
    it('rejects non-string', () => {
      // @ts-expect-error: deliberately wrong type
      expect(safeHref(42)).toBeNull();
    });
  });
});

describe('inline-markdown safeHref integration', () => {
  function renderToSvg(text: string): string {
    const dom = new JSDOM(
      '<!DOCTYPE html><svg xmlns="http://www.w3.org/2000/svg"><text></text></svg>'
    );
    const textEl = d3.select(
      dom.window.document.querySelector('text') as SVGTextElement
    );
    const config = getPalette('nord');
    const palette = config.dark;
    renderInlineText(textEl, text, palette);
    return dom.window.document.querySelector('svg')!.outerHTML;
  }

  it('drops anchor for [text](javascript:alert(1))', () => {
    const out = renderToSvg('Click [me](javascript:alert(1)) now');
    expect(out).not.toMatch(/href=["'][^"']*javascript:/i);
    // Text is preserved
    expect(out).toMatch(/me/);
  });

  it('drops anchor for [text](data:text/html,...)', () => {
    const out = renderToSvg('Click [me](data:text/html,<script>) now');
    expect(out).not.toMatch(/href=["'][^"']*data:/i);
  });

  it('drops anchor for [text](vbscript:msgbox)', () => {
    const out = renderToSvg('Click [me](vbscript:msgbox) now');
    expect(out).not.toMatch(/href=["'][^"']*vbscript:/i);
  });

  it('keeps https links', () => {
    const out = renderToSvg('Click [me](https://example.com) now');
    expect(out).toMatch(/href=["']https:\/\/example\.com["']/);
  });

  it('drops anchor for whitespace-prefixed javascript:', () => {
    const out = renderToSvg('[click](\tjavascript:alert(1))');
    expect(out).not.toMatch(/href=["'][^"']*javascript:/i);
  });
});
