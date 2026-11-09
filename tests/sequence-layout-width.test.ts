// The sequence lays itself out against its container's LAYOUT width, never
// the on-screen width a CSS transform above it produces (#1767).

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { getPalette } from '../src/palettes';

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

const SOURCE =
  'sequence Click To Pay\n\nUser -tap the card-> Wallet\n' +
  'Wallet -token request-> Network\nNetwork -token-> Wallet\n';

/** A container laid out `layout` px wide and shown `onScreen` px wide, the
 *  way an element under `transform: scale(onScreen / layout)` reports. */
function render(layout: number, onScreen: number): number {
  const parsed = parseSequenceDgmo(SOURCE);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  Object.defineProperty(container, 'clientWidth', { value: layout });
  container.getBoundingClientRect = () =>
    ({
      width: onScreen,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: onScreen,
      bottom: 0,
    }) as DOMRect;
  doc.body.appendChild(container);
  renderSequenceDiagram(container, parsed, getPalette('nord').light, false);
  const svg = container.querySelector('svg');
  doc.body.removeChild(container);
  const vb = svg?.getAttribute('viewBox')?.split(/\s+/).map(Number);
  return vb?.[2] ?? NaN;
}

describe('sequence layout width', () => {
  it('lays out at the layout width under a CSS scale', () => {
    // The finder's canvas: 885px of layout (900 less the scrollbar gutter)
    // shown at 0.3456 — 305.8px on screen.
    expect(render(885, 305.8)).toBe(885);
  });

  it('falls back to the on-screen width where there is no layout box', () => {
    expect(render(0, 640)).toBe(640);
  });
});
