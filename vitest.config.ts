import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// ── A growth test is measured on a quiet machine: after the suite, one at a time ──
//
// A file that calls `measureGrowth` times two sizes and asserts the exponent.
// Run beside the rest of the suite, it times its sibling workers as well: the
// anchor gate failed three pushes in a row on 2026-11-24 on growth self-tests
// that pass alone (diagrammo/diagrammo#2301). The suite's own load is enough,
// so retries cannot fix it — every retry runs under the same load.
//
// Coverage distorts the exponent too, and not by load: v8 block counting read
// the arrival pass (#1890) at 2.57-2.60 on six of six quiet runs, against
// 2.00-2.04 without it, over a 2.5 limit. So `pnpm test` is two runs: the
// `unit` project with coverage, then the `growth` project without it, one
// file at a time. groupOrder keeps a bare `vitest run` in that order too.
//
// A file enrols by importing `./perf-helpers`, so a new growth test cannot
// land in the parallel group by forgetting a list.
const TESTS = fileURLToPath(new URL('./tests/', import.meta.url));
const GROWTH_FILES = readdirSync(TESTS)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) =>
    /from '\.\/perf-helpers'/.test(readFileSync(TESTS + f, 'utf8'))
  )
  .map((f) => `tests/${f}`);

// ── The suite is written in UTC, and now says so where it cannot be bypassed ──
//
// Dates are the one thing here whose CORRECT answer depends on the machine.
// `tests/countdown.test.ts` reasons in whole days and in wall-clock hours, so
// on a machine west of Greenwich a run picks up an off-by-one-day on nearly
// every assertion and a six-hour shift on the clock ones.
//
// 🔴 It used to be pinned only in the `test` script (`TZ=UTC vitest run`), which
// meant `npx vitest run` — what an editor's run button, a watch mode and any
// agent reaching past the script all do — produced **14 failures that look
// exactly like a broken rewrite**. It cost a session and an issue filed against
// innocent code (#377) before anyone checked the timezone. Setting it here
// makes the requirement travel with the tests instead of with the command.
//
// The scripts still carry `TZ=UTC` as well. That is deliberate belt-and-braces:
// this line runs at config load, and a future config that forgot it would fail
// loudly in CI rather than quietly on one laptop.
process.env.TZ = 'UTC';

export default defineConfig({
  resolve: {
    // Tests (and the script helpers they import, e.g. scripts/lib/fence-validate.mjs)
    // reference the package by its own name `@diagrammo/dgmo/advanced`, which resolves
    // to the built `dist/` via package exports. CI runs Test BEFORE Build, so dist does
    // not exist yet — alias the self-reference to source so vitest resolves it without a
    // build. The .mjs helpers keep the by-name import for standalone node runs (where
    // dist is present), so they cannot simply use a relative path.
    alias: [
      {
        find: /^@diagrammo\/dgmo\/advanced$/,
        replacement: fileURLToPath(
          new URL('./src/advanced.ts', import.meta.url)
        ),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    // ── A test deadline measures the machine, not the code ──
    //
    // vitest's `testTimeout` defaults to 5000 ms, and several renders here do
    // 5-9 seconds of real work. Ten agent sessions share this laptop, so spare
    // capacity is not a constant: under load those tests cross the default and
    // the pre-push gate refuses a push whose code is fine, with a failure set
    // that reshuffles every run. That is the shape of a race, not a defect.
    //
    // Nobody typed 5000, which is why the sweep that removed this repo's
    // wall-clock ASSERTIONS did not find it — a library default is a wall-clock
    // deadline wearing different clothes (#555).
    //
    // 🔴 120 s is not tuned to the observed margin, deliberately. A budget a
    // correct render can plausibly approach is not a safe test, it is an absent
    // one. This number exists only so a genuine HANG still fails, which is the
    // one use of a clock the workspace rule endorses.
    //
    // It was 30 s until 2026-11-24. The box-office-platform stress fixture
    // renders in 12-17 s beside a loaded suite on anchor's 8 cores, and timed
    // out at 30 s in the anchor gate — a correct render reaching the hang
    // guard, which is the case above (diagrammo/diagrammo#2301).
    testTimeout: 120_000,
    // Inherited by pool workers, which get their own process env.
    env: { TZ: 'UTC' },
    // `include` is per project, never here: `extends: true` CONCATENATES
    // arrays, so a root include would put every file in the growth project.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: GROWTH_FILES,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'growth',
          include: GROWTH_FILES,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Only instrument TS source — `src/**` also swept non-code assets
      // (e.g. src/map/data/README.md, *.json) which the v8 remapper then
      // tried to parse as JS and crashed the coverage report.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/cli.ts', // CLI exercised via E2E gallery, not unit tests
      ],
      reporter: ['text-summary'],
      // Floor set 2 pts below 2026-05-17 baseline to prevent regression.
      // Baseline: lines 80, statements 78, branches 69, functions 72.
      thresholds: {
        lines: 78,
        statements: 76,
        branches: 67,
        functions: 70,
      },
    },
  },
});
