/**
 * Theme — render mode flag. Selects which palette variant the renderer uses
 * for background and text:
 *  - 'light'       → palette.light colors
 *  - 'dark'        → palette.dark colors
 *  - 'transparent' → no background fill (for embedding in colored containers)
 */
export type Theme = 'light' | 'dark' | 'transparent';

/**
 * `themes` namespace — use with render() options for a typed handle:
 *
 *   await render(text, { theme: themes.dark });
 *
 * Passing the raw string `'dark'` also works (the underlying type is the
 * string-literal union); the namespace is the conventional path.
 */
export const themes = {
  light: 'light',
  dark: 'dark',
  transparent: 'transparent',
} as const satisfies Record<string, Theme>;
