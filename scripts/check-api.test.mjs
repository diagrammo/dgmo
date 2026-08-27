import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-api.sh');

function check(baseline, built) {
  const root = mkdtempSync(join(tmpdir(), 'dgmo-api-check-'));
  const baselineDir = join(root, 'baseline');
  const distDir = join(root, 'dist');
  mkdirSync(baselineDir);
  mkdirSync(distDir);
  writeFileSync(join(baselineDir, 'index.d.ts'), baseline);
  writeFileSync(join(distDir, 'index.d.ts'), built);
  return spawnSync('bash', [script, 'check'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      API_BASELINE_DIR: baselineDir,
      API_DIST_DIR: distDir,
    },
  });
}

test('ignores only tsup content hashes in private chunk specifiers', () => {
  const result = check(
    "export { C as Chart } from './chart-types-Ab12_cdE.js';\n",
    "export { C as Chart } from './chart-types-Zy98_wVu.js';\n"
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('still rejects a public symbol change behind the same logical chunk', () => {
  const result = check(
    "export { C as Chart } from './chart-types-Ab12_cdE.js';\n",
    "export { C as Diagram } from './chart-types-Zy98_wVu.js';\n"
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /public type surface CHANGED/);
});

test('still rejects a logical chunk-name change', () => {
  const result = check(
    "export { C as Chart } from './chart-types-Ab12_cdE.js';\n",
    "export { C as Chart } from './completion-Zy98_wVu.js';\n"
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /public type surface CHANGED/);
});
