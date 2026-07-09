import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseTreemap } from '../src/treemap/parser';
import { renderTreemapRadialForExport } from '../src/treemap/renderer-radial';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const k of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, k, {
      value: (win as unknown as Record<string, unknown>)[k],
      configurable: true,
    });
  }
});

function render(src: string, w = 900, h = 900): SVGSVGElement {
  const parsed = parseTreemap(src, palette);
  const container = document.createElement('div');
  renderTreemapRadialForExport(container, parsed, palette, false, {
    width: w,
    height: h,
  });
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg rendered');
  return svg as unknown as SVGSVGElement;
}

/** All <textPath> label runs with the id of the arc they ride and their text. */
function labels(svg: SVGSVGElement): { id: string; text: string }[] {
  return Array.from(svg.querySelectorAll('textPath')).map((tp) => ({
    id: tp.getAttribute('href')?.slice(1) ?? '',
    text: tp.textContent ?? '',
  }));
}

const TWO_RING = `treemap
radial
Ships
  Galleon 40
  Sloop 25
Crew
  Cook 15
  Gunner 20`;

// A deep 3-level tree; in a small viewport its rings are too thin to stack.
const DEEP = `treemap
radial
A
  A1
    A1a 10
    A1b 10
  A2
    A2a 10
    A2b 10
B
  B1
    B1a 10
    B1b 10
  B2
    B2a 10
    B2b 10`;

describe('radial treemap — two-line curved labels', () => {
  it('splits name and value·% onto separate concentric arcs on a thick ring', () => {
    const ls = labels(render(TWO_RING));
    const nameRun = ls.find((l) => l.id.endsWith('-n') && l.text === 'Galleon');
    const valRun = ls.find((l) => l.id === 'dgmo-arc-lbl-2-v');
    expect(nameRun).toBeTruthy();
    // Value line carries value and percent joined by the mid-dot (total 100).
    expect(valRun?.text).toBe('40 · 40%');
    // No single run carries the whole "name value" string anymore.
    expect(ls.some((l) => l.text.startsWith('Galleon 40'))).toBe(false);
  });

  it('emits one -n run and a matching -v run for each labelled arc', () => {
    const ls = labels(render(TWO_RING));
    const nRuns = ls.filter((l) => l.id.endsWith('-n'));
    const vRuns = ls.filter((l) => l.id.endsWith('-v'));
    expect(nRuns.length).toBe(6); // 2 branches + 4 leaves
    expect(vRuns.length).toBe(nRuns.length);
  });

  it('collapses to a single line when there is no value string (no-values/percent)', () => {
    const ls = labels(
      render(`treemap
radial
no-values
no-percent
Ships
  Galleon 40
  Sloop 25`)
    );
    expect(ls.some((l) => l.id.endsWith('-v'))).toBe(false);
    expect(ls.every((l) => !l.id.endsWith('-n'))).toBe(true);
    expect(ls.some((l) => l.text === 'Galleon')).toBe(true);
  });

  it('falls back to a single line when the ring is too thin to stack two', () => {
    const ls = labels(render(DEEP, 240, 240));
    expect(ls.length).toBeGreaterThan(0);
    // Every label is a single run (no -n/-v suffix) on thin rings.
    expect(ls.every((l) => !l.id.endsWith('-n') && !l.id.endsWith('-v'))).toBe(
      true
    );
  });

  it('keeps two-line labels on the same thin tree once the viewport is large', () => {
    const ls = labels(render(DEEP, 900, 900));
    expect(ls.some((l) => l.id.endsWith('-n'))).toBe(true);
    expect(ls.some((l) => l.id.endsWith('-v'))).toBe(true);
  });
});
