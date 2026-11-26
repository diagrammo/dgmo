import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODEX_PLUGIN } from './cli-codex-plugin';

// The shared skills folder (diagrammo/diagrammo#2380). Gemini CLI, Antigravity,
// OpenCode, Cursor, Amp, Goose, Junie and Kilo Code read ~/.agents/skills, so
// one copy there reaches each without a per-harness target. Codex reads it too.
//
// Duplicates, checked 2026-11-26:
// - Codex (codex-cli 0.172.0) reads ~/.codex/skills AND ~/.agents/skills and
//   lists a same-named skill once per folder (`codex debug prompt-input`). Its
//   plugin's skill is a third entry, `diagrammo:dgmo-diagramming`. So the
//   legacy ~/.codex/skills copy goes, and with the plugin enabled the shared
//   copy is not written.
// - OpenCode loads one skill per ID, the later source winning; Amp takes the
//   first `name`. Both also read ~/.claude/skills, but `dgmo install` writes
//   Claude Code's skill to ~/.claude/commands, which neither reads.
export const SHARED_SKILL_NAME = 'dgmo-diagramming';

/** Where the shared copy goes: `<base>/.agents/skills/dgmo-diagramming/SKILL.md`. */
export function sharedSkillPath(base: string): string {
  return join(base, '.agents', 'skills', SHARED_SKILL_NAME, 'SKILL.md');
}

/** The copy Codex reads beside the shared one; a shared copy replaces it. */
export function legacyCodexSkillDir(home: string): string {
  return join(home, '.codex', 'skills', SHARED_SKILL_NAME);
}

/** True when ~/.codex/config.toml enables the Diagrammo Codex plugin. */
export function codexPluginEnabled(home: string): boolean {
  const config = join(home, '.codex', 'config.toml');
  if (!existsSync(config)) return false;
  const toml = readFileSync(config, 'utf-8');
  const at = toml.indexOf(`[plugins."${CODEX_PLUGIN}"]`);
  if (at < 0) return false;
  const table = toml.slice(at).split(/\n(?=\[)/)[0] ?? '';
  return !/^\s*enabled\s*=\s*false\b/m.test(table);
}
