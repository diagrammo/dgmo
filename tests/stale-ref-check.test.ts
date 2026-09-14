import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A push that lost the race for main while it queued for the gate lock (#680).
// It used to find out only AFTER the full gate — `cannot lock ref
// 'refs/heads/main': is at X but expected Y` — four times out of five on one
// change on 2026-09-03/04. The hook now asks the remote either side of the lock
// and refuses such a push in seconds.

const SCRIPT = join(import.meta.dirname, '../.githooks/stale-ref-check.sh');
const HOOK = join(import.meta.dirname, '../.githooks/pre-push');
const ZERO = '0'.repeat(40);

/** Git with no hook's GIT_DIR leaking in, and an identity for commits. */
function env(): NodeJS.ProcessEnv {
  const e = { ...process.env };
  delete e.GIT_DIR;
  delete e.GIT_WORK_TREE;
  return e;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.email=nightly@example.com',
      '-c',
      'user.name=nightly',
      '-c',
      'init.defaultBranch=main',
      ...args,
    ],
    { cwd, encoding: 'utf8', env: env() }
  ).trim();
}

function commit(cwd: string, name: string): string {
  writeFileSync(join(cwd, name), name);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-q', '-m', name);
  return git(cwd, 'rev-parse', 'HEAD');
}

/**
 * An origin with `main` at A, a clone `work` that knows A, and a second clone
 * that can move `main` underneath it — the other session landing first.
 */
function world() {
  const base = mkdtempSync(join(tmpdir(), 'stale-ref-'));
  git(base, 'init', '-q', '--bare', 'origin.git');
  git(base, 'clone', '-q', 'origin.git', 'work');
  const work = join(base, 'work');
  const a = commit(work, 'a');
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  const landFirst = (): string => {
    git(base, 'clone', '-q', 'origin.git', 'other');
    const other = join(base, 'other');
    const b = commit(other, 'b');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    return b;
  };
  return { base, work, a, landFirst };
}

function check(cwd: string, stdin: string, remote = 'origin') {
  const r = spawnSync('bash', [SCRIPT, remote, 'after-lock'], {
    cwd,
    input: stdin,
    encoding: 'utf8',
    env: env(),
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('stale-ref-check', () => {
  it('refuses a push whose remote main moved while it waited', () => {
    const { work, a, landFirst } = world();
    const mine = commit(work, 'mine');
    landFirst();

    const r = check(work, `refs/heads/main ${mine} refs/heads/main ${a}\n`);

    expect(r.status).toBe(1);
    expect(r.out).toMatch(/^pre-push: refs\/heads\/main on origin moved/m);
    expect(r.out).toContain('rebase onto origin/main and push again');
  });

  it('lets a push through, silently, when main has not moved', () => {
    const { work, a } = world();
    const mine = commit(work, 'mine');

    const r = check(work, `refs/heads/main ${mine} refs/heads/main ${a}\n`);

    expect(r.status).toBe(0);
    expect(r.out).toBe('');
  });

  it('lets a new branch through', () => {
    const { work } = world();
    const mine = commit(work, 'mine');

    const r = check(
      work,
      `refs/heads/feature ${mine} refs/heads/feature ${ZERO}\n`
    );

    expect(r.status).toBe(0);
  });

  it('ignores a branch deletion, which expects nothing', () => {
    const { work, a } = world();

    const r = check(work, `(delete) ${ZERO} refs/heads/main ${a}\n`);

    expect(r.status).toBe(0);
    expect(r.out).toBe('');
  });

  it('never blocks a push on a remote it cannot ask', () => {
    const { base, work, a } = world();
    const mine = commit(work, 'mine');

    const r = check(
      work,
      `refs/heads/main ${mine} refs/heads/main ${a}\n`,
      join(base, 'no-such-remote.git')
    );

    expect(r.status).toBe(0);
    expect(r.out).toContain('carrying on unchecked');
  });

  it('refuses when any one of several pushed refs has moved', () => {
    const { work, a, landFirst } = world();
    const mine = commit(work, 'mine');
    landFirst();

    const r = check(
      work,
      `refs/heads/feature ${mine} refs/heads/feature ${ZERO}\n` +
        `refs/heads/main ${mine} refs/heads/main ${a}\n`
    );

    expect(r.status).toBe(1);
  });
});

describe('the pre-push hook', () => {
  // The second check is the one that matters — the queue is where the ref goes
  // stale — and it is the cheap one to forget.
  it('asks either side of the gate lock, and before the gate runs', () => {
    const hook = readFileSync(HOOK, 'utf8');
    const acquire = hook.indexOf('"$GATE_LOCK" acquire dgmo');
    const gate = hook.indexOf('run_gate "$sha"', acquire);
    const before = hook.indexOf('stale_ref_check before-lock');
    const after = hook.indexOf('stale_ref_check after-lock');

    expect(acquire).toBeGreaterThan(-1);
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(acquire);
    expect(after).toBeGreaterThan(acquire);
    expect(after).toBeLessThan(gate);
  });
});
