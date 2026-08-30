import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-node-modules.mjs'
);

// A pnpm tree in miniature: real packages live in the store, and everything
// under node_modules is a symlink into it.
function fixture({ scoped = false, deleteStore = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dgmo-node-modules-'));
  const store = join(root, 'store', 'pkg');
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, 'index.js'), '');

  const parent = scoped
    ? join(root, 'node_modules', '@lezer')
    : join(root, 'node_modules');
  mkdirSync(parent, { recursive: true });
  symlinkSync(store, join(parent, scoped ? 'generator' : 'pkg'));

  // pnpm's own bookkeeping, which the check must not mistake for a package.
  mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true });

  if (deleteStore)
    rmSync(join(root, 'store'), { recursive: true, force: true });
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, DGMO_NODE_MODULES_ROOT: root },
  });
}

test('accepts a tree whose links all resolve', () => {
  const result = run(fixture());
  assert.equal(result.status, 0);
  assert.match(result.stdout, /node_modules resolves \(1 linked packages\)/);
});

test('rejects links left behind by a deleted store, and names the repair', () => {
  const result = run(fixture({ deleteStore: true }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /1 of 1 linked packages/);
  assert.match(result.stderr, /pnpm install --force/);
  // Plain `pnpm install` is the trap: it reports success and repairs nothing.
  assert.match(result.stderr, /considers a tree of symlinks already satisfied/);
});

// The incident this guards was @lezer/generator — a top-level-only walk would
// have passed the very tree that could not build.
test('looks inside @scope directories', () => {
  const result = run(fixture({ scoped: true, deleteStore: true }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /@lezer\/generator ->/);
});

test('rejects a checkout with no node_modules at all', () => {
  const root = mkdtempSync(join(tmpdir(), 'dgmo-node-modules-'));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node_modules is missing/);
});
