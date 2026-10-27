// The stress render stage's fonts (#1478). `fonts/` is gitignored and built by
// `pnpm fonts`, so a fresh worktree has none; resvg then draws every label in a
// fallback face and the sheet shows overflows Inter would not have. Refuse to
// render rather than draw in the wrong font.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const STRESS_FONT_FILES = ['Inter-Regular.ttf', 'Inter-Bold.ttf'];

/** Paths of the bundled Inter TTFs under `fontsDir`; throws naming `pnpm fonts` if any is missing. */
export function requireStressFonts(fontsDir: string): string[] {
  const files = STRESS_FONT_FILES.map((f) => join(fontsDir, f));
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    throw new Error(
      `stress:render needs the bundled Inter fonts; missing: ${missing.join(', ')}. ` +
        `Run \`pnpm fonts\` first: without them resvg draws in a ` +
        `fallback face and the PNGs show label overflows Inter does not have.`
    );
  }
  return files;
}
