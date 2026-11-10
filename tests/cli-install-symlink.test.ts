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
import { symlinkUnder } from '../src/cli-install-guard';

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

function scratch(): { cwd: string; home: string; outside: string } {
  const top = mkdtempSync(join(tmpdir(), 'dgmo-install-symlink-'));
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

describe('symlinkUnder', () => {
  it('finds a link at the leaf or on the way to it, and nothing outside the root', () => {
    const { cwd, outside } = scratch();
    expect(symlinkUnder(cwd, join(cwd, 'missing', 'file'))).toBeNull();
    writeFileSync(join(cwd, 'plain'), 'x');
    expect(symlinkUnder(cwd, join(cwd, 'plain'))).toBeNull();
    symlinkSync(outside, join(cwd, 'leaf'));
    expect(symlinkUnder(cwd, join(cwd, 'leaf'))).toBe(join(cwd, 'leaf'));
    symlinkSync(resolve(outside, '..'), join(cwd, 'dir'));
    expect(symlinkUnder(cwd, join(cwd, 'dir', 'outside.txt'))).toBe(
      join(cwd, 'dir')
    );
    // A path outside the root is not the guard's business (the home configs).
    expect(symlinkUnder(cwd, outside)).toBeNull();
    expect(symlinkUnder(join(cwd, 'dir'), join(cwd, 'dir'))).toBeNull();
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
