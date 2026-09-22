import { contrastRatio } from './color-utils';
import { COLOR_KEYS, SEMANTIC_KEYS, isValidHex } from './registry';
import type { PaletteColors, PaletteConfig } from './types';

// ============================================================
// Theme files
// ============================================================
//
// A theme file is a palette somebody wrote by hand, or a desktop theme
// generator wrote for them, and dropped in the app's theme folder. It carries
// the SAME shape as a built-in palette — there is no second format — so this
// module validates against the registry's own key lists rather than a copy.
//
// Two things a built-in never has to survive and a theme file does: the bytes
// may be anything at all, and nobody proof-read the colors. So validation
// collects every problem instead of throwing on the first, and a file whose
// text-on-fill colors cannot be read on the fills the palette itself defines
// is refused with the pair and the measured ratio.

/**
 * WCAG 2.1 AA contrast floor for text on a fill. A theme file whose worst
 * text-on-fill pair falls below this is refused.
 */
const CONTRAST_FLOOR = 4.5;

/**
 * The palette fields that reach `shapeFill()` as an intent color, and are
 * therefore the fills `textOnFillLight` / `textOnFillDark` have to stay
 * readable on: the eleven named colors plus the four semantic accents.
 * `bg`, `surface`, `overlay` and `border` are grounds rather than fills, and
 * the text fields are not fills at all.
 */
const FILL_ACCENT_KEYS: (keyof Omit<PaletteColors, 'colors'>)[] = [
  'primary',
  'secondary',
  'accent',
  'destructive',
];

/** What `validateThemeFile` answers. */
export type ThemeFileResult =
  | {
      readonly ok: true;
      /** The theme, in the same shape the registry and the renderers take. */
      readonly palette: PaletteConfig;
      /**
       * The single mode the file declared, or `null` when it defined both.
       * A one-mode theme colors both modes identically — the file says which
       * one it was drawn for, and that is what a light/dark control has to
       * show rather than offer.
       */
      readonly mode: 'light' | 'dark' | null;
    }
  | { readonly ok: false; readonly errors: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collect every missing or malformed color field in one mode. */
function collectShapeErrors(
  value: unknown,
  mode: string,
  errors: string[]
): value is PaletteColors {
  if (!isRecord(value)) {
    errors.push(
      `${mode}: expected an object of colors, got ${describe(value)}`
    );
    return false;
  }
  const before = errors.length;
  for (const key of SEMANTIC_KEYS) {
    const hex = value[key];
    if (typeof hex !== 'string' || !isValidHex(hex)) {
      errors.push(`${mode}.${key}: invalid hex ${describe(hex)}`);
    }
  }
  const named = value['colors'];
  if (!isRecord(named)) {
    errors.push(
      `${mode}.colors: expected an object of named colors, got ${describe(named)}`
    );
  } else {
    for (const key of COLOR_KEYS) {
      const hex = named[key];
      if (typeof hex !== 'string' || !isValidHex(hex)) {
        errors.push(`${mode}.colors.${key}: invalid hex ${describe(hex)}`);
      }
    }
  }
  return errors.length === before;
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (typeof value === 'string') return `"${value}"`;
  if (value === null) return 'null';
  return typeof value;
}

/**
 * The worst text-on-fill pair in one mode: for every fill the palette defines,
 * the better of the two text tokens, and then the weakest of those.
 */
function worstFillPair(colors: PaletteColors): {
  ratio: number;
  token: 'textOnFillLight' | 'textOnFillDark';
  fill: string;
  fillHex: string;
} {
  const fills: [string, string][] = [];
  for (const key of COLOR_KEYS)
    fills.push([`colors.${key}`, colors.colors[key]]);
  for (const key of FILL_ACCENT_KEYS) fills.push([key, colors[key]]);

  let worst: ReturnType<typeof worstFillPair> | undefined;
  for (const [fill, fillHex] of fills) {
    const light = contrastRatio(colors.textOnFillLight, fillHex);
    const dark = contrastRatio(colors.textOnFillDark, fillHex);
    const best =
      light >= dark
        ? { ratio: light, token: 'textOnFillLight' as const }
        : { ratio: dark, token: 'textOnFillDark' as const };
    if (!worst || best.ratio < worst.ratio) {
      worst = { ...best, fill, fillHex };
    }
  }
  // FILL_ACCENT_KEYS and COLOR_KEYS are both non-empty, so the loop always ran.
  return worst!;
}

function collectContrastErrors(
  colors: PaletteColors,
  mode: string,
  errors: string[]
): void {
  const worst = worstFillPair(colors);
  if (worst.ratio >= CONTRAST_FLOOR) return;
  errors.push(
    `${mode}: ${worst.token} ${colors[worst.token]} on ${worst.fill} ` +
      `${worst.fillHex} reaches only ${worst.ratio.toFixed(2)}:1 — ` +
      `text on a fill needs ${CONTRAST_FLOOR.toFixed(1)}:1`
  );
}

/**
 * Validate a parsed theme file against the palette shape, and refuse one whose
 * text-on-fill colors cannot be read.
 *
 * The file carries `id`, `name`, and either both `light` and `dark`, or a
 * `mode` naming the single mode it defines. A one-mode file colors both modes
 * from the mode it defined — a desktop theme is written for one of the two and
 * the app has nothing else to show in the other.
 *
 * Every problem is reported, not just the first: somebody is going to edit this
 * file again, and one error per save is a slow way to learn the shape.
 */
export function validateThemeFile(input: unknown): ThemeFileResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [`expected a theme object, got ${describe(input)}`],
    };
  }

  const id = input['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    errors.push(`id: expected a non-empty string, got ${describe(id)}`);
  }
  const name = input['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push(`name: expected a non-empty string, got ${describe(name)}`);
  }

  const declared = input['mode'];
  let mode: 'light' | 'dark' | null = null;
  if (declared !== undefined) {
    if (declared === 'light' || declared === 'dark') {
      mode = declared;
    } else {
      errors.push(
        `mode: expected "light" or "dark", got ${describe(declared)}`
      );
    }
  }

  const wanted: ('light' | 'dark')[] = mode ? [mode] : ['light', 'dark'];
  const modes: Partial<Record<'light' | 'dark', PaletteColors>> = {};
  for (const key of wanted) {
    const value = input[key];
    if (value === undefined) {
      errors.push(
        mode
          ? `${key}: a theme declaring mode "${mode}" has to define ${key}`
          : `${key}: a theme without a mode has to define both light and dark`
      );
      continue;
    }
    if (collectShapeErrors(value, key, errors)) {
      modes[key] = value;
      collectContrastErrors(value, key, errors);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Every wanted mode validated, so both lookups below resolve.
  const light = modes.light ?? modes.dark!;
  const dark = modes.dark ?? modes.light!;
  return {
    ok: true,
    palette: { id: id as string, name: name as string, light, dark },
    mode,
  };
}
