import { readFileSync } from 'node:fs';
import { validateThemeFile } from './palettes/theme-file';
import { registerPalette } from './palettes/registry';

/** CSS pixels per inch — the canvas's own unit, and the `--dpi` default. */
export const DEFAULT_DPI = 96;

const MM_PER_INCH = 25.4;
const SIZE_RE = /^(\d+(?:\.\d+)?|\.\d+)(px|mm|in)?$/;

/**
 * Parse a `--dpi` value. Throws an Error whose message names the flag.
 */
export function parseDpi(val: string | undefined): number {
  const n = Number(val);
  if (val === undefined || val.trim() === '' || !Number.isFinite(n) || n <= 0) {
    throw new Error(
      `--dpi needs a positive number of dots per inch, got "${val ?? ''}". Try --dpi 300.`
    );
  }
  return n;
}

/**
 * Parse a `--width` / `--height` value into canvas pixels. A bare number or
 * `px` is pixels; `mm` and `in` become pixels at `dpi` (default 96), so
 * `89mm` at 300 dpi is a 1051 px canvas. Throws an Error naming the flag.
 */
export function parseSize(
  flag: string,
  val: string | undefined,
  dpi: number = DEFAULT_DPI
): number {
  const m = SIZE_RE.exec((val ?? '').trim());
  const n = m ? Number(m[1]) : NaN;
  if (!m || !(n > 0)) {
    throw new Error(
      `${flag} needs a positive size such as 1200, 1200px, 89mm or 3.5in, got "${val ?? ''}".`
    );
  }
  const unit = m[2] ?? 'px';
  const px =
    unit === 'mm' ? (n / MM_PER_INCH) * dpi : unit === 'in' ? n * dpi : n;
  return Math.max(1, Math.round(px));
}

/**
 * Load a `--theme-file`: read, parse and validate with the same rules as the
 * app's theme folder, then register the palette for this process and return
 * its id (so it can be passed as the palette choice). Throws an Error listing
 * every problem.
 */
export function loadThemeFile(path: string | undefined): string {
  if (path === undefined || path.startsWith('-')) {
    throw new Error('--theme-file needs a path to a theme JSON file.');
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (e) {
    throw new Error(
      `--theme-file cannot read "${path}": ${(e as Error).message}`,
      { cause: e }
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `--theme-file "${path}" is not valid JSON: ${(e as Error).message}`,
      { cause: e }
    );
  }
  const result = validateThemeFile(json);
  if (!result.ok) {
    throw new Error(
      `--theme-file "${path}" is not a valid theme:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
  registerPalette(result.palette);
  return result.palette.id;
}
