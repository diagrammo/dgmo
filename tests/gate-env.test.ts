import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The pre-push gate runs in a cleared environment (diagrammo#1592). On
// 2026-10-10 an exported DGMO_ALLOW_SHARED_LINK=1 reached the app's gate and
// failed the test that asserts that guard refuses. The hook now re-execs under
// the workspace's scripts/gate-env.sh allowlist; this runs the real hook in a
// fake workspace and reads what it would gate with.

const HOOK = join(import.meta.dirname, '../.githooks/pre-push');
// The workspace root holds the allowlist; a standalone checkout (CI) has none.
const GATE_ENV = join(import.meta.dirname, '../..', 'scripts/gate-env.sh');

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!existsSync(GATE_ENV))('pre-push gate environment', () => {
  it('drops a leaked DGMO_ override and junk, keeps PATH and HOME', () => {
    const ws = mkdtempSync(join(tmpdir(), 'gate-env-'));
    tmps.push(ws);
    mkdirSync(join(ws, 'scripts'));
    copyFileSync(GATE_ENV, join(ws, 'scripts/gate-env.sh'));
    const repo = join(ws, 'repo');
    mkdirSync(join(repo, '.githooks'), { recursive: true });
    copyFileSync(HOOK, join(repo, '.githooks/pre-push'));
    execFileSync('git', ['init', '-q'], { cwd: repo });

    const probe = join(ws, 'env.txt');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DGMO_ALLOW_SHARED_LINK: '1',
      JUNK_VAR: 'x',
      DIAGRAMMO_GATE_ENV_PROBE: probe,
    };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    const r = spawnSync('.githooks/pre-push', ['origin', 'url'], {
      cwd: repo,
      env,
      input: '',
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);

    const seen = readFileSync(probe, 'utf8');
    expect(seen).not.toMatch(/^DGMO_ALLOW_SHARED_LINK=/m);
    expect(seen).not.toMatch(/^JUNK_VAR=/m);
    expect(seen).toMatch(/^GATE_ENV_CLEARED=1$/m);
    expect(seen).toContain(`HOME=${process.env.HOME}\n`);
    expect(seen).toContain(`PATH=${process.env.PATH}\n`);
  });
});
