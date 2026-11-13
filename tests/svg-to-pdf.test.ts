// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { svgToPdf } from '../src/svg-to-pdf';
import { DEFAULT_PNG_SCALE } from '../src/svg-to-png';

// diagrammo/diagrammo#1833 slice (b) — `-o file.pdf` from the CLI. Before it,
// a .pdf output path fell through to PNG: PNG bytes under a .pdf name.
//
// The page is the canvas at 96 dpi (0.75 pt per canvas pixel) whatever the
// scale, and the scale sets the embedded image's pixel size — the shape of the
// app's single-diagram PDF export.
//
// CI runs `pnpm test` before `pnpm build`, so this bundles `src/cli.ts` itself.

const REPO = resolve(__dirname, '..');

interface ParsedPdf {
  mediaBox: number[];
  imageWidth: number;
  imageHeight: number;
  rgb: Buffer;
}

/**
 * Reads back the one-page, one-image PDF the CLI writes, checking the xref
 * points at every object, and inflates the image's pixels.
 */
function parsePdf(pdf: Buffer): ParsedPdf {
  const text = pdf.toString('latin1');
  expect(text.startsWith('%PDF-1.')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF\s*$/)?.[1]);
  expect(text.slice(startxref, startxref + 4)).toBe('xref');
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)];
  expect(offsets.length).toBeGreaterThan(0);
  offsets.forEach((m, k) => {
    expect(text.slice(Number(m[1]))).toMatch(new RegExp(`^${k + 1} 0 obj\\n`));
  });
  const mediaBox = (text.match(/\/MediaBox \[([^\]]+)\]/)?.[1] ?? '')
    .split(' ')
    .map(Number);
  const dict = text.match(/\/Subtype \/Image ([^>]*)>>\nstream\n/);
  expect(dict).not.toBeNull();
  const imageWidth = Number(dict![1]!.match(/\/Width (\d+)/)?.[1]);
  const imageHeight = Number(dict![1]!.match(/\/Height (\d+)/)?.[1]);
  const length = Number(dict![1]!.match(/\/Length (\d+)/)?.[1]);
  const start = dict!.index! + dict![0].length;
  const rgb = inflateSync(pdf.subarray(start, start + length));
  return { mediaBox, imageWidth, imageHeight, rgb };
}

const RECT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">' +
  '<rect width="300" height="200" fill="#336699"/></svg>';

describe('svgToPdf', () => {
  it('puts the canvas on a page at 96 dpi, the image at 2x by default', () => {
    const p = parsePdf(svgToPdf(RECT, '#ffffff'));
    expect(DEFAULT_PNG_SCALE).toBe(2);
    expect(p.mediaBox).toEqual([0, 0, 225, 150]);
    expect([p.imageWidth, p.imageHeight]).toEqual([600, 400]);
    expect(p.rgb.length).toBe(600 * 400 * 3);
    expect([...p.rgb.subarray(0, 3)]).toEqual([0x33, 0x66, 0x99]);
  });

  it.each([
    [1, 300, 200],
    [3, 900, 600],
    [1.5, 450, 300],
  ])('scale %s gives a %sx%s image on the same page', (scale, w, h) => {
    const p = parsePdf(svgToPdf(RECT, '#ffffff', scale));
    expect(p.mediaBox).toEqual([0, 0, 225, 150]);
    expect([p.imageWidth, p.imageHeight]).toEqual([w, h]);
  });

  it('fills what the SVG leaves empty with the background', () => {
    const empty =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>';
    const p = parsePdf(svgToPdf(empty, '#102030', 1));
    for (let i = 0; i < p.rgb.length; i += 3) {
      expect([p.rgb[i], p.rgb[i + 1], p.rgb[i + 2]]).toEqual([
        0x10, 0x20, 0x30,
      ]);
    }
  });

  it('refuses a scale past the pixel cap with a message', () => {
    expect(() => svgToPdf(RECT, '#ffffff', 1e6)).toThrow(
      /--scale 1000000 would make a 300000000x200000000 image.*fits up to --scale 66\.88/
    );
  });
});

describe('dgmo -o file.pdf', () => {
  let dir: string;
  let cli: string;
  let input: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(REPO, 'node_modules', '.cli-pdf-test-'));
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
    const root = readFileSync(out, 'utf8').match(/<svg\b[^>]*>/)?.[0] ?? '';
    return {
      width: Number(root.match(/\swidth="([\d.]+)"/)?.[1]),
      height: Number(root.match(/\sheight="([\d.]+)"/)?.[1]),
    };
  }

  it.each([
    ['no flag', [] as string[], DEFAULT_PNG_SCALE],
    ['--scale 3', ['--scale', '3'], 3],
  ])('%s writes a PDF page the canvas size', (_, flag, k) => {
    const { width, height } = canvas();
    const out = join(dir, `out-${k}.pdf`);
    const r = run(...flag, '-o', out);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(`Wrote ${out}`);
    const p = parsePdf(readFileSync(out));
    const pt = (px: number) => Math.round(px * 0.75 * 100) / 100;
    expect(p.mediaBox[2]).toBeCloseTo(pt(width), 1);
    expect(p.mediaBox[3]).toBeCloseTo(pt(height), 1);
    expect(p.imageWidth).toBe(Math.round(width * k));
    expect(p.imageHeight).toBe(Math.round(height * k));
  });

  it('a .PDF extension is a PDF too', () => {
    const out = join(dir, 'upper.PDF');
    expect(run('-o', out).status).toBe(0);
    expect(readFileSync(out).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('draws a transparent theme on the light background, and says so', () => {
    const out = join(dir, 'transparent.pdf');
    const r = run('--theme', 'transparent', '-o', out);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('PDF has no transparent background');
    const light = parsePdf(readFileSync(join(dir, 'out-2.pdf')));
    const p = parsePdf(readFileSync(out));
    expect([...p.rgb.subarray(0, 3)]).toEqual([...light.rgb.subarray(0, 3)]);
  });

  it('refuses a --scale past the pixel cap with a message, not an abort', () => {
    for (const ext of ['pdf', 'png']) {
      const r = run('--scale', '1e6', '-o', join(dir, `huge.${ext}`));
      expect(r.status).toBe(1);
      expect(r.signal).toBeNull();
      expect(r.stderr).toMatch(
        /Error: --scale 1000000 would make a .* fits up to --scale/
      );
    }
  });

  it('documents .pdf in --help', () => {
    const r = spawnSync(process.execPath, [cli, '--help'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.stdout + r.stderr).toMatch(/\.pdf → PDF/);
  });
});
