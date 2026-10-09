import { describe, expect, it } from 'vitest';

import * as advanced from '../src/advanced';
import {
  WHITEBOARD_LABEL_FONT,
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
});
