#!/usr/bin/env node
// ============================================================
// contact-sheet.mjs — every chart type on one page, light and dark side by
// side, with the shared title band drawn over each tile (#1838).
//
// The gallery snapshots catch a change to one chart; they cannot catch two
// charts drifting apart, because nothing shows them together. This page does.
// A tile whose title is off the band is flagged in red.
//
//   pnpm contact-sheet            # build, then write the page
//   node scripts/contact-sheet.mjs --open
//
// Output: gallery/output/contact-sheet.html (gitignored — built on demand,
// never committed; owner, 2026-11-13).
// ============================================================
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const GALLERY = join(ROOT, 'gallery', 'fixtures');
const CONFORMANCE = join(ROOT, 'tests', 'fixtures', 'conformance');
const OUT_DIR = join(ROOT, 'gallery', 'output');
const OUT = join(OUT_DIR, 'contact-sheet.html');
const NOW = '2026-01-15T09:00:00Z';

const {
  render,
  chartTypes,
  loadMapData,
  setPinnedNow,
  TITLE_Y,
  TITLE_FONT_SIZE,
  FRAME_INSET,
  FRAME_BODY_TOP,
  HERO_TITLE_TYPES,
} = await import(join(ROOT, 'dist', 'advanced.js'));
// Clock and countdown draw the current instant; pin it like the snapshots do.
setPinnedNow(Date.parse(NOW));

/** One source per chart type: its own gallery fixture, else the conformance one. */
function sourceFor(type) {
  const names = readdirSync(GALLERY).filter((f) => f.endsWith('.dgmo'));
  const pick =
    names.find((f) => f === `${type}.dgmo`) ??
    names.find(
      (f) => f.startsWith(`${type}-`) && firstWord(join(GALLERY, f)) === type
    );
  if (pick)
    return {
      file: `gallery/fixtures/${pick}`,
      text: readFileSync(join(GALLERY, pick), 'utf8'),
    };
  const conf = join(CONFORMANCE, `${type}.dgmo`);
  if (existsSync(conf))
    return {
      file: `tests/fixtures/conformance/${type}.dgmo`,
      text: readFileSync(conf, 'utf8'),
    };
  return null;
}

function firstWord(path) {
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .find((l) => l.trim() && !l.trim().startsWith('//'));
  return line?.trim().split(/\s+/)[0];
}

function viewBoxOf(svg) {
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) return null;
  const [x, y, w, h] = m[1].split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}

/** A transform attribute as a matrix [a b c d e f]. */
function matrixOf(t) {
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (q) => {
    const [a, b, c, d, e, f] = m;
    m = [
      a * q[0] + c * q[1],
      b * q[0] + d * q[1],
      a * q[2] + c * q[3],
      b * q[2] + d * q[3],
      a * q[4] + c * q[5] + e,
      b * q[4] + d * q[5] + f,
    ];
  };
  for (const [, fn, args] of (t ?? '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const n = args
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (fn === 'translate') mul([1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]);
    else if (fn === 'scale') mul([n[0], 0, 0, n[1] ?? n[0], 0, 0]);
    else if (fn === 'matrix') mul(n);
  }
  return m;
}

/** Where the title sits in root units, read back from the drawn SVG. */
function titleOf(svg) {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const el = doc.querySelector('text.chart-title');
  if (!el) return null;
  let m = [1, 0, 0, 1, 0, 0];
  const chain = [];
  for (let e = el; e && e.tagName !== 'svg'; e = e.parentElement)
    chain.unshift(e);
  for (const e of chain) {
    const q = matrixOf(e.getAttribute('transform'));
    const [a, b, c, d, ee, f] = m;
    m = [
      a * q[0] + c * q[1],
      b * q[0] + d * q[1],
      a * q[2] + c * q[3],
      b * q[2] + d * q[3],
      a * q[4] + c * q[5] + ee,
      b * q[4] + d * q[5] + f,
    ];
  }
  const x = Number(el.getAttribute('x') ?? 0);
  const y = Number(el.getAttribute('y') ?? 0);
  return {
    x: m[0] * x + m[4],
    y: m[3] * y + m[5],
    size:
      Math.round(Number(el.getAttribute('font-size') ?? 0) * m[3] * 100) / 100,
    anchor: el.getAttribute('text-anchor') ?? 'start',
  };
}

/** The band guides, drawn in the tile's own coordinates. */
function withGuides(svg, vb) {
  const x0 = vb.x + FRAME_INSET;
  const y0 = vb.y + TITLE_Y;
  const g =
    `<g pointer-events="none" opacity="0.7">` +
    `<line x1="${vb.x}" x2="${vb.x + vb.w}" y1="${y0}" y2="${y0}" stroke="#d33" stroke-width="1" stroke-dasharray="6 4"/>` +
    `<line x1="${x0}" x2="${x0}" y1="${vb.y}" y2="${vb.y + vb.h}" stroke="#d33" stroke-width="1" stroke-dasharray="6 4"/>` +
    `<line x1="${vb.x}" x2="${vb.x + vb.w}" y1="${vb.y + FRAME_BODY_TOP}" y2="${vb.y + FRAME_BODY_TOP}" stroke="#36c" stroke-width="1" stroke-dasharray="2 4"/>` +
    `</g>`;
  return svg.replace(/<\/svg>\s*$/, `${g}</svg>`);
}

// The title sits on the drawing's own left edge (#1838), so x varies by
// chart; what must hold everywhere is the baseline, the size, and that the
// title starts no closer than FRAME_INSET to the canvas edge.
function verdict(type, title, vb) {
  if (HERO_TITLE_TYPES.includes(type))
    return { ok: true, note: 'hero title — exempt' };
  if (!title) return { ok: true, note: 'no title' };
  const off = [];
  if (Math.abs(title.y - TITLE_Y) > 0.5) off.push(`y ${title.y}`);
  if (title.size !== TITLE_FONT_SIZE) off.push(`${title.size}px`);
  if (vb && title.anchor === 'start' && title.x < vb.x + FRAME_INSET - 0.5)
    off.push(`x ${title.x}`);
  return off.length
    ? { ok: false, note: `off band: ${off.join(', ')}` }
    : { ok: true, note: '' };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const tiles = [];
for (const { id: type } of chartTypes) {
  if (type === 'live-link') continue;
  const src = sourceFor(type);
  if (!src) {
    tiles.push({
      type,
      file: '—',
      cells: [],
      verdict: { ok: false, note: 'no fixture' },
    });
    continue;
  }
  const cells = [];
  let v = null;
  for (const theme of ['light', 'dark']) {
    try {
      const { svg } = await render(src.text, {
        theme,
        palette: 'nord',
        mapData: loadMapData,
      });
      const vb = viewBoxOf(svg);
      v ??= verdict(type, titleOf(svg), vb);
      cells.push({ theme, svg: vb ? withGuides(svg, vb) : svg });
    } catch (e) {
      cells.push({ theme, svg: `<pre>${esc(e.message)}</pre>` });
    }
  }
  tiles.push({
    type,
    file: src.file,
    cells,
    verdict: v ?? { ok: false, note: 'did not render' },
  });
}

const off = tiles.filter((t) => !t.verdict.ok);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dgmo contact sheet</title>
<style>
  body { font: 13px/1.4 Inter, system-ui, sans-serif; margin: 24px; background: #f4f5f7; color: #1f2933; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sum { margin: 0 0 20px; color: #5b6672; }
  .sum b.bad { color: #c33; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(560px, 1fr)); gap: 16px; }
  .tile { background: #fff; border: 1px solid #dde1e6; border-radius: 6px; padding: 10px; }
  .tile.bad { border-color: #d33; box-shadow: 0 0 0 1px #d33; }
  .head { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .head b { font-size: 14px; }
  .head span { color: #84898f; }
  .head .note { color: #c33; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .cell { border-radius: 4px; overflow: hidden; height: 220px; display: flex; align-items: flex-start; justify-content: center; }
  .cell.light { background: #fff; border: 1px solid #eceef2; }
  .cell.dark { background: #2e3440; }
  .cell svg { width: 100%; height: 100%; }
</style></head><body>
<h1>dgmo contact sheet</h1>
<p class="sum">${tiles.length} chart types · red dashes: title baseline (y ${TITLE_Y}); blue dots: where the drawing starts (y ${FRAME_BODY_TOP}) and the closest a part may come to the canvas edge (x ${FRAME_INSET}) ·
${off.length ? `<b class="bad">${off.length} off the band: ${off.map((t) => esc(t.type)).join(', ')}</b>` : '<b>all on the band</b>'}</p>
<div class="grid">
${tiles
  .map(
    (t) => `<div class="tile${t.verdict.ok ? '' : ' bad'}">
  <div class="head"><b>${esc(t.type)}</b><span class="${t.verdict.ok ? '' : 'note'}">${esc(t.verdict.note || t.file)}</span></div>
  <div class="pair">${t.cells.map((c) => `<div class="cell ${c.theme}">${c.svg}</div>`).join('')}</div>
</div>`
  )
  .join('\n')}
</div></body></html>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html);
console.log(
  `contact sheet: ${tiles.length} types, ${off.length} off the band → ${OUT}`
);
if (process.argv.includes('--open')) execFileSync('open', [OUT]);
