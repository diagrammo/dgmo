/**
 * Embed the Inter faces a standalone SVG uses, as base64 `@font-face` rules,
 * so the file draws the same on a machine that has no Inter installed.
 *
 * Every renderer names `FONT_FAMILY` ('Inter, system-ui, …'). An SVG written
 * to disk carries that name and nothing else, so a viewer without Inter falls
 * back to the next family and every measured width is wrong — labels overrun
 * their boxes, centred text drifts (#1834). The app and the docs plugins load
 * Inter themselves; a file opened on its own has nobody to do that.
 *
 * Only the CLI calls this, and only for `.svg` output. It is never in the
 * library's render path: an in-page embed keeps using the page's fonts, and a
 * PNG or PDF already draws from the bundled TTFs through resvg.
 *
 * Size: each face is subset to the characters the SVG's text contains and
 * stored as WOFF2. The Regular face is always embedded; Bold only when the SVG
 * asks for a weight of 600 or more. Inter covers Latin, Greek and Cyrillic;
 * a character it lacks is simply absent from the subset, and the browser
 * falls back per character to `system-ui`, as it does today.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import subsetFont from 'subset-font';
import { DEFAULT_FONT_NAME } from './fonts';

/** One TTF to embed and the CSS weight range it answers. */
interface EmbedFace {
  path: string;
  /** CSS `font-weight` descriptor, a single weight or a range: `'100 500'`. */
  weight: string;
  bold: boolean;
}

/**
 * The TTFs the CLI ships beside its bundle (`cli/fonts/`, staged by tsup) —
 * the same two files `svg-to-png.ts` hands resvg. Regular answers every
 * weight up to 500 and Bold the rest, as the app's two `@font-face` rules do.
 */
export function bundledFaces(): EmbedFace[] {
  const faces: EmbedFace[] = [
    {
      path: join(__dirname, '..', 'fonts', 'Inter-Regular.ttf'),
      weight: '100 500',
      bold: false,
    },
    {
      path: join(__dirname, '..', 'fonts', 'Inter-Bold.ttf'),
      weight: '600 900',
      bold: true,
    },
  ];
  return faces.filter((f) => existsSync(f.path));
}

/**
 * Inter is under the SIL Open Font License 1.1, which lets a subset travel
 * inside a file provided each copy carries the copyright notice and the
 * licence, and allows the font's own metadata fields to carry them. harfbuzz
 * keeps name IDs 0-6 (the copyright among them) and drops the rest; 13 and 14
 * are the licence description and its URL.
 */
const OFL_NAME_IDS = [13, 14];

const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const cp =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : m;
    }
    return ENTITY[body.toLowerCase()] ?? m;
  });
}

/**
 * Every character the SVG can draw as text: the content of every text node,
 * outside `<style>` and `<script>`. Over-inclusion only costs a few glyphs, so
 * `<title>` and `<desc>` are not filtered out.
 */
function svgTextCharacters(svg: string): string {
  const body = svg
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const seen = new Set<string>();
  for (const m of body.matchAll(/>([^<]+)</g)) {
    for (const ch of decodeEntities(m[1]!)) {
      if (ch !== '\n' && ch !== '\r' && ch !== '\t') seen.add(ch);
    }
  }
  return [...seen].sort().join('');
}

/** True when the SVG asks for a weight the Bold face draws (600 and up). */
function svgUsesBold(svg: string): boolean {
  return /font-weight\s*[:=]\s*["']?\s*(bold|bolder|[6-9]00)\b/i.test(svg);
}

/**
 * Return `svg` with a `<style>` of `@font-face` rules inserted right after
 * the root `<svg …>` tag. An SVG with no text, or with no root tag, is
 * returned unchanged.
 */
export async function embedFonts(
  svg: string,
  faces: readonly EmbedFace[]
): Promise<string> {
  const chars = svgTextCharacters(svg);
  if (chars.length === 0) return svg;
  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) return svg;

  const bold = svgUsesBold(svg);
  const rules: string[] = [];
  for (const face of faces) {
    if (face.bold && !bold) continue;
    const woff2 = await subsetFont(readFileSync(face.path), chars, {
      targetFormat: 'woff2',
      preserveNameIds: OFL_NAME_IDS,
    });
    rules.push(
      `@font-face{font-family:'${DEFAULT_FONT_NAME}';font-style:normal;` +
        `font-weight:${face.weight};` +
        `src:url(data:font/woff2;base64,${woff2.toString('base64')}) format('woff2')}`
    );
  }
  if (rules.length === 0) return svg;

  const at = root.index + root[0].length;
  const style = `<style data-dgmo-fonts="">${rules.join('')}</style>`;
  return svg.slice(0, at) + style + svg.slice(at);
}
