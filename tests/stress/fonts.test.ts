import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requireStressFonts } from './fonts';

describe('requireStressFonts (#1478)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('refuses a missing fonts/ and names `pnpm fonts`', () => {
    dir = mkdtempSync(join(tmpdir(), 'stress-fonts-'));
    expect(() => requireStressFonts(join(dir!, 'fonts'))).toThrow(/pnpm fonts/);
  });

  it('refuses a fonts/ holding only one of the two faces', () => {
    dir = mkdtempSync(join(tmpdir(), 'stress-fonts-'));
    writeFileSync(join(dir, 'Inter-Regular.ttf'), '');
    expect(() => requireStressFonts(dir!)).toThrow(/Inter-Bold\.ttf/);
  });

  it('returns both faces when they are present', () => {
    dir = mkdtempSync(join(tmpdir(), 'stress-fonts-'));
    writeFileSync(join(dir, 'Inter-Regular.ttf'), '');
    writeFileSync(join(dir, 'Inter-Bold.ttf'), '');
    expect(requireStressFonts(dir)).toEqual([
      join(dir, 'Inter-Regular.ttf'),
      join(dir, 'Inter-Bold.ttf'),
    ]);
  });
});
