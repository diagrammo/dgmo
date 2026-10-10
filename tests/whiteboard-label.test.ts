import { describe, expect, it } from 'vitest';

import * as advanced from '../src/advanced';
import {
  fitWhiteboardLabel,
  WHITEBOARD_LABEL_FONT,
  WHITEBOARD_LABEL_MIN_FONT,
  WHITEBOARD_NOTE_FONT,
  whiteboardLabelHeight,
  whiteboardLabelWidth,
  wrapWhiteboardLabel,
} from '../src/whiteboard/label';
import { measureText } from '../src/utils/text-measure';

const box = (width: number, shape: 'rectangle' | 'ellipse' = 'rectangle') => ({
  shape,
  width,
});

describe('wrapWhiteboardLabel', () => {
  it('is exported from @diagrammo/dgmo/advanced', () => {
    expect(advanced.wrapWhiteboardLabel).toBe(wrapWhiteboardLabel);
    expect(advanced.whiteboardLabelWidth).toBe(whiteboardLabelWidth);
    expect(advanced.WHITEBOARD_NOTE_FONT).toBe(12);
  });

  it('gives no lines for no label', () => {
    expect(wrapWhiteboardLabel('', box(100))).toEqual([]);
  });

  it('keeps a short label on one line', () => {
    expect(wrapWhiteboardLabel('Sign in', box(180))).toEqual(['Sign in']);
  });

  it('wraps a long one-line label inside a 100px box', () => {
    const lines = wrapWhiteboardLabel(
      'Send the magic link email to the user',
      box(100)
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('Send the magic link email to the user');
    for (const l of lines) {
      expect(measureText(l, WHITEBOARD_LABEL_FONT)).toBeLessThanOrEqual(
        whiteboardLabelWidth(box(100))
      );
    }
  });

  it('keeps manual breaks and wraps each written line on its own', () => {
    const lines = wrapWhiteboardLabel(
      'Title\nsome much longer second line here',
      box(100)
    );
    expect(lines[0]).toBe('Title');
    expect(lines.slice(1).join(' ')).toBe('some much longer second line here');
    expect(lines.length).toBeGreaterThan(2);
  });

  it('keeps an empty written line as an empty drawn line', () => {
    expect(wrapWhiteboardLabel('a\n\nb', box(200))).toEqual(['a', '', 'b']);
  });

  it('wraps narrower inside an ellipse than inside a rectangle', () => {
    expect(whiteboardLabelWidth(box(200, 'ellipse'))).toBeLessThan(
      whiteboardLabelWidth(box(200))
    );
    expect(whiteboardLabelWidth(box(200))).toBe(184);
  });

  it('never wraps to less than 20px, so a tiny shape still draws a word a line', () => {
    expect(whiteboardLabelWidth(box(10))).toBe(20);
    expect(wrapWhiteboardLabel('a b', box(10))).toEqual(['a', 'b']);
  });

  it('wraps a sticky note at the smaller note font', () => {
    const note = { kind: 'note' as const, width: 124 };
    const text = 'Ask legal whether SSO needs a security review first';
    const lines = wrapWhiteboardLabel(text, note);
    expect(lines.join(' ')).toBe(text);
    for (const l of lines) {
      expect(measureText(l, WHITEBOARD_NOTE_FONT)).toBeLessThanOrEqual(100);
    }
    // At the label font the same text needs more lines.
    expect(lines.length).toBeLessThan(
      wrapWhiteboardLabel(text, { shape: 'rectangle', width: 116 }).length
    );
  });
});

describe('fitWhiteboardLabel (#1225)', () => {
  const rect = (width: number, height: number) => ({
    shape: 'rectangle' as const,
    width,
    height,
  });
  const fits = (
    { lines, font }: { lines: string[]; font: number },
    b: ReturnType<typeof rect>
  ) => {
    for (const l of lines)
      expect(measureText(l, font)).toBeLessThanOrEqual(whiteboardLabelWidth(b));
    expect(lines.length * font * 1.25).toBeLessThanOrEqual(
      whiteboardLabelHeight(b)
    );
  };

  it('is exported from @diagrammo/dgmo/advanced', () => {
    expect(advanced.fitWhiteboardLabel).toBe(fitWhiteboardLabel);
    expect(advanced.WHITEBOARD_LABEL_MIN_FONT).toBe(WHITEBOARD_LABEL_MIN_FONT);
  });

  it('keeps the full size when the label already fits', () => {
    expect(fitWhiteboardLabel('Sign in', rect(180, 70))).toEqual({
      lines: ['Sign in'],
      font: WHITEBOARD_LABEL_FONT,
    });
  });

  it('shrinks a label too tall for its shape until it fits', () => {
    const b = rect(130, 70);
    const text =
      'Hello World What Happens with Really Long text inside of shapes do we make it smaller?';
    const fit = fitWhiteboardLabel(text, b);
    expect(fit.font).toBeLessThan(WHITEBOARD_LABEL_FONT);
    expect(fit.font).toBeGreaterThanOrEqual(WHITEBOARD_LABEL_MIN_FONT);
    expect(fit.lines.join(' ')).toBe(text);
    fits(fit, b);
  });

  it('shrinks a word too wide for the shape before breaking it', () => {
    const b = rect(100, 60);
    const fit = fitWhiteboardLabel('Authentication', b);
    expect(fit.lines).toEqual(['Authentication']);
    fits(fit, b);
  });

  it('breaks a word too wide even at the floor', () => {
    const b = rect(60, 80);
    const word = 'Supercalifragilisticexpialidocious';
    const fit = fitWhiteboardLabel(word, b);
    expect(fit.font).toBe(WHITEBOARD_LABEL_MIN_FONT);
    expect(fit.lines.length).toBeGreaterThan(1);
    expect(fit.lines.join('')).toBe(word);
    fits(fit, b);
  });

  it('cuts what will not fit at the floor and ends the last line in an ellipsis', () => {
    const b = rect(100, 40);
    const fit = fitWhiteboardLabel(
      Array.from({ length: 30 }, (_, i) => `word${i}`).join(' '),
      b
    );
    expect(fit.font).toBe(WHITEBOARD_LABEL_MIN_FONT);
    expect(fit.lines.at(-1)!.endsWith('…')).toBe(true);
    fits(fit, b);
  });

  it('always keeps one line, even in a shape with no room', () => {
    const fit = fitWhiteboardLabel('a b c', rect(100, 10));
    expect(fit.lines).toHaveLength(1);
  });

  it('fits a note at the note font first', () => {
    const fit = fitWhiteboardLabel('short', {
      kind: 'note' as const,
      width: 160,
      height: 120,
    });
    expect(fit.font).toBe(WHITEBOARD_NOTE_FONT);
  });

  it('leaves less height in an ellipse and a database than in a rectangle', () => {
    const h = whiteboardLabelHeight(rect(100, 100));
    expect(
      whiteboardLabelHeight({ shape: 'ellipse', width: 100, height: 100 })
    ).toBeLessThan(h);
    expect(
      whiteboardLabelHeight({ shape: 'database', width: 100, height: 100 })
    ).toBeLessThan(h);
    expect(whiteboardLabelWidth({ shape: 'queue', width: 100 })).toBeLessThan(
      whiteboardLabelWidth({ shape: 'rectangle', width: 100 })
    );
  });
});

it('mirrors the cap sizes c4 draws a database and a queue with', async () => {
  const c4 = await import('../src/shape-caps');
  const b = { shape: 'database' as const, width: 100, height: 100 };
  expect(whiteboardLabelHeight(b)).toBe(100 - 2 * (8 + 2 * c4.CYLINDER_RY));
  expect(whiteboardLabelWidth({ shape: 'queue', width: 100 })).toBe(
    100 - 2 * (8 + c4.QUEUE_CAP)
  );
});
