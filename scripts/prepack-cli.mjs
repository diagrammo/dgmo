#!/usr/bin/env node
/**
 * Refuse to publish a `@diagrammo/dgmo-cli` that cannot draw.
 *
 * Wired as `prepack` in `cli/package.json`, so `npm publish` / `npm pack` in
 * `cli/` runs it and a non-zero exit stops the publish. It lives here rather
 * than in `cli/` because everything in that directory except the manifest and
 * the README is gitignored build output.
 *
 * 🔴 This exists because 0.62.0 shipped unable to render a map at all — 18 of 18
 * map fixtures failed — and nothing caught it (issue #121). The pre-publish check
 * that DID catch the split's other two defects (a bin collision and a broken
 * `exports` map) was: `npm pack`, install the tarball into a scratch project, run
 * the binary. That check passes here. The binary runs fine; only one chart type
 * is dead. `--version` is not a smoke test.
 *
 * The cause was distance, not code. `src/map/load-data.ts` finds its basemap JSON
 * in directories relative to its own bundle, and moving the bundle from
 * `dist/cli.cjs` to `cli/dist/cli.cjs` left all four candidates pointing at
 * nothing. No diff mentions map data, so no review could have caught it — only
 * running the thing can.
 *
 * Reading fixtures out of the repo is deliberate and safe: `prepack` runs for
 * whoever is publishing, never on a consumer's `npm install`.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = resolve(ROOT, 'cli/dist/cli.cjs');
const FIXTURES = resolve(ROOT, 'gallery/fixtures');

if (!existsSync(BIN)) {
  console.error(
    `✖ prepack: ${BIN} is missing — run \`pnpm build\` before publishing.`
  );
  process.exit(1);
}
if (!existsSync(FIXTURES)) {
  // Packing from a checkout without the gallery. Nothing to check against, and
  // failing would be worse than not checking.
  console.log(
    '· prepack: no gallery fixtures found, skipping the render check'
  );
  process.exit(0);
}

// One fixture per chart type. Fixtures are named `<type>.dgmo` or
// `<type>-<variant>.dgmo`, so the first hyphen-delimited segment groups them —
// good enough to guarantee every type is exercised at least once.
const byType = new Map();
for (const f of readdirSync(FIXTURES).sort()) {
  if (!f.endsWith('.dgmo')) continue;
  const type = basename(f, '.dgmo').split('-')[0];
  if (!byType.has(type)) byType.set(type, join(FIXTURES, f));
}

const out = mkdtempSync(join(tmpdir(), 'dgmo-prepack-'));
const broken = [];
for (const [type, file] of byType) {
  try {
    execFileSync(
      process.execPath,
      [BIN, file, '-o', join(out, `${type}.png`)],
      {
        stdio: 'pipe',
      }
    );
  } catch {
    broken.push(type);
  }
}
rmSync(out, { recursive: true, force: true });

if (broken.length > 0) {
  console.error(
    `✖ prepack: ${broken.length} of ${byType.size} chart types failed to render with ` +
      `the built CLI — ${broken.join(', ')}.\n` +
      `  This package would ship broken, so nothing was published.`
  );
  process.exit(1);
}
console.log(
  `✓ prepack: all ${byType.size} chart types render with the built CLI`
);
