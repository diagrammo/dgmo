// Theme style (diagrammo/diagrammo#1836): `radius`, `strokeWeight` and
// `background` on a theme file or an embedded palette block. Each must change
// the SVG, and a theme without them must draw byte for byte what it drew before.

import { describe, expect, it } from 'vitest';
import { render } from '../src/render';
import { extractPaletteDirective } from '../src/palettes/directive';
import { validateThemeFile } from '../src/palettes/theme-file';
import { applyThemeStyle, stripCanvas } from '../src/palettes/theme-style';
import { getPalette, type PaletteColors } from '../src/palettes';
import {
  CARD_RADIUS,
  NODE_STROKE_WIDTH,
} from '../src/utils/visual-conventions';

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** An embedded block carrying nord's colours plus the given style lines. */
function block(style: string[], modes: ('light' | 'dark')[] = ['light']) {
  const nord = getPalette('nord');
  const out = ['palette Brand', ...style.map((l) => `  ${l}`)];
  for (const mode of modes) {
    const colors: PaletteColors = nord[mode];
    out.push(`  ${mode}`);
    for (const [key, value] of Object.entries(colors)) {
      if (key !== 'colors') out.push(`    ${kebab(key)} ${String(value)}`);
    }
    out.push('    colors');
    for (const [key, value] of Object.entries(colors.colors)) {
      out.push(`      ${key} ${value}`);
    }
  }
  return out.join('\n');
}

const FLOW = `flowchart\n\n(Start) -> [Check] -> (Done)\n`;
const BAR = `bar Sales\n\nNorth 10\nSouth 20\n`;

const draw = async (src: string, theme?: 'light' | 'dark' | 'transparent') =>
  (await render(src, theme ? { theme } : {})).svg;

const rx = (svg: string) =>
  [...svg.matchAll(/<rect\b[^>]*\srx="([\d.]+)"/g)].map((m) => Number(m[1]));
const strokes = (svg: string) =>
  [...svg.matchAll(/<(?!text|tspan)\w+\b[^>]*\sstroke-width="([\d.]+)"/g)].map(
    (m) => Number(m[1])
  );

describe('theme file fields', () => {
  const nord = getPalette('nord');
  const base = {
    id: 'brand',
    name: 'Brand',
    light: nord.light,
    dark: nord.dark,
  };

  it('carries radius, strokeWeight and background onto the palette', () => {
    const r = validateThemeFile({
      ...base,
      radius: 0,
      strokeWeight: 2,
      background: 'transparent',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.palette.radius).toBe(0);
    expect(r.palette.strokeWeight).toBe(2);
    expect(r.palette.background).toBe('transparent');
  });

  it('leaves the fields off the palette when the file has none', () => {
    const r = validateThemeFile(base);
    expect(r.ok && Object.keys(r.palette).sort()).toEqual([
      'dark',
      'id',
      'light',
      'name',
    ]);
  });

  it('refuses a value out of range or of the wrong kind', () => {
    const r = validateThemeFile({
      ...base,
      radius: 99,
      strokeWeight: '2',
      background: 'blue',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/radius: 99 is outside/);
    expect(r.errors.join('\n')).toMatch(/strokeWeight: expected a number/);
    expect(r.errors.join('\n')).toMatch(/background: expected "solid"/);
  });
});

describe('embedded block', () => {
  it('reads style lines above the sections', () => {
    const d = extractPaletteDirective(
      `${FLOW}\n${block(['radius 0', 'stroke-weight 3', 'background transparent'])}`
    );
    expect(d.diagnostics).toEqual([]);
    expect(d.palette?.radius).toBe(0);
    expect(d.palette?.strokeWeight).toBe(3);
    expect(d.palette?.background).toBe('transparent');
  });

  it('warns on the line of a bad value, and draws no theme', () => {
    const src = `${FLOW}\n${block(['radius huge'])}`;
    const d = extractPaletteDirective(src);
    expect(d.palette).toBeUndefined();
    const line =
      src.split('\n').findIndex((l) => l.includes('radius huge')) + 1;
    expect(d.diagnostics[0]?.line).toBe(line);
    expect(d.diagnostics[0]?.message).toMatch(/radius/);
  });
});

describe('rendering', () => {
  it('is byte-identical when the theme sets no style', async () => {
    const plain = await draw(`${FLOW}\n${block([])}`);
    const defaults = await draw(
      `${FLOW}\n${block([
        `radius ${CARD_RADIUS}`,
        `stroke-weight ${NODE_STROKE_WIDTH}`,
        'background solid',
      ])}`
    );
    expect(defaults).toBe(plain);
    expect(applyThemeStyle(plain, {})).toBe(plain);
    expect(applyThemeStyle(plain, undefined)).toBe(plain);
  });

  it('radius scales every rect corner', async () => {
    const plain = await draw(`${FLOW}\n${block([])}`);
    const square = await draw(`${FLOW}\n${block(['radius 0'])}`);
    const round = await draw(
      `${FLOW}\n${block([`radius ${CARD_RADIUS * 2}`])}`
    );
    expect(rx(plain).some((v) => v > 0)).toBe(true);
    expect(rx(square).every((v) => v === 0)).toBe(true);
    expect(rx(round)).toEqual(rx(plain).map((v) => v * 2));
  });

  it('stroke weight scales every written stroke, and no text halo', async () => {
    const plain = await draw(`${FLOW}\n${block([])}`);
    const heavy = await draw(
      `${FLOW}\n${block([`stroke-weight ${NODE_STROKE_WIDTH * 2}`])}`
    );
    expect(strokes(plain).length).toBeGreaterThan(0);
    expect(strokes(heavy)).toEqual(
      strokes(plain).map((v) => Number((v * 2).toFixed(3)))
    );
    const halos = (svg: string) =>
      [...svg.matchAll(/<text\b[^>]*>/g)].map((m) => m[0]).join('\n');
    expect(halos(heavy)).toBe(halos(plain));
  });

  it('background transparent drops the canvas and keeps the ink', async () => {
    const solid = await draw(`${BAR}\n${block([], ['dark'])}`);
    const clear = await draw(
      `${BAR}\n${block(['background transparent'], ['dark'])}`
    );
    const dark = getPalette('nord').dark;
    expect(solid).toContain('dgmo-canvas-bg');
    expect(clear).not.toContain('dgmo-canvas-bg');
    expect(clear).toContain(dark.text);
    expect(clear).not.toMatch(/<svg\b[^>]*background: (?!none)/);
  });
});

describe('dark ink on transparent', () => {
  it('a file pinned dark keeps dark colours under a transparent render', async () => {
    const dark = getPalette('nord').dark;
    const light = getPalette('nord').light;
    const svg = await draw(`${BAR}\npalette nord dark\n`, 'transparent');
    expect(svg).not.toContain('dgmo-canvas-bg');
    expect(svg).toContain(dark.text);
    expect(svg).not.toContain(light.text);
  });

  it('a transparent render with no pin is unchanged: the light colours', async () => {
    const light = getPalette('nord').light;
    const svg = await draw(`${BAR}\npalette nord\n`, 'transparent');
    expect(svg).not.toContain('dgmo-canvas-bg');
    expect(svg).toContain(light.text);
  });

  it('stripCanvas removes only the canvas', () => {
    const svg =
      '<svg style="background: rgb(1, 2, 3); font-family: Inter"><rect class="dgmo-canvas-bg" x="0"></rect><rect rx="4"></rect></svg>';
    expect(stripCanvas(svg)).toBe(
      '<svg style="background: none; font-family: Inter"><rect rx="4"></rect></svg>'
    );
  });
});
