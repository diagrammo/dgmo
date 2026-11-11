import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * A file reader that refuses anything outside `baseDir` — the input file's
 * own directory. A diagram names files to pull in (org `import`, whiteboard
 * images), and the CLI may render a diagram someone else wrote; without this
 * a `../` path, an absolute path or a symlink reads any file of the right
 * extension into the output (diagrammo/diagrammo#1865, #1868).
 *
 * Both sides go through `realpath`, so a symlink inside the directory that
 * points out of it is refused, and a directory reached through a symlink
 * still contains its own files. A refused or missing file throws, which every
 * caller already reports as "not found".
 */
export function containedReader(baseDir: string): (target: string) => Buffer {
  let realBase: string | undefined;
  return (target) => {
    realBase ??= realpathSync(baseDir);
    const realTarget = realpathSync(resolve(baseDir, target));
    const rel = relative(realBase, realTarget);
    if (
      rel === '' ||
      rel === '..' ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel)
    ) {
      throw new Error(`Refusing to read outside ${baseDir}: ${target}`);
    }
    return readFileSync(realTarget);
  };
}
