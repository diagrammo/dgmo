import { describe, expect, it } from 'vitest';
import '../src/palettes';
import { getAvailablePalettes } from '../src/palettes/registry';
import { apcaContrast, contrastText } from '../src/palettes/color-utils';
import type { PaletteColors } from '../src/palettes/types';

// Text-on-solid-fill contrast guard (2026-08-11).
//
// In fill-solid mode a shape's fill is the palette intent color itself and
// the label is one of the palette's two textOnFill tokens, so readability is
// decided entirely by data in the registry. This suite encodes the tolerance
// argument once, instead of re-litigating it per screenshot:
//
//  - the picker must return the perceptually stronger token (by APCA |Lc|)
//  - a fill whose BEST token scores under Lc 45 is a defect in the palette
//    itself — no picker can save it, the hex has to change
//  - fills between Lc 45 and 60 are legal but borderline for the 11px bold
//    labels boxes-and-lines draws; the watch list below prints so a palette
//    PR sees that set grow or shrink
const HARD_FLOOR = 45;
const TARGET = 60;

function modes(palette: {
  light: PaletteColors;
  dark: PaletteColors;
}): Array<[string, PaletteColors]> {
  return [
    ['light', palette.light],
    ['dark', palette.dark],
  ];
}

describe('palette solid-fill contrast', () => {
  const watchList: string[] = [];

  for (const palette of getAvailablePalettes()) {
    for (const [mode, colors] of modes(palette)) {
      describe(`${palette.id} ${mode}`, () => {
        for (const [name, hex] of Object.entries(colors.colors)) {
          it(`${name} ${hex}: picker returns the stronger token`, () => {
            const light = colors.textOnFillLight;
            const dark = colors.textOnFillDark;
            const lcLight = Math.abs(apcaContrast(light, hex));
            const lcDark = Math.abs(apcaContrast(dark, hex));
            const picked = contrastText(hex, light, dark);
            const lcPicked = Math.abs(apcaContrast(picked, hex));

            expect(lcPicked).toBe(Math.max(lcLight, lcDark));

            expect(
              lcPicked,
              `${palette.id} ${mode} ${name} ${hex}: best text token only ` +
                `reaches Lc ${lcPicked.toFixed(1)} (< ${HARD_FLOOR}) — the ` +
                `palette hex itself needs adjusting, no picker can fix this`
            ).toBeGreaterThanOrEqual(HARD_FLOOR);

            if (lcPicked < TARGET) {
              watchList.push(
                `${palette.id} ${mode} ${name} ${hex} → Lc ${lcPicked.toFixed(1)}`
              );
            }
          });
        }
      });
    }
  }

  it('prints the borderline watch list (Lc 45–60, legal but tight)', () => {
    if (watchList.length > 0) {
      console.warn(
        `${watchList.length} solid fills land between Lc ${HARD_FLOOR} and ` +
          `${TARGET} with their best text token (target for 11px bold ` +
          `labels is ${TARGET}+):\n  ${watchList.join('\n  ')}`
      );
    }
    expect(watchList.length).toBeLessThan(80);
  });
});
