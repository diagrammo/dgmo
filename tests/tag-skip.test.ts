import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// release.sh pushes the branch, then the tag, and both used to run the whole
// gate on the same commit (diagrammo#1654). A tag-only push of a commit the
// workspace gate ledger holds a pass for now exits before the gate. This runs
// the real hook in a fake workspace with a seeded ledger.

const HOOK = join(import.meta.dirname, '../.githooks/pre-push');
const SCRIPTS = join(import.meta.dirname, '../..', 'scripts');
const TIMING = join(SCRIPTS, 'gate-timing.sh');
const ZERO = '0'.repeat(40);

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'tag-skip-'));
  tmps.push(ws);
  mkdirSync(join(ws, 'scripts'));
  for (const s of ['gate-env.sh', 'gate-timing.sh'])
    copyFileSync(join(SCRIPTS, s), join(ws, 'scripts', s));
  const repo = join(ws, 'dgmo');
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  copyFileSync(HOOK, join(repo, '.githooks/pre-push'));
  const git = (...a: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        '-c',
        'commit.gpgsign=false',
        ...a,
      ],
      { cwd: repo, encoding: 'utf8' }
    ).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lock\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  const [sha, hash] = execFileSync(
    join(ws, 'scripts/gate-timing.sh'),
    ['key-at', repo, 'HEAD'],
    { encoding: 'utf8' }
  )
    .trim()
    .split(' ');
  return { ws, repo, sha, hash };
}

function runHook(ws: string, repo: string, refs: string, ledger: object) {
  const dir = join(ws, 'timing');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'log.jsonl'), JSON.stringify(ledger) + '\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DIAGRAMMO_GATE_TIMING_DIR: dir,
    DIAGRAMMO_GATE_LOCK: join(ws, 'gate.lock'),
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GATE_ENV_CLEARED;
  return spawnSync('.githooks/pre-push', ['origin', 'url'], {
    cwd: repo,
    env,
    input: refs,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

const passLine = (sha: string, hash: string) => ({
  ts: new Date().toISOString().slice(0, 19) + '+0000',
  repo: 'dgmo',
  result: 'passed',
  rc: 0,
  sha,
  gate_hash: hash,
  kind: 'hook',
  host: 'globe',
  waited_s: 0,
  total_s: 120,
  steps: [],
});

describe.skipIf(!existsSync(TIMING))('pre-push tag-only skip', () => {
  it('exits 0 before the gate for a tag on a commit that already passed', () => {
    const { ws, repo, sha, hash } = fakeWorkspace();
    const r = runHook(
      ws,
      repo,
      `refs/tags/v1.0.0 ${sha} refs/tags/v1.0.0 ${ZERO}\n`,
      passLine(sha, hash)
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /gate: \(dgmo, [0-9a-f]+\) passed on globe at .*, skipping/
    );
    expect(r.stdout).not.toContain('gating a worktree');
  });

  it('the line sits before the lock, so a skip never queues', () => {
    const hook = readFileSync(HOOK, 'utf8');
    const skip = hook.indexOf('tag-skip "$REPO_ROOT"');
    const lock = hook.indexOf('"$GATE_LOCK" acquire dgmo');
    expect(skip).toBeGreaterThan(0);
    expect(skip).toBeLessThan(lock);
  });
});
