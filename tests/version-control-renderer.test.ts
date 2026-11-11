import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { parseVersionControl } from '../src/version-control/parser';
import { renderVersionControl } from '../src/version-control/renderer';
import { getPalette } from '../src/palettes';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  for (const k of ['document', 'window', 'HTMLElement', 'SVGElement'] as const)
    Object.defineProperty(globalThis, k, {
      value: k === 'document' ? dom.window.document : (dom.window as never)[k],
      configurable: true,
    });
});

const SRC = `version-control Flow

main
  Initial commit
  Add README

develop from main
  Set up CI
  Add test suite

main
  merge develop tag: v1.0.0
  Hotfix typo`;

describe('version-control message labels', () => {
  it('sit near their dots: most leaders stay short', () => {
    const parsed = parseVersionControl(SRC);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1200 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    renderVersionControl(
      container as unknown as HTMLDivElement,
      parsed,
      getPalette('nord').light,
      false
    );
    const leaders = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke-width') === '1.5'
    );
    expect(leaders.length).toBeGreaterThan(0);
    const lengths = leaders.map((l) =>
      Math.hypot(
        +l.getAttribute('x2')! - +l.getAttribute('x1')!,
        +l.getAttribute('y2')! - +l.getAttribute('y1')!
      )
    );
    // A shelf under its own lane is ~8 units below the dot; the old band
    // layout put every leader 60+ units out.
    const near = lengths.filter((n) => n <= 60).length;
    expect(near).toBeGreaterThanOrEqual(Math.ceil(lengths.length / 2));
  });

  // Issue diagrammo/diagrammo#1920: in the gallery fixture three labels fell
  // to the band below the lanes on long leaders. Every one must now sit
  // within one lane gap (50) of its dot, and no shelf may overlap another.
  it('gallery fixture: every leader within one lane gap, no shelf overlap', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../gallery/fixtures/version-control.dgmo'),
      'utf8'
    );
    const container = document.createElement('div');
    renderVersionControl(
      container as unknown as HTMLDivElement,
      parseVersionControl(src),
      getPalette('nord').light,
      false,
      undefined,
      { width: 1200, height: 600 }
    );
    const lengths = [...container.querySelectorAll('line')]
      .filter((l) => l.getAttribute('stroke-width') === '1.5')
      .map((l) =>
        Math.hypot(
          +l.getAttribute('x2')! - +l.getAttribute('x1')!,
          +l.getAttribute('y2')! - +l.getAttribute('y1')!
        )
      );
    expect(lengths.length).toBe(10);
    for (const n of lengths) expect(n).toBeLessThanOrEqual(50);
    const shelves = [...container.querySelectorAll('rect[height="21"]')].map(
      (r) => ({
        l: +r.getAttribute('x')!,
        t: +r.getAttribute('y')!,
        r: +r.getAttribute('x')! + +r.getAttribute('width')!,
        b: +r.getAttribute('y')! + 21,
      })
    );
    expect(shelves.length).toBe(20); // body + clip rect per shelf
    const bodies = shelves.filter((_, i) => i % 2 === 1);
    for (const [i, a] of bodies.entries())
      for (const b of bodies.slice(i + 1))
        expect(a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t).toBe(false);
  });
});
