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

describe('block — long labels wrap instead of cutting (#2172)', () => {
  const CAPTION =
    'This is a deliberately long caption band intended to test whether the block type truncates a span-6 label and at what threshold it does so';

  function labelOf(cell: Element): string[] {
    const text = cell.querySelector('text')!;
    const spans = [...text.querySelectorAll('tspan')];
    return spans.length > 0
      ? spans.map((s) => s.textContent ?? '')
      : [text.textContent ?? ''];
  }

  it('a spanning band wraps its full caption and grows to hold it', () => {
    const c = mount();
    renderBlock(
      c,
      parseBlock(`block T\ncolumns 6\n[${CAPTION}] span: 6\n`),
      nordLight,
      false
    );
    const cell = c.querySelector('.dgmo-block-cell')!;
    const lines = labelOf(cell);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(CAPTION);
    expect(lines.some((l) => l.includes('…'))).toBe(false);
    const h = Number(cell.querySelector('rect')!.getAttribute('height'));
    expect(h).toBeGreaterThan(46);
  });

  it('a word wider than its cell breaks rather than ending in "…"', () => {
    const word = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
    const c = mount();
    renderBlock(c, parseBlock(`block T\n[${word}]\n`), nordLight, false);
    const lines = labelOf(c.querySelector('.dgmo-block-cell')!);
    expect(lines.some((l) => l.includes('…'))).toBe(false);
    expect(lines.join('')).toBe(word);
  });

  it('a container header wraps and keeps its children below it', () => {
    const header =
      'A container header long enough that it cannot fit on one line of a narrow box';
    const c = mount();
    renderBlock(
      c,
      parseBlock(`block T\n[${header}]\n  [Child]\n`),
      nordLight,
      false
    );
    const cell = cellByLabel(c, 'Child')!;
    const parent = [...c.querySelectorAll('.dgmo-block-cell')].find(
      (el) => el !== cell
    )!;
    const lines = labelOf(parent);
    expect(lines.join(' ')).toBe(header);
    expect(lines.length).toBeGreaterThan(1);
    const text = parent.querySelector('text')!;
    const fs = Number(text.getAttribute('font-size'));
    // Baseline of the header's last line.
    const lastBaseline =
      Number(text.getAttribute('y')) +
      (lines.length - 1) * Math.round(fs * 1.3);
    const childTop = Number(cell.querySelector('rect')!.getAttribute('y'));
    expect(childTop).toBeGreaterThan(lastBaseline);
  });
});
