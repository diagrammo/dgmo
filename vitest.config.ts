import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
