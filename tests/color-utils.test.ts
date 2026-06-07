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
  valueRampColor,
  valueRampStops,
} from '../src/palettes/color-utils';
import { resolveColor } from '../src/colors';
import { nordPalette } from '../src/palettes/nord';
import { atlasPalette } from '../src/palettes/atlas';
import { slatePalette } from '../src/palettes/slate';
import { catppuccinPalette } from '../src/palettes/catppuccin';

describe('valueRampColor', () => {
  const opts = { isDark: false };
  // Saturated, wide-gap diverging pair (green→red ≈ 120°).
  const GREEN = '#2e8b57';
  const RED = '#c0392b';
  // Analogous pair (yellow→red, gap ≤ 90°).
  const YELLOW = '#e0b000';

  it('returns the exact endpoints at t=0 and t=1 (purity/order — AC11)', () => {
    expect(valueRampColor(GREEN, RED, 0, opts)).toBe(GREEN);
    expect(valueRampColor(GREEN, RED, 1, opts)).toBe(RED);
    // Order respected — swapping endpoints swaps the ends.
    expect(valueRampColor(RED, GREEN, 0, opts)).toBe(RED);
    expect(valueRampColor(RED, GREEN, 1, opts)).toBe(GREEN);
  });

  it('is pure (same args → same result)', () => {
    const a = valueRampColor(GREEN, RED, 0.42, opts);
    const b = valueRampColor(GREEN, RED, 0.42, opts);
    expect(a).toBe(b);
  });

  it('analogous endpoints take a direct blend — no neutral injected (AC7)', () => {
    // Direct branch ⇒ mid == straight mix of the two endpoints.
    expect(valueRampColor(YELLOW, RED, 0.5, opts)).toBe(mix(RED, YELLOW, 50));
  });

  it('diverging endpoints route through a midpoint, not a muddy direct blend (AC6)', () => {
    const mid = valueRampColor(GREEN, RED, 0.5, opts);
    const directMid = mix(RED, GREEN, 50);
    expect(mid).not.toBe(directMid);
    // Midpoint keeps a hint of colour (above the internal saturation floor) —
    // it is not a dead gray.
    expect(hexToHSL(mid).s).toBeGreaterThan(10);
  });

  it('dark-theme midpoint never exceeds both endpoints in luminance (AC8)', () => {
    const dGreen = '#3aa15f';
    const dRed = '#e06c75';
    const mid = valueRampColor(dGreen, dRed, 0.5, { isDark: true });
    const lMid = relativeLuminance(mid);
    const lHi = Math.max(relativeLuminance(dGreen), relativeLuminance(dRed));
    expect(lMid).toBeLessThanOrEqual(lHi + 1e-9);
  });

  it('achromatic endpoint takes the direct branch (saturation gate first — AC15)', () => {
    // gray→red: gray has s≈0 so the hue-gap test is skipped → direct blend.
    const mid = valueRampColor('#808080', RED, 0.5, opts);
    expect(mid).toBe(mix(RED, '#808080', 50));
    // black/white never produce NaN/undefined-hue artifacts.
    expect(valueRampColor('#000000', '#ffffff', 0.5, opts)).toMatch(
      /^#[0-9a-f]{6}$/
    );
  });

  it('single-colour ramp reproduces mix(hue,base,pct) byte-for-byte (AC2 math, F6)', () => {
    // The single-colour fill path bypasses the util, but the legend models a
    // single-colour ramp as low=mix(hue,base,FLOOR), high=hue → same-ish hue →
    // direct branch → endpoints exactly reproduced.
    const hue = RED;
    const base = '#ffffff';
    const FLOOR = 15;
    const low = mix(hue, base, FLOOR);
    expect(valueRampColor(low, hue, 0, opts)).toBe(low);
    expect(valueRampColor(low, hue, 1, opts)).toBe(hue);
  });
});

describe('valueRampStops', () => {
  it('returns just the two endpoints for a direct (single/analogous) ramp (AC13)', () => {
    const low = mix('#c0392b', '#ffffff', 15);
    const stops = valueRampStops(low, '#c0392b', { isDark: false });
    expect(stops).toEqual([
      { offset: 0, color: low },
      { offset: 1, color: '#c0392b' },
    ]);
  });

  it('samples through the midpoint for a diverging ramp (AC9)', () => {
    const stops = valueRampStops('#2e8b57', '#c0392b', { isDark: false });
    expect(stops.length).toBeGreaterThan(2);
    // Every stop reproduces valueRampColor at its offset.
    for (const s of stops) {
      expect(s.color).toBe(
        valueRampColor('#2e8b57', '#c0392b', s.offset, { isDark: false })
      );
    }
  });
});

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
    { name: 'atlas', cfg: atlasPalette },
    { name: 'slate', cfg: slatePalette },
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

  it('opts.solid returns the raw intent (bypasses 25% tint)', () => {
    const intent = nordPalette.light.colors.red;
    expect(shapeFill(nordPalette.light, intent, false, { solid: true })).toBe(
      intent
    );
    expect(shapeFill(nordPalette.dark, intent, true, { solid: true })).toBe(
      intent
    );
  });

  it('opts.solid: false and omitted opts both return the 25% tint', () => {
    const intent = nordPalette.light.colors.red;
    const expectedLight = mix(intent, nordPalette.light.bg, 25);
    expect(shapeFill(nordPalette.light, intent, false)).toBe(expectedLight);
    expect(shapeFill(nordPalette.light, intent, false, {})).toBe(expectedLight);
    expect(shapeFill(nordPalette.light, intent, false, { solid: false })).toBe(
      expectedLight
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
