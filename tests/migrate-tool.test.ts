import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findUnsafePipePositions,
  isLegacyMetadataLine,
} from '../src/migrate/line-classifier';
import { transformLine } from '../src/migrate/line-transformer';
import {
  migrateContent,
  migrateFile,
  formatLineDiff,
  collectDgmoFiles,
} from '../src/migrate';
import { migrateEmbedded } from '../src/migrate/embedded';

// ============================================================
// Line classifier
// ============================================================

describe('isLegacyMetadataLine', () => {
  it('flags simple Foo | k: v', () => {
    expect(isLegacyMetadataLine('Foo | k: v')).toBe(true);
  });

  it('flags bracket headers with metadata', () => {
    expect(isLegacyMetadataLine('[Backlog] | wip: 5')).toBe(true);
  });

  it('flags lines with only `|` (empty meta)', () => {
    expect(isLegacyMetadataLine('Foo |')).toBe(true);
  });

  it('does not flag lines with no pipe', () => {
    expect(isLegacyMetadataLine('Foo bar baz')).toBe(false);
    expect(isLegacyMetadataLine('  indented child')).toBe(false);
    expect(isLegacyMetadataLine('')).toBe(false);
  });

  it('does not flag pipe inside wireframe option braces', () => {
    expect(isLegacyMetadataLine('dropdown Region {US|EU|APAC}')).toBe(false);
    expect(isLegacyMetadataLine('  {Yes|No}')).toBe(false);
  });

  it('does not flag pipe inside double-quoted strings', () => {
    expect(isLegacyMetadataLine('"Order | Items"')).toBe(false);
    expect(isLegacyMetadataLine('Foo "with | pipe" trailing')).toBe(false);
  });

  it('does not flag pipe inside single-quoted strings', () => {
    expect(isLegacyMetadataLine("'Order | Items'")).toBe(false);
  });

  it('does not flag pipe inside arrow labels (§1.10)', () => {
    expect(isLegacyMetadataLine('A -file|name-> B')).toBe(false);
    expect(isLegacyMetadataLine('A ~event|kind~> B')).toBe(false);
  });

  it('flags pipe AFTER an arrow as legacy', () => {
    expect(isLegacyMetadataLine('A -uses-> B | tech: HTTP')).toBe(true);
  });

  it('does NOT confuse plain `--` runs with arrow openers', () => {
    expect(isLegacyMetadataLine('A --> B | meta')).toBe(true);
  });

  it('handles nested braces', () => {
    expect(isLegacyMetadataLine('{outer {inner|child} more}')).toBe(false);
  });

  it('separates regions correctly when both surviving and legacy `|` coexist', () => {
    // `|` inside dropdown should be skipped; pipe before metadata should be flagged.
    expect(isLegacyMetadataLine('dropdown {A|B|C} | label: Choose')).toBe(true);
  });
});

describe('findUnsafePipePositions', () => {
  it('returns empty when nothing legacy', () => {
    expect(findUnsafePipePositions('Foo bar')).toEqual([]);
    expect(findUnsafePipePositions('{A|B}')).toEqual([]);
  });

  it('returns offsets of every metadata-position pipe', () => {
    const line = 'Foo | k: v | extra';
    const positions = findUnsafePipePositions(line);
    // Two pipes outside any region — both flagged.
    expect(positions.length).toBe(2);
    expect(line[positions[0]!]).toBe('|');
    expect(line[positions[1]!]).toBe('|');
  });
});

// ============================================================
// Line transformer
// ============================================================

describe('transformLine — generic', () => {
  it('drops the pipe delimiter (kanban-style)', () => {
    const r = transformLine('  Foo | k: v, k2: v2', 'kanban');
    expect(r.changed).toBe(true);
    expect(r.line).toBe('  Foo k: v, k2: v2');
  });

  it('preserves leading indent (tabs preserved)', () => {
    const r = transformLine('\t\tFoo | k: v', 'kanban');
    expect(r.line.startsWith('\t\t')).toBe(true);
  });

  it('returns changed:false when there is no legacy pipe', () => {
    const r = transformLine('Foo k: v', 'kanban');
    expect(r.changed).toBe(false);
    expect(r.line).toBe('Foo k: v');
  });

  it('skips lines whose only pipe is inside a brace dropdown', () => {
    const r = transformLine('dropdown {A|B|C}', 'wireframe');
    expect(r.changed).toBe(false);
  });

  it('skips lines whose only pipe is inside a quoted string', () => {
    const r = transformLine('"Foo | bar" baz', 'kanban');
    expect(r.changed).toBe(false);
  });

  it('skips lines whose only pipe is inside an arrow label', () => {
    const r = transformLine('A -file|name-> B', 'sequence');
    expect(r.changed).toBe(false);
  });

  it('treats extra unsafe `|`s as comma delimiters (legacy multi-pipe shorthand)', () => {
    // Authors commonly wrote `Foo | k: v | k: v` instead of comma-
    // separating after a single pipe. The legacy parser flagged this
    // as E_MULTIPLE_PIPES; the migration tool normalizes it to the
    // canonical comma-separated form.
    const r = transformLine(
      'Alice Park | role: Senior Engineer | location: NY',
      'org'
    );
    expect(r.line).toBe('Alice Park role: Senior Engineer, location: NY');
  });
});

describe('transformLine — gantt bare percent', () => {
  it('promotes a single bare percent', () => {
    const r = transformLine('30bd Task | 80%', 'gantt');
    expect(r.line).toBe('30bd Task progress: 80');
  });

  it('promotes percent mixed with other keys', () => {
    const r = transformLine('30bd Task | t: Eng, p: Build, 80%', 'gantt');
    expect(r.line).toBe('30bd Task t: Eng, p: Build, progress: 80');
  });

  it('handles 100% (boundary)', () => {
    const r = transformLine('10bd Done | 100%', 'gantt');
    expect(r.line).toBe('10bd Done progress: 100');
  });

  it('does NOT promote percent in non-gantt charts', () => {
    const r = transformLine('Foo | 80%', 'kanban');
    expect(r.line).toBe('Foo 80%');
  });
});

describe('transformLine — journey-map bare score', () => {
  it('promotes bare score+emotion', () => {
    const r = transformLine('Step | 4 Delighted', 'journey-map');
    expect(r.line).toBe('Step score: 4, emotion: Delighted');
  });

  it('promotes bare score alone', () => {
    const r = transformLine('Step | 3', 'journey-map');
    expect(r.line).toBe('Step score: 3');
  });

  it('coexists with other keys', () => {
    const r = transformLine('Step | 4 Happy, ch: Web', 'journey-map');
    expect(r.line).toBe('Step score: 4, emotion: Happy, ch: Web');
  });
});

describe('transformLine — pyramid/ring bare description', () => {
  it('promotes whole meta region to description: <text>', () => {
    const r = transformLine('Wisdom | Insight beyond knowledge', 'pyramid');
    expect(r.line).toBe('Wisdom description: Insight beyond knowledge');
  });

  it('quotes the value when it contains a comma', () => {
    const r = transformLine('Wisdom | a, b, c', 'pyramid');
    expect(r.line).toBe('Wisdom description: "a, b, c"');
  });

  it('does NOT promote when meta region has `:` (treats as keyed)', () => {
    const r = transformLine('Wisdom | color: purple', 'pyramid');
    expect(r.line).toBe('Wisdom color: purple');
  });

  it('applies to ring too', () => {
    const r = transformLine('Inner | core principles', 'ring');
    expect(r.line).toBe('Inner description: core principles');
  });

  it('strips trailing pipe with empty meta', () => {
    const r = transformLine('Wisdom |', 'pyramid');
    expect(r.line).toBe('Wisdom');
  });
});

// ============================================================
// migrateContent — chart-type detection + whole-document
// ============================================================

describe('migrateContent', () => {
  it('detects chart type from line 1 and applies chart-aware promotions', () => {
    const src = `gantt Sprint

[Backend]
  30bd Database | t: Eng, 80%
`;
    const r = migrateContent(src);
    expect(r.changed).toBe(true);
    expect(r.chartType).toBe('gantt');
    expect(r.migrated).toContain('progress: 80');
  });

  it('is idempotent — second pass changes nothing', () => {
    const src = `kanban Board

[Todo]
  Item | priority: High
`;
    const first = migrateContent(src);
    const second = migrateContent(first.migrated);
    expect(second.changed).toBe(false);
    expect(second.migrated).toBe(first.migrated);
  });

  it('reports line numbers of changes (1-based)', () => {
    const src = `kanban Board

[Todo]
  Item | priority: High
  Other | priority: Low
`;
    const r = migrateContent(src);
    expect(r.changedLines).toEqual([4, 5]);
  });

  it('preserves non-metadata content byte-for-byte', () => {
    const src = `wireframe

dropdown Region {US|EU|APAC}
// comment line
field Email | required
`;
    const r = migrateContent(src);
    const lines = r.migrated.split('\n');
    expect(lines[2]).toBe('dropdown Region {US|EU|APAC}');
    expect(lines[3]).toBe('// comment line');
  });
});

// ============================================================
// migrateFile — file I/O semantics
// ============================================================

describe('migrateFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dgmo-migrate-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const p = join(dir, name);
    writeFileSync(p, content, 'utf-8');
    return p;
  }

  it('dry-run does not write to disk', () => {
    const p = writeFile('a.dgmo', 'kanban\n[Todo]\n  X | k: v\n');
    const result = migrateFile(p, { dryRun: true });
    expect(result.changed).toBe(true);
    expect(result.written).toBe(false);
    // On-disk content unchanged
    expect(readFileSync(p, 'utf-8')).toBe('kanban\n[Todo]\n  X | k: v\n');
  });

  it('--apply writes file + creates .bak by default', () => {
    const original = 'kanban\n[Todo]\n  X | k: v\n';
    const p = writeFile('a.dgmo', original);
    const result = migrateFile(p, { dryRun: false });
    expect(result.written).toBe(true);
    expect(result.backupWritten).toBe(true);
    expect(readFileSync(p, 'utf-8')).toContain('X k: v');
    expect(readFileSync(`${p}.bak`, 'utf-8')).toBe(original);
  });

  it('--no-backup skips .bak', () => {
    const p = writeFile('a.dgmo', 'kanban\n[Todo]\n  X | k: v\n');
    const result = migrateFile(p, { dryRun: false, noBackup: true });
    expect(result.written).toBe(true);
    expect(result.backupWritten).toBe(false);
    expect(existsSync(`${p}.bak`)).toBe(false);
  });

  it('does not double-bak — preserves the original .bak across re-runs', () => {
    const original = 'kanban\n[Todo]\n  X | k: v\n';
    const p = writeFile('a.dgmo', original);
    // First apply
    migrateFile(p, { dryRun: false });
    const firstBak = readFileSync(`${p}.bak`, 'utf-8');
    expect(firstBak).toBe(original);
    // Manually corrupt main file with a NEW legacy pipe and re-run.
    // The .bak must not be overwritten with the now-altered "original".
    writeFileSync(p, 'kanban\n[Todo]\n  Y | k: v2\n', 'utf-8');
    migrateFile(p, { dryRun: false });
    const secondBak = readFileSync(`${p}.bak`, 'utf-8');
    expect(secondBak).toBe(firstBak);
  });

  it('reports changed:false for already-migrated files (no write, no .bak)', () => {
    const p = writeFile('a.dgmo', 'kanban\n[Todo]\n  X k: v\n');
    const result = migrateFile(p, { dryRun: false });
    expect(result.changed).toBe(false);
    expect(result.written).toBe(false);
    expect(result.backupWritten).toBe(false);
    expect(existsSync(`${p}.bak`)).toBe(false);
  });
});

// ============================================================
// collectDgmoFiles + formatLineDiff helpers
// ============================================================

describe('collectDgmoFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dgmo-collect-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the single file when given a file path', () => {
    const p = join(dir, 'one.dgmo');
    writeFileSync(p, 'kanban\n', 'utf-8');
    expect(collectDgmoFiles(p)).toEqual([p]);
  });

  it('walks directories recursively, only .dgmo files', () => {
    writeFileSync(join(dir, 'a.dgmo'), '', 'utf-8');
    writeFileSync(join(dir, 'b.md'), '', 'utf-8');
    writeFileSync(join(dir, 'c.dgmo.bak'), '', 'utf-8');
    const found = collectDgmoFiles(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('a.dgmo');
  });
});

describe('formatLineDiff', () => {
  it('emits a header and per-line +/− pairs', () => {
    const out = formatLineDiff('/p/file.dgmo', 'A\nB | x\nC\n', 'A\nB x\nC\n');
    expect(out).toContain('--- /p/file.dgmo');
    expect(out).toContain('+++ /p/file.dgmo');
    expect(out).toContain('- B | x');
    expect(out).toContain('+ B x');
  });
});

// ============================================================
// migrateEmbedded — markdown / mdx atomicity
// ============================================================

describe('migrateEmbedded', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dgmo-embedded-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const p = join(dir, name);
    writeFileSync(p, content, 'utf-8');
    return p;
  }

  it('migrates every fenced dgmo block in a .md file', () => {
    const src = [
      '# Heading',
      '',
      'Prose.',
      '',
      '```dgmo',
      'kanban',
      '[Todo]',
      '  Item | k: v',
      '```',
      '',
      '```dgmo',
      'mindmap',
      'Root | p: high',
      '```',
      '',
    ].join('\n');
    const p = writeFile('doc.md', src);
    const result = migrateEmbedded(p, { dryRun: false });
    expect(result.changed).toBe(true);
    expect(result.blockCount).toBe(2);
    expect(result.changedBlocks).toBe(2);
    expect(result.written).toBe(true);
    const got = readFileSync(p, 'utf-8');
    expect(got).toContain('Item k: v');
    expect(got).toContain('Root p: high');
    // Prose preserved verbatim
    expect(got).toContain('# Heading');
    expect(got).toContain('Prose.');
  });

  it('atomicity: skips entire file when any block fails to parse', () => {
    const src = [
      '```dgmo',
      'kanban',
      '[Todo]',
      '  Item | k: v',
      '```',
      '',
      '```dgmo',
      '!!! not a valid chart type',
      '```',
    ].join('\n');
    const p = writeFile('doc.md', src);
    const result = migrateEmbedded(p, { dryRun: false });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBeTruthy();
    expect(result.written).toBe(false);
    expect(existsSync(`${p}.bak`)).toBe(false);
    // File on disk unchanged
    expect(readFileSync(p, 'utf-8')).toBe(src);
  });

  it('is idempotent in embedded mode', () => {
    const src = ['```dgmo', 'kanban', '[Todo]', '  Item | k: v', '```'].join(
      '\n'
    );
    const p = writeFile('doc.md', src);
    migrateEmbedded(p, { dryRun: false });
    const afterFirst = readFileSync(p, 'utf-8');
    const second = migrateEmbedded(p, { dryRun: false });
    expect(second.changed).toBe(false);
    expect(readFileSync(p, 'utf-8')).toBe(afterFirst);
  });

  it('handles files with zero dgmo blocks gracefully', () => {
    const src = '# A doc with no diagrams\n\nJust prose.\n';
    const p = writeFile('doc.md', src);
    const result = migrateEmbedded(p, { dryRun: false });
    expect(result.changed).toBe(false);
    expect(result.blockCount).toBe(0);
    expect(result.written).toBe(false);
  });

  it('respects --no-backup', () => {
    const src = '```dgmo\nkanban\n[Todo]\n  X | k: v\n```\n';
    const p = writeFile('doc.md', src);
    migrateEmbedded(p, { dryRun: false, noBackup: true });
    expect(existsSync(`${p}.bak`)).toBe(false);
  });
});

// ============================================================
// Migration produces parseable output
// ============================================================
//
// The contract: migrated source parses with zero migration-target
// diagnostics. (Pre-existing diagnostics in the legacy source carry
// through — the migration tool is not a repair tool.)

const MIGRATION_TARGET_CODES = [
  'E_PIPE_OPERATOR_REMOVED',
  'E_GANTT_BARE_PERCENT_REMOVED',
  'E_JOURNEY_BARE_SCORE_REMOVED',
  'E_PYRAMID_BARE_DESCRIPTION_REMOVED',
  'E_RING_BARE_DESCRIPTION_REMOVED',
];

describe('migrated content parses clean of migration-target diagnostics', () => {
  it('kanban: legacy → migrated → parse emits no pipe-removed errors', async () => {
    const { parseDgmo } = await import('../src/dgmo-router');
    const legacy = `kanban Sprint

tag Priority as p
  High red
  Low green

[Todo]
  Ship feature | p: High
  Fix bug | p: Low
`;
    const migrated = migrateContent(legacy).migrated;
    const before = parseDgmo(legacy).diagnostics;
    const after = parseDgmo(migrated).diagnostics;
    expect(
      before.some((d) => d.code && MIGRATION_TARGET_CODES.includes(d.code))
    ).toBe(true);
    expect(
      after.some((d) => d.code && MIGRATION_TARGET_CODES.includes(d.code))
    ).toBe(false);
  });

  it('gantt: bare-percent promotion produces progress: 80 in the model', async () => {
    const { parseGantt } = await import('../src/gantt/parser');
    const { getPalette } = await import('../src/palettes');
    const palette = getPalette('bold').light;
    const migrated = migrateContent(
      `gantt Demo
start 2024-01-01

[Phase]
  10bd Demo Task | 80%
`
    ).migrated;
    const result = parseGantt(migrated, palette);
    // Tasks live inside the group's `children`, not at the top level.
    const group = result.nodes.find(
      (n: { kind: string }) => n.kind === 'group'
    ) as { children?: Array<{ label: string; progress?: number }> } | undefined;
    const task = group?.children?.find((c) => c.label === 'Demo Task');
    expect(task?.progress).toBe(80);
  });
});
