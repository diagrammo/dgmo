// `highlight` on sequence (#2041): a participant lights its box, lifeline and
// every message to or from it; a chain lights exactly its messages. Everything
// else is painted with the grey ground (`storyGround`), never an opacity.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';
import { parseDgmo } from '../src/dgmo-router';

let doc: Document;
beforeAll(() => {
  const win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;
  doc = win.document;
  for (const [k, v] of Object.entries({
    document: doc,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true });
  }
});

const palette = getPalette('nord').light;
const ground = storyGround(palette, false);

function draw(src: string): { svg: SVGSVGElement; warnings: string[] } {
  const parsed = parseSequenceDgmo(src);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  doc.body.appendChild(container);
  renderSequenceDiagram(container, parsed, palette, false, undefined, {
    exportWidth: 800,
  });
  const svg = container.querySelector('svg')!;
  doc.body.removeChild(container);
  return {
    svg,
    warnings: parsed.diagnostics
      .filter((d) => d.severity === 'warning')
      .map((d) => d.message),
  };
}

const BASE = `sequence Pay
Web
API
DB
Payments
`;
const BODY = `
Web -pay-> API
API -charge-> Payments
Payments -ok-> API
API -save-> DB
`;

const stroke = (el: Element) => el.getAttribute('stroke');
const arrows = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll('.message-arrow')].map((a) => ({
    from: a.getAttribute('data-from'),
    to: a.getAttribute('data-to'),
    stroke: stroke(a),
  }));
const boxFill = (svg: SVGSVGElement, id: string) =>
  svg
    .querySelector(
      `.participant[data-participant-id="${id}"] .participant-body`
    )
    ?.getAttribute('fill') ??
  svg
    .querySelector(`.participant[data-participant-id="${id}"] *[fill]`)
    ?.getAttribute('fill');

describe('highlight on sequence', () => {
  it('a participant lights its box, lifeline and every message touching it', () => {
    const plain = draw(BASE + BODY).svg;
    const { svg, warnings } = draw(BASE + 'highlight Payments\n' + BODY);
    expect(warnings).toEqual([]);
    expect(boxFill(svg, 'Payments')).toBe(boxFill(plain, 'Payments'));
    expect(boxFill(svg, 'Web')).toBe(ground.groundFill);
    const ll = (id: string) =>
      stroke(svg.querySelector(`.lifeline[data-participant-id="${id}"]`)!);
    expect(ll('Web')).toBe(ground.groundStroke);
    expect(ll('Payments')).not.toBe(ground.groundStroke);
    const a = arrows(svg);
    const touching = a.filter(
      (m) => m.from === 'Payments' || m.to === 'Payments'
    );
    expect(touching.length).toBeGreaterThan(0);
    for (const m of touching) expect(m.stroke).not.toBe(ground.groundStroke);
    for (const m of a.filter((x) => !touching.includes(x)))
      expect(m.stroke).toBe(ground.groundStroke);
    expect(svg.innerHTML).not.toMatch(
      /opacity="0?\.\d+"[^>]*seq-arrowhead-ground/
    );
  });

  it('a chain lights exactly its messages and recedes the rest', () => {
    const { svg, warnings } = draw(
      BASE + 'highlight Web -> API -> DB\n' + BODY
    );
    expect(warnings).toEqual([]);
    const byPair = (f: string, t: string) =>
      arrows(svg).find((m) => m.from === f && m.to === t)!;
    expect(byPair('Web', 'API').stroke).not.toBe(ground.groundStroke);
    expect(byPair('API', 'DB').stroke).not.toBe(ground.groundStroke);
    expect(byPair('API', 'Payments').stroke).toBe(ground.groundStroke);
    const ret = svg.querySelector('.return-arrow');
    if (ret) expect(stroke(ret)).toBe(ground.groundStroke);
  });

  it('a missing link warns and nothing recedes', () => {
    const { svg, warnings } = draw(BASE + 'highlight Web -> DB\n' + BODY);
    expect(warnings).toEqual([
      'highlight names a link this diagram does not have: Web -> DB',
    ]);
    expect(svg.innerHTML).not.toContain(ground.groundFill);
  });

  it('the highlight line adds no other diagnostic', () => {
    const parsed = parseSequenceDgmo(BASE + 'highlight Payments\n' + BODY);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.messages).toHaveLength(4);
  });

  it('inside a block it neither closes the block nor reads as content', () => {
    const parsed = parseSequenceDgmo(
      `${BASE}\nif ok\n  Web -pay-> API\nhighlight API\n  API -save-> DB\n  API -charge-> Payments\n`
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.emphasis?.names).toEqual(['API']);
  });

  it('no highlight line leaves no ground paint', () => {
    const { svg } = draw(BASE + BODY);
    expect(svg.innerHTML).not.toContain(ground.groundFill);
    expect(svg.innerHTML).not.toContain('seq-arrowhead-ground');
  });

  it('the gallery fixture parses with no warnings', () => {
    const src = readFileSync(
      'gallery/fixtures/sequence-highlight.dgmo',
      'utf8'
    );
    const diags = parseDgmo(src).diagnostics;
    expect(diags.filter((d) => d.severity === 'warning')).toEqual([]);
  });
});
