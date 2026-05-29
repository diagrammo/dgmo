import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { parseRaci } from '../src/raci/parser';
import { renderRaci } from '../src/raci/renderer';
import { parseMindmap } from '../src/mindmap/parser';
import { layoutMindmap } from '../src/mindmap/layout';
import { renderMindmap } from '../src/mindmap/renderer';
import { parseTechRadar } from '../src/tech-radar/parser';
import { renderTechRadar } from '../src/tech-radar/renderer';
import { parseVisualization, renderArcDiagram } from '../src/d3';
import { nordPalette } from '../src/palettes/nord';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

const fix = (name: string) =>
  readFileSync(resolve(__dirname, `../gallery/fixtures/${name}`), 'utf-8');

const fixTest = (name: string) =>
  readFileSync(resolve(__dirname, `fixtures/${name}`), 'utf-8');

const palette = nordPalette.light;

function makeContainer(w: number, h = 600): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', {
    value: w,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: h,
    configurable: true,
  });
  container.getBoundingClientRect = () =>
    ({
      width: w,
      height: h,
      top: 0,
      left: 0,
      bottom: h,
      right: w,
      x: 0,
      y: 0,
      toJSON: () => '',
    }) as DOMRect;
  document.body.appendChild(container);
  return container;
}

describe('compressed rendering (500px)', () => {
  it('sequence at 500px — fonts >= 9px, no overlap', () => {
    const content = fix('sequence.dgmo');
    const parsed = parseSequenceDgmo(content);
    const container = makeContainer(500);
    renderSequenceDiagram(container, parsed, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    const svgStr = svg!.outerHTML;
    const fontSizes = [...svgStr.matchAll(/font-size[=:]["']?([\d.]+)/g)].map(
      (m) => parseFloat(m[1]!)
    );
    for (const fs of fontSizes) {
      expect(fs).toBeGreaterThanOrEqual(9);
    }
    expect(svgStr).toMatchSnapshot();
  });

  it('raci at 500px — fonts >= 9px', () => {
    const content = fix('raci/voyage-operations.dgmo');
    const parsed = parseRaci(content, palette);
    const container = makeContainer(500);
    renderRaci(container, parsed, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    const svgStr = svg!.outerHTML;
    const fontSizes = [...svgStr.matchAll(/font-size[=:]["']?([\d.]+)/g)].map(
      (m) => parseFloat(m[1]!)
    );
    for (const fs of fontSizes) {
      expect(fs).toBeGreaterThanOrEqual(9);
    }
    // No full-SVG snapshot: raci compressed layout has FP-fragile geometry that
    // differs in the last digit across platforms (macOS vs CI Linux), causing
    // false mismatches. The `fonts >= 9px` invariant above is the real guard.
  });

  it('mindmap at 400px — fonts >= 9px', () => {
    const content = fixTest('mindmap/basic.dgmo');
    const parsed = parseMindmap(content, palette);
    const layout = layoutMindmap(parsed, palette);
    const container = makeContainer(400, 400);
    renderMindmap(container, parsed, layout, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    const svgStr = svg!.outerHTML;
    const fontSizes = [...svgStr.matchAll(/font-size[=:]["']?([\d.]+)/g)].map(
      (m) => parseFloat(m[1]!)
    );
    for (const fs of fontSizes) {
      expect(fs).toBeGreaterThanOrEqual(9);
    }
    // No full-SVG snapshot: mindmap compressed layout is FP-fragile across
    // platforms (macOS vs CI Linux). The `fonts >= 9px` invariant is the guard.
  });

  it('tech-radar at 500px — fonts >= 9px', () => {
    const content = fix('tech-radar.dgmo');
    const parsed = parseTechRadar(content);
    const container = makeContainer(500, 800);
    renderTechRadar(container, parsed, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    const svgStr = svg!.outerHTML;
    const fontSizes = [...svgStr.matchAll(/font-size[=:]["']?([\d.]+)/g)].map(
      (m) => parseFloat(m[1]!)
    );
    for (const fs of fontSizes) {
      expect(fs).toBeGreaterThanOrEqual(9);
    }
    expect(svgStr).toMatchSnapshot();
  });

  it('arc at 450px — fonts >= 9px', () => {
    const content = fix('arc.dgmo');
    const parsed = parseVisualization(content, palette);
    const container = makeContainer(450, 400);
    renderArcDiagram(container, parsed, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    const svgStr = svg!.outerHTML;
    const fontSizes = [...svgStr.matchAll(/font-size[=:]["']?([\d.]+)/g)].map(
      (m) => parseFloat(m[1]!)
    );
    for (const fs of fontSizes) {
      expect(fs).toBeGreaterThanOrEqual(9);
    }
    expect(svgStr).toMatchSnapshot();
  });
});

describe('below-floor rendering (300px)', () => {
  it('sequence at 300px — sets width=100%', () => {
    const content = fix('sequence.dgmo');
    const parsed = parseSequenceDgmo(content);
    const container = makeContainer(300);
    renderSequenceDiagram(container, parsed, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('100%');
    expect(svg!.getAttribute('viewBox')).toBeTruthy();
  });

  it('raci at 300px — sets width=100%', () => {
    const content = fix('raci/voyage-operations.dgmo');
    const parsed = parseRaci(content, palette);
    const container = makeContainer(300);
    renderRaci(container, parsed, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('100%');
  });

  it('mindmap at 150px — sets width=100% with viewBox', () => {
    const content = fixTest('mindmap/basic.dgmo');
    const parsed = parseMindmap(content, palette);
    const layout = layoutMindmap(parsed, palette);
    const container = makeContainer(150, 150);
    renderMindmap(container, parsed, layout, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('100%');
    expect(svg!.getAttribute('viewBox')).toBeTruthy();
  });

  it('tech-radar at 300px — sets width=100% with viewBox', () => {
    const content = fix('tech-radar.dgmo');
    const parsed = parseTechRadar(content);
    const container = makeContainer(300, 400);
    renderTechRadar(container, parsed, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('100%');
    expect(svg!.getAttribute('viewBox')).toBeTruthy();
  });

  it('arc at 80px — sets width=100% with viewBox', () => {
    const content = fix('arc.dgmo');
    const parsed = parseVisualization(content, palette);
    const container = makeContainer(80, 80);
    renderArcDiagram(container, parsed, palette, false);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('100%');
    expect(svg!.getAttribute('viewBox')).toBeTruthy();
  });
});
