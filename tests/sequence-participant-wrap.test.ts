import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { getPalette } from '../src/palettes';

// Set up jsdom globals for D3
let doc: Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
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

// Same participants as stress/sequence/long-labels--participants-and-messages.dgmo
// (#1421): two names wrap, one of them onto four lines at the capped box width.
const LONG_NAMES = `sequence Order Fulfilment
Customer Mobile Application
Order Management Service (EU region)
Warehouse Robotics Controller
Customer Mobile Application -submit order-> Order Management Service (EU region)
Order Management Service (EU region) -reserve stock-> Warehouse Robotics Controller
`;

function render(input: string): SVGSVGElement {
  const parsed = parseSequenceDgmo(input);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  doc.body.appendChild(container);
  renderSequenceDiagram(
    container,
    parsed,
    getPalette('slate').light,
    false,
    undefined,
    { exportWidth: 1200 }
  );
  const svg = container.querySelector('svg')!;
  doc.body.removeChild(container);
  return svg as unknown as SVGSVGElement;
}

interface Header {
  id: string;
  boxH: number;
  fontSize: number;
  lines: { text: string; baseline: number }[];
}

function headers(svg: SVGSVGElement): Header[] {
  return Array.from(svg.querySelectorAll('g.participant')).map((g) => {
    const rect = g.querySelector('rect')!;
    const text = g.querySelector('text')!;
    const fontSize = Number(text.getAttribute('font-size'));
    const tspans = Array.from(text.querySelectorAll('tspan'));
    let y = 0;
    const lines = tspans.length
      ? tspans.map((t) => {
          y += parseFloat(t.getAttribute('dy') ?? '0');
          return { text: t.textContent ?? '', baseline: y };
        })
      : [
          {
            text: text.textContent ?? '',
            baseline: Number(text.getAttribute('y')),
          },
        ];
    return {
      id: g.getAttribute('data-participant-id') ?? '',
      boxH: Number(rect.getAttribute('height')),
      fontSize,
      lines,
    };
  });
}

describe('sequence participant name wrapping (#1421)', () => {
  it('keeps the space where a name wraps', () => {
    const hs = headers(render(LONG_NAMES));
    for (const label of [
      'Customer Mobile Application',
      'Order Management Service (EU region)',
    ]) {
      const h = hs.find((x) => x.lines.map((l) => l.text).join(' ') === label);
      expect(h, `no header re-joins to "${label}"`).toBeDefined();
      expect(h!.lines.length).toBeGreaterThan(1);
    }
  });

  it('draws every header line inside its box, and every box is one height', () => {
    const hs = headers(render(LONG_NAMES));
    expect(Math.max(...hs.map((h) => h.lines.length))).toBeGreaterThan(3);
    const heights = new Set(hs.map((h) => h.boxH));
    expect(heights.size).toBe(1);
    for (const h of hs) {
      for (const line of h.lines) {
        // Inter's ascent and descent are about 0.73em and 0.24em.
        expect(line.baseline - 0.73 * h.fontSize).toBeGreaterThanOrEqual(0);
        expect(line.baseline + 0.24 * h.fontSize).toBeLessThanOrEqual(h.boxH);
      }
    }
  });

  it('leaves the default box height when no name wraps past three lines', () => {
    const hs = headers(render('sequence\nA -hi-> B\n'));
    expect(hs.map((h) => h.boxH)).toEqual([50, 50]);
  });
});
