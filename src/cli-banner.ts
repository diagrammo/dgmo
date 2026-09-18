// ============================================================
// CLI Banner — the Diagrammo D mark, in colour, for `dgmo`
// ============================================================
//
// Rendered as the header of `dgmo --help`, on the bare-`dgmo` path and at the
// end of the install flow. The art approximates the site's D mark
// (`diagrammo_app_site/public/logo-light.svg`, same geometry as `favicon.svg`):
// a "D" whose stem is a stacked bar and whose bowl is a donut ring, both
// carrying the same 52/29/19 split, so both halves of the letter are charts.
//
// Colour only when stdout is a TTY and NO_COLOR is unset. Otherwise the same
// geometry is drawn in plain ASCII, because the coloured form is half-block
// glyphs whose whole shape lives in the escapes — strip those and a `▀` grid
// is a rectangle. The two forms are rasterised from one geometry, so they
// cannot drift.
//
// 🔴 The six hues are the LOGO's own hex, hardcoded, NOT palette entries.
// The gradient this replaced sampled `getPalette('slate')` by colour name so
// that the wordmark tracked a palette edit — the right call for a wordmark
// merely tinted with brand colours, and the wrong one for the mark itself: a
// logo whose colours move when somebody edits a chart palette has stopped
// being a logo. The six are not palette entries in any case.
//
// True colour (24-bit) is assumed, as it was before this change. A 256-colour
// terminal renders the escapes as nothing and shows the half-block shape in
// its default foreground, which still reads as a D.

/** The mark's own colours, straight out of `logo-light.svg`. */
const STEM_TOP = '#c0504d'; // red
const STEM_MID = '#5b9357'; // green
const STEM_BOT = '#3b6ea5'; // blue
const BOWL_TOP = '#3a9188'; // teal
const BOWL_MID = '#7d5ba6'; // purple
const BOWL_BOT = '#cc7a33'; // orange

// Geometry in the logo's own 100×100 user space. The stem is three rounded
// rects; the rounding is below this raster's resolution and is dropped.
const STEM_X0 = 11;
const STEM_X1 = 33;
const STEM_BARS = [
  { y0: 8, y1: 47.5, color: STEM_TOP },
  { y0: 52.5, y1: 74.6, color: STEM_MID },
  { y0: 79.6, y1: 92, color: STEM_BOT },
] as const;

// The bowl is the right half of a ring centred on (45, 50): outer radius 42,
// inner 25, sweeping -90° (top) to +90° (bottom). The three arcs split that
// 180° by the same 52/29/19 as the bar, and the 5-unit gaps land on the bar's
// segment boundaries — which is the whole joke of the mark.
const BOWL_CX = 45;
const BOWL_CY = 50;
const BOWL_R_INNER = 25;
const BOWL_R_OUTER = 42;
const BOWL_ARCS = [
  { a0: -90, a1: -0.7, color: BOWL_TOP },
  { a0: 7.9, a1: 51.5, color: BOWL_MID },
  { a0: 60.1, a1: 90, color: BOWL_BOT },
] as const;

// The mark's bounding box, and the raster laid over it. Two pixel rows share
// one text row (half-block glyphs), and 18×20 over a 75.5×84 box keeps the
// pixels square, so the ring stays round.
const BOX_X0 = STEM_X0;
const BOX_X1 = 86.52;
const BOX_Y0 = 8;
const BOX_Y1 = 92;
const COLS = 18;
const PIXEL_ROWS = 20;

/** Sub-pixel sample offsets: a 3×3 grid inside every pixel. */
const SUB = [1 / 6, 1 / 2, 5 / 6];
/** Of the 9 samples, how many must land on the mark for the pixel to be on. */
const COVERAGE = 4;

const GUTTER = 3;

// 🔴 ASCII only. The no-colour form is printed into pipes and CI logs, and an
// em dash here would make "plain ASCII" false for the whole banner on the
// strength of one character in one line. `tests/cli-banner.test.ts` asserts it.
const COPY = [
  'dgmo - diagrams as code',
  '45+ chart types from plain text.',
  'Export PNG or SVG, or share a link.',
  'An MCP server is included for AI assistants.',
  'https://diagrammo.app',
];

/** Which segment of the mark, if any, covers this point in logo space. */
function segmentAt(x: number, y: number): string | null {
  if (x >= STEM_X0 && x <= STEM_X1) {
    for (const bar of STEM_BARS) {
      if (y >= bar.y0 && y <= bar.y1) return bar.color;
    }
  }
  const dx = x - BOWL_CX;
  const dy = y - BOWL_CY;
  if (dx < 0) return null;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r < BOWL_R_INNER || r > BOWL_R_OUTER) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  for (const arc of BOWL_ARCS) {
    if (angle >= arc.a0 && angle <= arc.a1) return arc.color;
  }
  return null;
}

/**
 * Rasterise the mark to `PIXEL_ROWS` rows of `COLS` pixels. Each cell is the
 * colour most of its samples landed on, or null where the mark does not cover
 * enough of it.
 */
function rasterize(): Array<Array<string | null>> {
  const grid: Array<Array<string | null>> = [];
  for (let py = 0; py < PIXEL_ROWS; py++) {
    const row: Array<string | null> = [];
    for (let px = 0; px < COLS; px++) {
      const hits = new Map<string, number>();
      let covered = 0;
      for (const sy of SUB) {
        for (const sx of SUB) {
          const x = BOX_X0 + ((px + sx) / COLS) * (BOX_X1 - BOX_X0);
          const y = BOX_Y0 + ((py + sy) / PIXEL_ROWS) * (BOX_Y1 - BOX_Y0);
          const color = segmentAt(x, y);
          if (color === null) continue;
          covered++;
          hits.set(color, (hits.get(color) ?? 0) + 1);
        }
      }
      if (covered < COVERAGE) {
        row.push(null);
        continue;
      }
      let best: string | null = null;
      let bestCount = 0;
      for (const [color, count] of hits) {
        if (count > bestCount) {
          bestCount = count;
          best = color;
        }
      }
      row.push(best);
    }
    grid.push(row);
  }
  return grid;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function fg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function bg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}

/**
 * One text row from two pixel rows, as half-block glyphs. An unset pixel is
 * given no colour at all, so the terminal's own background shows through, which is
 * what keeps the mark legible on a light background as well as a dark one.
 */
function colorRow(
  top: Array<string | null>,
  bottom: Array<string | null>
): string {
  let out = '';
  for (let col = 0; col < COLS; col++) {
    const t = top[col] ?? null;
    const b = bottom[col] ?? null;
    if (t === null && b === null) out += ' ';
    else if (t !== null && b === null) out += `${fg(t)}▀${RESET}`;
    else if (t === null && b !== null) out += `${fg(b)}▄${RESET}`;
    else if (t === b) out += `${fg(t!)}█${RESET}`;
    else out += `${fg(t!)}${bg(b!)}▀${RESET}`;
  }
  return out;
}

/** The same two pixel rows in plain ASCII: solid, half-covered, or empty. */
function monoRow(
  top: Array<string | null>,
  bottom: Array<string | null>
): string {
  let out = '';
  for (let col = 0; col < COLS; col++) {
    const t = top[col] ?? null;
    const b = bottom[col] ?? null;
    if (t !== null && b !== null) out += '#';
    else if (t !== null || b !== null) out += ':';
    else out += ' ';
  }
  return out;
}

function copyLine(index: number, useColor: boolean): string {
  const text = COPY[index];
  if (text === undefined) return '';
  if (!useColor) return text;
  if (index === 0) return `${BOLD}${text}${RESET}`;
  if (index === COPY.length - 1) return `${fg(BOWL_TOP)}${text}${RESET}`;
  return text;
}

export interface BannerOptions {
  /** Force-disable color regardless of TTY (default honors stdout TTY + NO_COLOR). */
  color?: boolean;
}

/**
 * Build the dgmo banner string: the D mark on the left, the copy beside it.
 * Coloured when `color` is true; otherwise the same mark in plain ASCII.
 */
export function renderBanner(opts: BannerOptions = {}): string {
  const useColor =
    opts.color ?? (process.stdout.isTTY === true && !process.env['NO_COLOR']);

  const grid = rasterize();
  const textRows = PIXEL_ROWS / 2;
  // Centre the copy against the mark rather than hanging it off the top.
  const copyTop = Math.max(0, Math.floor((textRows - COPY.length) / 2));

  const lines: string[] = [];
  for (let row = 0; row < textRows; row++) {
    const top = grid[row * 2] ?? [];
    const bottom = grid[row * 2 + 1] ?? [];
    const art = useColor ? colorRow(top, bottom) : monoRow(top, bottom);
    const copyIndex = row - copyTop;
    const beside =
      copyIndex >= 0 && copyIndex < COPY.length
        ? copyLine(copyIndex, useColor)
        : '';
    // The art is always COLS cells wide, glyph or space, so the gutter is a
    // constant — the coloured row's string length says nothing about its width.
    lines.push((art + ' '.repeat(GUTTER) + beside).replace(/\s+$/, ''));
  }

  return ['', ...lines, ''].join('\n');
}
