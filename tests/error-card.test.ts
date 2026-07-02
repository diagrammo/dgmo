import { describe, it, expect } from 'vitest';
import { render, palettes, themes } from '../src/index';
import { renderErrorCard } from '../src/error-card';
import type { DgmoError } from '../src/diagnostics';

const err = (over: Partial<DgmoError>): DgmoError => ({
  line: 1,
  message: 'something broke',
  severity: 'error',
  ...over,
});

describe('renderErrorCard', () => {
  it('renders a card with the heading, wordmark and frown mark', () => {
    const svg = renderErrorCard(
      [err({ line: 2, message: 'bad thing' })],
      'flowchart Test\nA bad thing here',
      palettes.slate,
      'light'
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain("Couldn't render this diagram");
    expect(svg).toContain('>dgmo<'); // wordmark
    expect(svg).toContain('<circle'); // frown mark
  });

  it('adds a Diagrammo edit link preloaded with the broken source', () => {
    const svg = renderErrorCard(
      [err({ line: 2, message: 'bad thing' })],
      'flowchart Test\nA bad thing here',
      palettes.slate,
      'light'
    );
    // Clickable link into the online editor…
    expect(svg).toContain('<a href="https://online.diagrammo.app');
    // …carrying the source as a share payload…
    expect(svg).toContain('dgmo=');
    // …with a human-readable CTA and the Diagrammo mark (scaled icon group).
    expect(svg).toContain('online.diagrammo.app ↗');
    expect(svg).toContain('<g transform="translate(');
  });

  it('quotes the offending source line and its line number', () => {
    const source = 'sequence Flow\nAlice goes left\nBob | Carol bad pipe';
    const svg = renderErrorCard(
      [err({ line: 3, message: 'pipes removed' })],
      source,
      palettes.slate,
      'light'
    );
    expect(svg).toContain('Bob | Carol bad pipe');
    expect(svg).toContain('Line 3');
  });

  it('shows column in the badge and draws a caret when column is present', () => {
    const svg = renderErrorCard(
      [err({ line: 1, column: 5, message: 'oops' })],
      'abcd!efg',
      palettes.slate,
      'light'
    );
    expect(svg).toContain('Line 1:5');
    expect(svg).toContain('>^<'); // caret glyph
  });

  it('escapes XML in messages and source lines', () => {
    const svg = renderErrorCard(
      [err({ line: 1, message: 'bad <tag> & "quote"' })],
      'node <x> & y',
      palettes.slate,
      'light'
    );
    expect(svg).toContain('&lt;tag&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('<tag>');
  });

  it('caps the error list and reports the overflow count', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      err({ line: i + 1, message: `error ${i}` })
    );
    const source = Array.from({ length: 7 }, (_, i) => `line ${i}`).join('\n');
    const svg = renderErrorCard(many, source, palettes.slate, 'light');
    expect(svg).toContain('+ 3 more errors');
  });

  it('omits the opaque page background for the transparent theme', () => {
    const opaque = renderErrorCard([err({})], 'x', palettes.slate, 'light');
    const transparent = renderErrorCard(
      [err({})],
      'x',
      palettes.slate,
      'transparent'
    );
    expect(opaque).toContain('width="100%" height="100%"');
    expect(transparent).not.toContain('width="100%" height="100%"');
  });

  it('handles a missing line number without quoting source', () => {
    const svg = renderErrorCard(
      [err({ line: 0, message: 'global failure' })],
      'whatever',
      palettes.slate,
      'light'
    );
    expect(svg).toContain('global failure');
    expect(svg).not.toContain('Line 0');
  });
});

describe('render() error fallback', () => {
  it('returns the error card by default (onError: svg)', async () => {
    const { svg, diagnostics } = await render('notarealchart\nX 1', {
      palette: palettes.slate,
      theme: themes.light,
    });
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(svg).toContain("Couldn't render this diagram");
  });

  it('still throws when onError is throw', async () => {
    await expect(
      render('notarealchart\nX 1', { onError: 'throw' })
    ).rejects.toThrow(/DGMO parse error/);
  });

  it('returns no error card when onError is silent', async () => {
    const { svg } = await render('notarealchart\nX 1', {
      onError: 'silent',
    });
    expect(svg).not.toContain("Couldn't render this diagram");
  });
});
