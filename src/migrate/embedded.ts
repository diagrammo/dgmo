// Markdown / mdx fenced-block handler for `dgmo migrate --embedded`.
//
// Walks ```dgmo (and ```diagrammo) fenced blocks inside `.md` / `.mdx`
// files, migrates each block, and re-assembles the document. Atomic
// per file: if any block fails to parse under the legacy parser, the
// entire file is skipped — no writes, no partial migrations, no `.bak`.
//
// Why atomic? Half-new-half-legacy markdown files are unreachable —
// a re-run on a partially-migrated file would produce inconsistent
// behavior and a corrupted `.bak`. Per spec "Migration Tool Contract".

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { parseDgmo } from '../dgmo-router';
import { METADATA_DIAGNOSTIC_CODES } from '../diagnostics';
import { migrateContent } from './index';

// Diagnostic codes the migration tool itself is repairing — these
// MUST NOT count as "block fails to parse" reasons, otherwise every
// legacy block would be skipped. Derived from the canonical registry
// so a code rename can't silently desync the migrator.
const MIGRATION_TARGET_CODES = new Set<string>([
  METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED,
  METADATA_DIAGNOSTIC_CODES.GANTT_BARE_PERCENT_REMOVED,
  METADATA_DIAGNOSTIC_CODES.JOURNEY_BARE_SCORE_REMOVED,
  METADATA_DIAGNOSTIC_CODES.PYRAMID_BARE_DESCRIPTION_REMOVED,
  METADATA_DIAGNOSTIC_CODES.RING_BARE_DESCRIPTION_REMOVED,
]);

const FENCE_RE = /^(\s*)(```+|~~~+)\s*(dgmo|diagrammo)\b([^\n]*)$/i;

interface FencedBlock {
  /** Index in the line array where the opening fence sits. */
  readonly fenceStartLine: number;
  /** Index of the closing fence line. */
  readonly fenceEndLine: number;
  /** The fence sequence (e.g. ` ``` ` or ` ~~~ `), used to find the close. */
  readonly fenceSeq: string;
  /** 0-based indices [start, end) of the body lines (between fences, exclusive). */
  readonly bodyStart: number;
  readonly bodyEnd: number;
  /** Joined body source. */
  readonly body: string;
}

/**
 * Locate every fenced ```dgmo / ```diagrammo block in `source`.
 * Returns empty array when no blocks exist (caller treats as no-op).
 */
function findFencedBlocks(source: string): FencedBlock[] {
  const lines = source.split('\n');
  const blocks: FencedBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const open = lines[i]!.match(FENCE_RE);
    if (!open) {
      i++;
      continue;
    }
    const fenceSeq = open[2]!;
    const indent = open[1] ?? '';
    // Find matching closer — a fence line whose sequence is `fenceSeq`
    // (or longer of the same char) at the same or lower indent.
    const closeRe = new RegExp(
      `^${escapeRegex(indent)}${escapeRegex(fenceSeq[0]!)}{${fenceSeq.length},}\\s*$`
    );
    let j = i + 1;
    while (j < lines.length) {
      if (closeRe.test(lines[j]!)) break;
      j++;
    }
    if (j >= lines.length) {
      // Unclosed fence — bail; don't treat as a block.
      break;
    }
    const body = lines.slice(i + 1, j).join('\n');
    blocks.push({
      fenceStartLine: i,
      fenceEndLine: j,
      fenceSeq,
      bodyStart: i + 1,
      bodyEnd: j,
      body,
    });
    i = j + 1;
  }

  return blocks;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface EmbeddedMigrationResult {
  readonly path: string;
  readonly original: string;
  readonly migrated: string;
  readonly changed: boolean;
  /** True when the file was skipped due to a parse-error block. */
  readonly skipped: boolean;
  /** Reason for skip — `null` when not skipped. */
  readonly skipReason: string | null;
  /** Number of dgmo blocks found in the file. */
  readonly blockCount: number;
  /** Number of blocks that actually changed. */
  readonly changedBlocks: number;
  readonly backupWritten: boolean;
  readonly written: boolean;
}

export interface MigrateEmbeddedOptions {
  /** When false, write changes to disk. Default: true (dry-run). */
  readonly dryRun?: boolean;
  /** When true and dryRun is false, skip writing the `.bak` sidecar. */
  readonly noBackup?: boolean;
}

/**
 * Migrate every ```dgmo block in an `.md` / `.mdx` file. All-or-nothing
 * per file — a single parse-error block aborts the whole file.
 */
export function migrateEmbedded(
  path: string,
  opts: MigrateEmbeddedOptions = {}
): EmbeddedMigrationResult {
  const dryRun = opts.dryRun ?? true;
  const original = readFileSync(path, 'utf-8');
  const blocks = findFencedBlocks(original);

  if (blocks.length === 0) {
    return {
      path,
      original,
      migrated: original,
      changed: false,
      skipped: false,
      skipReason: null,
      blockCount: 0,
      changedBlocks: 0,
      backupWritten: false,
      written: false,
    };
  }

  // Pre-flight: every block must parse cleanly under the legacy
  // parser modulo the migration-target diagnostics (those are what
  // we're rewriting). Any other severity:error or a null chart-type
  // detection aborts the whole file (atomicity contract).
  for (const block of blocks) {
    const parsed = parseDgmo(block.body);
    if (parsed.chartType === null) {
      return {
        path,
        original,
        migrated: original,
        changed: false,
        skipped: true,
        skipReason: `block at line ${block.fenceStartLine + 1} has no recognized chart type`,
        blockCount: blocks.length,
        changedBlocks: 0,
        backupWritten: false,
        written: false,
      };
    }
    const blockingErrors = parsed.diagnostics.filter(
      (d) =>
        d.severity === 'error' &&
        (d.code === undefined || !MIGRATION_TARGET_CODES.has(d.code))
    );
    if (blockingErrors.length > 0) {
      return {
        path,
        original,
        migrated: original,
        changed: false,
        skipped: true,
        skipReason: `block at line ${block.fenceStartLine + 1} failed to parse: ${blockingErrors[0]!.message}`,
        blockCount: blocks.length,
        changedBlocks: 0,
        backupWritten: false,
        written: false,
      };
    }
  }

  // Migrate each block and rebuild the document.
  const lines = original.split('\n');
  const out: string[] = [];
  let cursor = 0;
  let changedBlocks = 0;
  let anyChange = false;

  for (const block of blocks) {
    for (let k = cursor; k <= block.bodyStart - 1; k++) {
      out.push(lines[k]!);
    }
    const blockResult = migrateContent(block.body);
    out.push(blockResult.migrated);
    if (blockResult.changed) {
      anyChange = true;
      changedBlocks++;
    }
    cursor = block.bodyEnd;
  }
  for (let k = cursor; k < lines.length; k++) {
    out.push(lines[k]!);
  }
  const migrated = out.join('\n');

  let backupWritten = false;
  let written = false;
  if (anyChange && !dryRun) {
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
    changed: anyChange,
    skipped: false,
    skipReason: null,
    blockCount: blocks.length,
    changedBlocks,
    backupWritten,
    written,
  };
}
