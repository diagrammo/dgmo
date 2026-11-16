// `highlight` on boxes-and-lines (#2041): a box, a link or an arrow chain
// lights; every other box, line, line label and fully receded group takes the
// grey ground.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '../src/render';
import { parseDgmo } from '../src/dgmo-router';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

const ground = storyGround(getPalette('slate').light, false);

const BASE = `boxes-and-lines Shop

WebApp -> API
API -pay-> Pay
API -> Cache
Admin -> Cache

[Back]
  API
  Pay
[Side]
  Admin
  Cache`;

async function draw(src: string) {
  const { svg, diagnostics } = await render(src);
  const host = document.createElement('div');
  host.innerHTML = svg;
  return { host, svg, diagnostics };
}

const nodeFill = (host: HTMLElement, name: string) =>
  host
    .querySelector(`g.bl-node[data-node-id="${name}"] rect`)!
    .getAttribute('fill');

describe('highlight on boxes-and-lines', () => {
  it('recedes unnamed boxes and leaves the named one alone', async () => {
    const plain = await draw(BASE);
    const lit = await draw(`${BASE}\nhighlight API`);
    expect(nodeFill(lit.host, 'Admin')).toBe(ground.groundFill);
    expect(nodeFill(lit.host, 'API')).toBe(nodeFill(plain.host, 'API'));
    expect(nodeFill(lit.host, 'API')).not.toBe(ground.groundFill);
  });

  it('a chain lights its lines and recedes off-path lines', async () => {
    const { host } = await draw(`${BASE}\nhighlight WebApp -> API -> Pay`);
    const stroke = (from: string, to: string) =>
      host
        .querySelector(
          `g.bl-edge-group[data-from="${from}"][data-to="${to}"] path`
        )!
        .getAttribute('stroke');
    expect(stroke('WebApp', 'API')).not.toBe(ground.groundStroke);
    expect(stroke('API', 'Pay')).not.toBe(ground.groundStroke);
    expect(stroke('Admin', 'Cache')).toBe(ground.groundStroke);
    expect(stroke('API', 'Cache')).toBe(ground.groundStroke);
  });

  it('a group with no lit member recedes; one with a lit member keeps its paint', async () => {
    const plain = await draw(BASE);
    const { host } = await draw(`${BASE}\nhighlight API`);
    const frame = (h: HTMLElement, g: string) =>
      h.querySelector(`g.bl-group[data-node-id="${g}"] rect`)!;
    expect(frame(host, 'Side').getAttribute('stroke')).toBe(
      ground.groundStroke
    );
    expect(frame(host, 'Back').getAttribute('stroke')).toBe(
      frame(plain.host, 'Back').getAttribute('stroke')
    );
  });

  it('warns on a missing link and recedes nothing', async () => {
    const { host, diagnostics } = await draw(
      `${BASE}\nhighlight WebApp -> Pay`
    );
    const msgs = diagnostics.map((d) => d.message);
    expect(msgs).toContain(
      'highlight names a link this diagram does not have: WebApp -> Pay'
    );
    expect(nodeFill(host, 'Admin')).not.toBe(ground.groundFill);
  });

  it('produces no other diagnostic', () => {
    const d = parseDgmo(`${BASE}\nhighlight API -> Pay`).diagnostics;
    expect(d).toEqual([]);
  });

  it('paints no ground without a highlight line', async () => {
    const { svg } = await draw(BASE);
    for (const hex of Object.values(ground)) expect(svg).not.toContain(hex);
  });

  it('the fixture parses with no warnings', () => {
    const src = readFileSync(
      'gallery/fixtures/boxes-and-lines-highlight.dgmo',
      'utf8'
    );
    expect(
      parseDgmo(src).diagnostics.filter((d) => d.severity === 'warning')
    ).toEqual([]);
  });
});
