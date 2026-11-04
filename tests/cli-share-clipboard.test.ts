// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ============================================================
// `dgmo share` must return when the clipboard tool stays in the background
// ============================================================
//
// `wl-copy` forks a daemon to hold the selection and `xclip` stays in the
// background by design. A child that keeps the output pipes `execSync` created
// means EOF never comes, so `dgmo share` blocked until something else took the
// clipboard and the user never got the URL (#1692).
//
// The stand-ins below do what the real tools do: read stdin, fork, exit 0.
// The hang is caught by the spawn's own timeout, never by a measured duration.
//
// CI runs `pnpm test` before `pnpm build`, and `prebuild` empties `dist/`, so a
// test gated on `cli/dist/cli.cjs` would not run there. It bundles `src/cli.ts`.
// ============================================================

const REPO = resolve(__dirname, '..');
// Outlives MUST_RETURN_WITHIN_MS: a daemon that died first would release the
// pipes and let the old code pass.
const DAEMON_SECONDS = 60;
const MUST_RETURN_WITHIN_MS = 30_000;

let dir: string;
let cli: string;

function standIn(name: string): { bin: string; received: string } {
  const bin = join(dir, `bin-${name}`);
  const received = join(dir, `received-${name}.txt`);
  mkdirSync(bin);
  const script = join(bin, name);
  writeFileSync(
    script,
    `#!/bin/sh\ncat > '${received}'\n(sleep ${DAEMON_SECONDS}) &\nexit 0\n`
  );
  chmodSync(script, 0o755);
  return { bin, received };
}

describe.runIf(process.platform === 'linux')('dgmo share clipboard', () => {
  beforeAll(async () => {
    // Inside the repo so the externals below resolve from its node_modules.
    dir = mkdtempSync(join(REPO, 'node_modules', '.cli-share-test-'));
    cli = join(dir, 'dist', 'cli.cjs');
    await build({
      entryPoints: [join(REPO, 'src', 'cli.ts')],
      outfile: cli,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['@resvg/resvg-js', 'jsdom'],
      logLevel: 'silent',
    });
    writeFileSync(join(dir, 'sample.dgmo'), 'flowchart\n(a) -> (b)\n');
  }, MUST_RETURN_WITHIN_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['wl-copy', { WAYLAND_DISPLAY: 'wayland-test' }],
    ['xclip', { WAYLAND_DISPLAY: '' }],
  ] as const)(
    'returns the URL when %s stays in the background',
    (name, session) => {
      const { bin, received } = standIn(name);
      const run = spawnSync(process.execPath, [cli, 'share', 'sample.dgmo'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: MUST_RETURN_WITHIN_MS,
        env: {
          ...process.env,
          ...session,
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        },
      });

      expect(run.error, 'dgmo share did not return').toBeUndefined();
      expect(run.status).toBe(0);
      const url = run.stdout.trim();
      expect(url).toMatch(/^https:\/\/\S+$/);
      expect(run.stderr).toContain('URL copied to clipboard');
      expect(readFileSync(received, 'utf8')).toBe(url);
    },
    MUST_RETURN_WITHIN_MS + 5_000
  );
});
