// Orchestration for the `dgmo migrate` tool.
//
// `migrateContent(source)` is the chart-type-aware whole-document
// transform: detects chart type from the first non-empty line, walks
// lines through the classifier + transformer, returns the new source
// plus a per-line change report. Pure — no I/O.
//
// `migrateFile(path, opts)` is the on-disk wrapper: reads, calls
// `migrateContent`, optionally writes back with `.bak` semantics.
// `migrateEmbedded(path, opts)` handles markdown / mdx files with
// fenced ```dgmo blocks (atomic per file — see `embedded.ts`).

import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { join, extname } from 'node:path';

import { parseDgmoChartType } from '../dgmo-router';
import { isLegacyMetadataLine } from './line-classifier';
import { transformLine } from './line-transformer';

export interface ContentMigration {
  /** Updated source — equal to the input when `changed: false`. */
  readonly migrated: string;
  /** True iff at least one line changed. */
  readonly changed: boolean;
  /** Detected chart type (from line 1), or `null` if unrecognized. */
  readonly chartType: string | null;
  /** 1-based line numbers that were rewritten. */
  readonly changedLines: readonly number[];
}

/**
 * Whole-document migration. Pure transform: takes legacy source,
 * returns new-grammar source plus a change report. Idempotent —
 * running on already-migrated content produces zero changes.
 */
export function migrateContent(source: string): ContentMigration {
  const chartType = parseDgmoChartType(source);
  const lines = source.split('\n');
  const out: string[] = [];
  const changedLines: number[] = [];
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isLegacyMetadataLine(line)) {
      out.push(line);
      continue;
    }
    const result = transformLine(line, chartType);
    if (result.changed) {
      changed = true;
      changedLines.push(i + 1);
    }
    out.push(result.line);
  }

  return {
    migrated: out.join('\n'),
    changed,
    chartType,
    changedLines,
  };
}

// ============================================================
// File-level operations
// ============================================================

export interface MigrateFileOptions {
  /** When false, write changes to disk. Default: true (dry-run). */
  readonly dryRun?: boolean;
  /** When true and dryRun is false, skip writing the `.bak` sidecar. */
  readonly noBackup?: boolean;
}

export interface FileMigrationResult {
  readonly path: string;
  /** Original content. */
  readonly original: string;
  /** Migrated content (equal to original when `changed: false`). */
  readonly migrated: string;
  /** True iff content differs. */
  readonly changed: boolean;
  /** Detected chart type. */
  readonly chartType: string | null;
  /** 1-based line numbers changed. */
  readonly changedLines: readonly number[];
  /** True iff a `.bak` file was written (only when applying). */
  readonly backupWritten: boolean;
  /** True iff the migrated content was written to `path`. */
  readonly written: boolean;
}

/**
 * Migrate a single `.dgmo` file. Defaults to dry-run — no writes
 * happen unless `dryRun: false` is passed explicitly.
 *
 * On apply: writes the migrated content to `path`. Also writes the
 * original to `<path>.bak` unless `noBackup` is set, and unless a
 * `.bak` already exists (preserves the original `.bak` across re-runs
 * — re-migrating an already-migrated file is a no-op anyway).
 */
export function migrateFile(
  path: string,
  opts: MigrateFileOptions = {}
): FileMigrationResult {
  const dryRun = opts.dryRun ?? true;
  const original = readFileSync(path, 'utf-8');
  const { migrated, changed, chartType, changedLines } =
    migrateContent(original);

  let backupWritten = false;
  let written = false;

  if (changed && !dryRun) {
    if (!opts.noBackup) {
      const bakPath = `${path}.bak`;
      if (!existsSync(bakPath)) {
        writeFileSync(bakPath, original, 'utf-8');
        backupWritten = true;
      }
    }
    writeFileSync(path, migrated, 'utf-8');
    written = true;
  }

  return {
    path,
    original,
    migrated,
    changed,
    chartType,
    changedLines,
    backupWritten,
    written,
  };
}

// ============================================================
// Directory walking
// ============================================================

const DGMO_EXTENSION = '.dgmo';
const EMBEDDED_EXTENSIONS = new Set(['.md', '.mdx']);

/**
 * Recursively collect `.dgmo` files under `root`, skipping common
 * noise (`node_modules`, `.git`, `dist`, `.bak` sidecars).
 */
export function collectDgmoFiles(root: string): string[] {
  const stat = statSync(root);
  if (stat.isFile()) {
    return root.endsWith(DGMO_EXTENSION) ? [root] : [];
  }
  const out: string[] = [];
  walk(root, out, DGMO_EXTENSION);
  return out;
}

/**
 * Recursively collect `.md` / `.mdx` files under `root`. Used in
 * `--embedded` mode.
 */
export function collectEmbeddedFiles(root: string): string[] {
  const stat = statSync(root);
  if (stat.isFile()) {
    return EMBEDDED_EXTENSIONS.has(extname(root)) ? [root] : [];
  }
  const out: string[] = [];
  walkEmbedded(root, out);
  return out;
}

function walk(dir: string, out: string[], ext: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (
      name === 'node_modules' ||
      name === '.git' ||
      name === 'dist' ||
      name === '.next' ||
      name.endsWith('.bak')
    ) {
      continue;
    }
    const full = join(dir, name);
    if (entry.isDirectory()) {
      walk(full, out, ext);
    } else if (entry.isFile() && name.endsWith(ext)) {
      out.push(full);
    }
  }
}

function walkEmbedded(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (
      name === 'node_modules' ||
      name === '.git' ||
      name === 'dist' ||
      name === '.next' ||
      name.endsWith('.bak')
    ) {
      continue;
    }
    const full = join(dir, name);
    if (entry.isDirectory()) {
      walkEmbedded(full, out);
    } else if (entry.isFile() && EMBEDDED_EXTENSIONS.has(extname(name))) {
      out.push(full);
    }
  }
}

// ============================================================
// Diff helper (used by --diff)
// ============================================================

/**
 * Minimal unified-style diff for printing changed lines.
 * Not a full unified-diff: only outputs the touched lines with
 * `- old` / `+ new` markers and a leading file header. Adequate
 * for the `--diff` flag on the migration CLI; no patch consumer.
 */
export function formatLineDiff(
  path: string,
  original: string,
  migrated: string
): string {
  const origLines = original.split('\n');
  const newLines = migrated.split('\n');
  const lines: string[] = [`--- ${path}`, `+++ ${path}`];
  const max = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const a = origLines[i];
    const b = newLines[i];
    if (a === b) continue;
    if (a !== undefined) lines.push(`@@ line ${i + 1}\n- ${a}`);
    if (b !== undefined) lines.push(`+ ${b}`);
  }
  return lines.join('\n');
}

// Re-exports so consumers (cli.ts, dgmo-mcp) can import everything
// they need from this entrypoint.
export {
  isLegacyMetadataLine,
  findUnsafePipePositions,
} from './line-classifier';
export { transformLine } from './line-transformer';
export type { TransformResult } from './line-transformer';
