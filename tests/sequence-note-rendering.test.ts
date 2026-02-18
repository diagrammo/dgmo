import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { getPalette } from '../src/palettes';

// Set up jsdom globals for D3
let doc: Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  doc = win.document;
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
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

function renderToSvg(
  input: string,
  options?: import('../src/sequence/renderer').SequenceRenderOptions
): SVGSVGElement | null {
  const parsed = parseSequenceDgmo(input);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  doc.body.appendChild(container);
  renderSequenceDiagram(container, parsed, palette, false, undefined, {
    exportWidth: 800,
    ...options,
  });
  const svg = container.querySelector('svg');
  doc.body.removeChild(container);
  return svg;
}

describe('Sequence diagram note rendering', () => {
  it('renders a basic note without error', () => {
    const svg = renderToSvg('A -> B: hello\nnote right of A: annotation');
    expect(svg).not.toBeNull();
    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(1);
  });

  it('trailing note is included in SVG viewport', () => {
    const svg = renderToSvg('A -> B: hello\nnote right of A: trailing note');
    expect(svg).not.toBeNull();

    const noteBox = svg!.querySelector('.note-box');
    expect(noteBox).not.toBeNull();

    // Parse the note box path to find its bottom Y
    const d = noteBox!.getAttribute('d') || '';
    // Path format: M x y L ... L x bottomY L x bottomY Z
    // Extract all Y values from the path
    const coords = d.match(/[\d.]+/g)!.map(Number);
    // The folded-corner path has points: topLeft, topRight-fold, topRight+fold, bottomRight, bottomLeft
    // Y values at indices: 1, 3, 5, 7, 9
    const noteBottomY = Math.max(coords[7], coords[9]);

    // SVG height must be >= note bottom
    const viewBox = svg!.getAttribute('viewBox')!;
    const svgHeight = Number(viewBox.split(' ')[3]);
    expect(svgHeight).toBeGreaterThanOrEqual(noteBottomY);
  });

  it('consecutive notes get distinct Y positions', () => {
    const svg = renderToSvg(
      'A -> B: hello\nnote right of A: first note\nnote right of A: second note'
    );
    expect(svg).not.toBeNull();

    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(2);

    // Extract Y positions from note-box paths
    const yPositions: number[] = [];
    notes.forEach((note) => {
      const path = note.querySelector('.note-box');
      const d = path!.getAttribute('d') || '';
      const firstY = Number(d.match(/M\s+[\d.]+\s+([\d.]+)/)![1]);
      yPositions.push(firstY);
    });

    // Second note must be below the first
    expect(yPositions[1]).toBeGreaterThan(yPositions[0]);
  });

  it('note before a section gets proper spacing', () => {
    const svg = renderToSvg(
      [
        'A -> B: hello',
        'note right of A: my note',
        '== Phase 2 ==',
        'A -> B: world',
      ].join('\n')
    );
    expect(svg).not.toBeNull();

    // Both the note and the section should render
    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(1);

    const sectionLabels = svg!.querySelectorAll('.section-label');
    expect(sectionLabels.length).toBe(1);

    // The note should not overlap with the message arrows
    // (we verify by checking note Y > first message Y)
    const noteBox = svg!.querySelector('.note-box');
    const d = noteBox!.getAttribute('d') || '';
    const noteTopY = Number(d.match(/M\s+[\d.]+\s+([\d.]+)/)![1]);

    const arrows = svg!.querySelectorAll('.message-arrow');
    expect(arrows.length).toBeGreaterThan(0);
    const firstArrowY = Number(
      arrows[0].getAttribute('y1') || arrows[0].getAttribute('y') || '0'
    );
    expect(noteTopY).toBeGreaterThan(firstArrowY);
  });

  it('note inside a block renders correctly', () => {
    const svg = renderToSvg(
      [
        'A -> B: setup',
        'if condition',
        '  A -> B: action',
        '  note right of A: inside block',
        'A -> B: done',
      ].join('\n')
    );
    expect(svg).not.toBeNull();

    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(1);
  });

  it('three consecutive notes all get distinct Y positions', () => {
    const svg = renderToSvg(
      [
        'A -> B: hello',
        'note right of A: first',
        'note right of A: second',
        'note right of A: third',
      ].join('\n')
    );
    expect(svg).not.toBeNull();

    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(3);

    const yPositions: number[] = [];
    notes.forEach((note) => {
      const path = note.querySelector('.note-box');
      const d = path!.getAttribute('d') || '';
      const firstY = Number(d.match(/M\s+[\d.]+\s+([\d.]+)/)![1]);
      yPositions.push(firstY);
    });

    // Each subsequent note should be further down
    expect(yPositions[1]).toBeGreaterThan(yPositions[0]);
    expect(yPositions[2]).toBeGreaterThan(yPositions[1]);
  });

  it('trailing note after section is included in viewport', () => {
    const svg = renderToSvg(
      [
        'A -> B: hello',
        '== Section ==',
        'A -> B: world',
        'note right of A: trailing after section',
      ].join('\n')
    );
    expect(svg).not.toBeNull();

    const noteBox = svg!.querySelector('.note-box');
    expect(noteBox).not.toBeNull();

    const d = noteBox!.getAttribute('d') || '';
    const coords = d.match(/[\d.]+/g)!.map(Number);
    const noteBottomY = Math.max(coords[7], coords[9]);

    const viewBox = svg!.getAttribute('viewBox')!;
    const svgHeight = Number(viewBox.split(' ')[3]);
    expect(svgHeight).toBeGreaterThanOrEqual(noteBottomY);
  });
});
