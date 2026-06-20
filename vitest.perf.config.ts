import { defineConfig } from 'vitest/config';

// Dedicated config for the BL-102 performance harness, so it stays out of the
// normal `pnpm test` run and the `bench:bl` layout bench. Run: pnpm bench:perf
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/perf-bench.ts'],
    disableConsoleIntercept: true,
    testTimeout: 300_000,
  },
});
