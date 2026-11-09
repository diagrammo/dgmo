import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  installCodexPlugin,
  withoutDgmoCodexServer,
  type CodexRun,
} from '../src/cli-codex-plugin';

const LEGACY_TOML =
  'model = "o3"\n\n[mcp_servers.dgmo]\ncommand = "dgmo"\nargs = ["mcp"]\n\n[mcp_servers.other]\ncommand = "x"\n';

function legacyHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'codex-plugin-'));
  mkdirSync(join(home, '.codex', 'skills', 'dgmo-diagramming'), {
    recursive: true,
  });
  writeFileSync(
    join(home, '.codex', 'skills', 'dgmo-diagramming', 'SKILL.md'),
    'stale'
  );
  writeFileSync(join(home, '.codex', 'config.toml'), LEGACY_TOML);
  return home;
}

function fakeCodex(fail: string[] = []) {
  const calls: string[] = [];
  const codex = (args: string[]): CodexRun => {
    const line = args.join(' ');
    calls.push(line);
    return {
      status: fail.some((f) => line.startsWith(f)) ? 1 : 0,
      stderr: 'nope',
    };
  };
  return { calls, codex };
}

describe('installCodexPlugin', () => {
  it('adds the marketplace, upgrades it, installs the plugin and retires the legacy copies', () => {
    const home = legacyHome();
    const { calls, codex } = fakeCodex();
    expect(
      installCodexPlugin({ dryRun: false, home, codex, log: () => {} })
    ).toBe(true);
    expect(calls).toEqual([
      'plugin --help',
      'plugin marketplace add diagrammo/skills',
      'plugin marketplace upgrade diagrammo',
      'plugin add diagrammo@diagrammo',
    ]);
    expect(existsSync(join(home, '.codex', 'skills', 'dgmo-diagramming'))).toBe(
      false
    );
    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf-8');
    expect(toml).not.toContain('mcp_servers.dgmo');
    expect(toml).toContain('[mcp_servers.other]');
  });

  it('changes nothing and reports false when Codex has no plugin command', () => {
    const home = legacyHome();
    const { calls, codex } = fakeCodex(['plugin --help']);
    expect(
      installCodexPlugin({ dryRun: false, home, codex, log: () => {} })
    ).toBe(false);
    expect(calls).toEqual(['plugin --help']);
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf-8')).toBe(
      LEGACY_TOML
    );
  });

  it('keeps the legacy copies when the plugin install is refused', () => {
    const home = legacyHome();
    const { codex } = fakeCodex(['plugin add']);
    expect(
      installCodexPlugin({ dryRun: false, home, codex, log: () => {} })
    ).toBe(false);
    expect(
      existsSync(join(home, '.codex', 'skills', 'dgmo-diagramming', 'SKILL.md'))
    ).toBe(true);
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf-8')).toBe(
      LEGACY_TOML
    );
  });

  it('only describes the commands in a dry run', () => {
    const home = legacyHome();
    const { calls, codex } = fakeCodex();
    expect(
      installCodexPlugin({ dryRun: true, home, codex, log: () => {} })
    ).toBe(true);
    expect(calls).toEqual(['plugin --help']);
    expect(existsSync(join(home, '.codex', 'skills', 'dgmo-diagramming'))).toBe(
      true
    );
  });
});

describe('withoutDgmoCodexServer', () => {
  it('leaves a config with no dgmo table alone', () => {
    expect(withoutDgmoCodexServer('model = "o3"\n')).toBe('model = "o3"\n');
  });
});
