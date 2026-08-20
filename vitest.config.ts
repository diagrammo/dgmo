import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
    // Inherited by pool workers, which get their own process env.
    env: { TZ: 'UTC' },
    include: ['tests/**/*.test.ts'],
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
