// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as GuardModule from '../src/cli-install-guard';
// Imported lazily, inside the unit tests: with the fix reverted the module is
// gone, and the CLI tests below must still run and fail on what install does.
let guard: typeof GuardModule;

// ============================================================
// `dgmo install` must not write through a symlink in the directory it runs in
// ============================================================
//
// A repo can commit `.cursorrules`, `.mcp.json` or `.github` as a symlink to a
// file of the user's outside the checkout. Followed, the installer replaces
// that file with packaged text or a merged JSON document (#1867).
//
// The CLI is bundled from `src/cli.ts`, as in cli-share-clipboard.test.ts,
// because CI runs `pnpm test` before `pnpm build`. Its package root (the
// bundle's parent directory) gets the packaged files `cli.ts` reads. HOME is a
// temp directory, and `npm` is a stand-in, so nothing outside the test is
// written and nothing is installed.
// ============================================================

const REPO = resolve(__dirname, '..');
const OUTSIDE_TEXT = 'the user file outside the checkout\n';

// [target, path under the cwd that install writes, what install writes there]
const CASES = [
  ['cursor', '.cursorrules', 'rules'],
  ['windsurf', '.windsurfrules', 'rules'],
  ['copilot', '.github/copilot-instructions.md', 'rules'],
  ['claude-code', '.mcp.json', 'json'],
  ['cursor', '.cursor/mcp.json', 'json'],
  ['copilot', '.github/mcp.json', 'json'],
] as const;

let pkg: string;
let cli: string;
let bin: string;
const tops: string[] = [];

afterAll(() => {
  for (const top of tops) rmSync(top, { recursive: true, force: true });
});

function scratch(): { cwd: string; home: string; outside: string } {
  const top = mkdtempSync(join(tmpdir(), 'dgmo-install-symlink-'));
  tops.push(top);
  const cwd = join(top, 'repo');
  const home = join(top, 'home');
  mkdirSync(cwd);
  mkdirSync(home);
  const outside = join(top, 'outside.txt');
  writeFileSync(outside, OUTSIDE_TEXT);
  return { cwd, home, outside };
}

function install(target: string, cwd: string, home: string) {
  return spawnSync(
    process.execPath,
    [cli, 'install', target, '--scope', 'project'],
    {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        NO_COLOR: '1',
      },
      encoding: 'utf-8',
      timeout: 60_000,
    }
  );
}

describe('symlinkOutside', () => {
  beforeAll(async () => {
    guard = await import('../src/cli-install-guard');
  });

  it('finds a link leaving the root, at the leaf or on the way to it', () => {
    const { cwd, outside } = scratch();
    expect(guard.symlinkOutside(cwd, join(cwd, 'missing', 'file'))).toBeNull();
    writeFileSync(join(cwd, 'plain'), 'x');
    expect(guard.symlinkOutside(cwd, join(cwd, 'plain'))).toBeNull();
    symlinkSync(outside, join(cwd, 'leaf'));
    expect(guard.symlinkOutside(cwd, join(cwd, 'leaf'))).toBe(
      join(cwd, 'leaf')
    );
    symlinkSync(resolve(outside, '..'), join(cwd, 'dir'));
    expect(guard.symlinkOutside(cwd, join(cwd, 'dir', 'outside.txt'))).toBe(
      join(cwd, 'dir')
    );
    // A dangling link would create its target wherever it points.
    symlinkSync(join(cwd, '..', 'nowhere'), join(cwd, 'dangling'));
    expect(guard.symlinkOutside(cwd, join(cwd, 'dangling'))).toBe(
      join(cwd, 'dangling')
    );
    // A path outside the root is not the guard's business (the home configs).
    expect(guard.symlinkOutside(cwd, outside)).toBeNull();
  });

  it('follows a link that stays inside the root', () => {
    const { cwd } = scratch();
    writeFileSync(join(cwd, 'CLAUDE.md'), 'x');
    symlinkSync('CLAUDE.md', join(cwd, 'AGENTS.md'));
    expect(guard.symlinkOutside(cwd, join(cwd, 'AGENTS.md'))).toBeNull();
    mkdirSync(join(cwd, 'real'));
    symlinkSync(join(cwd, 'real'), join(cwd, 'alias'));
    expect(guard.symlinkOutside(cwd, join(cwd, 'alias', 'f'))).toBeNull();
  });
});

describe('cwdHoldsHome', () => {
  beforeAll(async () => {
    guard = await import('../src/cli-install-guard');
  });

  it('is true at the home directory and above it, false below it', () => {
    expect(guard.cwdHoldsHome('/home/u', '/home/u')).toBe(true);
    expect(guard.cwdHoldsHome('/home', '/home/u')).toBe(true);
    expect(guard.cwdHoldsHome('/home/u/repo', '/home/u')).toBe(false);
    expect(guard.cwdHoldsHome('/srv/repo', '/home/u')).toBe(false);
  });
});

describe.runIf(process.platform !== 'win32')(
  'dgmo install refuses a symlink in the current directory',
  () => {
    beforeAll(async () => {
      pkg = mkdtempSync(join(REPO, 'node_modules', '.cli-install-symlink-'));
      cli = join(pkg, 'dist', 'cli.cjs');
      await build({
        entryPoints: [join(REPO, 'src', 'cli.ts')],
        outfile: cli,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['@resvg/resvg-js', 'jsdom'],
        logLevel: 'silent',
      });
      for (const f of [
        '.cursorrules',
        '.windsurfrules',
        'SKILL.md',
        join('.github', 'copilot-instructions.md'),
        join('.claude', 'commands'),
      ]) {
        cpSync(join(REPO, f), join(pkg, f), { recursive: true });
      }
      bin = join(pkg, 'bin');
      mkdirSync(bin);
      for (const name of ['npm', 'dgmo-mcp']) {
        writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n');
        chmodSync(join(bin, name), 0o755);
      }
      // No Codex plugin support: the codex target takes its file-writing path.
      writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexit 1\n');
      chmodSync(join(bin, 'codex'), 0o755);
    }, 60_000);

    afterAll(() => {
      rmSync(pkg, { recursive: true, force: true });
    });

    it.each(CASES)(
      '%s: %s as a symlink fails and leaves the outside file alone',
      (target, rel) => {
        const { cwd, home, outside } = scratch();
        mkdirSync(join(cwd, rel, '..'), { recursive: true });
        symlinkSync(outside, join(cwd, rel));
        const run = install(target, cwd, home);
        expect(run.status, run.stdout + run.stderr).not.toBe(0);
        expect(run.stderr).toContain(join(cwd, rel));
        expect(run.stderr).toContain('symbolic link');
        expect(readFileSync(outside, 'utf-8')).toBe(OUTSIDE_TEXT);
        expect(lstatSync(join(cwd, rel)).isSymbolicLink()).toBe(true);
      }
    );

    it('a symlinked .github directory is refused too', () => {
      const { cwd, home, outside } = scratch();
      const dir = resolve(outside, '..', 'elsewhere');
      mkdirSync(dir);
      symlinkSync(dir, join(cwd, '.github'));
      const run = install('copilot', cwd, home);
      expect(run.status, run.stdout + run.stderr).not.toBe(0);
      expect(run.stderr).toContain('symbolic link');
      expect(existsSync(join(dir, 'mcp.json'))).toBe(false);
      expect(existsSync(join(dir, 'copilot-instructions.md'))).toBe(false);
    });

    it.each(CASES)(
      '%s: %s missing or a regular file still installs',
      (target, rel, kind) => {
        const missing = scratch();
        const fresh = install(target, missing.cwd, missing.home);
        expect(fresh.status, fresh.stdout + fresh.stderr).toBe(0);
        expect(existsSync(join(missing.cwd, rel))).toBe(true);

        const { cwd, home } = scratch();
        mkdirSync(join(cwd, rel, '..'), { recursive: true });
        const before =
          kind === 'json'
            ? JSON.stringify({ mcpServers: { other: { command: 'x' } } })
            : 'old rules\n';
        writeFileSync(join(cwd, rel), before);
        const run = install(target, cwd, home);
        expect(run.status, run.stdout + run.stderr).toBe(0);
        const after = readFileSync(join(cwd, rel), 'utf-8');
        if (kind === 'json') {
          const servers = JSON.parse(after).mcpServers;
          expect(servers.other).toEqual({ command: 'x' });
          expect(servers.dgmo).toBeDefined();
        } else {
          expect(after).toBe(readFileSync(join(pkg, rel), 'utf-8'));
        }
      }
    );

    it('codex: AGENTS.md as a symlink to outside fails and leaves the file alone', () => {
      const { cwd, home, outside } = scratch();
      symlinkSync(outside, join(cwd, 'AGENTS.md'));
      const run = install('codex', cwd, home);
      expect(run.status, run.stdout + run.stderr).not.toBe(0);
      expect(run.stderr).toContain(join(cwd, 'AGENTS.md'));
      expect(readFileSync(outside, 'utf-8')).toBe(OUTSIDE_TEXT);
    });

    it('a link that stays inside the directory is followed as before', () => {
      const { cwd, home } = scratch();
      writeFileSync(join(cwd, 'CLAUDE.md'), '# repo notes\n');
      symlinkSync('CLAUDE.md', join(cwd, 'AGENTS.md'));
      const codex = install('codex', cwd, home);
      expect(codex.status, codex.stdout + codex.stderr).toBe(0);
      expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toContain(
        '# repo notes'
      );
      expect(
        readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8').length
      ).toBeGreaterThan('# repo notes\n'.length);

      mkdirSync(join(cwd, 'rules'));
      writeFileSync(join(cwd, 'rules', 'cursor.md'), 'old\n');
      symlinkSync(join('rules', 'cursor.md'), join(cwd, '.cursorrules'));
      const cursor = install('cursor', cwd, home);
      expect(cursor.status, cursor.stdout + cursor.stderr).toBe(0);
      expect(readFileSync(join(cwd, 'rules', 'cursor.md'), 'utf-8')).toBe(
        readFileSync(join(pkg, '.cursorrules'), 'utf-8')
      );
    });

    it('run from the home directory, nothing is checked', () => {
      const { home, outside } = scratch();
      symlinkSync(outside, join(home, '.cursorrules'));
      const run = install('cursor', home, home);
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(readFileSync(outside, 'utf-8')).toBe(
        readFileSync(join(pkg, '.cursorrules'), 'utf-8')
      );
    });

    it('--dry-run is unchanged: it reports, writes nothing and exits 0', () => {
      const { cwd, home, outside } = scratch();
      symlinkSync(outside, join(cwd, '.cursorrules'));
      const run = spawnSync(
        process.execPath,
        [cli, 'install', 'cursor', '--scope', 'project', '--dry-run'],
        {
          cwd,
          env: {
            ...process.env,
            HOME: home,
            PATH: `${bin}:${process.env.PATH}`,
          },
          encoding: 'utf-8',
          timeout: 60_000,
        }
      );
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain('[dry-run] would write');
      expect(readFileSync(outside, 'utf-8')).toBe(OUTSIDE_TEXT);
    });
  }
);
