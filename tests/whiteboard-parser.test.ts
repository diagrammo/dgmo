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

  it('is fatal for an empty board', () => {
    expect(parseWhiteboard('whiteboard Empty').error).toMatch(/No elements/);
    expect(parseWhiteboard('').error).toMatch(/No content/);
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

  it('warns on an unknown key but keeps the element', () => {
    const p = parseWhiteboard('whiteboard\ntext a at: 0 0, colour: red');
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_UNKNOWN_KEY',
    ]);
    expect(p.diagnostics[0]!.message).toMatch(/color/);
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

  it('round-trips no-title and an untitled board', () => {
    const src = 'whiteboard\nno-title\nqueue at: -5 -5, size: 60 30\n';
    expect(emitWhiteboard(parseWhiteboard(src))).toBe(src);
  });
});
