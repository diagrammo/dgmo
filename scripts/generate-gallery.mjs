#!/usr/bin/env node

// ============================================================
// generate-gallery.mjs — Render all dgmo fixtures across
// palettes/themes/formats and produce a filterable HTML gallery.
// ============================================================

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// ============================================================
// Constants
// ============================================================

const CLI_PATH = join(ROOT, 'dist', 'cli.cjs');
const FIXTURES_DIR = join(ROOT, 'gallery', 'fixtures');
const OUTPUT_DIR = join(ROOT, 'gallery', 'output');
const RENDERS_DIR = join(OUTPUT_DIR, 'renders');

const PALETTES = [
  'nord', 'solarized', 'catppuccin', 'rose-pine',
  'gruvbox', 'tokyo-night', 'one-dark', 'bold',
];

const THEMES = ['light', 'dark', 'transparent'];
const FORMATS = ['svg', 'png'];

// ============================================================
// CLI argument parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { chart: null, palette: null, theme: null, format: null, concurrency: cpus().length };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--chart') { opts.chart = args[++i]; }
    else if (arg === '--palette') { opts.palette = args[++i]; }
    else if (arg === '--theme') { opts.theme = args[++i]; }
    else if (arg === '--format') { opts.format = args[++i]; }
    else if (arg === '--concurrency') { opts.concurrency = parseInt(args[++i], 10); }
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/generate-gallery.mjs [options]

Options:
  --chart <type>       Render only one chart type (e.g. bar, sequence)
  --palette <name>     Render only one palette (e.g. nord, catppuccin)
  --theme <name>       Render only one theme (light, dark, transparent)
  --format <ext>       Render only one format (svg, png)
  --concurrency <n>    Max concurrent renders (default: CPU count)
  --help               Show this help`);
      process.exit(0);
    }
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
    i++;
  }
  return opts;
}

// ============================================================
// Discover fixtures
// ============================================================

function discoverFixtures(filterChart) {
  if (!existsSync(FIXTURES_DIR)) {
    console.error(`Error: Fixtures directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(FIXTURES_DIR)
    .filter(f => extname(f) === '.dgmo')
    .sort();

  if (files.length === 0) {
    console.error('Error: No .dgmo fixtures found in gallery/fixtures/');
    process.exit(1);
  }

  if (filterChart) {
    const filtered = files.filter(f => basename(f, '.dgmo') === filterChart);
    if (filtered.length === 0) {
      console.error(`Error: No fixture found for chart type "${filterChart}"`);
      console.error(`Available: ${files.map(f => basename(f, '.dgmo')).join(', ')}`);
      process.exit(1);
    }
    return filtered;
  }
  return files;
}

// ============================================================
// Build render matrix
// ============================================================

function buildMatrix(fixtures, opts) {
  const palettes = opts.palette ? [opts.palette] : PALETTES;
  const themes = opts.theme ? [opts.theme] : THEMES;
  const formats = opts.format ? [opts.format] : FORMATS;
  const tasks = [];

  for (const file of fixtures) {
    const chart = basename(file, '.dgmo');
    for (const palette of palettes) {
      for (const theme of themes) {
        for (const format of formats) {
          const outName = `${chart}_${palette}_${theme}.${format}`;
          tasks.push({
            chart,
            palette,
            theme,
            format,
            fixturePath: join(FIXTURES_DIR, file),
            outputPath: join(RENDERS_DIR, outName),
            outName,
          });
        }
      }
    }
  }
  return tasks;
}

// ============================================================
// Render a single fixture via CLI child process
// ============================================================

function renderOne(task) {
  return new Promise((res) => {
    const args = [
      CLI_PATH,
      task.fixturePath,
      '--palette', task.palette,
      '--theme', task.theme,
      '-o', task.outputPath,
    ];

    execFile('node', args, { timeout: 30_000 }, (err, _stdout, stderr) => {
      if (err) {
        res({ ...task, ok: false, error: stderr || err.message });
      } else {
        res({ ...task, ok: true });
      }
    });
  });
}

// ============================================================
// Concurrent pool runner
// ============================================================

async function runPool(tasks, concurrency, onProgress) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      const result = await renderOne(tasks[i]);
      results.push(result);
      onProgress(results.length, tasks.length, result);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ============================================================
// HTML gallery generation
// ============================================================

function generateHTML(results) {
  const successful = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  // Collect unique values for filters
  const charts = [...new Set(successful.map(r => r.chart))].sort();
  const palettes = [...new Set(successful.map(r => r.palette))].sort();
  const themes = [...new Set(successful.map(r => r.theme))];
  const formats = [...new Set(successful.map(r => r.format))];

  function optionsHTML(label, values) {
    return `<option value="all">${label}: All</option>\n` +
      values.map(v => `          <option value="${v}">${v}</option>`).join('\n');
  }

  function bgClass(theme) {
    if (theme === 'light') return 'bg-light';
    if (theme === 'dark') return 'bg-dark';
    return 'bg-checker';
  }

  const cards = successful.map(r => {
    return `      <div class="card" data-chart="${r.chart}" data-palette="${r.palette}" data-theme="${r.theme}" data-format="${r.format}">
        <div class="card-img ${bgClass(r.theme)}">
          <img src="renders/${r.outName}" loading="lazy" alt="${r.chart} ${r.palette} ${r.theme} ${r.format}" />
        </div>
        <div class="card-meta">
          <span class="tag tag-chart">${r.chart}</span>
          <span class="tag tag-palette">${r.palette}</span>
          <span class="tag tag-theme">${r.theme}</span>
          <span class="tag tag-format">${r.format}</span>
        </div>
      </div>`;
  }).join('\n');

  const failedSection = failed.length > 0 ? `
    <details class="errors">
      <summary>${failed.length} render error${failed.length > 1 ? 's' : ''}</summary>
      <ul>
        ${failed.map(r => `<li><code>${r.outName}</code>: ${escapeHTML(r.error || 'unknown error')}</li>`).join('\n        ')}
      </ul>
    </details>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>dgmo Gallery</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      padding: 24px;
    }

    header {
      text-align: center;
      margin-bottom: 24px;
    }
    header h1 { font-size: 1.6rem; margin-bottom: 4px; }
    header .subtitle { color: #8b949e; font-size: 0.9rem; }

    .filters {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 24px;
      align-items: center;
    }

    .filters select {
      background: #161b22;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .filters select:hover { border-color: #58a6ff; }

    .visible-count {
      color: #8b949e;
      font-size: 0.85rem;
    }

    .errors {
      background: #1c1208;
      border: 1px solid #5a3e0a;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 24px;
      font-size: 0.85rem;
    }
    .errors summary { cursor: pointer; color: #f0883e; font-weight: 600; }
    .errors ul { margin-top: 8px; padding-left: 20px; }
    .errors li { margin-bottom: 4px; }
    .errors code { background: #0d1117; padding: 2px 4px; border-radius: 3px; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .card:hover { border-color: #58a6ff; }
    .card[hidden] { display: none; }

    .card-img {
      width: 100%;
      aspect-ratio: 4 / 3;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: 8px;
    }
    .card-img {
      cursor: pointer;
    }
    .card-img img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0, 0, 0, 0.85);
      align-items: center;
      justify-content: center;
      padding: 32px;
    }
    .lightbox.open { display: flex; }

    .lightbox-content {
      position: relative;
      max-width: 90vw;
      max-height: 85vh;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .lightbox-content img {
      max-width: 90vw;
      max-height: 85vh;
      object-fit: contain;
    }
    .lightbox-content.bg-light { background: #ffffff; }
    .lightbox-content.bg-dark { background: #1a1a2e; }
    .lightbox-content.bg-checker {
      background-color: #ffffff;
      background-image:
        linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
        linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
        linear-gradient(-45deg, transparent 75%, #e0e0e0 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }

    .lightbox-meta {
      position: absolute;
      bottom: -36px;
      left: 0;
      display: flex;
      gap: 6px;
    }

    .lightbox-close {
      position: absolute;
      top: -36px;
      right: 0;
      background: none;
      border: none;
      color: #8b949e;
      font-size: 0.85rem;
      cursor: pointer;
      padding: 4px 8px;
    }
    .lightbox-close:hover { color: #e6edf3; }

    .lightbox-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.15);
      color: #e6edf3;
      font-size: 1.4rem;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .lightbox-nav:hover { background: rgba(255,255,255,0.2); }
    .lightbox-prev { left: -56px; }
    .lightbox-next { right: -56px; }

    .bg-light { background: #ffffff; }
    .bg-dark { background: #1a1a2e; }
    .bg-checker {
      background-color: #ffffff;
      background-image:
        linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
        linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
        linear-gradient(-45deg, transparent 75%, #e0e0e0 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }

    .card-meta {
      padding: 8px 10px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tag {
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 500;
    }
    .tag-chart { background: #1f3a5f; color: #79c0ff; }
    .tag-palette { background: #2a1f3f; color: #d2a8ff; }
    .tag-theme { background: #1f3f2a; color: #7ee787; }
    .tag-format { background: #3f2a1f; color: #ffa657; }
  </style>
</head>
<body>
  <header>
    <h1>dgmo Gallery</h1>
    <p class="subtitle">${successful.length} renders across ${charts.length} charts, ${palettes.length} palettes, ${themes.length} themes, ${formats.length} formats</p>
  </header>

  <div class="filters">
    <select id="f-chart">
      ${optionsHTML('Chart', charts)}
    </select>
    <select id="f-palette">
      ${optionsHTML('Palette', palettes)}
    </select>
    <select id="f-theme">
      ${optionsHTML('Theme', themes)}
    </select>
    <select id="f-format">
      ${optionsHTML('Format', formats)}
    </select>
    <span class="visible-count" id="count">${successful.length} visible</span>
  </div>
  ${failedSection}
  <div class="grid" id="grid">
${cards}
  </div>

  <div class="lightbox" id="lightbox">
    <div class="lightbox-content" id="lb-content">
      <button class="lightbox-nav lightbox-prev" id="lb-prev" aria-label="Previous">&#8249;</button>
      <img id="lb-img" src="" alt="" />
      <button class="lightbox-nav lightbox-next" id="lb-next" aria-label="Next">&#8250;</button>
      <button class="lightbox-close" id="lb-close">Esc to close</button>
      <div class="lightbox-meta" id="lb-meta"></div>
    </div>
  </div>

  <script>
    const selects = {
      chart: document.getElementById('f-chart'),
      palette: document.getElementById('f-palette'),
      theme: document.getElementById('f-theme'),
      format: document.getElementById('f-format'),
    };
    const countEl = document.getElementById('count');
    const cards = document.querySelectorAll('.card');

    function applyFilters() {
      const f = {};
      for (const [k, el] of Object.entries(selects)) f[k] = el.value;
      let visible = 0;
      for (const card of cards) {
        const show =
          (f.chart === 'all' || card.dataset.chart === f.chart) &&
          (f.palette === 'all' || card.dataset.palette === f.palette) &&
          (f.theme === 'all' || card.dataset.theme === f.theme) &&
          (f.format === 'all' || card.dataset.format === f.format);
        card.hidden = !show;
        if (show) visible++;
      }
      countEl.textContent = visible + ' visible';
      // Sync to URL
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) { if (v !== 'all') params.set(k, v); }
      const qs = params.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    }

    // Restore from URL on load
    const params = new URLSearchParams(location.search);
    for (const [k, el] of Object.entries(selects)) {
      const v = params.get(k);
      if (v) { el.value = v; }
    }

    for (const el of Object.values(selects)) el.addEventListener('change', applyFilters);
    applyFilters();

    // Lightbox
    const lightbox = document.getElementById('lightbox');
    const lbContent = document.getElementById('lb-content');
    const lbImg = document.getElementById('lb-img');
    const lbMeta = document.getElementById('lb-meta');
    const lbClose = document.getElementById('lb-close');
    const lbPrev = document.getElementById('lb-prev');
    const lbNext = document.getElementById('lb-next');
    let currentIdx = -1;

    function visibleCards() {
      return [...cards].filter(c => !c.hidden);
    }

    function openLightbox(card) {
      const img = card.querySelector('img');
      const bgEl = card.querySelector('.card-img');
      const bg = bgEl.classList.contains('bg-dark') ? 'bg-dark'
        : bgEl.classList.contains('bg-checker') ? 'bg-checker' : 'bg-light';
      lbContent.className = 'lightbox-content ' + bg;
      lbImg.src = img.src;
      lbImg.alt = img.alt;
      lbMeta.innerHTML = card.querySelector('.card-meta').innerHTML;
      currentIdx = visibleCards().indexOf(card);
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
      currentIdx = -1;
    }

    function navigate(delta) {
      const vc = visibleCards();
      if (vc.length === 0) return;
      currentIdx = (currentIdx + delta + vc.length) % vc.length;
      openLightbox(vc[currentIdx]);
    }

    document.getElementById('grid').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      openLightbox(card);
    });

    lbClose.addEventListener('click', closeLightbox);
    lbPrev.addEventListener('click', () => navigate(-1));
    lbNext.addEventListener('click', () => navigate(1));

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') navigate(-1);
      else if (e.key === 'ArrowRight') navigate(1);
    });
  </script>
</body>
</html>`;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// Main
// ============================================================

async function main() {
  const opts = parseArgs();

  // Verify CLI is built
  if (!existsSync(CLI_PATH)) {
    console.error(`Error: CLI not built. Run "pnpm build" first.`);
    console.error(`Expected: ${CLI_PATH}`);
    process.exit(1);
  }

  // Discover fixtures
  const fixtures = discoverFixtures(opts.chart);
  console.log(`Found ${fixtures.length} fixture(s): ${fixtures.map(f => basename(f, '.dgmo')).join(', ')}`);

  // Build matrix
  const tasks = buildMatrix(fixtures, opts);
  console.log(`Render matrix: ${tasks.length} total (${fixtures.length} charts x ${(opts.palette ? 1 : PALETTES.length)} palettes x ${(opts.theme ? 1 : THEMES.length)} themes x ${(opts.format ? 1 : FORMATS.length)} formats)`);
  console.log(`Concurrency: ${opts.concurrency}`);
  console.log('');

  // Create output dirs
  mkdirSync(RENDERS_DIR, { recursive: true });

  // Render
  const startTime = Date.now();
  const results = await runPool(tasks, opts.concurrency, (done, total, result) => {
    const status = result.ok ? '' : ' FAILED';
    const pct = Math.round((done / total) * 100);
    process.stdout.write(`\r  [${done}/${total}] ${pct}% ${result.outName}${status}${''.padEnd(20)}`);
  });
  process.stdout.write('\r' + ''.padEnd(80) + '\r');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;

  // Generate HTML
  const html = generateHTML(results);
  const htmlPath = join(OUTPUT_DIR, 'index.html');
  writeFileSync(htmlPath, html, 'utf-8');

  // Summary
  console.log(`Done in ${elapsed}s`);
  console.log(`  Rendered: ${ok}/${results.length}`);
  if (fail > 0) {
    console.log(`  Failed:   ${fail}`);
    const failures = results.filter(r => !r.ok);
    for (const f of failures.slice(0, 10)) {
      console.log(`    - ${f.outName}: ${(f.error || 'unknown').split('\n')[0]}`);
    }
    if (failures.length > 10) console.log(`    ... and ${failures.length - 10} more`);
  }
  console.log(`  Gallery:  ${htmlPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
