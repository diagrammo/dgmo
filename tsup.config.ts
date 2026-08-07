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
 * file. Mirrors the runtime assembly in `src/auto/styles.ts` (BL-114):
 * auto-surface base rules + the canonical BLOCK_CSS + a copy of the block's
 * dark rules rescoped from `[data-theme="dark"]` to `.dgmo-theme-dark`.
 * Update BOTH places if the assembly changes.
 */
async function emitAutoCss(): Promise<void> {
  // Use a regex-extract approach so we don't have to dynamic-import the
  // freshly-built ESM (which would also resolve d3/echarts side-effect
  // chains). Both source files hold their CSS as a single template literal.
  const stylesSource = await readFile(resolve('./src/auto/styles.ts'), 'utf8');
  const baseMatch = stylesSource.match(
    /const AUTO_BASE_CSS:\s*string\s*=\s*`([\s\S]*?)`;/
  );
  if (!baseMatch) {
    throw new Error(
      'tsup.config: failed to extract AUTO_BASE_CSS literal from src/auto/styles.ts'
    );
  }
  const blockCss = await extractBlockCss();
  const darkScoped = (
    blockCss.match(/\[data-theme="dark"\][^{]*\{[^}]*\}/g) ?? []
  )
    .map((rule) => rule.replace(/\[data-theme="dark"\]/g, '.dgmo-theme-dark'))
    .join('\n');
  // Strip leading newline to match how the CSS is consumed inline.
  const base = baseMatch[1].replace(/^\n/, '');
  const css = base + '\n' + blockCss + '\n' + darkScoped + '\n';
  await writeFile(resolve('./dist/auto.css'), css, 'utf8');
}

/** Extract the BLOCK_CSS literal from src/embed/css.ts (regex mechanism). */
async function extractBlockCss(): Promise<string> {
  const cssPath = resolve('./src/embed/css.ts');
  const cssSource = await readFile(cssPath, 'utf8');
  const m = cssSource.match(
    /export const BLOCK_CSS:\s*string\s*=\s*`([\s\S]*?)`;\s*$/m
  );
  if (!m) {
    throw new Error(
      'tsup.config: failed to extract BLOCK_CSS literal from src/embed/css.ts'
    );
  }
  return m[1].replace(/^\n/, '');
}

/**
 * After the block entry builds, emit `dist/block.css` from the BLOCK_CSS
 * literal in src/embed/css.ts — same regex-extract mechanism (and rationale)
 * as emitAutoCss above.
 */
async function emitBlockCss(): Promise<void> {
  await writeFile(resolve('./dist/block.css'), await extractBlockCss(), 'utf8');
}

/**
 * Copy the runtime assets the CLI reads from its own package root into
 * `cli/`, so `@diagrammo/dgmo-cli` is self-contained.
 *
 * `src/cli.ts` computes `PKG_ROOT = resolve(__dirname, '..')` and reads
 * `<PKG_ROOT>/fonts/*.ttf` (resvg needs real font files — it has no system
 * font fallback worth relying on) and `<PKG_ROOT>/.cursorrules` and friends
 * (`dgmo install` copies them into a user's editor config). npm's `files`
 * cannot reach above a package directory, so these are copied rather than
 * referenced. All of it is gitignored — regenerate with `pnpm build`.
 *
 * 🔴 TTFs only. The CLI is never a browser — `cli.ts` hands the two `.ttf`
 * files to resvg and nothing in that package can load a `.woff2`, which exists
 * solely for the app's `@font-face`. Copying all four shipped 166 KB of
 * unreadable bytes in every `@diagrammo/dgmo-cli` install (issue #120).
 */
async function stageCliAssets(): Promise<void> {
  const CLI = resolve('./cli');
  await mkdir(resolve(CLI, 'fonts'), { recursive: true });
  for (const f of await readdir(resolve('./fonts'))) {
    if (!f.endsWith('.ttf') && f !== 'LICENSE-Inter.txt') continue;
    await copyFile(resolve('./fonts', f), resolve(CLI, 'fonts', f));
  }
  for (const f of ['.cursorrules', '.windsurfrules', 'SKILL.md', 'LICENSE']) {
    await copyFile(resolve('.', f), resolve(CLI, f));
  }
  await mkdir(resolve(CLI, '.github'), { recursive: true });
  await copyFile(
    resolve('./.github/copilot-instructions.md'),
    resolve(CLI, '.github/copilot-instructions.md')
  );
  await mkdir(resolve(CLI, '.claude/commands'), { recursive: true });
  for (const f of await readdir(resolve('./.claude/commands'))) {
    await copyFile(
      resolve('./.claude/commands', f),
      resolve(CLI, '.claude/commands', f)
    );
  }
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

/** Chain several onSuccess hooks into one (they run sequentially). */
function chain(...hooks: Array<() => Promise<void>>): () => Promise<void> {
  return async () => {
    for (const h of hooks) await h();
  };
}

const BUILDS: Options[] = [
  // Core + embed + advanced share one render pipeline (~2.5 MB of d3/echarts).
  // Emitting them as independent self-contained bundles duplicated that
  // pipeline in every host that imports more than one subpath — Obsidian pulls
  // index + advanced + block (~7.5 MB of dupes), remark-dgmo pulls index +
  // block. ESM code-splitting extracts the shared code into a chunk all three
  // entries import, so a downstream bundler (esbuild/Rollup/Vite) keeps a
  // single copy. The package is ESM-only (v0.48.0 dropped the CJS build — see
  // the git history / CHANGELOG); the CLI (`cli.cjs`) and the auto/element
  // IIFE `<script src>` bundles are the only non-ESM outputs and keep their
  // own configs.
  {
    entry: {
      index: 'src/index.ts',
      block: 'src/embed/index.ts',
      advanced: 'src/advanced.ts',
      // Light chart-metadata surface (parsers/data only — no renderers).
      // In the splitting group so its parser code shares chunks with
      // index/advanced instead of duplicating them.
      'chart-meta': 'src/chart-meta.ts',
      // Light completion surface — the static registries only (no symbol
      // extractors, hence no chart parsers). Same rationale as chart-meta:
      // the app's editor imports these eagerly, so they must not drag the
      // render/parse graph onto the startup path.
      'completion-registry': 'src/completion-registry.ts',
      // The cloud-reference resolver (Cloud story 10.6) — a dependency-free
      // parser every wrapper and the CLI import so none of them reimplements
      // the three spellings. Its own entry precisely so a docs wrapper can
      // resolve a reference without pulling the render graph.
      'cloud-reference': 'src/cloud-reference.ts',
      // Asking the Cloud what a pointer points at, and reading the answer —
      // the step every surface needs and only `remark-dgmo` used to have. Its
      // own entry, separate from `cloud-reference`, so that resolving costs no
      // renderer and parsing costs no network: five wrappers import the parser
      // and never want this.
      'live-link-resolve': 'src/live-link/resolve.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    splitting: true,
    noExternal: ['lz-string'],
    external: ['jsdom'],
    esbuildPlugins: [fixJsdomXhrWorker],
    onSuccess: chain(copyMapData, emitBlockCss),
  },
  {
    // Countdown ticker — a self-contained (zero-import) ~1 KB browser runtime.
    // Its own entry so client surfaces (remark-dgmo, Obsidian, the app) import
    // ONLY the ticker, never the heavy render pipeline.
    entry: { countdown: 'src/countdown/ticker.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['jsdom'],
  },
  {
    // Clock ticker — a self-contained (zero-import) browser runtime, mirroring
    // the countdown entry. Client surfaces import ONLY the ticker + shared math.
    entry: { clock: 'src/clock/ticker.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['jsdom'],
  },
  {
    entry: { editor: 'src/editor/index.ts' },
    format: ['esm'],
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
    format: ['esm'],
    dts: true,
    sourcemap: true,
    splitting: false,
    // Inline Lezer so consumers have zero peer deps
  },
  {
    entry: { pert: 'src/pert/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    splitting: false,
  },
  // The CLI is its own npm package, `@diagrammo/dgmo-cli`, so it builds into
  // `cli/dist/` rather than the library's `dist/`. The library no longer has a
  // `bin`, and a documentation build that only calls `render()` stops paying
  // for a 1.8 MB command-line program and a 3.4 MB native rasterizer.
  //
  // It still INLINES the library rather than depending on it (`noExternal`
  // below). That is deliberate: `src/cli.ts` reaches five modules that are not
  // public exports — `cli-banner`, `map/completion`, `org/resolver`,
  // `pert/share-normalize`, `utils/offered-types` — so depending on the package
  // would mean widening the public surface or routing them through the
  // no-semver `/advanced` firehose. Inlining also keeps `npx` and Homebrew
  // installs self-contained, with no runtime version skew between the two.
  //
  // Consequence: `PKG_ROOT` in cli.ts is `cli/`, so the fonts, the rules files
  // and the version-bearing package.json must sit there — `stageCliAssets`
  // copies them in. Everything it writes is gitignored; `cli/package.json` is
  // the only checked-in file in that directory.
  {
    entry: ['src/cli.ts'],
    outDir: 'cli/dist',
    format: ['cjs'],
    dts: false,
    sourcemap: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
    noExternal: [/^(?!@resvg\/|jsdom$)/],
    external: ['@resvg/resvg-js', 'jsdom'],
    minify: true,
    esbuildPlugins: [fixJsdomXhrWorker, inlineJsdomStylesheet],
    onSuccess: stageCliAssets,
  },
  // Auto bundle — IIFE at dist/auto.js for `<script src="…/auto.js">`.
  //
  // 🔴 IIFE ONLY. `auto` and `element` each used to build twice — this IIFE and
  // an unminified ESM `.mjs` behind the `./auto` and `./element` exports. The
  // two .mjs files were 6,762 KB of a 34.6 MB install, larger than the minified
  // IIFEs for identical source, and a sweep of every repo in the workspace on
  // 2026-08-06 found no importer of either export. They were deleted with the
  // exports-map entries. These files live in the npm tarball only because
  // jsDelivr and unpkg serve out of it — there is no upload step, and dgmo's
  // `dist/` is gitignored so the `cdn.jsdelivr.net/gh/…` route 404s. That is
  // the whole reason a browser bundle ships inside a library; it does not
  // extend to a second copy nobody imports.
  //
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
  // Element bundle — IIFE at dist/element.js for `<script src="…/element.js">`.
  // Self-registers `<dgmo-diagram>` on load. Same private-globalName rationale
  // as the auto IIFE: the module defines the element via side effect, so we
  // don't want the bundle assigning a public global. dts is disabled because
  // tsup forbids iife + declaration emission, and nothing needs the types —
  // a `<script src>` consumer has no import to type. See the note above the
  // auto IIFE for why the ESM twins are gone.
  {
    entry: { element: 'src/element/index.ts' },
    format: ['iife'],
    globalName: '__dgmoElement',
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
  },
];

// Wrap every build's onSuccess so the dev-reload sentinel is touched once each
// chunk finishes, regardless of which entry a source edit rebuilt.
export default defineConfig(
  BUILDS.map((b) => ({ ...b, onSuccess: withReload(b.onSuccess) }))
);
