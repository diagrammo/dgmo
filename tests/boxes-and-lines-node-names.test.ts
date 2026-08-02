import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { getPalette } from '../src/palettes';

const P = getPalette('nord').light;
const DIMS = { width: 800, height: 600 };

async function renderTexts(src: string): Promise<string[]> {
  const parsed = parseBoxesAndLines(src);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, { exportDims: DIMS });
  const svg = el.querySelector('svg')!;
  return [...svg.querySelectorAll('text')].map((t) => t.textContent ?? '');
}

describe('boxes-and-lines node names — hyphens survive to the canvas', () => {
  it('renders a hyphenated name verbatim', async () => {
    const texts = await renderTexts(
      'boxes-and-lines Hyphen check\n\nAlpha-One -uses-> Cache\n'
    );
    expect(texts).toContain('Alpha-One');
    expect(texts).not.toContain('Alpha One');
  });

  it('keeps hyphens in a multi-hyphen identifier (us-east-1)', async () => {
    const texts = await renderTexts(
      'boxes-and-lines T\n\nread-only replica -in-> us-east-1\n'
    );
    expect(texts).toContain('us-east-1');
    // The two-word source may wrap; neither line may turn a hyphen into a space.
    expect(texts.every((t) => !/read only/.test(t))).toBe(true);
    expect(texts).toContain('read-only');
  });

  it('keeps camelCase closed up — the hump is a break point, not a space', async () => {
    const texts = await renderTexts('boxes-and-lines T\n\nAlphaOne -> Cache\n');
    expect(texts).toContain('AlphaOne');
    expect(texts).not.toContain('Alpha One');
  });

  it('still wraps a long name, breaking after the hyphen', async () => {
    const texts = await renderTexts(
      'boxes-and-lines T\n\nA very long read-only replication node -x-> B\n'
    );
    // Wrapped across lines — no line may gain or lose characters, so the
    // hyphen stays attached to the chunk it followed.
    expect(texts.some((t) => t.startsWith('read-only'))).toBe(true);
    expect(texts.every((t) => !/read only/.test(t))).toBe(true);
  });

  it('parses the hyphen as name text, not as an edge sigil, with no diagnostics', () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines T\n\nAlpha-One -uses-> Cache\n'
    );
    expect(parsed.nodes.map((n) => n.label)).toEqual(['Alpha-One', 'Cache']);
    expect(parsed.edges[0]).toMatchObject({
      source: 'Alpha-One',
      target: 'Cache',
      label: 'uses',
    });
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe('boxes-and-lines node names — quotes are delimiters', () => {
  it('consumes the quotes around a hyphenated name', async () => {
    const texts = await renderTexts(
      'boxes-and-lines T\n\n"Foo-bar" -uses-> Cache\n'
    );
    expect(texts).toContain('Foo-bar');
    expect(texts).not.toContain('"Foo-bar"');
  });

  it('quoting escapes reserved characters in a name (§2.2)', async () => {
    expect(
      await renderTexts('boxes-and-lines T\n\n"Order | Items" -> Cache\n')
    ).toContain('Order | Items');
    expect(
      await renderTexts('boxes-and-lines T\n\n"Foo: bar" -> Cache\n')
    ).toContain('Foo: bar');
  });

  it('matches a quoted declaration to a quoted reference as one node', () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines T\n\n"Foo-bar" description: x\n"Foo-bar" -> Cache\n'
    );
    expect(parsed.nodes.map((n) => n.label)).toEqual(['Foo-bar', 'Cache']);
  });

  it('matches a quoted declaration to a bare reference (§2.1 normalization)', () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines T\n\n"Foo-bar"\nFoo-bar -> Cache\n'
    );
    expect(parsed.nodes.map((n) => n.label)).toEqual(['Foo-bar', 'Cache']);
  });

  it('leaves an interior quote alone — there is no escape form', async () => {
    const texts = await renderTexts(
      'boxes-and-lines T\n\nsay "hi" loudly -> Cache\n'
    );
    expect(texts).toContain('say "hi" loudly');
  });
});
