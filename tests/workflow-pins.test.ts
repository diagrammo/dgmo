import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const github = resolve(__dirname, '../.github');
const workflows = resolve(github, 'workflows');

/**
 * Every action a workflow runs is pinned to a full commit SHA, with the
 * release it is in as a comment: `owner/action@<40 hex> # vX.Y.Z`
 * (diagrammo/diagrammo#1779). A tag like `@v6` can be moved to any commit by
 * whoever controls the action, and `release.yml` and `release-cli.yml` run
 * with npm Trusted Publishing (OIDC) rights — a retagged action there
 * publishes as us.
 *
 * Local actions (`./path`) and `docker://` images are not tags, so they are
 * out of scope. `.github/dependabot.yml` keeps the pins current.
 */
describe('workflow action pins', () => {
  const files = readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f));

  const uses = files.flatMap((file) =>
    readFileSync(resolve(workflows, file), 'utf8')
      .split('\n')
      .map((line, i) => ({ file, line: i + 1, text: line }))
      .filter(({ text }) => /^\s*(-\s*)?uses:/.test(text))
  );

  it('finds the workflows it is checking', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(uses.length).toBeGreaterThan(0);
  });

  it('pins every third-party action to a commit SHA with its version', () => {
    const unpinned = uses
      .filter(({ text }) => !/uses:\s*['"]?(\.\/|docker:\/\/)/.test(text))
      .filter(
        ({ text }) =>
          !/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/.test(
            text
          )
      )
      .map(({ file, line, text }) => `${file}:${line} ${text.trim()}`);
    expect(unpinned).toEqual([]);
  });

  it('has Dependabot keep the github-actions pins current', () => {
    const config = readFileSync(resolve(github, 'dependabot.yml'), 'utf8');
    expect(config).toMatch(/package-ecosystem:\s*['"]?github-actions['"]?/);
  });
});
