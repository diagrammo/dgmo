// `highlight` on flowchart (#2041): a node, a link or an arrow chain keeps its
// own paint; everything else is painted the grey ground (`storyGround`).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '../src/render';
import { parseDgmo } from '../src/dgmo-router';
import '../src/palettes/index';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

const ground = storyGround(getPalette('nord').light, false);

const BASE = `flowchart Checkout

(Start) -> [Cart] -> <OK?>
  -yes-> [Pay] -> (Done)
  -no-> [Fix] -> [Cart]`;
const withLine = (line: string) => BASE.replace('\n\n', `\n${line}\n\n`);

async function draw(src: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  host.innerHTML = (await render(src, { theme: 'light', palette: 'nord' })).svg;
  return host;
}

function nodeRect(h: HTMLElement, label: string): SVGElement {
  for (const g of h.querySelectorAll('.fc-node')) {
    if (g.querySelector('text')?.textContent === label)
      return g.querySelector('rect, polygon, path')!;
  }
  throw new Error(`no node ${label}`);
}
function edgePaths(h: HTMLElement): SVGElement[] {
  return [...h.querySelectorAll<SVGElement>('.fc-edge')];
}

describe('highlight on flowchart', () => {
  it('greys nodes that are not named and leaves the named one alone', async () => {
    const plain = await draw(BASE);
    const h = await draw(withLine('highlight Pay'));
    expect(nodeRect(h, 'Pay').getAttribute('fill')).toBe(
      nodeRect(plain, 'Pay').getAttribute('fill')
    );
    expect(nodeRect(h, 'Fix').getAttribute('fill')).toBe(ground.groundFill);
    expect(nodeRect(h, 'Fix').getAttribute('stroke')).toBe(ground.groundStroke);
    expect(h.querySelector('[opacity="0.28"]')).toBeNull();
    const fixText = [...h.querySelectorAll('.fc-node text')].find(
      (t) => t.textContent === 'Fix'
    )!;
    expect(fixText.getAttribute('fill')).toBe(ground.groundText);
  });

  it('a chain with a labelled arrow lights that edge only', async () => {
    const plain = await draw(BASE);
    const h = await draw(withLine('highlight OK? -no-> Fix'));
    const stroke = (x: HTMLElement) =>
      edgePaths(x).map((e) => e.getAttribute('stroke'));
    const before = stroke(plain);
    const after = stroke(h);
    const lit = after.filter((s, i) => s === before[i]);
    expect(lit).toHaveLength(1);
    expect(after.filter((s) => s === ground.groundStroke)).toHaveLength(
      before.length - 1
    );
    expect(nodeRect(h, 'OK?').getAttribute('fill')).not.toBe(ground.groundFill);
    expect(nodeRect(h, 'Fix').getAttribute('fill')).not.toBe(ground.groundFill);
    expect(nodeRect(h, 'Pay').getAttribute('fill')).toBe(ground.groundFill);
    const labels = [...h.querySelectorAll('.fc-edge-label')].map((t) => [
      t.textContent,
      t.getAttribute('fill'),
    ]);
    expect(labels.find(([t]) => t === 'yes')![1]).toBe(ground.groundText);
    expect(labels.find(([t]) => t === 'no')![1]).not.toBe(ground.groundText);
  });

  it('warns on a link the diagram lacks and recedes nothing', async () => {
    const src = withLine('highlight Start -> Pay');
    const diags = parseDgmo(src).diagnostics;
    expect(diags.map((d) => d.message)).toEqual([
      'highlight names a link this diagram does not have: Start -> Pay',
    ]);
    expect(diags[0]!.severity).toBe('warning');
    const svg = (await render(src, { theme: 'light', palette: 'nord' })).svg;
    expect(svg).not.toContain(ground.groundFill);
  });

  it('is not read as content: no other diagnostic', () => {
    expect(parseDgmo(withLine('highlight Pay')).diagnostics).toEqual([]);
  });

  it('paints no ground without a highlight line', async () => {
    const svg = (await render(BASE, { theme: 'light', palette: 'nord' })).svg;
    expect(svg).not.toContain(ground.groundFill);
    expect(svg).not.toContain(ground.groundStroke);
  });

  it('the gallery fixture parses clean', () => {
    const src = readFileSync(
      'gallery/fixtures/flowchart-highlight.dgmo',
      'utf8'
    );
    expect(parseDgmo(src).diagnostics).toEqual([]);
  });
});
