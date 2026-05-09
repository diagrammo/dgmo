import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parsePert,
  looksLikePert,
  extractPertSymbols,
} from '../src/pert/parser';
import { normalizePertSourceForShare } from '../src/pert/share-normalize';

const FIXTURES = join(__dirname, '../test-fixtures/pert');
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function findError(parsed: ReturnType<typeof parsePert>, substring: string) {
  return parsed.diagnostics.find(
    (d) => d.severity === 'error' && d.message.includes(substring)
  );
}

function findWarning(
  parsed: ReturnType<typeof parsePert>,
  opts: { code?: string; substring?: string }
) {
  return parsed.diagnostics.find(
    (d) =>
      d.severity === 'warning' &&
      (opts.code === undefined || d.code === opts.code) &&
      (opts.substring === undefined || d.message.includes(opts.substring))
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

describe('pert parser — inline forward-decl rejected', () => {
  it('rejects durations on an arrow line', () => {
    const parsed = parsePert(`pert\nA 1 2 3\n  -> B 2 3 5\n`);
    const diag = findError(parsed, 'Inline forward-declaration not allowed');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain("'2 3 5'");
    expect(diag!.message).toContain("'B 2 3 5'");
    expect(diag!.message).toContain("'-> B'");
  });

  it('rejects an `as <alias>` declaration on an arrow line', () => {
    const parsed = parsePert(`pert\nA 1 2 3\n  -> B as bb\n`);
    const diag = findError(parsed, 'Inline forward-declaration not allowed');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain("'as bb'");
  });

  it('rejects pipe metadata on an arrow line', () => {
    const parsed = parsePert(`pert\nA 1 2 3\n  -> B | confidence: low\n`);
    const diag = findError(parsed, 'Inline forward-declaration not allowed');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('confidence: low');
  });

  it('still accepts a bare `-> dest` reference', () => {
    const parsed = parsePert(`pert\nA 1 2 3\nB 2 3 5\nA\n  -> B\n`);
    expect(parsed.error).toBeNull();
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0]).toMatchObject({ source: 'a', target: 'b' });
  });

  it('still accepts a bare `-> alias` reference to an existing alias', () => {
    const parsed = parsePert(
      `pert\nrecruit crew 1 2 4 as rc\nA 1 2 3\nA\n  -> rc\n`
    );
    expect(parsed.error).toBeNull();
    expect(parsed.edges.find((e) => e.target === 'recruit crew')).toBeDefined();
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
    // `analysis` and `monte-carlo` were removed from autocomplete after
    // the directive became reserved-but-inert; lock the removal in.
    expect(symbols.keywords).not.toContain('analysis');
    expect(symbols.keywords).not.toContain('monte-carlo');
  });
});

describe('pert parser — `analysis` reserved-but-inert', () => {
  it('emits warning with code pert.deprecated.analysis-directive and parses without error', () => {
    const parsed = parsePert(`pert
analysis monte-carlo
A 1 2 4
`);
    expect(parsed.error).toBeNull();
    const warn = findWarning(parsed, {
      code: 'pert.deprecated.analysis-directive',
    });
    expect(warn).toBeDefined();
    expect(warn!.message).toContain('no longer needed');
  });

  it('emits the same warning for any value (directive is inert regardless)', () => {
    const parsed = parsePert(`pert
analysis some-future-mode
A 1 2 4
`);
    expect(parsed.error).toBeNull();
    const warn = findWarning(parsed, {
      code: 'pert.deprecated.analysis-directive',
    });
    expect(warn).toBeDefined();
  });

  it('emits no analysis-deprecation warning when the directive is absent', () => {
    const parsed = parsePert(`pert
A 1 2 4
`);
    expect(
      findWarning(parsed, { code: 'pert.deprecated.analysis-directive' })
    ).toBeUndefined();
  });
});

describe('pert parser — date anchoring', () => {
  function findCode(parsed: ReturnType<typeof parsePert>, code: string) {
    return parsed.diagnostics.find((d) => d.code === code);
  }

  it('accepts `start-date YYYY-MM-DD` and stores forward anchor', () => {
    const parsed = parsePert(`pert\nstart-date 2026-06-01\nA 1 2 3\n`);
    expect(parsed.error).toBeNull();
    expect(parsed.options.anchor).toEqual({
      kind: 'forward',
      date: '2026-06-01',
    });
  });

  it('accepts `end-date YYYY-MM-DD` and stores backward anchor', () => {
    const parsed = parsePert(`pert\nend-date 2026-09-15\nA 1 2 3\n`);
    expect(parsed.error).toBeNull();
    expect(parsed.options.anchor).toEqual({
      kind: 'backward',
      date: '2026-09-15',
    });
  });

  describe('with frozen system time', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves `start-date now` to today (host-local)', () => {
      vi.useFakeTimers().setSystemTime(new Date(2026, 4, 8, 12, 0, 0));
      const parsed = parsePert(`pert\nstart-date now\nA 1 2 3\n`);
      expect(parsed.error).toBeNull();
      expect(parsed.options.anchor).toEqual({
        kind: 'forward',
        date: '2026-05-08',
      });
    });
  });

  it('rejects `end-date now` with E_PERT_END_DATE_NOW', () => {
    const parsed = parsePert(`pert\nend-date now\nA 1 2 3\n`);
    const diag = findCode(parsed, 'E_PERT_END_DATE_NOW');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
    expect(diag!.message).toContain('only valid for `start-date`');
    expect(parsed.options.anchor).toBeNull();
  });

  it('rejects calendar-invalid dates with E_PERT_INVALID_DATE', () => {
    const parsed = parsePert(`pert\nstart-date 2026-13-99\nA 1 2 3\n`);
    const diag = findCode(parsed, 'E_PERT_INVALID_DATE');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
    expect(parsed.options.anchor).toBeNull();
  });

  it('rejects malformed shape with E_PERT_INVALID_DATE', () => {
    const parsed = parsePert(`pert\nstart-date 2026/06/01\nA 1 2 3\n`);
    const diag = findCode(parsed, 'E_PERT_INVALID_DATE');
    expect(diag).toBeDefined();
  });

  it('rejects both anchors with E_PERT_BOTH_ANCHORS and clears anchor', () => {
    const parsed = parsePert(
      `pert\nstart-date 2026-06-01\nend-date 2026-09-15\nA 1 2 3\n`
    );
    const diag = findCode(parsed, 'E_PERT_BOTH_ANCHORS');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
    // Clear-on-collision: no partial state.
    expect(parsed.options.anchor).toBeNull();
    // Diagnostic names the first anchor's line so the user knows which
    // directive collides (per F9 review fix).
    expect(diag!.message).toContain('line 2');
    expect(diag!.message).toContain('start-date');
    // And tells the user the FIRST anchor was also discarded (per F5).
    expect(diag!.message).toContain('discarded');
  });

  it('matches case-insensitively (Start-Date / START-DATE)', () => {
    const parsed = parsePert(`pert\nStart-Date 2026-06-01\nA 1 2 3\n`);
    expect(parsed.error).toBeNull();
    expect(parsed.options.anchor).toEqual({
      kind: 'forward',
      date: '2026-06-01',
    });
  });

  it('warns W_PERT_BD_WITH_ANCHOR for `time-unit bd` + anchor', () => {
    const parsed = parsePert(
      `pert\ntime-unit bd\nstart-date 2026-06-01\nA 1 2 3\n`
    );
    const diag = findCode(parsed, 'W_PERT_BD_WITH_ANCHOR');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('warning');
    // Order-independent — same warning when directives are reversed.
    const reversed = parsePert(
      `pert\nstart-date 2026-06-01\ntime-unit bd\nA 1 2 3\n`
    );
    expect(findCode(reversed, 'W_PERT_BD_WITH_ANCHOR')).toBeDefined();
  });

  it('warns W_PERT_SUBDAY_WITH_ANCHOR for `time-unit h`/`min` + anchor', () => {
    const h = parsePert(`pert\ntime-unit h\nstart-date 2026-06-01\nA 1 2 3\n`);
    expect(findCode(h, 'W_PERT_SUBDAY_WITH_ANCHOR')).toBeDefined();
    const m = parsePert(`pert\ntime-unit min\nend-date 2026-06-30\nA 1 2 3\n`);
    expect(findCode(m, 'W_PERT_SUBDAY_WITH_ANCHOR')).toBeDefined();
  });

  it('does not warn for `time-unit d`/`w`/`m`/`y`/`q` + anchor', () => {
    for (const unit of ['d', 'w', 'm', 'y', 'q']) {
      const parsed = parsePert(
        `pert\ntime-unit ${unit}\nstart-date 2026-06-01\nA 1 2 3\n`
      );
      expect(findCode(parsed, 'W_PERT_BD_WITH_ANCHOR')).toBeUndefined();
      expect(findCode(parsed, 'W_PERT_SUBDAY_WITH_ANCHOR')).toBeUndefined();
    }
  });
});

describe('pert parser — extractPertSymbols includes anchor keywords', () => {
  it('exposes `start-date` and `end-date` for autocomplete', () => {
    const symbols = extractPertSymbols(' ');
    expect(symbols.keywords).toContain('start-date');
    expect(symbols.keywords).toContain('end-date');
  });
});

describe('pert share normalizer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('substitutes `start-date now` with the resolved local date', () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 4, 8, 12, 0, 0));
    const dsl = `pert\ntime-unit w\nstart-date now\nA 1 2 3\n`;
    const out = normalizePertSourceForShare(dsl);
    expect(out).toContain('start-date 2026-05-08');
    expect(out).not.toContain('start-date now');
  });

  it('preserves a trailing comment on the substituted line', () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 4, 8, 12, 0, 0));
    const dsl = `pert\nstart-date now  # use today's plan\n`;
    const out = normalizePertSourceForShare(dsl);
    expect(out).toContain("start-date 2026-05-08  # use today's plan");
  });

  it('leaves explicit-date lines, other directives, and bare tokens untouched', () => {
    const dsl = [
      'pert',
      'time-unit w',
      'start-date 2026-06-01',
      '# now is a calm sea',
      'A 1 2 3',
      '  -> B 1 2 3 # do this now',
    ].join('\n');
    const out = normalizePertSourceForShare(dsl);
    expect(out).toBe(dsl);
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
