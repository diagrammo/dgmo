import { describe, expect, it } from 'vitest';
import '../src/palettes';
import { validateThemeFile } from '../src/palettes/theme-file';
import {
  getAvailablePalettes,
  getPalette,
  registerPalette,
} from '../src/palettes/registry';
import type { PaletteColors } from '../src/palettes/types';

// Theme-file validation (diagrammo/diagrammo#785, slice 1).
//
// A theme file is bytes off somebody's disk in the shape of a palette. These
// tests pin the three things that decides: it is the SAME shape a built-in
// has (nothing new was invented), every problem comes back at once, and a
// file whose text-on-fill colors cannot be read is refused by name and number.

/** Slate dark — the acceptance case the issue names, as a one-mode file. */
function slateDarkFile(): Record<string, unknown> {
  return {
    id: 'omarchy',
    name: 'Omarchy',
    mode: 'dark',
    dark: structuredClone(getPalette('slate').dark) as unknown,
  };
}

/**
 * A two-mode file. Both modes are Slate DARK on purpose: Slate light does not
 * clear the 4.5:1 floor (see *the worst text-on-fill pair* below), and these
 * shape tests must fail for shape reasons only.
 */
function bothModesFile(): Record<string, unknown> {
  const slate = getPalette('slate');
  return {
    id: 'mine',
    name: 'Mine',
    light: structuredClone(slate.dark) as unknown,
    dark: structuredClone(slate.dark) as unknown,
  };
}

describe('validateThemeFile — the shape', () => {
  it('accepts a two-mode file and hands back a registrable palette', () => {
    const result = validateThemeFile(bothModesFile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBeNull();
    expect(result.palette.id).toBe('mine');
    expect(result.palette.name).toBe('Mine');
    // The registry is the shape's owner, so it is the test of the shape.
    expect(() => registerPalette(result.palette)).not.toThrow();
  });

  it('accepts a one-mode file and colors both modes from it', () => {
    const result = validateThemeFile(slateDarkFile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('dark');
    expect(result.palette.light).toEqual(result.palette.dark);
    expect(result.palette.dark.bg).toBe(getPalette('slate').dark.bg);
  });

  it('refuses a one-mode file that does not define the mode it declared', () => {
    const file = slateDarkFile();
    delete file['dark'];
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain(
      'dark: a theme declaring mode "dark" has to define dark'
    );
  });

  // A declared mode plus the other block is refused, never half-read: taking
  // the declared one alone drops a whole block of colors the author wrote,
  // unchecked and unreported. They would edit `light`, save, and see nothing
  // change with nothing to say why.
  it('refuses a file that declares a mode AND defines the other one', () => {
    const file = slateDarkFile();
    file['light'] = 'total garbage';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'light: a theme declaring mode "dark" must not also define light — ' +
        'drop the mode to define both',
    ]);
  });

  it('refuses a file with no mode that defines only one', () => {
    const file = bothModesFile();
    delete file['light'];
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain(
      'light: a theme without a mode has to define both light and dark'
    );
  });

  it.each([
    ['not an object', 42, 'expected a theme object, got number'],
    ['null', null, 'expected a theme object, got null'],
  ])('refuses %s', (_label, input, message) => {
    const result = validateThemeFile(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([message]);
  });

  it('refuses a bad mode by name', () => {
    const file = slateDarkFile();
    file['mode'] = 'sepia';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain(
      'mode: expected "light" or "dark", got "sepia"'
    );
  });

  it('names a missing id and name rather than throwing', () => {
    const file = slateDarkFile();
    delete file['id'];
    file['name'] = '  ';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain(
      'id: expected a non-empty string, got nothing'
    );
    expect(result.errors).toContain(
      'name: expected a non-empty string, got "  "'
    );
  });

  it('reports every malformed field at once, not just the first', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as Record<string, unknown> & {
      colors: Record<string, unknown>;
    };
    dark['bg'] = 'rebeccapurple';
    dark['border'] = 3;
    dark.colors['red'] = '#gggggg';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'dark.bg: invalid hex "rebeccapurple"',
      'dark.border: invalid hex number',
      'dark.colors.red: invalid hex "#gggggg"',
    ]);
  });
});

// The gap this slice closes: four fields PaletteColors requires and
// registerPalette never looked at (diagrammo/diagrammo#588).
describe('validateThemeFile — the fields nothing used to check', () => {
  it.each([
    ['textOnFillLight', 'dark.textOnFillLight: invalid hex nothing'],
    ['textOnFillDark', 'dark.textOnFillDark: invalid hex nothing'],
  ])('refuses a file missing %s', (field, message) => {
    const file = slateDarkFile();
    delete (file['dark'] as Record<string, unknown>)[field];
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain(message);
  });

  it.each([['black'], ['white']])(
    'refuses a file missing colors.%s',
    (field) => {
      const file = slateDarkFile();
      const colors = (file['dark'] as { colors: Record<string, unknown> })
        .colors;
      delete colors[field];
      const result = validateThemeFile(file);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContain(
        `dark.colors.${field}: invalid hex nothing`
      );
    }
  );
});

describe('validateThemeFile — the worst text-on-fill pair', () => {
  it('accepts Slate dark, the theme the issue names as its test case', () => {
    expect(validateThemeFile(slateDarkFile()).ok).toBe(true);
  });

  // 🔴 The check measures `shapeFill()`'s OUTPUT, not the intent that went
  // into it — the invariant `PaletteColors.textOnFillLight` states, and the
  // only surface a tinted label is ever drawn on. Measuring the raw intent
  // instead refuses ten of these fourteen, Slate light among them, because it
  // scores text against a background only `fill-solid` paints. Solid fills
  // have their own bar and their own suite: APCA Lc 45, in
  // `tests/palette-contrast.test.ts`.
  //
  // So: every built-in, both modes, handed in as if it were somebody's theme
  // file. Thirteen pass. The fourteenth is pinned below, by name and number.
  const builtIns = getAvailablePalettes().flatMap((p) =>
    (['light', 'dark'] as const).map(
      (mode) => [`${p.id} ${mode}`, p.id, mode] as const
    )
  );

  function asThemeFile(id: string, mode: 'light' | 'dark') {
    return {
      id: `${id}-as-a-file`,
      name: id,
      mode,
      [mode]: structuredClone(getPalette(id)[mode]) as unknown,
    };
  }

  it.each(builtIns.filter(([label]) => label !== 'nord dark'))(
    'accepts %s handed in as a theme file',
    (_label, id, mode) => {
      const result = validateThemeFile(asThemeFile(id, mode));
      if (!result.ok) {
        throw new Error(`refused: ${result.errors.join(' | ')}`);
      }
      expect(result.ok).toBe(true);
    }
  );

  // 🔴 The one exception, pinned rather than papered over, and reported on the
  // row. Nord dark's `white` tints to #676d7b, where its better text token
  // reaches 4.4984:1 — short of the decided 4.5:1 floor by sixteen
  // ten-thousandths. That is a real (if hairline) property of Nord, not of
  // this check: `types.ts` calls `colors.white` a "palette-aesthetic anchor"
  // that does not always meet contrast requirements, which is the reason
  // `textOnFill*` exists as a separate token at all. It changes nothing a user
  // sees today — no renderer reads `colors.black` or `colors.white`, and
  // neither is in `CATEGORICAL_COLOR_ORDER` — but an author may write `white`
  // as a tag color, so the fill is reachable and the check counts it.
  // If this should pass, Nord's `white` moves a hair or the floor stops
  // covering the two anchors; both are the owner's call, not this slice's.
  it('refuses nord dark by 0.0016, and says which pair and by how much', () => {
    const result = validateThemeFile(asThemeFile('nord', 'dark'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'dark: textOnFillLight #eceff4 on the colors.white fill #676d7b ' +
        'reaches only 4.50:1 — text on a fill needs 4.5:1',
    ]);
  });

  // 🔴 A one-mode theme colors BOTH modes, so its colors get mixed into `bg`
  // in a light render and into `surface` in a dark one. Measuring only the
  // declared mode's base leaves the other unchecked on a palette the renderer
  // will draw either way, and the message has to say which render mode the
  // failure was found in — the author declared the other one.
  it('measures a one-mode dark theme in a LIGHT render too, through bg', () => {
    const file = slateDarkFile();
    (file['dark'] as Record<string, unknown>)['bg'] = '#666666';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'light (a theme declaring mode "dark" is used in light mode too): ' +
        'textOnFillLight #ffffff on the colors.yellow fill #837c63 ' +
        'reaches only 4.18:1 — text on a fill needs 4.5:1',
    ]);
  });

  it('measures a one-mode light theme in a DARK render too, through surface', () => {
    const light = structuredClone(getPalette('slate').light) as Record<
      string,
      unknown
    >;
    light['surface'] = '#8f8f8f';
    const result = validateThemeFile({
      id: 'omarchy',
      name: 'Omarchy',
      mode: 'light',
      light,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'dark (a theme declaring mode "light" is used in dark mode too): ' +
        'textOnFillDark #1f2933 on the secondary fill #828588 ' +
        'reaches only 3.98:1 — text on a fill needs 4.5:1',
    ]);
  });

  // 🔴 `fill-solid` paints the intent itself, with no theme base mixed in, so
  // the tinted check above never sees that background. The built-in registry
  // is held to APCA Lc 45 on it by `tests/palette-contrast.test.ts`, and a
  // theme file never enters that suite — this is the same bar, applied where
  // it was missing rather than a second number invented.
  it('refuses a solid fill its text tokens cannot be read on', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as Record<string, unknown> & {
      colors: Record<string, unknown>;
    };
    dark['textOnFillLight'] = '#d0d0d0';
    dark['textOnFillDark'] = '#808080';
    dark.colors['gray'] = '#acacac';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'dark: textOnFillDark #808080 on the solid colors.gray #acacac ' +
        'reaches only Lc 20.0 — text on a solid fill needs Lc 45',
    ]);
  });

  it('reports a mirrored theme’s solid failure once, not twice', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as Record<string, unknown> & {
      colors: Record<string, unknown>;
    };
    dark['textOnFillLight'] = '#d0d0d0';
    dark['textOnFillDark'] = '#808080';
    dark.colors['gray'] = '#acacac';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
  });

  // The fill is three quarters theme base, so the base is what most decides
  // whether a label can be read — and measuring the intent alone never saw it.
  it('refuses a theme whose surface makes every fill unreadable', () => {
    const file = slateDarkFile();
    (file['dark'] as Record<string, unknown>)['surface'] = '#5a5a5a';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'dark: textOnFillDark #161b22 on the colors.white fill #7d7e7f ' +
        'reaches only 4.25:1 — text on a fill needs 4.5:1',
    ]);
  });

  it('checks the semantic accents too, not only the named colors', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as Record<string, unknown>;
    dark['surface'] = '#5a5a5a';
    // Tints to #7c7c7c, a shade worse than colors.white's #7d7e7f.
    dark['destructive'] = '#e0e0e0';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'dark: textOnFillLight #ffffff on the destructive fill #7c7c7c ' +
        'reaches only 4.17:1 — text on a fill needs 4.5:1',
    ]);
  });

  it('reports only the WORST pair, not every fill that fails', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as Record<string, unknown>;
    dark['surface'] = '#5a5a5a';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Several fills fail on that surface; one line comes back, the weakest.
    expect(result.errors).toHaveLength(1);
  });

  it('does not run the contrast check on a mode whose shape is already wrong', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as Record<string, unknown> & {
      colors: Record<string, unknown>;
    };
    dark['surface'] = '#5a5a5a';
    dark.colors['blue'] = 'not-a-hex';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'dark.colors.blue: invalid hex "not-a-hex"',
    ]);
  });
});

// Registering the built-ins is what exercises the widened key lists: seven
// palettes x two modes x 23 fields, at module load.
describe('registerPalette', () => {
  it('rejects a palette missing one of the four newly-checked fields', () => {
    const broken = structuredClone(getPalette('slate')) as {
      id: string;
      light: PaletteColors;
      dark: PaletteColors;
    };
    broken.id = 'broken-text-on-fill';
    delete (broken.dark as unknown as Record<string, unknown>)[
      'textOnFillDark'
    ];
    expect(() => registerPalette(broken as never)).toThrow(
      /broken-text-on-fill" dark\.textOnFillDark: invalid hex/
    );
  });
});
