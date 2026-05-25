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

  it('infers RASCI from an S marker (no directive needed)', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: A\n  Crew: R\n  Bosun: S`);
    expect(r.error).toBeNull();
    expect(r.variant).toBe('rasci');
    const task = r.tasksWithoutPhase[0];
    const bosun = task.roleAssignments.find((a) => a.displayName === 'Bosun');
    expect(bosun?.markers).toEqual(['S']);
  });

  it('infers DACI from a D marker (no directive needed)', () => {
    const r = parseRaci(`raci\n\nDecide route\n  PM: D\n  Cap: A`);
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
    const r = parseRaci(`raci\n\nDecision\n  PM: D\n  Cap: D`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.DACI_MULTI_DRIVER);
  });

  it('DACI (locked): two A markers fires E_DACI_MULTI_ACCOUNTABLE', () => {
    // No D marker, so inference would land on RACI; lock to DACI
    // explicitly so the DACI-specific rule fires.
    const r = parseRaci(`raci\nvariant-daci\n\nDecision\n  PM: A\n  Cap: A`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.DACI_MULTI_ACCOUNTABLE);
  });

  it('DACI (locked): missing-D and missing-A both fire as warnings', () => {
    const r = parseRaci(`raci\nvariant-daci\n\nDecision\n  PM: C`);
    expect(codes(r)).toContain(RACI_WARNING_CODES.DACI_MISSING_DRIVER);
    expect(codes(r)).toContain(RACI_WARNING_CODES.DACI_MISSING_ACCOUNTABLE);
  });

  it('emits E_RACI_INVALID_MARKER for marker not in any alphabet', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: X`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('S is invalid when variant-raci is locked', () => {
    const r = parseRaci(`raci\nvariant-raci\n\nTask\n  Cap: S`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('S is valid when inference resolves variant to RASCI', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: A\n  Crew: R\n  Bosun: S`);
    expect(codes(r)).not.toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('mixed D and S without a variant lock fires E_RACI_MIXED_VARIANTS', () => {
    const r = parseRaci(`raci\n\nTask\n  Cap: D\n  Crew: S`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.MIXED_VARIANTS);
  });

  it('two variant-* directives in one chart fire E_RACI_DUPLICATE_VARIANT', () => {
    const r = parseRaci(`raci\nvariant-raci\nvariant-daci\n\nTask\n  Cap: A`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.DUPLICATE_VARIANT);
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
// Diagnostic validation
// ============================================================

describe('parseRaci — diagnostic suppression', () => {
  it('without the directive, multi-A still errors', () => {
    const r = parseRaci(`raci

Task
  Cap: A
  QM: A`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.MULTI_ACCOUNTABLE);
  });

  it('treats `#` as a literal character — DGMO comments are `//` only', () => {
    // Per the language spec, `#` is NOT a comment character — it's just
    // a literal in the task name.
    const r = parseRaci(`raci\n\nTask # not-a-comment\n  Cap: A`);
    const t = r.tasksWithoutPhase[0];
    expect(t.displayName).toBe('Task # not-a-comment');
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

describe('parseRaci — variant resolution', () => {
  it('variant-rasci lock forces RASCI even with no S markers', () => {
    const r = parseRaci(`raci
variant-rasci

Task
  Cap: A
  Crew: R`);
    expect(r.variant).toBe('rasci');
    expect(codes(r)).not.toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('inference defaults to RACI when no D or S marker is present', () => {
    expect(parseRaci(`raci\n\nTask\n  Cap: A`).variant).toBe('raci');
  });

  it('inference picks RASCI when an S marker appears', () => {
    expect(parseRaci(`raci\n\nTask\n  Cap: A\n  Crew: S`).variant).toBe(
      'rasci'
    );
  });

  it('inference picks DACI when a D marker appears', () => {
    expect(parseRaci(`raci\n\nTask\n  Cap: D\n  QM: A`).variant).toBe('daci');
  });

  it('rasci as chart-type id locks the RASCI variant', () => {
    const r = parseRaci(`rasci\n\nTask\n  Cap: A\n  Crew: R`);
    expect(r.error).toBeNull();
    expect(r.variant).toBe('rasci');
    expect(codes(r)).not.toContain(RACI_ERROR_CODES.INVALID_MARKER);
  });

  it('daci as chart-type id locks the DACI variant', () => {
    const r = parseRaci(`daci\n\nDecide\n  PM: D\n  Cap: A`);
    expect(r.error).toBeNull();
    expect(r.variant).toBe('daci');
  });

  it('matching variant directive after rasci chart type is silent', () => {
    const r = parseRaci(`rasci\nvariant-rasci\n\nTask\n  Cap: A`);
    expect(r.variant).toBe('rasci');
    expect(codes(r)).not.toContain(RACI_ERROR_CODES.DUPLICATE_VARIANT);
  });

  it('conflicting variant directive after rasci chart type errors', () => {
    const r = parseRaci(`rasci\nvariant-daci\n\nTask\n  Cap: A`);
    expect(codes(r)).toContain(RACI_ERROR_CODES.DUPLICATE_VARIANT);
  });

  it('rejects unrelated chart-type ids on the first line', () => {
    expect(parseRaci(`flowchart\n\nTask\n  Cap: A`).error).not.toBeNull();
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

describe('parseRaci — colon-less and concatenated marker syntax', () => {
  it('accepts role assignments without a colon', () => {
    const r = parseRaci(`raci
Task
  Cap A
  Crew R C`);
    expect(r.error).toBeNull();
    const t = r.tasksWithoutPhase[0];
    expect(t.roleAssignments).toHaveLength(2);
    expect(t.roleAssignments[0].displayName).toBe('Cap');
    expect(t.roleAssignments[0].markers).toEqual(['A']);
    expect(t.roleAssignments[1].displayName).toBe('Crew');
    expect(t.roleAssignments[1].markers).toEqual(['R', 'C']);
  });

  it('accepts concatenated markers (no spaces between letters)', () => {
    const r = parseRaci(`raci
Task
  Cap: AR
  Crew RCI`);
    expect(r.error).toBeNull();
    const t = r.tasksWithoutPhase[0];
    expect(t.roleAssignments[0].markers).toEqual(['A', 'R']);
    expect(t.roleAssignments[1].markers).toEqual(['R', 'C', 'I']);
  });

  it('still treats free prose as a description when no marker token is present', () => {
    const r = parseRaci(`raci
Provision the hold
  Salt pork biscuit fresh water for six weeks
  Cap A`);
    expect(r.error).toBeNull();
    const t = r.tasksWithoutPhase[0];
    expect(t.description).toBe('Salt pork biscuit fresh water for six weeks');
    expect(t.roleAssignments).toHaveLength(1);
    expect(t.roleAssignments[0].displayName).toBe('Cap');
  });

  it('supports a multi-word role name when followed by markers', () => {
    const r = parseRaci(`raci
Task
  Senior Engineer A R
  Junior Dev: C`);
    expect(r.error).toBeNull();
    const t = r.tasksWithoutPhase[0];
    expect(t.roleAssignments[0].displayName).toBe('Senior Engineer');
    expect(t.roleAssignments[0].markers).toEqual(['A', 'R']);
    expect(t.roleAssignments[1].displayName).toBe('Junior Dev');
  });
});
