import { describe, it, expect } from 'vitest';
import { parseRaci } from '../src/raci/parser';
import {
  cellReplace,
  cellAppendMarker,
  cellRemove,
  cellCycle,
} from '../src/raci/mutations';
import { VARIANTS } from '../src/raci/variants';
import type { RaciMarker } from '../src/raci/types';

const RACI_ALPHABET = VARIANTS.raci.alphabet;

// Helper: parse + mutate + reparse + return next-content.
function mutate(
  source: string,
  fn: (parsed: ReturnType<typeof parseRaci>) => string | null
): { content: string; changed: boolean } {
  const parsed = parseRaci(source);
  const next = fn(parsed);
  return { content: next ?? source, changed: next !== null };
}

// ============================================================
// cellReplace
// ============================================================

describe('cellReplace', () => {
  const src = `raci

Task
  Cap: A
  Crew: R`;

  it('replaces an existing single marker on the cell', () => {
    const { content, changed } = mutate(src, (p) =>
      cellReplace(src, p, 'task', 'cap', 'R')
    );
    expect(changed).toBe(true);
    expect(content).toContain('Cap: R');
    expect(content).not.toContain('Cap: A');
  });

  it('replaces a multi-marker cell with a single marker', () => {
    const s = `raci\n\nTask\n  Cap: A R\n`;
    const { content } = mutate(s, (p) => cellReplace(s, p, 'task', 'cap', 'C'));
    expect(content).toContain('Cap: C');
    expect(content).not.toContain('Cap: A R');
  });

  it('inserts a new role-assignment line for a role not yet present', () => {
    const s = `raci
roles Cap, QM, Crew

Task
  Cap: A
  Crew: R`;
    const { content, changed } = mutate(s, (p) =>
      cellReplace(s, p, 'task', 'qm', 'C')
    );
    expect(changed).toBe(true);
    // Inserted after existing role assignments.
    const lines = content.split('\n');
    const taskIdx = lines.findIndex((l) => l.trim() === 'Task');
    expect(lines[taskIdx + 1]).toMatch(/^ {2}Cap: A$/);
    expect(lines[taskIdx + 2]).toMatch(/^ {2}Crew: R$/);
    expect(lines[taskIdx + 3]).toMatch(/^ {2}QM: C$/);
  });

  it('declared role display name is used when inserting', () => {
    const s = `raci
roles Cap, Quartermaster, Boatswain

Task
  Cap: A`;
    const { content } = mutate(s, (p) =>
      cellReplace(s, p, 'task', 'quartermaster', 'R')
    );
    expect(content).toContain('Quartermaster: R');
  });

  it('clears a cell when marker is null', () => {
    const { content, changed } = mutate(src, (p) =>
      cellReplace(src, p, 'task', 'cap', null)
    );
    expect(changed).toBe(true);
    expect(content).not.toContain('Cap: A');
    expect(content).toContain('Crew: R'); // sibling untouched
  });

  it('returns null no-op when cell already holds exactly that marker', () => {
    const parsed = parseRaci(src);
    expect(cellReplace(src, parsed, 'task', 'cap', 'A')).toBeNull();
  });

  it('returns null no-op when clearing an empty cell', () => {
    const parsed = parseRaci(src);
    expect(cellReplace(src, parsed, 'task', 'qm', null)).toBeNull();
  });

  it('returns null when task does not exist', () => {
    const parsed = parseRaci(src);
    expect(cellReplace(src, parsed, 'no-such-task', 'cap', 'A')).toBeNull();
  });

  it('round-trip: parse(mutate(parse(src))) sees the new marker', () => {
    const { content } = mutate(src, (p) =>
      cellReplace(src, p, 'task', 'cap', 'R')
    );
    const reparsed = parseRaci(content);
    const cap = reparsed.tasksWithoutPhase[0].roleAssignments.find(
      (a) => a.id === 'cap'
    );
    expect(cap?.markers).toEqual(['R']);
  });

  it('preserves indent of existing role-assignment lines', () => {
    const s = `raci
roles Cap, QM

[Phase]
    Task
        Cap: A`;
    const { content } = mutate(s, (p) => cellReplace(s, p, 'task', 'qm', 'C'));
    // Inserted line should match the 8-space indent of the existing assignment.
    expect(content).toContain('        QM: C');
  });

  it('default-indents to task indent + 2 when task has no role assignments', () => {
    const s = `raci
roles Cap

[Phase]
  Task`;
    const { content } = mutate(s, (p) => cellReplace(s, p, 'task', 'cap', 'A'));
    expect(content).toContain('    Cap: A');
  });
});

// ============================================================
// cellAppendMarker
// ============================================================

describe('cellAppendMarker', () => {
  const src = `raci\n\nTask\n  Cap: A\n  Crew: R\n`;

  it('appends a marker to an existing cell', () => {
    const { content } = mutate(src, (p) =>
      cellAppendMarker(src, p, 'task', 'cap', 'R')
    );
    expect(content).toContain('Cap: A R');
    expect(content).not.toContain('Cap: A\n');
  });

  it('falls through to insertion when no role-assignment line exists', () => {
    const s = `raci
roles Cap, QM, Crew

Task
  Cap: A
  Crew: R`;
    const { content } = mutate(s, (p) =>
      cellAppendMarker(s, p, 'task', 'qm', 'I')
    );
    expect(content).toContain('QM: I');
  });

  it('idempotent — returns null if marker is already present', () => {
    const parsed = parseRaci(src);
    expect(cellAppendMarker(src, parsed, 'task', 'cap', 'A')).toBeNull();
  });

  it('appends into a multi-marker cell', () => {
    const s = `raci\n\nTask\n  Cap: A R\n`;
    const { content } = mutate(s, (p) =>
      cellAppendMarker(s, p, 'task', 'cap', 'I')
    );
    expect(content).toContain('Cap: A R I');
  });
});

// ============================================================
// cellRemove
// ============================================================

describe('cellRemove', () => {
  it('removes a specific marker from a multi-marker cell', () => {
    const s = `raci\n\nTask\n  Cap: A R\n`;
    const { content } = mutate(s, (p) => cellRemove(s, p, 'task', 'cap', 'R'));
    expect(content).toContain('Cap: A');
    expect(content).not.toContain('Cap: A R');
  });

  it('drops the role-assignment line entirely when it becomes empty', () => {
    const s = `raci\n\nTask\n  Cap: A\n  Crew: R\n`;
    const { content } = mutate(s, (p) => cellRemove(s, p, 'task', 'cap', 'A'));
    expect(content).not.toContain('Cap:');
    expect(content).toContain('Crew: R');
  });

  it('with no marker arg, clears the entire cell', () => {
    const s = `raci\n\nTask\n  Cap: A R C\n`;
    const { content } = mutate(s, (p) => cellRemove(s, p, 'task', 'cap'));
    expect(content).not.toContain('Cap:');
  });

  it('returns null when the role assignment does not exist', () => {
    const s = `raci\n\nTask\n  Cap: A\n`;
    const parsed = parseRaci(s);
    expect(cellRemove(s, parsed, 'task', 'qm', 'I')).toBeNull();
  });

  it('returns null when the requested marker is not present', () => {
    const s = `raci\n\nTask\n  Cap: A\n`;
    const parsed = parseRaci(s);
    expect(cellRemove(s, parsed, 'task', 'cap', 'C')).toBeNull();
  });
});

// ============================================================
// cellCycle
// ============================================================

describe('cellCycle (click-to-cycle helper)', () => {
  const src = `raci
roles Cap

Task`;

  it('blank → first marker', () => {
    const { content } = mutate(src, (p) =>
      cellCycle(src, p, 'task', 'cap', RACI_ALPHABET)
    );
    expect(content).toContain('Cap: R');
  });

  it('cycles through the alphabet', () => {
    let s = src;
    const seen: string[] = [];
    for (let i = 0; i < RACI_ALPHABET.length + 1; i++) {
      const next = mutate(s, (p) =>
        cellCycle(s, p, 'task', 'cap', RACI_ALPHABET)
      ).content;
      const cap = parseRaci(next).tasksWithoutPhase[0].roleAssignments.find(
        (a) => a.id === 'cap'
      );
      const m = cap?.markers[0] ?? '∅';
      seen.push(m);
      s = next;
    }
    // After alphabet.length cycles we should have R, A, C, I (four
    // markers) then on the 5th cycle wrap back to ∅.
    expect(seen.slice(0, RACI_ALPHABET.length)).toEqual(['R', 'A', 'C', 'I']);
    expect(seen[RACI_ALPHABET.length]).toBe('∅');
  });

  it('cycles forward from a populated cell', () => {
    const s = `raci\n\nTask\n  Cap: R\n`;
    const { content } = mutate(s, (p) =>
      cellCycle(s, p, 'task', 'cap', RACI_ALPHABET)
    );
    expect(content).toContain('Cap: A');
  });

  it('wraps last marker → blank', () => {
    const s = `raci\n\nTask\n  Cap: I\n`;
    const { content } = mutate(s, (p) =>
      cellCycle(s, p, 'task', 'cap', RACI_ALPHABET)
    );
    expect(content).not.toContain('Cap:');
  });

  it('multi-marker cell: cycles from the dominant (first) marker', () => {
    const s = `raci\n\nTask\n  Cap: A R\n`;
    const { content } = mutate(s, (p) =>
      cellCycle(s, p, 'task', 'cap', RACI_ALPHABET)
    );
    // Dominant 'A' → 'C'; collapses to single marker.
    expect(content).toContain('Cap: C');
    expect(content).not.toContain('Cap: A R');
  });
});

// ============================================================
// Cross-mutation round-trip
// ============================================================

describe('round-trip: parse → mutate → parse', () => {
  const variants: Array<{
    name: string;
    src: string;
    alphabet: ReadonlyArray<RaciMarker>;
  }> = [
    {
      name: 'raci',
      src: `raci\n\nTask\n  Cap: A`,
      alphabet: VARIANTS.raci.alphabet,
    },
    {
      name: 'rasci',
      src: `rasci\n\nTask\n  Cap: A`,
      alphabet: VARIANTS.rasci.alphabet,
    },
    {
      name: 'daci',
      src: `daci\n\nDecide\n  PM: D\n  Cap: A`,
      alphabet: VARIANTS.daci.alphabet,
    },
  ];

  for (const v of variants) {
    it(`${v.name}: cycle preserves parser invariants`, () => {
      let content = v.src;
      for (let i = 0; i < v.alphabet.length + 1; i++) {
        const parsed = parseRaci(content);
        const taskId = parsed.tasksWithoutPhase[0]?.id;
        if (!taskId) break;
        const next = cellCycle(content, parsed, taskId, 'cap', v.alphabet);
        if (next !== null) content = next;
        // Each pass parses without becoming a fatal error.
        expect(parseRaci(content).error).toBeNull();
      }
    });
  }
});
