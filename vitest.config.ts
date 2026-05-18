import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
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
