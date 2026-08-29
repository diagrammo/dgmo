// ============================================================
// Error Card — fallback image rendered when a diagram can't parse
// ============================================================
//
// When `render(text, { onError: 'svg' })` (the default) hits parse errors,
// hosts that embed dgmo — remark/astro/docusaurus/fumadocs, Obsidian, the
// web editor — show whatever SVG we return in place of the diagram. A blank
// or cryptic box is a dead end for the author, so we render a friendly card:
// a frown mark, the dgmo wordmark, and per-error the line number, the
// message, and the actual offending source line with a caret at the column.
//
// Pure string builder — no DOM, so it works in every consumer (SSR, browser,
// resvg→PNG in the CLI). resvg has no color-mix(); all colors are pre-resolved.

import { truncateText, measureText } from './utils/text-measure';
import { FONT_FAMILY, MONO_FAMILY } from './fonts';
import { encodeDiagramUrl } from './sharing';
import { parseDgmoChartType } from './dgmo-router';
import { chartTypes } from './chart-types';
import type { PaletteConfig } from './palettes/types';
import type { Theme } from './themes';
import type { DgmoError } from './diagnostics';

const DOCS_BASE = 'https://diagrammo.app/docs';

/**
 * Documentation URL for the failed diagram. Points at the specific chart-type
 * guide when the type can be recovered from the (broken) source — the first
 * line usually still declares it — and otherwise at the docs landing page.
 */
export function docsLink(source: string): { url: string; label: string } {
  const chartType = parseDgmoChartType(source);
  // An INTERNAL type has no published guide — the docs sidebar, the compare
  // matrix and the gallery are all driven by the content registry, which it is
  // deliberately absent from. Deep-linking to `/docs/chart-<id>/` for one would
  // make the card's single call-to-action a 404.
  const hasGuide =
    chartType !== null &&
    !chartTypes.some((c) => c.id === chartType && c.internal);
  return hasGuide
    ? {
        url: `${DOCS_BASE}/chart-${chartType}/`,
        label: `Read the ${chartType} guide ↗`,
      }
    : { url: `${DOCS_BASE}/`, label: 'Browse the DGMO docs ↗' };
}

/**
 * The one monospace stack in the tree. Exported so the live-link card reuses it
 * rather than adding a fourth copy — an id is code, and it must look like code
 * in every card that shows one.
 */
export { MONO_FAMILY };

const W = 660;
const PAD = 24;
const CONTENT_W = W - PAD * 2;
const MAX_ERRORS = 4;
// Monospace advance ≈ 0.6em — used to place the caret under the bad column.
const MONO_CH = 0.6;
const CODE_FS = 12.5;

/**
 * Render a self-contained SVG error card for a failed diagram parse.
 *
 * @param errors  Error-severity diagnostics (line-numbered).
 * @param source  Original DGMO source, used to quote the offending lines.
 */
export function renderErrorCard(
  errors: DgmoError[],
  source: string,
  palette: PaletteConfig,
  theme?: Theme
): string {
  const c = palette[theme === 'dark' ? 'dark' : 'light'];
  const isTransparent = theme === 'transparent';
  const card = c.surface;
  const codeBg = c.bg;
  const border = c.border;
  const danger = c.destructive ?? c.colors.red;
  const text = c.text;
  const muted = c.textMuted;
  const srcLines = source.split('\n');

  const shown = errors.slice(0, MAX_ERRORS);
  const overflow = errors.length - shown.length;

  const parts: string[] = [];
  let y = PAD + 8;

  // ── Header: frown mark + title, dgmo wordmark right ────────
  parts.push(frownMark(PAD + 14, y + 12, danger));
  parts.push(
    `<text x="${PAD + 38}" y="${y + 11}" fill="${text}" font-family="${FONT_FAMILY}" font-size="16" font-weight="bold">Couldn't render this diagram</text>`,
    `<text x="${W - PAD}" y="${y + 10}" text-anchor="end" fill="${muted}" font-family="${FONT_FAMILY}" font-size="12" font-weight="bold" letter-spacing="0.5">dgmo</text>`
  );
  y += 24;
  const errLabel = errors.length === 1 ? '1 error' : `${errors.length} errors`;
  parts.push(
    `<text x="${PAD + 38}" y="${y + 4}" fill="${muted}" font-family="${FONT_FAMILY}" font-size="12.5">${errLabel} — fix the lines below and re-render</text>`
  );
  y += 22;
  parts.push(
    `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${border}" stroke-width="1"/>`
  );
  y += 24;

  // ── Per-error blocks ───────────────────────────────────────
  for (const e of shown) {
    const hasLine = e.line > 0;

    // Line badge (skip when line is unknown / 0), with the message inline.
    let msgX = PAD;
    if (hasLine) {
      const label = e.column ? `Line ${e.line}:${e.column}` : `Line ${e.line}`;
      const badgeW = 14 + label.length * 7;
      parts.push(
        `<rect x="${PAD}" y="${y - 13}" width="${badgeW}" height="19" rx="4" fill="${danger}"/>`,
        `<text x="${PAD + badgeW / 2}" y="${y + 1}" text-anchor="middle" fill="${c.bg}" font-family="${FONT_FAMILY}" font-size="11.5" font-weight="bold">${escapeXml(label)}</text>`
      );
      msgX = PAD + badgeW + 12;
    }

    // Message: first line sits to the right of the badge, continuation lines
    // wrap to the full content width on the rows below.
    const lines = wrapMessage(e.message, CONTENT_W - (msgX - PAD), CONTENT_W);
    lines.forEach((line, i) => {
      parts.push(
        `<text x="${i === 0 ? msgX : PAD}" y="${y + 1}" fill="${text}" font-family="${FONT_FAMILY}" font-size="13">${escapeXml(line)}</text>`
      );
      if (i < lines.length - 1) y += 18;
    });
    y += 24;

    // Offending source line with two lines of context above and below.
    // The bad line gets a red highlight band; a caret marks the column.
    if (hasLine) {
      const CTX = 2;
      const first = Math.max(1, e.line - CTX);
      const last = Math.min(srcLines.length, e.line + CTX);
      const rowH = 18;
      const hasCaret = e.column !== undefined && e.column > 0;
      // Gutter sized to the widest line number in the window.
      const gutterW = `${last}`.length * CODE_FS * MONO_CH + 16;
      const codeX = PAD + gutterW;
      const codeMaxW = CONTENT_W - gutterW - 12;
      const topY = y - 14;
      const rowCount = last - first + 1;
      const blockH = rowCount * rowH + (hasCaret ? 14 : 0) + 10;

      const rowParts: string[] = [];
      let ry = y + 3; // baseline of the topmost row
      for (let n = first; n <= last; n++) {
        const raw = (srcLines[n - 1] ?? '').replace(/\t/g, '  ');
        const codeText = truncateText(raw, CODE_FS, codeMaxW);
        const isBad = n === e.line;
        if (isBad) {
          // Red band behind the offending row (opacity keeps code readable).
          rowParts.push(
            `<rect x="${PAD + 1}" y="${ry - 13}" width="${CONTENT_W - 2}" height="${rowH}" fill="${danger}" fill-opacity="0.16"/>`
          );
        }
        rowParts.push(
          `<text x="${PAD + 8}" y="${ry + 1}" fill="${isBad ? danger : muted}" font-family="${MONO_FAMILY}" font-size="${CODE_FS}" font-weight="${isBad ? 'bold' : 'normal'}">${escapeXml(`${n}`)}</text>`,
          `<text x="${codeX}" y="${ry + 1}" fill="${text}" font-family="${MONO_FAMILY}" font-size="${CODE_FS}" xml:space="preserve">${escapeXml(codeText)}</text>`
        );
        if (isBad && hasCaret) {
          const caretX = codeX + (e.column! - 1) * CODE_FS * MONO_CH;
          rowParts.push(
            `<text x="${caretX}" y="${ry + 15}" fill="${danger}" font-family="${MONO_FAMILY}" font-size="${CODE_FS}" font-weight="bold">^</text>`
          );
          ry += 14; // reserve the caret's row before the next context line
        }
        ry += rowH;
      }

      parts.push(
        `<rect x="${PAD}" y="${topY}" width="${CONTENT_W}" height="${blockH}" rx="5" fill="${codeBg}" stroke="${border}" stroke-width="1"/>`,
        `<line x1="${codeX - 8}" y1="${topY}" x2="${codeX - 8}" y2="${topY + blockH}" stroke="${border}" stroke-width="1"/>`,
        rowParts.join('')
      );
      y = topY + blockH + 10;
    }

    y += 14;
  }

  if (overflow > 0) {
    parts.push(
      `<text x="${PAD}" y="${y}" fill="${muted}" font-family="${FONT_FAMILY}" font-size="12.5" font-style="italic">+ ${overflow} more error${overflow === 1 ? '' : 's'}</text>`
    );
    y += 22;
  }

  // ── Footer: open-in-editor call to action ──────────────────
  // A live fix path: the Diagrammo mark + a link that opens the online editor
  // preloaded with THIS (broken) source, so the author can fix it and copy it
  // back into their code fence. The <a> is clickable when the SVG is embedded
  // inline (remark/astro/docusaurus/fumadocs, Obsidian, the web editor) and
  // still renders as visible text in a rasterized PNG export (resvg keeps the
  // anchor's children). Falls back to the bare editor URL when the source is
  // too large to compress into a share link.
  y += 2;
  parts.push(
    `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${border}" stroke-width="1"/>`
  );
  y += 24;
  const encoded = encodeDiagramUrl(source);
  const editUrl =
    'url' in encoded && encoded.url
      ? encoded.url
      : 'https://online.diagrammo.app';
  const iconSize = 18;
  const linkColor = c.colors.blue ?? c.text;
  parts.push(
    `<a href="${escapeXml(editUrl)}" target="_blank" rel="noopener noreferrer">` +
      diagrammoIcon(PAD, y - 14, iconSize) +
      `<text x="${PAD + iconSize + 8}" y="${y}" fill="${linkColor}" font-family="${FONT_FAMILY}" font-size="12.5" font-weight="bold" text-decoration="underline">Edit &amp; fix this diagram at online.diagrammo.app ↗</text>` +
      `</a>`
  );
  y += 22;

  // Documentation link — always emitted (there's nothing to toggle on the
  // fall-through card). Deep-links to the chart-type guide when the type is
  // recoverable from the source, else the docs landing page.
  const docs = docsLink(source);
  parts.push(
    `<a href="${escapeXml(docs.url)}" target="_blank" rel="noopener noreferrer">` +
      docIcon(PAD, y - 14, iconSize, linkColor) +
      `<text x="${PAD + iconSize + 8}" y="${y}" fill="${linkColor}" font-family="${FONT_FAMILY}" font-size="12.5" font-weight="bold" text-decoration="underline">${escapeXml(docs.label)}</text>` +
      `</a>`
  );
  y += 8;

  const height = Math.round(y + PAD - 14);
  const pageBg = isTransparent
    ? ''
    : `<rect width="100%" height="100%" fill="${c.bg}"/>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="${FONT_FAMILY}">`,
    pageBg,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="10" fill="${card}" stroke="${border}" stroke-width="1"/>`,
    parts.join(''),
    `</svg>`,
  ].join('');
}

// Greedy word-wrap where the first line is narrower (it shares its row with
// the line badge) and continuation lines use the full content width.
function wrapMessage(
  message: string,
  firstWidth: number,
  fullWidth: number
): string[] {
  const words = message.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const limit = lines.length === 0 ? firstWidth : fullWidth;
    const test = cur ? `${cur} ${word}` : word;
    if (measureText(test, 13) <= limit || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Frown face: ringed circle, two eyes, a downturned mouth.
function frownMark(cx: number, cy: number, color: string): string {
  const r = 12;
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2"/>`,
    `<circle cx="${cx - 4.5}" cy="${cy - 3}" r="1.6" fill="${color}"/>`,
    `<circle cx="${cx + 4.5}" cy="${cy - 3}" r="1.6" fill="${color}"/>`,
    `<path d="M ${cx - 5} ${cy + 6} Q ${cx} ${cy + 1} ${cx + 5} ${cy + 6}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
  ].join('');
}

// The Diagrammo mark (the app favicon): rounded square, gold arch, a 3-bar
// chart and 3 lines. Scaled from its native 100×100 box to `size` px at (x,y).
// Brand colors are literal hex (the mark is fixed, not palette-tinted) and
// pre-resolved so resvg renders it in PNG exports too.
function diagrammoIcon(x: number, y: number, size: number): string {
  const s = size / 100;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<rect width="100" height="100" rx="18" fill="#1f2933"/>` +
    `<path d="M41 71 L41 63.51 A28 28 0 1 1 59 63.51 L59 71" fill="none" stroke="#c9a227" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect x="36" y="43" width="7" height="9" rx="1.9" fill="#c0504d"/>` +
    `<rect x="45" y="37" width="7" height="15" rx="1.9" fill="#5b9357"/>` +
    `<rect x="54" y="30" width="7" height="22" rx="1.9" fill="#3b6ea5"/>` +
    `<rect x="36" y="75" width="28" height="4.6" rx="2.3" fill="#7d5ba6"/>` +
    `<rect x="36" y="82" width="28" height="4.6" rx="2.3" fill="#7d5ba6"/>` +
    `<rect x="36" y="89" width="28" height="4.6" rx="2.3" fill="#7d5ba6"/>` +
    `</g>`
  );
}

// A simple document glyph (page with a folded corner + text lines), stroked in
// the link color. Native 18×18 box scaled to `size` px at (x,y).
function docIcon(x: number, y: number, size: number, color: string): string {
  const s = size / 18;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M3.5 1.5h7l4 4v11h-11z"/>` +
    `<path d="M10.5 1.5v4h4"/>` +
    `<path d="M6 9.5h6M6 12.5h6"/>` +
    `</g>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
