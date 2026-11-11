// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { containedReader } from '../src/cli-contained-read';

// diagrammo/diagrammo#1865 and #1868 — a diagram names files for the CLI to
// pull in (org `import`, whiteboard `image`). Neither may reach outside the
// input file's directory, by `../`, an absolute path, or a symlink.
//
// CI runs `pnpm test` before `pnpm build`, so this bundles `src/cli.ts` itself.

const REPO = resolve(__dirname, '..');
// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let dir: string;
let cli: string;

beforeAll(async () => {
  dir = mkdtempSync(join(REPO, 'node_modules', '.cli-contained-test-'));
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
  mkdirSync(join(dir, 'in', 'sub'), { recursive: true });
  mkdirSync(join(dir, 'out'));
  writeFileSync(join(dir, 'out', 'secret.dgmo'), 'SecretPerson\n');
  writeFileSync(join(dir, 'out', 'plain.txt'), 'PlainTextLeak\n');
  writeFileSync(join(dir, 'out', 'leak.png'), PNG);
  symlinkSync(join(dir, 'out', 'plain.txt'), join(dir, 'in', 'link.dgmo'));
  symlinkSync(join(dir, 'out', 'leak.png'), join(dir, 'in', 'link.png'));
  writeFileSync(join(dir, 'in', 'local.dgmo'), 'LocalPerson\n');
  writeFileSync(join(dir, 'in', 'sub', 'nested.dgmo'), 'NestedPerson\n');
  writeFileSync(join(dir, 'in', 'ok.png'), PNG);
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function renderSvg(name: string, source: string) {
  const input = join(dir, 'in', name);
  const output = join(dir, 'in', name.replace(/\.dgmo$/, '.svg'));
  writeFileSync(input, source);
  const run = spawnSync(process.execPath, [cli, input, '-o', output], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const svg = run.status === 0 ? readFileSync(output, 'utf8') : '';
  return { run, svg };
}

describe('containedReader', () => {
  it('reads inside the directory and refuses everything else', () => {
    const read = containedReader(join(dir, 'in'));
    expect(read('local.dgmo').toString()).toBe('LocalPerson\n');
    expect(read('sub/nested.dgmo').toString()).toBe('NestedPerson\n');
    expect(read('sub/../local.dgmo').toString()).toBe('LocalPerson\n');
    expect(() => read('../out/secret.dgmo')).toThrow();
    expect(() => read(join(dir, 'out', 'secret.dgmo'))).toThrow();
    expect(() => read('link.dgmo')).toThrow();
    expect(() => read('missing.dgmo')).toThrow();
  });
});

describe('dgmo CLI keeps imports inside the input directory', () => {
  it('org import: outside paths and symlinks render nothing', () => {
    const { run, svg } = renderSvg(
      'a.dgmo',
      [
        'org Team',
        '',
        'Boss',
        '  import ../out/secret.dgmo',
        '  import link.dgmo',
        `  import ${join(dir, 'out', 'secret.dgmo')}`,
        '  import local.dgmo',
        '  import sub/nested.dgmo',
        '',
      ].join('\n')
    );
    expect(run.status, run.stderr).toBe(0);
    expect(svg).not.toContain('SecretPerson');
    expect(svg).not.toContain('PlainTextLeak');
    expect(run.stderr).toContain('Import file not found');
    expect(svg).toContain('LocalPerson');
    expect(svg).toContain('NestedPerson');
  });

  it('whiteboard image: outside paths and symlinks are placeholders', () => {
    const b64 = PNG.toString('base64');
    const outside = renderSvg(
      'w1.dgmo',
      'whiteboard Board\nimage ../out/leak.png at: 0 0, size: 10 10\nimage link.png at: 20 0, size: 10 10\n'
    );
    expect(outside.run.status, outside.run.stderr).toBe(0);
    expect(outside.svg).not.toContain(b64);
    const inside = renderSvg(
      'w2.dgmo',
      'whiteboard Board\nimage ok.png at: 0 0, size: 10 10\n'
    );
    expect(inside.run.status, inside.run.stderr).toBe(0);
    expect(inside.svg).toContain(b64);
  });
});
