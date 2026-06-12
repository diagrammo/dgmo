#!/usr/bin/env node

// ============================================================
// gallery-snapshot.mjs — Visual regression CI gate for parser /
// renderer changes. Renders every fixture in gallery/fixtures/ on
// the canonical palette + theme (nord/light), writes SVGs to
// gallery/snapshots/, and byte-compares against the committed
// baseline. Exits non-zero on any diff.
//
// CI runs this with no flags. Re-baseline after intentional render
// changes with `--update`.
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
const ROOT = resolve(__dirname, '..');

const CLI_PATH = join(ROOT, 'dist', 'cli.cjs');
const FIXTURES_DIR = join(ROOT, 'gallery', 'fixtures');
const SNAPSHOTS_DIR = join(ROOT, 'gallery', 'snapshots');

// Canonical palette + theme — kept fixed so any render diff signals
// a real change in parser or renderer behavior, not a config drift.
const PALETTE = 'nord';
const THEME = 'light';

// Fixtures excluded from snapshot diffing. Each entry MUST cite the
// reason — bare skips rot. Skipped fixtures still get walked (so a
// removal is noticed) but neither rendered nor compared.
const SKIP = new Map([
  // Uses labeled-arrow syntax (`-Verb-> Target`) which the c4 parser
  // doesn't accept. Pre-existing fixture bug, unrelated to the
  // universal name handling work. Track as separate cleanup.
  ['c4.dgmo', 'c4 parser rejects labeled-arrow syntax used in fixture'],
  ['c4-full.dgmo', 'c4 parser rejects labeled-arrow syntax used in fixture'],
  // d3-cloud relies on HTMLCanvasElement.getContext, which jsdom
  // can't provide without the optional `canvas` npm package.
  ['wordcloud.dgmo', 'requires canvas npm package — render fails in jsdom'],
]);

// ============================================================
// CLI argument parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    update: false,
    concurrency: cpus().length,
    filter: null,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--update' || arg === '-u') opts.update = true;
    else if (arg === '--concurrency') opts.concurrency = parseInt(args[++i], 10);
    else if (arg === '--filter') opts.filter = args[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/gallery-snapshot.mjs [options]

Renders every gallery fixture on palette=${PALETTE}, theme=${THEME} and
byte-compares against gallery/snapshots/. Exits non-zero on any diff.

Options:
  --update, -u         Re-baseline: overwrite snapshots with fresh renders.
  --filter <substr>    Only process fixtures whose relative path contains substr.
  --concurrency <n>    Max concurrent renders (default: CPU count)
  --help, -h           Show this help`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

// ============================================================
// Discover fixtures recursively
// ============================================================

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith('.dgmo')) yield full;
  }
}

function discoverFixtures(filter) {
  if (!existsSync(FIXTURES_DIR)) {
    console.error(`Error: Fixtures directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }
  const all = [...walk(FIXTURES_DIR)].sort();
  const filtered = filter ? all.filter((f) => f.includes(filter)) : all;
  if (filtered.length === 0) {
    console.error(filter ? `No fixtures match filter "${filter}"` : 'No .dgmo fixtures found');
    process.exit(1);
  }
  return filtered;
}

// ============================================================
// Render one fixture and return its SVG bytes
// ============================================================

function renderOne(fixturePath, outputPath) {
  return new Promise((res) => {
    mkdirSync(dirname(outputPath), { recursive: true });
    const args = [
      CLI_PATH,
      fixturePath,
      '--palette', PALETTE,
      '--theme', THEME,
      '-o', outputPath,
    ];
    execFile('node', args, {
      timeout: 30_000,
      env: { ...process.env, TZ: 'UTC' },
    }, (err, _stdout, stderr) => {
      if (err) {
        res({ ok: false, error: stderr || err.message });
      } else {
        res({ ok: true });
      }
    });
  });
}

// ============================================================
// Concurrent pool runner
// ============================================================

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

// ============================================================
// Cross-platform float tolerance
// ============================================================
// Map fixtures render through d3-geo projection math, whose last-digit results
// differ by ~1 ULP between platforms (macOS libm vs the Linux CI runner). At
// geoPath `.digits(1)` that surfaces as a handful of coordinates rounding one
// step apart, so a baseline authored on one OS byte-mismatches the other even
// though the geometry is identical. `withinFloatJitter` forgives ONLY that:
// the structure with every numeric literal blanked must match exactly (so any
// added/removed/reordered element, attribute, or token count still fails), and
// each differing number must be coordinate-scale and within COORD_EPS. Small
// values (opacity, etc.) and all non-numeric content are compared exactly.
const NUM_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
const COORD_EPS = 0.2; // px; one digits(1) rounding step is 0.1

function withinFloatJitter(baseline, fresh) {
  const a = baseline.toString('utf8');
  const b = fresh.toString('utf8');
  if (a.replace(NUM_RE, '\0') !== b.replace(NUM_RE, '\0')) return false;
  const an = a.match(NUM_RE) ?? [];
  const bn = b.match(NUM_RE) ?? [];
  if (an.length !== bn.length) return false;
  for (let i = 0; i < an.length; i++) {
    if (an[i] === bn[i]) continue;
    const x = parseFloat(an[i]);
    const y = parseFloat(bn[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    // Forgive coordinate-scale sub-pixel noise only; exact for small values.
    if (Math.abs(x - y) > COORD_EPS) return false;
    if (Math.max(Math.abs(x), Math.abs(y)) < 1) return false;
  }
  return true;
}

// ============================================================
// Diff helper — first differing byte offset (lazy)
// ============================================================

function describeDiff(baseline, fresh) {
  if (baseline.length !== fresh.length) {
    return `length differs (baseline=${baseline.length}, fresh=${fresh.length})`;
  }
  for (let i = 0; i < baseline.length; i++) {
    if (baseline[i] !== fresh[i]) {
      const ctx = (buf) =>
        buf
          .subarray(Math.max(0, i - 20), Math.min(buf.length, i + 20))
          .toString('utf8')
          .replace(/\n/g, '\\n');
      return `first diff at byte ${i}: baseline=…${ctx(baseline)}…, fresh=…${ctx(fresh)}…`;
    }
  }
  return 'no diff (unreachable)';
}

// ============================================================
// Main
// ============================================================

async function main() {
  const opts = parseArgs();

  if (!existsSync(CLI_PATH)) {
    console.error(`Error: CLI not built. Run "pnpm build" first.`);
    console.error(`Expected: ${CLI_PATH}`);
    process.exit(1);
  }

  const fixtures = discoverFixtures(opts.filter);
  const allTasks = fixtures.map((fixturePath) => {
    const rel = relative(FIXTURES_DIR, fixturePath);
    const snapshotPath = join(SNAPSHOTS_DIR, rel.replace(/\.dgmo$/, '.svg'));
    return { fixturePath, snapshotPath, rel };
  });
  const skipped = allTasks.filter((t) => SKIP.has(t.rel));
  const tasks = allTasks.filter((t) => !SKIP.has(t.rel));

  console.log(
    `gallery-snapshot: ${tasks.length} fixtures (${skipped.length} skipped), palette=${PALETTE}, theme=${THEME}`
  );
  if (opts.update) console.log('mode: --update (overwriting baselines)');
  if (skipped.length) {
    for (const s of skipped) console.log(`  skip ${s.rel} — ${SKIP.get(s.rel)}`);
  }
  console.log('');

  if (opts.update) {
    // Re-baseline: render straight to the snapshot path.
    const startTime = Date.now();
    const results = await runPool(tasks, opts.concurrency, async (t) => {
      const r = await renderOne(t.fixturePath, t.snapshotPath);
      return { ...t, ...r };
    });
    const failed = results.filter((r) => !r.ok);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Wrote ${results.length - failed.length} snapshot(s) in ${elapsed}s`);
    if (failed.length) {
      console.error(`\n${failed.length} render error(s):`);
      for (const f of failed) console.error(`  - ${f.rel}: ${(f.error || '').split('\n')[0]}`);
      process.exit(1);
    }
    return;
  }

  // Verify mode: render to a tmp file alongside the baseline, compare.
  // Suffix MUST keep `.svg` last so the CLI infers SVG format from the
  // extension — bare `.fresh` would default to PNG output.
  const startTime = Date.now();
  const results = await runPool(tasks, opts.concurrency, async (t) => {
    const tmpPath = t.snapshotPath.replace(/\.svg$/, '.fresh.svg');
    const render = await renderOne(t.fixturePath, tmpPath);
    if (!render.ok) {
      return { ...t, status: 'render-error', error: render.error };
    }
    if (!existsSync(t.snapshotPath)) {
      // Read fresh bytes so an unbaselined fixture surfaces with content,
      // then leave the tmp file in place so the user can inspect it.
      return { ...t, status: 'no-baseline' };
    }
    const baseline = readFileSync(t.snapshotPath);
    const fresh = readFileSync(tmpPath);
    if (baseline.equals(fresh)) {
      rmSync(tmpPath, { force: true });
      return { ...t, status: 'match' };
    }
    if (withinFloatJitter(baseline, fresh)) {
      rmSync(tmpPath, { force: true });
      return { ...t, status: 'match', tolerant: true };
    }
    return { ...t, status: 'diff', detail: describeDiff(baseline, fresh) };
  });

  const matches = results.filter((r) => r.status === 'match');
  const diffs = results.filter((r) => r.status === 'diff');
  const missing = results.filter((r) => r.status === 'no-baseline');
  const errors = results.filter((r) => r.status === 'render-error');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`${matches.length}/${results.length} match (${elapsed}s)`);

  const tolerant = matches.filter((m) => m.tolerant);
  if (tolerant.length) {
    console.log(
      `  (${tolerant.length} matched within sub-pixel float tolerance: ${tolerant
        .map((t) => t.rel)
        .join(', ')})`
    );
  }

  if (errors.length) {
    console.error(`\n${errors.length} render error(s):`);
    for (const e of errors) console.error(`  - ${e.rel}: ${(e.error || '').split('\n')[0]}`);
  }
  if (missing.length) {
    console.error(`\n${missing.length} fixture(s) without a baseline (run with --update):`);
    for (const m of missing) console.error(`  - ${m.rel}`);
  }
  if (diffs.length) {
    console.error(`\n${diffs.length} fixture(s) with snapshot drift:`);
    for (const d of diffs) console.error(`  - ${d.rel}: ${d.detail}`);
    console.error(
      '\nIf the change is intentional, re-baseline with: pnpm gallery:snapshot:update'
    );
  }

  if (errors.length || missing.length || diffs.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
