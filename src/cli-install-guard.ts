// cli-install-guard.ts — refuse to write through a symlink a repo could commit.
//
// `dgmo install` writes rules files and MCP configs into the directory it runs
// in. A repo can commit `.cursorrules` (or `.github`, or `.cursor/mcp.json`) as
// a symlink to a file outside the checkout, and a plain write follows it and
// replaces that file (#1867). Paths under the home directory are left alone:
// the user owns them, and dotfile managers keep those configs as symlinks.

import { lstatSync } from 'node:fs';
import { relative, resolve, sep, join, isAbsolute } from 'node:path';

/**
 * The first symlink on the way from `root` (exclusive) to `path` (inclusive),
 * or null when there is none or `path` is not inside `root`. A component that
 * does not exist yet ends the walk: nothing below it can be a link.
 */
export function symlinkUnder(root: string, path: string): string | null {
  const base = resolve(root);
  const rel = relative(base, resolve(path));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  let current = base;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    let isLink: boolean;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch {
      return null;
    }
    if (isLink) return current;
  }
  return null;
}
