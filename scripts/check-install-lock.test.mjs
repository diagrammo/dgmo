import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-install-lock.mjs'
);

function fixture(installed) {
  const root = mkdtempSync(join(tmpdir(), 'dgmo-install-lock-'));
  writeFileSync(
    join(root, 'pnpm-lock.yaml'),
    'lockfileVersion: 9\nversion: 3.0.0\n'
  );
  if (installed !== undefined) {
    const store = join(root, 'node_modules', '.pnpm');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'lock.yaml'), installed);
  }
  return root;
}

test('accepts the exact dependency tree recorded by pnpm', () => {
  const root = fixture('lockfileVersion: 9\nversion: 3.0.0\n');
  const output = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, DGMO_INSTALL_LOCK_ROOT: root },
  });
  assert.match(output, /installed dependencies match/);
});

test('rejects a non-frozen dependency update before re-baselining', () => {
  const root = fixture('lockfileVersion: 9\nversion: 3.1.1\n');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, DGMO_INSTALL_LOCK_ROOT: root },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /installed dependencies do not match/);
  assert.match(result.stderr, /Do not re-baseline API or gallery output/);
});

test('rejects a checkout with no installed-tree record', () => {
  const root = fixture(undefined);
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, DGMO_INSTALL_LOCK_ROOT: root },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm install --frozen-lockfile/);
});
