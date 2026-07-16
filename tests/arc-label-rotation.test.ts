// arc-label-rotation.test.ts — node labels rotate -45° when horizontal names
// would collide at the live-preview width. The export path sizes the canvas to
// the node count so it never collides; the collision only appears in the app's
// fixed-width preview container, which this test simulates by mocking clientWidth.

import { describe, it, expect, beforeAll } from 'vitest';
import { renderArcDiagram } from '../src/arc/renderer';
import { parseArc } from '../src/arc/parser';
import { getPalette } from '../src/palettes';
import { themeBaseBg } from '../src/palettes/color-utils';

function renderAt(source: string, widthPx: number): string {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: widthPx });
  Object.defineProperty(container, 'clientHeight', { value: 400 });
  document.body.appendChild(container);
  const parsed = parseArc(source);
  renderArcDiagram(container, parsed, getPalette('slate').light, false);
  const svg = container.querySelector('svg')!.outerHTML;
  container.remove();
  return svg;
}

// Long names, many nodes → tight per-node slot at a narrow preview width.
const DENSE = `arc Dense
order degree

Bartholomew -> Christopher 8
Bartholomew -> Maximillian 5
Alexandrina -> Wolfeschlegel 9
Alexandrina -> Featherstone 7
Constantine -> Maximillian 3
Christopher -> Featherstone 2
`;

/** Count node-label <text> elements carrying a rotate() transform. */
function rotatedLabelCount(svg: string): number {
  return [...svg.matchAll(/<text[^>]*transform="rotate\(-45[^"]*"/g)].length;
}

describe('arc node label rotation', () => {
  beforeAll(() => {
    // jsdom lacks layout; getBBox is unused by the arc label path.
  });

  it('rotates labels at a narrow preview width', () => {
    const svg = renderAt(DENSE, 480);
    expect(rotatedLabelCount(svg)).toBeGreaterThan(0);
  });

  it('keeps labels horizontal when there is room', () => {
    const svg = renderAt(DENSE, 1600);
    expect(rotatedLabelCount(svg)).toBe(0);
    // horizontal labels use text-anchor middle
    expect(svg).toContain('text-anchor="middle"');
  });
});

// Grouped arcs: bands take the group's own color, and at a narrow width the
// diagonal labels + group name must stay inside a taller band box.
const GROUPED = `arc Alliances
order appearance name, group, degree

[Caribbean] red
  Blackbeard -> Bonnet    8
  Blackbeard -> Hornigold 4
  Hornigold  -> Bonnet    2

[West Africa] teal
  Roberts -> Davis   6
  Davis   -> Roberts 10
`;

function bandRects(container: Element): SVGRectElement[] {
  return [
    ...container.querySelectorAll('rect.arc-group-band'),
  ] as SVGRectElement[];
}

function renderContainer(source: string, widthPx: number): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: widthPx });
  Object.defineProperty(container, 'clientHeight', { value: 400 });
  document.body.appendChild(container);
  renderArcDiagram(
    container,
    parseArc(source),
    getPalette('slate').light,
    false
  );
  return container;
}

describe('arc group bands', () => {
  it('fills each band with the group color', () => {
    const c = renderContainer(GROUPED, 1400);
    const parsed = parseArc(GROUPED);
    const rects = bandRects(c);
    expect(rects.length).toBe(2);
    const fills = rects.map((r) => r.getAttribute('fill'));
    for (const g of parsed.arcNodeGroups) expect(fills).toContain(g.color);
    c.remove();
  });

  it('grows the band below the baseline to enclose rotated labels', () => {
    const c = renderContainer(GROUPED, 340);
    // Narrow width forces rotation.
    expect(c.querySelector('text[transform^="rotate(-45"]')).not.toBeNull();
    const rect = bandRects(c)[0]!;
    const top = parseFloat(rect.getAttribute('y')!);
    const height = parseFloat(rect.getAttribute('height')!);
    const cy = parseFloat(c.querySelector('circle')!.getAttribute('cy')!);
    const above = cy - top;
    const below = top + height - cy;
    // Rotated labels drop below the baseline, so the band must reach further
    // down than up (a flat band would be symmetric about the baseline).
    expect(below).toBeGreaterThan(above * 1.2);
    c.remove();
  });
});

// §1.9 fill family on the linear arc: `fill-outline` hollows the node dots —
// theme base background fill, the node's color moved onto the stroke. The
// stroke-drawn arcs and the default dot treatment are untouched.
describe('arc fill-outline node dots (§1.9)', () => {
  const PLAIN = `arc Trade\nA -> B 5\nB -> C 4\nC -> A 3\n`;
  const OUTLINED = PLAIN.replace('\n', '\nfill-outline\n');
  const palette = getPalette('slate').light;

  function nodeDots(c: Element): { fill: string; stroke: string }[] {
    return [...c.querySelectorAll('g.arc-node circle')].map((el) => ({
      fill: el.getAttribute('fill')!,
      stroke: el.getAttribute('stroke')!,
    }));
  }

  it('parses bare `fill-outline` into fillMode', () => {
    expect(parseArc(OUTLINED).fillMode).toBe('outline');
    expect(parseArc(PLAIN).fillMode).toBeUndefined();
  });

  it('fill-outline renders hollow dots: theme bg fill, color on the stroke', () => {
    const base = renderContainer(PLAIN, 1400);
    const outlined = renderContainer(OUTLINED, 1400);
    const baseDots = nodeDots(base);
    const outlinedDots = nodeDots(outlined);
    const bg = themeBaseBg(palette, false);
    expect(outlinedDots.length).toBe(baseDots.length);
    expect(outlinedDots.length).toBe(3);
    outlinedDots.forEach((dot, i) => {
      // Hollow: theme base background fill; the color that used to be the
      // dot's fill now rides on the stroke.
      expect(dot.fill).toBe(bg);
      expect(dot.stroke).toBe(baseDots[i]!.fill);
    });
    base.remove();
    outlined.remove();
  });

  it('default dot rendering is unchanged (color fill, bg stroke)', () => {
    const c = renderContainer(PLAIN, 1400);
    const bg = themeBaseBg(palette, false);
    for (const dot of nodeDots(c)) {
      expect(dot.fill).not.toBe(bg);
      expect(dot.stroke).not.toBe(dot.fill);
    }
    c.remove();
  });
});
