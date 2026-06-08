// ============================================================
// Palette Type Definitions
// ============================================================

/**
 * Color definitions for a single mode (light or dark).
 * 10 semantic UI colors + 9 named accent colors = 19 total.
 *
 * `readonly` on every field (and the nested `colors` map) by design —
 * palettes flow from the registry into every renderer; nothing in the
 * pipeline should ever mutate a palette in place.
 */
export interface PaletteColors {
  // ── Surface hierarchy ──────────────────────────────────
  /** Main background (#eceff4 light / #2e3440 dark for Nord) */
  readonly bg: string;
  /** Cards, panels (#e5e9f0 / #3b4252) */
  readonly surface: string;
  /** Popovers, dropdowns (#e5e9f0 / #434c5e) */
  readonly overlay: string;
  /** Borders, dividers, muted (#d8dee9 / #4c566a) */
  readonly border: string;

  // ── Text hierarchy ─────────────────────────────────────
  /** Primary text (#2e3440 / #eceff4) */
  readonly text: string;
  /** Secondary/diminished text (#4c566a / #d8dee9) */
  readonly textMuted: string;

  // ── Contrast tokens for text-on-fill ───────────────────
  /**
   * Light-mode arg for `contrastText()` when text is rendered on a
   * tinted shape fill (e.g. `shapeFill()` output). Must guarantee
   * ≥ 4.5:1 WCAG AA against any `shapeFill()` the palette can produce.
   * Distinct from `colors.white` because palette-aesthetic anchors don't
   * always meet contrast requirements (TD-5).
   */
  readonly textOnFillLight: string;
  /** Dark-mode counterpart to `textOnFillLight`. */
  readonly textOnFillDark: string;

  // ── Semantic accents ───────────────────────────────────
  /** Primary accent — buttons, links */
  readonly primary: string;
  /** Secondary accent */
  readonly secondary: string;
  /** Tertiary accent */
  readonly accent: string;
  /** Error/danger */
  readonly destructive: string;

  // ── Named accent colors ────────────────────────────────
  /**
   * Used for: inline annotations (red), pie charts, cScale,
   * series rotation, journey actors, Gantt tasks.
   */
  readonly colors: {
    readonly red: string;
    readonly orange: string;
    readonly yellow: string;
    readonly green: string;
    readonly blue: string;
    readonly purple: string;
    readonly teal: string;
    readonly cyan: string;
    readonly gray: string;
    readonly black: string;
    readonly white: string;
  };
}

/**
 * Complete palette definition. One object per color scheme.
 * This is what palette authors create — the single artifact for NFR1.
 *
 * Palettes are immutable from the consumer's perspective; the registry
 * hands out the same frozen-shape object on every `getPalette(id)`.
 */
export interface PaletteConfig {
  /** Registry key: 'nord', 'slate', 'catppuccin' */
  readonly id: string;
  /** Display name: 'Nord', 'Slate', 'Catppuccin' */
  readonly name: string;
  /** Light mode color definitions */
  readonly light: PaletteColors;
  /** Dark mode color definitions */
  readonly dark: PaletteColors;
}
