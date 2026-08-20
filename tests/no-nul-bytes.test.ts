import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================
// No literal NUL bytes in tracked source
// ============================================================
//
// A NUL is a genuinely good key separator — it is the one byte that cannot
// appear in the values being joined, which is exactly why it kept getting
// chosen here. Written as a RAW 0x00 rather than the two-character escape
// `\0`, though, it costs three things, none of which announce themselves:
//
//   - `file` reports the module as `application/octet-stream`, and `grep`
//     answers `Binary file ... matches` instead of the line. A sweep without
//     `-a` skips the file and comes back clean, so the omission is invisible.
//   - `git diff` renders the file as `Bin 16984 -> 16987 bytes`, so a reviewer
//     cannot see a three-character change without asking for a text diff.
//   - Every tool that sniffs binary-vs-text gets it wrong, in both directions.
//
// The escape behaves identically at runtime. This test exists because the
// accident recurred: nine files across four repos by the time anyone swept for
// it, having been found twice by chance while looking for something else.
// ============================================================

const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: dirname(new URL(import.meta.url).pathname),
  encoding: 'utf8',
}).trim();

/** Extensions where a raw NUL is a defect rather than the file's nature. */
const TEXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.rs',
  '.sh',
  '.dgmo',
  '.svg',
]);

function trackedTextFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((f) => TEXT.has(f.slice(f.lastIndexOf('.')).toLowerCase()));
}

describe('tracked source carries no literal NUL bytes', () => {
  it('finds none, so grep and git diff still see every file as text', () => {
    const offenders = trackedTextFiles()
      .map((f) => ({ file: f, count: countNuls(join(REPO, f)) }))
      .filter((r) => r.count > 0)
      .map((r) => `${r.file} (${r.count})`);

    expect(
      offenders,
      offenders.length
        ? `Write the escape \\0 instead of a raw 0x00 byte in:\n  ${offenders.join('\n  ')}`
        : ''
    ).toEqual([]);
  });
});

function countNuls(absolute: string): number {
  const buf = readFileSync(absolute);
  let n = 0;
  for (const byte of buf) if (byte === 0) n += 1;
  return n;
}
