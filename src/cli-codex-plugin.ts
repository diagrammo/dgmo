import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The Codex plugin (diagrammo/skills, #1791): the dgmo MCP server and the
// skills in one versioned package that `codex plugin marketplace upgrade`
// refreshes. A copied SKILL.md is never refreshed — it kept offering removed
// chart types after dgmo moved on. Plugins are per-user, so a project-scope
// install, or a Codex without `codex plugin`, keeps the legacy file copy.
// Commands checked against codex-cli 0.166.0, 2026-11-09.
export const CODEX_MARKETPLACE_REPO = 'diagrammo/skills';
export const CODEX_MARKETPLACE = 'diagrammo';
export const CODEX_PLUGIN = `diagrammo@${CODEX_MARKETPLACE}`;

export interface CodexRun {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
}

export interface CodexPluginDeps {
  dryRun: boolean;
  home: string;
  codex: (args: string[]) => CodexRun;
  log: (line: string) => void;
}

/** Drop the `[mcp_servers.dgmo]` table a legacy install wrote. */
export function withoutDgmoCodexServer(toml: string): string {
  return toml.replace(/\[mcp_servers\.dgmo\][^[]*/, '');
}

/**
 * Install the Diagrammo Codex plugin. Returns false — having changed nothing —
 * when this Codex has no plugin command or refuses the install, so the caller
 * falls back to the file copy.
 */
export function installCodexPlugin(deps: CodexPluginDeps): boolean {
  const { codex, log } = deps;
  if (codex(['plugin', '--help']).status !== 0) return false;
  if (deps.dryRun) {
    log(
      `  [dry-run] would run: codex plugin marketplace add ${CODEX_MARKETPLACE_REPO}`
    );
    log(`  [dry-run] would run: codex plugin add ${CODEX_PLUGIN}`);
    return true;
  }
  const said = (r: CodexRun) =>
    [r.stderr, r.stdout].find((t) => t?.trim())?.trim() ?? '';
  const add = codex(['plugin', 'marketplace', 'add', CODEX_MARKETPLACE_REPO]);
  if (add.status !== 0) {
    log(
      `  codex plugin marketplace add failed — installing the skill file instead.\n  ${said(add)}`
    );
    return false;
  }
  // An already-added Git marketplace is a snapshot; take the newest one.
  codex(['plugin', 'marketplace', 'upgrade', CODEX_MARKETPLACE]);
  const plugin = codex(['plugin', 'add', CODEX_PLUGIN]);
  if (plugin.status !== 0) {
    log(
      `  codex plugin add failed — installing the skill file instead.\n  ${said(plugin)}`
    );
    return false;
  }
  log(`✓ Codex plugin → ${CODEX_PLUGIN} (MCP server + skills)`);

  // The plugin carries both, so retire what a previous install copied in: a
  // skill that would never update, and a second `dgmo` server.
  const legacySkill = join(deps.home, '.codex', 'skills', 'dgmo-diagramming');
  if (existsSync(legacySkill)) {
    rmSync(legacySkill, { recursive: true, force: true });
    log('✓ Removed the old ~/.codex/skills/dgmo-diagramming copy');
  }
  const configPath = join(deps.home, '.codex', 'config.toml');
  if (existsSync(configPath)) {
    const config = readFileSync(configPath, 'utf-8');
    const next = withoutDgmoCodexServer(config);
    if (next !== config) {
      writeFileSync(configPath, next, 'utf-8');
      log(`✓ Removed [mcp_servers.dgmo] from ${configPath}`);
    }
  }
  log(
    `  Update later with: codex plugin marketplace upgrade ${CODEX_MARKETPLACE}`
  );
  return true;
}
