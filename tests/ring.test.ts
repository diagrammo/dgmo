import { describe, it, expect, beforeAll, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseRing } from '../src/ring/parser';
import { renderRing } from '../src/ring/renderer';
import { getPalette } from '../src/palettes';
import { getRenderCategory, parseDgmo } from '../src/dgmo-router';
import { COMPLETION_REGISTRY, PIPE_METADATA } from '../src/completion-registry';
import { CHART_TYPES as EDITOR_CHART_TYPES } from '../src/editor/keywords';
import { measureText } from '../src/utils/text-measure';

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
  it('takes same-line description: key as description', () => {
    const result = parseRing(`ring T

Inner description: a description
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

  it('parses same-line color metadata', () => {
    const result = parseRing(`ring T

Inner color: orange
  indented desc
Outer`);
    expect(result.layers[0].color).toBe('orange');
    expect(result.layers[0].description).toEqual(['indented desc']);
  });

  it('same-line color + description merge with indented body', () => {
    const result = parseRing(`ring T

Inner color: blue, description: from-same-line
  from-indent
Outer`);
    expect(result.layers[0].color).toBe('blue');
    expect(result.layers[0].description).toEqual([
      'from-same-line',
      'from-indent',
    ]);
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

Inner color: chartreuse
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

  it('captures fill-solid directive', () => {
    const result = parseRing(`ring T

fill-solid

Inner
Outer`);
    expect(result.options['fill-solid']).toBe('on');
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
  it('renders one shape per layer (circle for innermost, path for outer rings)', () => {
    const parsed = parseRing(`ring Test

Inner description: first desc
Middle description: second desc
Outer description: third desc`);
    const container = makeContainer();
    renderRing(container, parsed, nordLight, false);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Innermost is a <circle>; the other two rings are annular <path>s with
    // fill-rule="evenodd".
    expect(svg!.querySelectorAll('g.ring-layer > circle')).toHaveLength(1);
    expect(svg!.querySelectorAll('g.ring-layer > path')).toHaveLength(2);

    // Each layer's <g> wrapper carries data-line-number, in source order
    // (innermost first).
    const ringLayers = svg!.querySelectorAll('g.ring-layer');
    expect(ringLayers).toHaveLength(3);
    expect(ringLayers[0].getAttribute('data-line-number')).toBe(
      String(parsed.layers[0].lineNumber)
    );

    // Side description list is present (one per layer) plus accent rects.
    expect(svg!.querySelectorAll('g.ring-desc')).toHaveLength(3);

    // Contrast stroke present and visible on every ring shape (Decision 14).
    const shapes = svg!.querySelectorAll(
      'g.ring-layer > circle, g.ring-layer > path'
    );
    for (const s of Array.from(shapes)) {
      expect(s.getAttribute('stroke-width')).toBe('1');
      expect(s.getAttribute('stroke')).toBeTruthy();
      const opacity = parseFloat(s.getAttribute('stroke-opacity') ?? '0');
      expect(opacity).toBeGreaterThan(0.2);
    }

    // At least one per-ring label + chart title rendered.
    expect(svg!.querySelectorAll('text.ring-label')).toHaveLength(3);
  });

  it('innermost layer is a filled circle (no inner cutout)', () => {
    const parsed = parseRing(`ring T

A
B
C`);
    const container = makeContainer();
    renderRing(container, parsed, nordLight, false);
    const svg = container.querySelector('svg')!;
    // Innermost = layer 0; rendered first, so it's the FIRST ring-layer
    // <g> in document order.
    const ringLayers = svg.querySelectorAll('g.ring-layer');
    const innermost = ringLayers[0];
    expect(innermost.getAttribute('data-line-number')).toBe(
      String(parsed.layers[0].lineNumber)
    );
    const innerCircle = innermost.querySelector('circle');
    expect(innerCircle).not.toBeNull();
    // No inner cutout — plain <circle>, no mask, no clipPath, no path.
    expect(innerCircle!.getAttribute('fill')).toBeTruthy();
    expect(innerCircle!.getAttribute('mask')).toBeNull();
    expect(innerCircle!.getAttribute('clip-path')).toBeNull();
    expect(innermost.querySelector('path')).toBeNull();
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
    // Innermost = layer 0 = FIRST ring-layer in document order.
    const innermost = ringLayers[0] as SVGGElement;
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
    // Outermost = last layer (N-1) = LAST ring-layer in document order.
    const outermost = ringLayers[ringLayers.length - 1] as SVGGElement;
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

  // (chart-type suggestion for ring moved to dgmo-mcp/tests/suggest.test.ts —
  // selection is no longer part of the render library.)

  it('completion registry exposes ring directives (AC 14)', () => {
    const spec = COMPLETION_REGISTRY.get('ring');
    expect(spec).toBeDefined();
    // fill-solid is mixed in for ring (it's in SOLID_FILL_CAPABLE).
    expect(spec!.directives['fill-solid']).toBeDefined();
    // color/description are layer pipe metadata (spec §24.4), not
    // directives — they live in PIPE_METADATA under the `layer` context.
    const pipe = PIPE_METADATA.get('ring');
    expect(pipe).toBeDefined();
    expect(pipe!.layer['color']).toBeDefined();
    expect(pipe!.layer['description']).toBeDefined();
  });

  it('editor keywords set includes ring (AC 14)', () => {
    expect(EDITOR_CHART_TYPES.has('ring')).toBe(true);
  });
});

// ============================================================
// Pressure — long labels stay on the canvas and never overprint (#2461)
// ============================================================

describe('ring — long labels (#2461)', () => {
  const words =
    'an extremely long ring label that keeps going well past any arc the ring could hold and then some more words to fill it right up to the end here';
  const long = (i: number) => `R${i} ${words}`.slice(0, 150);
  const desc =
    'A long description of this ring that runs for several lines in the side column so the stack has to shrink its line cap to fit the canvas height.';
  const fixture = (withDesc: boolean) =>
    [
      'ring Pressure: break long labels',
      '',
      ...Array.from({ length: 6 }, (_, i) =>
        withDesc ? `${long(i)}\n  ${desc}` : long(i)
      ),
    ].join('\n');

  interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    text: string;
  }

  function straightBoxes(svg: SVGSVGElement): Box[] {
    const boxes: Box[] = [];
    for (const t of Array.from(svg.querySelectorAll('text'))) {
      if (t.querySelector('textPath')) continue;
      const fs = Number(t.getAttribute('font-size'));
      const bold = t.getAttribute('font-weight') === 'bold';
      const anchor = t.getAttribute('text-anchor') ?? 'start';
      const tspans = Array.from(t.querySelectorAll('tspan[y]'));
      const rows = tspans.length
        ? tspans.map((s) => ({
            x: Number(s.getAttribute('x')),
            y: Number(s.getAttribute('y')),
            s: s.textContent ?? '',
          }))
        : [
            {
              x: Number(t.getAttribute('x')),
              y:
                Number(t.getAttribute('y')) +
                (t.getAttribute('dy') === '0.35em' ? fs * 0.35 : 0),
              s: t.textContent ?? '',
            },
          ];
      for (const r of rows) {
        const w = measureText(r.s, fs, { bold });
        const x0 =
          anchor === 'middle' ? r.x - w / 2 : anchor === 'end' ? r.x - w : r.x;
        boxes.push({
          x0,
          x1: x0 + w,
          y0: r.y - fs * 0.8,
          y1: r.y + fs * 0.25,
          text: r.s,
        });
      }
    }
    return boxes;
  }

  for (const [w, h, withDesc] of [
    [800, 600, true],
    [1400, 600, true],
    [800, 600, false],
    [600, 900, true],
  ] as const) {
    it(`${w}x${h} ${withDesc ? 'with' : 'without'} descriptions: every label inside the canvas, none overlapping`, () => {
      const parsed = parseRing(fixture(withDesc));
      expect(parsed.error).toBeNull();
      const container = makeContainer(w, h);
      renderRing(container, parsed, nordLight, false);
      const svg = container.querySelector('svg')!;

      const disc = svg.querySelector('g.ring-layer circle')!;
      const cx = Number(disc.getAttribute('cx'));
      const cy = Number(disc.getAttribute('cy'));
      const outerD = Array.from(svg.querySelectorAll('g.ring-layer path'))
        .at(-1)!
        .getAttribute('d')!;
      const R = cx - Number(outerD.split(' ')[1]);

      // Arc labels: top half of their own band, cut with … to the arc.
      const curved = Array.from(svg.querySelectorAll('text.ring-label')).filter(
        (t) => t.querySelector('textPath')
      );
      expect(curved).toHaveLength(5);
      for (const t of curved) {
        const id = t.querySelector('textPath')!.getAttribute('href')!.slice(1);
        const d = svg.querySelector(`path[id="${id}"]`)!.getAttribute('d')!;
        const [, x0, y0, , r, , , , , x1, y1] = d.split(' ').map(Number);
        expect(y0).toBeLessThanOrEqual(cy + 0.01);
        expect(y1).toBeLessThanOrEqual(cy + 0.01);
        const arc = 2 * r! * Math.asin(Math.min(1, (x1! - x0!) / (2 * r!)));
        const fs = Number(t.getAttribute('font-size'));
        const shown = t.textContent ?? '';
        expect(measureText(shown, fs, { bold: true })).toBeLessThanOrEqual(arc);
        expect(shown.endsWith('…')).toBe(true);
        expect(t.getAttribute('data-full-text')).toMatch(/^R\d /);
      }

      // Centre label moved out on a leader.
      const centre = svg.querySelector('text.ring-centre-label')!;
      expect(centre).not.toBeNull();
      expect(svg.querySelector('polyline.ring-label-leader')).not.toBeNull();

      const boxes = straightBoxes(svg);
      expect(boxes.length).toBeGreaterThan(1);
      for (const b of boxes) {
        expect(b.x0, b.text).toBeGreaterThanOrEqual(0);
        expect(b.y0, b.text).toBeGreaterThanOrEqual(0);
        expect(b.x1, b.text).toBeLessThanOrEqual(w);
        expect(b.y1, b.text).toBeLessThanOrEqual(h);
        // Off the rings: the nearest point of the box lies outside them.
        const nx = Math.max(b.x0, Math.min(cx, b.x1));
        const ny = Math.max(b.y0, Math.min(cy, b.y1));
        expect(Math.hypot(nx - cx, ny - cy), b.text).toBeGreaterThanOrEqual(R);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlap =
            a.x0 < b.x1 - 0.5 &&
            b.x0 < a.x1 - 0.5 &&
            a.y0 < b.y1 - 0.5 &&
            b.y0 < a.y1 - 0.5;
          expect(overlap, `${a.text} / ${b.text}`).toBe(false);
        }
      }
    });
  }

  it('description titles wrap, then end in …, with the full text kept', () => {
    const parsed = parseRing(fixture(true));
    const container = makeContainer(800, 600);
    renderRing(container, parsed, nordLight, false);
    const block = container.querySelector('g.ring-desc')!;
    const titles = Array.from(
      block.querySelectorAll('text[font-weight="bold"]')
    );
    expect(titles.length).toBeGreaterThan(1);
    expect(titles.at(-1)!.textContent!.endsWith('…')).toBe(true);
    expect(titles[0]!.getAttribute('data-full-text')).toBe(long(0));
  });

  it('a short centre label stays in the disc with no leader', () => {
    const parsed = parseRing('ring T\n\nCore\nMiddle\nOuter');
    const container = makeContainer(800, 600);
    renderRing(container, parsed, nordLight, false);
    const svg = container.querySelector('svg')!;
    expect(svg.querySelector('polyline.ring-label-leader')).toBeNull();
    expect(svg.querySelector('text.ring-centre-label')).toBeNull();
  });
});
