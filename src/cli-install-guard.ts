// cli-install-guard.ts — refuse to write through a symlink that leaves the cwd.
//
// `dgmo install` writes rules files and MCP configs into the directory it runs
// in. A repo can commit `.cursorrules` (or `.github`, or `AGENTS.md`) as a
// symlink to a file of the user's outside the checkout, and a plain write
// follows it and replaces that file (#1867). A link that stays inside the
// directory (`AGENTS.md` → `CLAUDE.md`) is the repo's own business and is
// followed as before.

import { lstatSync, realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * The first symlink on the way from `root` (exclusive) to `path` (inclusive)
 * whose target is outside `root` or cannot be resolved (a dangling link would
 * create its target wherever it points), or null when there is none or `path`
 * is not inside `root`. A component that does not exist yet ends the walk.
 */
export function symlinkOutside(root: string, path: string): string | null {
  const base = resolve(root);
  const rel = relative(base, resolve(path));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  let realBase: string;
  try {
    realBase = realpathSync(base);
  } catch {
    return null;
  }
  let current = base;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    let isLink: boolean;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch {
      return null;
    }
    if (!isLink) continue;
    let target: string;
    try {
      target = realpathSync(current);
    } catch {
      return current;
    }
    if (!inside(realBase, target)) return current;
  }
  return null;
}

/**
 * True when `home` is `cwd` or below it: an install run from the home
 * directory (or above it) is not in a checkout someone else wrote, and the
 * configs there are the user's own, often dotfile-manager symlinks.
 */
export function cwdHoldsHome(cwd: string, home: string): boolean {
  // Compared as real paths: `process.cwd()` is already resolved, and a HOME
  // reached through a symlink (macOS's `/var` → `/private/var`) never matched.
  return inside(real(cwd), real(home));
}

// The deepest existing ancestor resolved, the rest appended, so a path that
// does not exist yet compares the same way as one that does.
function real(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(real(parent), basename(abs));
  }
}
