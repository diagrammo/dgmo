import type { PaletteConfig, PaletteColors } from './types';

// ============================================================
// Constants
// ============================================================

const PALETTE_REGISTRY = new Map<string, PaletteConfig>();
const DEFAULT_PALETTE_ID = 'nord';

// ============================================================
// Validation
// ============================================================

/** Validate that a hex string is well-formed (#RGB or #RRGGBB). */
export function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** Named color keys that must be present in PaletteColors.colors. */
const COLOR_KEYS: (keyof PaletteColors['colors'])[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'teal',
  'cyan',
  'gray',
];

/** Semantic color keys that must be present at the top level of PaletteColors. */
const SEMANTIC_KEYS: (keyof Omit<PaletteColors, 'colors'>)[] = [
  'bg',
  'surface',
  'overlay',
  'border',
  'text',
  'textMuted',
  'primary',
  'secondary',
  'accent',
  'destructive',
];

function validatePaletteColors(
  colors: PaletteColors,
  mode: string,
  paletteId: string
): void {
  for (const key of SEMANTIC_KEYS) {
    const value = colors[key];
    if (typeof value !== 'string' || !isValidHex(value)) {
      throw new Error(
        `Palette "${paletteId}" ${mode}.${key}: invalid hex "${value}"`
      );
    }
  }
  for (const key of COLOR_KEYS) {
    const value = colors.colors[key];
    if (typeof value !== 'string' || !isValidHex(value)) {
      throw new Error(
        `Palette "${paletteId}" ${mode}.colors.${key}: invalid hex "${value}"`
      );
    }
  }
}

// ============================================================
// Registry Functions
// ============================================================

/**
 * Register a palette. Called at module initialization.
 * Validates that all 19 color fields per mode are present and valid hex.
 * Throws on malformed palettes to catch errors at startup, not at render time.
 */
export function registerPalette(palette: PaletteConfig): void {
  validatePaletteColors(palette.light, 'light', palette.id);
  validatePaletteColors(palette.dark, 'dark', palette.id);
  PALETTE_REGISTRY.set(palette.id, palette);
}

/** Get palette by id. Returns Nord if id is unrecognized (FR10). */
export function getPalette(id: string): PaletteConfig {
  return PALETTE_REGISTRY.get(id) ?? PALETTE_REGISTRY.get(DEFAULT_PALETTE_ID)!;
}

/** List all registered palettes (for the selector UI). */
export function getAvailablePalettes(): PaletteConfig[] {
  return Array.from(PALETTE_REGISTRY.values());
}
