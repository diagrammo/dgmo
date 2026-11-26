// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ============================================================
// `dgmo install gemini` and `dgmo install antigravity` (diagrammo/diagrammo#2378)
// write the dgmo MCP server and the dgmo-diagramming skill for Google's two
// CLIs:
//   Gemini CLI       ~/.gemini/settings.json          key mcpServers
//   Antigravity CLI  ~/.gemini/config/mcp_config.json key mcpServers
//   both             ~/.gemini/skills/dgmo-diagramming/SKILL.md, at either
//                    scope. Antigravity reads no user ~/.agents/skills; Gemini
//                    CLI reads both and loads a same-named skill once, so a
//                    shared copy (#2380) beside it must be identical.
//
// The CLI is bundled from src/cli.ts, as in cli-install-claude-user.test.ts.
// HOME is a temp directory, PATH holds only stand-ins, so nothing outside the
// test is written or installed.
// ============================================================

const REPO = resolve(__dirname, '..');
const DGMO = { command: 'dgmo', args: ['mcp'] };
let pkg: string;
let cli: string;
let bin: string;
const tops: string[] = [];

beforeAll(async () => {
  pkg = mkdtempSync(join(REPO, 'node_modules', '.cli-install-gemini-'));
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

function scratch(): { home: string; cwd: string } {
  const top = mkdtempSync(join(tmpdir(), 'dgmo-install-gemini-'));
  tops.push(top);
  const home = join(top, 'home');
  const cwd = join(top, 'cwd');
  mkdirSync(home);
  mkdirSync(cwd);
  return { home, cwd };
}

// PATH is the stand-ins only, so auto-detect sees no real assistant binary.
function install(home: string, cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [cli, 'install', ...args], {
    cwd,
    env: {
      HOME: home,
      USERPROFILE: home,
      PATH: bin,
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  expect(run.status, run.stdout + run.stderr).toBe(0);
  return run.stdout;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const sharedSkill = (home: string) =>
  join(home, '.agents', 'skills', 'dgmo-diagramming', 'SKILL.md');
const geminiSkill = (home: string) =>
  join(home, '.gemini', 'skills', 'dgmo-diagramming', 'SKILL.md');
// Every copy of the skill Gemini CLI and Antigravity CLI would load.
const skillCopies = (home: string) =>
  [sharedSkill(home), geminiSkill(home)].filter((p) => existsSync(p));

function enableCodexPlugin(home: string): void {
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(
    join(home, '.codex', 'config.toml'),
    '[plugins."diagrammo@diagrammo"]\nenabled = true\n'
  );
}

const TARGETS = [
  {
    target: 'gemini',
    config: (home: string) => join(home, '.gemini', 'settings.json'),
  },
  {
    target: 'antigravity',
    config: (home: string) =>
      join(home, '.gemini', 'config', 'mcp_config.json'),
  },
] as const;

describe.runIf(process.platform !== 'win32')(
  'dgmo install gemini / antigravity',
  () => {
    describe.each(TARGETS)('$target', ({ target, config }) => {
      it('writes a fresh config and the skill', () => {
        const { home, cwd } = scratch();
        install(home, cwd, target);

        expect(readJson(config(home))).toEqual({ mcpServers: { dgmo: DGMO } });
        expect(readFileSync(geminiSkill(home), 'utf-8')).toBe(
          readFileSync(join(REPO, 'SKILL.md'), 'utf-8')
        );
        expect(existsSync(sharedSkill(home))).toBe(false);
      });

      it('beside a shared copy writes the same skill, so Gemini CLI loads one', () => {
        const { home, cwd } = scratch();
        install(home, cwd, 'agents');
        install(home, cwd, target);
        expect(skillCopies(home)).toEqual([
          sharedSkill(home),
          geminiSkill(home),
        ]);
        expect(readFileSync(geminiSkill(home), 'utf-8')).toBe(
          readFileSync(sharedSkill(home), 'utf-8')
        );
      });

      it('with the Codex plugin enabled still writes ~/.gemini/skills', () => {
        const { home, cwd } = scratch();
        enableCodexPlugin(home);
        install(home, cwd, target);
        expect(skillCopies(home)).toEqual([geminiSkill(home)]);
      });

      it('--scope project still writes the skill to ~/.gemini/skills', () => {
        const { home, cwd } = scratch();
        install(home, cwd, target, '--scope', 'project');
        expect(existsSync(geminiSkill(home))).toBe(true);
        expect(existsSync(join(cwd, '.agents'))).toBe(false);
        expect(existsSync(join(cwd, '.gemini', 'skills'))).toBe(false);
      });

      it('merges into an existing config and keeps the other servers and keys', () => {
        const { home, cwd } = scratch();
        const path = config(home);
        mkdirSync(resolve(path, '..'), { recursive: true });
        writeFileSync(
          path,
          JSON.stringify({
            theme: 'GitHub',
            mcpServers: { other: { command: 'other', args: ['x'] } },
          })
        );
        install(home, cwd, target);

        expect(readJson(path)).toEqual({
          theme: 'GitHub',
          mcpServers: {
            other: { command: 'other', args: ['x'] },
            dgmo: DGMO,
          },
        });
      });

      it('a second run changes nothing', () => {
        const { home, cwd } = scratch();
        const path = config(home);
        mkdirSync(resolve(path, '..'), { recursive: true });
        writeFileSync(
          path,
          JSON.stringify({ mcpServers: { other: { command: 'other' } } })
        );
        install(home, cwd, target);
        const first = readFileSync(path, 'utf-8');
        install(home, cwd, target);
        expect(readFileSync(path, 'utf-8')).toBe(first);
        expect(Object.keys(readJson(path).mcpServers)).toEqual([
          'other',
          'dgmo',
        ]);
      });
    });

    it('gemini --scope project writes .gemini/settings.json in the current directory', () => {
      const { home, cwd } = scratch();
      install(home, cwd, 'gemini', '--scope', 'project');
      expect(readJson(join(cwd, '.gemini', 'settings.json'))).toEqual({
        mcpServers: { dgmo: DGMO },
      });
      expect(existsSync(join(home, '.gemini', 'settings.json'))).toBe(false);
    });

    it('antigravity --scope project writes its user config and nothing in the current directory', () => {
      const { home, cwd } = scratch();
      install(home, cwd, 'antigravity', '--scope', 'project');
      expect(
        readJson(join(home, '.gemini', 'config', 'mcp_config.json'))
      ).toEqual({ mcpServers: { dgmo: DGMO } });
      expect(existsSync(geminiSkill(home))).toBe(true);
      expect(readdirSync(cwd)).toEqual([]);
    });

    it('a bare `dgmo install` detects both from their config files', () => {
      const { home, cwd } = scratch();
      mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
      writeFileSync(join(home, '.gemini', 'settings.json'), '{}');
      const out = install(home, cwd);

      expect(out).toContain('Detected: gemini, antigravity');
      expect(readJson(join(home, '.gemini', 'settings.json'))).toEqual({
        mcpServers: { dgmo: DGMO },
      });
      expect(
        readJson(join(home, '.gemini', 'config', 'mcp_config.json'))
      ).toEqual({ mcpServers: { dgmo: DGMO } });
      expect(skillCopies(home)).toEqual([sharedSkill(home), geminiSkill(home)]);
      expect(readFileSync(geminiSkill(home), 'utf-8')).toBe(
        readFileSync(sharedSkill(home), 'utf-8')
      );
      // gemini and antigravity share one file; it is written once per target.
      expect(out.match(/Skill → ~\/\.gemini\/skills/g) ?? []).toHaveLength(2);
    });

    it('a bare `dgmo install` with the Codex plugin enabled still gives Gemini the skill', () => {
      const { home, cwd } = scratch();
      mkdirSync(join(home, '.gemini'), { recursive: true });
      writeFileSync(join(home, '.gemini', 'settings.json'), '{}');
      enableCodexPlugin(home);
      install(home, cwd);
      expect(skillCopies(home)).toEqual([geminiSkill(home)]);
    });

    it('a bare `dgmo install` detects both from `gemini` and `agy` on the PATH', () => {
      const { home, cwd } = scratch();
      for (const name of ['gemini', 'agy']) {
        writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n');
        chmodSync(join(bin, name), 0o755);
      }
      try {
        const out = install(home, cwd);
        expect(out).toContain('Detected: gemini, antigravity');
      } finally {
        rmSync(join(bin, 'gemini'));
        rmSync(join(bin, 'agy'));
      }
    });

    it('a bare `dgmo install` sets up neither with no sign of them', () => {
      const { home, cwd } = scratch();
      const out = install(home, cwd);
      expect(out).toContain('No AI assistants detected');
      expect(existsSync(join(home, '.gemini'))).toBe(false);
    });

    it('install help lists gemini, antigravity and agents', () => {
      const { home, cwd } = scratch();
      const out = install(home, cwd, '--help');
      expect(out).toMatch(/Targets:.*gemini, antigravity, agents/);
    });
  }
);
