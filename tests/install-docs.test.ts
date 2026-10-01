// install-docs.test.ts — every surface that tells a reader (or an agent) how
// to install the CLI leads with the npm line, and none tells them to brew.
//
// Homebrew is macOS-only, so a brew-only line sends a Linux reader to install
// a package manager to get a Node CLI that npm installs directly (#921). The
// owner's decision: `npm install -g @diagrammo/dgmo-cli` is the one universal
// line, described as macOS and Linux; brew and pacman live only on
// diagrammo.app/dev. Windows is not named until a windows-latest job has run.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

const NPM_LINE = 'npm install -g @diagrammo/dgmo-cli';

// Each one carries an install instruction for the CLI.
const SURFACES = [
  'README.md',
  'cli/README.md',
  'docs/ai-integration.md',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  '.claude/commands/dgmo.md',
  '.claude/commands/dgmo-codebase-report.md',
];

describe('CLI install instructions (#921)', () => {
  it.each(SURFACES)('%s gives the npm line and no brew install', (path) => {
    const text = readFileSync(join(repo, path), 'utf8');
    expect(text).toContain(NPM_LINE);
    expect(text).not.toMatch(/brew install/);
  });
});
