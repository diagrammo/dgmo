import { defineConfig } from 'vitest/config';

// Dedicated config for the boxes-and-lines layout benchmark, so it stays out of
// the normal `pnpm test` run. Run with: pnpm bench:bl
// Also hosts the stress corpus render stage (pnpm stress:render).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'tests/bl-layout-bench.ts',
      'tests/bl-collapse-bench.ts',
      'tests/bl-options.ts',
      'tests/bl-overlap-debug.ts',
      'tests/bl-gallery.ts',
      'tests/stress-render.ts',
    ],
    disableConsoleIntercept: true,
    testTimeout: 300_000,
  },
});
