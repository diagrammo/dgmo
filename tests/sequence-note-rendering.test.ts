import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram, buildNoteMessageMap, parseInlineMarkdown } from '../src/sequence/renderer';
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

describe('Collapsed note rendering', () => {
  it('renders collapsed notes when expandedNoteLines is empty set', () => {
    const svg = renderToSvg('A -> B: hello\nnote right of A: annotation', {
      expandedNoteLines: new Set(),
    });
    expect(svg).not.toBeNull();
    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(1);
    // Should have collapsed class
    expect(notes[0].classList.contains('note-collapsed')).toBe(true);
    // Should show "..." text
    const textEl = notes[0].querySelector('.note-text');
    expect(textEl?.textContent).toBe('\u2026');
  });

  it('renders expanded notes when note lineNumber is in expandedNoteLines', () => {
    const parsed = parseSequenceDgmo('A -> B: hello\nnote right of A: annotation');
    const noteLineNumber = parsed.elements
      .filter((el): el is import('../src/sequence/parser').SequenceNote => 'kind' in el && el.kind === 'note')
      .map((n) => n.lineNumber)[0];

    const svg = renderToSvg('A -> B: hello\nnote right of A: annotation', {
      expandedNoteLines: new Set([noteLineNumber]),
    });
    expect(svg).not.toBeNull();
    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(1);
    // Should NOT have collapsed class
    expect(notes[0].classList.contains('note-collapsed')).toBe(false);
  });

  it('collapsed notes are shorter than expanded notes', () => {
    const input = 'A -> B: hello\nnote right of A: this is a longer annotation text';

    // Expanded (default, no expandedNoteLines)
    const svgExpanded = renderToSvg(input);
    const expandedBox = svgExpanded!.querySelector('.note-box');
    const dExpanded = expandedBox!.getAttribute('d') || '';
    const expandedCoords = dExpanded.match(/[\d.]+/g)!.map(Number);
    const expandedHeight = expandedCoords[9] - expandedCoords[1]; // bottomY - topY

    // Collapsed
    const svgCollapsed = renderToSvg(input, { expandedNoteLines: new Set() });
    const collapsedBox = svgCollapsed!.querySelector('.note-box');
    const dCollapsed = collapsedBox!.getAttribute('d') || '';
    const collapsedCoords = dCollapsed.match(/[\d.]+/g)!.map(Number);
    const collapsedHeight = collapsedCoords[9] - collapsedCoords[1];

    expect(collapsedHeight).toBeLessThan(expandedHeight);
  });

  it('mixed expanded/collapsed notes render correctly', () => {
    const input = [
      'A -> B: hello',
      'note right of A: first note',
      'note right of A: second note',
    ].join('\n');
    const parsed = parseSequenceDgmo(input);
    const noteLines = parsed.elements
      .filter((el): el is import('../src/sequence/parser').SequenceNote => 'kind' in el && el.kind === 'note')
      .map((n) => n.lineNumber);
    expect(noteLines.length).toBe(2);

    // Expand only the first note
    const svg = renderToSvg(input, {
      expandedNoteLines: new Set([noteLines[0]]),
    });
    expect(svg).not.toBeNull();
    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(2);
    // First expanded, second collapsed
    expect(notes[0].classList.contains('note-collapsed')).toBe(false);
    expect(notes[1].classList.contains('note-collapsed')).toBe(true);
  });

  it('collapse-notes: no overrides expandedNoteLines', () => {
    const input = [
      'collapse-notes: no',
      'A -> B: hello',
      'note right of A: annotation',
    ].join('\n');
    // Even with empty expandedNoteLines, note should be expanded
    const svg = renderToSvg(input, { expandedNoteLines: new Set() });
    expect(svg).not.toBeNull();
    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(1);
    expect(notes[0].classList.contains('note-collapsed')).toBe(false);
  });

  it('undefined expandedNoteLines renders all notes expanded (CLI default)', () => {
    const svg = renderToSvg('A -> B: hello\nnote right of A: annotation');
    expect(svg).not.toBeNull();
    const notes = svg!.querySelectorAll('.note');
    expect(notes.length).toBe(1);
    expect(notes[0].classList.contains('note-collapsed')).toBe(false);
  });
});

describe('buildNoteMessageMap', () => {
  it('maps notes to their preceding message lines', () => {
    const parsed = parseSequenceDgmo([
      'A -> B: hello',
      'note right of A: annotation',
      'A -> B: world',
      'note right of B: second annotation',
    ].join('\n'));

    const map = buildNoteMessageMap(parsed.elements);
    const notes = parsed.elements
      .filter((el): el is import('../src/sequence/parser').SequenceNote => 'kind' in el && el.kind === 'note');

    expect(notes.length).toBe(2);
    // First note maps to first message
    expect(map.get(notes[0].lineNumber)).toBe(parsed.messages[0].lineNumber);
    // Second note maps to second message
    expect(map.get(notes[1].lineNumber)).toBe(parsed.messages[1].lineNumber);
  });

  it('handles notes inside blocks', () => {
    const parsed = parseSequenceDgmo([
      'A -> B: setup',
      'if condition',
      '  A -> B: action',
      '  note right of A: inside block',
      'A -> B: done',
    ].join('\n'));

    const map = buildNoteMessageMap(parsed.elements);
    expect(map.size).toBe(1);
  });
});

describe('parseInlineMarkdown — bare URL detection', () => {
  it('detects https:// URLs', () => {
    const spans = parseInlineMarkdown('visit https://example.com today');
    expect(spans).toEqual([
      { text: 'visit ' },
      { text: 'https://example.com', href: 'https://example.com' },
      { text: ' today' },
    ]);
  });

  it('detects http:// URLs', () => {
    const spans = parseInlineMarkdown('http://example.com/path?q=1');
    expect(spans).toEqual([
      { text: 'http://example.com/path?q=1', href: 'http://example.com/path?q=1' },
    ]);
  });

  it('detects www. URLs and prepends https://', () => {
    const spans = parseInlineMarkdown('go to www.example.com');
    expect(spans).toEqual([
      { text: 'go to ' },
      { text: 'www.example.com', href: 'https://www.example.com' },
    ]);
  });

  it('preserves existing markdown link syntax', () => {
    const spans = parseInlineMarkdown('[docs](https://docs.example.com)');
    expect(spans).toEqual([
      { text: 'docs', href: 'https://docs.example.com' },
    ]);
  });

  it('handles bare URL alongside markdown formatting', () => {
    const spans = parseInlineMarkdown('see **bold** and https://example.com');
    expect(spans).toEqual([
      { text: 'see ' },
      { text: 'bold', bold: true },
      { text: ' and ' },
      { text: 'https://example.com', href: 'https://example.com' },
    ]);
  });

  it('handles URL at the start of text', () => {
    const spans = parseInlineMarkdown('https://start.com is the link');
    expect(spans).toEqual([
      { text: 'https://start.com', href: 'https://start.com' },
      { text: ' is the link' },
    ]);
  });

  it('plain text without URLs returns single span', () => {
    const spans = parseInlineMarkdown('no links here');
    expect(spans).toEqual([{ text: 'no links here' }]);
  });
});

describe('Message label inline markdown rendering', () => {
  it('renders bare URL in a message label as an <a> element', () => {
    const svg = renderToSvg('A -> B: call https://api.example.com/endpoint');
    expect(svg).not.toBeNull();
    const labels = svg!.querySelectorAll('.message-label');
    expect(labels.length).toBe(1);
    const anchor = labels[0].querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBe('https://api.example.com/endpoint');
  });

  it('renders markdown link in a message label as an <a> element', () => {
    const svg = renderToSvg('A -> B: see [docs](https://docs.example.com)');
    expect(svg).not.toBeNull();
    const anchor = svg!.querySelector('.message-label a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBe('https://docs.example.com');
    expect(anchor!.textContent).toBe('docs');
  });

  it('renders bare URL in a return label as an <a> element', () => {
    const svg = renderToSvg('A -> B: call <- https://result.example.com');
    expect(svg).not.toBeNull();
    const labels = svg!.querySelectorAll('.message-label');
    // Should have both a call label and a return label
    expect(labels.length).toBeGreaterThanOrEqual(2);
    const returnLabel = labels[labels.length - 1];
    const anchor = returnLabel.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBe('https://result.example.com');
  });
});
