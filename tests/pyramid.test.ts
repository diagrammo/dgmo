import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parsePyramid } from '../src/pyramid/parser';
import { renderPyramid } from '../src/pyramid/renderer';
import { getPalette } from '../src/palettes';
import { getRenderCategory } from '../src/dgmo-router';

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

const nordLight = getPalette('nord').light;

// ============================================================
// Parser tests
// ============================================================

describe('pyramid parser — basic', () => {
  it('parses title and layers', () => {
    const result = parsePyramid(`pyramid Maslow

Self-Actualization
Esteem
Love & Belonging
Safety
Physiological`);
    expect(result.type).toBe('pyramid');
    expect(result.title).toBe('Maslow');
    expect(result.layers).toHaveLength(5);
    expect(result.layers[0].label).toBe('Self-Actualization');
    expect(result.layers[4].label).toBe('Physiological');
    expect(result.inverted).toBe(false);
    expect(result.error).toBeNull();
  });

  it('requires at least 2 layers', () => {
    const result = parsePyramid(`pyramid One

Only`);
    expect(result.error).toMatch(/at least 2 layers/);
  });

  it('rejects more than 15 layers', () => {
    const layers = Array.from({ length: 16 }, (_, i) => `Layer${i}`).join('\n');
    const result = parsePyramid(`pyramid Big\n\n${layers}`);
    expect(result.error).toMatch(/at most 15 layers; got 16/);
  });

  it('rejects non-pyramid first line', () => {
    const result = parsePyramid('cycle OODA\n\nA\nB');
    expect(result.error).toMatch(/Expected "pyramid/);
  });
});

describe('pyramid parser — descriptions', () => {
  it('takes bare text after pipe as description', () => {
    const result = parsePyramid(`pyramid T

Top | description from pipe
Bottom`);
    expect(result.layers[0].description).toEqual(['description from pipe']);
    expect(result.layers[0].color).toBeUndefined();
  });

  it('takes indented lines as description', () => {
    const result = parsePyramid(`pyramid T

Top
  first line
  second line
Bottom`);
    expect(result.layers[0].description).toEqual(['first line', 'second line']);
  });

  it('parses key:value pipe metadata with color', () => {
    const result = parsePyramid(`pyramid T

Top | color: orange
  indented desc
Bottom`);
    expect(result.layers[0].color).toBe('orange');
    expect(result.layers[0].description).toEqual(['indented desc']);
  });

  it('description via pipe key and indented body merge', () => {
    const result = parsePyramid(`pyramid T

Top | color: blue, description: from-pipe
  from-indent
Bottom`);
    expect(result.layers[0].color).toBe('blue');
    expect(result.layers[0].description).toEqual(['from-pipe', 'from-indent']);
  });

  it('converts "- bullet" to "• bullet" in indented body', () => {
    const result = parsePyramid(`pyramid T

Top
  - first
  - second
Bottom`);
    expect(result.layers[0].description).toEqual(['• first', '• second']);
  });
});

describe('pyramid parser — directives', () => {
  it('inverted directive flips the flag', () => {
    const result = parsePyramid(`pyramid T

inverted

Top
Bottom`);
    expect(result.inverted).toBe(true);
  });
});

// ============================================================
// Router integration
// ============================================================

describe('pyramid router', () => {
  it('pyramid is a visualization render category', () => {
    expect(getRenderCategory('pyramid')).toBe('visualization');
  });
});

// ============================================================
// Renderer smoke tests
// ============================================================

describe('pyramid renderer', () => {
  it('renders SVG with one polygon per layer plus label + description', () => {
    const parsed = parsePyramid(`pyramid Test

One | first desc
Two | second desc
Three | third desc`);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    renderPyramid(container, parsed, nordLight, false);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll('polygon')).toHaveLength(3);
    // Three layer labels + three descriptions
    const textEls = svg!.querySelectorAll('text');
    expect(textEls.length).toBeGreaterThanOrEqual(6);
  });

  it('inverted flips top/bottom widths', () => {
    const upright = parsePyramid(`pyramid U

A
B
C`);
    const inverted = parsePyramid(`pyramid I

inverted

A
B
C`);
    const c1 = document.createElement('div');
    const c2 = document.createElement('div');
    for (const c of [c1, c2]) {
      Object.defineProperty(c, 'clientWidth', { value: 800 });
      Object.defineProperty(c, 'clientHeight', { value: 600 });
    }
    renderPyramid(c1, upright, nordLight, false);
    renderPyramid(c2, inverted, nordLight, false);

    // The first polygon of upright is the apex triangle (narrow top).
    // The first polygon of inverted is a trapezoid (wide top, narrow bottom).
    const up0 = c1.querySelector('polygon')!.getAttribute('points')!;
    const inv0 = c2.querySelector('polygon')!.getAttribute('points')!;
    expect(up0).not.toEqual(inv0);
  });
});
