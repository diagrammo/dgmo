import { describe, it, expect } from 'vitest';
import { parseRaci, allTasks } from '../src/raci/parser';
import {
  RACI_ERROR_CODES,
  RACI_WARNING_CODES,
  VARIANTS,
} from '../src/raci/variants';
import { NAME_DIAGNOSTIC_CODES } from '../src/diagnostics';

const codes = (parsed: ReturnType<typeof parseRaci>): string[] =>
  parsed.diagnostics.map((d) => d.code ?? `<no-code:${d.severity}>`);

const errorCount = (parsed: ReturnType<typeof parseRaci>): number =>
  parsed.diagnostics.filter((d) => d.severity === 'error').length;

// ============================================================
// Happy paths
// ============================================================

describe('parseRaci — happy paths', () => {
  it('parses a minimal RACI with one task and one role', () => {
    const r = parseRaci(`raci\n\nTask\n  Role: A`);
    expect(r.error).toBeNull();
    expect(r.variant).toBe('raci');
    expect(r.tasksWithoutPhase).toHaveLength(1);
    const t = r.tasksWithoutPhase[0];
    expect(t.displayName).toBe('Task');
    expect(t.roleAssignments).toHaveLength(1);
    expect(t.roleAssignments[0].displayName).toBe('Role');
    expect(t.roleAssignments[0].markers).toEqual(['A']);
    // Only the Responsible-missing warning fires (A is present).
    expect(codes(r)).toContain(RACI_WARNING_CODES.MISSING_RESPONSIBLE);
    expect(errorCount(r)).toBe(0);
  });

  it('parses a chart with title from the header line', () => {
    const r = parseRaci(`raci Voyage Operations\n\nTask\n  Cap: A`);
    expect(r.title).toBe('Voyage Operations');
    expect(r.titleLineNumber).toBe(1);
  });

  it('parses RASCI with the S marker accepted', () => {
    const r = parseRaci(`rasci\n\nTask\n  Cap: A\n  Crew: R\n  Bosun: S`);
    expect(r.error).toBeNull();
    expect(r.variant).toBe('rasci');
    const task = r.tasksWithoutPhase[0];
    const bosun = task.roleAssignments.find((a) => a.displayName === 'Bosun');
    expect(bosun?.markers).toEqual(['S']);
  });

  it('parses DACI with D and A required, C/I optional', () => {
    const r = parseRaci(`daci\n\nDecide route\n  PM: D\n  Cap: A`);
    expect(r.variant).toBe('daci');
    expect(errorCount(r)).toBe(0);
  });

  it('parses combined markers in source order', () => {
    const r = parseRaci(`raci\n\nTask\n  Captain: A R`);
    const ra = r.tasksWithoutPhase[0].roleAssignments[0];
    expect(ra.markers).toEqual(['A', 'R']);
  });

  it('parses phase grouping', () => {
    const r = parseRaci(`raci

[Planning]
  Task A
    Cap: A
    QM: R
  Task B
    Cap: A
    Bos: R

[Execution]
  Task C
    Cap: A
    Crew: R`);
    expect(r.error).toBeNull();
    expect(r.phases).toHaveLength(2);
    expect(r.phases[0].displayName).toBe('Planning');
    expect(r.phases[0].tasks).toHaveLength(2);
    expect(r.phases[1].displayName).toBe('Execution');
    expect(r.phases[1].tasks).toHaveLength(1);
    expect(r.tasksWithoutPhase).toHaveLength(0);
  });

  it('parses a mix of ungrouped and phased tasks', () => {
    const r = parseRaci(`raci

Top-level task
  Cap: A
  Crew: R

[Voyage]
  Phased task
    Cap: A
    Crew: R`);
    expect(r.tasksWithoutPhase).toHaveLength(1);
    expect(r.tasksWithoutPhase[0].displayName).toBe('Top-level task');
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0].tasks[0].displayName).toBe('Phased task');
  });

  it('parses a multi-line description before the first role assignment', () => {
    const r = parseRaci(`raci

Task
  Plot the course.
  Avoid the rocks.
  Cap: A
  Crew: R`);
    const t = r.tasksWithoutPhase[0];
    expect(t.description).toBe('Plot the course.\nAvoid the rocks.');
    expect(t.roleAssignments).toHaveLength(2);
  });
});

// ============================================================
// Constraint linting
// ============================================================

describe('parseRaci — constraint linting', () => {
  it('emits E_RACI_MULTI_ACCOUNTABLE when a task has two A markers', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: A\n  QM: A`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.MULTI_ACCOUNTABLE);
    const e = r.diagnostics.find(
      (d) => d.code === RACI_ERROR_CODES.MULTI_ACCOUNTABLE
    );
    // Points at the second A line (line 5), not the first (line 4).
    expect(e?.line).toBe(5);
  });

  it('emits W_RACI_MISSING_ACCOUNTABLE when no A is assigned', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: R`);
    expect(codes(r)).toContain(RACI_WARNING_CODES.MISSING_ACCOUNTABLE);
  });

  it('emits W_RACI_MISSING_RESPONSIBLE when no R is assigned', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: A`);
    expect(codes(r)).toContain(RACI_WARNING_CODES.MISSING_RESPONSIBLE);
  });

  it('DACI: two D markers fires E_DACI_MULTI_DRIVER', () => {
    const r = parseRaci(`daci\n\nDecision\n  PM: D\n  Cap: D`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.DACI_MULTI_DRIVER);
  });

  it('DACI: two A markers fires E_DACI_MULTI_ACCOUNTABLE', () => {
    const r = parseRaci(`daci\n\nDecision\n  PM: A\n  Cap: A`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.DACI_MULTI_ACCOUNTABLE);
  });

  it('DACI: missing-D and missing-A both fire as warnings', () => {
    const r = parseRaci(`daci\n\nDecision\n  PM: C`);
    expect(codes(r)).toContain(RACI_WARNING_CODES.DACI_MISSING_DRIVER);
    expect(codes(r)).toContain(RACI_WARNING_CODES.DACI_MISSING_ACCOUNTABLE);
  });

  it('emits E_RACI_INVALID_MARKER for marker not in the variant alphabet', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: X`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('S is invalid in plain RACI', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: S`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('S is valid in RASCI', () => {
    const r = parseRaci(`rasci\n\nTask\n  Cap: A\n  Crew: R\n  Bosun: S`);
    expect(codes(r)).not.toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('emits E_RACI_UNEXPECTED_LINE for free-text after first role assignment', () => {
    const r = parseRaci(`raci

Task
  Cap: A
  This is an unexpected description.`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.UNEXPECTED_LINE);
  });
});

// ============================================================
// Suppression: draft mode + per-task `# allow-incomplete`
// ============================================================

describe('parseRaci — diagnostic suppression', () => {
  it('draft directive suppresses missing-A / missing-R warnings chart-wide', () => {
    const r = parseRaci(`raci
draft

Task A
  Cap: I
Task B
  Cap: C`);
    expect(codes(r)).not.toContain(RACI_WARNING_CODES.MISSING_ACCOUNTABLE);
    expect(codes(r)).not.toContain(RACI_WARNING_CODES.MISSING_RESPONSIBLE);
  });

  it('draft does NOT suppress multi-A error (variant-defining rule)', () => {
    const r = parseRaci(`raci
draft

Task
  Cap: A
  QM: A`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.MULTI_ACCOUNTABLE);
  });

  it('# allow-incomplete suppresses warnings for THAT task only', () => {
    const r = parseRaci(`raci

Free task
  Cap: I
Quiet task # allow-incomplete
  Cap: C`);
    const warnings = r.diagnostics
      .filter((d) => d.severity === 'warning')
      .map((d) => `${d.line}:${d.code}`);
    // Warnings should attach to the FIRST task (line 3), not the second (line 5).
    expect(warnings.some((w) => w.startsWith('3:'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('5:'))).toBe(false);
  });

  it('warns on unknown # annotation', () => {
    const r = parseRaci(`raci\n\nTask # bogus-annotation\n  Cap: A`);
    expect(codes(r)).toContain(RACI_WARNING_CODES.UNKNOWN_ANNOTATION);
  });

  it('does not strip a hash that lives inside a quoted string', () => {
    const r = parseRaci(`raci\n\n"Task with # in name"\n  Cap: A`);
    const t = r.tasksWithoutPhase[0];
    // The hash inside quotes should be preserved.
    expect(t.displayName).toContain('#');
    expect(t.annotations.size).toBe(0);
  });
});

// ============================================================
// `roles:` directive (hybrid mode)
// ============================================================

describe('parseRaci — roles directive', () => {
  it('declares column order from inline `roles Cap, QM, Bos`', () => {
    const r = parseRaci(`raci
roles Cap, QM, Bos

Task
  Cap: A
  QM: R`);
    // Column order is the declared order; usage adds nothing new.
    expect(r.roleDisplayNames).toEqual(['Cap', 'QM', 'Bos']);
  });

  it('declares column order from indented block form', () => {
    const r = parseRaci(`raci
roles
  Cap
  QM
  Bos
  Nav
  Crew

Task
  Cap: A
  QM: R`);
    expect(r.error).toBeNull();
    expect(r.roleDisplayNames).toEqual(['Cap', 'QM', 'Bos', 'Nav', 'Crew']);
  });

  it('block form tolerates trailing commas', () => {
    const r = parseRaci(`raci
roles
  Cap,
  QM,
  Bos,

Task
  Cap: A`);
    expect(r.roleDisplayNames).toEqual(['Cap', 'QM', 'Bos']);
  });

  it('block form: blank lines and comments inside the block are tolerated', () => {
    const r = parseRaci(`raci
roles
  Cap
  // skip me
  QM

  Bos

Task
  Cap: A`);
    expect(r.roleDisplayNames).toEqual(['Cap', 'QM', 'Bos']);
  });

  it('emits W_RACI_UNKNOWN_ROLE when an undeclared role is used', () => {
    const r = parseRaci(`raci
roles Cap, QM

Task
  Cap: A
  Stranger: R`);
    expect(codes(r)).toContain(RACI_WARNING_CODES.UNKNOWN_ROLE);
  });

  it('does NOT emit unknown-role when no `roles:` directive is declared', () => {
    const r = parseRaci(`raci\n\nTask\n  Anyone: A`);
    expect(codes(r)).not.toContain(RACI_WARNING_CODES.UNKNOWN_ROLE);
  });
});

// ============================================================
// Forgiving identity (UNH normalization)
// ============================================================

describe('parseRaci — forgiving identity', () => {
  it('merges role-name case differences and warns I_NAME_MERGED', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: A\n  cap: R`);
    expect(codes(r)).toContain(NAME_DIAGNOSTIC_CODES.NAME_MERGED);
    // Both assignments share the same role id.
    const ids = r.tasksWithoutPhase[0].roleAssignments.map((a) => a.id);
    expect(new Set(ids).size).toBe(1);
  });

  it('first-seen casing wins', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: A\n  cap: R`);
    expect(r.roleDisplayNames).toEqual(['Cap']);
  });
});

// ============================================================
// Variant directive
// ============================================================

describe('parseRaci — variant directive', () => {
  it('variant directive overrides the leading id', () => {
    const r = parseRaci(`raci
variant rasci

Task
  Cap: A
  Crew: S`);
    expect(r.variant).toBe('rasci');
    expect(codes(r)).not.toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('rejects unknown variant value with a parse error', () => {
    const r = parseRaci(`raci
variant cairo

Task
  Cap: A`);
    expect(errorCount(r)).toBeGreaterThanOrEqual(1);
  });

  it('the leading chart-type id sets the default variant', () => {
    expect(parseRaci(`raci\n\nTask\n  Cap: A`).variant).toBe('raci');
    expect(parseRaci(`rasci\n\nTask\n  Cap: A`).variant).toBe('rasci');
    expect(parseRaci(`daci\n\nTask\n  Cap: D\n  QM: A`).variant).toBe('daci');
  });
});

// ============================================================
// Edge cases
// ============================================================

describe('parseRaci — edge cases', () => {
  it('returns a parse error for empty content', () => {
    const r = parseRaci('');
    expect(r.error).not.toBeNull();
  });

  it('returns a parse error if first line is not a RACI variant', () => {
    const r = parseRaci(`flowchart\n\nA -> B`);
    expect(r.error).not.toBeNull();
  });

  it('handles only-phase, no-tasks (no crash)', () => {
    const r = parseRaci(`raci\n\n[Empty]`);
    expect(r.error).toBeNull();
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0].tasks).toHaveLength(0);
  });

  it('captures lineNumber and endLineNumber on tasks', () => {
    const r = parseRaci(`raci

[Phase]
  Task A
    Cap: A
    Crew: R
  Task B
    Cap: A`);
    const t1 = r.phases[0].tasks[0];
    const t2 = r.phases[0].tasks[1];
    expect(t1.lineNumber).toBe(4);
    expect(t1.endLineNumber).toBe(6);
    expect(t2.lineNumber).toBe(7);
    expect(t2.endLineNumber).toBe(8);
  });

  it('allTasks() iterates phased + unphased tasks in source order', () => {
    const r = parseRaci(`raci

Top
  Cap: A
  Crew: R

[Phase]
  Phased
    Cap: A
    Crew: R`);
    const names = [...allTasks(r)].map((t) => t.displayName);
    expect(names).toEqual(['Top', 'Phased']);
  });

  it('comments and blank lines are tolerated', () => {
    const r = parseRaci(`raci
// this is a comment

[Voyage]
  // ahem
  Task
    Cap: A
    Crew: R`);
    expect(r.error).toBeNull();
    expect(r.phases[0].tasks).toHaveLength(1);
  });

  it('VARIANTS table is the single source of truth for alphabets', () => {
    expect(VARIANTS.raci.alphabet).toEqual(['R', 'A', 'C', 'I']);
    expect(VARIANTS.rasci.alphabet).toEqual(['R', 'A', 'S', 'C', 'I']);
    expect(VARIANTS.daci.alphabet).toEqual(['D', 'A', 'C', 'I']);
  });
});
