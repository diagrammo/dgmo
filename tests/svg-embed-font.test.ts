// @vitest-environment node
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';

// diagrammo/diagrammo#1834 — a standalone SVG named Inter and embedded none
// of it, so on a machine without Inter every label fell back to another face
// and every measured width was wrong. The CLI's `-o file.svg` now carries the
// Inter faces it uses, subset to its own text, as base64 WOFF2 `@font-face`.
//
// CI runs `pnpm test` before `pnpm build`, so this bundles `src/cli.ts` itself
// and stages the vendored TTFs where the bundle looks for `fonts/`, as tsup's
// `stageCliAssets` does for the published package.

const REPO = resolve(__dirname, '..');

// harfbuzzjs and fontverter are subset-font's own dependencies; resolve them
// from there to read back what was embedded.
const fromSubsetFont = createRequire(require.resolve('subset-font'));

interface Face {
  weight: string;
  bytes: Buffer;
}

function embeddedFaces(svg: string): Face[] {
  const faces: Face[] = [];
  for (const m of svg.matchAll(
    /@font-face\{font-family:'Inter';font-style:normal;font-weight:([^;]+);src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\('woff2'\)\}/g
  )) {
    faces.push({ weight: m[1]!, bytes: Buffer.from(m[2]!, 'base64') });
  }
  return faces;
}

async function codepoints(woff2: Buffer): Promise<Set<number>> {
  const fontverter = fromSubsetFont('fontverter') as {
    convert(b: Buffer, to: 'sfnt'): Promise<Buffer>;
  };
  const hb = (await fromSubsetFont('harfbuzzjs')) as {
    createBlob(b: Buffer): unknown;
    createFace(
      blob: unknown,
      index: number
    ): {
      collectUnicodes(): Uint32Array;
    };
  };
  const sfnt = await fontverter.convert(woff2, 'sfnt');
  return new Set(hb.createFace(hb.createBlob(sfnt), 0).collectUnicodes());
}

describe('dgmo -o file.svg embeds Inter', () => {
  let dir: string;
  let cli: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(REPO, 'node_modules', '.cli-font-test-'));
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
    for (const f of ['Inter-Regular.ttf', 'Inter-Bold.ttf']) {
      copyFileSync(join(REPO, 'vendor', 'inter', f), join(dir, 'fonts', f));
    }
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function exportSvg(name: string, source: string): string {
    const input = join(dir, `${name}.dgmo`);
    const out = join(dir, `${name}.svg`);
    writeFileSync(input, source);
    const r = spawnSync(process.execPath, [cli, input, '-o', out], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(0);
    return readFileSync(out, 'utf8');
  }

  it('carries a WOFF2 Inter face holding every character its text draws', async () => {
    const svg = exportSvg(
      'flow',
      'flowchart\n(Start) -> [Prüfen & Wägen] -> (Ωmega Жук)\n'
    );
    const faces = embeddedFaces(svg);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.map((f) => f.weight)).toContain('100 500');
    for (const face of faces) {
      expect(face.bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
      const cps = await codepoints(face.bytes);
      for (const ch of 'StartPrüfen&WägenΩmegaЖук') {
        expect(cps.has(ch.codePointAt(0)!), `U+${ch} in ${face.weight}`).toBe(
          true
        );
      }
    }
  });

  it('keeps the copyright notice and the licence in each embedded face', async () => {
    // The SIL Open Font License travels with every copy, here in the font's
    // own name table (IDs 0 and 13), as the licence allows.
    const svg = exportSvg('bar-licence', 'bar Sales\nNorth: 10\nSouth: 20\n');
    const fontverter = fromSubsetFont('fontverter') as {
      convert(b: Buffer, to: 'sfnt'): Promise<Buffer>;
    };
    const utf16be = (t: string) => Buffer.from(t, 'utf16le').swap16();
    const faces = embeddedFaces(svg);
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      const sfnt = await fontverter.convert(face.bytes, 'sfnt');
      expect(sfnt.includes(utf16be('The Inter Project Authors'))).toBe(true);
      expect(sfnt.includes(utf16be('SIL Open Font License'))).toBe(true);
    }
  });

  it('subsets to the text, far below the whole face', async () => {
    const svg = exportSvg('small', 'flowchart\n[A] -> [B]\n');
    const regular = embeddedFaces(svg).find((f) => f.weight === '100 500');
    expect(regular).toBeDefined();
    const cps = await codepoints(regular!.bytes);
    // A–Z is not all there: only what this diagram writes.
    expect(cps.has('Z'.codePointAt(0)!)).toBe(false);
    const whole = statSync(join(REPO, 'vendor', 'inter', 'Inter-Regular.ttf'));
    expect(regular!.bytes.length).toBeLessThan(whole.size / 4);
  });

  it('embeds the Bold face only when the SVG asks for bold', () => {
    // A bar chart's title is bold; two plain flowchart boxes write no bold.
    const bar = exportSvg('bar', 'bar Sales\nNorth: 10\nSouth: 20\n');
    expect(embeddedFaces(bar).map((f) => f.weight)).toEqual([
      '100 500',
      '600 900',
    ]);
    const plain = exportSvg('plain', 'flowchart\n[A] -> [B]\n');
    expect(embeddedFaces(plain).map((f) => f.weight)).toEqual(['100 500']);
  });
});
