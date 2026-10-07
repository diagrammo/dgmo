import {
  apcaContrast,
  contrastRatio,
  contrastText,
  shapeFill,
} from './color-utils';
import { BUILT_IN_PALETTE_IDS } from './built-in-ids';
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
 * APCA floor for a label on a SOLID fill — the repo's own existing bar, from
 * `tests/palette-contrast.test.ts`, which every built-in clears. A solid fill
 * is the raw intent color with no theme base mixed in, so the WCAG floor above
 * (which is stated against `shapeFill()` output) does not reach it.
 */
const SOLID_FLOOR_LC = 45;

/**
 * The palette fields that reach `shapeFill()` as an intent color: the eleven
 * named colors plus these four semantic accents. `bg`, `surface`, `overlay`
 * and `border` are never an intent — but `surface` and `bg` are three quarters
 * of every fill all the same, because `shapeFill()` mixes the intent INTO the
 * theme base. Measuring the fill rather than the intent is what brings them
 * into the check.
 */
const FILL_ACCENT_KEYS: (keyof Omit<PaletteColors, 'colors'>)[] = [
  'primary',
  'secondary',
  'accent',
  'destructive',
];

/**
 * `colors.black` and `colors.white` are palette-aesthetic anchors that do not
 * always meet contrast requirements — the reason `textOnFill*` exists as a
 * separate token at all (`types.ts`, TD-5). The shape check still requires
 * them as valid hex; the contrast check leaves them out. Decided 2026-09-23 on
 * diagrammo/diagrammo#785: with them inside the gate, Nord dark — a shipped
 * built-in — was refused for a slot `types.ts` exempts.
 */
const CONTRAST_EXEMPT: ReadonlySet<keyof PaletteColors['colors']> = new Set([
  'black',
  'white',
]);

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
  // 🔴 Unknown keys are refused, not carried. Color names are a closed set:
  // a theme supplies hex for the existing names and cannot add one, because a
  // diagram naming `magenta` would draw it for the author and fall back for
  // every reader of a link, whose palette has no such name.
  const fields = new Set<string>([...SEMANTIC_KEYS, 'colors']);
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) {
      errors.push(`${mode}.${key}: not a palette field`);
    }
  }
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
    const names = new Set<string>(COLOR_KEYS);
    for (const key of Object.keys(named)) {
      if (!names.has(key)) {
        errors.push(
          `${mode}.colors.${key}: not a palette color — a theme sets the ` +
            `existing color names and cannot add one`
        );
      }
    }
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
 * Every field of a palette that reaches `shapeFill()` as an intent color and
 * is held to a contrast floor — `CONTRAST_EXEMPT` is left out.
 */
function intents(colors: PaletteColors): [string, string][] {
  const out: [string, string][] = [];
  for (const key of COLOR_KEYS) {
    if (CONTRAST_EXEMPT.has(key)) continue;
    out.push([`colors.${key}`, colors.colors[key]]);
  }
  for (const key of FILL_ACCENT_KEYS) out.push([key, colors[key]]);
  return out;
}

/**
 * The text token the renderer DRAWS on one background — `contrastText()`'s
 * own pick, by APCA. 🔴 Never the WCAG-better of the two: on a mid-tone fill
 * the two measures disagree, and scoring the token WCAG prefers passed files
 * whose drawn label sat at 3.23:1 (diagrammo/diagrammo#785, review round 3).
 */
function drawnToken(
  colors: PaletteColors,
  bg: string
): 'textOnFillLight' | 'textOnFillDark' {
  const drawn = contrastText(bg, colors.textOnFillLight, colors.textOnFillDark);
  return drawn === colors.textOnFillDark ? 'textOnFillDark' : 'textOnFillLight';
}

/**
 * The worst text-on-TINTED-fill pair, for one theme base.
 *
 * 🔴 The background measured is `shapeFill()`'s OUTPUT, not the intent color
 * that went into it — that is the surface a tinted label is actually drawn on,
 * and it is the invariant `PaletteColors.textOnFillLight` states in so many
 * words. Measuring the raw intent instead leaves `surface` and `bg` unmeasured
 * although they are three quarters of every canonical fill.
 *
 * `isDark` picks which of the two the intent is mixed into (`themeBaseBg`), so
 * a palette that serves both render modes has to be measured against both.
 */
function worstTintedFill(
  colors: PaletteColors,
  isDark: boolean
): {
  ratio: number;
  token: 'textOnFillLight' | 'textOnFillDark';
  fill: string;
  fillHex: string;
} {
  let worst: ReturnType<typeof worstTintedFill> | undefined;
  for (const [fill, intent] of intents(colors)) {
    const fillHex = shapeFill(colors, intent, isDark);
    const token = drawnToken(colors, fillHex);
    const ratio = contrastRatio(colors[token], fillHex);
    if (!worst || ratio < worst.ratio) {
      worst = { ratio, token, fill, fillHex };
    }
  }
  // FILL_ACCENT_KEYS is non-empty, so the loop always ran.
  return worst!;
}

/**
 * The worst text-on-SOLID-fill pair. Under `fill-solid` a shape's background
 * IS the intent color, with no tint and no theme base, so the tinted check
 * above never sees it — and a theme file is the one input nothing else checks.
 * The built-in registry is held to APCA Lc 45 here by
 * `tests/palette-contrast.test.ts`, and all seven clear it; this applies that
 * same existing bar to a file, rather than inventing a second number.
 */
function worstSolidFill(colors: PaletteColors): {
  lc: number;
  token: 'textOnFillLight' | 'textOnFillDark';
  fill: string;
  fillHex: string;
} {
  let worst: ReturnType<typeof worstSolidFill> | undefined;
  for (const [fill, intent] of intents(colors)) {
    const token = drawnToken(colors, intent);
    const lc = Math.abs(apcaContrast(colors[token], intent));
    if (!worst || lc < worst.lc) {
      worst = { lc, token, fill, fillHex: intent };
    }
  }
  return worst!;
}

/**
 * Both fill families, for one set of colors serving one render mode.
 *
 * `where` labels the RENDER mode, which is not always the mode the file
 * declared: a one-mode theme colors both, so its colors are measured against
 * both theme bases and a failure has to say which one it was found in.
 */
function collectContrastErrors(
  colors: PaletteColors,
  where: string,
  isDark: boolean,
  errors: string[]
): void {
  const tinted = worstTintedFill(colors, isDark);
  if (tinted.ratio < CONTRAST_FLOOR) {
    errors.push(
      `${where}: ${tinted.token} ${colors[tinted.token]} on the ` +
        `${tinted.fill} fill ${tinted.fillHex} reaches only ` +
        `${tinted.ratio.toFixed(2)}:1 — text on a fill needs ` +
        `${CONTRAST_FLOOR.toFixed(1)}:1`
    );
  }
}

/** The solid-fill bar, measured once per distinct block of colors. */
function collectSolidErrors(
  colors: PaletteColors,
  where: string,
  errors: string[]
): void {
  const solid = worstSolidFill(colors);
  if (solid.lc >= SOLID_FLOOR_LC) return;
  errors.push(
    `${where}: ${solid.token} ${colors[solid.token]} on the solid ` +
      `${solid.fill} ${solid.fillHex} reaches only Lc ` +
      `${solid.lc.toFixed(1)} — text on a solid fill needs Lc ${SOLID_FLOOR_LC}`
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
  } else if (BUILT_IN_PALETTE_IDS.has(id)) {
    errors.push(
      `id: "${id}" is a built-in palette — a theme file needs an id of its own`
    );
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

  // 🔴 A file that declares a mode AND defines the other one is refused, not
  // half-read. Taking only the declared mode would drop a whole block of
  // colors the author wrote — unchecked, unreported, and invisible: they edit
  // `light`, save, and nothing changes with nothing to say why.
  if (mode) {
    const other = mode === 'light' ? 'dark' : 'light';
    if (input[other] !== undefined) {
      errors.push(
        `${other}: a theme declaring mode "${mode}" must not also define ` +
          `${other} — drop the mode to define both`
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
    if (collectShapeErrors(value, key, errors)) modes[key] = value;
  }

  // 🔴 Contrast runs on the ASSEMBLED palette, after the shape is known good,
  // and never on the file's blocks as written. A one-mode file colors both
  // modes, so the colors it defined are mixed into `bg` in a light render and
  // into `surface` in a dark one — two different backgrounds, and measuring
  // only the declared mode's leaves the other unchecked on a palette the
  // renderer will happily draw either way. Shape first: a mode that failed
  // above is not in `modes`, and scoring colors that are not hex is nonsense.
  if (errors.length === 0) {
    const light = modes.light ?? modes.dark!;
    const dark = modes.dark ?? modes.light!;
    const declaredMode = mode;
    const label = (render: 'light' | 'dark') =>
      declaredMode !== null && render !== declaredMode
        ? `${render} (a theme declaring mode "${declaredMode}" is used in ` +
          `${render} mode too)`
        : render;
    collectContrastErrors(light, label('light'), false, errors);
    collectContrastErrors(dark, label('dark'), true, errors);
    // A solid fill is the intent itself, with no theme base, so a mirrored
    // palette would otherwise report the identical line twice.
    if (declaredMode !== null) {
      collectSolidErrors(light, declaredMode, errors);
    } else {
      collectSolidErrors(light, 'light', errors);
      collectSolidErrors(dark, 'dark', errors);
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
