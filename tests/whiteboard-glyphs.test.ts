// Whiteboard glyph sets (#1845): a `shapes network` line turns the bundled
// Network glyphs on for one file; each glyph is a line icon in its box with
// its label beneath.
import { describe, expect, it } from 'vitest';

import { render } from '../src/index';
import { getPalette } from '../src/palettes';
import {
  GLYPH_NAMES,
  GLYPH_SETS,
  GLYPH_VIEWBOX,
  glyphPaths,
  glyphSetOf,
} from '../src/glyphs/registry';
import { emitWhiteboard, sameWhiteboard } from '../src/whiteboard/emit';
import { parseWhiteboard } from '../src/whiteboard/parser';
import { renderWhiteboard, whiteboardBounds } from '../src/whiteboard/renderer';
import type { WhiteboardShape } from '../src/whiteboard/types';

function draw(src: string, isDark = false): SVGSVGElement {
  const pal = getPalette('nord')[isDark ? 'dark' : 'light'];
  const el = document.createElement('div');
  renderWhiteboard(el, parseWhiteboard(src, pal), pal, isDark);
  return el.querySelector('svg')!;
}

const codes = (src: string): string[] =>
  parseWhiteboard(src).diagnostics.map((d) => d.code ?? '');

const BOARD = `whiteboard Office network
shapes network
router Edge at: 120 40, size: 48 48
server App at: 300 40, size: 48 48, color: blue
arrow from: 144 64, to: 324 64
`;

describe('glyph registry', () => {
  it('ships the Network set: the 16 generic glyphs minus the three default whiteboard shapes', () => {
    expect(GLYPH_SETS.map((s) => s.id)).toEqual(['network']);
    expect(GLYPH_NAMES).toHaveLength(13);
    for (const kept of ['database', 'queue', 'file', 'document']) {
      expect(GLYPH_NAMES).not.toContain(kept);
    }
    for (const name of GLYPH_NAMES) {
      expect(glyphSetOf(name).id).toBe('network');
    }
  });

  it('draws every glyph inside its viewbox', () => {
    for (const name of GLYPH_NAMES) {
      const paths = glyphPaths(name);
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d).toMatch(/^M/);
        // Absolute coordinates only appear after M and L/C/A commands; every
        // number in a path stays inside the square (relative steps are smaller).
        for (const n of d.match(/-?\d*\.?\d+/g)!) {
          expect(Math.abs(Number(n))).toBeLessThanOrEqual(GLYPH_VIEWBOX);
        }
      }
    }
  });
});

describe('whiteboard shapes line and glyphs', () => {
  it('parses a glyph as a labelled box carrying its glyph, with no warnings', () => {
    const parsed = parseWhiteboard(BOARD);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.shapeSets).toEqual(['network']);
    const [router, server] = parsed.elements as WhiteboardShape[];
    expect(router).toMatchObject({
      kind: 'shape',
      shape: 'rectangle',
      glyph: 'router',
      label: 'Edge',
      x: 120,
      y: 40,
      width: 48,
      height: 48,
      color: 'ink',
    });
    expect(server).toMatchObject({ glyph: 'server', color: 'blue' });
  });

  it('draws a glyph without its shapes line, and warns with the line to add', () => {
    const src = 'whiteboard\nrouter Edge at: 0 0, size: 48 48\n';
    const parsed = parseWhiteboard(src);
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]).toMatchObject({
      code: 'W_WHITEBOARD_SHAPE_SET_OFF',
      severity: 'warning',
      line: 2,
    });
    expect(parsed.diagnostics[0]!.message).toContain('shapes network');
    expect(
      draw(src).querySelector('.whiteboard-router .whiteboard-glyph')
    ).not.toBeNull();
  });

  it('warns once per set that is off, at its first glyph', () => {
    const parsed = parseWhiteboard(
      'whiteboard\nrouter A at: 0 0, size: 48 48\nserver B at: 80 0, size: 48 48\nrouter C at: 160 0, size: 48 48\n'
    );
    expect(parsed.elements).toHaveLength(3);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]).toMatchObject({
      code: 'W_WHITEBOARD_SHAPE_SET_OFF',
      line: 2,
    });
  });

  it('accepts the shapes line after the glyphs it turns on', () => {
    expect(
      codes('whiteboard\nrouter at: 0 0, size: 48 48\nshapes network\n')
    ).toEqual([]);
  });

  it('warns on an unknown set and suggests the nearest', () => {
    const parsed = parseWhiteboard('whiteboard\nshapes netwrk\n');
    expect(parsed.shapeSets).toEqual([]);
    expect(parsed.diagnostics[0]).toMatchObject({
      code: 'W_WHITEBOARD_UNKNOWN_SHAPE_SET',
      line: 2,
    });
    expect(parsed.diagnostics[0]!.message).toContain('network');
  });

  it('refuses fill: and label: on a glyph', () => {
    expect(
      codes(
        'whiteboard\nshapes network\nrouter at: 0 0, size: 48 48, fill: solid, label: top\n'
      )
    ).toEqual(['W_WHITEBOARD_UNKNOWN_KEY', 'W_WHITEBOARD_UNKNOWN_KEY']);
  });

  it('suggests a glyph for a misspelt element word', () => {
    const parsed = parseWhiteboard(
      'whiteboard\nshapes network\nrooter at: 0 0, size: 48 48\n'
    );
    expect(parsed.diagnostics[0]!.code).toBe('W_WHITEBOARD_UNKNOWN_ELEMENT');
    expect(parsed.diagnostics[0]!.message).toContain('router');
  });

  it('emits the shapes line and the glyph keyword, byte for byte', () => {
    const src = `whiteboard Office network
shapes network
router Edge at: 120 40, size: 48 48
users at: 0 0, size: 40 40, color: teal
access-point at: 0 100, size: 40 40
  Floor 2
  Wi-Fi
`;
    const parsed = parseWhiteboard(src);
    expect(parsed.diagnostics).toEqual([]);
    expect(emitWhiteboard(parsed)).toBe(src);
    expect(
      sameWhiteboard(parsed, parseWhiteboard(emitWhiteboard(parsed)))
    ).toBe(true);
  });

  it('keeps a file with no shapes line as it was', () => {
    const src = 'whiteboard\nrectangle A at: 0 0, size: 100 50\n';
    const parsed = parseWhiteboard(src);
    expect(parsed.shapeSets).toEqual([]);
    expect(emitWhiteboard(parsed)).toBe(src);
  });
});

describe('whiteboard glyph rendering', () => {
  it('draws all 13 Network glyphs in both themes, stroked in the theme ink', async () => {
    const lines = GLYPH_NAMES.map(
      (name, i) => `${name} ${name} at: ${i * 80} 0, size: 48 48`
    );
    const src = `whiteboard\nshapes network\n${lines.join('\n')}\n`;
    const inks: string[] = [];
    for (const isDark of [false, true]) {
      const svg = draw(src, isDark);
      for (const name of GLYPH_NAMES) {
        const icon = svg.querySelector(
          `.whiteboard-${name} .whiteboard-glyph`
        )!;
        expect(icon, name).not.toBeNull();
        expect(icon.getAttribute('fill')).toBe('none');
        expect(icon.querySelectorAll('path')).toHaveLength(
          glyphPaths(name).length
        );
        expect(svg.querySelector(`.whiteboard-${name} text`)?.textContent).toBe(
          name
        );
      }
      inks.push(
        svg
          .querySelector('.whiteboard-router .whiteboard-glyph')!
          .getAttribute('stroke')!
      );
    }
    const pal = getPalette('nord');
    expect(inks).toEqual([pal.light.text, pal.dark.text]);
    for (const theme of ['light', 'dark'] as const) {
      const { svg, diagnostics } = await render(src, { theme });
      expect(diagnostics).toEqual([]);
      expect(svg).not.toMatch(/NaN|undefined/);
    }
  });

  it('scales the icon to the shorter side and centres it in the box', () => {
    const svg = draw(
      'whiteboard\nshapes network\nlock at: 0 0, size: 100 40\n'
    );
    const t = svg
      .querySelector('.whiteboard-lock .whiteboard-glyph')!
      .getAttribute('transform')!;
    // 40 / 20 = scale 2; the 40 px square sits 30 px in from the left.
    expect(t).toBe('translate(30,0) scale(2)');
  });

  it('hangs the label below the box and keeps it in the crop', () => {
    const parsed = parseWhiteboard(
      'whiteboard\nshapes network\ncloud Internet at: 0 0, size: 48 48\n'
    );
    const b = whiteboardBounds(parsed);
    expect(b.maxY).toBeGreaterThan(48 + 4);
    const svg = draw(
      'whiteboard\nshapes network\ncloud Internet at: 0 0, size: 48 48\n'
    );
    const y = Number(
      svg.querySelector('.whiteboard-cloud text tspan')!.getAttribute('y')
    );
    // The first line's baseline sits below the box's bottom edge.
    expect(y).toBeGreaterThan(48 + 4);
  });

  it('attaches an arrow end to the glyph box', () => {
    const svg = draw(BOARD);
    const line = svg.querySelector('.whiteboard-arrow line')!;
    // The arrow runs from inside the router to inside the server; both ends
    // stop at the boxes' borders (x 168 and 300).
    expect(Number(line.getAttribute('x1'))).toBeCloseTo(168, 0);
    expect(Number(line.getAttribute('x2'))).toBeLessThanOrEqual(300);
  });
});
