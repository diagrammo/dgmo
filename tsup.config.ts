import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    external: [],
  },
  {
    entry: ['src/cli.ts'],
    format: ['cjs'],
    dts: false,
    sourcemap: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
    external: [],
  },
]);
