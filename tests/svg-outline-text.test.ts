// @vitest-environment node
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Resvg } from '@resvg/resvg-js';

// diagrammo/diagrammo#1834 slice (b) — `--outline-text` writes every label as
// filled paths, so a print shop or a vector editor needs no font at all.
//
// Bundles `src/cli.ts` itself (CI runs `pnpm test` before `pnpm build`) and
// stages the vendored TTFs where the bundle looks for `fonts/`.

const REPO = resolve(__dirname, '..');
const INTER = ['Inter-Regular.ttf', 'Inter-Bold.ttf'].map((f) =>
  join(REPO, 'vendor', 'inter', f)
);

/** RGBA pixels at 1x. `fonts: false` gives resvg no font of any kind. */
function pixels(svg: string, fonts: boolean): Uint8Array {
  const r = new Resvg(svg, {
    font: fonts
      ? {
          loadSystemFonts: false,
          fontFiles: INTER,
          defaultFontFamily: 'Inter',
          sansSerifFamily: 'Inter',
        }
      : { loadSystemFonts: false, fontFiles: [] },
  }).render();
  return new Uint8Array(r.pixels);
}

/** Share of pixels whose RGBA differs by more than a rounding error. */
function differing(a: Uint8Array, b: Uint8Array): number {
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d += Math.abs(a[i + c]! - b[i + c]!);
    if (d > 8) n++;
  }
  return n / (a.length / 4);
}

describe('dgmo --outline-text', () => {
  let dir: string;
  let cli: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(REPO, 'node_modules', '.cli-outline-test-'));
    cli = join(dir, 'dist', 'cli.cjs');
    await build({
      entryPoints: [join(REPO, 'src', 'cli.ts')],
      outfile: cli,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['@resvg/resvg-js', 'jsdom', 'subset-font'],
      logLevel: 'silent',
    });
    mkdirSync(join(dir, 'fonts'));
    for (const f of INTER) {
      copyFileSync(f, join(dir, 'fonts', f.split('/').pop()!));
    }
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(name: string, source: string, out: string, extra: string[]) {
    const input = join(dir, `${name}.dgmo`);
    writeFileSync(input, source);
    return spawnSync(process.execPath, [cli, input, '-o', out, ...extra], {
      encoding: 'utf8',
      timeout: 60_000,
    });
  }

  function exportSvg(name: string, source: string, extra: string[]): string {
    const out = join(dir, `${name}.svg`);
    const r = run(name, source, out, extra);
    expect(r.status, r.stderr).toBe(0);
    return readFileSync(out, 'utf8');
  }

  const BAR = 'bar Sales by Region\nNorth: 10\nSouth: 20\nWägen & Ωmega: 15\n';

  it('leaves no text and no font in the file', () => {
    const svg = exportSvg('bar-outlined', BAR, ['--outline-text']);
    expect(svg).not.toMatch(/<text\b/);
    expect(svg).not.toMatch(/@font-face/);
    expect(svg).not.toMatch(/font-family/);
    expect(svg).toMatch(/<path\b/);
  });

  it('draws the same picture with no font available as the text SVG does with Inter', () => {
    const text = exportSvg('bar-text', BAR, []);
    const outlined = exportSvg('bar-outlined-2', BAR, ['--outline-text']);
    const withInter = pixels(text, true);
    // The control: the text SVG with no font loses its labels, so the
    // comparison below can tell a drawn label from a missing one.
    expect(differing(withInter, pixels(text, false))).toBeGreaterThan(0.001);
    expect(differing(withInter, pixels(outlined, false))).toBeLessThan(0.001);
  });

  it('warns and ignores the flag for PNG output', () => {
    const r = run('bar-png', BAR, join(dir, 'bar.png'), ['--outline-text']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/--outline-text applies to SVG output only/);
  });
});
