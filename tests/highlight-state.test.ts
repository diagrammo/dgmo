// `highlight` on state (#2041): a state, a transition or a chain keeps its own
// paint; everything else is painted the grey ground (`storyGround`).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '../src/render';
import { parseDgmo } from '../src/dgmo-router';
import '../src/palettes/index';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

const ground = storyGround(getPalette('nord').light, false);

const BASE = `state Order

[*] -> Pending
Pending
  -submit-> Validating
Validating
  -ok-> Shipped
  -bad-> Cancelled`;
const withLine = (line: string) => BASE.replace('\n\n', `\n${line}\n\n`);

async function draw(src: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  host.innerHTML = (await render(src, { theme: 'light', palette: 'nord' })).svg;
  return host;
}

function stateRect(h: HTMLElement, label: string): SVGElement {
  for (const g of h.querySelectorAll('.st-node')) {
    if (g.querySelector('text')?.textContent === label)
      return g.querySelector('rect')!;
  }
  throw new Error(`no state ${label}`);
}
const edgeStrokes = (h: HTMLElement) =>
  [...h.querySelectorAll('.st-edge')].map((e) => e.getAttribute('stroke'));

describe('highlight on state', () => {
  it('greys states that are not named and leaves the named one alone', async () => {
    const plain = await draw(BASE);
    const h = await draw(withLine('highlight Shipped'));
    expect(stateRect(h, 'Shipped').getAttribute('fill')).toBe(
      stateRect(plain, 'Shipped').getAttribute('fill')
    );
    expect(stateRect(h, 'Pending').getAttribute('fill')).toBe(
      ground.groundFill
    );
    expect(stateRect(h, 'Pending').getAttribute('stroke')).toBe(
      ground.groundStroke
    );
    expect(h.querySelector('[opacity="0.28"]')).toBeNull();
  });

  it('a chain lights its transitions and recedes the off-path one', async () => {
    const plain = await draw(BASE);
    const h = await draw(
      withLine('highlight Pending -> Validating -bad-> Cancelled')
    );
    const before = edgeStrokes(plain);
    const after = edgeStrokes(h);
    expect(after.filter((s, i) => s === before[i])).toHaveLength(2);
    expect(after.filter((s) => s === ground.groundStroke)).toHaveLength(
      before.length - 2
    );
    expect(stateRect(h, 'Shipped').getAttribute('fill')).toBe(
      ground.groundFill
    );
    expect(stateRect(h, 'Cancelled').getAttribute('fill')).not.toBe(
      ground.groundFill
    );
    const ok = [...h.querySelectorAll('.st-edge-label')].find(
      (t) => t.textContent === 'ok'
    )!;
    expect(ok.getAttribute('fill')).toBe(ground.groundText);
  });

  it('warns on a link the diagram lacks and recedes nothing', async () => {
    const src = withLine('highlight Pending -> Shipped');
    const diags = parseDgmo(src).diagnostics;
    expect(diags.map((d) => d.message)).toEqual([
      'highlight names a link this diagram does not have: Pending -> Shipped',
    ]);
    expect(diags[0]!.severity).toBe('warning');
    const svg = (await render(src, { theme: 'light', palette: 'nord' })).svg;
    expect(svg).not.toContain(ground.groundFill);
  });

  it('is not read as content: no other diagnostic', () => {
    expect(parseDgmo(withLine('highlight Shipped')).diagnostics).toEqual([]);
  });

  it('paints no ground without a highlight line', async () => {
    const svg = (await render(BASE, { theme: 'light', palette: 'nord' })).svg;
    expect(svg).not.toContain(ground.groundFill);
    expect(svg).not.toContain(ground.groundStroke);
  });

  it('the gallery fixture parses clean', () => {
    const src = readFileSync('gallery/fixtures/state-highlight.dgmo', 'utf8');
    expect(parseDgmo(src).diagnostics).toEqual([]);
  });
});
