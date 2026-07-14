// ============================================================
// Clock chart — palette swatches (day/night + work status colors)
// ============================================================
//
// Extracted from clock/renderer.ts so the map `clock` channel (BL-122) can bake
// the SAME `data-dgmo-clock-c-*` swatches on its time cards — the page ticker is
// palette-blind and reads these off the DOM to recolour on each tick, so a map
// card and a standalone clock row must agree on the exact hexes. No d3 import
// (keeps this light); the ticker itself never imports this — it reads the baked
// attrs.
import { mix } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';

/** The resolved day/night + working-status hexes a clock row/card bakes. */
export interface Swatches {
  readonly day: string;
  readonly night: string;
  readonly dayTint: string;
  readonly nightTint: string;
  readonly ok: string;
  readonly soon: string;
  readonly off: string;
  readonly okSoft: string;
  readonly soonSoft: string;
  readonly offSoft: string;
  readonly sunIcon: string;
  readonly moonIcon: string;
}

/** Resolve the palette-relative day/night + status swatches. `muted` is the
 *  caller's already-computed muted ink (off-status + soft floor blend base). */
export function buildSwatches(palette: PaletteColors, muted: string): Swatches {
  const bg = palette.bg;
  const day = resolveColor('orange', palette) ?? '#d98a1f';
  const night = resolveColor('blue', palette) ?? '#4864b0';
  const ok = resolveColor('green', palette) ?? '#3f9e59';
  const soon = resolveColor('orange', palette) ?? '#c9761a';
  return {
    day,
    night,
    dayTint: mix(day, bg, 14),
    nightTint: mix(night, bg, 14),
    ok,
    soon,
    off: muted,
    okSoft: mix(ok, bg, 14),
    soonSoft: mix(soon, bg, 14),
    offSoft: mix(muted, bg, 16),
    // Sundown indicator: a yellow sun by day, a blue moon by night.
    sunIcon: resolveColor('yellow', palette) ?? '#f4b400',
    moonIcon: night,
  };
}
