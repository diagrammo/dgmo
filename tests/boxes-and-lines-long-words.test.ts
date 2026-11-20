import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { NODE_WIDTH } from '../src/boxes-and-lines/node-metrics';
import { getPalette } from '../src/palettes';

// #2172: a long single word in a box label was cut with "…" while the canvas
// had room beside the box. The box now widens to its widest word (capped),
// and a word wider than the cap breaks instead of ending in "…".

const P = getPalette('nord').light;

async function render(src: string) {
  const parsed = parseBoxesAndLines(src);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: { width: 800, height: 600 },
  });
  return { svg: el.querySelector('svg')!, layout };
}

function nodeText(svg: SVGSVGElement, label: string): string[] {
  const g = svg.querySelector(`.bl-node[data-node-id="${label}"]`)!;
  return [...g.querySelectorAll('text')].map((t) => t.textContent ?? '');
}

describe('boxes-and-lines — long words in node labels (#2172)', () => {
  it('keeps each long word whole and draws no "…"', async () => {
    const { svg } = await render(`boxes-and-lines T
direction TB
Root
Root -> Representation fusion
Root -> Provenance reproducibility
Root -> interpretability
`);
    const all = [
      ...nodeText(svg, 'Representation fusion'),
      ...nodeText(svg, 'Provenance reproducibility'),
      ...nodeText(svg, 'interpretability'),
    ];
    expect(all.some((t) => t.includes('…'))).toBe(false);
    for (const word of [
      'Representation',
      'reproducibility',
      'interpretability',
    ])
      expect(all).toContain(word);
  });

  it('breaks a word wider than the widest box rather than cutting it', async () => {
    const word = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
    const { svg } = await render(`boxes-and-lines T
${word}
`);
    const lines = nodeText(svg, word);
    expect(lines.some((t) => t.includes('…'))).toBe(false);
    expect(lines.join('')).toBe(word);
  });

  it('a short-label box keeps its width', async () => {
    const { layout } = await render(`boxes-and-lines T
A -> B
`);
    for (const n of layout.nodes) expect(n.width).toBe(NODE_WIDTH);
  });
});
