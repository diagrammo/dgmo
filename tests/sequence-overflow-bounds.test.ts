import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { measureText } from '../src/utils/text-measure';
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

// Many participants + long message labels force a tight scale factor (the app's
// live-preview path, which — unlike CLI export — does NOT pass exportWidth).
// A long first-message label overhangs left of the first lifeline and a long
// self-message label overhangs right of the last activation. Both must stay
// inside the viewBox.
const WIDE_SEQ = `sequence Availability Call
tag Layer as l
  Client blue
  API green
  Service yellow
  Inventory orange
  Domain purple

[Client]
  Caller l: Client

[API]
  AvailabilityV2Resource l: API
  AvailabilityRequestFactory l: API
  AvailabilityV2DataBeanFactory l: API
  BindingBeanFactory l: API

[Domain]
  ApiContextHolder l: Domain
  EventCache l: Domain
  SalesGroupCache l: Domain
  AppContextHolder l: Domain

[Service]
  EventService l: Service

[Inventory]
  InventoryService l: Inventory
  EventInventoryManager l: Inventory
  AvailabilityCache l: Inventory

Caller -GET /availability/events/{eventId}-> AvailabilityV2Resource
AvailabilityV2Resource -normalized query map-> ApiContextHolder
AvailabilityV2Resource -create request-> AvailabilityRequestFactory
AvailabilityV2Resource -getEvent(eventId)-> EventCache
AvailabilityV2Resource -getAvailabilityMap(request)-> EventService
EventService -getEventInventoryManager(eventId)-> InventoryService
InventoryService -getAvailability(criteria)-> EventInventoryManager
EventInventoryManager -lookup-> AvailabilityCache
EventInventoryManager -build summaries by availability type-> EventInventoryManager
EventInventoryManager -store wrapper-> AvailabilityCache`;

function renderAtWidth(input: string, width: number): SVGSVGElement {
  const parsed = parseSequenceDgmo(input);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  (
    container as unknown as { getBoundingClientRect: () => DOMRect }
  ).getBoundingClientRect = () =>
    ({
      width,
      height: 700,
      top: 0,
      left: 0,
      right: width,
      bottom: 700,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
  doc.body.appendChild(container);
  // No exportWidth → the scale-to-fit path the app uses.
  renderSequenceDiagram(container, parsed, getPalette('slate').light, false);
  const svg = container.querySelector('svg')!;
  doc.body.removeChild(container);
  return svg as unknown as SVGSVGElement;
}

describe('sequence message-label overflow bounds', () => {
  // Sweep container widths: below-, at-, and above-fit all exercise the
  // scale-clamp + pad-convergence paths.
  for (const width of [600, 800, 1100, 1500]) {
    it(`keeps every message label inside the viewBox at width ${width}`, () => {
      const svg = renderAtWidth(WIDE_SEQ, width);
      const [, , vbW] = svg.getAttribute('viewBox')!.split(' ').map(Number);
      expect(vbW).toBeGreaterThan(0);

      for (const el of svg.querySelectorAll('text.message-label')) {
        const x = parseFloat(el.getAttribute('x')!);
        const fontSize = parseFloat(el.getAttribute('font-size')!);
        const anchor = el.getAttribute('text-anchor');
        const w = measureText(el.textContent ?? '', fontSize);
        const left =
          anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
        const right =
          anchor === 'middle' ? x + w / 2 : anchor === 'end' ? x : x + w;
        expect(left, `left edge of "${el.textContent}"`).toBeGreaterThanOrEqual(
          0
        );
        expect(right, `right edge of "${el.textContent}"`).toBeLessThanOrEqual(
          vbW!
        );
      }
    });
  }
});
