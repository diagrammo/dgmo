// `highlight` on infra (#2041): a node, an edge or an arrow chain lights and
// everything else recedes to the story ground (#2046).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '../src/render';
import { parseDgmo } from '../src/dgmo-router';
import { parseInfra } from '../src/infra/parser';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

const ground = storyGround(getPalette('nord').light, false);

const BASE = `infra Shop

edge
  rps: 1000
  -> Gateway

Gateway
  -> Api
  -> Static

Api
  -> Db

Db

Static`;

async function draw(src: string): Promise<HTMLDivElement> {
  const div = document.createElement('div');
  div.innerHTML = (await render(src, { theme: 'light', palette: 'nord' })).svg;
  return div;
}

function nodeRect(d: HTMLElement, id: string): SVGRectElement {
  return d.querySelector(`[data-infra-node="${id}"] rect`)!;
}
const edgePath = (d: HTMLElement, from: string, to: string) =>
  d.querySelector(`.infra-edge[data-from="${from}"][data-to="${to}"] path`)!;

describe('infra highlight', () => {
  it('a plain name keeps its node and recedes the others', async () => {
    const plain = await draw(BASE);
    const d = await draw(`${BASE}\n\nhighlight Api`);
    expect(nodeRect(d, 'api').getAttribute('fill')).toBe(
      nodeRect(plain, 'api').getAttribute('fill')
    );
    expect(nodeRect(d, 'db').getAttribute('fill')).toBe(ground.groundFill);
    expect(nodeRect(d, 'db').getAttribute('stroke')).toBe(ground.groundStroke);
    expect(d.innerHTML).not.toMatch(/opacity="0\.28"/);
  });

  it('a chain lights its edges and recedes an off-path edge', async () => {
    const d = await draw(`${BASE}\n\nhighlight Edge -> Gateway -> Api`);
    const plain = await draw(BASE);
    expect(edgePath(d, 'gateway', 'api').getAttribute('stroke')).toBe(
      edgePath(plain, 'gateway', 'api').getAttribute('stroke')
    );
    expect(edgePath(d, 'gateway', 'static').getAttribute('stroke')).toBe(
      ground.groundStroke
    );
    expect(nodeRect(d, 'static').getAttribute('fill')).toBe(ground.groundFill);
  });

  it('accepts a label or an id on an edge line', async () => {
    const d = await draw(`${BASE}\n\nhighlight gateway -> API`);
    expect(nodeRect(d, 'static').getAttribute('fill')).toBe(ground.groundFill);
    expect(nodeRect(d, 'api').getAttribute('fill')).not.toBe(ground.groundFill);
  });

  it('warns on a missing link and recedes nothing', async () => {
    const src = `${BASE}\n\nhighlight Gateway -> Db`;
    const warns = parseInfra(src).diagnostics.filter(
      (x) => x.severity === 'warning'
    );
    expect(warns.map((w) => w.message)).toContain(
      'highlight names a link this diagram does not have: Gateway -> Db'
    );
    expect((await draw(src)).innerHTML).not.toContain(ground.groundFill);
  });

  it('the highlight line adds no other diagnostic', () => {
    const p = parseInfra(`${BASE}\n\nhighlight Edge -> Gateway -> Api`);
    const base = parseInfra(BASE);
    expect(p.diagnostics.map((x) => x.message)).toEqual(
      base.diagnostics.map((x) => x.message)
    );
    expect(p.emphasis?.kind).toBe('highlight');
  });

  it('no highlight line paints no ground', async () => {
    expect((await draw(BASE)).innerHTML).not.toContain(ground.groundFill);
  });

  it('the gallery fixture parses with no warnings', () => {
    const src = readFileSync('gallery/fixtures/infra-highlight.dgmo', 'utf8');
    const diags = parseDgmo(src).diagnostics.filter(
      (x) => x.severity === 'warning' || x.severity === 'error'
    );
    expect(diags).toEqual([]);
  });
});
