import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parsePert,
  looksLikePert,
  extractPertSymbols,
} from '../src/pert/parser';

const FIXTURES = join(__dirname, '../test-fixtures/pert');
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function findError(parsed: ReturnType<typeof parsePert>, substring: string) {
  return parsed.diagnostics.find(
    (d) => d.severity === 'error' && d.message.includes(substring)
  );
}

describe('pert parser — fixtures', () => {
  it('parses basic.dgmo without errors', () => {
    const parsed = parsePert(loadFixture('basic.dgmo'));
    expect(parsed.error).toBeNull();
    expect(parsed.activities.map((a) => a.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(parsed.edges).toHaveLength(4);
  });

  it('parses three-point.dgmo with O M P estimates', () => {
    const parsed = parsePert(loadFixture('three-point.dgmo'));
    expect(parsed.error).toBeNull();
    const design = parsed.activities.find((a) => a.name === 'design');
    expect(design?.duration).not.toBeNull();
    expect(design?.duration?.o.amount).toBe(2);
    expect(design?.duration?.m.amount).toBe(5);
    expect(design?.duration?.p.amount).toBe(9);
  });

  it('parses with-groups.dgmo and assigns group membership', () => {
    const parsed = parsePert(loadFixture('with-groups.dgmo'));
    expect(parsed.error).toBeNull();
    const outfitShip = parsed.groups.find((g) => g.name === 'outfit ship');
    expect(outfitShip).toBeDefined();
    expect(outfitShip!.activityIds.length).toBeGreaterThanOrEqual(3);
    expect(outfitShip!.classification).toBeDefined();
  });

  it('parses with-milestones.dgmo as zero-duration diamond nodes', () => {
    const parsed = parsePert(loadFixture('with-milestones.dgmo'));
    expect(parsed.error).toBeNull();
    const milestones = parsed.activities.filter((a) => a.isMilestone);
    expect(milestones.map((m) => m.name)).toContain('voyage approved');
    expect(milestones.map((m) => m.name)).toContain('landfall');
    for (const m of milestones) {
      expect(m.duration?.m.amount).toBe(0);
    }
  });

  it('registers `as` aliases as references', () => {
    const parsed = parsePert(loadFixture('with-aliases.dgmo'));
    expect(parsed.error).toBeNull();
    // recruit crew has alias rc; sail to atoll has alias sa
    const sa = parsed.activities.find((a) => a.alias === 'sa');
    expect(sa?.name).toBe('sail to atoll');
    // reference via alias resolves to canonical id (= normalized name)
    const countGoldEdge = parsed.edges.find((e) => e.target === 'count gold');
    expect(countGoldEdge?.source).toBe('sail to atoll');
  });

  it('null-poisons TBD activities (parser side: duration === null)', () => {
    const parsed = parsePert(loadFixture('tbd-poison.dgmo'));
    expect(parsed.error).toBeNull();
    const celebrate = parsed.activities.find((a) => a.name === 'celebrate');
    expect(celebrate?.duration).toBeNull();
  });

  it('emits cycle-error fixture without parser-level error (cycle is analyzer concern)', () => {
    const parsed = parsePert(loadFixture('cycle-error.dgmo'));
    // Parser doesn't detect cycles; analyzer does. Parser succeeds.
    expect(parsed.error).toBeNull();
  });

  it('emits conflict diagnostic with both line numbers', () => {
    const parsed = parsePert(loadFixture('conflict-error.dgmo'));
    const conflict = findError(parsed, 'Conflicting estimates');
    expect(conflict).toBeDefined();
    expect(conflict!.message).toMatch(/line \d+.*line \d+/);
  });

  it('parses pirate-voyage.dgmo end-to-end', () => {
    const parsed = parsePert(loadFixture('pirate-voyage.dgmo'));
    expect(parsed.error).toBeNull();
    expect(parsed.activities.length).toBeGreaterThan(10);
    expect(parsed.groups.find((g) => g.name === 'outfit ship')).toBeDefined();
  });
});

describe('pert parser — duration validation', () => {
  it('rejects 2-number durations with `did you mean` hint', () => {
    const parsed = parsePert(`pert\nA 2 5\n`);
    const diag = findError(parsed, 'Expected 1 (M) or 3 (O M P)');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('Did you mean');
  });

  it('rejects O > M with reorder suggestion', () => {
    const parsed = parsePert(`pert\nA 5 3 2\n`);
    const diag = findError(parsed, 'expected O ≤ M ≤ P');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('Did you mean (2 3 5)?');
  });

  it('rejects zero/negative durations', () => {
    const parsedZero = parsePert(`pert\nA 0 0 0\n`);
    expect(findError(parsedZero, 'Duration must be > 0')).toBeDefined();
  });

  it('accepts M-only with confidence-based heuristic (downstream of analyzer)', () => {
    const parsed = parsePert(`pert\ntime-unit w\nA 2\n`);
    expect(parsed.error).toBeNull();
    const a = parsed.activities[0];
    // M-only sentinel: o.amount === m.amount === p.amount
    expect(a.duration?.o.amount).toBe(2);
    expect(a.duration?.m.amount).toBe(2);
    expect(a.duration?.p.amount).toBe(2);
  });

  it('accepts comma-separated durations', () => {
    const parsed = parsePert(`pert\nA 1, 2, 3\n`);
    expect(parsed.error).toBeNull();
    const a = parsed.activities[0];
    expect([
      a.duration?.o.amount,
      a.duration?.m.amount,
      a.duration?.p.amount,
    ]).toEqual([1, 2, 3]);
  });

  it('accepts mixed-unit durations', () => {
    const parsed = parsePert(`pert\nA 1d 2d 1w\n`);
    expect(parsed.error).toBeNull();
    const a = parsed.activities[0];
    expect(a.duration?.p.unit).toBe('w');
  });
});

describe('pert parser — alias rules', () => {
  it('AC1.7: registers aliases via `as <id>` suffix', () => {
    const parsed = parsePert(
      `pert\nrecruit crew 1 2 4 as rc\nrecruit crew\n  -> rc\n`
    );
    // Inline `-> rc` should resolve to alias even though no edge target was declared elsewhere.
    expect(parsed.activities.find((a) => a.alias === 'rc')).toBeDefined();
  });

  it('AC1.10: name containing literal `as` parses cleanly without an alias', () => {
    const parsed = parsePert(`pert\nserve as quartermaster 2 3 5\n`);
    expect(parsed.error).toBeNull();
    const a = parsed.activities[0];
    expect(a.name).toBe('serve as quartermaster');
    expect(a.alias).toBeUndefined();
  });
});

describe('pert parser — extractPertSymbols', () => {
  it('returns activity names + aliases + group names', () => {
    const symbols = extractPertSymbols(loadFixture('pirate-voyage.dgmo'));
    expect(symbols.kind).toBe('pert');
    expect(symbols.entities).toContain('recruit crew');
    expect(symbols.entities).toContain('rc'); // alias
    expect(symbols.entities).toContain('outfit ship'); // group
    expect(symbols.keywords).toContain('milestone');
    expect(symbols.keywords).toContain('analysis');
  });
});

describe('pert parser — looksLikePert inference', () => {
  it('matches when content has a `milestone <name>` line', () => {
    expect(looksLikePert('milestone go-live\n  -> A 1 2 3\n')).toBe(true);
  });

  it('matches when content has `analysis monte-carlo`', () => {
    expect(looksLikePert('analysis monte-carlo\nA 1 2 3\n')).toBe(true);
  });

  it('does NOT match generic three-number content (the dropped heuristic)', () => {
    expect(looksLikePert('A 1 2 3\nB 1 2 3\n')).toBe(false);
  });
});
