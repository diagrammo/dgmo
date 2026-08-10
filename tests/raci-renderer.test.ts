import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseRaci } from '../src/raci/parser';
import { renderRaci } from '../src/raci/renderer';
import { getPalette } from '../src/palettes';
import { mix, themeBaseBg } from '../src/palettes/color-utils';

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

describe('renderRaci — content-height stamping', () => {
  const SHORT = `raci\n\nTask\n  Cap: A\n  Crew: R`;

  it('stamps data-content-height in preview when the canvas is pane-padded', () => {
    const parsed = parseRaci(SHORT, palette);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1200 });
    Object.defineProperty(container, 'clientHeight', { value: 2000 });
    renderRaci(container, parsed, palette, false);
    const svg = container.querySelector('svg')!;
    expect(Number(svg.getAttribute('height'))).toBe(2000);
    const contentH = Number(svg.getAttribute('data-content-height'));
    expect(contentH).toBeGreaterThan(0);
    expect(contentH).toBeLessThan(2000);
  });

  it('does not stamp it on the export path (canvas already tight)', () => {
    const c = render(SHORT);
    const svg = c.querySelector('svg')!;
    expect(svg.getAttribute('data-content-height')).toBeNull();
  });
});

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

  it('fill-outline: every intent-colored surface takes the theme base bg', () => {
    const baseBg = themeBaseBg(palette, false);
    const c = render(`raci
fill-outline

[Voyage]
  Task A
    Cap: A R
    Crew: I`);

    // Marker slices: fill = base bg, stroke = raw marker color.
    const rSlice = c.querySelector('.raci-marker-slice[data-marker="R"]')!;
    const rRect = rSlice.querySelector('rect')!;
    expect(rRect.getAttribute('fill')).toBe(baseBg);
    expect(rRect.getAttribute('stroke')).toBe(palette.colors.green);
    // Slice text keeps readable palette ink.
    expect(rSlice.querySelector('text')!.getAttribute('fill')).toBe(
      palette.text
    );

    // Role columns: body + header drop their tints; role color on the stroke.
    const body = c.querySelector('.raci-column-body')!;
    expect(body.getAttribute('fill')).toBe(baseBg);
    expect(body.getAttribute('stroke')).toBe(palette.colors.blue);
    const header = c.querySelector('.raci-column-header')!;
    expect(header.getAttribute('fill')).toBe(baseBg);
    expect(header.getAttribute('stroke')).toBe(palette.colors.blue);

    // Phase band: bg fill + colored stroke.
    const phaseRect = c.querySelector('.raci-phase rect')!;
    expect(phaseRect.getAttribute('fill')).toBe(baseBg);
    expect(phaseRect.getAttribute('stroke')).toBe(palette.colors.blue);

    // Legend chips keep a soft vertical gradient of their marker color
    // (user ruling); the letter slab drops to the base bg.
    const chipRects = [...c.querySelectorAll('.raci-legend-chip rect')];
    expect(chipRects.length).toBeGreaterThan(0);
    for (const rect of chipRects) {
      const fill = rect.getAttribute('fill')!;
      expect(fill === baseBg || /^url\(#raci-legend-grad-/.test(fill)).toBe(
        true
      );
      expect(rect.getAttribute('stroke')).toBeTruthy();
    }
    // The gradient defs exist and fade toward the surface bg.
    const grads = [...c.querySelectorAll('linearGradient')].filter((g) =>
      g.id.startsWith('raci-legend-grad-')
    );
    expect(grads.length).toBeGreaterThan(0);
  });

  it('fill-outline: no-phase row bands drop the accent tint', () => {
    const baseBg = themeBaseBg(palette, false);
    const c = render(`raci
fill-outline

Task
  Cap: A`);
    const band = c.querySelector('.raci-row-band')!;
    expect(band.getAttribute('fill')).toBe(baseBg);
    expect(band.getAttribute('stroke')).toBe(palette.colors.blue);
  });

  it('fill-outline: collapsed-phase summary chips honor outline', () => {
    const baseBg = themeBaseBg(palette, false);
    const parsed = parseRaci(
      `raci
fill-outline

[Voyage]
  Task A
    Cap: A`,
      palette
    );
    const container = document.createElement('div');
    renderRaci(
      container,
      parsed,
      palette,
      false,
      { collapsedPhases: new Set([parsed.phases[0]!.id]) },
      { width: 1200, height: 600 }
    );
    const chip = container.querySelector('.raci-phase-summary rect')!;
    expect(chip.getAttribute('fill')).toBe(baseBg);
    expect(chip.getAttribute('stroke')).toBe(palette.colors.red); // A = red
  });

  it('fill-outline: dark theme uses the surface base bg', () => {
    const dark = getPalette('nord').dark;
    const parsed = parseRaci(`raci\nfill-outline\n\nTask\n  Cap: A`, dark);
    const container = document.createElement('div');
    renderRaci(container, parsed, dark, true, undefined, {
      width: 1200,
      height: 600,
    });
    const rect = container.querySelector('.raci-marker-slice rect')!;
    expect(rect.getAttribute('fill')).toBe(themeBaseBg(dark, true));
    expect(rect.getAttribute('fill')).toBe(dark.surface);
  });

  it('default (tint) rendering is unchanged by the outline support', () => {
    const baseBg = themeBaseBg(palette, false);
    const c = render(`raci\n\nTask\n  Cap: R`);
    const rect = c.querySelector('.raci-marker-slice[data-marker="R"] rect')!;
    expect(rect.getAttribute('fill')).toBe(
      mix(palette.colors.green, baseBg, 25)
    );
    const band = c.querySelector('.raci-row-band')!;
    expect(band.getAttribute('fill')).toBe(
      mix(palette.colors.blue, baseBg, 12)
    );
    expect(band.getAttribute('stroke')).toBeNull();
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

// ============================================================
// Violation messages — mixed-weight wrapping
// ============================================================
//
// A violation message quotes task and role names, and those quoted spans draw
// bold inside regular prose. It used to be wrapped as one string and then
// re-parsed line by line, which broke in two ways once a quoted phrase
// straddled a break: the quote characters were unbalanced on each side, so
// neither half rendered bold, and the stray quote was drawn. These assert the
// properties rather than where the break lands, so they survive a change to
// the font metrics.

describe('renderRaci — violation message runs', () => {
  // A line that is neither a description nor a role assignment. Its diagnostic
  // is long enough to wrap at any plausible metric and quotes two phrases, one
  // of them mid-sentence.
  const source = `raci

Chart the route
  Cap: A
  Crew: R
  this line is not a role assignment`;

  const violationSpans = (): HTMLElement[] =>
    Array.from(
      render(source).querySelectorAll('.raci-violation-line tspan')
    ) as HTMLElement[];

  it('wraps the message over more than one line', () => {
    // Every line after the first starts with a `dy`-carrying run.
    const wrapped = violationSpans().filter((t) => t.hasAttribute('dy'));
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it('never draws the quote characters', () => {
    const drawn = violationSpans()
      .map((t) => t.textContent ?? '')
      .join('');
    expect(drawn).not.toContain("'");
  });

  it('keeps a quoted phrase bold across the line break inside it', () => {
    const bold = violationSpans()
      .filter((t) => t.getAttribute('font-weight') === '700')
      .map((t) => t.textContent ?? '')
      .join('')
      // Whitespace is dropped where a break falls, so compare without it.
      .replace(/\s+/g, '');
    expect(bold).toBe('CharttherouteRole:markers');
  });

  it('leaves the surrounding prose regular', () => {
    const regular = violationSpans()
      .filter((t) => t.getAttribute('font-weight') !== '700')
      .map((t) => t.textContent ?? '')
      .join('');
    expect(regular).toContain('Unexpected line after role assignments');
    expect(regular).not.toContain('Chart');
  });
});
