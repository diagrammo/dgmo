import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { skillsInstallNote } from '../src/cli-install-notes';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

// The codebase report moved to the diagrammo/skills repo (#1108). dgmo no
// longer ships the slash command or the Codex skill re-skinned from it, and
// `dgmo install` closes by naming the skills repo and its install line.
describe('codebase report lives in diagrammo/skills (#1108)', () => {
  it('ships no dgmo-codebase-report command', () => {
    expect(
      existsSync(join(repo, '.claude/commands/dgmo-codebase-report.md'))
    ).toBe(false);
  });

  it('the installer writes no dgmo-codebase-report skill', () => {
    const cli = readFileSync(join(repo, 'src/cli.ts'), 'utf8');
    expect(cli).not.toContain('dgmo-codebase-report');
  });

  it('the closing note names the skills repo and its install lines', () => {
    const note = skillsInstallNote().join('\n');
    expect(note).toContain('github.com/diagrammo/skills');
    expect(note).toContain('/plugin marketplace add diagrammo/skills');
    expect(note).toContain('/plugin install diagrammo@diagrammo');
  });
});
