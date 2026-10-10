import { describe, expect, it } from 'vitest';

import * as advanced from '../src/advanced';
import { render } from '../src/index';
import { getPalette } from '../src/palettes';
import { mix, themeBaseBg } from '../src/palettes/color-utils';
import { emitWhiteboard, sameWhiteboard } from '../src/whiteboard/emit';
import {
  clipWhiteboardConnector,
  whiteboardShapeAt,
  whiteboardShapeContains,
} from '../src/whiteboard/geometry';
import { wrapWhiteboardLabel } from '../src/whiteboard/label';
import { parseWhiteboard } from '../src/whiteboard/parser';
import {
  renderWhiteboard,
  visibleWhiteboardElements,
  visibleWhiteboardIndices,
  whiteboardBounds,
} from '../src/whiteboard/renderer';
import type {
  WhiteboardArrow,
  WhiteboardNote,
  WhiteboardRenderOptions,
} from '../src/advanced';

const wb = (...lines: string[]): string => ['whiteboard', ...lines].join('\n');

function note(src: string): WhiteboardNote {
  const p = parseWhiteboard(wb(src));
  expect(p.diagnostics).toEqual([]);
  expect(p.elements).toHaveLength(1);
  return p.elements[0] as WhiteboardNote;
}

function draw(src: string, opts?: WhiteboardRenderOptions): SVGSVGElement {
  const pal = getPalette('nord').light;
  const el = document.createElement('div');
  renderWhiteboard(el, parseWhiteboard(src, pal), pal, false, opts);
  return el.querySelector('svg')!;
}

describe('whiteboard sticky notes — parse', () => {
  it('defaults to a 160 × 99 (golden) yellow note', () => {
    expect(note('note ask legal at: 10 20')).toMatchObject({
      kind: 'note',
      x: 10,
      y: 20,
      width: 160,
      height: 99,
      text: 'ask legal',
      color: 'yellow',
    });
    expect(advanced.WHITEBOARD_NOTE_WIDTH).toBe(160);
    expect(advanced.WHITEBOARD_NOTE_HEIGHT).toBe(99);
    expect(advanced.WHITEBOARD_NOTE_COLOR).toBe('yellow');
  });

  it('reads size and colour', () => {
    expect(note('note Todo at: 0 0, size: 200 90, color: blue')).toMatchObject({
      width: 200,
      height: 90,
      color: 'blue',
    });
  });

  it('takes indented body lines, and may be empty', () => {
    expect(note('note at: 0 0\n  first\n  second').text).toBe('first\nsecond');
    expect(note('note at: 0 0').text).toBe('');
  });

  it('warns on an unknown colour and stays yellow', () => {
    const p = parseWhiteboard(wb('note Hi at: 0 0, color: pink'));
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_UNKNOWN_COLOR',
    ]);
    expect(p.diagnostics[0]!.message).toContain('drawn in yellow');
    expect((p.elements[0] as WhiteboardNote).color).toBe('yellow');
  });

  it('needs at:, and warns on a key it does not take', () => {
    const p = parseWhiteboard(
      wb('note Hi size: 10 10', 'note Ok at: 0 0, style: dashed')
    );
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_BAD_GEOMETRY',
      'W_WHITEBOARD_UNKNOWN_KEY',
    ]);
    expect(p.elements).toHaveLength(1);
  });

  it('reads no-notes as a board option', () => {
    const p = parseWhiteboard(wb('no-notes', 'note Hi at: 0 0'));
    expect(p.diagnostics).toEqual([]);
    expect(p.options.noNotes).toBe(true);
    expect(parseWhiteboard(wb('note Hi at: 0 0')).options.noNotes).toBe(false);
  });
});

describe('whiteboard sticky notes — emit', () => {
  it('omits the default size and colour, and round-trips', () => {
    const src = wb(
      'no-notes',
      'note ask legal at: 10 20',
      'note at: 0 0, size: 200 90, color: ink',
      '  two',
      '  lines',
      'note at: 300 0',
      ''
    );
    const p = parseWhiteboard(src);
    expect(p.diagnostics).toEqual([]);
    const out = emitWhiteboard(p);
    expect(out).toBe(src);
    expect(sameWhiteboard(p, parseWhiteboard(out))).toBe(true);
  });

  it('normalises written defaults away', () => {
    const p = parseWhiteboard(
      wb('note Hi at: 0 0, size: 160 99, color: yellow')
    );
    expect(emitWhiteboard(p)).toBe(wb('note Hi at: 0 0', ''));
  });
});

describe('whiteboard sticky notes — render', () => {
  it('draws a tinted card with its text top-left, wrapped to the card', () => {
    const src = wb(
      'note at: 0 0, size: 120 120',
      '  Ask legal whether SSO needs a review',
      '  Sam'
    );
    const svg = draw(src);
    const pal = getPalette('nord').light;
    const card = svg.querySelector('.whiteboard-note path')!;
    expect(card.getAttribute('fill')).toBe(
      mix(pal.colors.yellow!, themeBaseBg(pal, false), 40)
    );
    // The outline cuts the top-right corner on the diagonal: the fold.
    expect(card.getAttribute('d')).toBe('M0 0h102l18 18v102h-120z');
    const fold = svg.querySelector('.whiteboard-note-fold')!;
    expect(fold.getAttribute('fill')).toBe(card.getAttribute('stroke'));
    expect(fold.getAttribute('opacity')).toBe('0.55');
    // Text is 12px, a dark shade of the note's own hue.
    const text = svg.querySelector('.whiteboard-note text')!;
    expect(text.getAttribute('font-size')).toBe('12');
    expect(text.getAttribute('fill')).toBe(
      mix(pal.colors.yellow!, pal.text, 40)
    );
    const spans = [...svg.querySelectorAll('.whiteboard-note tspan')];
    const el = parseWhiteboard(src).elements[0] as WhiteboardNote;
    expect(spans.map((t) => t.textContent)).toEqual(
      wrapWhiteboardLabel(el.text, el)
    );
    expect(spans.length).toBeGreaterThan(2);
    expect(spans.every((t) => t.getAttribute('x') === '12')).toBe(true);
    expect(Number(spans[0]!.getAttribute('y'))).toBeCloseTo(12 + 15 * 0.8);
  });

  it('hides every note under no-notes, and showNotes overrides it both ways', () => {
    const shown = wb('rectangle A at: 0 0, size: 50 50', 'note Hi at: 200 0');
    const hidden = wb(
      'no-notes',
      'rectangle A at: 0 0, size: 50 50',
      'note Hi at: 200 0'
    );
    expect(draw(shown).querySelector('.whiteboard-note')).not.toBeNull();
    expect(draw(hidden).querySelector('.whiteboard-note')).toBeNull();
    expect(
      draw(hidden, { showNotes: true }).querySelector('.whiteboard-note')
    ).not.toBeNull();
    expect(
      draw(shown, { showNotes: false }).querySelector('.whiteboard-note')
    ).toBeNull();
  });

  it('crops to what is drawn: hidden notes take no room', () => {
    const p = parseWhiteboard(
      wb('rectangle A at: 0 0, size: 50 50', 'note Hi at: 500 500')
    );
    expect(whiteboardBounds(p).maxX).toBe(660);
    expect(whiteboardBounds(p, { showNotes: false }).maxX).toBe(50);
    expect(visibleWhiteboardElements(p, { showNotes: false })).toHaveLength(1);
  });

  it('hides an arrow or line drawn from a hidden note, and keeps the rest', () => {
    const p = parseWhiteboard(
      wb(
        'rectangle A at: 300 0, size: 100 100',
        'note Hi at: 0 0, size: 100 100',
        'arrow why from: 50 50, to: 350 50',
        'line from: 350 150, to: 50 50',
        'arrow from: 350 50, to: 600 50'
      )
    );
    expect(visibleWhiteboardIndices(p)).toEqual([0, 1, 2, 3, 4]);
    expect(visibleWhiteboardIndices(p, { showNotes: false })).toEqual([0, 4]);
    const svg = draw(
      wb(
        'no-notes',
        'rectangle A at: 300 0, size: 100 100',
        'note Hi at: 0 0, size: 100 100',
        'arrow why from: 50 50, to: 350 50'
      )
    );
    expect(svg.textContent).not.toContain('why');
  });

  it('hides a connector whose end the hidden note held over a shape', () => {
    // The note sits on top of the box, so it — not the box — holds the end.
    const p = parseWhiteboard(
      wb(
        'rectangle A at: 0 0, size: 200 200',
        'note Hi at: 20 20, size: 80 80',
        'arrow from: 50 50, to: 400 50'
      )
    );
    expect(visibleWhiteboardIndices(p, { showNotes: false })).toEqual([0]);
  });

  it('grows the crop only by the one line a too-short card still keeps', () => {
    // The text is cut to fit (#1225), but at least one line is drawn.
    const p = parseWhiteboard(
      wb('note at: 0 0, size: 100 30', '  a', '  b', '  c', '  d')
    );
    expect(whiteboardBounds(p).maxY).toBeCloseTo(24 + 9 * 1.25);
  });

  it('threads showNotes through render()', async () => {
    const src = wb('rectangle A at: 0 0, size: 50 50', 'note Hi at: 200 0');
    const on = await render(src);
    const off = await render(src, { showNotes: false });
    expect(on.svg).toContain('whiteboard-note');
    expect(off.svg).not.toContain('whiteboard-note');
  });
});

describe('whiteboard sticky notes — attached ends', () => {
  it('a note is hit-testable and an arrow end inside it attaches', () => {
    const p = parseWhiteboard(
      wb('note Hi at: 100 0, size: 100 100', 'arrow from: 0 50, to: 150 50')
    );
    const [n, a] = p.elements as [WhiteboardNote, WhiteboardArrow];
    expect(whiteboardShapeContains(n, { x: 150, y: 50 })).toBe(true);
    expect(whiteboardShapeAt({ x: 150, y: 50 }, p.elements)).toBe(0);
    expect(clipWhiteboardConnector(a, p.elements).x2).toBeCloseTo(100);
  });

  it('the folded corner is outside the note, and an end meets the fold', () => {
    // 100 × 100 at 0 0: fold leg 18, so the cut runs (82,0) → (100,18).
    const p = parseWhiteboard(
      wb('note Hi at: 0 0, size: 100 100', 'arrow from: 150 -50, to: 50 50')
    );
    const [n, a] = p.elements as [WhiteboardNote, WhiteboardArrow];
    expect(whiteboardShapeContains(n, { x: 98, y: 2 })).toBe(false);
    expect(whiteboardShapeContains(n, { x: 80, y: 2 })).toBe(true);
    expect(whiteboardShapeContains(n, { x: 98, y: 20 })).toBe(true);
    // Aimed at the centre along y = 100 − x, the end lands where that line
    // crosses the cut y = x − 82: (91, 9).
    const s = clipWhiteboardConnector(a, p.elements);
    expect(s.x2).toBeCloseTo(91);
    expect(s.y2).toBeCloseTo(9);
  });

  it('a hidden note takes the arrow drawn into it along', () => {
    const src = wb(
      'no-notes',
      'note Hi at: 100 0, size: 100 100',
      'arrow from: 0 50, to: 150 50'
    );
    expect(draw(src).querySelector('.whiteboard-arrow')).toBeNull();
  });
});
