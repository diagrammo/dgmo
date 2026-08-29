#!/usr/bin/env node
// ============================================================
// Generate src/utils/inter-metrics.ts from the shipped Inter TTFs
// ============================================================
//
// The width model under every chart type's wrapping and sizing was a
// hand-copied Helvetica table, while FONT_FAMILY has put Inter first for as
// long as the fonts have shipped. Inter is the wider face — 7.9% on the
// journey-map card title that exposed it (issue 147) — so renderers wrapped
// one word too late and drew it past the edge of its card.
//
// Like fonts/coverage.json, this reads the advances back out of the TTFs that
// are actually shipped rather than from any table describing them. The TTF is
// parsed by hand for the same reason build-fonts.mjs does it: no font library
// is a dependency here, and neither script needs one.
//
//   node scripts/build-text-metrics.mjs
//
// Re-run it after any change to fonts/. Coverage is deliberately not the
// font's full 1,784 codepoints — the table is bundled into every consumer,
// and the tail is glyphs no diagram label has carried. Anything outside it
// measures at INTER_DEFAULT_W.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** Offset of a named table in the font's directory. */
export function tableOffset(buf, tag) {
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (buf.toString('latin1', o, o + 4) === tag)
      return buf.readUInt32BE(o + 8);
  }
  throw new Error(`font has no ${tag} table`);
}

/**
 * codepoint → glyph id, from the best cmap subtable. Same subtable preference
 * as build-fonts.mjs (format 12 over format 4), but it keeps the glyph ids,
 * which coverage does not need and metrics cannot do without.
 */
export function readCmap(buf) {
  const cmapOff = tableOffset(buf, 'cmap');
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

  const map = new Map();
  if (best.fmt === 4) {
    const segX2 = buf.readUInt16BE(best.sub + 6);
    const endO = best.sub + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = buf.readUInt16BE(endO + s * 2);
      const start = buf.readUInt16BE(startO + s * 2);
      if (start === 0xffff) continue;
      const delta = buf.readInt16BE(deltaO + s * 2);
      const rangeOffset = buf.readUInt16BE(rangeO + s * 2);
      for (let c = start; c <= end; c++) {
        let gid;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
          gid = buf.readUInt16BE(gi);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) map.set(c, gid);
      }
    }
  } else {
    const groups = buf.readUInt32BE(best.sub + 12);
    for (let g = 0; g < groups; g++) {
      const o = best.sub + 16 + g * 12;
      const start = buf.readUInt32BE(o);
      const end = Math.min(buf.readUInt32BE(o + 4), 0x10ffff);
      const startGid = buf.readUInt32BE(o + 8);
      for (let c = start; c <= end; c++) map.set(c, startGid + (c - start));
    }
  }
  return map;
}

/** glyph id → advance width, in font units. */
export function readAdvances(buf) {
  const numHMetrics = buf.readUInt16BE(tableOffset(buf, 'hhea') + 34);
  const numGlyphs = buf.readUInt16BE(tableOffset(buf, 'maxp') + 4);
  const hmtx = tableOffset(buf, 'hmtx');
  const adv = new Array(numGlyphs);
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    // Past numHMetrics the table stops repeating the advance: every remaining
    // glyph carries the last one (monospaced tail of the hmtx array).
    if (g < numHMetrics) last = buf.readUInt16BE(hmtx + g * 4);
    adv[g] = last;
  }
  return adv;
}

/** Printable ASCII, Latin-1, and the punctuation real prose carries. */
export function coveredCodepoints() {
  const cps = [];
  for (let c = 0x20; c <= 0x7e; c++) cps.push(c);
  for (let c = 0xa0; c <= 0xff; c++) cps.push(c);
  for (const ch of '‘’‚“”„–—…•·×÷€£¥™©®→←↔≤≥≈≠°±§¶†‡') {
    cps.push(ch.codePointAt(0));
  }
  return [...new Set(cps)].sort((a, b) => a - b);
}

export function ratios(ttfPath) {
  const buf = readFileSync(ttfPath);
  const upem = buf.readUInt16BE(tableOffset(buf, 'head') + 18);
  const cmap = readCmap(buf);
  const adv = readAdvances(buf);

  const table = new Map();
  const missing = [];
  for (const cp of coveredCodepoints()) {
    const gid = cmap.get(cp);
    if (gid === undefined || adv[gid] === undefined) {
      missing.push(cp);
      continue;
    }
    // Three decimals is ~0.003 px of error on a 13 px label — well under the
    // rounding the renderers already do, and it keeps the table readable.
    table.set(cp, Math.round((adv[gid] / upem) * 1000) / 1000);
  }
  return { table, upem, missing };
}

function serialize(name, table) {
  const rows = [];
  let line = '';
  for (const [cp, w] of table) {
    const ch = String.fromCodePoint(cp);
    const key = /^[A-Za-z]$/.test(ch)
      ? ch
      : `'${ch === '\\' || ch === "'" ? `\\${ch}` : ch}'`;
    const entry = `${key}:${w},`;
    if (line.length + entry.length > 74) {
      rows.push(line);
      line = '';
    }
    line += entry;
  }
  if (line) rows.push(line);
  return `// prettier-ignore\nexport const ${name}: Record<string, number> = {\n  ${rows.join('\n  ')}\n};\n`;
}

// Only generate when run as a script. tests/text-metrics-fidelity.test.ts
// imports `ratios` to check the committed table against the shipped TTFs,
// and must not rewrite the file it is checking.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const regular = ratios(join(root, 'fonts/Inter-Regular.ttf'));
  const bold = ratios(join(root, 'fonts/Inter-Bold.ttf'));

  for (const [face, r] of [
    ['Regular', regular],
    ['Bold', bold],
  ]) {
    if (r.missing.length) {
      console.warn(
        `Inter ${face}: ${r.missing.length} wanted codepoints absent from the ` +
          `subset font — they will measure at the fallback ratio: ` +
          r.missing.map((c) => `U+${c.toString(16).toUpperCase()}`).join(' ')
      );
    }
  }

  // The fallback for anything outside the table. The mean advance of Inter
  // Regular's covered letters beats the old flat 0.56, but it is still a guess —
  // which is why the warning above is worth reading.
  const letters = [...regular.table.entries()].filter(([cp]) =>
    /\p{L}/u.test(String.fromCodePoint(cp))
  );
  const meanLetter =
    Math.round(
      (letters.reduce((a, [, w]) => a + w, 0) / letters.length) * 1000
    ) / 1000;

  const banner = [
    '// ============================================================',
    '// Inter advance widths — GENERATED, do not edit',
    '// ============================================================',
    '//',
    '// Written by scripts/build-text-metrics.mjs, read out of the TTFs in fonts/',
    '// that the CLI feeds resvg and the app loads via @font-face. Regenerate',
    '// after any change to those files; never hand-edit a number here.',
    '//',
    '// Values are a fraction of font size (advance ÷ unitsPerEm), with no',
    '// kerning — the same additive model measureText has always used.',
    '',
    '',
  ].join('\n');

  const trailer = [
    '',
    '/**',
    ' * Fallback ratio for a character absent from the tables above — the mean',
    " * advance of Inter Regular's covered letters.",
    ' */',
    `export const INTER_DEFAULT_W = ${meanLetter};`,
    '',
  ].join('\n');

  const body =
    banner +
    serialize('INTER_REGULAR_W', regular.table) +
    '\n' +
    serialize('INTER_BOLD_W', bold.table) +
    trailer;

  const dest = join(root, 'src/utils/inter-metrics.ts');
  writeFileSync(dest, body);
  console.log(
    `Wrote src/utils/inter-metrics.ts — ${regular.table.size} codepoints per ` +
      `face at ${regular.upem} upem, fallback ${meanLetter}`
  );
}
