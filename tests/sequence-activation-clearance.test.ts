// ============================================================
// Activation bars must not collide with message lines
// ============================================================
//
// A bar closed by an explicit return ends on that return, which is its own
// arrow leaving it. A bar with no return has nothing of its own to end on, so
// it runs to whatever happens next — and that next message is very often one
// between two OTHER participants crossing this column, which put its line
// exactly on the bar's bottom edge and made the bar read as though it
// terminated in an arrow.
//
// Reported 2026-08-10 against a diagram where three bars did this at once.
// Note what does NOT fix it: more vertical space. The edge is pinned to the
// next message's Y, so moving that message moves the edge with it.

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { getPalette } from '../src/palettes';

let doc: Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  doc = win.document;
  for (const [key, value] of [
    ['document', doc],
    ['window', win],
    ['navigator', win.navigator],
    ['HTMLElement', win.HTMLElement],
    ['SVGElement', win.SVGElement],
  ] as const) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const palette = getPalette('nord').light;

function render(input: string): SVGSVGElement {
  const parsed = parseSequenceDgmo(input);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  doc.body.appendChild(container);
  renderSequenceDiagram(container, parsed, palette, false, undefined, {
    exportWidth: 1400,
  });
  const svg = container.querySelector('svg')!;
  doc.body.removeChild(container);
  return svg;
}

interface Bar {
  x: number;
  w: number;
  top: number;
  bottom: number;
}

/** The activation rectangles, deduplicated across the mask/fill pair. */
function activationBars(svg: SVGSVGElement): Bar[] {
  const seen = new Set<string>();
  const bars: Bar[] = [];
  for (const rect of svg.querySelectorAll('rect')) {
    const x = Number(rect.getAttribute('x'));
    const y = Number(rect.getAttribute('y'));
    const w = Number(rect.getAttribute('width'));
    const h = Number(rect.getAttribute('height'));
    // Activation bars are the only narrow, tall rects on the canvas
    if (!(w > 8 && w < 14 && h > 5)) continue;
    const key = `${x},${y},${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bars.push({ x, w, top: y, bottom: y + h });
  }
  return bars;
}

/** Horizontal message lines, as (y, left, right). */
function messageLines(
  svg: SVGSVGElement
): Array<{ y: number; left: number; right: number }> {
  return [...svg.querySelectorAll('line')]
    .map((l) => ({
      y1: Number(l.getAttribute('y1')),
      y2: Number(l.getAttribute('y2')),
      x1: Number(l.getAttribute('x1')),
      x2: Number(l.getAttribute('x2')),
    }))
    .filter((l) => Math.abs(l.y1 - l.y2) < 0.6 && Math.abs(l.x2 - l.x1) > 20)
    .map((l) => ({
      y: l.y1,
      left: Math.min(l.x1, l.x2),
      right: Math.max(l.x1, l.x2),
    }));
}

/**
 * Every case of a message line sitting on the edge of a bar it does not
 * belong to. A line that STARTS or ENDS at the bar's column is that bar's own
 * arrow and is supposed to touch it.
 */
function edgeCollisions(svg: SVGSVGElement, tolerance = 3): string[] {
  const found: string[] = [];
  for (const bar of activationBars(svg)) {
    for (const line of messageLines(svg)) {
      if (line.left >= bar.x + bar.w || line.right <= bar.x) continue;
      const isOwnArrow =
        Math.abs(line.left - (bar.x + bar.w)) < 14 ||
        Math.abs(line.right - bar.x) < 14;
      if (isOwnArrow) continue;
      if (
        Math.abs(line.y - bar.top) <= tolerance ||
        Math.abs(line.y - bar.bottom) <= tolerance
      ) {
        found.push(
          `bar x=${bar.x} ${bar.top}..${bar.bottom} vs line y=${line.y}`
        );
      }
    }
  }
  return found;
}

describe('activation bars and message lines', () => {
  // The reported diagram, reduced: one caller fanning out to several callees,
  // none of them returning, with later messages crossing the columns of the
  // earlier ones. Camera→Store crosses Cache's column; Camera→Audit crosses
  // Screen's.
  const fanOut = [
    'Fan -show-> Camera',
    'Camera -getInventory-> Cache',
    'Camera -showCount-> Store',
    'Camera -hello-> Screen',
    'Camera -validate-> Audit',
  ].join('\n');

  it('keeps a message line off the edge of a bar it is only passing', () => {
    expect(edgeCollisions(render(fanOut))).toEqual([]);
  });

  it('stops an unreturned bar short of the next message', () => {
    const svg = render(fanOut);
    const bars = activationBars(svg).sort((a, b) => a.top - b.top);
    const lines = messageLines(svg).map((l) => l.y);
    // Every bar here is closed implicitly, so no bottom edge may land on a
    // message line — including its own column's later traffic
    for (const bar of bars) {
      for (const y of lines) {
        expect(Math.abs(bar.bottom - y)).toBeGreaterThan(2);
      }
    }
  });

  it('still gives every bar a visible height', () => {
    for (const bar of activationBars(render(fanOut))) {
      expect(bar.bottom - bar.top).toBeGreaterThan(10);
    }
  });

  it('leaves a bar closed by an explicit return ending on that return', () => {
    // The labeled return survives into the layout, so it is the bar's own
    // arrow and the bar is supposed to end exactly on it.
    const svg = render(
      ['Fan -show-> Camera', 'Camera -ok-> Fan', 'Fan -again-> Camera'].join(
        '\n'
      )
    );
    const bars = activationBars(svg).sort((a, b) => a.top - b.top);
    expect(bars.length).toBeGreaterThan(0);
    const lines = messageLines(svg).map((l) => l.y);
    const first = bars[0]!;
    expect(lines.some((y) => Math.abs(y - first.bottom) < 0.6)).toBe(true);
  });

  it('holds for nested calls and self-calls too', () => {
    const nested = [
      'Fan -show-> Camera',
      'Camera -query-> Store',
      'Store -check-> Store',
      'Camera -log-> Audit',
      'Camera -sweep-> Store',
    ].join('\n');
    expect(edgeCollisions(render(nested))).toEqual([]);
  });
});
