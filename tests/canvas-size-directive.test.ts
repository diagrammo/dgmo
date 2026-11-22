// canvas-size-directive.test.ts — `size WxH` and `aspect W:H` in the file
// (#1966, slice (d) of #1833).
//
// Decided 2026-11-13: ship `size WxH` and `aspect` and no named presets. A
// file's `size 1200x675` is the same as `--width 1200 --height 675`; a
// caller's width or height beats the file's; a bad value is an error naming
// its line. Wordcloud keeps its own `size <min> <max>` word-size range.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '../src/render';
import { parseDgmo } from '../src/dgmo-router';
import {
  extractCanvasSizeDirective,
  resolveCanvasSize,
} from '../src/canvas-size-directive';
import { parseVisualization } from '../src/visualizations/parse';

const FIXTURES = join(__dirname, '../gallery/fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

/**
 * The fixture with `line` added at its end. The lifted line becomes `//`, so
 * the source it is compared against ends in `//` and keeps the same lines.
 */
const withLine = (source: string, line: string) => `${source}\n${line}`;
const withComment = (source: string) => withLine(source, '//');

function rootAttr(svg: string, name: string): string | undefined {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  return new RegExp(`\\s${name}="([^"]*)"`).exec(root)?.[1];
}

const sizeErrors = (ds: readonly { code?: string; line: number }[]) =>
  ds.filter((d) => d.code === 'E_CANVAS_SIZE_INVALID');

/** Chart types §1.15 lists as exact at a width with a height. */
const EXACT = ['pie.dgmo', 'bar.dgmo', 'line.dgmo', 'venn.dgmo', 'radar.dgmo'];

describe('size WxH in the file', () => {
  it.each(EXACT)(
    '%s: "size 1200x675" draws what --width 1200 --height 675 draws',
    async (name) => {
      const source = fixture(name);
      const fromFile = await render(withLine(source, 'size 1200x675'));
      const fromCaller = await render(withComment(source), {
        width: 1200,
        height: 675,
      });
      expect(rootAttr(fromFile.svg, 'viewBox')).toBe('0 0 1200 675');
      expect(fromFile.svg).toBe(fromCaller.svg);
      expect(sizeErrors(fromFile.diagnostics)).toEqual([]);
    }
  );

  it('a content-sized chart takes the width as a cap and warns about the height, as the caller flags do', async () => {
    const source = fixture('flowchart-basic.dgmo');
    const fromFile = await render(withLine(source, 'size 1200x675'));
    const fromCaller = await render(withComment(source), {
      width: 1200,
      height: 675,
    });
    expect(fromFile.svg).toBe(fromCaller.svg);
    const codes = (ds: readonly { code?: string }[]) =>
      ds.map((d) => d.code).filter((c) => c?.startsWith('W_CANVAS'));
    expect(codes(fromFile.diagnostics)).toEqual(codes(fromCaller.diagnostics));
  });

  it('the line is lifted, never read as content', async () => {
    const source =
      'flowchart Deploy\nsize 1200x675\n(Start) -> [Build] -> (Done)';
    const { svg } = await render(source);
    expect(svg).not.toContain('1200x675');
    expect(parseDgmo(source).diagnostics).toEqual(
      parseDgmo('flowchart Deploy\n//\n(Start) -> [Build] -> (Done)')
        .diagnostics
    );
  });
});

describe('aspect W:H in the file', () => {
  it('"aspect 16:9" gives a 1200x675 canvas at the default width', async () => {
    const { svg } = await render(withLine(fixture('pie.dgmo'), 'aspect 16:9'));
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 1200 675');
  });

  it("sets the height from the caller's width", async () => {
    const { svg } = await render(withLine(fixture('pie.dgmo'), 'aspect 16:9'), {
      width: 800,
    });
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 800 450');
  });
});

describe("the caller's width and height beat the file", () => {
  it('a caller width and height override "size"', async () => {
    const source = fixture('pie.dgmo');
    const { svg } = await render(withLine(source, 'size 1200x675'), {
      width: 1000,
      height: 600,
    });
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 1000 600');
  });

  it('one dimension at a time', () => {
    const size = { size: { width: 1200, height: 675 } };
    expect(resolveCanvasSize(size, { width: 800 })).toEqual({
      width: 800,
      height: 675,
    });
    expect(resolveCanvasSize(size, { height: 500 })).toEqual({
      width: 1200,
      height: 500,
    });
    const aspect = { aspect: { width: 16, height: 9 } };
    expect(resolveCanvasSize(aspect, {})).toEqual({ width: 1200, height: 675 });
    expect(resolveCanvasSize(aspect, { height: 500 })).toEqual({ height: 500 });
    expect(resolveCanvasSize({}, {})).toEqual({});
  });
});

describe('a bad value is an error naming its line', () => {
  it.each([
    ['size big'],
    ['size 1200 x 675'],
    ['size 1200x'],
    ['size 0x675'],
    ['size'],
    ['aspect 16-9'],
    ['aspect wide'],
    ['aspect 0:9'],
    ['aspect'],
  ])('"%s"', (line) => {
    const source = `pie Share\n${line}\nApples 30\nPears 70`;
    const errors = sizeErrors(parseDgmo(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(2);
  });

  it('a second size or aspect line is an error on that line; the first stands', async () => {
    const source = 'pie Share\nsize 1000x600\naspect 16:9\nApples 30\nPears 70';
    const errors = sizeErrors(parseDgmo(source).diagnostics);
    expect(errors.map((e) => e.line)).toEqual([3]);
    const { svg } = await render(source);
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 1000 600');
  });

  it('render() reports the error once', async () => {
    const { diagnostics } = await render('pie Share\nsize big\nApples 30');
    expect(sizeErrors(diagnostics)).toHaveLength(1);
  });
});

describe('wordcloud keeps "size <min> <max>"', () => {
  const cloud = 'wordcloud Words\nsize 14, 80\nalpha 5\nbeta 3\ngamma 1';

  it('its word-size range is left for the wordcloud parser', () => {
    const lifted = extractCanvasSizeDirective(cloud, 'wordcloud');
    expect(lifted.content).toBe(cloud);
    expect(lifted.diagnostics).toEqual([]);
    const parsed = parseVisualization(lifted.content);
    expect(parsed.cloudOptions).toMatchObject({ minSize: 14, maxSize: 80 });
    expect(sizeErrors(parseDgmo(cloud).diagnostics)).toEqual([]);
  });

  it('"size WxH" is still the canvas there', async () => {
    const { svg } = await render(
      'wordcloud Words\nsize 1000x600\nalpha 5\nbeta 3\ngamma 1'
    );
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 1000 600');
  });

  it('on any other chart type the same line is an error', () => {
    const errors = sizeErrors(
      parseDgmo('pie Share\nsize 14, 80\nApples 30').diagnostics
    );
    expect(errors).toHaveLength(1);
  });
});
