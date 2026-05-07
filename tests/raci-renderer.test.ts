import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseRaci } from '../src/raci/parser';
import { renderRaci } from '../src/raci/renderer';
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
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const palette = getPalette('nord').light;

function render(source: string): HTMLDivElement {
  const parsed = parseRaci(source, palette);
  const container = document.createElement('div');
  renderRaci(container, parsed, palette, false, undefined, {
    width: 1200,
    height: 600,
  });
  return container;
}

describe('renderRaci — basic structure', () => {
  it('produces an <svg> root for a minimal RACI', () => {
    const c = render(`raci\n\nTask\n  Cap: A\n  Crew: R`);
    expect(c.querySelector('svg')).toBeTruthy();
  });

  it('renders the chart title when present', () => {
    const c = render(`raci Voyage\n\nTask\n  Cap: A`);
    const titleText = Array.from(c.querySelectorAll('text'))
      .map((t) => t.textContent)
      .join('|');
    expect(titleText).toContain('Voyage');
  });

  it('renders one column header per declared role', () => {
    const c = render(`raci
roles Cap, QM, Bos

Task
  Cap: A
  QM: R`);
    const headerTexts = Array.from(
      c.querySelectorAll('.raci-column .raci-column-label')
    ).map((t) => t.textContent);
    expect(headerTexts).toEqual(['Cap', 'QM', 'Bos']);
  });

  it('renders markers in source order across cells', () => {
    const c = render(`raci\n\nTask\n  Cap: A R\n  Crew: I`);
    // Each marker slice carries a data-marker attribute. The rendered
    // text may be the letter ('A') or the full label ('Accountable')
    // depending on the slice width.
    const cellMarkers = Array.from(
      c.querySelectorAll('.raci-cell .raci-marker-slice')
    ).map((s) => s.getAttribute('data-marker'));
    expect(cellMarkers).toContain('A');
    expect(cellMarkers).toContain('R');
    expect(cellMarkers).toContain('I');
  });
});

// ============================================================
// SVG attribute conventions (sequence-section parity)
// ============================================================

describe('renderRaci — SVG attribute conventions', () => {
  const source = `raci

[Voyage]
  Task A
    Cap: A
    Crew: R
  Task B
    Cap: A`;

  it('phase <g> carries data-section, data-section-toggle, data-line-number', () => {
    const c = render(source);
    const phase = c.querySelector('.raci-phase');
    expect(phase).toBeTruthy();
    expect(phase!.getAttribute('data-section')).toBeTruthy();
    expect(phase!.hasAttribute('data-section-toggle')).toBe(true);
    expect(phase!.getAttribute('data-line-number')).toBe('3');
  });

  it('phase children do NOT carry data-section-toggle', () => {
    const c = render(source);
    const phase = c.querySelector('.raci-phase')!;
    for (const child of phase.querySelectorAll('*')) {
      expect(child.hasAttribute('data-section-toggle')).toBe(false);
    }
  });

  it('task rows carry data-line-number', () => {
    const c = render(source);
    const rows = c.querySelectorAll('.raci-task-row');
    const lineNumbers = Array.from(rows)
      .map((r) => r.getAttribute('data-line-number'))
      .filter(Boolean);
    expect(lineNumbers).toEqual(expect.arrayContaining(['4', '7']));
  });

  it('cells carry data-role-id keyed by normalized role name', () => {
    const c = render(source);
    const cells = c.querySelectorAll('.raci-cell');
    const roleIds = Array.from(cells)
      .map((c) => c.getAttribute('data-role-id'))
      .filter(Boolean);
    expect(roleIds.length).toBeGreaterThan(0);
    expect(roleIds).toContain('cap');
  });
});

// ============================================================
// Variant coverage
// ============================================================

describe('renderRaci — all variants render', () => {
  it('RASCI accepts S marker', () => {
    const c = render(`raci\n\nTask\n  Cap: A\n  Crew: R\n  Bos: S`);
    const cellMarkers = Array.from(
      c.querySelectorAll('.raci-cell .raci-marker-slice')
    ).map((s) => s.getAttribute('data-marker'));
    expect(cellMarkers).toContain('S');
  });

  it('DACI renders D marker', () => {
    const c = render(`raci\n\nDecide\n  PM: D\n  Cap: A`);
    const cellMarkers = Array.from(
      c.querySelectorAll('.raci-cell .raci-marker-slice')
    ).map((s) => s.getAttribute('data-marker'));
    expect(cellMarkers).toContain('D');
  });
});

// ============================================================
// Empty cells stay visually distinct
// ============================================================

describe('renderRaci — empty cells', () => {
  it('renders a column body bg behind unfilled role cells (kanban-style)', () => {
    const c = render(`raci
roles Cap, QM, Bos

Task
  Cap: A`);
    // Kanban-style treatment: each role gets a column-body rect spanning
    // the full body height. Empty cells fall on this bg (no per-cell
    // outline is drawn). Confirm the column rects exist.
    const columnBodies = c.querySelectorAll('.raci-column-body');
    expect(columnBodies.length).toBe(3);
    // And no per-cell `fill=none` outlines are drawn for empty cells.
    const outlineRects = Array.from(
      c.querySelectorAll('.raci-cell rect')
    ).filter((r) => r.getAttribute('fill') === 'none');
    expect(outlineRects.length).toBe(0);
  });

  it('shows a discoverability hint when no cells are filled', () => {
    const c = render(`raci\n\nTask`);
    const text = Array.from(c.querySelectorAll('text'))
      .map((t) => t.textContent ?? '')
      .join('|');
    expect(text).toContain('Drag a marker');
  });

  it('renders a labeled legend chip for each variant marker', () => {
    const c = render(`raci\n\nTask\n  Cap: A`);
    const chips = c.querySelectorAll('.raci-legend-chip');
    expect(chips.length).toBe(4); // R A C I
    const markers = Array.from(chips)
      .map((el) => el.getAttribute('data-marker'))
      .sort();
    expect(markers).toEqual(['A', 'C', 'I', 'R']);
    const labels = Array.from(c.querySelectorAll('.raci-legend-chip text'))
      .map((t) => t.textContent ?? '')
      .filter((t) => t.length > 1);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Responsible',
        'Accountable',
        'Consulted',
        'Informed',
      ])
    );
  });

  it('marker slices in cells carry data-marker for drag identification', () => {
    const c = render(`raci\n\nTask\n  Cap: A R`);
    const slices = c.querySelectorAll('.raci-marker-slice');
    const markers = Array.from(slices)
      .map((el) => el.getAttribute('data-marker'))
      .sort();
    expect(markers).toEqual(['A', 'R']);
  });

  it('DACI legend uses Driver/Approver/Contributor/Informed labels', () => {
    const c = render(`raci\n\nDecide\n  PM: D\n  Cap: A`);
    const labels = Array.from(c.querySelectorAll('.raci-legend-chip text'))
      .map((t) => t.textContent ?? '')
      .filter((t) => t.length > 1);
    expect(labels).toEqual(
      expect.arrayContaining(['Driver', 'Approver', 'Contributor', 'Informed'])
    );
  });
});
