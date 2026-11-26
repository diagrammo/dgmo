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
import { readJsonc } from '../src/cli-opencode-config';

// ============================================================
// `dgmo install opencode` (diagrammo/diagrammo#2379) writes the dgmo MCP
// server into OpenCode 2.x's config and gives it the dgmo-diagramming skill:
//   MCP    ~/.config/opencode/opencode.json (or .jsonc; ./opencode.json with
//          --scope project), key mcp.servers.dgmo = { type: "local",
//          command: ["dgmo", "mcp"] } — the shape `opencode mcp add dgmo --
//          dgmo mcp` writes (opencode 2.4.2, probed 2026-11-26)
//   skill  the shared ~/.agents/skills copy, which OpenCode reads; its own
//          ~/.config/opencode/skills when the Codex plugin skips that copy
// A config with comments is never rewritten, since that would drop them.
//
// The CLI is bundled from src/cli.ts, as in cli-install-gemini.test.ts. HOME
// is a temp directory, PATH holds only stand-ins, so nothing outside the test
// is written or installed.
// ============================================================

const REPO = resolve(__dirname, '..');
const DGMO = { type: 'local', command: ['dgmo', 'mcp'] };
let pkg: string;
let cli: string;
let bin: string;
const tops: string[] = [];

beforeAll(async () => {
  pkg = mkdtempSync(join(REPO, 'node_modules', '.cli-install-opencode-'));
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
  const top = mkdtempSync(join(tmpdir(), 'dgmo-install-opencode-'));
  tops.push(top);
  const home = join(top, 'home');
  const cwd = join(top, 'cwd');
  mkdirSync(home);
  mkdirSync(cwd);
  return { home, cwd };
}

function run(
  home: string,
  cwd: string,
  args: string[],
  env: Record<string, string> = {}
) {
  return spawnSync(process.execPath, [cli, 'install', ...args], {
    cwd,
    env: { HOME: home, USERPROFILE: home, PATH: bin, NO_COLOR: '1', ...env },
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

// PATH is the stand-ins only, so auto-detect sees no real assistant binary.
function install(home: string, cwd: string, ...args: string[]) {
  const r = run(home, cwd, args);
  expect(r.status, r.stdout + r.stderr).toBe(0);
  return r.stdout;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const configDir = (home: string) => join(home, '.config', 'opencode');
const config = (home: string) => join(configDir(home), 'opencode.json');
const sharedSkill = (home: string) =>
  join(home, '.agents', 'skills', 'dgmo-diagramming', 'SKILL.md');
const ownSkill = (home: string) =>
  join(configDir(home), 'skills', 'dgmo-diagramming', 'SKILL.md');

function writeConfig(path: string, body: string): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

describe.runIf(process.platform !== 'win32')('dgmo install opencode', () => {
  it('writes a fresh config and the skill', () => {
    const { home, cwd } = scratch();
    const out = install(home, cwd, 'opencode');

    expect(readJson(config(home))).toEqual({
      mcp: { servers: { dgmo: DGMO } },
    });
    expect(out).toContain('MCP server → ~/.config/opencode/opencode.json');
    expect(readFileSync(sharedSkill(home), 'utf-8')).toBe(
      readFileSync(join(REPO, 'SKILL.md'), 'utf-8')
    );
    expect(existsSync(ownSkill(home))).toBe(false);
  });

  it('merges into an existing config and keeps the other servers and keys', () => {
    const { home, cwd } = scratch();
    writeConfig(
      config(home),
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        theme: 'system',
        mcp: {
          timeout: 5000,
          servers: { other: { type: 'local', command: ['other', 'x'] } },
        },
      })
    );
    install(home, cwd, 'opencode');

    expect(readJson(config(home))).toEqual({
      $schema: 'https://opencode.ai/config.json',
      theme: 'system',
      mcp: {
        timeout: 5000,
        servers: {
          other: { type: 'local', command: ['other', 'x'] },
          dgmo: DGMO,
        },
      },
    });
  });

  it('a second run changes nothing', () => {
    const { home, cwd } = scratch();
    writeConfig(
      config(home),
      JSON.stringify({ mcp: { servers: { other: { type: 'local' } } } })
    );
    install(home, cwd, 'opencode');
    const first = readFileSync(config(home), 'utf-8');
    const out = install(home, cwd, 'opencode');
    expect(readFileSync(config(home), 'utf-8')).toBe(first);
    expect(Object.keys(readJson(config(home)).mcp.servers)).toEqual([
      'other',
      'dgmo',
    ]);
    expect(out).toContain('MCP server already in');
  });

  it('writes an existing opencode.jsonc rather than a new opencode.json', () => {
    const { home, cwd } = scratch();
    const jsonc = join(configDir(home), 'opencode.jsonc');
    writeConfig(jsonc, '{ "theme": "system" }\n');
    install(home, cwd, 'opencode');
    expect(readJson(jsonc)).toEqual({
      theme: 'system',
      mcp: { servers: { dgmo: DGMO } },
    });
    expect(existsSync(config(home))).toBe(false);
  });

  it('refuses to rewrite a config with comments, and says what to add', () => {
    const { home, cwd } = scratch();
    const jsonc = join(configDir(home), 'opencode.jsonc');
    const body = '{\n  // my theme\n  "theme": "system",\n}\n';
    writeConfig(jsonc, body);
    const r = run(home, cwd, ['opencode']);

    expect(r.status).toBe(1);
    expect(readFileSync(jsonc, 'utf-8')).toBe(body);
    expect(r.stderr).toContain('has comments');
    expect(r.stderr).toContain('opencode mcp add --global dgmo -- dgmo mcp');
    expect(r.stderr).toContain(`"dgmo": ${JSON.stringify(DGMO)}`);
    // The skill is still written.
    expect(existsSync(sharedSkill(home))).toBe(true);
  });

  it('a config with comments that already has the server is left as it is, and passes', () => {
    const { home, cwd } = scratch();
    const body =
      '{\n  // added by opencode mcp add\n  "mcp": { "servers": { "dgmo": ' +
      JSON.stringify(DGMO) +
      ' } }\n}\n';
    writeConfig(config(home), body);
    const out = install(home, cwd, 'opencode');
    expect(readFileSync(config(home), 'utf-8')).toBe(body);
    expect(out).toContain('MCP server already in');
  });

  it('leaves a config that is not JSON alone and fails', () => {
    const { home, cwd } = scratch();
    writeConfig(config(home), '{ "theme": ');
    const r = run(home, cwd, ['opencode']);
    expect(r.status).toBe(1);
    expect(readFileSync(config(home), 'utf-8')).toBe('{ "theme": ');
    expect(r.stderr).toContain('is not valid JSON');
  });

  it('--scope project writes ./opencode.json and the skill in ./.agents/skills', () => {
    const { home, cwd } = scratch();
    install(home, cwd, 'opencode', '--scope', 'project');
    expect(readJson(join(cwd, 'opencode.json'))).toEqual({
      mcp: { servers: { dgmo: DGMO } },
    });
    expect(existsSync(join(cwd, '.agents', 'skills', 'dgmo-diagramming'))).toBe(
      true
    );
    expect(existsSync(configDir(home))).toBe(false);
  });

  it('follows XDG_CONFIG_HOME, as OpenCode does', () => {
    const { home, cwd } = scratch();
    const xdg = join(home, 'xdg');
    const r = run(home, cwd, ['opencode'], { XDG_CONFIG_HOME: xdg });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readJson(join(xdg, 'opencode', 'opencode.json'))).toEqual({
      mcp: { servers: { dgmo: DGMO } },
    });
    expect(existsSync(configDir(home))).toBe(false);
  });

  it('with the Codex plugin enabled puts the skill in OpenCode’s own folder', () => {
    const { home, cwd } = scratch();
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      '[plugins."diagrammo@diagrammo"]\nenabled = true\n'
    );
    install(home, cwd, 'opencode');
    expect(existsSync(sharedSkill(home))).toBe(false);
    expect(readFileSync(ownSkill(home), 'utf-8')).toBe(
      readFileSync(join(REPO, 'SKILL.md'), 'utf-8')
    );
  });

  it('a bare `dgmo install` detects it from ~/.config/opencode', () => {
    const { home, cwd } = scratch();
    mkdirSync(configDir(home), { recursive: true });
    const out = install(home, cwd);
    expect(out).toContain('Detected: opencode');
    expect(readJson(config(home))).toEqual({
      mcp: { servers: { dgmo: DGMO } },
    });
    expect(existsSync(sharedSkill(home))).toBe(true);
  });

  it('a bare `dgmo install` detects it from `opencode` on the PATH', () => {
    const { home, cwd } = scratch();
    writeFileSync(join(bin, 'opencode'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'opencode'), 0o755);
    try {
      expect(install(home, cwd)).toContain('Detected: opencode');
    } finally {
      rmSync(join(bin, 'opencode'));
    }
  });

  it('a bare `dgmo install` with no sign of it writes no OpenCode config', () => {
    const { home, cwd } = scratch();
    const out = install(home, cwd);
    expect(out).toContain('No AI assistants detected');
    expect(existsSync(configDir(home))).toBe(false);
  });

  it('install help lists opencode', () => {
    const { home, cwd } = scratch();
    expect(install(home, cwd, '--help')).toMatch(
      /Targets:.*antigravity, opencode, agents/
    );
  });
});

describe('readJsonc', () => {
  it('reads comments and trailing commas, and says whether there were comments', () => {
    expect(readJsonc('{ "a": [1, 2,], }')).toEqual({
      cfg: { a: [1, 2] },
      comments: false,
    });
    expect(readJsonc('{\n  // line\n  /* block */ "a": 1\n}').comments).toBe(
      true
    );
  });

  it('leaves // , and a closing brace inside strings alone', () => {
    const { cfg, comments } = readJsonc(
      '{ "url": "https://x//y", "s": "a, }", "q": "\\"//" }'
    );
    expect(cfg).toEqual({ url: 'https://x//y', s: 'a, }', q: '"//' });
    expect(comments).toBe(false);
  });

  it('throws on a file that is not a JSON object', () => {
    expect(() => readJsonc('[1]')).toThrow();
    expect(() => readJsonc('{ "a": ')).toThrow();
  });
});
