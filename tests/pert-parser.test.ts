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

  it('flags zero-duration activities as milestones', () => {
    const parsed = parsePert(loadFixture('with-zero-duration.dgmo'));
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

  it('accepts zero-duration activities and flags them as milestones', () => {
    const parsed = parsePert(`pert\nA 0 0 0\nB 0\n`);
    expect(parsed.error).toBeNull();
    expect(parsed.activities[0].isMilestone).toBe(true);
    expect(parsed.activities[1].isMilestone).toBe(true);
  });

  it('rejects the `milestone` keyword as unknown', () => {
    const parsed = parsePert(`pert\nmilestone voyage approved\n`);
    const diag = findError(parsed, "Unknown keyword 'milestone'");
    expect(diag).toBeDefined();
  });

  it('flags near-directive typos with a "did you mean" hint', () => {
    // `confidence medium` (missing the `default-` prefix) used to silently
    // register a TBD activity, which poisoned backward-anchor rollups
    // into a chart full of `?` cells with no actionable diagnostic.
    const cases: Array<{ line: string; canonical: string }> = [
      { line: 'confidence medium', canonical: 'default-confidence' },
      { line: 'confidence low', canonical: 'default-confidence' },
      { line: 'start 2026-06-01', canonical: 'start-date' },
      { line: 'start now', canonical: 'start-date' },
      { line: 'end 2026-09-15', canonical: 'end-date' },
      { line: 'time w', canonical: 'time-unit' },
    ];
    for (const { line, canonical } of cases) {
      const parsed = parsePert(`pert\n${line}\nA 1\n`);
      const diag = findError(parsed, `Did you mean '${canonical}'`);
      expect(diag, `expected hint for: ${line}`).toBeDefined();
      expect(diag?.code).toBe('E_PERT_NEAR_DIRECTIVE');
      // The bad line is skipped — no rogue activity registered.
      expect(
        parsed.activities.find((a) => a.name === line.split(' ')[0])
      ).toBeUndefined();
    }
  });

  it('does not flag activity names that share a directive stem', () => {
    // `start the engines 1 2 3` is a legitimate activity, not a typo for
    // `start-date`. The hint matcher only fires when the value matches
    // the directive's expected value shape (date, confidence level, etc.).
    const parsed = parsePert(`pert\nstart the engines 1 2 3\n`);
    expect(findError(parsed, 'Did you mean')).toBeUndefined();
    expect(parsed.activities[0]?.name).toBe('start the engines');
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

  it('rejects inline metadata on an arrow line', () => {
    const parsed = parsePert(`pert\nA 1 2 3\n  -> B confidence: low\n`);
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

describe('pert parser — indented metadata (§1.4.2)', () => {
  it('attaches an indented `confidence: low` line before the arrows', () => {
    const parsed = parsePert(
      `pert\ntime-unit w\nrecruit crew 1 2 4 as rc\n  confidence: low\n  -> load powder\nload powder 0.5 1 2\n`
    );
    expect(parsed.error).toBeNull();
    const rc = parsed.activities.find((a) => a.name === 'recruit crew');
    expect(rc?.confidence).toBe('low');
    // The metadata line is not registered as its own activity.
    expect(parsed.activities).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0]).toMatchObject({ target: 'load powder' });
  });

  it('attaches indented metadata placed after the arrows too', () => {
    const parsed = parsePert(
      `pert\ntime-unit w\nrecruit crew 1 2 4\n  -> load powder\n  confidence: high\nload powder 0.5 1 2\n`
    );
    expect(parsed.error).toBeNull();
    const rc = parsed.activities.find((a) => a.name === 'recruit crew');
    expect(rc?.confidence).toBe('high');
    expect(parsed.activities).toHaveLength(2);
  });

  it('merges indented metadata with same-line metadata', () => {
    const parsed = parsePert(
      `pert\ntag Priority as pr High red, Low green\nA 1 2 3 confidence: low\n  pr: High\n  -> B\nB 1\n`
    );
    expect(parsed.error).toBeNull();
    const a = parsed.activities.find((x) => x.name === 'A');
    expect(a?.confidence).toBe('low');
    expect(a?.tags).toMatchObject({ priority: 'High' });
  });

  it('dispatches a declared tag alias as indented metadata', () => {
    const parsed = parsePert(
      `pert\ntag Priority as pr High red, Low green\nA 1 2 3\n  pr: Low\n  -> B\nB 1\n`
    );
    expect(parsed.error).toBeNull();
    const a = parsed.activities.find((x) => x.name === 'A');
    expect(a?.tags).toMatchObject({ priority: 'Low' });
    expect(parsed.activities).toHaveLength(2);
  });

  it('does not treat an unknown indented `key: value` as metadata', () => {
    // `owner` is not a reserved PERT key nor a tag alias — it falls
    // through to the activity grammar as its own (oddly named) activity,
    // rather than silently attaching to the activity above.
    const parsed = parsePert(`pert\nA 1 2 3\n  owner: Bosun\n  -> B\nB 1\n`);
    const a = parsed.activities.find((x) => x.name === 'A');
    expect(a?.tags).toBeUndefined();
  });

  it('attaches indented metadata to an aliased bare-source reference', () => {
    const parsed = parsePert(
      `pert\ntime-unit w\nrecruit crew 1 2 4 as rc\nrc\n  confidence: low\n`
    );
    expect(parsed.error).toBeNull();
    const rc = parsed.activities.find((a) => a.name === 'recruit crew');
    expect(rc?.confidence).toBe('low');
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
  });
});

describe('pert parser — `no-analysis` directive', () => {
  it('`no-analysis` sets noAnalysis true without error or warning', () => {
    const parsed = parsePert(`pert
no-analysis
A 1 2 4
`);
    expect(parsed.error).toBeNull();
    expect(parsed.options.noAnalysis).toBe(true);
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    );
  });

  it('leaves noAnalysis undefined when the directive is absent (analysis on by default)', () => {
    const parsed = parsePert(`pert
A 1 2 4
`);
    expect(parsed.options.noAnalysis).toBeUndefined();
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

  // ── Universal date handling (BL-121) — liberal input + directives ──
  it('accepts a month-name start-date', () => {
    const parsed = parsePert(`pert\nstart-date July 4, 2026\nA 1 2 3\n`);
    expect(parsed.error).toBeNull();
    expect(parsed.options.anchor).toEqual({
      kind: 'forward',
      date: '2026-07-04',
    });
  });

  it('accepts a US month-first slash start-date', () => {
    const parsed = parsePert(`pert\nstart-date 7/4/2026\nA 1 2 3\n`);
    expect(parsed.options.anchor).toEqual({
      kind: 'forward',
      date: '2026-07-04',
    });
  });

  it('date-order dmy flips the slash reading', () => {
    const parsed = parsePert(
      `pert\ndate-order dmy\nstart-date 7/4/2026\nA 1 2 3\n`
    );
    expect(parsed.options.anchor).toEqual({
      kind: 'forward',
      date: '2026-04-07',
    });
  });

  it('year directive anchors a bare month-day end-date', () => {
    const parsed = parsePert(`pert\nyear 2026\nend-date 09-15\nA 1 2 3\n`);
    expect(parsed.options.anchor).toEqual({
      kind: 'backward',
      date: '2026-09-15',
    });
  });

  it('directives are position-independent (year may follow the anchor)', () => {
    const parsed = parsePert(`pert\nstart-date 06-01\nyear 2026\nA 1 2 3\n`);
    expect(parsed.options.anchor).toEqual({
      kind: 'forward',
      date: '2026-06-01',
    });
  });

  it('no-current-year makes a fully-bare anchor an error', () => {
    const parsed = parsePert(
      `pert\nno-current-year\nstart-date 06-01\nA 1 2 3\n`
    );
    expect(findCode(parsed, 'E_PERT_INVALID_DATE')).toBeDefined();
    expect(parsed.options.anchor).toBeNull();
  });

  it('still calendar-validates a liberal date (Feb 30)', () => {
    const parsed = parsePert(`pert\nstart-date Feb 30, 2026\nA 1 2 3\n`);
    expect(findCode(parsed, 'E_PERT_INVALID_DATE')).toBeDefined();
    expect(parsed.options.anchor).toBeNull();
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

describe('pert parser — sprint mode', () => {
  it('time-unit s auto-activates sprint mode with default sprint-length', () => {
    const r = parsePert(`pert
time-unit s
A 1 2 3
B 1 1 1
A
  -> B
`);
    expect(r.options.sprintMode).toBe('auto');
    expect(r.options.sprintLength).toEqual({ amount: 2, unit: 'w' });
    expect(r.options.sprintNumber).toBe(1);
  });

  it('canonical time-unit sp auto-activates sprint mode (decision #48)', () => {
    const r = parsePert(`pert
time-unit sp
A 1 2 3
`);
    expect(r.options.timeUnit).toBe('s');
    expect(r.options.sprintMode).toBe('auto');
    expect(r.options.sprintLength).toEqual({ amount: 2, unit: 'w' });
  });

  it('unknown time-unit error hints sp, not bare s', () => {
    const r = parsePert(`pert
time-unit x
A 1 2 3
`);
    const e = r.diagnostics.find((d) => /Unknown time-unit/.test(d.message));
    expect(e).toBeDefined();
    expect(e!.message).toContain('sp');
  });

  it('sp estimate suffix parses like the legacy s suffix', () => {
    // Per-activity sprint suffixes fall back to the diagram time-unit
    // (sprints have no calendar in PERT) — canonical `sp` must mirror `s`.
    const sp = parsePert(`pert
time-unit w
A 3sp
`);
    const s = parsePert(`pert
time-unit w
A 3s
`);
    expect(sp.error).toBeNull();
    expect(sp.activities[0]?.duration).toEqual(s.activities[0]?.duration);
    expect(sp.activities[0]?.duration).not.toBeNull();
  });

  it('sp lag suffix on an edge parses like the legacy s suffix', () => {
    const sp = parsePert(`pert
A 1 2 3
B 1 2 3
A
  -FS+2sp-> B
`);
    const s = parsePert(`pert
A 1 2 3
B 1 2 3
A
  -FS+2s-> B
`);
    expect(sp.error).toBeNull();
    expect(sp.edges).toEqual(s.edges);
  });

  it('explicit sprint-length triggers explicit mode and overrides default', () => {
    const r = parsePert(`pert
time-unit s
sprint-length 3w
sprint-number 5
A 1 2 3
`);
    expect(r.options.sprintMode).toBe('explicit');
    expect(r.options.sprintLength).toEqual({ amount: 3, unit: 'w' });
    expect(r.options.sprintNumber).toBe(5);
  });

  it('sprint-start is parsed as ISO date', () => {
    const r = parsePert(`pert
time-unit s
sprint-start 2026-06-01
A 1 1 1
`);
    expect(r.options.sprintMode).toBe('explicit');
    expect(r.options.sprintStart).toBe('2026-06-01');
  });

  it('rejects sprint-length with unsupported unit', () => {
    const r = parsePert(`pert
sprint-length 5h
A 1 1 1
`);
    const w = r.diagnostics.find(
      (d) =>
        d.severity === 'warning' && /sprint-length only accepts/.test(d.message)
    );
    expect(w).toBeDefined();
  });

  it('rejects non-positive integer sprint-number', () => {
    const r = parsePert(`pert
sprint-number 0
A 1 1 1
`);
    const w = r.diagnostics.find(
      (d) =>
        d.severity === 'warning' &&
        /sprint-number must be a positive integer/.test(d.message)
    );
    expect(w).toBeDefined();
  });

  it('does not activate sprint mode when no `s` unit and no sprint-* directive', () => {
    const r = parsePert(`pert
time-unit w
A 1 2 3
`);
    expect(r.options.sprintMode).toBeNull();
    expect(r.options.sprintLength).toBeNull();
  });
});

describe('pert parser — looksLikePert inference', () => {
  it('matches when content has `analysis monte-carlo`', () => {
    expect(looksLikePert('analysis monte-carlo\nA 1 2 3\n')).toBe(true);
  });

  it('does NOT match generic three-number content (the dropped heuristic)', () => {
    expect(looksLikePert('A 1 2 3\nB 1 2 3\n')).toBe(false);
  });
});

describe('pert parser — edge types and lag/lead', () => {
  function parseTwoActivityEdge(line: string) {
    const dsl = `pert\ntime-unit w\nA 1 1 1\nB 1 1 1\nA\n  ${line}\n`;
    return parsePert(dsl);
  }

  it('bare arrow `-> B` parses as FS with null lag (existing behavior)', () => {
    const r = parseTwoActivityEdge('-> B');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0].type).toBe('FS');
    expect(r.edges[0].lag).toBeNull();
  });

  it('`-SS-> B` parses as SS with null lag', () => {
    const r = parseTwoActivityEdge('-SS-> B');
    expect(r.edges[0].type).toBe('SS');
    expect(r.edges[0].lag).toBeNull();
  });

  it('`-FF-> B` parses as FF', () => {
    const r = parseTwoActivityEdge('-FF-> B');
    expect(r.edges[0].type).toBe('FF');
  });

  it('`-SF-> B` parses as SF', () => {
    const r = parseTwoActivityEdge('-SF-> B');
    expect(r.edges[0].type).toBe('SF');
  });

  it('`-2d-> B` parses as FS with +2d lag (lag-only shortcut)', () => {
    const r = parseTwoActivityEdge('-2d-> B');
    expect(r.edges[0].type).toBe('FS');
    expect(r.edges[0].lag).toEqual({ amount: 2, unit: 'd' });
  });

  it('`-SS+2d-> B` parses as SS with +2d lag', () => {
    const r = parseTwoActivityEdge('-SS+2d-> B');
    expect(r.edges[0].type).toBe('SS');
    expect(r.edges[0].lag).toEqual({ amount: 2, unit: 'd' });
  });

  it('`-FF-1d-> B` parses as FF with -1d lead (negative lag)', () => {
    const r = parseTwoActivityEdge('-FF-1d-> B');
    expect(r.edges[0].type).toBe('FF');
    expect(r.edges[0].lag).toEqual({ amount: -1, unit: 'd' });
  });

  it('lowercase types accepted: `-ss+2d-> B` normalizes to SS', () => {
    const r = parseTwoActivityEdge('-ss+2d-> B');
    expect(r.edges[0].type).toBe('SS');
    expect(r.edges[0].lag).toEqual({ amount: 2, unit: 'd' });
  });

  it('`-SS+2-> B` with `time-unit w` inherits weeks', () => {
    const r = parseTwoActivityEdge('-SS+2-> B');
    expect(r.edges[0].lag).toEqual({ amount: 2, unit: 'w' });
  });

  it('per-edge unit override: `-2h-> B` uses hours regardless of `time-unit w`', () => {
    const r = parseTwoActivityEdge('-2h-> B');
    expect(r.edges[0].lag).toEqual({ amount: 2, unit: 'h' });
  });

  it('zero lag normalizes to null: `-SS+0-> B` has type=SS, lag=null', () => {
    const r = parseTwoActivityEdge('-SS+0-> B');
    expect(r.edges[0].type).toBe('SS');
    expect(r.edges[0].lag).toBeNull();
  });

  it('decimal lag: `-1.5d-> B` parses correctly', () => {
    const r = parseTwoActivityEdge('-1.5d-> B');
    expect(r.edges[0].lag).toEqual({ amount: 1.5, unit: 'd' });
  });

  it('invalid type emits a diagnostic: `-XY+2d-> B`', () => {
    const r = parseTwoActivityEdge('-XY+2d-> B');
    const err = r.diagnostics.find(
      (d) => d.severity === 'error' && /Invalid edge label/.test(d.message)
    );
    expect(err).toBeDefined();
  });

  it('invalid unit emits a diagnostic: `-SS+2x-> B`', () => {
    const r = parseTwoActivityEdge('-SS+2x-> B');
    const err = r.diagnostics.find(
      (d) => d.severity === 'error' && /Invalid edge label/.test(d.message)
    );
    expect(err).toBeDefined();
  });
});
