import { describe, expect, it } from 'vitest';
import '../src/palettes';
import { getAvailablePalettes } from '../src/palettes/registry';
import { getSeriesColors } from '../src/palettes/color-utils';
import { CATEGORICAL_COLOR_ORDER } from '../src/colors';
import type { PaletteColors } from '../src/palettes/types';

// Colour-blind separation guard (#1835, 2026-11-13).
//
// palette-contrast.test.ts proves a label is readable on a fill. Nothing
// proved two neighbouring SERIES can be told apart by a reader with
// red-blind (protan) or green-blind (deutan) vision. Under the old order
// (red, green, blue, …) slate's first two series simulated to CIEDE2000 1.3,
// one colour to a green-blind reader.
//
// Series colours come from CATEGORICAL_COLOR_ORDER, shared by every palette,
// so the order is what this guards; the palette hexes are untouched.
//
// Simulation: Machado, Oliveira & Fernandes (2009), severity 1.0 matrices,
// applied in linear sRGB — the values colorspacious ships
// (github.com/njsmith/colorspacious, colorspacious/cvd.py).

/** Every adjacent pair of series must clear this, in every vision. */
const CVD_ADJACENT_FLOOR = 12;
/** Every pair among the first three series (the common case) must clear this. */
const CVD_FIRST_THREE_FLOOR = 10;

type Mat = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const VISIONS: Record<string, Mat> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

function toLinear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

function simulate(
  lin: [number, number, number],
  m: Mat
): [number, number, number] {
  return m.map((row) =>
    Math.min(
      1,
      Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])
    )
  ) as [number, number, number];
}

function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047);
  const fy = f(Y);
  const fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005). */
function deltaE2000(
  [L1, a1, b1]: [number, number, number],
  [L2, a2, b2]: [number, number, number]
): number {
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1 = ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360;
  const h2 = ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360;
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = h2 - h1;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hb: number;
  if (C1p * C2p === 0) hb = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hb = (h1 + h2) / 2;
  else hb = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(rad(hb - 30)) +
    0.24 * Math.cos(rad(2 * hb)) +
    0.32 * Math.cos(rad(3 * hb + 6)) -
    0.2 * Math.cos(rad(4 * hb - 63));
  const dth = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(rad(2 * dth)) * RC;
  return Math.sqrt(
    (dL / SL) ** 2 +
      (dC / SC) ** 2 +
      (dH / SH) ** 2 +
      RT * (dC / SC) * (dH / SH)
  );
}

/** The smallest difference between two colours across all simulated visions. */
function worstDelta(a: string, b: string): { de: number; vision: string } {
  let worst = { de: Infinity, vision: '' };
  for (const [vision, m] of Object.entries(VISIONS)) {
    const de = deltaE2000(
      toLab(simulate(toLinear(a), m)),
      toLab(simulate(toLinear(b), m))
    );
    if (de < worst.de) worst = { de, vision };
  }
  return worst;
}

function modes(palette: {
  light: PaletteColors;
  dark: PaletteColors;
}): Array<[string, PaletteColors]> {
  return [
    ['light', palette.light],
    ['dark', palette.dark],
  ];
}

describe('palette colour-blind separation', () => {
  it('measures a known-bad pair as bad (the simulation is live)', () => {
    // Slate's red and green: distinct to normal vision, one colour to a
    // green-blind reader. If this stops failing the floor, the matrices or
    // the ΔE code broke and every assertion below is vacuous.
    const slate = getAvailablePalettes().find((p) => p.id === 'slate')!;
    const { de, vision } = worstDelta(
      slate.dark.colors.red,
      slate.dark.colors.green
    );
    expect(de).toBeLessThan(CVD_ADJACENT_FLOOR);
    expect(vision).toBe('deutan');
  });

  for (const palette of getAvailablePalettes()) {
    for (const [mode, colors] of modes(palette)) {
      const series = getSeriesColors(colors);
      const names = CATEGORICAL_COLOR_ORDER;

      it(`${palette.id} ${mode}: adjacent series clear ΔE ${CVD_ADJACENT_FLOOR}`, () => {
        const failures: string[] = [];
        for (let i = 0; i < series.length - 1; i++) {
          const { de, vision } = worstDelta(series[i]!, series[i + 1]!);
          if (de < CVD_ADJACENT_FLOOR) {
            failures.push(
              `${names[i]}/${names[i + 1]} ${de.toFixed(1)} (${vision})`
            );
          }
        }
        expect(failures).toEqual([]);
      });

      it(`${palette.id} ${mode}: first three series clear ΔE ${CVD_FIRST_THREE_FLOOR}`, () => {
        const failures: string[] = [];
        for (let i = 0; i < 3; i++) {
          for (let j = i + 1; j < 3; j++) {
            const { de, vision } = worstDelta(series[i]!, series[j]!);
            if (de < CVD_FIRST_THREE_FLOOR) {
              failures.push(
                `${names[i]}/${names[j]} ${de.toFixed(1)} (${vision})`
              );
            }
          }
        }
        expect(failures).toEqual([]);
      });
    }
  }
});
