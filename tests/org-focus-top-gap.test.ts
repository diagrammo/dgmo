import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseOrg, findOrgNodeIdByName } from '../src/org/parser';
import { layoutOrg } from '../src/org/layout';
import { renderOrg, ancestorTrailReserve } from '../src/org/renderer';
import { focusOrgTree } from '../src/org/collapse';
import { getPalette } from '../src/palettes';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of [
    ['document', win.document],
    ['window', win],
    ['navigator', win.navigator],
    ['HTMLElement', win.HTMLElement],
    ['SVGElement', win.SVGElement],
  ] as const) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const palette = getPalette('nord');

const SOURCE = `org Venue Engineering

tag Title as t
  Dir green
  SrSWE blue

Paul Zimny t: Dir
  Demian Neidetcher t: Dir
    John Planow t: Dir
      Venue Services t: Dir
        Selva t: Dir
          Santosh Vaswani t: SrSWE
          David Crook t: SrSWE
`;

function makeContainer(width = 1400, height = 1000): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: width });
  Object.defineProperty(container, 'clientHeight', { value: height });
  return container;
}

/** `translate(x, y) scale(s)` → the y. */
function translateY(el: Element | null): number {
  const m = /translate\([^,]+,\s*(-?[\d.]+)\)/.exec(
    el?.getAttribute('transform') ?? ''
  );
  return m ? Number(m[1]) : NaN;
}

function scaleOf(el: Element | null): number {
  const m = /scale\(([\d.]+)\)/.exec(el?.getAttribute('transform') ?? '');
  return m ? Number(m[1]) : NaN;
}

function renderFocused(target: string, width = 1400, height = 1000) {
  const parsed = parseOrg(SOURCE, palette.light);
  const focusId = findOrgNodeIdByName(parsed.roots, target)!;
  const focused = focusOrgTree(parsed, focusId)!;
  const layout = layoutOrg(focused.parsed);
  const container = makeContainer(width, height);
  renderOrg(
    container,
    focused.parsed,
    layout,
    palette.light,
    false,
    undefined,
    undefined,
    'Title',
    undefined,
    focused.ancestorPath
  );
  const svg = container.querySelector('svg')!;
  const groups = svg.querySelectorAll('g');
  return {
    layout,
    svg,
    mainY: translateY(groups[0]),
    scale: scaleOf(groups[0]),
    contentY: translateY(groups[1]),
    ancestors: focused.ancestorPath.length,
  };
}

/** Topmost ancestor-dot centre, in the scaled diagram's own coordinates. */
function topDotY(svg: Element, contentY: number): number {
  const dots = [...svg.querySelectorAll('.org-ancestor-node')].map((g) =>
    translateY(g)
  );
  return contentY + Math.min(...dots);
}

describe('focused org chart top gap (#325)', () => {
  it('starts the breadcrumb trail at the top of the diagram box, not ~100 units below it', () => {
    const { svg, contentY } = renderFocused('Selva');

    const top = topDotY(svg, contentY);
    // Before the fix this was 102: the full trail height was reserved on top of
    // the layout's own headroom, and the in-diagram legend band was counted
    // twice. Only the dot's own ink may sit above 0.
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(8);
  });

  it('keeps the whole chart inside the height it was scaled against', () => {
    const { layout, mainY, scale, contentY } = renderFocused(
      'Selva',
      1400,
      1000
    );
    const bottomNode = Math.max(
      ...layout.nodes.map((n) => n.y + n.height),
      ...layout.containers.map((c) => c.y + c.height)
    );
    const drawnBottom = mainY + (contentY + bottomNode) * scale;

    expect(drawnBottom).toBeLessThanOrEqual(1000);
  });

  it('takes back the in-diagram legend band when the legend is drawn fixed', () => {
    const parsed = parseOrg(SOURCE, palette.light);
    const layout = layoutOrg(parsed, undefined, 'Title');
    const container = makeContainer();
    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'Title'
    );
    const groups = container.querySelectorAll('svg g');
    const root = layout.nodes.find((n) => n.label === 'Paul Zimny')!;

    // The layout pushed everything down by the legend band; the fixed legend
    // renders outside the scaled group, so the content comes back up by it.
    expect(layout.legendShift).toBeGreaterThan(0);
    expect(translateY(groups[1]) + root.y).toBeCloseTo(
      root.y - layout.legendShift,
      5
    );
  });

  it('leaves the legend band in place for an export, where the legend draws inside', () => {
    const parsed = parseOrg(SOURCE, palette.light);
    const layout = layoutOrg(parsed, undefined, undefined, undefined, true);
    const container = makeContainer();
    renderOrg(container, parsed, layout, palette.light, false, undefined, {
      width: layout.width + 40,
      height: layout.height + 100,
    });
    const groups = container.querySelectorAll('svg g');

    // Export shift is the title band only — no legend unshift.
    expect(translateY(groups[1])).toBeGreaterThanOrEqual(0);
    expect(translateY(groups[1])).toBeLessThan(layout.legendShift + 40);
  });
});

describe('ancestorTrailReserve', () => {
  it('is zero when the space above the root already covers the trail', () => {
    expect(ancestorTrailReserve(4, 1000)).toBe(0);
    expect(ancestorTrailReserve(0, 0)).toBe(0);
  });

  it('charges nothing for the bottom dot, which sits in the gap above the root', () => {
    // 1 ancestor: bottom gap + the dot's own ink, no row height — where the
    // old formula charged a full row for it (1 * 22 + 16 = 38).
    expect(ancestorTrailReserve(1, 0)).toBeLessThan(38);
    // Each further ancestor is exactly one row.
    expect(ancestorTrailReserve(3, 0) - ancestorTrailReserve(2, 0)).toBe(22);
  });

  it('matches what the renderer actually draws above the root', () => {
    const { svg, contentY, layout, ancestors } = renderFocused('Selva');
    const root = layout.nodes[0]!;
    const drawnInk =
      root.y -
      Math.min(
        ...[...svg.querySelectorAll('.org-ancestor-node')].map((g) =>
          translateY(g)
        )
      );

    // The helper's reserve at zero headroom is the drawn ink plus the dot's
    // radius allowance — never less, or the trail would be clipped.
    expect(ancestorTrailReserve(ancestors, 0)).toBeGreaterThanOrEqual(drawnInk);
    expect(contentY + root.y).toBeGreaterThan(0);
  });
});
