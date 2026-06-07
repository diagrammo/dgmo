import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { layoutGraph } from '../src/graph/layout';
import {
  renderFlowchart,
  renderFlowchartForExport,
} from '../src/graph/flowchart-renderer';
import { renderStateForExport } from '../src/graph/state-renderer';
import { getPalette } from '../src/palettes';
import { NOTE_GAP } from '../src/utils/note-box';

let doc: Document;
let parseSvg: (s: string) => Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  doc = win.document;
  for (const [k, v] of Object.entries({
    document: doc,
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

const fc = (src: string) => renderFlowchartForExport(src, 'light', palette);

describe('graph notes — rendering markup', () => {
  const src = [
    'flowchart',
    '(Start) -> [Validate] -> (Done)',
    'note Validate a note here',
  ].join('\n');

  // AC13 + AC11
  it('emits a note group with the toggle hook + line attrs (AC13)', () => {
    const svg = parseSvg(fc(src));
    const note = svg.querySelector('.note');
    expect(note).not.toBeNull();
    expect(note!.hasAttribute('data-note-toggle')).toBe(true);
    expect(note!.getAttribute('data-line-number')).toBe('3');
    expect(note!.getAttribute('data-line-end')).toBe('3');

    const box = note!.querySelector('.note-box') as SVGElement;
    const fold = note!.querySelector('.note-fold') as SVGElement;
    expect(box.getAttribute('style')).toContain('pointer-events: none');
    expect(fold.getAttribute('style')).toContain('pointer-events: none');
  });

  it('tethers the note to its node with a solid connector', () => {
    const svg = parseSvg(fc(src));
    const conn = svg.querySelector('.note-connector') as SVGElement;
    expect(conn).not.toBeNull();
    expect(conn.getAttribute('stroke-dasharray')).toBeNull();
    expect(conn.getAttribute('style')).toContain('pointer-events: none');
  });

  it('fills the box via mix() (hex, never CSS color-mix) (AC11)', () => {
    const out = fc(src);
    expect(out).not.toContain('color-mix(');
    const svg = parseSvg(out);
    const box = svg.querySelector('.note-box') as SVGElement;
    expect(box.getAttribute('fill')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  // AC7
  it('no-notes suppresses note markup (AC7)', () => {
    const out = fc(
      [
        'flowchart',
        'no-notes',
        '(Start) -> [Validate] -> (Done)',
        'note Validate a note here',
      ].join('\n')
    );
    const svg = parseSvg(out);
    expect(svg.querySelector('.note')).toBeNull();
  });

  it('state notes render a note box too', () => {
    const out = renderStateForExport(
      ['state', '[*] -> Idle -> Active', 'note Idle waiting for input'].join(
        '\n'
      ),
      'light',
      palette
    );
    const svg = parseSvg(out);
    expect(svg.querySelector('.note-box')).not.toBeNull();
  });
});

describe('graph notes — layout (Strategy B)', () => {
  const noteAbsRect = (n: {
    x: number;
    y: number;
    note?: { x: number; y: number; width: number; height: number };
  }) => {
    const note = n.note!;
    return {
      left: n.x + note.x,
      right: n.x + note.x + note.width,
      top: n.y + note.y,
      bottom: n.y + note.y + note.height,
    };
  };

  // AC9
  it('keeps every note box inside the canvas (AC9)', () => {
    const layout = layoutGraph(
      parseFlowchart(
        [
          'flowchart',
          '(Start) -> [Validate] -> (Done)',
          'note Done trailing note on the last node',
        ].join('\n')
      )
    );
    const annotated = layout.nodes.filter((n) => n.note);
    expect(annotated.length).toBe(1);
    for (const n of annotated) {
      const r = noteAbsRect(n);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(layout.width);
      expect(r.bottom).toBeLessThanOrEqual(layout.height);
    }
  });

  // Core requirement: a note must NOT reposition the shape it annotates
  // (the shape keeps its dagre position so its edges stay connected).
  it('notes never reposition the shapes they annotate', () => {
    const annotated = layoutGraph(
      parseFlowchart(
        [
          'flowchart',
          '(Start) -> [Validate] -> (Done)',
          'note Validate a fairly long comment that widens the note box',
        ].join('\n')
      )
    );
    const plain = layoutGraph(
      parseFlowchart(
        ['flowchart', '(Start) -> [Validate] -> (Done)'].join('\n')
      )
    );
    // Every node sits exactly where it would without any note.
    for (const p of plain.nodes) {
      const a = annotated.nodes.find((n) => n.id === p.id)!;
      expect(a.x).toBeCloseTo(p.x, 5);
      expect(a.y).toBeCloseTo(p.y, 5);
      expect(a.width).toBeCloseTo(p.width, 5);
      expect(a.height).toBeCloseTo(p.height, 5);
    }
  });

  // The note floats just past the shape's right edge (gap = NOTE_GAP),
  // outside the shape — never overlapping it.
  it('floats the note to the right of the shape at NOTE_GAP', () => {
    const layout = layoutGraph(
      parseFlowchart(
        ['flowchart', '(Start) -> [Validate]', 'note Validate hi there'].join(
          '\n'
        )
      )
    );
    const n = layout.nodes.find((x) => x.note)!;
    expect(n.note!.x).toBeCloseTo(n.width / 2 + NOTE_GAP, 5);
  });

  // AC8
  it('no-notes drops the note entirely (no box, layout unchanged) (AC8)', () => {
    const annotated = layoutGraph(
      parseFlowchart(
        [
          'flowchart',
          'no-notes',
          '(Start) -> [Validate] -> (Done)',
          'note Validate a comment',
        ].join('\n')
      )
    );
    const plain = layoutGraph(
      parseFlowchart(
        ['flowchart', '(Start) -> [Validate] -> (Done)'].join('\n')
      )
    );
    expect(annotated.nodes.every((n) => !n.note)).toBe(true);
    expect(annotated.width).toBeCloseTo(plain.width, 5);
    expect(annotated.height).toBeCloseTo(plain.height, 5);
  });

  it('renders without throwing into a live container', () => {
    const parsed = parseFlowchart(
      ['flowchart', '(Start) -> [Validate]', 'note Validate hi'].join('\n')
    );
    const layout = layoutGraph(parsed);
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    doc.body.appendChild(container);
    expect(() =>
      renderFlowchart(container, parsed, layout, palette, false, undefined, {
        width: 800,
        height: 600,
      })
    ).not.toThrow();
    expect(container.querySelector('.note')).not.toBeNull();
    doc.body.removeChild(container);
  });
});
