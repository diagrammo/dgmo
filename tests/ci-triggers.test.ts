import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ciYml = resolve(__dirname, '../.github/workflows/ci.yml');

/**
 * CI runs on pull requests and by hand, never on a push to main
 * (diagrammo/diagrammo#1821). Every push to main has already passed
 * .githooks/pre-push, which runs the same steps, so a push-triggered run only
 * spent the org's free Actions minutes — and the org budget hard-stops every
 * workflow once those are gone.
 *
 * Reads the top-level `on:` block as text: the keys directly under it are its
 * two-space-indented lines, up to the next top-level key.
 */
function triggers(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start < 0) return [];
  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([a-z_]+):/.exec(line);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe('ci.yml triggers', () => {
  const keys = triggers(readFileSync(ciYml, 'utf8'));

  it('runs on pull requests and by hand', () => {
    expect(keys).toContain('pull_request');
    expect(keys).toContain('workflow_dispatch');
  });

  it('does not run on a push to main', () => {
    expect(keys).not.toContain('push');
  });
});
