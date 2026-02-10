import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';
import { readFile } from 'fs/promises';

/** Patch out jsdom's sync-XHR worker require.resolve (not needed by CLI). */
const fixJsdomXhrWorker: Plugin = {
  name: 'fix-jsdom-xhr-worker',
  setup(build) {
    build.onLoad({ filter: /XMLHttpRequest-impl\.js$/ }, async (args) => {
      const contents = (await readFile(args.path, 'utf8')).replace(
        'require.resolve("./xhr-sync-worker.js")',
        'null',
      );
      return { contents, loader: 'js' };
    });
  },
};

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
    noExternal: [/^(?!@resvg\/)/],
    external: ['@resvg/resvg-js'],
    esbuildPlugins: [fixJsdomXhrWorker],
  },
]);
