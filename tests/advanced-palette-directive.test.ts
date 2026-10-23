// `/advanced` exports the palette-line reader `render()` uses (#1366), so a
// host drawing with the per-type renderers — the app preview — reads a file's
// own palette line or block the same way, with no parser of its own.

import { describe, it, expect } from 'vitest';
import {
  choosePalette,
  extractPaletteDirective,
  getPalette,
  type PaletteDirective,
} from '../src/advanced';

const plain = 'pie Share\nApples 30\nPears 70\n\n';

// A dark-only embedded block, in the diagram's own syntax.
const darkBlock = (name: string): string => {
  const out = [`palette ${name}`, '  dark'];
  for (const [key, value] of Object.entries(getPalette('nord').dark)) {
    if (key === 'colors') continue;
    out.push(
      `    ${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${String(value)}`
    );
  }
  out.push('    colors');
  for (const [key, value] of Object.entries(getPalette('nord').dark.colors)) {
    out.push(`      ${key} ${String(value)}`);
  }
  return out.join('\n');
};

describe('/advanced — the palette directive reader', () => {
  it('reads a named palette line and lets it beat the caller default', () => {
    const directive: PaletteDirective = extractPaletteDirective(
      `${plain}palette nord dark`
    );
    expect(directive.paletteId).toBe('nord');
    expect(directive.mode).toBe('dark');
    expect(directive.content).not.toMatch(/^palette/m);
    expect(choosePalette(directive, { palette: 'tidewater' })).toEqual({
      paletteId: 'nord',
      theme: 'dark',
    });
  });

  it('reads an embedded block and hands back its palette to draw from', () => {
    const directive = extractPaletteDirective(`${plain}${darkBlock('Frost')}`);
    expect(directive.diagnostics).toEqual([]);
    expect(directive.palette?.dark.bg).toBe(getPalette('nord').dark.bg);
    const chosen = choosePalette(directive, { palette: 'tidewater' });
    expect(chosen.palette).toBe(directive.palette);
    expect(chosen.theme).toBe('dark');
  });

  it('a file with no palette line leaves the caller palette in charge', () => {
    const directive = extractPaletteDirective(plain);
    expect(directive.content).toBe(plain);
    expect(choosePalette(directive, { palette: 'tidewater' }).paletteId).toBe(
      'tidewater'
    );
  });
});
