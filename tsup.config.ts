import { defineConfig, type Options } from 'tsup';
import type { Plugin } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json') as {
  version: string;
};

/**
 * Copy the committed `map` chart-type data assets (src/map/data/*.json) into
 * `dist/map-data/` so the renderer can lazy-load them from a dist-relative path
 * at runtime WITHOUT bundling the JSON into a JS chunk (which would defeat the
 * lazy-load + bloat the main bundle). Built by scripts/build-map-data.mjs.
 */
async function copyMapData(): Promise<void> {
  const srcDir = resolve('./src/map/data');
  const outDir = resolve('./dist/map-data');
  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch {
    return; // data not built yet — non-fatal for non-map builds
  }
  await mkdir(outDir, { recursive: true });
  for (const f of entries) {
    if (f.endsWith('.json')) {
      await copyFile(resolve(srcDir, f), resolve(outDir, f));
    }
  }
}

/**
 * After the auto IIFE builds, also emit `dist/auto.css` so strict-CSP
 * embedders can opt out of inline `<style>` injection by linking the CSS
 * file. The CSS literal lives in `src/auto/styles.ts` — we eval-import
 * the freshly-built ESM artifact so there's a single source of truth.
 */
async function emitAutoCss(): Promise<void> {
  // Use a regex-extract approach so we don't have to dynamic-import the
  // freshly-built ESM (which would also resolve d3/echarts side-effect
  // chains). The CSS literal is the only template string in styles.ts.
  const stylesPath = resolve('./src/auto/styles.ts');
  const stylesSource = await readFile(stylesPath, 'utf8');
  const m = stylesSource.match(
    /export const CSS:\s*string\s*=\s*`([\s\S]*?)`;\s*$/m
  );
  if (!m) {
    throw new Error(
      'tsup.config: failed to extract CSS literal from src/auto/styles.ts'
    );
  }
  // Strip leading newline to match how the CSS is consumed inline.
  const css = m[1].replace(/^\n/, '');
  await writeFile(resolve('./dist/auto.css'), css, 'utf8');
}

/** Patch out jsdom's sync-XHR worker require.resolve (not needed by CLI). */
const fixJsdomXhrWorker: Plugin = {
  name: 'fix-jsdom-xhr-worker',
  setup(build) {
    build.onLoad({ filter: /XMLHttpRequest-impl\.js$/ }, async (args) => {
      const contents = (await readFile(args.path, 'utf8')).replace(
        'require.resolve("./xhr-sync-worker.js")',
        'null'
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
      {
        filter:
          /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]css[\\/]helpers[\\/]computed-style\.js$/,
      },
      async (args) => {
        const cssPath = resolve(
          dirname(args.path),
          '../../../browser/default-stylesheet.css'
        );
        const css = await readFile(cssPath, 'utf8');
        let contents = await readFile(args.path, 'utf8');
        contents = contents.replace(
          /const defaultStyleSheet = fs\.readFileSync\(\s*path\.resolve\(__dirname,\s*"\.\.\/\.\.\/\.\.\/browser\/default-stylesheet\.css"\),\s*\{\s*encoding:\s*"utf-8"\s*\}\s*\);/,
          `const defaultStyleSheet = ${JSON.stringify(css)};`
        );
        return { contents, loader: 'js' };
      }
    );
  },
};

// Dev-only: after each watch rebuild, touch a sentinel file that the
// diagrammo-app Vite dev server watches, prompting it to restart and serve the
// fresh dgmo dist WITHOUT a manual app restart. Firing on onSuccess (once,
// post-build) avoids the mid-write parse-500 / flicker storm that made Vite
// watch the dist directly a bad idea. Gated on an env var the workspace `dev`
// script sets, so plain `pnpm build` / CI never write it.
//
// NOTE: `onSuccess` fires PER build config (~9 of them), so a single source
// edit touches this sentinel several times in a burst. The app-side Vite plugin
// (see dgmoDevReload in vite.base.config.ts) is responsible for coalescing
// those touches AND for waiting until every dist entry is fully written before
// restarting — so we deliberately keep this end dumb and just touch on success.
const DEV_RELOAD_SENTINEL = resolve('./.vite-reload');
async function touchDevReload(): Promise<void> {
  if (!process.env.DGMO_DEV_RELOAD) return;
  try {
    await writeFile(DEV_RELOAD_SENTINEL, String(Date.now()), 'utf8');
  } catch {
    // best-effort — never fail a build over the reload sentinel
  }
}
/** Chain `touchDevReload` after any existing onSuccess (preserving it). */
function withReload(existing: Options['onSuccess']): () => Promise<void> {
  return async () => {
    if (typeof existing === 'function') await existing();
    await touchDevReload();
  };
}

const BUILDS: Options[] = [
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    splitting: false,
    noExternal: ['lz-string'],
    external: ['jsdom'],
    esbuildPlugins: [fixJsdomXhrWorker],
    onSuccess: copyMapData,
  },
  {
    entry: { editor: 'src/editor/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    splitting: false,
    external: [
      '@lezer/lr',
      '@lezer/highlight',
      '@lezer/common',
      '@codemirror/language',
      '@codemirror/state',
      '@codemirror/view',
    ],
  },
  {
    entry: { highlight: 'src/editor/highlight-api.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    splitting: false,
    // Inline Lezer so consumers have zero peer deps
  },
  {
    entry: { advanced: 'src/advanced.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    splitting: false,
    noExternal: ['lz-string'],
    external: ['jsdom'],
    esbuildPlugins: [fixJsdomXhrWorker],
  },
  {
    entry: { pert: 'src/pert/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    splitting: false,
  },
  {
    entry: ['src/cli.ts'],
    format: ['cjs'],
    dts: false,
    sourcemap: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
    noExternal: [/^(?!@resvg\/|jsdom$)/],
    external: ['@resvg/resvg-js', 'jsdom'],
    minify: true,
    esbuildPlugins: [fixJsdomXhrWorker, inlineJsdomStylesheet],
  },
  // Auto bundle — IIFE at dist/auto.js for `<script src="…/auto.js">`.
  // dts disabled because tsup forbids combining iife + declaration emission.
  // globalName is deliberately NOT `dgmo` — at top-level the bundle would
  // emit `var dgmo = (() => { ...defineProperty(window, 'dgmo', {writable:
  // false}); return api; })();`. Strict-mode then throws on the implicit
  // global assign because window.dgmo was just frozen inside the IIFE. Using
  // a private name (`__dgmoAuto`) keeps the var binding independent and the
  // bundle exposes the public API exclusively via `window.dgmo` /
  // `window.diagrammo` from inside the IIFE body.
  {
    entry: { auto: 'src/auto/index.ts' },
    format: ['iife'],
    globalName: '__dgmoAuto',
    dts: false,
    sourcemap: true,
    splitting: false,
    minify: true,
    noExternal: ['lz-string'],
    external: ['jsdom'],
    outExtension: () => ({ js: '.js' }),
    define: {
      __DGMO_VERSION__: JSON.stringify(pkg.version),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    esbuildPlugins: [fixJsdomXhrWorker],
    onSuccess: emitAutoCss,
  },
  // Auto bundle — ESM (.mjs) + CJS (.cjs) for direct npm consumers, plus
  // .d.ts/.d.cts. Filename extensions chosen so they don't collide with
  // the IIFE's dist/auto.js.
  {
    entry: { auto: 'src/auto/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    splitting: false,
    noExternal: ['lz-string'],
    external: ['jsdom'],
    outExtension: ({ format }) => ({
      js: format === 'cjs' ? '.cjs' : '.mjs',
    }),
    define: {
      __DGMO_VERSION__: JSON.stringify(pkg.version),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    esbuildPlugins: [fixJsdomXhrWorker],
  },
];

// Wrap every build's onSuccess so the dev-reload sentinel is touched once each
// chunk finishes, regardless of which entry a source edit rebuilt.
export default defineConfig(
  BUILDS.map((b) => ({ ...b, onSuccess: withReload(b.onSuccess) }))
);
