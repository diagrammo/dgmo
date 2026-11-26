// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ============================================================
// `dgmo install` writes the skill once to the shared ~/.agents/skills folder
// (diagrammo/diagrammo#2380), and never leaves a second copy where a harness
// that reads two folders would list it twice: Codex reads ~/.codex/skills and
// ~/.agents/skills, and its plugin carries the skill as well.
//
// The CLI is bundled from src/cli.ts, as in cli-install-symlink.test.ts,
// because CI runs `pnpm test` before `pnpm build`. HOME is a temp directory and
// `npm` is a stand-in, so nothing outside the test is written or installed.
// ============================================================

const REPO = resolve(__dirname, '..');
let pkg: string;
let cli: string;
let bin: string;
const tops: string[] = [];

beforeAll(async () => {
  pkg = mkdtempSync(join(REPO, 'node_modules', '.cli-install-shared-skill-'));
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
  for (const f of ['SKILL.md', join('.claude', 'commands')]) {
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
  for (const top of tops) rmSync(top, { recursive: true, force: true });
});

function scratchHome(): { home: string; cwd: string } {
  const top = mkdtempSync(join(tmpdir(), 'dgmo-install-shared-skill-'));
  tops.push(top);
  const home = join(top, 'home');
  const cwd = join(top, 'cwd');
  mkdirSync(cwd);
  return { home, cwd };
}

function install(home: string, cwd: string, args: string[]) {
  const run = spawnSync(process.execPath, [cli, 'install', ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      // Only the stand-ins: no real codex, so its plugin route is never taken.
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  expect(run.status, run.stdout + run.stderr).toBe(0);
  return run.stdout;
}

const shared = (base: string) =>
  join(base, '.agents', 'skills', 'dgmo-diagramming', 'SKILL.md');

describe.runIf(process.platform !== 'win32')(
  'dgmo install, shared skills folder',
  () => {
    it('agents target writes the skill, and a re-run leaves one identical copy', () => {
      const { home, cwd } = scratchHome();
      install(home, cwd, ['agents']);
      const first = readFileSync(shared(home), 'utf-8');
      expect(first).toBe(readFileSync(join(REPO, 'SKILL.md'), 'utf-8'));
      expect(first).toMatch(/^---\nname: dgmo-diagramming\n/);

      install(home, cwd, ['agents']);
      expect(readFileSync(shared(home), 'utf-8')).toBe(first);
      expect(readdirSync(join(home, '.agents', 'skills'))).toEqual([
        'dgmo-diagramming',
      ]);
    });

    it('auto-detect writes it even when no assistant is detected', () => {
      const { home, cwd } = scratchHome();
      const out = install(home, cwd, []);
      expect(out).toContain('No AI assistants detected');
      expect(existsSync(shared(home))).toBe(true);
    });

    it('codex without its plugin gets the shared copy, once, and the old ~/.codex copy goes', () => {
      const { home, cwd } = scratchHome();
      const legacy = join(home, '.codex', 'skills', 'dgmo-diagramming');
      mkdirSync(legacy, { recursive: true });
      writeFileSync(join(legacy, 'SKILL.md'), 'stale');
      // Auto-detect finds Codex by ~/.codex, then writes the shared folder too.
      const out = install(home, cwd, []);
      expect(out).toContain('codex');
      expect(existsSync(shared(home))).toBe(true);
      expect(existsSync(legacy)).toBe(false);
      const writes = out.match(/Skill → ~\/\.agents\/skills/g) ?? [];
      expect(writes).toHaveLength(1);
    });

    it('skips the shared copy while the Codex plugin is enabled', () => {
      const { home, cwd } = scratchHome();
      mkdirSync(join(home, '.codex'), { recursive: true });
      writeFileSync(
        join(home, '.codex', 'config.toml'),
        '[plugins."diagrammo@diagrammo"]\nenabled = true\n'
      );
      const out = install(home, cwd, ['agents']);
      expect(out).toContain('the Codex plugin carries the skill');
      expect(existsSync(shared(home))).toBe(false);
    });

    it('writes it again once the plugin is disabled', () => {
      const { home, cwd } = scratchHome();
      mkdirSync(join(home, '.codex'), { recursive: true });
      writeFileSync(
        join(home, '.codex', 'config.toml'),
        '[plugins."diagrammo@diagrammo"]\nenabled = false\n'
      );
      install(home, cwd, ['agents']);
      expect(existsSync(shared(home))).toBe(true);
    });

    it('project scope writes ./.agents/skills and leaves home alone', () => {
      const { home, cwd } = scratchHome();
      install(home, cwd, ['agents', '--scope', 'project']);
      expect(existsSync(shared(cwd))).toBe(true);
      expect(existsSync(join(home, '.agents'))).toBe(false);
    });

    it('--dry-run writes nothing', () => {
      const { home, cwd } = scratchHome();
      const out = install(home, cwd, ['agents', '--dry-run']);
      expect(out).toContain('[dry-run] would write Skill → ~/.agents/skills');
      expect(existsSync(join(home, '.agents'))).toBe(false);
    });
  }
);
