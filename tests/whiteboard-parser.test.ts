import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDgmo } from '../src/dgmo-router';
import { encodeInk } from '../src/whiteboard/ink-codec';
import { parseWhiteboard } from '../src/whiteboard/parser';
import { emitWhiteboard, sameWhiteboard } from '../src/whiteboard/emit';
import type { WhiteboardElement } from '../src/whiteboard/types';

const FIXTURE = readFileSync(
  join(__dirname, '..', 'gallery', 'fixtures', 'whiteboard.dgmo'),
  'utf8'
);

const codes = (src: string): (string | undefined)[] =>
  parseWhiteboard(src).diagnostics.map((d) => d.code);

function only(src: string): WhiteboardElement {
  const p = parseWhiteboard(`whiteboard\n${src}`);
  expect(p.diagnostics).toEqual([]);
  expect(p.elements).toHaveLength(1);
  return p.elements[0]!;
}

describe('parseWhiteboard — elements', () => {
  it('parses the gallery fixture cleanly, every kind present', () => {
    const p = parseWhiteboard(FIXTURE);
    expect(p.error).toBeNull();
    expect(p.diagnostics).toEqual([]);
    expect(p.title).toBe('Login ideas');
    const kinds = new Set(
      p.elements.map((e) => (e.kind === 'shape' ? e.shape : e.kind))
    );
    expect([...kinds].sort()).toEqual(
      [
        'arrow',
        'database',
        'ellipse',
        'image',
        'ink',
        'note',
        'queue',
        'rectangle',
        'text',
      ].sort()
    );
  });

  it('routes through parseDgmo with no diagnostics', () => {
    expect(parseDgmo(FIXTURE).diagnostics).toEqual([]);
  });

  it('reads a shape: label, position, size, colour', () => {
    expect(
      only('ellipse OAuth? at: -345 53, size: 170 84, color: blue')
    ).toEqual({
      kind: 'shape',
      shape: 'ellipse',
      x: -345,
      y: 53,
      width: 170,
      height: 84,
      label: 'OAuth?',
      color: 'blue',
      fill: 'tint',
      lineNumber: 2,
    });
  });

  it('defaults colour to ink and allows an empty label', () => {
    expect(only('database at: 0 0, size: 80 100')).toMatchObject({
      shape: 'database',
      label: '',
      color: 'ink',
    });
  });

  it('reads a free arrow, with and without a label', () => {
    expect(only('arrow from: 240 95, to: 340 -95')).toMatchObject({
      kind: 'arrow',
      x1: 240,
      y1: 95,
      x2: 340,
      y2: -95,
      label: '',
    });
    expect(
      only('arrow emails a code from: 0 0, to: 0 100, color: green')
    ).toMatchObject({ label: 'emails a code', color: 'green' });
  });

  it('reads a free line exactly like an arrow, minus the head', () => {
    expect(only('line from: 240 95, to: 340 -95')).toEqual({
      kind: 'line',
      x1: 240,
      y1: 95,
      x2: 340,
      y2: -95,
      label: '',
      color: 'ink',
      style: 'solid',
      bend: 0,
      lineNumber: 2,
    });
    expect(
      only('line splits here from: 0 0, to: 0 100, color: green')
    ).toMatchObject({ label: 'splits here', color: 'green' });
  });

  it('reads style: dashed on arrows and lines, solid by default', () => {
    expect(only('arrow from: 0 0, to: 10 0')).toMatchObject({
      style: 'solid',
    });
    expect(only('arrow from: 0 0, to: 10 0, style: dashed')).toMatchObject({
      kind: 'arrow',
      style: 'dashed',
    });
    expect(
      only('line maybe from: 0 0, to: 10 0, color: red, style: Dashed')
    ).toMatchObject({ kind: 'line', label: 'maybe', style: 'dashed' });
  });

  it('reads free text, keeping commas and punctuation', () => {
    expect(only('text wait, why?? at: 5 6, color: red')).toMatchObject({
      kind: 'text',
      text: 'wait, why??',
      x: 5,
      y: 6,
      color: 'red',
    });
  });

  it('reads a quoted label that contains a key-like word', () => {
    expect(only('text "todo: ship it" at: 0 0')).toMatchObject({
      text: 'todo: ship it',
    });
  });

  it('reads both image forms, including a path with spaces', () => {
    expect(
      only('image Login ideas.assets/9f3c.webp at: 1 2, size: 30 40')
    ).toMatchObject({
      kind: 'image',
      ref: 'Login ideas.assets/9f3c.webp',
      width: 30,
      height: 40,
    });
    expect(
      only('image https://cdn.example.com/a/b.webp at: 1 2, size: 30 40')
    ).toMatchObject({ ref: 'https://cdn.example.com/a/b.webp' });
  });

  it('reads an ink stroke', () => {
    const enc = encodeInk([
      { x: 0, y: 0 },
      { x: 10, y: 4 },
    ]);
    expect(only(`ink purple 2.5 ${enc}`)).toMatchObject({
      kind: 'ink',
      color: 'purple',
      width: 2.5,
      encoded: enc,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 4 },
      ],
    });
  });

  it('accepts no-title and other universal flags', () => {
    const p = parseWhiteboard(
      'whiteboard T\nno-title\nno-legend\ntext a at: 0 0'
    );
    expect(p.diagnostics).toEqual([]);
    expect(p.options.noTitle).toBe(true);
  });

  it('ignores comments and blank lines', () => {
    const p = parseWhiteboard('// hi\nwhiteboard\n\n// note\ntext a at: 0 0\n');
    expect(p.diagnostics).toEqual([]);
    expect(p.elements).toHaveLength(1);
  });
});

describe('parseWhiteboard — leniency', () => {
  it('is fatal only for a wrong first line', () => {
    const p = parseWhiteboard('sketch\ntext a at: 0 0');
    expect(p.error).toMatch(/Expected chart type "whiteboard"/);
  });

  it('accepts an empty board — a blank canvas is where drawing starts', () => {
    const p = parseWhiteboard('whiteboard Empty');
    expect(p.error).toBeNull();
    expect(p.diagnostics).toEqual([]);
    expect(p.elements).toEqual([]);
    expect(parseWhiteboard('').error).toMatch(/No content/);
  });

  it('a blank board passes validation with no diagnostics at all', () => {
    // The New file dialog's blank board is the bare first line (#1248).
    expect(parseDgmo('whiteboard').diagnostics).toEqual([]);
    expect(parseDgmo('whiteboard Ideas\n').diagnostics).toEqual([]);
  });

  it('skips a bad line with a warning and keeps the rest', () => {
    const p = parseWhiteboard(
      [
        'whiteboard',
        'square at: 0 0, size: 5 5',
        'rectangle at: 0, size: 5 5',
        'rectangle at: 0 0',
        'rectangle at: 0 0, size: 0 5',
        'rectangle at: 1.5 0, size: 5 5',
        'text at: 0 0',
        'image ftp://x/y.png at: 0 0, size: 5 5',
        'image /abs/y.png at: 0 0, size: 5 5',
        'ink red 3',
        'ink red wide AAAA',
        'ink red 3 !!!',
        'arrow from: 0 0',
        'rectangle ok at: 9999999 0, size: 5 5',
        'text survivor at: 0 0',
      ].join('\n')
    );
    expect(p.error).toBeNull();
    expect(p.elements).toHaveLength(1);
    expect(p.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_UNKNOWN_ELEMENT',
      'W_WHITEBOARD_BAD_GEOMETRY',
      'W_WHITEBOARD_BAD_GEOMETRY',
      'W_WHITEBOARD_OUT_OF_RANGE',
      'W_WHITEBOARD_BAD_GEOMETRY',
      'W_WHITEBOARD_EMPTY_TEXT',
      'W_WHITEBOARD_BAD_IMAGE_REF',
      'W_WHITEBOARD_BAD_IMAGE_REF',
      'W_WHITEBOARD_BAD_INK',
      'W_WHITEBOARD_BAD_INK',
      'W_WHITEBOARD_BAD_INK',
      'W_WHITEBOARD_BAD_GEOMETRY',
      'W_WHITEBOARD_OUT_OF_RANGE',
    ]);
    expect(p.diagnostics.map((d) => d.line)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });

  it('suggests the element keyword for a near miss', () => {
    const p = parseWhiteboard(
      'whiteboard\nrectangel at: 0 0, size: 5 5\ntext a at: 0 0'
    );
    expect(p.diagnostics[0]!.message).toMatch(/rectangle/);
  });

  it('warns on an unknown colour and draws in ink', () => {
    const p = parseWhiteboard('whiteboard\ntext a at: 0 0, color: crimson');
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_UNKNOWN_COLOR',
    ]);
    expect(p.elements[0]).toMatchObject({ color: 'ink' });
    expect(codes('whiteboard\ntext a at: 0 0, color: #ff0000')).toEqual([
      'W_WHITEBOARD_UNKNOWN_COLOR',
    ]);
  });

  it('warns on an unknown style and draws solid', () => {
    for (const bad of ['dotted', 'solid', 'dahsed']) {
      const p = parseWhiteboard(
        `whiteboard\nline from: 0 0, to: 10 0, style: ${bad}`
      );
      expect(p.diagnostics.map((d) => d.code)).toEqual([
        'W_WHITEBOARD_UNKNOWN_STYLE',
      ]);
      expect(p.elements[0]).toMatchObject({ kind: 'line', style: 'solid' });
    }
    const near = parseWhiteboard(
      'whiteboard\narrow from: 0 0, to: 10 0, style: dahsed'
    );
    expect(near.diagnostics[0]!.message).toMatch(/dashed/);
  });

  it('style is not a key on shapes or text', () => {
    expect(
      codes('whiteboard\nrectangle at: 0 0, size: 5 5, style: dashed')
    ).toEqual(['W_WHITEBOARD_UNKNOWN_KEY']);
  });

  it('warns on an unknown key but keeps the element', () => {
    const p = parseWhiteboard('whiteboard\ntext a at: 0 0, colour: red');
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_UNKNOWN_KEY',
    ]);
    expect(p.diagnostics[0]!.message).toMatch(/color/);
    expect(p.elements).toHaveLength(1);
  });
});

describe('parseWhiteboard — fill, heads and bend', () => {
  it('reads fill: solid and outline on shapes, tint by default', () => {
    expect(only('rectangle at: 0 0, size: 10 10')).toMatchObject({
      fill: 'tint',
    });
    expect(only('ellipse at: 0 0, size: 10 10, fill: solid')).toMatchObject({
      fill: 'solid',
    });
    expect(only('queue at: 0 0, size: 10 10, fill: Outline')).toMatchObject({
      fill: 'outline',
    });
  });

  it('reads heads: both on arrows, one head by default', () => {
    expect(only('arrow from: 0 0, to: 10 0')).toMatchObject({ heads: 'end' });
    expect(only('arrow from: 0 0, to: 10 0, heads: both')).toMatchObject({
      heads: 'both',
    });
  });

  it('reads bend: on arrows and lines, straight by default', () => {
    expect(only('line from: 0 0, to: 10 0')).toMatchObject({ bend: 0 });
    expect(only('arrow from: 0 0, to: 10 0, bend: -60')).toMatchObject({
      bend: -60,
    });
    expect(only('line from: 0 0, to: 10 0, bend: 24')).toMatchObject({
      bend: 24,
    });
  });

  it('warns on a bad value and keeps the element at its default', () => {
    const p = parseWhiteboard(
      [
        'whiteboard',
        'rectangle at: 0 0, size: 10 10, fill: soild',
        'arrow from: 0 0, to: 10 0, heads: start',
        'line from: 0 0, to: 10 0, bend: 1.5',
      ].join('\n')
    );
    expect(p.elements).toHaveLength(3);
    expect(p.elements[0]).toMatchObject({ fill: 'tint' });
    expect(p.elements[1]).toMatchObject({ heads: 'end' });
    expect(p.elements[2]).toMatchObject({ bend: 0 });
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_BAD_VALUE',
      'W_WHITEBOARD_BAD_VALUE',
      'W_WHITEBOARD_BAD_VALUE',
    ]);
    expect(p.diagnostics[0]!.message).toContain('solid');
  });

  it('heads: is not a key on lines, fill: not on arrows or notes', () => {
    for (const line of [
      'line from: 0 0, to: 10 0, heads: both',
      'arrow from: 0 0, to: 10 0, fill: solid',
      'note at: 0 0, fill: solid',
    ]) {
      const p = parseWhiteboard(`whiteboard\n${line}`);
      expect(p.diagnostics.map((d) => d.code)).toEqual([
        'W_WHITEBOARD_UNKNOWN_KEY',
      ]);
    }
  });
});

describe('parseWhiteboard — multi-line labels', () => {
  it('reads indented body lines as the lines of a shape label', () => {
    const el = only('rectangle at: 0 0, size: 100 50\n  Sign in\n  with email');
    expect(el).toMatchObject({ kind: 'shape', label: 'Sign in\nwith email' });
  });

  it('puts an inline label first, ahead of the body', () => {
    const el = only('ellipse Sign in at: 0 0, size: 100 50\n  with email');
    expect(el).toMatchObject({ label: 'Sign in\nwith email' });
  });

  it('gives arrows, lines and text a multi-line label too', () => {
    const p = parseWhiteboard(
      [
        'whiteboard',
        'arrow from: 0 0, to: 100 0',
        '  sends',
        '  a code',
        'line maybe from: 0 10, to: 100 10',
        '  later',
        'text at: 0 40',
        '  first',
        '  second',
        'database at: 0 80, size: 60 60',
        '  Users',
        '  (read)',
      ].join('\n')
    );
    expect(p.diagnostics).toEqual([]);
    expect(
      p.elements.map((e) =>
        e.kind === 'text' ? e.text : (e as { label: string }).label
      )
    ).toEqual([
      'sends\na code',
      'maybe\nlater',
      'first\nsecond',
      'Users\n(read)',
    ]);
  });

  it('draws body lines as written: no reflow, comments and keys are text', () => {
    const el = only(
      'text at: 0 0\n  // not a comment\n  at: 5 5 is text\n  "quoted"   '
    );
    expect(el).toMatchObject({
      text: '// not a comment\nat: 5 5 is text\n"quoted"',
    });
  });

  it('keeps an interior blank line, drops blank lines at either end', () => {
    const p = parseWhiteboard(
      'whiteboard\nrectangle at: 0 0, size: 9 9\n\n  a\n\n\n  b\n\ntext c at: 0 20\n'
    );
    expect(p.diagnostics).toEqual([]);
    expect(p.elements[0]).toMatchObject({ label: 'a\n\n\nb' });
    expect(p.elements[1]).toMatchObject({ kind: 'text', text: 'c' });
  });

  it('ends the body at the first line not indented deeper', () => {
    const p = parseWhiteboard(
      'whiteboard\n  rectangle at: 0 0, size: 9 9\n    a\n  text b at: 0 20\n'
    );
    expect(p.elements).toHaveLength(2);
    expect(p.elements[0]).toMatchObject({ label: 'a' });
  });

  it('accepts text whose only words are in the body', () => {
    expect(codes('whiteboard\ntext at: 0 0\n  hi')).toEqual([]);
    expect(codes('whiteboard\ntext at: 0 0\n\ntext b at: 0 9')).toEqual([
      'W_WHITEBOARD_EMPTY_TEXT',
    ]);
  });

  it('warns on a body under image or ink and ignores it', () => {
    const img = parseWhiteboard(
      'whiteboard\nimage a.assets/x.webp at: 0 0, size: 9 9\n  caption\n  more'
    );
    expect(img.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_UNEXPECTED_BODY',
    ]);
    expect(img.diagnostics[0]!.message).toMatch(
      /image takes no indented lines — 2 ignored/
    );
    expect(img.elements).toHaveLength(1);
    const ink = parseWhiteboard(
      'whiteboard\nink ink 3 AHysAxoGEgIUAyYJFAESAi4MEgIUAyYJFAESAjQOGgE\n  x'
    );
    expect(ink.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_UNEXPECTED_BODY',
    ]);
    expect(ink.elements).toHaveLength(1);
  });

  it('a skipped element takes its body with it', () => {
    const p = parseWhiteboard(
      'whiteboard\nsquare at: 0 0, size: 9 9\n  rectangle at: 0 0, size: 9 9\ntext a at: 0 0'
    );
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_UNKNOWN_ELEMENT',
    ]);
    expect(p.elements).toHaveLength(1);
  });
});

describe('emitWhiteboard — round trip', () => {
  it('parse → emit → parse is identical, and emit is stable', () => {
    const a = parseWhiteboard(FIXTURE);
    const once = emitWhiteboard(a);
    const b = parseWhiteboard(once);
    expect(b.diagnostics).toEqual([]);
    expect(sameWhiteboard(a, b)).toBe(true);
    expect(emitWhiteboard(b)).toBe(once);
    expect(once).toBe(FIXTURE);
  });

  it('normalises non-canonical input to canonical text', () => {
    const src =
      'whiteboard  T\n  rectangle   Box at: 1 2,size: 3 4 , color: ink\nTEXT hi at: 0 0, color: RED\n';
    const out = emitWhiteboard(parseWhiteboard(src));
    expect(out).toBe(
      'whiteboard T\nrectangle Box at: 1 2, size: 3 4\ntext hi at: 0 0, color: red\n'
    );
  });

  it('quotes a label the parser would otherwise split', () => {
    const p = parseWhiteboard('whiteboard\ntext "look at: this" at: 0 0');
    const out = emitWhiteboard(p);
    expect(out).toContain('text "look at: this" at: 0 0');
    expect(sameWhiteboard(p, parseWhiteboard(out))).toBe(true);
  });

  it('round-trips lines and dashed arrows and lines', () => {
    const src = [
      'whiteboard',
      'line from: 0 0, to: 100 0',
      'line maybe from: 0 10, to: 100 10, color: blue',
      'arrow from: 0 20, to: 100 20, style: dashed',
      'line from: 0 30, to: 100 -30, color: red, style: dashed',
      'arrow "note: this" from: 0 40, to: 100 40, style: dashed',
      '',
    ].join('\n');
    const a = parseWhiteboard(src);
    expect(a.diagnostics).toEqual([]);
    expect(emitWhiteboard(a)).toBe(src);
    expect(sameWhiteboard(a, parseWhiteboard(emitWhiteboard(a)))).toBe(true);
  });

  it('round-trips fill, heads and bend, omitting each default', () => {
    const src = [
      'whiteboard',
      'rectangle at: 0 0, size: 100 60, color: blue, fill: solid',
      'ellipse at: 200 0, size: 100 60, fill: outline',
      'arrow from: 0 100, to: 100 100, heads: both',
      'arrow from: 0 120, to: 100 120, color: red, style: dashed, heads: both, bend: -40',
      'line from: 0 140, to: 100 140, bend: 12',
      '',
    ].join('\n');
    const a = parseWhiteboard(src);
    expect(a.diagnostics).toEqual([]);
    expect(emitWhiteboard(a)).toBe(src);
    expect(
      emitWhiteboard(
        parseWhiteboard(
          'whiteboard\nrectangle at: 0 0, size: 1 1, fill: tint\nline from: 0 0, to: 1 1, bend: 0'
        )
      )
    ).toBe(
      'whiteboard\nrectangle at: 0 0, size: 1 1\nline from: 0 0, to: 1 1\n'
    );
  });

  it('emits a multi-line label as indented body lines, and back', () => {
    const src = [
      'whiteboard',
      'rectangle at: 0 0, size: 100 50',
      '  Sign in',
      '  with email',
      'arrow from: 0 60, to: 100 60, style: dashed',
      '  sends',
      '',
      '  a code',
      'line from: 0 70, to: 100 70, color: blue',
      '  key: value',
      '  two',
      'text at: 0 80, color: red',
      '  first',
      '  second',
      'text one line at: 0 120',
      '',
    ].join('\n');
    const a = parseWhiteboard(src);
    expect(a.diagnostics).toEqual([]);
    expect(emitWhiteboard(a)).toBe(src);
    expect(sameWhiteboard(a, parseWhiteboard(emitWhiteboard(a)))).toBe(true);
  });

  it('normalises an inline label plus body to body lines only', () => {
    const out = emitWhiteboard(
      parseWhiteboard(
        'whiteboard\nqueue Jobs at: 0 0, size: 9 9\n      out   \n'
      )
    );
    expect(out).toBe('whiteboard\nqueue at: 0 0, size: 9 9\n  Jobs\n  out\n');
  });

  it('round-trips no-title and an untitled board', () => {
    const src = 'whiteboard\nno-title\nqueue at: -5 -5, size: 60 30\n';
    expect(emitWhiteboard(parseWhiteboard(src))).toBe(src);
  });
});
