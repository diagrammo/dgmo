/**
 * The CLI's one rasterising call site: SVG in, PNG bytes out.
 *
 * Its own module so a test can rasterise through the exact options the CLI
 * uses — `cli.ts` runs `main()` on import. Bundled into the CLI only; the
 * library entry never imports it, so `@resvg/resvg-js` stays out of it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
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

export function svgToPng(svg: string, background?: string): Buffer {
  // Emoji are dropped before resvg sees them — see stripEmojiFromSvg (#1423).
  // SVG output never comes through here, so it keeps them.
  const omitted = emojiOmittedWarning(textFromSvg(svg));
  if (omitted) console.error(`Warning: ${omitted}`);
  const raster = omitted ? stripEmojiFromSvg(svg) : svg;
  warnOnUncoveredGlyphs(raster);
  const fontFiles = BUNDLED_FONTS.filter((f) => existsSync(f));
  const resvg = new Resvg(raster, {
    fitTo: { mode: 'zoom', value: 2 },
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
  const rendered = resvg.render();
  return rendered.asPng();
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
