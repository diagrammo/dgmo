// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { svgToPng, DEFAULT_PNG_SCALE } from '../src/svg-to-png';

// diagrammo/diagrammo#1833 — PNG was fixed at 2x. `--scale <n>` sets the
// pixels per canvas pixel, and the PNG comes back at exactly that size.
//
// CI runs `pnpm test` before `pnpm build`, so this bundles `src/cli.ts` itself.

const REPO = resolve(__dirname, '..');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Width and height from an SVG root's own attributes. */
function svgSize(svg: string): { width: number; height: number } {
  const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
  const width = Number(root.match(/\swidth="([\d.]+)"/)?.[1]);
  const height = Number(root.match(/\sheight="([\d.]+)"/)?.[1]);
  expect(Number.isFinite(width) && Number.isFinite(height)).toBe(true);
  return { width, height };
}

const RECT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">' +
  '<rect width="300" height="200" fill="#336699"/></svg>';

describe('svgToPng scale', () => {
  it('defaults to 2x', () => {
    expect(DEFAULT_PNG_SCALE).toBe(2);
    expect(pngSize(svgToPng(RECT, '#ffffff'))).toEqual({
      width: 600,
      height: 400,
    });
  });

  it.each([
    [1, 300, 200],
    [3, 900, 600],
    [4, 1200, 800],
    [1.5, 450, 300],
    [0.5, 150, 100],
  ])('scale %s gives %sx%s', (scale, width, height) => {
    expect(pngSize(svgToPng(RECT, '#ffffff', scale))).toEqual({
      width,
      height,
    });
  });
});

describe('dgmo --scale', () => {
  let dir: string;
  let cli: string;
  let input: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(REPO, 'node_modules', '.cli-png-scale-test-'));
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
    input = join(dir, 'flow.dgmo');
    writeFileSync(input, 'flowchart\n(Start) -> [Work] -> (Done)\n');
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(...args: string[]) {
    return spawnSync(process.execPath, [cli, input, ...args], {
      encoding: 'utf8',
      timeout: 60_000,
    });
  }

  function canvas() {
    const out = join(dir, 'canvas.svg');
    const r = run('-o', out);
    expect(r.status, r.stderr).toBe(0);
    return svgSize(readFileSync(out, 'utf8'));
  }

  it.each([
    ['no flag', [] as string[], DEFAULT_PNG_SCALE],
    ['--scale 1', ['--scale', '1'], 1],
    ['--scale 3', ['--scale', '3'], 3],
    ['--scale 1.5', ['--scale', '1.5'], 1.5],
  ])('%s writes a PNG at that many pixels per canvas pixel', (_, flag, k) => {
    const { width, height } = canvas();
    const out = join(dir, `out-${k}.png`);
    const r = run(...flag, '-o', out);
    expect(r.status, r.stderr).toBe(0);
    expect(pngSize(readFileSync(out))).toEqual({
      width: Math.round(width * k),
      height: Math.round(height * k),
    });
  });

  it.each(['0', '-2', 'big', ''])('refuses --scale %j', (val) => {
    const r = run('--scale', val, '-o', join(dir, 'refused.png'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--scale needs a positive number');
  });

  it('refuses a trailing --scale with no value', () => {
    const r = spawnSync(process.execPath, [cli, input, '--scale'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--scale needs a positive number');
  });

  it('warns that --scale does not apply to SVG, and leaves the SVG unchanged', () => {
    const plain = join(dir, 'plain.svg');
    const scaled = join(dir, 'scaled.svg');
    expect(run('-o', plain).status).toBe(0);
    const r = run('--scale', '3', '-o', scaled);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('--scale applies to PNG and PDF output only');
    expect(readFileSync(scaled, 'utf8')).toBe(readFileSync(plain, 'utf8'));
  });

  it('lists --scale in --help', () => {
    const r = spawnSync(process.execPath, [cli, '--help'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.stdout + r.stderr).toMatch(
      /--scale <n>\s+PNG pixels per canvas pixel \(default: 2\)/
    );
  });
});
