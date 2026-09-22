import { describe, expect, it } from 'vitest';
import '../src/palettes';
import { validateThemeFile } from '../src/palettes/theme-file';
import { getPalette } from '../src/palettes/registry';
import { registerPalette } from '../src/palettes/registry';
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

  // 🔴 Pinned deliberately, and it is the finding this slice hands back.
  // The floor is WCAG 4.5:1 on the palette's own fill colors, which is a
  // harder bar than the APCA Lc 45 the registry's built-ins are held to
  // (`palette-contrast.test.ts`) — so ten of the fourteen built-in modes,
  // Slate LIGHT among them, would be refused if somebody handed them in as a
  // theme file. Nothing here rejects a built-in: `registerPalette` does not
  // run this check. If the bar is wrong, this is the test that says so.
  it('refuses Slate light, which the built-in registry accepts', () => {
    const result = validateThemeFile({
      id: 'slate-light-as-a-file',
      name: 'Slate light',
      mode: 'light',
      light: structuredClone(getPalette('slate').light) as unknown,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'light: textOnFillDark #1f2933 on colors.teal #3a9188 reaches only ' +
        '3.92:1 — text on a fill needs 4.5:1',
    ]);
  });

  it('refuses a fill its text tokens cannot be read on, naming the pair and the number', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as { colors: Record<string, unknown> };
    // Mid grey: neither near-black nor near-white text clears 4.5:1 on it.
    dark.colors['teal'] = '#808080';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    const [message] = result.errors as [string];
    expect(message).toMatch(
      /^dark: textOnFill(Light|Dark) #[0-9a-fA-F]{6} on colors\.teal #808080 /
    );
    expect(message).toMatch(
      /reaches only \d\.\d\d:1 — text on a fill needs 4\.5:1$/
    );
  });

  it('checks the semantic accents too, not only the named colors', () => {
    const file = slateDarkFile();
    (file['dark'] as Record<string, unknown>)['destructive'] = '#808080';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain('on destructive #808080');
  });

  it('reports the WORST pair when several fills fail', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as { colors: Record<string, unknown> };
    dark.colors['teal'] = '#808080';
    dark.colors['blue'] = '#7f7f7f';
    const result = validateThemeFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    // #7f7f7f is a shade darker, so its best token scores lower than #808080's.
    expect(result.errors[0]).toContain('colors.blue #7f7f7f');
  });

  it('does not run the contrast check on a mode whose shape is already wrong', () => {
    const file = slateDarkFile();
    const dark = file['dark'] as { colors: Record<string, unknown> };
    dark.colors['teal'] = '#808080';
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
