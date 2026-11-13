/**
 * The CLI's one rasterising call site: SVG in, PNG bytes out.
 *
 * Its own module so a test can rasterise through the exact options the CLI
 * uses — `cli.ts` runs `main()` on import. Bundled into the CLI only; the
 * library entry never imports it, so `@resvg/resvg-js` stays out of it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg, type RenderedImage } from '@resvg/resvg-js';
import { DEFAULT_FONT_NAME } from './fonts';
import {
  textFromSvg,
  uncoveredCharacters,
  fontPortabilityWarning,
  emojiOmittedWarning,
  stripEmojiFromSvg,
  type FontCoverage,
} from './font-coverage';

const BUNDLED_FONTS = [
  join(__dirname, '..', 'fonts', 'Inter-Regular.ttf'),
  join(__dirname, '..', 'fonts', 'Inter-Bold.ttf'),
];

const BUNDLED_COVERAGE = join(__dirname, '..', 'fonts', 'coverage.json');

/** PNG pixels per SVG unit when the CLI is given no `--scale`. */
export const DEFAULT_PNG_SCALE = 2;

/**
 * The most pixels the CLI will rasterise: 16384 x 16384, 1 GiB as RGBA.
 * Past a cap like this resvg does not fail
 * cleanly: at `--scale 1e6` it aborts the whole process in Rust ("memory
 * allocation of 240000000000000000 bytes failed") with no message (#1833
 * slice (a) review). An area, not a side: a very wide diagram such as a large
 * org chart passes 16384 px across at the default scale and is still small.
 */
export const MAX_RASTER_PIXELS = 16384 * 16384;

export function svgToPng(
  svg: string,
  background?: string,
  scale: number = DEFAULT_PNG_SCALE
): Buffer {
  return rasterize(svg, background, scale).asPng();
}

/**
 * The SVG as resvg's RGBA image, `scale` pixels per SVG unit. PNG and PDF
 * output both start here, so they rasterise identically. Throws, naming the
 * largest scale that fits, when the image would pass `MAX_RASTER_PIXELS`.
 */
export function rasterize(
  svg: string,
  background: string | undefined,
  scale: number
): RenderedImage {
  // Emoji are dropped before resvg sees them — see stripEmojiFromSvg (#1423).
  // SVG output never comes through here, so it keeps them.
  const omitted = emojiOmittedWarning(textFromSvg(svg));
  if (omitted) console.error(`Warning: ${omitted}`);
  const raster = omitted ? stripEmojiFromSvg(svg) : svg;
  warnOnUncoveredGlyphs(raster);
  const fontFiles = BUNDLED_FONTS.filter((f) => existsSync(f));
  const resvg = new Resvg(raster, {
    fitTo: { mode: 'zoom', value: scale },
    ...(background ? { background } : {}),
    font: {
      // 🔴 Always on, even though the bundled Inter was found. It used to be
      // `fontFiles.length === 0` — system fonts off precisely BECAUSE we had
      // our own — which made the `system-ui, …, sans-serif` tail of
      // FONT_FAMILY inert and left every script Inter lacks drawing NOTHING:
      // no box, no warning, exit 0. Measured 2026-08-07, a bar labelled 日本語
      // rasterised identically to one labelled with an unassigned Private Use
      // codepoint. Turning it on costs nothing for Latin — Inter is still
      // loaded explicitly and named as both default and sans-serif family, and
      // the Latin output is byte-identical across the change.
      loadSystemFonts: true,
      ...(fontFiles.length > 0 ? { fontFiles } : {}),
      defaultFontFamily: DEFAULT_FONT_NAME,
      sansSerifFamily: DEFAULT_FONT_NAME,
    },
  });
  const pixels = resvg.width * scale * (resvg.height * scale);
  if (pixels > MAX_RASTER_PIXELS) {
    const fits =
      Math.floor(
        Math.sqrt(MAX_RASTER_PIXELS / (resvg.width * resvg.height)) * 100
      ) / 100;
    throw new Error(
      `--scale ${scale} would make a ${Math.round(resvg.width * scale)}x${Math.round(resvg.height * scale)} image, ` +
        `more than the ${MAX_RASTER_PIXELS} pixels dgmo rasterises. ` +
        `This ${Math.round(resvg.width)}x${Math.round(resvg.height)} diagram fits up to --scale ${fits}.`
    );
  }
  return resvg.render();
}

/**
 * Warn when the diagram carries characters the bundled font cannot draw.
 *
 * System fallback above means these usually DID render here, off a font this
 * machine happens to have. The warning is about the next machine — a CI
 * container with no CJK font draws nothing and reports success.
 */
function warnOnUncoveredGlyphs(svg: string): void {
  let coverage: FontCoverage;
  try {
    coverage = JSON.parse(
      readFileSync(BUNDLED_COVERAGE, 'utf-8')
    ) as FontCoverage;
  } catch {
    return; // no manifest (a partial install) is not worth a warning of its own
  }
  const warning = fontPortabilityWarning(
    uncoveredCharacters(textFromSvg(svg), coverage)
  );
  if (warning) console.error(`Warning: ${warning}`);
}
