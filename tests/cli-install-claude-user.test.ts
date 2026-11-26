// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ============================================================
// `dgmo install claude-code` (user scope) registers the MCP server where
// Claude Code reads user-scoped servers: ~/.claude.json (#2317). It wrote
// ~/.claude/settings.json, which Claude Code ignores for MCP servers.
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
  pkg = mkdtempSync(join(REPO, 'node_modules', '.cli-install-claude-user-'));
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
  const top = mkdtempSync(join(tmpdir(), 'dgmo-install-claude-user-'));
  tops.push(top);
  const home = join(top, 'home');
  const cwd = join(top, 'cwd');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(cwd);
  return { home, cwd };
}

describe.runIf(process.platform !== 'win32')(
  'dgmo install claude-code, user scope',
  () => {
    it('writes mcpServers.dgmo to ~/.claude.json and keeps what was there', () => {
      const { home, cwd } = scratchHome();
      const claudeJson = join(home, '.claude.json');
      writeFileSync(
        claudeJson,
        JSON.stringify({
          numStartups: 7,
          mcpServers: { other: { command: 'other', args: [] } },
        })
      );
      const run = spawnSync(process.execPath, [cli, 'install', 'claude-code'], {
        cwd,
        env: {
          ...process.env,
          HOME: home,
          // OpenCode's config follows XDG_CONFIG_HOME (#2379): keep it in HOME.
          XDG_CONFIG_HOME: join(home, '.config'),
          USERPROFILE: home,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          NO_COLOR: '1',
        },
        encoding: 'utf-8',
        timeout: 60_000,
      });
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const cfg = JSON.parse(readFileSync(claudeJson, 'utf-8'));
      expect(cfg.mcpServers.dgmo).toEqual({ command: 'dgmo', args: ['mcp'] });
      expect(cfg.mcpServers.other).toEqual({ command: 'other', args: [] });
      expect(cfg.numStartups).toBe(7);

      const settings = join(home, '.claude', 'settings.json');
      if (existsSync(settings)) {
        expect(JSON.parse(readFileSync(settings, 'utf-8')).mcpServers).toBe(
          undefined
        );
      }
    });
  }
);
