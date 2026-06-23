// ============================================================
// CLI Banner — colorful ASCII logo for `dgmo`
// ============================================================
//
// Rendered as the header of `dgmo --help` and at the end of the
// install/init flows. Uses a horizontal true-color (24-bit) gradient
// sampled from the default `slate` palette (corporate blue → teal →
// steel cyan) so the wordmark matches the brand.
//
// Color only when stdout is a TTY and NO_COLOR is unset; otherwise prints
// plain ASCII so pipes/CI stay clean.

import { getPalette } from './palettes';

// ANSI Shadow letterform for "dgmo" (6 rows) + tagline.
const ART = [
  '██████╗  ██████╗ ███╗   ███╗ ██████╗ ',
  '██╔══██╗██╔════╝ ████╗ ████║██╔═══██╗',
  '██║  ██║██║  ███╗██╔████╔██║██║   ██║',
  '██║  ██║██║   ██║██║╚██╔╝██║██║   ██║',
  '██████╔╝╚██████╔╝██║ ╚═╝ ██║╚██████╔╝',
  '╚═════╝  ╚═════╝ ╚═╝     ╚═╝ ╚═════╝ ',
];

const TAGLINE = 'diagrams as code';

// Gradient stops, pulled by name from the live slate palette (light) so the
// wordmark tracks any palette edit instead of drifting from a hardcoded copy.
// blue → teal → green → amber: a vivid sweep across the categorical hues.
const GRADIENT_COLOR_NAMES = ['blue', 'teal', 'green', 'orange'] as const;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const STOPS: Array<[number, number, number]> = (() => {
  const colors = getPalette('slate').light.colors;
  return GRADIENT_COLOR_NAMES.map((name) => hexToRgb(colors[name]));
})();

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Interpolate the multi-stop gradient at position t ∈ [0, 1]. */
function gradientAt(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const span = STOPS.length - 1;
  const scaled = clamped * span;
  const i = Math.min(span - 1, Math.floor(scaled));
  const local = scaled - i;
  const [r1, g1, b1] = STOPS[i]!;
  const [r2, g2, b2] = STOPS[i + 1]!;
  return [lerp(r1, r2, local), lerp(g1, g2, local), lerp(b1, b2, local)];
}

function fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

const RESET = '\x1b[0m';

export interface BannerOptions {
  /** Force-disable color regardless of TTY (default honors stdout TTY + NO_COLOR). */
  color?: boolean;
}

/**
 * Build the dgmo banner string. Colorized with a horizontal gradient when
 * `color` is true; otherwise returns plain ASCII.
 */
export function renderBanner(opts: BannerOptions = {}): string {
  const useColor =
    opts.color ?? (process.stdout.isTTY === true && !process.env['NO_COLOR']);

  const width = Math.max(...ART.map((line) => line.length));

  const lines = ART.map((line) => {
    if (!useColor) return line;
    let out = '';
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      // Don't paint spaces — keeps escape sequences minimal.
      if (ch === ' ') {
        out += ch;
        continue;
      }
      const [r, g, b] = gradientAt(col / (width - 1));
      out += fg(r, g, b) + ch;
    }
    return out + RESET;
  });

  // Right-align the tagline under the wordmark, muted.
  const pad = Math.max(0, width - TAGLINE.length);
  const tagline = useColor
    ? `${' '.repeat(pad)}\x1b[2;3m${TAGLINE}${RESET}`
    : `${' '.repeat(pad)}${TAGLINE}`;

  return ['', ...lines, tagline, ''].join('\n');
}
