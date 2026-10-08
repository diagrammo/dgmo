#!/usr/bin/env node

// ============================================================
// layout-compare.mjs — render one corpus at two dgmo refs and write one HTML
// page: before (left) and after (right) per diagram, with crossings and the
// layout search's total badness under each (#1135). Built for judging a
// layout change by eye; reused by later layout work (#1136).
//
//   node scripts/layout-compare.mjs \
//     [--base main] [--head WORKTREE] [--type boxes-and-lines] \
//     [--corpus <dir>]... [--palette nord] [--theme light] [--out <file>]
//
// --head WORKTREE (the default) means this checkout as it stands, uncommitted
// edits included. Any other ref is checked out detached under
// node_modules/.cache/layout-compare/ and shares this checkout's node_modules.
// --corpus is repeatable; gallery/fixtures is always included. A file is in
// the corpus when its first non-blank line starts with --type, and any path
// containing `_defunct/` is skipped.
//
// Badness is the search's own sum — true spline crossings + overlap runs +
// node pierces + group overlaps — scored on parse + layoutBoxesAndLines with
// default options, which is what an export lays out.
// ============================================================

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const CACHE = join(ROOT, 'node_modules', '.cache', 'layout-compare');

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'main' },
    head: { type: 'string', default: 'WORKTREE' },
    type: { type: 'string', default: 'boxes-and-lines' },
    corpus: { type: 'string', multiple: true, default: [] },
    palette: { type: 'string', default: 'nord' },
    theme: { type: 'string', default: 'light' },
    out: { type: 'string', default: join(CACHE, 'compare.html') },
  },
});

const git = (...args) =>
  execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();

/** A source tree for `ref`: this checkout, or a detached worktree of it. */
function treeFor(ref) {
  if (ref === 'WORKTREE') return { dir: ROOT, label: 'working tree' };
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
  const dir = join(CACHE, `tree-${sha.slice(0, 12)}`);
  if (!existsSync(dir)) {
    mkdirSync(CACHE, { recursive: true });
    git('worktree', 'add', '--detach', dir, sha);
  }
  if (!existsSync(join(dir, 'node_modules')))
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return { dir, label: `${ref} (${sha.slice(0, 8)})`, worktree: true };
}

const ENTRY = `
export { render } from './src/render';
export { parseBoxesAndLines } from './src/boxes-and-lines/parser';
export { layoutBoxesAndLines } from './src/boxes-and-lines/layout';
export {
  countSplineCrossings,
  countEdgeOverlaps,
  countEdgeNodePierces,
  countGroupOverlaps,
} from './src/boxes-and-lines/layout-search';
export { getPalette } from './src/palettes';
`;

/** Bundle the tree's sources once and import them. */
async function load(tree, tag) {
  const entry = join(tree.dir, `.layout-compare-entry.ts`);
  const outfile = join(CACHE, `bundle-${tag}.mjs`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(entry, ENTRY);
  try {
    execFileSync(
      join(ROOT, 'node_modules', '.bin', 'esbuild'),
      [
        entry,
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--packages=external',
        '--log-level=error',
        `--outfile=${outfile}`,
      ],
      { cwd: tree.dir, stdio: 'inherit' }
    );
  } finally {
    rmSync(entry, { force: true });
  }
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p, out);
    } else if (e.name.endsWith('.dgmo')) out.push(p);
  }
  return out;
}

function corpus() {
  const dirs = [join(ROOT, 'gallery', 'fixtures'), ...values.corpus];
  const files = [];
  for (const d of dirs)
    for (const f of walk(resolve(d))) {
      if (f.includes(`${'/'}_defunct/`)) continue;
      const first = readFileSync(f, 'utf8')
        .split('\n')
        .find((l) => l.trim());
      if (first?.trim().startsWith(values.type)) files.push({ dir: d, f });
    }
  return files;
}

async function score(lib, content) {
  const parsed = lib.parseBoxesAndLines(content);
  const lay = await lib.layoutBoxesAndLines(parsed);
  const x = lib.countSplineCrossings(lay);
  return {
    crossings: x,
    badness:
      x +
      lib.countEdgeOverlaps(lay) +
      lib.countEdgeNodePierces(lay) +
      lib.countGroupOverlaps(lay),
  };
}

async function svgOf(lib, content) {
  const res = await lib.render(content, {
    theme: values.theme,
    palette: values.palette,
  });
  return typeof res === 'string' ? res : res.svg;
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );

async function main() {
  const base = treeFor(values.base);
  const head = treeFor(values.head);
  const [a, b] = [await load(base, 'base'), await load(head, 'head')];
  const rows = [];
  let identical = 0;
  for (const { dir, f } of corpus()) {
    const content = readFileSync(f, 'utf8');
    const name = relative(resolve(dir), f) || basename(f);
    try {
      const [sa, sb] = [await svgOf(a, content), await svgOf(b, content)];
      if (sa === sb) {
        identical++;
        continue;
      }
      const [ka, kb] = [await score(a, content), await score(b, content)];
      rows.push({ name, sa, sb, ka, kb, delta: kb.badness - ka.badness });
    } catch (err) {
      rows.push({ name, error: String(err?.message ?? err) });
    }
  }
  rows.sort((r, s) => Math.abs(s.delta ?? 0) - Math.abs(r.delta ?? 0) || 0);
  const scored = rows.filter((r) => !r.error);
  const sum = (k, side) => scored.reduce((t, r) => t + r[side][k], 0);
  const worse = scored.filter((r) => r.delta > 0).length;
  const summary =
    `${scored.length} changed, ${identical} byte-identical left out` +
    (rows.length > scored.length
      ? `, ${rows.length - scored.length} failed to render`
      : '') +
    `. Total badness ${sum('badness', 'ka')} → ${sum('badness', 'kb')}, ` +
    `crossings ${sum('crossings', 'ka')} → ${sum('crossings', 'kb')}; ` +
    `${worse} diagram(s) worse.`;
  const card = (r) =>
    r.error
      ? `<section><h2>${esc(r.name)}</h2><p class="err">${esc(r.error)}</p></section>`
      : `<section><h2>${esc(r.name)} <small>badness ${r.ka.badness} → ${r.kb.badness} (${r.delta > 0 ? '+' : ''}${r.delta})</small></h2>
<div class="pair"><figure>${r.sa}<figcaption>before — ${r.ka.crossings} crossings, badness ${r.ka.badness}</figcaption></figure>
<figure>${r.sb}<figcaption>after — ${r.kb.crossings} crossings, badness ${r.kb.badness}</figcaption></figure></div></section>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Layout compare</title>
<style>body{font:14px system-ui;margin:24px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
figure{margin:0;border:1px solid #ccc;padding:8px;overflow:auto}figure svg{max-width:100%;height:auto}
figcaption{margin-top:6px;color:#444}h2 small{font-weight:400;color:#666}.err{color:#b00}</style>
<h1>Layout compare — ${esc(values.type)}</h1>
<p>Before: ${esc(base.label)}. After: ${esc(head.label)}. Palette ${esc(values.palette)}, theme ${esc(values.theme)}.</p>
<p><strong>${esc(summary)}</strong></p>
${rows.map(card).join('\n')}`;
  mkdirSync(resolve(values.out, '..'), { recursive: true });
  writeFileSync(values.out, html);
  console.log(summary);
  console.log(`wrote ${values.out}`);
  for (const r of scored)
    console.log(`${r.delta > 0 ? '+' : ''}${r.delta}\t${r.name}`);
}

await main();
