#!/usr/bin/env node
/* eslint-disable */
/**
 * Bundle-size regression guard (deterministic — gzip level 9, no timing).
 *
 * Sums the gzipped size of every published JavaScript file under dist/
 * (all *.js + *.cjs, excluding the static map-data/ assets) and fails if the
 * total has grown past the recorded baseline by more than `budget` bytes.
 *
 * Why the whole dist and not one entry: the package is code-split (0.47), so a
 * core regression lands in shared chunks and is re-bundled into the three
 * self-contained outputs (auto.js, element.js, cli.cjs). Summing everything
 * makes any real growth visible; a single entry file would hide it.
 *
 * Deterministic on purpose: gzip size is stable across machines, unlike
 * runtime-timing benches (which flake in CI). This is the 1.0 perf guard.
 *
 *   node scripts/check-bundle-size.cjs           # check (CI); exit 1 if over budget
 *   node scripts/check-bundle-size.cjs --update   # rebaseline to current sizes
 *
 * When an intended change legitimately grows the bundle (e.g. a new chart
 * type), run --update in the same PR so a human ratifies the increase.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repo = path.resolve(__dirname, '..');
const baselinePath = path.join(repo, '.bundle-baseline.json');
const distDir = path.join(repo, 'dist');

// Growth (bytes, gzip) allowed above the baseline before CI fails. ~60 KB
// absorbs normal churn; a whole chart-type's worth of growth trips it, which
// is the intended signal to inspect + rebaseline.
const DEFAULT_BUDGET = 61440;

function gzipLen(buf) {
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function fmt(bytes) {
  const sign = bytes < 0 ? '-' : '';
  const b = Math.abs(bytes);
  return `${sign}${(b / 1024).toFixed(1)} KB (${bytes.toLocaleString()} B)`;
}

/** All published JS files under dist/, excluding the static map-data assets. */
function collectJsFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'map-data') continue;
      out = out.concat(collectJsFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function measure() {
  if (!fs.existsSync(distDir)) {
    console.error('Missing dist/; run `pnpm build` first.');
    process.exit(1);
  }
  const files = collectJsFiles(distDir);
  if (files.length === 0) {
    console.error('No JS files under dist/; run `pnpm build` first.');
    process.exit(1);
  }
  let rawTotal = 0;
  let gzipTotal = 0;
  const per = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const gz = gzipLen(buf);
    rawTotal += buf.length;
    gzipTotal += gz;
    per.push({ name: path.relative(distDir, f), raw: buf.length, gzip: gz });
  }
  per.sort((a, b) => b.gzip - a.gzip);
  return { fileCount: files.length, rawTotal, gzipTotal, per };
}

function main() {
  const update = process.argv.includes('--update');
  const m = measure();

  console.log(
    `Bundle: ${m.fileCount} JS files, raw ${fmt(m.rawTotal)}, gzip ${fmt(
      m.gzipTotal
    )}`
  );
  console.log('Largest (gzip):');
  for (const e of m.per.slice(0, 6)) {
    console.log(`  ${e.name.padEnd(28)} ${fmt(e.gzip)}`);
  }

  if (update) {
    const baseline = {
      totalGzip: m.gzipTotal,
      totalRaw: m.rawTotal,
      fileCount: m.fileCount,
      budget: DEFAULT_BUDGET,
      measuredAt: new Date().toISOString().slice(0, 10),
      notes:
        'Sum of gzip(level 9) over all dist/**/*.{js,cjs} except map-data/. ' +
        'Regenerate with `pnpm check:size:update` after an intended size change.',
    };
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\nRebaselined → ${path.relative(repo, baselinePath)}`);
    console.log(`  totalGzip=${fmt(m.gzipTotal)} budget=${fmt(DEFAULT_BUDGET)}`);
    return;
  }

  if (!fs.existsSync(baselinePath)) {
    console.error(
      `\nMissing ${path.relative(repo, baselinePath)} — run ` +
        '`pnpm check:size:update` to create it.'
    );
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const budget = baseline.budget ?? DEFAULT_BUDGET;
  const delta = m.gzipTotal - baseline.totalGzip;

  console.log(
    `\nBaseline gzip ${fmt(baseline.totalGzip)} (measured ${
      baseline.measuredAt ?? '?'
    })`
  );
  console.log(`Delta ${delta >= 0 ? '+' : ''}${fmt(delta)} | budget ${fmt(budget)}`);

  if (delta > budget) {
    console.error(
      `\n✖ Bundle-size budget exceeded: +${fmt(delta)} > budget ${fmt(
        budget
      )}.\n  If this growth is intended, run \`pnpm check:size:update\` and commit ` +
        'the new .bundle-baseline.json in the same change.'
    );
    process.exit(1);
  }
  // A large shrink means the baseline is stale — nudge, don't fail.
  if (delta < -budget) {
    console.log(
      `\n✓ Within budget. (Bundle shrank ${fmt(
        -delta
      )} below baseline — consider \`pnpm check:size:update\` to tighten it.)`
    );
    return;
  }
  console.log('\n✓ Bundle size within budget.');
}

main();
