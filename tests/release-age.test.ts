import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(
  resolve(__dirname, '../pnpm-workspace.yaml'),
  'utf8'
);

/**
 * pnpm refuses any version published less than three days ago
 * (diagrammo/diagrammo#1781). Compromised npm versions have stayed live past
 * a day, so the one-day hold this replaced left part of that window open.
 */
describe('pnpm release-age hold', () => {
  it('holds new versions for at least three days', () => {
    const m = workspace.match(/^minimumReleaseAge:\s*(\d+)\s*$/m);
    expect(m, 'minimumReleaseAge is set in pnpm-workspace.yaml').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(3 * 24 * 60);
  });
});
