import { describe, it, expect } from 'vitest';
import { parseKanban } from '../src/kanban/parser';
import { computeCardMove, computeCardArchive, isArchiveColumn } from '../src/kanban/mutations';

describe('parseKanban', () => {
  // === Chart type ===
  describe('chart type', () => {
    it('accepts chart: kanban', () => {
      const result = parseKanban('chart: kanban\n[To Do]\n  Task 1');
      expect(result.error).toBeNull();
      expect(result.columns).toHaveLength(1);
    });

    it('rejects wrong chart type', () => {
      const result = parseKanban('chart: flowchart\n[To Do]\n  Task 1');
      expect(result.error).toMatch(/Expected chart type "kanban"/);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('suggests similar chart types', () => {
      const result = parseKanban('chart: kanbam\n[To Do]\n  Task 1');
      expect(result.error).toMatch(/Did you mean 'kanban'/);
    });
  });

  // === Title ===
  describe('title', () => {
    it('parses title', () => {
      const result = parseKanban(
        'chart: kanban\ntitle: Sprint 12\n[To Do]\n  Task 1'
      );
      expect(result.title).toBe('Sprint 12');
      expect(result.titleLineNumber).toBe(2);
    });

    it('no title returns undefined', () => {
      const result = parseKanban('chart: kanban\n[To Do]\n  Task 1');
      expect(result.title).toBeUndefined();
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseKanban(
        'chart: kanban\n// comment\n[To Do]\n  Task 1'
      );
      expect(result.error).toBeNull();
      expect(result.columns).toHaveLength(1);
    });
  });

  // === Columns ===
  describe('columns', () => {
    it('parses single column', () => {
      const result = parseKanban('chart: kanban\n[To Do]\n  Task 1');
      expect(result.columns).toHaveLength(1);
      expect(result.columns[0].name).toBe('To Do');
      expect(result.columns[0].id).toBe('col-1');
    });

    it('parses multiple columns', () => {
      const result = parseKanban(
        'chart: kanban\n[To Do]\n  Task 1\n[In Progress]\n  Task 2\n[Done]\n  Task 3'
      );
      expect(result.columns).toHaveLength(3);
      expect(result.columns[0].name).toBe('To Do');
      expect(result.columns[1].name).toBe('In Progress');
      expect(result.columns[2].name).toBe('Done');
    });

    it('parses WIP limit', () => {
      const result = parseKanban(
        'chart: kanban\n[In Progress] | wip: 3\n  Task 1'
      );
      expect(result.columns[0].wipLimit).toBe(3);
    });

    it('column without WIP limit has undefined wipLimit', () => {
      const result = parseKanban('chart: kanban\n[To Do]\n  Task 1');
      expect(result.columns[0].wipLimit).toBeUndefined();
    });

    it('empty column has no cards', () => {
      const result = parseKanban(
        'chart: kanban\n[To Do]\n[Done]\n  Task 1'
      );
      expect(result.columns[0].cards).toHaveLength(0);
      expect(result.columns[1].cards).toHaveLength(1);
    });

    it('errors when no columns defined', () => {
      const result = parseKanban('chart: kanban\ntitle: Test');
      expect(result.error).toMatch(/No columns found/);
    });
  });

  // === Cards ===
  describe('cards', () => {
    it('parses basic card', () => {
      const result = parseKanban('chart: kanban\n[To Do]\n  Build login');
      const card = result.columns[0].cards[0];
      expect(card.title).toBe('Build login');
      expect(card.id).toBe('card-1');
      expect(card.lineNumber).toBe(3);
      expect(card.endLineNumber).toBe(3);
    });

    it('parses card with tags', () => {
      const result = parseKanban(
        'chart: kanban\n[To Do]\n  Build login | priority: High, assignee: Alice'
      );
      const card = result.columns[0].cards[0];
      expect(card.title).toBe('Build login');
      expect(card.tags).toEqual({ priority: 'High', assignee: 'Alice' });
    });

    it('parses card with color suffix', () => {
      const result = parseKanban(
        'chart: kanban\n[To Do]\n  Urgent task(red)'
      );
      const card = result.columns[0].cards[0];
      expect(card.title).toBe('Urgent task');
      expect(card.color).toBeDefined();
    });

    it('parses column with color suffix', () => {
      const result = parseKanban(
        'chart: kanban\n[Done](green)\n  Task 1'
      );
      expect(result.columns[0].name).toBe('Done');
      expect(result.columns[0].color).toBeDefined();
    });

    it('parses column with color and wip limit', () => {
      const result = parseKanban(
        'chart: kanban\n[In Progress](blue) | wip: 3\n  Task 1'
      );
      expect(result.columns[0].name).toBe('In Progress');
      expect(result.columns[0].color).toBeDefined();
      expect(result.columns[0].wipLimit).toBe(3);
    });

    it('parses card with detail lines', () => {
      const result = parseKanban(
        'chart: kanban\n[To Do]\n  Build login\n    OAuth support\n    Needs design review'
      );
      const card = result.columns[0].cards[0];
      expect(card.details).toEqual([
        'OAuth support',
        'Needs design review',
      ]);
      expect(card.lineNumber).toBe(3);
      expect(card.endLineNumber).toBe(5);
    });

    it('parses multiple cards in a column', () => {
      const result = parseKanban(
        'chart: kanban\n[To Do]\n  Task A\n  Task B\n  Task C'
      );
      expect(result.columns[0].cards).toHaveLength(3);
      expect(result.columns[0].cards[0].title).toBe('Task A');
      expect(result.columns[0].cards[1].title).toBe('Task B');
      expect(result.columns[0].cards[2].title).toBe('Task C');
    });

    it('card with no tags has empty tags object', () => {
      const result = parseKanban('chart: kanban\n[To Do]\n  Simple task');
      expect(result.columns[0].cards[0].tags).toEqual({});
    });
  });

  // === Tag groups ===
  describe('tag groups', () => {
    it('parses tag group with entries', () => {
      const result = parseKanban(
        'chart: kanban\n## Priority\n  High(red)\n  Low(green)\n\n[To Do]\n  Task 1'
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Priority');
      expect(result.tagGroups[0].entries).toHaveLength(2);
      expect(result.tagGroups[0].entries[0].value).toBe('High');
      expect(result.tagGroups[0].entries[1].value).toBe('Low');
    });

    it('parses tag group with alias', () => {
      const result = parseKanban(
        'chart: kanban\n## Priority alias p\n  High(red)\n  Low(green)\n\n[To Do]\n  Task | p: High'
      );
      expect(result.tagGroups[0].alias).toBe('p');
      // Alias resolves to group name
      const card = result.columns[0].cards[0];
      expect(card.tags).toEqual({ priority: 'High' });
    });

    it('parses tag group with default value', () => {
      const result = parseKanban(
        'chart: kanban\n## Priority\n  High(red)\n  Low(green) default\n\n[To Do]\n  Task 1'
      );
      expect(result.tagGroups[0].defaultValue).toBe('Low');
    });

    it('warns on tag entry without color', () => {
      const result = parseKanban(
        'chart: kanban\n## Priority\n  High\n\n[To Do]\n  Task 1'
      );
      expect(result.diagnostics.some((d) => d.message.includes("Expected 'Value(color)'"))).toBe(true);
    });
  });

  // === tag: block syntax ===
  describe('tag: block syntax', () => {
    it('parses tag: heading with entries', () => {
      const result = parseKanban(
        'chart: kanban\ntag: Priority\n  High(red)\n  Low(green)\n\n[To Do]\n  Task 1'
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Priority');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('parses tag: with alias', () => {
      const result = parseKanban(
        'chart: kanban\ntag: Priority alias p\n  High(red)\n  Low(green)\n\n[To Do]\n  Task | p: High'
      );
      expect(result.tagGroups[0].alias).toBe('p');
      expect(result.columns[0].cards[0].tags).toEqual({ priority: 'High' });
    });

    it('parses tag: with default value', () => {
      const result = parseKanban(
        'chart: kanban\ntag: Priority\n  High(red)\n  Low(green) default\n\n[To Do]\n  Task 1'
      );
      expect(result.tagGroups[0].defaultValue).toBe('Low');
    });

    it('is case-insensitive', () => {
      const result = parseKanban(
        'chart: kanban\nTag: Priority\n  High(red)\n\n[To Do]\n  Task 1'
      );
      expect(result.tagGroups[0].name).toBe('Priority');
    });

    it('does not emit deprecation warning for tag: syntax', () => {
      const result = parseKanban(
        'chart: kanban\ntag: Priority\n  High(red)\n\n[To Do]\n  Task 1'
      );
      const warnings = result.diagnostics.filter(d => d.message.includes('deprecated'));
      expect(warnings).toHaveLength(0);
    });

    it('emits deprecation warning for ## syntax', () => {
      const result = parseKanban(
        'chart: kanban\n## Priority\n  High(red)\n\n[To Do]\n  Task 1'
      );
      const warnings = result.diagnostics.filter(d => d.message.includes('deprecated'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("tag: Priority");
    });
  });

  // === Legacy syntax warnings ===
  describe('legacy syntax', () => {
    it('warns on == Column == syntax', () => {
      const result = parseKanban(
        'chart: kanban\n[Valid]\n  Task 1\n== Legacy =='
      );
      const warnings = result.diagnostics.filter(d => d.message.includes('no longer supported'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('[Legacy]');
    });
  });

  // === Warnings ===
  describe('warnings', () => {
    it('warns when WIP limit exceeded', () => {
      const result = parseKanban(
        'chart: kanban\n[WIP] | wip: 1\n  Task A\n  Task B'
      );
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('WIP limit')
        )
      ).toBe(true);
      expect(result.diagnostics[0].severity).toBe('warning');
    });

    it('warns on unknown tag value', () => {
      const result = parseKanban(
        'chart: kanban\n## Priority\n  High(red)\n  Low(green)\n\n[To Do]\n  Task | priority: Medium'
      );
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Unknown tag value "Medium"')
        )
      ).toBe(true);
    });
  });

  // === Options ===
  describe('options', () => {
    it('parses generic options', () => {
      const result = parseKanban(
        'chart: kanban\ntitle: Test\ncolor-off: yes\n[To Do]\n  Task 1'
      );
      expect(result.options['color-off']).toBe('yes');
    });
  });

  // === Full example ===
  describe('full example', () => {
    it('parses the sprint board example', () => {
      const input = `chart: kanban
title: Sprint 12

## Priority
  High(red)
  Medium(yellow)
  Low(green) default

## Assignee alias a
  Alice(blue)
  Bob(purple)

[To Do]
  Build login page | priority: High, a: Alice
    OAuth + email/password support
    Needs design review first

[In Progress] | wip: 2
  Refactor nav | priority: High, a: Bob
    Split into composable components

[Done]
  Setup CI | priority: Low, a: Alice`;

      const result = parseKanban(input);
      expect(result.error).toBeNull();
      expect(result.title).toBe('Sprint 12');
      expect(result.tagGroups).toHaveLength(2);
      expect(result.columns).toHaveLength(3);

      // To Do column
      expect(result.columns[0].name).toBe('To Do');
      expect(result.columns[0].cards).toHaveLength(1);
      expect(result.columns[0].cards[0].title).toBe('Build login page');
      expect(result.columns[0].cards[0].tags).toEqual({
        priority: 'High',
        assignee: 'Alice',
      });
      expect(result.columns[0].cards[0].details).toHaveLength(2);

      // In Progress column
      expect(result.columns[1].name).toBe('In Progress');
      expect(result.columns[1].wipLimit).toBe(2);
      expect(result.columns[1].cards).toHaveLength(1);

      // Done column
      expect(result.columns[2].name).toBe('Done');
      expect(result.columns[2].cards).toHaveLength(1);
    });
  });
});

// ============================================================
// computeCardMove
// ============================================================

describe('computeCardMove', () => {
  const basicBoard = `chart: kanban

[To Do]
  Task A
  Task B
    detail line
  Task C

[Done]
  Task D`;

  it('moves card between columns', () => {
    const parsed = parseKanban(basicBoard);
    // Move Task A from To Do to Done at position 0
    const result = computeCardMove(
      basicBoard,
      parsed,
      'card-1', // Task A
      'col-2', // Done
      0
    );
    expect(result).not.toBeNull();
    // Task A should now appear right after [Done]
    const lines = result!.split('\n');
    const doneIdx = lines.findIndex((l) => l.includes('[Done]'));
    expect(lines[doneIdx + 1].trim()).toBe('Task A');
    // Task A should not appear under To Do anymore
    const todoIdx = lines.findIndex((l) => l.includes('[To Do]'));
    expect(lines[todoIdx + 1].trim()).not.toBe('Task A');
  });

  it('moves card with details', () => {
    const parsed = parseKanban(basicBoard);
    // Move Task B (which has a detail line) to Done
    const result = computeCardMove(
      basicBoard,
      parsed,
      'card-2', // Task B
      'col-2', // Done
      0
    );
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const doneIdx = lines.findIndex((l) => l.includes('[Done]'));
    expect(lines[doneIdx + 1].trim()).toBe('Task B');
    expect(lines[doneIdx + 2]).toContain('detail line');
  });

  it('moves card within same column (reorder)', () => {
    const parsed = parseKanban(basicBoard);
    // Move Task C to position 0 in To Do (before Task A)
    const result = computeCardMove(
      basicBoard,
      parsed,
      'card-3', // Task C
      'col-1', // To Do (same column)
      0
    );
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const todoIdx = lines.findIndex((l) => l.includes('[To Do]'));
    expect(lines[todoIdx + 1].trim()).toBe('Task C');
  });

  it('moves card to empty column', () => {
    const emptyColBoard = `chart: kanban

[To Do]
  Task A

[Empty]

[Done]`;

    const parsed = parseKanban(emptyColBoard);
    const result = computeCardMove(
      emptyColBoard,
      parsed,
      'card-1', // Task A
      'col-2', // Empty
      0
    );
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const emptyIdx = lines.findIndex((l) => l.includes('[Empty]'));
    expect(lines[emptyIdx + 1].trim()).toBe('Task A');
  });

  it('returns null for unknown card ID', () => {
    const parsed = parseKanban(basicBoard);
    const result = computeCardMove(
      basicBoard,
      parsed,
      'card-999',
      'col-2',
      0
    );
    expect(result).toBeNull();
  });

  it('returns null for unknown column ID', () => {
    const parsed = parseKanban(basicBoard);
    const result = computeCardMove(
      basicBoard,
      parsed,
      'card-1',
      'col-999',
      0
    );
    expect(result).toBeNull();
  });
});

// ============================================================
// computeCardArchive
// ============================================================

describe('computeCardArchive', () => {
  const board = `chart: kanban

[To Do]
  Task A
  Task B
    detail line

[Done]
  Task C`;

  it('creates Archive section and moves card there', () => {
    const parsed = parseKanban(board);
    const result = computeCardArchive(board, parsed, 'card-1');
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const archiveIdx = lines.findIndex((l) => l.includes('[Archive]'));
    expect(archiveIdx).toBeGreaterThan(0);
    expect(lines[archiveIdx + 1].trim()).toBe('Task A');
    // Task A should not be under To Do
    const todoIdx = lines.findIndex((l) => l.includes('[To Do]'));
    expect(lines[todoIdx + 1].trim()).not.toBe('Task A');
  });

  it('archives card with details', () => {
    const parsed = parseKanban(board);
    const result = computeCardArchive(board, parsed, 'card-2');
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const archiveIdx = lines.findIndex((l) => l.includes('[Archive]'));
    expect(lines[archiveIdx + 1].trim()).toBe('Task B');
    expect(lines[archiveIdx + 2]).toContain('detail line');
  });

  it('appends to existing Archive section', () => {
    const boardWithArchive = `chart: kanban

[To Do]
  Task A

[Archive]
  Old task`;

    const parsed = parseKanban(boardWithArchive);
    const result = computeCardArchive(boardWithArchive, parsed, 'card-1');
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const archiveIdx = lines.findIndex((l) => l.includes('[Archive]'));
    expect(lines[archiveIdx + 1].trim()).toBe('Old task');
    expect(lines[archiveIdx + 2].trim()).toBe('Task A');
  });

  it('returns null for unknown card ID', () => {
    const parsed = parseKanban(board);
    expect(computeCardArchive(board, parsed, 'card-999')).toBeNull();
  });

  it('archives card with tag metadata', () => {
    const tagBoard = `chart: kanban

## Priority
  High(red)
  Low(green) default

[In Progress]
  Build login | priority: High
    Needs review

[Done]
  Write docs | priority: Low

[Archive]`;

    const parsed = parseKanban(tagBoard);
    const result = computeCardArchive(tagBoard, parsed, 'card-1');
    expect(result).not.toBeNull();
    const lines = result!.split('\n');

    // Card should be under Archive
    const archiveIdx = lines.findIndex((l) => l.includes('[Archive]'));
    expect(lines[archiveIdx + 1].trim()).toBe('Build login | priority: High');
    expect(lines[archiveIdx + 2]).toContain('Needs review');

    // Card should no longer be under In Progress
    const ipIdx = lines.findIndex((l) => l.includes('[In Progress]'));
    expect(lines[ipIdx + 1].trim()).not.toBe('Build login | priority: High');
  });

  it('archives card and re-parses correctly', () => {
    const parsed = parseKanban(board);
    const result = computeCardArchive(board, parsed, 'card-1');
    expect(result).not.toBeNull();

    // Re-parse the result to verify it's valid kanban
    const reParsed = parseKanban(result!);
    expect(reParsed.error).toBeNull();

    // Archive column should have the moved card
    const archiveCol = reParsed.columns.find((c) => isArchiveColumn(c.name));
    expect(archiveCol).toBeDefined();
    expect(archiveCol!.cards).toHaveLength(1);
    expect(archiveCol!.cards[0].title).toBe('Task A');

    // To Do should have one fewer card
    const todoCol = reParsed.columns.find((c) => c.name === 'To Do');
    expect(todoCol!.cards).toHaveLength(1);
    expect(todoCol!.cards[0].title).toBe('Task B');
  });
});

// ============================================================
// isArchiveColumn
// ============================================================

describe('isArchiveColumn', () => {
  it('matches archive (case-insensitive)', () => {
    expect(isArchiveColumn('Archive')).toBe(true);
    expect(isArchiveColumn('archive')).toBe(true);
    expect(isArchiveColumn('ARCHIVE')).toBe(true);
  });

  it('does not match other names', () => {
    expect(isArchiveColumn('Done')).toBe(false);
    expect(isArchiveColumn('Archived')).toBe(false);
  });
});
