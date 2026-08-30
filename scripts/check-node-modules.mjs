#!/usr/bin/env node

// Fail with the real cause when node_modules is a field of symlinks pointing at
// a pnpm store that no longer exists. diagrammo-app/packages/dgmo is a relative
// symlink to this checkout, so a `pnpm install` run inside an app gate worktree
// walks into here, treats it as a workspace package, and repoints every
// dependency at that gate's throwaway store. Deleting the gate leaves the links
// behind. Nothing is missing from the lockfile, so the first symptom is an
// unrelated-looking MODULE_NOT_FOUND several steps later — @lezer/generator
// during `pnpm codegen`, three times now (#601).
//
// This runs ahead of `rm -rf dist` in prebuild so a damaged tree does not also
// cost the built output it was going to fail before rewriting.

import { existsSync, lstatSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.DGMO_NODE_MODULES_ROOT ?? process.cwd();
const nodeModules = join(root, 'node_modules');

if (!existsSync(nodeModules)) {
  console.error('✗ node_modules is missing.');
  console.error('  Run: pnpm install');
  process.exit(1);
}

// Packages sit at the top level, or one level inside an @scope directory. Dot
// entries — .bin, .pnpm, .modules.yaml — are pnpm's own bookkeeping and are not
// what a stray install repoints.
function packageLinks(dir) {
  const links = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.name.startsWith('@') && lstatSync(path).isDirectory()) {
      links.push(...packageLinks(path));
    } else if (entry.isSymbolicLink()) {
      links.push(path);
    }
  }
  return links;
}

const links = packageLinks(nodeModules);
const dangling = links.filter((path) => !existsSync(path));

if (dangling.length === 0) {
  console.log(`✓ node_modules resolves (${links.length} linked packages).`);
  process.exit(0);
}

console.error(
  `✗ ${dangling.length} of ${links.length} linked packages in node_modules point at a store that no longer exists.`
);
for (const path of dangling.slice(0, 3)) {
  console.error(`  ${path.slice(root.length + 1)} -> ${readlinkSync(path)}`);
}
if (dangling.length > 3) {
  console.error(`  ...and ${dangling.length - 3} more.`);
}
console.error(
  '  Cause:  a pnpm install run from an app gate worktree reached this checkout'
);
console.error(
  '          through diagrammo-app/packages/dgmo and then took its store away.'
);
console.error('  Repair: pnpm install --force');
console.error(
  '          Plain `pnpm install` reports success and changes nothing — it'
);
console.error('          considers a tree of symlinks already satisfied.');
process.exit(1);
