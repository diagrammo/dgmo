import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseVisualization, renderVenn } from '../src/d3';
import { getPalette } from '../src/palettes';

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

// ── Parser tests ──

describe('Venn parser — 2-set minimal', () => {
  it('parses two sets with names only', () => {
    const result = parseVisualization(
      `venn
Apples
Oranges`,
      nordLight
    );
    expect(result.vennSets).toHaveLength(2);
    expect(result.vennSets[0].name).toBe('Apples');
    expect(result.vennSets[0].alias).toBeNull();
    expect(result.vennSets[0].color).toBeNull();
    expect(result.vennSets[1].name).toBe('Oranges');
    expect(result.error).toBeNull();
  });

  it('parses an optional intersection line', () => {
    const result = parseVisualization(
      `venn
Apples
Oranges
Apples + Oranges Cider`,
      nordLight
    );
    expect(result.vennOverlaps).toHaveLength(1);
    expect(result.vennOverlaps[0].sets).toEqual(['Apples', 'Oranges']);
    expect(result.vennOverlaps[0].label).toBe('Cider');
  });
});

describe('Venn parser — 3-set with aliases and colors', () => {
  it('parses aliases and resolves intersection references by alias', () => {
    const result = parseVisualization(
      `venn
Frontend as fe blue
Backend as be green
DevOps as de orange
fe + be Web Systems
be + de Platform Ops
fe + be + de Full Stack`,
      nordLight
    );
    expect(result.error).toBeNull();
    expect(result.vennSets).toHaveLength(3);
    expect(result.vennSets[0].alias).toBe('fe');
    expect(result.vennSets[1].alias).toBe('be');
    expect(result.vennSets[2].alias).toBe('de');
    // Aliases resolved to canonical names
    expect(
      result.vennOverlaps.find((o) => o.label === 'Web Systems')?.sets
    ).toEqual(['Backend', 'Frontend'].sort());
    expect(
      result.vennOverlaps.find((o) => o.label === 'Full Stack')?.sets
    ).toHaveLength(3);
  });

  it('parses intersections with no label', () => {
    const result = parseVisualization(
      `venn
A
B
C
A + B`,
      nordLight
    );
    expect(result.vennOverlaps).toHaveLength(1);
    expect(result.vennOverlaps[0].label).toBeNull();
  });
});

describe('Venn parser — named color resolution and fallback', () => {
  it('resolves known palette colors to hex', () => {
    const result = parseVisualization(
      `venn
Alpha blue
Beta green`,
      nordLight
    );
    expect(result.vennSets[0].color).toMatch(/^#/);
    expect(result.vennSets[1].color).toMatch(/^#/);
    expect(result.error).toBeNull();
  });

  it.skip('emits a warning and falls back to null for unknown color names (obsolete: silent-typo design per §1.5)', () => {
    const result = parseVisualization(
      `venn
Alpha(magenta)
Beta`,
      nordLight
    );
    expect(result.vennSets[0].color).toBeNull();
    expect(result.diagnostics.some((d) => d.message.includes('magenta'))).toBe(
      true
    );
  });
});

describe('Venn parser — validation errors', () => {
  it('emits error for > 3 sets', () => {
    const result = parseVisualization(
      `venn
A
B
C
D`,
      nordLight
    );
    expect(result.error).toMatch(/2.3 sets/);
  });
});

// ── Renderer tests ──

function makeContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '500px';
  Object.defineProperty(container, 'clientWidth', {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: 500,
    configurable: true,
  });
  document.body.appendChild(container);
  return container;
}

describe('Venn renderer — circles and labels', () => {
  it('renders circles and set name labels into SVG', () => {
    const parsed = parseVisualization(
      `venn Test
Apples
Oranges
Apples + Oranges Cider`,
      nordLight
    );
    const container = makeContainer();
    renderVenn(container, parsed, nordLight, false);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Two filled circles (non-interactive)
    const circles = container.querySelectorAll('circle[fill-opacity]');
    expect(circles.length).toBeGreaterThanOrEqual(2);
    // Set name labels appear in SVG text elements
    const texts = Array.from(container.querySelectorAll('text')).map(
      (t) => t.textContent
    );
    expect(texts.some((t) => t?.includes('Apples'))).toBe(true);
    expect(texts.some((t) => t?.includes('Oranges'))).toBe(true);
  });
});

describe('Venn renderer — hover targets for all regions', () => {
  it('creates hover targets for exclusive and intersection regions', () => {
    const parsed = parseVisualization(
      `venn
Alpha
Beta
Gamma`,
      nordLight
    );
    const container = makeContainer();
    renderVenn(container, parsed, nordLight, false);
    // Expect: 3 full-circle exclusive targets + 4 intersection targets (3 pairs + 1 triple)
    // All are transparent circles — count those with fill="transparent"
    const transparentCircles = Array.from(
      container.querySelectorAll('circle[fill="transparent"]')
    );
    // 3 exclusive + 3 pair + 1 triple = 7 total
    expect(transparentCircles.length).toBe(7);
  });

  it('creates hover targets for 2-set diagram including overlap region', () => {
    const parsed = parseVisualization(
      `venn
A
B`,
      nordLight
    );
    const container = makeContainer();
    renderVenn(container, parsed, nordLight, false);
    const transparentCircles = Array.from(
      container.querySelectorAll('circle[fill="transparent"]')
    );
    // 2 exclusive + 1 pair = 3 total
    expect(transparentCircles.length).toBe(3);
  });
});

describe('Venn renderer — set-name leaders stay off the all-sets leader (#1717)', () => {
  // Long names push every set label outside its circle; the all-sets leader
  // runs straight up from the triple centroid through the top set.
  const source = `venn Skills Shared Across the Research Organisation
Statistical modelling and experimental design as st blue
Large-scale data engineering and pipeline operations as de green
Domain expertise in clinical trials and patient outcomes as cl orange
st + de Reproducible analysis pipelines that run on every data refresh
de + cl Trial data platforms that meet regulatory audit requirements
st + cl Biostatistics for adaptive and multi-arm trial designs
st + de + cl Translational research teams that ship evidence to clinicians`;

  type Seg = { x1: number; y1: number; x2: number; y2: number };
  const segOf = (l: Element): Seg => ({
    x1: Number(l.getAttribute('x1')),
    y1: Number(l.getAttribute('y1')),
    x2: Number(l.getAttribute('x2')),
    y2: Number(l.getAttribute('y2')),
  });

  for (const dims of [
    { width: 1200, height: 800 },
    { width: 800, height: 500 },
  ]) {
    it(`no set-name stub shares the triple leader's line at ${dims.width}x${dims.height}`, () => {
      const parsed = parseVisualization(source, nordLight);
      const container = makeContainer();
      renderVenn(container, parsed, nordLight, false, undefined, dims);
      const lines = Array.from(container.querySelectorAll('line'));
      // Set-name stubs are drawn at stroke-width 1; overlap leaders at 1.25.
      const stubs = lines
        .filter((l) => l.getAttribute('stroke-width') === '1')
        .map(segOf);
      const leaders = lines
        .filter((l) => l.getAttribute('stroke-width') === '1.25')
        .map(segOf);
      expect(stubs).toHaveLength(3);
      // The triple leader is the longest vertical overlap leader going up.
      const triple = leaders
        .filter((s) => Math.abs(s.x1 - s.x2) < 1e-6 && s.y2 < s.y1)
        .sort((a, b) => b.y1 - b.y2 - (a.y1 - a.y2))[0]!;
      expect(triple).toBeDefined();
      for (const s of stubs) {
        const lo = Math.min(s.x1, s.x2);
        const hi = Math.max(s.x1, s.x2);
        const gap =
          triple.x1 >= lo && triple.x1 <= hi
            ? 0
            : Math.min(Math.abs(lo - triple.x1), Math.abs(hi - triple.x1));
        const above = Math.min(s.y1, s.y2) < triple.y1;
        if (above) expect(gap).toBeGreaterThanOrEqual(6);
      }
    });
  }
});
