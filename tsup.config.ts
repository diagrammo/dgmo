import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';

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

/** Inline jsdom's default-stylesheet.css so it doesn't need fs at runtime. */
const inlineJsdomStylesheet: Plugin = {
  name: 'inline-jsdom-stylesheet',
  setup(build) {
    build.onLoad(
      { filter: /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]helpers[\\/]style-rules\.js$/ },
      async (args) => {
        const cssPath = resolve(
          dirname(args.path),
          '../../browser/default-stylesheet.css',
        );
        const css = await readFile(cssPath, 'utf8');
        let contents = await readFile(args.path, 'utf8');
        contents = contents.replace(
          /const defaultStyleSheet = fs\.readFileSync\(\s*path\.resolve\(__dirname,\s*"\.\.\/\.\.\/browser\/default-stylesheet\.css"\),\s*\{\s*encoding:\s*"utf-8"\s*\}\s*\);/,
          `const defaultStyleSheet = ${JSON.stringify(css)};`,
        );
        return { contents, loader: 'js' };
      },
    );
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
    external: ['jsdom'],
    esbuildPlugins: [fixJsdomXhrWorker],
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
    minify: true,
    esbuildPlugins: [fixJsdomXhrWorker, inlineJsdomStylesheet],
  },
]);
