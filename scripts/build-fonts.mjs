#!/usr/bin/env node
/**
 * Subset the vendored Inter into the four files the package publishes.
 *
 * `vendor/inter/Inter-{Regular,Bold}.ttf` is upstream Inter, unmodified and
 * tracked in git — the source of truth. `fonts/` is generated from it by this
 * script and is gitignored; `pnpm build` regenerates it, so the published
 * bytes can never drift from the vendored source the way a hand-regenerated
 * binary does.
 *
 * ## Why the two output formats do NOT get the same coverage
 *
 * They have disjoint readers with very different failure modes (measured
 * 2026-08-06, issue #120):
 *
 * - **`.woff2` is read only by a browser** — diagrammo-app's `@font-face` and
 *   its `<link rel=preload>`. A codepoint missing here falls through
 *   `FONT_FAMILY` ('Inter, system-ui, …') to the system face PER CHARACTER, so
 *   the word still renders, just in a slightly mismatched face. Mild. Hence
 *   the aggressive Latin subset.
 *
 * - **`.ttf` is read only by resvg**, the rasterizer behind CLI/MCP/console
 *   PNGs. All three call sites pass `loadSystemFonts: fontFiles.length === 0`,
 *   so system fonts are switched OFF whenever these files are found — which is
 *   always. A codepoint missing here has nothing to fall back to and rasterizes
 *   as a .notdef box. Severe. Hence the broad subset: we drop only what no
 *   keyboard can produce.
 *
 * Full Inter maps 2,852 codepoints. 745 of them (26%) are Private Use —
 * upstream's internal decorative and alternate glyphs, unreachable from any
 * diagram source. Dropping those plus polytonic (ancient) Greek and the IPA
 * phonetic block is invisible to every real document.
 *
 * 🔴 Latin Extended-A and -B are kept in BOTH outputs. That is where
 * `ł ő š ž ą ć ș ğ đ` live, so Polish, Czech, Hungarian, Turkish, Romanian and
 * Croatian keep rendering. Do not "simplify" the woff2 set to Basic Latin —
 * the marketing site's own Inter subset did exactly that and silently breaks
 * six European languages.
 */
import subsetFont from 'subset-font';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'vendor/inter');
const OUT = resolve(ROOT, 'fonts');

/** Blocks dropped from the .ttf — nothing a person can type into a diagram. */
export const TTF_DROP = [
  [0xe000, 0xf8ff], // Private Use — upstream's internal alternates (745 cps)
  [0x1f00, 0x1fff], // Greek Extended — polytonic accents, ancient Greek only
  [0x0250, 0x02af], // IPA Extensions — phonetic transcription
];

/**
 * Kept in the .woff2. Latin in full (including Extended-A/B and the
 * combining marks that compose accents), plus the symbol blocks a diagram
 * actually uses — arrows, check marks, geometric shapes, fractions, math.
 * A diagram tool that cannot draw `→ ✓ ★ ▲ ½ ±` in its own font is worse off
 * than one that ships a few more kilobytes.
 */
export const WOFF2_KEEP = [
  [0x0000, 0x00ff], // Basic Latin + Latin-1 Supplement
  [0x0100, 0x017f], // Latin Extended-A  — ł ő š ž ą ć
  [0x0180, 0x024f], // Latin Extended-B  — ș ț ǎ
  [0x02b0, 0x02ff], // Spacing modifiers
  [0x0300, 0x036f], // Combining diacriticals
  [0x1e00, 0x1eff], // Latin Extended Additional — ẞ ỹ
  [0x2000, 0x206f], // General punctuation — — “ ” •
  [0x2070, 0x209f], // Super/subscripts
  [0x20a0, 0x20cf], // Currency — € ₽ ₹
  [0x2100, 0x214f], // Letterlike — ™ № Ω
  [0x2150, 0x218f], // Number forms — ½ ¼
  [0x2190, 0x21ff], // Arrows
  [0x2200, 0x22ff], // Math operators — ± × ÷ ≤ ∑
  [0x25a0, 0x25ff], // Geometric shapes — ▲ ● ■
  [0x2600, 0x26ff], // Misc symbols — ★ ☆ ☑ ☐
  [0x2700, 0x27bf], // Dingbats — ✓ ✗ ➜
];

const inRanges = (cp, ranges) => ranges.some(([s, e]) => cp >= s && cp <= e);

/**
 * Every codepoint the font maps, read straight out of its `cmap` table.
 *
 * Needed because the .ttf subset is expressed as "everything EXCEPT these
 * blocks" — harfbuzz takes a keep-list, so the drop-list has to be subtracted
 * from the source's real coverage. Handles the two cmap formats Inter ships:
 * 4 (BMP) and 12 (full range).
 */
function readCoverage(buf) {
  const numTables = buf.readUInt16BE(4);
  let cmapOff = null;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (buf.toString('latin1', o, o + 4) === 'cmap')
      cmapOff = buf.readUInt32BE(o + 8);
  }
  if (cmapOff === null) throw new Error('font has no cmap table');

  // Prefer a format 12 subtable (full Unicode) over format 4 (BMP only).
  let best = null;
  const n = buf.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < n; i++) {
    const o = cmapOff + 4 + i * 8;
    const sub = cmapOff + buf.readUInt32BE(o + 4);
    const fmt = buf.readUInt16BE(sub);
    if (fmt === 12) best = { sub, fmt };
    else if (fmt === 4 && !best) best = { sub, fmt };
  }
  if (!best) throw new Error('font has no format 4 or 12 cmap subtable');

  const cps = new Set();
  if (best.fmt === 4) {
    const segX2 = buf.readUInt16BE(best.sub + 6);
    const endO = best.sub + 14;
    const startO = endO + segX2 + 2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = buf.readUInt16BE(endO + s * 2);
      const start = buf.readUInt16BE(startO + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end; c++) cps.add(c);
    }
  } else {
    const groups = buf.readUInt32BE(best.sub + 12);
    for (let g = 0; g < groups; g++) {
      const o = best.sub + 16 + g * 12;
      const start = buf.readUInt32BE(o);
      const end = Math.min(buf.readUInt32BE(o + 4), 0x10ffff);
      for (let c = start; c <= end; c++) cps.add(c);
    }
  }
  return cps;
}

/** harfbuzz takes the glyphs to keep as text, not as ranges. */
const toText = (cps) => [...cps].map((c) => String.fromCodePoint(c)).join('');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

async function main() {
  await mkdir(OUT, { recursive: true });
  const rows = [];

  for (const weight of ['Regular', 'Bold']) {
    const src = await readFile(resolve(SRC, `Inter-${weight}.ttf`));
    const coverage = readCoverage(src);

    const ttfKeep = toText([...coverage].filter((c) => !inRanges(c, TTF_DROP)));
    const woff2Keep = toText(
      [...coverage].filter((c) => inRanges(c, WOFF2_KEEP))
    );

    // preserveNameIds keeps the typographic family/subfamily names (16/17)
    // alongside the standard ones harfbuzz retains. resvg matches on the
    // family name — `defaultFontFamily: 'Inter'` in all three render call
    // sites — so losing it would silently fall back to a default face.
    const opts = { preserveNameIds: [16, 17] };
    const ttf = await subsetFont(src, ttfKeep, {
      targetFormat: 'sfnt',
      ...opts,
    });
    const woff2 = await subsetFont(src, woff2Keep, {
      targetFormat: 'woff2',
      ...opts,
    });

    await writeFile(resolve(OUT, `Inter-${weight}.ttf`), ttf);
    await writeFile(resolve(OUT, `Inter-${weight}.woff2`), woff2);

    rows.push(
      `  Inter-${weight}.ttf    ${String(ttf.length).padStart(7)}  ${kb(ttf.length).padStart(9)}  ${ttfKeep.length} cps (of ${coverage.size})`,
      `  Inter-${weight}.woff2  ${String(woff2.length).padStart(7)}  ${kb(woff2.length).padStart(9)}  ${woff2Keep.length} cps`
    );
  }

  await writeFile(
    resolve(OUT, 'LICENSE-Inter.txt'),
    await readFile(resolve(SRC, 'LICENSE-Inter.txt'))
  );

  // The coverage manifest, read back out of the TTF we just wrote rather than
  // computed from the range tables above. Those tables say what we asked
  // harfbuzz for; this says what it produced, and only the second one is what
  // ships. `src/font-coverage.ts` reads this to warn about characters no
  // bundled glyph can draw — a warning derived from an intention rather than
  // from the bytes would eventually describe a font nobody has.
  const shipped = readCoverage(
    await readFile(resolve(OUT, 'Inter-Regular.ttf'))
  );
  const ranges = [];
  for (const cp of [...shipped].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && cp === last[1] + 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  await writeFile(
    resolve(OUT, 'coverage.json'),
    JSON.stringify({ ranges }) + '\n'
  );

  console.log('fonts/ generated from vendor/inter:');
  console.log(rows.join('\n'));
  console.log(
    `  coverage.json      ${String(shipped.size).padStart(7)} codepoints in ${ranges.length} ranges`
  );
}

// Only build when run as a script. `tests/font-coverage.test.ts` imports the
// range tables above to assert the coverage promise, and must not regenerate
// the fonts as a side effect of doing so.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
