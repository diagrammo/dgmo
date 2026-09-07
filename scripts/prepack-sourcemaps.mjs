#!/usr/bin/env node
/**
 * Never publish a `.js` that points at a source map we do not publish.
 *
 * Wired as `prepack` in every manifest this repo publishes, so `npm publish` /
 * `npm pack` runs it and the tarball is correct however the publish was
 * started — rather than depending on a flag somebody has to remember in
 * `release.yml`, `release-cli.yml` and the standalone step alike.
 *
 * 🔴 Why this exists (issue #667, decided 2026-09-07). `tsup.config.ts` sets
 * `sourcemap: true` on eight of its nine entries, so every built `.js` is
 * stamped with a `//# sourceMappingURL=` comment — and no manifest's `files`
 * allowlist publishes `dist/*.map`. Measured on 0.83.0: 281 `.js` in `dist/`,
 * 281 maps built, **0 maps published**, 281 dangling comments. Any bundler that
 * honours the comment prints an error per chunk and gets nothing back:
 *
 *     [vite] (ssr) Failed to load source map for .../dist/chunk-XXXXXXXX.js.
 *     Error: ENOENT: no such file or directory, open '.../chunk-XXXXXXXX.js.map'
 *
 * Harmless, but it buries real output in every consumer that loads dgmo through
 * Vite — it was found burying a new test suite in the Cloud API. True of every
 * release with the current `files` list, not a regression.
 *
 * ⚠️ The library was the reported case; `@diagrammo/dgmo-standalone` has it too.
 * Its `files` publishes `dist/auto.js` and `dist/element.js`, both stamped, and
 * no map. That was found while fixing this and is why the script takes a package
 * directory rather than hardcoding the root.
 *
 * WHAT IT DOES NOT DO: it never deletes a map and never changes what is
 * published. The chosen fix was to drop the comment, not to ship 9.1 MB of maps
 * against a 6.3 MB tarball. If that is ever reversed by adding `dist/*.map` to a
 * `files` list, this script sees the map is publishable and **leaves the comment
 * alone** — so the decision is expressed in the manifest, and this stays correct
 * either way rather than needing to be found and deleted.
 *
 * It edits the built file in place. `dist/` is build output, so the repair is
 * `pnpm build`; nothing tracked is touched. A local build keeps its comments and
 * its maps, which is the whole point of stripping here rather than at build time.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(process.argv[2] ?? join(here, '..'));
const pkgPath = join(pkgDir, 'package.json');

const fail = (msg) => {
  console.error(`::error:: prepack-sourcemaps: ${msg}`);
  process.exit(1);
};

let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch (err) {
  fail(`cannot read ${pkgPath}: ${String(err)}`);
}

const patterns = pkg.files;
if (!Array.isArray(patterns) || patterns.length === 0) {
  // Without an allowlist npm publishes nearly everything, so "is the map
  // published?" has a different answer and this script's premise is gone.
  fail(
    `${pkg.name} has no "files" allowlist — this guard reasons about what that ` +
      `list admits, so it cannot answer for this package`
  );
}

const isDir = (abs) => {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Turn one `files` entry into { root, recursive, test }.
 *
 * 🔴 Deliberately refuses anything it does not understand rather than guessing.
 * A pattern this cannot read would otherwise be silently treated as "publishes
 * nothing", and the script would strip comments off files that DO ship their
 * maps — the exact inversion of its job. The shapes below are every shape the
 * three manifests actually use; a fourth one should land here with a test, not
 * be waved through.
 */
const compile = (pattern) => {
  if (pattern.startsWith('!') || pattern.includes('**')) {
    fail(
      `"files" entry ${JSON.stringify(pattern)} uses a negation or a globstar, ` +
        `which this guard does not implement — teach it that shape rather than ` +
        `letting it guess (see the comment above compile())`
    );
  }
  const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '');

  // A bare existing directory publishes everything beneath it (cli: "dist").
  if (!clean.includes('*') && isDir(join(pkgDir, clean))) {
    return {
      root: clean,
      recursive: true,
      test: (rel) => rel === clean || rel.startsWith(`${clean}/`),
    };
  }

  const segments = clean.split('/');
  const last = segments[segments.length - 1];
  const root = segments.slice(0, -1).join('/');
  if (root.includes('*')) {
    fail(
      `"files" entry ${JSON.stringify(pattern)} has a wildcard in a directory ` +
        `segment, which this guard does not implement`
    );
  }
  // `*` matches within one segment only, which is npm's own behaviour here.
  const re = new RegExp(
    `^${last.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`
  );
  return {
    root,
    recursive: false,
    test: (rel) => {
      const relRoot = rel.includes('/')
        ? rel.slice(0, rel.lastIndexOf('/'))
        : '';
      return relRoot === root && re.test(rel.slice(rel.lastIndexOf('/') + 1));
    },
  };
};

const compiled = patterns.map(compile);
const publishes = (rel) => compiled.some((c) => c.test(rel));

const walk = (relDir, recursive, out) => {
  const abs = join(pkgDir, relDir);
  if (!isDir(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = relDir ? `${relDir}/${name}` : name;
    if (isDir(join(pkgDir, rel))) {
      if (recursive) walk(rel, recursive, out);
    } else if (name.endsWith('.js') || name.endsWith('.cjs')) {
      out.add(rel);
    }
  }
  return out;
};

const candidates = new Set();
for (const { root, recursive } of compiled) walk(root, recursive, candidates);

// The comment is the last non-empty line esbuild writes. Anchor to a line so a
// `sourceMappingURL` appearing inside a string literal in bundled source is not
// mistaken for the real one.
const COMMENT = /^[ \t]*\/\/[#@][ \t]*sourceMappingURL=(.+?)[ \t]*$/gm;

let stripped = 0;
let kept = 0;
let inline = 0;
const touched = [];

for (const rel of [...candidates].sort()) {
  if (!publishes(rel)) continue;
  const abs = join(pkgDir, rel);
  const src = readFileSync(abs, 'utf8');
  COMMENT.lastIndex = 0;
  if (!COMMENT.test(src)) continue;
  COMMENT.lastIndex = 0;

  let changed = false;
  const next = src.replace(COMMENT, (whole, url) => {
    // An inline (data:) map travels inside the file, so it is published by
    // construction and there is nothing dangling about it.
    if (url.startsWith('data:')) {
      inline += 1;
      return whole;
    }
    const mapRel = posix.normalize(
      posix.join(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', url)
    );
    if (publishes(mapRel)) {
      kept += 1;
      return whole;
    }
    changed = true;
    stripped += 1;
    return '';
  });

  if (changed) {
    // Collapse the blank line the removal leaves at end of file.
    writeFileSync(abs, next.replace(/\n{2,}$/, '\n'), 'utf8');
    touched.push(rel);
  }
}

// Say what was left behind as well as what was removed — a bare "stripped N"
// cannot be told from a run that missed the ones it should have kept.
const alsoKept = [
  kept ? `kept ${kept} whose maps are published` : '',
  inline ? `left ${inline} inline (data:) map(s) alone` : '',
].filter(Boolean);

if (stripped === 0 && kept === 0 && inline === 0) {
  console.log(
    `✓ ${pkg.name} ${pkg.version}: no published .js carries a sourceMappingURL`
  );
} else if (stripped === 0) {
  console.log(
    `✓ ${pkg.name} ${pkg.version}: nothing to strip — ${alsoKept.join(', ')}`
  );
} else {
  const sample = touched.slice(0, 3).join(', ');
  console.log(
    `✓ ${pkg.name} ${pkg.version}: stripped ${stripped} dangling ` +
      `sourceMappingURL comment(s) from ${touched.length} published file(s)` +
      (alsoKept.length ? `, ${alsoKept.join(', ')}` : '') +
      ` — e.g. ${sample}${touched.length > 3 ? ', …' : ''}`
  );
  console.log(
    `  (dist/ is build output; \`pnpm build\` restores the comments locally)`
  );
}

// Verify rather than assume: nothing publishable may still point at a map we do
// not ship. A regex that silently matched nothing would otherwise report success.
const survivors = [];
for (const rel of [...candidates].sort()) {
  if (!publishes(rel)) continue;
  const src = readFileSync(join(pkgDir, rel), 'utf8');
  for (const m of src.matchAll(COMMENT)) {
    const url = m[1];
    if (url.startsWith('data:')) continue;
    const mapRel = posix.normalize(
      posix.join(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', url)
    );
    if (!publishes(mapRel)) survivors.push(`${rel} → ${url}`);
  }
}
if (survivors.length > 0) {
  fail(
    `${survivors.length} published file(s) still point at an unpublished map — ` +
      `the strip did not take:\n  ${survivors.slice(0, 5).join('\n  ')}`
  );
}
