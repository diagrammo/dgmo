#!/usr/bin/env node
// The pre-push gate's test step: run the tests a push can affect, not the whole suite (#2478).
//
// Measured 2026-11-27 by replaying the last 294 commits against per-file durations: the full
// suite on every push is 100% of test time, the tests a push's imports reach are 54% on
// average and 44% for a one-chart commit. The full suite, with the coverage floor, still runs
// on a clock: `test:full` in the root repo's scripts/nightly-gate.sh, 02:30 and 14:30 on anchor.
//
// Usage: node scripts/affected-tests.mjs <base-sha>      (in a checkout whose HEAD is the push)
//        DGMO_GATE_FULL_SUITE=1 forces the full suite (`pnpm test`).
//        DGMO_AFFECTED_DRY=1 prints the command instead of running it.
//
// The rules, in `plan()` below and tested in affected-tests.test.mjs:
//   - a root config file (package.json, the lockfile, a vitest/ts config, tests/setup*) → full
//   - code (src/**, tests/** .ts files, anything vitest imports) → `vitest related`, which walks
//     the import graph from the changed files to every test that reaches them
//   - any other file → also every test file whose text names it: its path, its basename, or its
//     top-level directory (docs/, stress/, gallery/, changelog.d/). Over-selects on purpose, since
//     vitest cannot see a test that reads a file with fs instead of importing it
//   - a changed file no test names (api-baseline/, .github/) runs nothing: other gate steps
//     own it (check-api, CI)
//   - no base, an unknown base or a failed diff → full. Nothing here can skip the suite silently.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FULL_TRIGGERS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^vitest[^/]*\.config\.[cm]?[jt]s$/,
  /^tsconfig[^/]*\.json$/,
  /^tests\/setup[^/]*$/,
  /^\.npmrc$/,
];

const CODE = /\.(m|c)?[jt]sx?$|\.json$/;

/** Decide what to run. `changed` are repo-relative paths; `tests` maps each test file to its text. */
export function plan(changed, tests) {
  const trigger = changed.find((f) => FULL_TRIGGERS.some((re) => re.test(f)));
  if (trigger) return { mode: 'full', reason: `${trigger} changed` };

  const related = [];
  const named = new Set();
  for (const f of changed) {
    if ((f.startsWith('src/') || f.startsWith('tests/')) && CODE.test(f)) {
      related.push(f);
      continue;
    }
    const base = f.split('/').pop();
    const top = f.includes('/') ? `${f.split('/')[0]}/` : f;
    for (const [t, text] of tests) {
      if (text.includes(f) || text.includes(base) || text.includes(top))
        named.add(t);
    }
    if (f.startsWith('src/') || f.startsWith('tests/')) related.push(f);
  }
  if (related.length === 0 && named.size === 0) {
    return {
      mode: 'none',
      reason: 'no changed file is code or named by a test',
    };
  }
  return { mode: 'related', files: [...new Set([...related, ...named])] };
}

function testFiles(dir = 'tests', out = new Map()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) testFiles(p, out);
    else if (/\.test\.[cm]?[jt]s$/.test(name))
      out.set(p, readFileSync(p, 'utf8'));
  }
  return out;
}

function changedSince(base) {
  const out = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.split('\n').filter(Boolean);
}

function run(cmd, args) {
  console.log(`affected-tests: ${cmd} ${args.join(' ')}`);
  if (process.env.DGMO_AFFECTED_DRY === '1') return 0;
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, TZ: 'UTC' },
  });
  return r.status ?? 1;
}

function main() {
  const base = process.argv[2];
  let p;
  if (process.env.DGMO_GATE_FULL_SUITE === '1')
    p = { mode: 'full', reason: 'DGMO_GATE_FULL_SUITE=1' };
  else if (!base) p = { mode: 'full', reason: 'no base commit given' };
  else {
    let changed;
    try {
      changed = changedSince(base);
    } catch {
      p = { mode: 'full', reason: `cannot diff against ${base}` };
    }
    if (!p) p = plan(changed, testFiles());
  }

  if (p.mode === 'full') {
    console.log(`affected-tests: full suite — ${p.reason}`);
    return run('pnpm', ['test']);
  }
  if (p.mode === 'none') {
    console.log(`affected-tests: no tests to run — ${p.reason}`);
    return 0;
  }
  // A deleted file cannot seed the import walk; its importers changed too and are in the list.
  const files = p.files.filter((f) => existsSync(f));
  if (files.length === 0) {
    console.log(
      'affected-tests: no tests to run — every changed file was deleted'
    );
    return 0;
  }
  console.log(
    `affected-tests: ${files.length} changed or named file(s); full suite runs nightly (test:full)`
  );
  return run('pnpm', [
    'exec',
    'vitest',
    'related',
    '--run',
    '--passWithNoTests',
    ...files,
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main());
