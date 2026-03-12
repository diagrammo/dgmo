import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseD3, renderVenn } from '../src/d3';
import { getPalette } from '../src/palettes';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: win.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'SVGElement', { value: win.SVGElement, configurable: true });
});

const nordLight = getPalette('nord').light;

// ── Parser tests ──

describe('Venn parser — 2-set minimal', () => {
  it('parses two sets with names only', () => {
    const result = parseD3(`chart: venn
Apples
Oranges`, nordLight);
    expect(result.vennSets).toHaveLength(2);
    expect(result.vennSets[0].name).toBe('Apples');
    expect(result.vennSets[0].alias).toBeNull();
    expect(result.vennSets[0].color).toBeNull();
    expect(result.vennSets[1].name).toBe('Oranges');
    expect(result.error).toBeNull();
  });

  it('parses an optional intersection line', () => {
    const result = parseD3(`chart: venn
Apples
Oranges
Apples + Oranges: Cider`, nordLight);
    expect(result.vennOverlaps).toHaveLength(1);
    expect(result.vennOverlaps[0].sets).toEqual(['Apples', 'Oranges']);
    expect(result.vennOverlaps[0].label).toBe('Cider');
  });
});

describe('Venn parser — 3-set with aliases and colors', () => {
  it('parses aliases and resolves intersection references by alias', () => {
    const result = parseD3(`chart: venn
Frontend(blue) alias fe
Backend(green) alias be
DevOps(orange) alias de
fe + be: Web Systems
be + de: Platform Ops
fe + be + de: Full Stack`, nordLight);
    expect(result.error).toBeNull();
    expect(result.vennSets).toHaveLength(3);
    expect(result.vennSets[0].alias).toBe('fe');
    expect(result.vennSets[1].alias).toBe('be');
    expect(result.vennSets[2].alias).toBe('de');
    // Aliases resolved to canonical names
    expect(result.vennOverlaps.find(o => o.label === 'Web Systems')?.sets).toEqual(['Backend', 'Frontend'].sort());
    expect(result.vennOverlaps.find(o => o.label === 'Full Stack')?.sets).toHaveLength(3);
  });

  it('parses intersections with no label', () => {
    const result = parseD3(`chart: venn
A
B
C
A + B`, nordLight);
    expect(result.vennOverlaps).toHaveLength(1);
    expect(result.vennOverlaps[0].label).toBeNull();
  });
});

describe('Venn parser — named color resolution and fallback', () => {
  it('resolves known palette colors to hex', () => {
    const result = parseD3(`chart: venn
Alpha(blue)
Beta(green)`, nordLight);
    expect(result.vennSets[0].color).toMatch(/^#/);
    expect(result.vennSets[1].color).toMatch(/^#/);
    expect(result.error).toBeNull();
  });

  it('emits a warning and falls back to null for unknown color names', () => {
    const result = parseD3(`chart: venn
Alpha(magenta)
Beta`, nordLight);
    expect(result.vennSets[0].color).toBeNull();
    expect(result.diagnostics.some(d => d.message.includes('magenta'))).toBe(true);
  });
});

describe('Venn parser — validation errors', () => {
  it('emits error for > 3 sets', () => {
    const result = parseD3(`chart: venn
A
B
C
D`, nordLight);
    expect(result.error).toMatch(/2.3 sets/);
  });
});

// ── Renderer tests ──

function makeContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '500px';
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
  document.body.appendChild(container);
  return container;
}

describe('Venn renderer — circles and labels', () => {
  it('renders circles and set name labels into SVG', () => {
    const parsed = parseD3(`chart: venn
title: Test
Apples
Oranges
Apples + Oranges: Cider`, nordLight);
    const container = makeContainer();
    renderVenn(container, parsed, nordLight, false);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Two filled circles (non-interactive)
    const circles = container.querySelectorAll('circle[fill-opacity]');
    expect(circles.length).toBeGreaterThanOrEqual(2);
    // Set name labels appear in SVG text elements
    const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent);
    expect(texts.some(t => t?.includes('Apples'))).toBe(true);
    expect(texts.some(t => t?.includes('Oranges'))).toBe(true);
  });
});

describe('Venn renderer — hover targets for all regions', () => {
  it('creates hover targets for exclusive and intersection regions', () => {
    const parsed = parseD3(`chart: venn
Alpha
Beta
Gamma`, nordLight);
    const container = makeContainer();
    renderVenn(container, parsed, nordLight, false);
    // Expect: 3 full-circle exclusive targets + 4 intersection targets (3 pairs + 1 triple)
    // All are transparent circles — count those with fill="transparent"
    const transparentCircles = Array.from(container.querySelectorAll('circle[fill="transparent"]'));
    // 3 exclusive + 3 pair + 1 triple = 7 total
    expect(transparentCircles.length).toBe(7);
  });

  it('creates hover targets for 2-set diagram including overlap region', () => {
    const parsed = parseD3(`chart: venn
A
B`, nordLight);
    const container = makeContainer();
    renderVenn(container, parsed, nordLight, false);
    const transparentCircles = Array.from(container.querySelectorAll('circle[fill="transparent"]'));
    // 2 exclusive + 1 pair = 3 total
    expect(transparentCircles.length).toBe(3);
  });
});
