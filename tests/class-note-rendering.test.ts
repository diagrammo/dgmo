import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseClassDiagram } from '../src/class/parser';
import { layoutClassDiagram } from '../src/class/layout';
import { renderClassDiagramForExport } from '../src/class/renderer';
import { getPalette } from '../src/palettes';

let parseSvg: (s: string) => Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [k, v] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true });
  }
  parseSvg = (s: string) =>
    new win.DOMParser().parseFromString(s, 'image/svg+xml');
});

const palette = getPalette('nord').light;
const cd = (src: string) => renderClassDiagramForExport(src, 'light', palette);

const SRC = [
  'class',
  'Ship',
  '  + sail()',
  'Galleon extends Ship',
  '  + fire()',
  'note Galleon a heavy hull',
].join('\n');

describe('class notes — rendering markup', () => {
  it('emits a note group with the toggle hook + line attrs', () => {
    const svg = parseSvg(cd(SRC));
    const note = svg.querySelector('.note');
    expect(note).not.toBeNull();
    expect(note!.hasAttribute('data-note-toggle')).toBe(true);
    expect(note!.getAttribute('data-line-number')).toBe('6');
    expect(note!.getAttribute('role')).toBe('button');
    expect(svg.querySelector('.note-box')).not.toBeNull();
    expect(svg.querySelector('.note-connector')).not.toBeNull();
  });

  it('colors the note border via a trailing color word', () => {
    const svg = parseSvg(
      cd(['class', 'Ship', '  + sail()', 'note Ship hull red'].join('\n'))
    );
    const box = svg.querySelector('.note-box');
    const stroke = box!.getAttribute('stroke')!;
    // Red resolves to the palette's red accent (not the default yellow).
    expect(stroke).toBe(palette.colors.red);
    expect(stroke).not.toBe(palette.colors.yellow);
  });

  it('keeps the note within a non-negative canvas (no clipping)', () => {
    const parsed = parseClassDiagram(SRC, palette);
    const layout = layoutClassDiagram(parsed);
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note).toBeTruthy();
    // Absolute note rect stays on-canvas after the shift pass.
    const absLeft = annotated.x + annotated.note!.x;
    const absTop = annotated.y + annotated.note!.y;
    expect(absLeft).toBeGreaterThanOrEqual(0);
    expect(absTop).toBeGreaterThanOrEqual(0);
    expect(
      annotated.x + annotated.note!.x + annotated.note!.width
    ).toBeLessThanOrEqual(layout.width);
  });

  it('no-notes suppresses the note entirely', () => {
    const svg = parseSvg(
      cd(
        ['class', 'no-notes', 'Ship', '  + sail()', 'note Ship hidden'].join(
          '\n'
        )
      )
    );
    expect(svg.querySelector('.note')).toBeNull();
  });

  it('renders a collapsed note as a corner badge', () => {
    const parsed = parseClassDiagram(SRC, palette);
    const layout = layoutClassDiagram(parsed, { collapsedNotes: new Set([6]) });
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note!.collapsed).toBe(true);
  });
});
