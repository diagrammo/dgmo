import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseERDiagram } from '../src/er/parser';
import { layoutERDiagram } from '../src/er/layout';
import { renderERDiagramForExport } from '../src/er/renderer';
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
const er = (src: string) => renderERDiagramForExport(src, 'light', palette);

const SRC = [
  'er',
  'ships',
  '  id int pk',
  '  name varchar',
  'crew',
  '  id int pk',
  '  ship_id int fk',
  'ships',
  '  1-aboard-* crew',
  'note ships the flagship table',
].join('\n');

describe('er notes — rendering markup', () => {
  it('emits a note group with the toggle hook + line attrs', () => {
    const svg = parseSvg(er(SRC));
    const note = svg.querySelector('.note');
    expect(note).not.toBeNull();
    expect(note!.hasAttribute('data-note-toggle')).toBe(true);
    expect(note!.getAttribute('data-line-number')).toBe('10');
    expect(note!.getAttribute('role')).toBe('button');
    expect(svg.querySelector('.note-box')).not.toBeNull();
    expect(svg.querySelector('.note-connector')).not.toBeNull();
  });

  it('colors the note border via a trailing color word', () => {
    const svg = parseSvg(
      er(['er', 'ships', '  id int pk', 'note ships hull red'].join('\n'))
    );
    const stroke = svg.querySelector('.note-box')!.getAttribute('stroke')!;
    expect(stroke).toBe(palette.colors.red);
    expect(stroke).not.toBe(palette.colors.yellow);
  });

  it('keeps the note within a non-negative canvas', () => {
    const parsed = parseERDiagram(SRC, palette);
    const layout = layoutERDiagram(parsed);
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note).toBeTruthy();
    expect(annotated.x + annotated.note!.x).toBeGreaterThanOrEqual(0);
    expect(annotated.y + annotated.note!.y).toBeGreaterThanOrEqual(0);
    expect(
      annotated.x + annotated.note!.x + annotated.note!.width
    ).toBeLessThanOrEqual(layout.width);
  });

  it('no-notes suppresses the note entirely', () => {
    const svg = parseSvg(
      er(
        ['er', 'no-notes', 'ships', '  id int pk', 'note ships hidden'].join(
          '\n'
        )
      )
    );
    expect(svg.querySelector('.note')).toBeNull();
  });

  it('renders a collapsed note as a corner badge', () => {
    const parsed = parseERDiagram(SRC, palette);
    const layout = layoutERDiagram(parsed, { collapsedNotes: new Set([10]) });
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note!.collapsed).toBe(true);
  });
});
