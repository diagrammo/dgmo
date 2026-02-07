// ============================================================
// Palette Type Definitions
// ============================================================

/**
 * Color definitions for a single mode (light or dark).
 * 10 semantic UI colors + 9 named accent colors = 19 total.
 */
export interface PaletteColors {
  // ── Surface hierarchy ──────────────────────────────────
  /** Main background (#eceff4 light / #2e3440 dark for Nord) */
  bg: string;
  /** Cards, panels (#e5e9f0 / #3b4252) */
  surface: string;
  /** Popovers, dropdowns (#e5e9f0 / #434c5e) */
  overlay: string;
  /** Borders, dividers, muted (#d8dee9 / #4c566a) */
  border: string;

  // ── Text hierarchy ─────────────────────────────────────
  /** Primary text (#2e3440 / #eceff4) */
  text: string;
  /** Secondary/diminished text (#4c566a / #d8dee9) */
  textMuted: string;

  // ── Semantic accents ───────────────────────────────────
  /** Primary accent — buttons, links */
  primary: string;
  /** Secondary accent */
  secondary: string;
  /** Tertiary accent */
  accent: string;
  /** Error/danger */
  destructive: string;

  // ── Named accent colors ────────────────────────────────
  /**
   * Used for: inline annotations (red), pie charts, cScale,
   * series rotation, journey actors, Gantt tasks.
   */
  colors: {
    red: string;
    orange: string;
    yellow: string;
    green: string;
    blue: string;
    purple: string;
    teal: string;
    cyan: string;
    gray: string;
  };
}

/**
 * Complete palette definition. One object per color scheme.
 * This is what palette authors create — the single artifact for NFR1.
 */
export interface PaletteConfig {
  /** Registry key: 'nord', 'solarized', 'catppuccin' */
  id: string;
  /** Display name: 'Nord', 'Solarized', 'Catppuccin' */
  name: string;
  /** Light mode color definitions */
  light: PaletteColors;
  /** Dark mode color definitions */
  dark: PaletteColors;
}
