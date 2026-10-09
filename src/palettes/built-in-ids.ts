// Plain strings, in a module of its own so the light completion surface
// (`completion-registry.ts`) can offer the ids without importing the
// palettes themselves or the contrast maths `theme-file.ts` carries.
// `tests/palette-built-in-ids.test.ts` pins this list to the palettes.

/**
 * The built-in palette ids. A theme file may not take one: a share link
 * carries only the id, so a file named `slate` would draw the author's colors
 * on their screen and real Slate for every reader — and Slate is the palette
 * an export falls back to. Decided 2026-09-23 on diagrammo/diagrammo#785.
 */
export const BUILT_IN_PALETTE_IDS: ReadonlySet<string> = new Set([
  'atlas',
  'blueprint',
  'catppuccin',
  'nord',
  'slate',
  'tidewater',
  'tokyo-night',
]);
