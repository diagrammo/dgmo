import { describe, it, expect } from 'vitest';
import {
  mix,
  hexToHSL,
  hslToHex,
  tint,
  shade,
  relativeLuminance,
  contrastText,
  shapeFill,
} from '../src/palettes/color-utils';
import { resolveColor } from '../src/colors';
import { nordPalette } from '../src/palettes/nord';
import { boldPalette } from '../src/palettes/bold';
import { catppuccinPalette } from '../src/palettes/catppuccin';

describe('mix', () => {
  it('returns color b at pct=0', () => {
    expect(mix('#ff0000', '#0000ff', 0)).toBe('#0000ff');
  });

  it('returns color a at pct=100', () => {
    expect(mix('#ff0000', '#0000ff', 100)).toBe('#ff0000');
  });

  it('blends 50/50', () => {
    const result = mix('#ff0000', '#0000ff', 50);
    // midpoint of red and blue
    expect(result).toBe('#800080');
  });

  it('handles black and white', () => {
    expect(mix('#000000', '#ffffff', 50)).toBe('#808080');
  });

  it('handles 3-character hex', () => {
    expect(mix('#f00', '#00f', 100)).toBe('#ff0000');
  });

  it('handles same color', () => {
    expect(mix('#abcdef', '#abcdef', 50)).toBe('#abcdef');
  });
});

describe('hexToHSL', () => {
  it('converts pure red', () => {
    expect(hexToHSL('#ff0000')).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('converts white', () => {
    expect(hexToHSL('#ffffff')).toEqual({ h: 0, s: 0, l: 100 });
  });

  it('converts black', () => {
    expect(hexToHSL('#000000')).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('handles 3-char hex', () => {
    const result = hexToHSL('#f00');
    expect(result).toEqual({ h: 0, s: 100, l: 50 });
  });
});

describe('hslToHex', () => {
  it('converts pure red', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
  });

  it('converts achromatic gray', () => {
    expect(hslToHex(0, 0, 50)).toBe('#808080');
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 4);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 4);
  });
});

describe('contrastText', () => {
  it('returns dark text on white background', () => {
    expect(contrastText('#ffffff', '#eeeeee', '#333333')).toBe('#333333');
  });

  it('returns light text on black background', () => {
    expect(contrastText('#000000', '#eeeeee', '#333333')).toBe('#eeeeee');
  });
});

describe('tint', () => {
  it('returns original at amount=0', () => {
    expect(tint('#5e81ac', 0)).toBe('#5e81ac');
  });

  it('returns white at amount=1', () => {
    expect(tint('#5e81ac', 1)).toBe('#ffffff');
  });
});

describe('shade', () => {
  it('returns original at amount=0', () => {
    expect(shade('#5e81ac', '#2e3440', 0)).toBe('#5e81ac');
  });

  it('returns base at amount=1', () => {
    expect(shade('#5e81ac', '#2e3440', 1)).toBe('#2e3440');
  });
});

describe('shapeFill', () => {
  const palettes = [
    { name: 'nord', cfg: nordPalette },
    { name: 'bold', cfg: boldPalette },
    { name: 'catppuccin', cfg: catppuccinPalette },
  ];

  for (const { name, cfg } of palettes) {
    it(`${name} light: returns mix(intent, palette.bg, 25)`, () => {
      const intent = cfg.light.colors.blue;
      expect(shapeFill(cfg.light, intent, false)).toBe(
        mix(intent, cfg.light.bg, 25)
      );
    });

    it(`${name} dark: returns mix(intent, palette.surface, 25)`, () => {
      const intent = cfg.dark.colors.blue;
      expect(shapeFill(cfg.dark, intent, true)).toBe(
        mix(intent, cfg.dark.surface, 25)
      );
    });

    it(`${name} works with palette.primary as intent`, () => {
      expect(shapeFill(cfg.light, cfg.light.primary, false)).toBe(
        mix(cfg.light.primary, cfg.light.bg, 25)
      );
    });
  }

  it('opts.solid is currently ignored (reserved for follow-up spec)', () => {
    const intent = nordPalette.light.colors.red;
    const expected = mix(intent, nordPalette.light.bg, 25);
    expect(shapeFill(nordPalette.light, intent, false)).toBe(expected);
    expect(shapeFill(nordPalette.light, intent, false, {})).toBe(expected);
    expect(shapeFill(nordPalette.light, intent, false, { solid: true })).toBe(
      expected
    );
  });
});

describe('resolveColor', () => {
  it('rejects 6-digit hex codes', () => {
    expect(resolveColor('#ff0000')).toBeNull();
  });

  it('rejects 3-digit hex codes', () => {
    expect(resolveColor('#abc')).toBeNull();
  });

  it('resolves named colors to a string', () => {
    const result = resolveColor('red');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });
});
