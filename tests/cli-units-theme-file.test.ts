// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { parseDpi, parseSize } from '../src/cli-flags';
import { getPalette } from '../src/palettes/registry';

// diagrammo/diagrammo#2037 (mm / in / px sizes and --dpi) and #2060
// (--theme-file). CI runs `pnpm test` before `pnpm build`, so this bundles
// `src/cli.ts` itself.

describe('parseSize', () => {
  it.each([
    ['1200', 96, 1200],
    ['1200px', 96, 1200],
    ['3.5in', 96, 336],
    ['1in', 300, 300],
    ['25.4mm', 96, 96],
    ['89mm', 96, 336],
    ['89mm', 300, 1051],
  ])('%s at %s dpi is %s px', (val, dpi, px) => {
    expect(parseSize('--width', val, dpi)).toBe(px);
  });

  it.each(['', 'abc', '-5mm', '0mm', '12cm', '5 mm', 'mm', '1e3px'])(
    'rejects %j naming the flag',
    (val) => {
      expect(() => parseSize('--height', val)).toThrow(/^--height needs/);
    }
  );

  it('rejects a missing value', () => {
    expect(() => parseSize('--width', undefined)).toThrow(/^--width needs/);
  });

  it('parseDpi accepts positive numbers only', () => {
    expect(parseDpi('300')).toBe(300);
    for (const bad of [undefined, '', '0', '-1', 'x']) {
      expect(() => parseDpi(bad)).toThrow(/^--dpi needs/);
    }
  });
});

describe('dgmo --width/--dpi/--theme-file', () => {
  let dir: string;
  let cli: string;
  let input: string;

  beforeAll(async () => {
    dir = mkdtempSync(
      join(resolve(__dirname, '..'), 'node_modules', '.cli-units-')
    );
    cli = join(dir, 'dist', 'cli.cjs');
    await build({
      entryPoints: [join(resolve(__dirname, '..'), 'src', 'cli.ts')],
      outfile: cli,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['@resvg/resvg-js', 'jsdom'],
      logLevel: 'silent',
    });
    input = join(dir, 'pie.dgmo');
    writeFileSync(input, 'pie Share\nA: 1\nB: 2\n');
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

  const pngSize = (f: string) => {
    const b = readFileSync(f);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };

  it('sizes a PNG from mm at the default dpi (scale 1)', () => {
    const out = join(dir, 'a.png');
    const r = run(
      '--width',
      '89mm',
      '--height',
      '50mm',
      '--scale',
      '1',
      '-o',
      out
    );
    expect(r.status, r.stderr).toBe(0);
    expect(pngSize(out)).toEqual([336, 189]);
  });

  it('--dpi maps inches to PNG pixels, before or after the size', () => {
    for (const args of [
      ['--dpi', '300', '--width', '3in', '--height', '2in'],
      ['--width', '3in', '--height', '2in', '--dpi', '300'],
    ]) {
      const out = join(dir, 'b.png');
      const r = run(...args, '--scale', '1', '-o', out);
      expect(r.status, r.stderr).toBe(0);
      expect(pngSize(out)).toEqual([900, 600]);
    }
  });

  it('--dpi maps to the PDF page and image', () => {
    const out = join(dir, 'c.pdf');
    const r = run(
      '--width',
      '3in',
      '--height',
      '2in',
      '--dpi',
      '300',
      '--scale',
      '1',
      '-o',
      out
    );
    expect(r.status, r.stderr).toBe(0);
    const text = readFileSync(out).toString('latin1');
    expect(text).toMatch(/\/MediaBox \[0 0 675 450\]/);
    expect(text).toMatch(/\/Width 900/);
    expect(text).toMatch(/\/Height 600/);
  });

  it('exits 1 on a bad size or dpi', () => {
    const a = run('--width', '12cm', '-o', join(dir, 'x.png'));
    expect(a.status).toBe(1);
    expect(a.stderr).toMatch(/--width needs a positive size/);
    const b = run('--dpi', '0', '-o', join(dir, 'x.png'));
    expect(b.status).toBe(1);
    expect(b.stderr).toMatch(/--dpi needs/);
  });

  describe('--theme-file', () => {
    const themeJson = () => ({
      id: 'cli-test-theme',
      name: 'CLI test',
      mode: 'dark',
      dark: structuredClone(getPalette('slate').dark),
    });

    it('draws with the file palette', () => {
      const file = join(dir, 'theme.json');
      writeFileSync(file, JSON.stringify(themeJson()));
      const out = join(dir, 't.svg');
      const r = run('--theme-file', file, '--theme', 'dark', '-o', out);
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(out, 'utf8')).toContain(getPalette('slate').dark.bg);
    });

    it('lists every problem in an invalid file and exits 1', () => {
      const file = join(dir, 'bad.json');
      writeFileSync(file, JSON.stringify({ id: 'x', mode: 'dark', dark: {} }));
      const r = run('--theme-file', file, '-o', join(dir, 'bad.png'));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/is not a valid theme:\n {2}- /);
    });

    it('names unreadable and non-JSON files', () => {
      const missing = run(
        '--theme-file',
        join(dir, 'none.json'),
        '-o',
        join(dir, 'm.png')
      );
      expect(missing.status).toBe(1);
      expect(missing.stderr).toMatch(/--theme-file cannot read/);
      const junk = join(dir, 'junk.json');
      writeFileSync(junk, '{nope');
      const r = run('--theme-file', junk, '-o', join(dir, 'j.png'));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/is not valid JSON/);
    });

    it('refuses --palette together with --theme-file', () => {
      const file = join(dir, 'theme2.json');
      writeFileSync(file, JSON.stringify(themeJson()));
      const r = run(
        '--theme-file',
        file,
        '--palette',
        'nord',
        '-o',
        join(dir, 'p.png')
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/cannot be used together/);
    });
  });
});
