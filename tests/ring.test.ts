import { describe, it, expect, beforeAll, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseRing } from '../src/ring/parser';
import { renderRing } from '../src/ring/renderer';
import { getPalette } from '../src/palettes';
import { getRenderCategory, parseDgmo } from '../src/dgmo-router';
import { suggestChartTypes } from '../src/chart-type-scoring';
import { COMPLETION_REGISTRY } from '../src/completion';
import { CHART_TYPES as EDITOR_CHART_TYPES } from '../src/editor/keywords';

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

function makeContainer(width = 800, height = 600): HTMLDivElement {
  const c = document.createElement('div') as HTMLDivElement;
  Object.defineProperty(c, 'clientWidth', { value: width });
  Object.defineProperty(c, 'clientHeight', { value: height });
  return c;
}

// ============================================================
// Parser — basic
// ============================================================

describe('ring parser — basic', () => {
  it('parses title and layers (innermost first)', () => {
    const result = parseRing(`ring Captain's Sphere

Captain
Quartermaster
Crew
Allies`);
    expect(result.type).toBe('ring');
    expect(result.title).toBe("Captain's Sphere");
    expect(result.layers).toHaveLength(4);
    expect(result.layers[0].label).toBe('Captain');
    expect(result.layers[3].label).toBe('Allies');
    expect(result.error).toBeNull();
  });

  it('requires at least 2 layers', () => {
    const result = parseRing(`ring One

Only`);
    expect(result.error).toMatch(/at least 2 layers/);
  });

  it('rejects more than 15 layers', () => {
    const layers = Array.from({ length: 16 }, (_, i) => `Ring${i}`).join('\n');
    const result = parseRing(`ring Big\n\n${layers}`);
    expect(result.error).toMatch(/at most 15 layers; got 16/);
  });

  it('rejects non-ring first line', () => {
    const result = parseRing('pyramid Foo\n\nA\nB');
    expect(result.error).toMatch(/Expected "ring/);
  });
});

// ============================================================
// Parser — descriptions
// ============================================================

describe('ring parser — descriptions', () => {
  it('takes bare text after pipe as description', () => {
    const result = parseRing(`ring T

Inner | a description
Outer`);
    expect(result.layers[0].description).toEqual(['a description']);
    expect(result.layers[0].color).toBeUndefined();
  });

  it('takes indented lines as description', () => {
    const result = parseRing(`ring T

Inner
  first line
  second line
Outer`);
    expect(result.layers[0].description).toEqual(['first line', 'second line']);
  });

  it('parses key:value pipe metadata with color', () => {
    const result = parseRing(`ring T

Inner | color: orange
  indented desc
Outer`);
    expect(result.layers[0].color).toBe('orange');
    expect(result.layers[0].description).toEqual(['indented desc']);
  });

  it('description via pipe key and indented body merge', () => {
    const result = parseRing(`ring T

Inner | color: blue, description: from-pipe
  from-indent
Outer`);
    expect(result.layers[0].color).toBe('blue');
    expect(result.layers[0].description).toEqual(['from-pipe', 'from-indent']);
  });

  it('converts "- bullet" to "• bullet" in indented body', () => {
    const result = parseRing(`ring T

Inner
  - first
  - second
Outer`);
    expect(result.layers[0].description).toEqual(['• first', '• second']);
  });
});

// ============================================================
// Parser — directives, errors and diagnostics
// ============================================================

describe('ring parser — errors and diagnostics', () => {
  it('emits error-severity diagnostic on unknown color and falls back', () => {
    const result = parseRing(`ring T

Inner | color: chartreuse
Outer`);
    expect(result.error).toBeNull();
    expect(result.layers[0].color).toBeUndefined();
    const diag = result.diagnostics.find((d) =>
      d.message.includes('Unknown color "chartreuse"')
    );
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
  });

  it('emits error-severity diagnostic on stray "inverted" and discards line', () => {
    const result = parseRing(`ring T

inverted

Inner
Outer`);
    expect(result.error).toBeNull();
    expect(
      result.layers.some((l) => l.label.toLowerCase() === 'inverted')
    ).toBe(false);
    const diag = result.diagnostics.find((d) =>
      d.message.includes('"inverted" is not supported on ring diagrams')
    );
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
  });

  it('captures solid-fill directive', () => {
    const result = parseRing(`ring T

solid-fill

Inner
Outer`);
    expect(result.options['solid-fill']).toBe('on');
  });
});

// ============================================================
// Router integration
// ============================================================

describe('ring router', () => {
  it('ring is a visualization render category', () => {
    expect(getRenderCategory('ring')).toBe('visualization');
  });
});

// ============================================================
// Renderer smoke tests
// ============================================================

describe('ring renderer', () => {
  it('renders SVG with one circle per layer plus per-ring labels', () => {
    const parsed = parseRing(`ring Test

Inner | first desc
Middle | second desc
Outer | third desc`);
    const container = makeContainer();
    renderRing(container, parsed, nordLight, false);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const circles = svg!.querySelectorAll('circle');
    expect(circles.length).toBe(3);

    // Each layer's <g> wrapper carries data-line-number.
    const ringLayers = svg!.querySelectorAll('g.ring-layer');
    expect(ringLayers).toHaveLength(3);
    for (const g of Array.from(ringLayers)) {
      expect(g.getAttribute('data-line-number')).toBeTruthy();
    }

    // Side description list is present (one per layer) plus accent rects.
    const descBlocks = svg!.querySelectorAll('g.ring-desc');
    expect(descBlocks).toHaveLength(3);

    // Contrast stroke present and visible on rings (Decision 14).
    for (const c of Array.from(circles)) {
      expect(c.getAttribute('stroke-width')).toBe('1');
      expect(c.getAttribute('stroke')).toBeTruthy();
      const opacity = parseFloat(c.getAttribute('stroke-opacity') ?? '0');
      expect(opacity).toBeGreaterThan(0.2);
    }

    // At least one per-ring label + chart title rendered.
    const labels = svg!.querySelectorAll('text.ring-label');
    expect(labels).toHaveLength(3);
  });

  it('innermost layer is a filled circle (no inner cutout)', () => {
    const parsed = parseRing(`ring T

A
B
C`);
    const container = makeContainer();
    renderRing(container, parsed, nordLight, false);
    const svg = container.querySelector('svg')!;
    // Innermost = layer 0; rendering paints outermost first, so the innermost
    // <g> is the LAST ring-layer in document order.
    const ringLayers = svg.querySelectorAll('g.ring-layer');
    const innermost = ringLayers[ringLayers.length - 1];
    expect(innermost.getAttribute('data-line-number')).toBe(
      String(parsed.layers[0].lineNumber)
    );
    const innerCircle = innermost.querySelector('circle');
    expect(innerCircle).not.toBeNull();
    // No inner cutout — fill is set, no mask, no clipPath.
    expect(innerCircle!.getAttribute('fill')).toBeTruthy();
    expect(innerCircle!.getAttribute('mask')).toBeNull();
    expect(innerCircle!.getAttribute('clip-path')).toBeNull();
  });

  it('side description list is omitted when no descriptions are present', () => {
    const parsed = parseRing(`ring T

A
B
C`);
    const container = makeContainer();
    renderRing(container, parsed, nordLight, false);
    const svg = container.querySelector('svg')!;
    expect(svg.querySelectorAll('g.ring-desc')).toHaveLength(0);
  });

  it('click on the innermost ring <g> fires onClickItem with layer 0 line', () => {
    const parsed = parseRing(`ring T

A
B`);
    const container = makeContainer();
    const onClick = vi.fn();
    renderRing(container, parsed, nordLight, false, onClick);
    const svg = container.querySelector('svg')!;
    const ringLayers = svg.querySelectorAll('g.ring-layer');
    const innermost = ringLayers[ringLayers.length - 1] as SVGGElement;
    innermost.dispatchEvent(new window.Event('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(parsed.layers[0].lineNumber);
  });

  it('click on the outermost ring <g> fires onClickItem with the outer-layer line', () => {
    const parsed = parseRing(`ring T

A
B
C`);
    const container = makeContainer();
    const onClick = vi.fn();
    renderRing(container, parsed, nordLight, false, onClick);
    const svg = container.querySelector('svg')!;
    const ringLayers = svg.querySelectorAll('g.ring-layer');
    // Outermost = last layer (index N-1) is painted FIRST, so it's the
    // first ring-layer <g> in document order.
    const outermost = ringLayers[0] as SVGGElement;
    outermost.dispatchEvent(new window.Event('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(
      parsed.layers[parsed.layers.length - 1].lineNumber
    );
  });

  it('skips in-band labels when band thickness would force font below the floor (Decision 9)', () => {
    // 12 rings on an 800x600 canvas → thickness ~ outerRadius/12 ~ 24px,
    // natural font 24*0.45 ~ 11 < LABEL_FONT_MIN (12) → no in-band labels.
    const labels = Array.from({ length: 12 }, (_, i) => `Ring${i}`).join('\n');
    const parsed = parseRing(`ring Big\n\n${labels}`);
    expect(parsed.error).toBeNull();
    const container = makeContainer();
    renderRing(container, parsed, nordLight, false);
    const svg = container.querySelector('svg')!;
    expect(svg.querySelectorAll('text.ring-label')).toHaveLength(0);
    // Side list still shows the layer names so the user can read them.
    expect(svg.querySelectorAll('g.ring-desc')).toHaveLength(12);
  });
});

// ============================================================
// Wiring — chart-type catalog + completion + editor + dispatch
// ============================================================

describe('ring catalog and completion wiring', () => {
  it('parseDgmo dispatches `ring …` source through the ring parser', () => {
    const result = parseDgmo(`ring Test

A
B`);
    expect(result.chartType).toBe('ring');
  });

  it('chart-type suggestion engine ranks ring on its triggers (AC 13)', () => {
    for (const prompt of [
      'ring diagram',
      'concentric rings',
      'circles of influence',
    ]) {
      const top3 = suggestChartTypes(prompt)
        .ranked.slice(0, 3)
        .map((s) => s.type.id);
      expect(top3, `top-3 for ${JSON.stringify(prompt)}`).toContain('ring');
    }
  });

  it('completion registry exposes ring directives (AC 14)', () => {
    const spec = COMPLETION_REGISTRY.get('ring');
    expect(spec).toBeDefined();
    expect(spec!.directives['color']).toBeDefined();
    expect(spec!.directives['description']).toBeDefined();
    // solid-fill is mixed in for ring (it's in SOLID_FILL_CAPABLE).
    expect(spec!.directives['solid-fill']).toBeDefined();
  });

  it('editor keywords set includes ring (AC 14)', () => {
    expect(EDITOR_CHART_TYPES.has('ring')).toBe(true);
  });
});
