#!/usr/bin/env node

// ============================================================
// generate-examples-gallery.mjs — Render every dgmo-content example
// across all palettes and themes (light/dark), with a tint vs.
// solid-fill comparison for flowchart + state. Writes SVGs and an
// HTML index for review.
// ============================================================

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DGMO_ROOT = resolve(__dirname, '..');
const WORKSPACE_ROOT = resolve(DGMO_ROOT, '..');

const CLI_PATH = join(DGMO_ROOT, 'cli', 'dist', 'cli.cjs');
const EXAMPLES_DIR = join(WORKSPACE_ROOT, 'dgmo-content', 'examples');
const OUT_DIR = join(WORKSPACE_ROOT, '_bmad-output', 'galleries', 'dgmo-examples');
const RENDERS_DIR = join(OUT_DIR, 'renders');

const PALETTES = [
  'slate', 'atlas', 'blueprint', 'tidewater',
  'nord', 'catppuccin', 'tokyo-night',
];
const THEMES = ['light', 'dark'];

// Fixtures excluded from rendering. Each entry MUST cite the reason.
// Mirrors the SKIP map in gallery-snapshot.mjs for consistency.
const SKIP = new Map([
  ['business/wordcloud.dgmo', 'requires canvas npm package — render fails in jsdom'],
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    concurrency: cpus().length,
    filter: null,
    fresh: false,
    htmlOnly: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--concurrency') opts.concurrency = parseInt(args[++i], 10);
    else if (a === '--filter') opts.filter = args[++i];
    else if (a === '--fresh') opts.fresh = true;
    else if (a === '--html-only') opts.htmlOnly = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/generate-examples-gallery.mjs [options]

Renders every example in ${relative(WORKSPACE_ROOT, EXAMPLES_DIR)} across
${PALETTES.length} palettes × ${THEMES.length} themes. Flowchart + state
examples also get a solid-fill variant. Output: ${relative(WORKSPACE_ROOT, OUT_DIR)}/

Options:
  --filter <substr>    Only fixtures whose relative path contains substr
  --concurrency <n>    Max concurrent renders (default: CPU count)
  --fresh              Wipe the renders directory before starting
  --html-only          Skip rendering, regenerate index.html from existing SVGs
  --help, -h           Show this help`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return opts;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (entry.endsWith('.dgmo')) yield full;
  }
}

// First non-empty, non-comment line decides the chart type for the
// solid-fill gating. Mirrors how dgmo-router dispatches.
function detectChartType(filePath) {
  const text = readFileSync(filePath, 'utf8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    return line.split(/\s+/)[0].toLowerCase();
  }
  return '';
}

// Inject "solid-fill" as a bare-keyword option. Parsers vary in
// where they tolerate this — flowchart accepts it on line 2; venn
// (which counts top-line tokens) rejects line-2 injection; some
// parsers only honor it at the end of the option scan window.
// Returns two candidates so the renderer can try top-first and
// fall back to end-injection on parse failure.
function injectSolidFillTop(text) {
  const lines = text.split('\n');
  let inserted = false;
  const out = [];
  for (const line of lines) {
    out.push(line);
    if (!inserted && line.trim() && !line.trim().startsWith('//')) {
      out.push('solid-fill');
      inserted = true;
    }
  }
  return out.join('\n');
}

function injectSolidFillEnd(text) {
  return text.replace(/\s*$/, '\n\nsolid-fill\n');
}

// Detect fixtures that use sibling-relative directives (`import foo.dgmo` /
// `tags foo.dgmo`). For those, the solid-fill temp file MUST live in the
// same directory as the source — otherwise relative path resolution breaks
// and imported nodes get silently dropped.
function hasRelativeImports(text) {
  return /^[ \t]*(?:import|tags)\s*:?\s+\S+\.dgmo\s*$/im.test(text);
}

function renderOne({ inputPath, outputPath, palette, theme }) {
  return new Promise((res) => {
    mkdirSync(dirname(outputPath), { recursive: true });
    const args = [
      CLI_PATH,
      inputPath,
      '--palette', palette,
      '--theme', theme,
      '-o', outputPath,
    ];
    execFile('node', args, { timeout: 30_000 }, (err, _stdout, stderr) => {
      if (err) res({ ok: false, error: (stderr || err.message).split('\n')[0] });
      else res({ ok: true });
    });
  });
}

// For solid-fill renders: try the top-inject source first, fall back
// to the end-inject source if the parser rejected the top form.
async function renderSolid({ topPath, endPath, outputPath, palette, theme }) {
  const first = await renderOne({ inputPath: topPath, outputPath, palette, theme });
  if (first.ok) return first;
  return renderOne({ inputPath: endPath, outputPath, palette, theme });
}

async function runPool(items, concurrency, worker) {
  const out = [];
  let idx = 0;
  async function loop() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => loop())
  );
  return out;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderIndexHtml({ examples, palettes, themes, generatedAt }) {
  const palOptions = palettes.map((p) => `<option value="${p}">${p}</option>`).join('');
  const styles = `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
           margin: 0; background: #0e1116; color: #e6edf3; }
    header { position: sticky; top: 0; background: #161b22; border-bottom: 1px solid #30363d;
             padding: 12px 20px; z-index: 10; display: flex; gap: 16px; align-items: center;
             flex-wrap: wrap; }
    header h1 { margin: 0; font-size: 16px; font-weight: 600; }
    header .meta { color: #8b949e; font-size: 12px; }
    header label { font-size: 12px; color: #8b949e; }
    header select, header input { background: #0d1117; color: #e6edf3; border: 1px solid #30363d;
                                  border-radius: 6px; padding: 4px 8px; font-size: 12px; }
    .toc { padding: 12px 20px; background: #161b22; border-bottom: 1px solid #30363d;
           display: flex; flex-wrap: wrap; gap: 8px; max-height: 180px; overflow-y: auto; }
    .toc a { color: #58a6ff; text-decoration: none; font-size: 12px;
             padding: 2px 8px; border: 1px solid #30363d; border-radius: 12px; white-space: nowrap; }
    .toc a:hover { background: #1f6feb; color: white; border-color: #1f6feb; }
    .example { padding: 24px 20px; border-bottom: 1px solid #21262d; }
    .example h2 { margin: 0 0 4px 0; font-size: 18px; }
    .example .path { color: #8b949e; font-size: 12px; font-family: ui-monospace, SFMono-Regular,
                     "SF Mono", Menlo, Consolas, monospace; margin-bottom: 12px; }
    .grid { display: grid; gap: 12px;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .cell { background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
    .cell .label { padding: 6px 10px; font-size: 11px; color: #8b949e;
                   border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; }
    .cell .label .variant { color: #f78166; font-weight: 600; }
    .cell .image { padding: 8px; display: flex; justify-content: center; align-items: center;
                   min-height: 120px; }
    .cell.theme-light .image { background: #f6f8fa; }
    .cell.theme-dark .image { background: #0d1117; }
    .cell img { max-width: 100%; height: auto; display: block; }
    .cell.error .image { color: #f85149; font-size: 12px; padding: 16px; text-align: center; }
    .variant-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
    .variant-pair .image { min-height: 80px; }
    .variant-pair .sub { border-right: 1px solid #30363d; }
    .variant-pair .sub:last-child { border-right: none; }
    .variant-pair .sublabel { padding: 4px 6px; font-size: 10px; color: #8b949e;
                              text-align: center; border-bottom: 1px solid #30363d;
                              background: rgba(255,255,255,0.02); }
    .cell .image img { cursor: zoom-in; }
    .cell .label { cursor: zoom-in; user-select: none; }
    .cell .label:hover { background: #1f6feb; color: white; }
    .hidden { display: none !important; }
    /* Lightbox */
    .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 100;
                display: none; flex-direction: column; align-items: center;
                justify-content: center; padding: 24px; }
    .lightbox.open { display: flex; }
    .lightbox.theme-light { background: rgba(246,248,250,0.97); }
    .lightbox.theme-dark { background: rgba(13,17,23,0.97); }
    .lightbox .frame { flex: 1; min-height: 0; max-width: 100%; width: 100%;
                       display: flex; align-items: center; justify-content: center;
                       overflow: auto; gap: 24px; }
    .lightbox .frame .pane { display: flex; flex-direction: column; align-items: center;
                              gap: 8px; max-height: 100%; min-width: 0; flex: 1; }
    .lightbox.single .frame .pane { flex: initial; max-width: 100%; }
    .lightbox .frame .pane .pane-label { color: #f78166; font-size: 12px;
                                          text-transform: uppercase; letter-spacing: 0.05em;
                                          font-weight: 600; }
    .lightbox .frame .pane img { max-width: 100%; max-height: calc(100vh - 160px);
                                  cursor: zoom-out;
                                  box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    .lightbox .caption { color: #e6edf3; padding: 12px 0 0; font-size: 13px;
                         font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
                         text-align: center; }
    .lightbox.theme-light .caption { color: #1f2328; }
    .lightbox.theme-light .frame .pane .pane-label { color: #b35a2a; }
    .lightbox .hint { color: #8b949e; font-size: 11px; margin-top: 4px; }
    .lightbox .close { position: absolute; top: 16px; right: 20px; color: #8b949e;
                       background: transparent; border: none; font-size: 24px; cursor: pointer;
                       line-height: 1; padding: 4px 10px; border-radius: 4px; }
    .lightbox .close:hover { background: rgba(255,255,255,0.1); color: #e6edf3; }
    .lightbox.theme-light .close:hover { background: rgba(0,0,0,0.06); color: #1f2328; }
  `.trim();

  const tocHtml = examples
    .map((e) => `<a href="#${e.id}">${escapeHtml(e.relPath)}</a>`)
    .join('');

  const exampleHtml = examples
    .map((ex) => {
      const cells = [];
      for (const palette of palettes) {
        for (const theme of themes) {
          const cellClass = `cell theme-${theme}`;
          if (ex.solidFill) {
            const baselineFile = ex.renders[`${palette}::${theme}::baseline`];
            const solidFile = ex.renders[`${palette}::${theme}::solid`];
            cells.push(`
              <div class="${cellClass}" data-palette="${palette}" data-theme="${theme}">
                <div class="label"><span>${palette} · ${theme}</span><span class="variant">tint vs solid</span></div>
                <div class="variant-pair">
                  <div class="sub">
                    <div class="sublabel">tint</div>
                    <div class="image">${baselineFile
                      ? `<img loading="lazy" src="${baselineFile}" alt="${palette} ${theme} tint">`
                      : '<span style="color:#f85149;font-size:11px">render error</span>'}</div>
                  </div>
                  <div class="sub">
                    <div class="sublabel">solid-fill</div>
                    <div class="image">${solidFile
                      ? `<img loading="lazy" src="${solidFile}" alt="${palette} ${theme} solid-fill">`
                      : '<span style="color:#f85149;font-size:11px">render error</span>'}</div>
                  </div>
                </div>
              </div>`);
          } else {
            const file = ex.renders[`${palette}::${theme}::baseline`];
            cells.push(`
              <div class="${cellClass}" data-palette="${palette}" data-theme="${theme}">
                <div class="label"><span>${palette} · ${theme}</span></div>
                <div class="image">${file
                  ? `<img loading="lazy" src="${file}" alt="${palette} ${theme}">`
                  : '<span style="color:#f85149;font-size:11px">render error</span>'}</div>
              </div>`);
          }
        }
      }
      return `
        <section class="example" id="${ex.id}" data-chart-type="${ex.chartType}">
          <h2>${escapeHtml(ex.relPath)}</h2>
          <div class="path">${escapeHtml(ex.chartType)}${ex.solidFill ? ' · solid-fill comparison' : ''}</div>
          <div class="grid">${cells.join('')}</div>
        </section>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>dgmo-examples gallery</title>
<style>${styles}</style>
</head>
<body>
<header>
  <h1>dgmo-examples gallery</h1>
  <span class="meta">${examples.length} examples · ${palettes.length} palettes × ${themes.length} themes · generated ${generatedAt}</span>
  <label>palette
    <select id="filter-palette">
      <option value="">all</option>
      ${palOptions}
    </select>
  </label>
  <label>theme
    <select id="filter-theme">
      <option value="">all</option>
      <option value="light">light</option>
      <option value="dark">dark</option>
    </select>
  </label>
  <label>fixture
    <input id="filter-fixture" type="search" placeholder="substring…" size="20">
  </label>
</header>
<nav class="toc">${tocHtml}</nav>
<main>${exampleHtml}</main>
<div class="lightbox" id="lightbox">
  <button class="close" id="lightbox-close" aria-label="Close">&times;</button>
  <div class="frame" id="lightbox-frame"></div>
  <div class="caption" id="lightbox-caption"></div>
  <div class="hint">click image or press Esc to close · ← / → walks cells in this row · click a cell label to view tint+solid side by side</div>
</div>
<script>
  const palSel = document.getElementById('filter-palette');
  const themeSel = document.getElementById('filter-theme');
  const fixInput = document.getElementById('filter-fixture');
  function applyFilters() {
    const pal = palSel.value;
    const theme = themeSel.value;
    const fix = fixInput.value.trim().toLowerCase();
    document.querySelectorAll('.cell').forEach((cell) => {
      const pMatch = !pal || cell.dataset.palette === pal;
      const tMatch = !theme || cell.dataset.theme === theme;
      cell.classList.toggle('hidden', !(pMatch && tMatch));
    });
    document.querySelectorAll('.example').forEach((sec) => {
      const titleMatch = !fix || sec.querySelector('h2').textContent.toLowerCase().includes(fix);
      sec.classList.toggle('hidden', !titleMatch);
    });
  }
  palSel.addEventListener('change', applyFilters);
  themeSel.addEventListener('change', applyFilters);
  fixInput.addEventListener('input', applyFilters);

  // ── Lightbox ────────────────────────────────────────────────
  // Two view modes:
  //   - SINGLE: one image (clicked from an <img>)
  //   - PAIR:   tint + solid-fill side by side (clicked from a cell's label)
  // Arrow keys walk through cells in the current section preserving mode.
  const lb = document.getElementById('lightbox');
  const lbFrame = document.getElementById('lightbox-frame');
  const lbCap = document.getElementById('lightbox-caption');
  let lbCells = [];      // [{cell, paneImages: [{src, label}], single: src, theme, palette}]
  let lbIdx = -1;
  let lbMode = 'single'; // 'single' | 'pair'
  let lbSingleSrc = '';

  function buildCellList(section) {
    const cells = [...section.querySelectorAll('.cell')];
    return cells.map((cell) => {
      const labelText = cell.querySelector('.label > span').textContent;
      const subs = [...cell.querySelectorAll('.sub')];
      let paneImages;
      if (subs.length) {
        paneImages = subs.map((sub) => {
          const img = sub.querySelector('img');
          return {
            src: img ? img.getAttribute('src') : null,
            label: sub.querySelector('.sublabel').textContent,
          };
        });
      } else {
        const img = cell.querySelector('img');
        paneImages = [{ src: img ? img.getAttribute('src') : null, label: 'baseline' }];
      }
      return {
        cell,
        labelText,
        sectionTitle: section.querySelector('h2').textContent,
        theme: cell.dataset.theme,
        palette: cell.dataset.palette,
        paneImages,
      };
    });
  }

  function show() {
    const item = lbCells[lbIdx];
    if (!item) return;
    lbFrame.innerHTML = '';
    let captionExtra = '';
    if (lbMode === 'pair' && item.paneImages.length > 1) {
      lb.classList.remove('single');
      for (const p of item.paneImages) {
        const pane = document.createElement('div');
        pane.className = 'pane';
        const lbl = document.createElement('div');
        lbl.className = 'pane-label';
        lbl.textContent = p.label;
        pane.appendChild(lbl);
        if (p.src) {
          const img = document.createElement('img');
          img.src = p.src;
          img.alt = p.label;
          pane.appendChild(img);
        } else {
          const miss = document.createElement('div');
          miss.style.color = '#f85149';
          miss.style.fontSize = '12px';
          miss.textContent = '(no render)';
          pane.appendChild(miss);
        }
        lbFrame.appendChild(pane);
      }
      captionExtra = ' — tint vs solid-fill';
    } else {
      lb.classList.add('single');
      const pane = document.createElement('div');
      pane.className = 'pane';
      const single = item.paneImages.find((p) => p.src === lbSingleSrc) || item.paneImages[0];
      if (item.paneImages.length > 1) {
        const lbl = document.createElement('div');
        lbl.className = 'pane-label';
        lbl.textContent = single.label;
        pane.appendChild(lbl);
        captionExtra = ' — ' + single.label;
      }
      if (single && single.src) {
        const img = document.createElement('img');
        img.src = single.src;
        img.alt = single.label;
        pane.appendChild(img);
      }
      lbFrame.appendChild(pane);
    }
    lbCap.textContent = item.sectionTitle + ' — ' + item.labelText + captionExtra;
    lb.classList.toggle('theme-light', item.theme === 'light');
    lb.classList.toggle('theme-dark', item.theme === 'dark');
  }

  function open() { lb.classList.add('open'); show(); }
  function close() {
    lb.classList.remove('open');
    lbFrame.innerHTML = '';
    lbCells = [];
    lbIdx = -1;
    lbSingleSrc = '';
  }
  function step(delta) {
    if (!lbCells.length) return;
    lbIdx = (lbIdx + delta + lbCells.length) % lbCells.length;
    // When walking in single mode across cells, anchor to the same
    // sub-variant (tint or solid) the user started with by label name.
    if (lbMode === 'single' && lbCells[lbIdx].paneImages.length > 1) {
      const wantLabel = (lbCells[lbIdx].paneImages.find((p) => p.src === lbSingleSrc)
        || lbCells[lbIdx].paneImages[0]).label;
      const match = lbCells[lbIdx].paneImages.find((p) => p.label === wantLabel);
      if (match) lbSingleSrc = match.src;
    }
    show();
  }

  // Image click → SINGLE mode focused on that image
  document.querySelectorAll('main img').forEach((img) => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      const section = img.closest('.example');
      const cell = img.closest('.cell');
      lbCells = buildCellList(section);
      lbIdx = lbCells.findIndex((c) => c.cell === cell);
      lbMode = 'single';
      lbSingleSrc = img.getAttribute('src');
      open();
    });
  });

  // Cell-label click → PAIR mode if the cell has both variants,
  // otherwise SINGLE mode on the only image present.
  document.querySelectorAll('.cell .label').forEach((label) => {
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      const cell = label.closest('.cell');
      const section = cell.closest('.example');
      lbCells = buildCellList(section);
      lbIdx = lbCells.findIndex((c) => c.cell === cell);
      lbMode = lbCells[lbIdx].paneImages.length > 1 ? 'pair' : 'single';
      lbSingleSrc = lbCells[lbIdx].paneImages[0].src || '';
      open();
    });
  });

  document.getElementById('lightbox-close').addEventListener('click', close);
  lb.addEventListener('click', (e) => {
    if (e.target === lb || e.target === lbFrame || e.target.tagName === 'IMG') close();
  });
  window.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  });
</script>
</body>
</html>`;
}

async function main() {
  const opts = parseArgs();

  if (!existsSync(CLI_PATH)) {
    console.error(`CLI not built. Run: pnpm --filter @diagrammo/dgmo build`);
    process.exit(1);
  }
  if (!existsSync(EXAMPLES_DIR)) {
    console.error(`Examples dir not found: ${EXAMPLES_DIR}`);
    process.exit(1);
  }

  if (opts.fresh && existsSync(RENDERS_DIR)) {
    if (opts.htmlOnly) {
      console.error('--fresh and --html-only are incompatible (--fresh wipes the renders that --html-only needs).');
      process.exit(1);
    }
    rmSync(RENDERS_DIR, { recursive: true, force: true });
  }
  mkdirSync(RENDERS_DIR, { recursive: true });

  const allFiles = [...walk(EXAMPLES_DIR)].sort();
  const skippedFiles = [];
  const examples = allFiles
    .filter((f) => !opts.filter || f.includes(opts.filter))
    .filter((f) => {
      const rel = relative(EXAMPLES_DIR, f);
      if (SKIP.has(rel)) {
        skippedFiles.push({ rel, reason: SKIP.get(rel) });
        return false;
      }
      return true;
    })
    .map((file) => {
      const relPath = relative(EXAMPLES_DIR, file);
      const id = relPath.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const chartType = detectChartType(file);
      // Inject solid-fill for every example. Chart types that don't
      // honor the option will produce identical baseline + solid SVGs
      // — that's a useful signal in itself, not a bug.
      const solidFill = true;
      return { file, relPath, id, chartType, solidFill, renders: {} };
    });
  if (skippedFiles.length) {
    for (const s of skippedFiles) console.log(`  skip ${s.rel} — ${s.reason}`);
  }

  if (examples.length === 0) {
    console.error('No examples matched.');
    process.exit(1);
  }

  // Pre-write both top- and end-inject solid-fill temp copies. The
  // renderer will try top-first and fall back to end if that fails.
  // Fixtures with sibling-relative `import`/`tags` directives need the
  // temp file co-located with the source so relative paths resolve.
  const tmpRoot = join(OUT_DIR, '.tmp-solid');
  const sourceCoLocatedTempFiles = []; // tracked for cleanup
  if (!opts.htmlOnly) {
    mkdirSync(tmpRoot, { recursive: true });
    for (const ex of examples) {
      if (!ex.solidFill) continue;
      const src = readFileSync(ex.file, 'utf8');
      if (hasRelativeImports(src)) {
        // Co-locate temp files next to the source so relative imports work.
        const sourceDir = dirname(ex.file);
        const baseName = ex.id;
        const topPath = join(sourceDir, `.gallery-${baseName}.top.dgmo`);
        const endPath = join(sourceDir, `.gallery-${baseName}.end.dgmo`);
        writeFileSync(topPath, injectSolidFillTop(src));
        writeFileSync(endPath, injectSolidFillEnd(src));
        ex.solidSourceTop = topPath;
        ex.solidSourceEnd = endPath;
        sourceCoLocatedTempFiles.push(topPath, endPath);
      } else {
        const topPath = join(tmpRoot, ex.id + '.top.dgmo');
        const endPath = join(tmpRoot, ex.id + '.end.dgmo');
        writeFileSync(topPath, injectSolidFillTop(src));
        writeFileSync(endPath, injectSolidFillEnd(src));
        ex.solidSourceTop = topPath;
        ex.solidSourceEnd = endPath;
      }
    }
  }

  // Build the render task list.
  const tasks = [];
  for (const ex of examples) {
    for (const palette of PALETTES) {
      for (const theme of THEMES) {
        const baselineRel = join(ex.id, `${palette}__${theme}__baseline.svg`);
        tasks.push({
          ex, palette, theme, variant: 'baseline',
          input: ex.file,
          output: join(RENDERS_DIR, baselineRel),
          relForHtml: `renders/${baselineRel}`,
        });
        if (ex.solidFill) {
          const solidRel = join(ex.id, `${palette}__${theme}__solid.svg`);
          tasks.push({
            ex, palette, theme, variant: 'solid',
            input: ex.solidSourceTop,
            inputFallback: ex.solidSourceEnd,
            output: join(RENDERS_DIR, solidRel),
            relForHtml: `renders/${solidRel}`,
          });
        }
      }
    }
  }

  if (opts.htmlOnly) {
    // Skip rendering — just walk existing SVGs and populate ex.renders
    // from disk so the index references whatever's there.
    let found = 0;
    for (const t of tasks) {
      if (existsSync(t.output)) {
        t.ex.renders[`${t.palette}::${t.theme}::${t.variant}`] = t.relForHtml;
        found++;
      }
    }
    console.log(`html-only: found ${found}/${tasks.length} existing SVGs on disk.`);
    const indexPath = join(OUT_DIR, 'index.html');
    const html = renderIndexHtml({
      examples,
      palettes: PALETTES,
      themes: THEMES,
      generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z',
    });
    writeFileSync(indexPath, html);
    console.log(`\nGallery: file://${indexPath}`);
    return;
  }

  console.log(`Rendering ${tasks.length} SVGs across ${examples.length} examples ` +
              `(${PALETTES.length} palettes × ${THEMES.length} themes` +
              `, +solid-fill for ${examples.filter(e => e.solidFill).length} examples)…`);
  const start = Date.now();
  let done = 0;
  const tick = setInterval(() => {
    process.stdout.write(`\r  ${done}/${tasks.length} rendered…`);
  }, 500);

  const results = await runPool(tasks, opts.concurrency, async (t) => {
    const r = t.inputFallback
      ? await renderSolid({
          topPath: t.input,
          endPath: t.inputFallback,
          outputPath: t.output,
          palette: t.palette,
          theme: t.theme,
        })
      : await renderOne({
          inputPath: t.input,
          outputPath: t.output,
          palette: t.palette,
          theme: t.theme,
        });
    done++;
    if (r.ok) {
      t.ex.renders[`${t.palette}::${t.theme}::${t.variant}`] = t.relForHtml;
      return { ok: true, t };
    }
    return { ok: false, t, error: r.error };
  });
  clearInterval(tick);
  process.stdout.write('\r');

  const errors = results.filter((r) => !r.ok);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Rendered ${results.length - errors.length}/${results.length} in ${elapsed}s`);

  if (errors.length) {
    console.log(`\n${errors.length} render error(s):`);
    for (const e of errors.slice(0, 50)) {
      console.log(`  - ${e.t.ex.relPath} [${e.t.palette}/${e.t.theme}/${e.t.variant}]: ${e.error}`);
    }
    if (errors.length > 50) console.log(`  …and ${errors.length - 50} more`);
  }

  const indexPath = join(OUT_DIR, 'index.html');
  const html = renderIndexHtml({
    examples,
    palettes: PALETTES,
    themes: THEMES,
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z',
  });
  writeFileSync(indexPath, html);
  console.log(`\nGallery: file://${indexPath}`);

  // Cleanup temp solid-fill sources.
  rmSync(tmpRoot, { recursive: true, force: true });
  for (const f of sourceCoLocatedTempFiles) {
    rmSync(f, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
