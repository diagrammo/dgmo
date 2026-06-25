import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseBlock } from '../src/block/parser';
import {
  renderBlock,
  renderBlockForExport,
  authoredCollapsedIds,
} from '../src/block/renderer';
import { getPalette } from '../src/palettes';
import { getRenderCategory } from '../src/dgmo-router';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [k, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, k, { value, configurable: true });
  }
});

const nordLight = getPalette('nord').light;

function mount(w = 900, h = 600): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: w });
  Object.defineProperty(container, 'clientHeight', { value: h });
  return container;
}

/** Block cell whose header/label text is exactly `label` (cells are flat, so a
 *  container cell's textContent is just its own header). */
function cellByLabel(
  container: HTMLElement,
  label: string
): Element | undefined {
  return [...container.querySelectorAll('.dgmo-block-cell')].find(
    (c) => c.textContent?.trim() === label
  );
}

const SRC = `block Service Health

tag Status as s
  Healthy green
  Degraded orange

[Services] s: Healthy
  [Auth] [Orders] s: Degraded

[Data] s: Healthy collapsed
  [Postgres] [Redis]`;

describe('block renderer', () => {
  it('routes through the visualization category', () => {
    expect(getRenderCategory('block')).toBe('visualization');
  });

  it('emits the interactivity contract the app relies on', () => {
    const parsed = parseBlock(SRC, nordLight);
    const container = mount();
    renderBlockForExport(container, parsed, nordLight, false, {
      width: 900,
      height: 600,
    });

    const cells = container.querySelectorAll('.dgmo-block-cell');
    expect(cells.length).toBeGreaterThan(0);

    // Every cell carries the editor-sync + hover hooks.
    cells.forEach((c) => {
      expect(c.getAttribute('data-block-id')).toBeTruthy();
      expect(c.getAttribute('data-block-path')).toBeTruthy();
      expect(c.getAttribute('data-line-number')).toBeTruthy();
    });

    const services = cellByLabel(container, 'Services')!;
    const auth = cellByLabel(container, 'Auth')!;
    const orders = cellByLabel(container, 'Orders')!;
    expect(services).toBeDefined();
    expect(auth).toBeDefined();

    // Leaf marker (click-to-line vs container collapse); container is not a leaf.
    expect(auth.getAttribute('data-leaf')).toBe('true');
    expect(services.getAttribute('data-leaf')).toBeNull();

    // Cascade onto the cell hook (Auth inherits Healthy) + per-box override.
    expect(auth.getAttribute('data-tag-status')?.toLowerCase()).toBe('healthy');
    expect(orders.getAttribute('data-tag-status')?.toLowerCase()).toBe(
      'degraded'
    );

    // Subtree path: Auth nests under the Services container (2 segments, parent
    // segment = the Services cell id) — drives the hover/cursor subtree spotlight.
    const authPath = auth.getAttribute('data-block-path')!.split(' / ');
    expect(authPath).toHaveLength(2);
    expect(authPath[0]).toBe(services.getAttribute('data-block-id'));

    // Legend exposes the per-value hover hook (lowercased).
    const entries = [...container.querySelectorAll('[data-legend-entry]')].map(
      (e) => e.getAttribute('data-legend-entry')
    );
    expect(entries).toContain('healthy');
  });

  it('honours the authored collapsed flag and the app-authoritative set', () => {
    const parsed = parseBlock(SRC, nordLight);

    // One authored fold (the Data container).
    expect(authoredCollapsedIds(parsed).size).toBe(1);

    // No set passed → authored fold applies → its children are NOT rendered.
    const c1 = mount();
    renderBlock(c1, parsed, nordLight, false, undefined, {});
    expect(cellByLabel(c1, 'Data')).toBeDefined();
    expect(cellByLabel(c1, 'Postgres')).toBeUndefined(); // behind the collapse-bar

    // App passes an EMPTY set → authoritative → the authored fold is expanded.
    const c2 = mount();
    renderBlock(c2, parsed, nordLight, false, undefined, {
      collapsed: new Set<string>(),
    });
    expect(cellByLabel(c2, 'Postgres')).toBeDefined();
  });
});
