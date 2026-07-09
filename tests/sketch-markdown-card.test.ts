/**
 * Tests for the sketch markdown-card renderer (src/sketch/markdown-card.ts).
 *
 * Verifies the resvg-safe SVG output: bold via font-weight attr, links with
 * linkColor + data-href + an underline <line>, bullet markers, word-wrap,
 * newline handling, and a monotonically growing returned height.
 */
import { describe, it, expect } from 'vitest';
import { select } from 'd3-selection';
import { drawMarkdownBlock } from '../src/sketch/markdown-card';
import type { D3Sel } from '../src/utils/legend-types';

const baseOpts = {
  width: 200,
  fontSize: 12,
  lineHeight: 16,
  color: '#222222',
  linkColor: '#1a73e8',
};

function makeContainer(): { g: D3Sel; el: SVGGElement } {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const svg = select(div).append('svg').attr('width', 400).attr('height', 400);
  const g = svg.append('g');
  return { g, el: g.node() as SVGGElement };
}

describe('drawMarkdownBlock', () => {
  it('renders **bold** with a font-weight="bold" tspan', () => {
    const { g, el } = makeContainer();
    drawMarkdownBlock(g, 'a **bold** word', baseOpts);
    const bold = Array.from(el.querySelectorAll('tspan')).filter(
      (t) => t.getAttribute('font-weight') === 'bold'
    );
    expect(bold.length).toBeGreaterThanOrEqual(1);
    expect(bold[0]!.textContent).toBe('bold');
  });

  it('renders [label](url) as a linkColor tspan with data-href + underline line', () => {
    const { g, el } = makeContainer();
    drawMarkdownBlock(g, 'see [docs](https://y) here', baseOpts);
    const link = Array.from(el.querySelectorAll('tspan')).find(
      (t) => t.getAttribute('data-href') === 'https://y'
    );
    expect(link).toBeTruthy();
    expect(link!.getAttribute('fill')).toBe(baseOpts.linkColor);
    expect(link!.textContent).toBe('docs');
    // An underline <line> was added.
    const lines = el.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    // The (url) and brackets are not shown anywhere.
    expect(el.textContent).not.toContain('https://y');
    expect(el.textContent).not.toContain('[');
  });

  it('renders a "- item" bullet with a • marker', () => {
    const { g, el } = makeContainer();
    drawMarkdownBlock(g, '- item one', baseOpts);
    const texts = Array.from(el.querySelectorAll('text')).map(
      (t) => t.textContent
    );
    expect(texts).toContain('•');
  });

  it('word-wraps a long logical line into multiple <text> lines', () => {
    const { g, el } = makeContainer();
    const long =
      'this is a fairly long single logical line that should certainly wrap several times';
    drawMarkdownBlock(g, long, { ...baseOpts, width: 60 });
    // Bullet-less lines: each visual line is one <text>.
    const lineTexts = el.querySelectorAll('text');
    expect(lineTexts.length).toBeGreaterThan(1);
  });

  it('splits on newlines into separate line <text> elements', () => {
    const { g, el } = makeContainer();
    drawMarkdownBlock(g, 'a\nb', baseOpts);
    expect(el.querySelectorAll('text').length).toBeGreaterThanOrEqual(2);
  });

  it('returns a positive height that grows with more lines', () => {
    const { g: g1 } = makeContainer();
    const h1 = drawMarkdownBlock(g1, 'one line', baseOpts);
    expect(h1).toBeGreaterThan(0);

    const { g: g2 } = makeContainer();
    const h2 = drawMarkdownBlock(
      g2,
      'one line\ntwo line\nthree line',
      baseOpts
    );
    expect(h2).toBeGreaterThan(h1);
  });

  it('clamps to maxLines and appends an ellipsis', () => {
    const { g, el } = makeContainer();
    const h = drawMarkdownBlock(g, 'a\nb\nc\nd', { ...baseOpts, maxLines: 2 });
    expect(el.querySelectorAll('text').length).toBe(2);
    expect(el.textContent).toContain('…');
    expect(h).toBe(2 * baseOpts.lineHeight);
  });
});
