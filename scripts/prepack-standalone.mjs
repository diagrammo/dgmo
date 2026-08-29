#!/usr/bin/env node
/**
 * Pre-publish guard for @diagrammo/dgmo-standalone.
 *
 * The two drop-ins are the one artifact nobody imports — no `exports` key
 * reaches them, no test resolves them, and the only consumer is a `<script
 * src>` on a page we don't own. So the failure mode is silent: a bundle that
 * packs, publishes and 404s or throws in a stranger's browser.
 *
 * This checks the four things that can be checked without a browser:
 *
 *   1. Both bundles, auto.css and the LICENSE exist and are not stubs.
 *   2. The version baked into element.js matches this package's version.
 *      element.js hardcodes `unpkg.com/@diagrammo/dgmo@<VERSION>/dist/map-data/`
 *      at build time, so a standalone published at a version the library never
 *      published is a package whose maps 404 — and maps are exactly the chart
 *      type that already shipped broken once this way.
 *   3. The library at that version carries dist/map-data, i.e. the URL the
 *      bundle will fetch resolves to something real in this checkout.
 *
 * It does NOT prove the bundles run. Only a browser does that.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const pkgDir = join(repoRoot, 'standalone');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

const fail = (msg) => {
  console.error(`::error:: prepack-standalone: ${msg}`);
  process.exit(1);
};

// A drop-in carries the whole library, so anything under a megabyte means the
// build silently produced a shell rather than a bundle.
const MIN_BUNDLE_BYTES = 1_000_000;
const MIN_CSS_BYTES = 1_000;

// The licence text is staged by the build (tsup.config.ts) rather than
// committed, so a build that skipped that step publishes a package declaring
// MIT with no MIT in it — which is what shipped until 2026-08-09. A floor of a
// few hundred bytes distinguishes the real text from an empty file.
const MIN_LICENSE_BYTES = 500;

for (const [rel, min] of [
  ['dist/auto.js', MIN_BUNDLE_BYTES],
  ['dist/element.js', MIN_BUNDLE_BYTES],
  ['dist/auto.css', MIN_CSS_BYTES],
  ['LICENSE', MIN_LICENSE_BYTES],
]) {
  const abs = join(pkgDir, rel);
  if (!existsSync(abs)) fail(`${rel} is missing — run \`pnpm build\` first`);
  const { size } = statSync(abs);
  if (size < min) {
    fail(
      `${rel} is ${size} B, under the ${min} B floor — build looks truncated`
    );
  }
}

// 2. The version baked into the basemap URL must be this package's version.
//
// The URL is a template literal holding a binding, not a folded constant —
// VERSION is an imported symbol rather than a `define`, so esbuild leaves
// `unpkg.com/@diagrammo/dgmo@${Bk}/dist/map-data/` and declares `var
// Bk="0.62.0"` elsewhere, under whatever name the minifier picked this build.
// So: read the identifier out of the URL, then find what it was assigned.
const element = readFileSync(join(pkgDir, 'dist/element.js'), 'utf8');
const urlMatch = element.match(
  /unpkg\.com\/@diagrammo\/dgmo@\$\{([A-Za-z_$][\w$]*)\}\/dist\/map-data\//
);
if (!urlMatch) {
  fail(
    'element.js has no unpkg basemap URL of the expected shape — ' +
      'DEFAULT_MAP_DATA_BASE changed; update this guard alongside it'
  );
}
const ident = urlMatch[1];
const assigned = element.match(
  new RegExp(`\\b${ident}\\s*=\\s*["']([^"']+)["']`)
);
if (!assigned) {
  fail(`element.js never assigns ${ident}, the version in its basemap URL`);
}
if (assigned[1] !== pkg.version) {
  fail(
    `element.js fetches basemaps from @diagrammo/dgmo@${assigned[1]} but this ` +
      `package is ${pkg.version}. Bump both together — \`scripts/release.sh dgmo ` +
      `<version>\` does, a hand edit does not.`
  );
}

// 3. That library version's map data exists in this checkout.
const libMapData = join(repoRoot, 'dist', 'map-data');
if (!existsSync(libMapData)) {
  fail(
    'dgmo/dist/map-data is missing, so the library tarball this bundle points ' +
      'at would ship without basemaps — run `pnpm build:map-data && pnpm build`'
  );
}

const libVersion = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8')
).version;
if (libVersion !== pkg.version) {
  fail(
    `library is ${libVersion}, standalone is ${pkg.version} — they publish as ` +
      'one version (see the dgmo case in scripts/release.sh)'
  );
}

console.log(
  `✓ standalone ${pkg.version}: both drop-ins present, basemap URL matches the library`
);
