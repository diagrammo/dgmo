// ============================================================
// Live link — the reference card
// ============================================================
//
// A pointer has no drawing of its own, so it renders as a CARD naming the
// diagram it points at. This is not an error state: it is what a CLI export
// produces, what a docs site shows when live-link resolution is switched off,
// and what the app shows before a fetch resolves.
//
// Pure string builder, no DOM — like `error-card.ts`, and for the same reason:
// a card of fixed content has nothing to measure in a live document, so making
// one would cost a jsdom round-trip to lay out four lines of text.
//
// 🔴 No hex. Every color comes from the palette (resvg has no color-mix(), so
// these are already resolved values).

import { truncateText } from '../utils/text-measure';
import { FONT_FAMILY } from '../fonts';
import { MONO_FAMILY } from '../error-card';
import type { PaletteColors } from '../palettes';
import type { ParsedLiveLink } from './types';

const W = 560;
const PAD = 28;
const CONTENT_X = PAD + 40; // clears the cloud glyph
const CONTENT_W = W - CONTENT_X - PAD;

const HEADLINE_FS = 18;
const SUBTITLE_FS = 13;
const ID_FS = 13;

const SUBTITLE = 'Live link published at Diagrammo Cloud';

/**
 * The reference card for one pointer.
 *
 * Two forms (§38.3), and the difference is not cosmetic: the shorthand has no
 * title, so the ID becomes the headline. A card whose headline is blank reads
 * as broken rather than brief.
 */
export function renderLiveLinkCard(
  parsed: ParsedLiveLink,
  palette: PaletteColors,
  theme: 'light' | 'dark' | 'transparent'
): string {
  const isTransparent = theme === 'transparent';
  const parts: string[] = [];
  let y = PAD + 18;

  parts.push(cloudGlyph(PAD, y - 14, 24, palette.textMuted));

  // ── Headline ─────────────────────────────────────────────
  // Titled form: the title, in the body font. Shorthand: the id, in mono,
  // because an id is code and reads as a mistake set in prose.
  const headline = parsed.title ?? parsed.id ?? 'Unresolved live link';
  const headlineMono = parsed.title === null && parsed.id !== null;
  parts.push(
    `<text x="${CONTENT_X}" y="${y}" fill="${palette.text}" font-family="${
      headlineMono ? MONO_FAMILY : FONT_FAMILY
    }" font-size="${HEADLINE_FS}" font-weight="${headlineMono ? 500 : 700}">` +
      `${escapeXml(truncateText(headline, HEADLINE_FS, CONTENT_W))}</text>`
  );
  y += 30;

  // ── Subtitle: what this file IS ──────────────────────────
  parts.push(
    `<text x="${CONTENT_X}" y="${y}" fill="${palette.textMuted}" font-family="${FONT_FAMILY}" font-size="${SUBTITLE_FS}">${escapeXml(SUBTITLE)}</text>`
  );
  y += 22;

  // ── The id, only when it isn't already the headline ──────
  if (parsed.title !== null && parsed.id !== null) {
    parts.push(
      `<text x="${CONTENT_X}" y="${y}" fill="${palette.textMuted}" font-family="${MONO_FAMILY}" font-size="${ID_FS}">${escapeXml(
        truncateText(parsed.id, ID_FS, CONTENT_W)
      )}</text>`
    );
    y += 22;
  }

  const height = Math.round(y + PAD - 12);
  const pageBg = isTransparent
    ? ''
    : `<rect width="100%" height="100%" fill="${palette.bg}"/>`;

  // `preserveAspectRatio` because — unlike `renderErrorCard` — this one is
  // called through the export handler table and is handed a canvas (1200×800
  // by default). Without it the card sits as a sliver in the middle of a sheet.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" font-family="${FONT_FAMILY}">`,
    pageBg,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="10" fill="${palette.surface}" stroke="${palette.border}" stroke-width="1"/>`,
    parts.join(''),
    `</svg>`,
  ].join('');
}

/** A cloud outline — the one mark that says "this lives somewhere else". */
function cloudGlyph(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  const d =
    'M6.5 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.6 8.7 4.15 4.15 0 0 1 17.5 19Z';
  return `<path transform="translate(${x},${y}) scale(${s})" d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
