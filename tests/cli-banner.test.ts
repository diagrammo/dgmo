import { describe, it, expect, afterEach } from 'vitest';
import { renderBanner } from '../src/cli-banner';

// The CLI banner had no test at all before #839, so the contract it has always
// claimed in its header — colour only on a TTY with NO_COLOR unset, plain
// otherwise — was unguarded, and so was the new one: that both forms draw the
// same mark from the same geometry.

/** The six colours of the D mark, from `logo-light.svg`. */
const LOGO_HEXES = {
  'stem red': '#c0504d',
  'stem green': '#5b9357',
  'stem blue': '#3b6ea5',
  'bowl teal': '#3a9188',
  'bowl purple': '#7d5ba6',
  'bowl orange': '#cc7a33',
};

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

function truecolorFg(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function strip(s: string): string {
  return s.replace(ANSI, '');
}

/**
 * The banner's art rows, escapes removed — the blank top and tail dropped, and
 * the copy beside the mark cut off. The mark is always exactly `ART_COLS`
 * cells wide, glyph or space, so the cut is a slice and not a search: the gap
 * between the stem and the bowl is itself three spaces, so anything hunting
 * for the gutter finds the counter instead.
 */
const ART_COLS = 18;

function artRows(banner: string): string[] {
  return strip(banner)
    .split('\n')
    .slice(1, -1)
    .map((line) => line.padEnd(ART_COLS).slice(0, ART_COLS));
}

/** Per column: does this row put ink on the canvas here? */
function ink(row: string): boolean[] {
  return [...row].map((ch) => ch !== ' ');
}

describe('cli banner — the D mark', () => {
  const originalTty = process.stdout.isTTY;
  const originalNoColor = process.env['NO_COLOR'];

  afterEach(() => {
    process.stdout.isTTY = originalTty;
    if (originalNoColor === undefined) delete process.env['NO_COLOR'];
    else process.env['NO_COLOR'] = originalNoColor;
  });

  it('draws the mark in its own six logo colours', () => {
    const banner = renderBanner({ color: true });
    for (const [name, hex] of Object.entries(LOGO_HEXES)) {
      expect(banner, `${name} (${hex}) is missing from the mark`).toContain(
        truecolorFg(hex)
      );
    }
  });

  it('draws the mark with half-block glyphs, not a letterform', () => {
    const banner = renderBanner({ color: true });
    expect(banner).toMatch(/[█▀▄]/);
    // The ANSI Shadow wordmark this replaced was box-drawing characters.
    expect(banner).not.toMatch(/[╔╗╚╝═║╠╣╦╩╬]/);
  });

  it('emits no escape sequence at all without colour', () => {
    const banner = renderBanner({ color: false });
    expect(banner).not.toContain('\x1b');
    // ...and the plain form is ASCII throughout, so any terminal, pipe or CI
    // log can show it. The mark's half-block glyphs are not, which is exactly
    // why the plain form is rasterised separately rather than un-coloured.
    // eslint-disable-next-line no-control-regex
    expect(banner).toMatch(/^[\x00-\x7f\n]*$/);
  });

  it('carries the copy in both forms, pointing at diagrammo.app', () => {
    for (const color of [true, false]) {
      const plain = strip(renderBanner({ color }));
      expect(plain).toContain('https://diagrammo.app');
      expect(plain).toContain('45+ chart types');
      expect(plain).toContain('PNG or SVG');
      expect(plain).toContain('MCP server');
      expect(plain).not.toContain('diagrammo.com');
    }
  });

  it('fits an 80-column terminal in both forms', () => {
    for (const color of [true, false]) {
      for (const line of strip(renderBanner({ color })).split('\n')) {
        expect(
          [...line].length,
          `too wide: ${JSON.stringify(line)}`
        ).toBeLessThanOrEqual(80);
      }
    }
  });

  it('draws the same mark coloured and plain — one geometry, two forms', () => {
    const colorArt = artRows(renderBanner({ color: true })).map(ink);
    const monoArt = artRows(renderBanner({ color: false })).map(ink);
    expect(monoArt).toEqual(colorArt);
  });

  it('reads as a D: a full-height stem, then a counter, then the bowl', () => {
    const rows = artRows(renderBanner({ color: false })).map(ink);
    expect(rows.length).toBeGreaterThanOrEqual(8);

    // The stem is the left edge and it runs the whole height of the mark.
    for (const [i, row] of rows.entries()) {
      expect(row[0], `row ${i} has no stem`).toBe(true);
    }

    // Every row has a counter — blank canvas between the stem and the bowl —
    // which is what makes the shape a D rather than a filled block.
    for (const [i, row] of rows.entries()) {
      const stemEnd = row.indexOf(false);
      expect(stemEnd, `row ${i} is solid to the right edge`).toBeGreaterThan(0);
      const bowl = row.indexOf(true, stemEnd);
      expect(bowl, `row ${i} has no bowl right of the counter`).toBeGreaterThan(
        stemEnd
      );
    }
  });

  it('honours NO_COLOR and the TTY when no option is passed', () => {
    process.stdout.isTTY = true;

    delete process.env['NO_COLOR'];
    expect(renderBanner()).toContain('\x1b');

    process.env['NO_COLOR'] = '1';
    expect(renderBanner()).not.toContain('\x1b');

    delete process.env['NO_COLOR'];
    process.stdout.isTTY = false;
    expect(renderBanner()).not.toContain('\x1b');
  });
});
