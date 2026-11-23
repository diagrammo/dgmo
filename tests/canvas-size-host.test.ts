// ============================================================
// canvas-size-host.test.ts — a host reads the file's canvas (#1966)
//
// Decided 2026-11-22 (option 1): the app preview draws a file's
// `size 1200x675` at that canvas, scaled to fit its pane. The app calls the
// per-type renderers, not `render()`, so dgmo hands it two things first:
// `parseDgmo()` (public as `validate`) returns the file's canvas, and the
// public root exports the lift, so a host strips the line once the way it
// strips `palette`.
// ============================================================

import { describe, expect, it } from 'vitest';
import * as dgmo from '../src/index';
import { parseDgmo } from '../src/dgmo-router';

const PIE = 'pie Share\nApples 30\nPears 70';
const withLine = (line: string) => PIE.replace('\n', `\n${line}\n`);

describe('parseDgmo() returns the file canvas', () => {
  it('a "size WxH" line gives that canvas', () => {
    expect(parseDgmo(withLine('size 1200x675')).canvas).toEqual({
      width: 1200,
      height: 675,
    });
  });

  it('an "aspect W:H" line gives the 1200px export width and its height', () => {
    expect(parseDgmo(withLine('aspect 16:9')).canvas).toEqual({
      width: 1200,
      height: 675,
    });
  });

  it('a file with neither line gives null', () => {
    expect(parseDgmo(PIE).canvas).toBeNull();
  });

  it('a bad value gives null and its error', () => {
    const parsed = parseDgmo(withLine('size big'));
    expect(parsed.canvas).toBeNull();
    expect(
      parsed.diagnostics.filter((d) => d.code === 'E_CANVAS_SIZE_INVALID')
    ).toHaveLength(1);
  });

  it('wordcloud\'s own "size <min> <max>" is not a canvas', () => {
    const cloud = 'wordcloud Words\nsize 14, 80\nalpha 5\nbeta 3';
    expect(parseDgmo(cloud).canvas).toBeNull();
  });

  it('the public validate() carries it too', () => {
    expect(dgmo.validate(withLine('size 800x600')).canvas).toEqual({
      width: 800,
      height: 600,
    });
  });
});

describe('the public root exports the lift', () => {
  it('extractCanvasSizeDirective strips the line and keeps line numbers', () => {
    const lifted = dgmo.extractCanvasSizeDirective(
      withLine('size 1200x675'),
      'pie'
    );
    expect(lifted.content).toBe(withLine('//'));
    expect(lifted.size).toEqual({ width: 1200, height: 675 });
    expect(lifted.diagnostics).toEqual([]);
  });

  it('resolveCanvasSize lets the host width win and keeps the file height', () => {
    const lifted = dgmo.extractCanvasSizeDirective(
      withLine('size 1200x675'),
      'pie'
    );
    expect(dgmo.resolveCanvasSize(lifted, { width: 700 })).toEqual({
      width: 700,
      height: 675,
    });
  });
});
