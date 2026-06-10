import { defineConfig } from 'vitest/config';

// Dedicated config for the boxes-and-lines layout benchmark, so it stays out of
// the normal `pnpm test` run. Run with: pnpm bench:bl
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/bl-layout-bench.ts'],
  },
});
