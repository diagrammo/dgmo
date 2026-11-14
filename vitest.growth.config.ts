import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The render growth sweep (diagrammo/diagrammo#2025): every chart type's
// render cost at two sizes, asserting the growth exponent. NOT part of
// `pnpm test` — it runs in the nightly gate on anchor, never on a push from
// the shared laptop. Run: pnpm test:growth
process.env.TZ = 'UTC';

export default defineConfig({
  resolve: {
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
    env: { TZ: 'UTC' },
    include: ['tests/growth/**/*.growth.ts'],
    // One file, run serially: types measured side by side would load each
    // other's samples. The timeout only catches a hang.
    fileParallelism: false,
    testTimeout: 600_000,
    disableConsoleIntercept: true,
  },
});
