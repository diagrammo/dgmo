import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseKanban } from '../src/kanban/parser';
import { renderKanban } from '../src/kanban/renderer';
import { getPalette } from '../src/palettes';

// Set up jsdom globals
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const palette = getPalette('nord');

// ============================================================
// legend entry hover attributes
// ============================================================

describe('legend entry hover attributes', () => {
  const input = `kanban

tag Priority
  High red
  Medium yellow
  Low green

[To Do]
  Fix login bug priority: High
  Update docs priority: Low

[Done]
  Refactor API priority: Medium`;

  it('wraps legend entries in g[data-legend-entry]', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      activeTagGroup: 'priority',
    });

    const entries = container.querySelectorAll('[data-legend-entry]');
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const values = Array.from(entries).map((e) =>
      e.getAttribute('data-legend-entry')
    );
    expect(values).toContain('high');
    expect(values).toContain('medium');
    expect(values).toContain('low');
  });

  it('legend entry contains circle and text children', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      activeTagGroup: 'priority',
    });

    const entry = container.querySelector('[data-legend-entry="high"]');
    expect(entry).toBeTruthy();
    expect(entry!.querySelector('circle')).toBeTruthy();
    expect(entry!.querySelector('text')).toBeTruthy();
  });

  it('legend entry has cursor pointer', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      activeTagGroup: 'priority',
    });

    const entry = container.querySelector('[data-legend-entry="high"]');
    expect(entry).toBeTruthy();
    expect((entry as HTMLElement).style.cursor).toBe('pointer');
  });

  it('adds data-tag-* on cards when activeTagGroup is set', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      activeTagGroup: 'priority',
    });

    const highCard = container.querySelector(
      '.kanban-card[data-tag-priority="high"]'
    );
    const lowCard = container.querySelector(
      '.kanban-card[data-tag-priority="low"]'
    );
    const medCard = container.querySelector(
      '.kanban-card[data-tag-priority="medium"]'
    );
    expect(highCard).toBeTruthy();
    expect(lowCard).toBeTruthy();
    expect(medCard).toBeTruthy();
  });

  it('does not add data-tag-* when no activeTagGroup', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false);

    const tagged = container.querySelector('[data-tag-priority]');
    expect(tagged).toBeNull();
  });
});

// ============================================================
// Tag swimlane rendering
// ============================================================

describe('kanban tag swimlane rendering', () => {
  const swimInput = `kanban

tag Team
  Frontend blue
  Backend green
  QA orange

tag Priority
  High red
  Low yellow

[Backlog]
  Redesign team: Frontend, priority: High
  Caching team: Backend, priority: Low
  Untagged card team: Mystery, priority: Low

[In Progress]
  Auth team: Backend, priority: High
  Polish team: Frontend, priority: Low

[Done]
  Notes team: QA, priority: Low`;

  const noGroupsInput = `kanban

[Backlog]
  Card A
  Card B`;

  it('renders swimlane icons on each tag-group pill when tag groups exist', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      onSwimlaneChange: () => {},
    });
    const icons = container.querySelectorAll('.kanban-swimlane-icon');
    expect(icons.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT render swimlane icons when tagGroups is empty', () => {
    const parsed = parseKanban(noGroupsInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      onSwimlaneChange: () => {},
    });
    const icons = container.querySelectorAll('.kanban-swimlane-icon');
    expect(icons.length).toBe(0);
  });

  it('renders lane headers with correct labels and counts when currentSwimlaneGroup is set', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Team',
    });
    const laneHeaders = container.querySelectorAll('.kanban-lane-header');
    const labels = Array.from(laneHeaders).map((g) => {
      const txt = g.querySelector('text');
      return txt?.textContent ?? '';
    });
    expect(labels).toContain('Frontend');
    expect(labels).toContain('Backend');
    expect(labels).toContain('QA');
  });

  it('appends a "No {GroupName}" lane for cards missing the tag', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Team',
    });
    const noLane = container.querySelector('[data-lane-name="No Team"]');
    expect(noLane).toBeTruthy();
  });

  it('places cards in the correct (column, lane) cell based on tag value', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Team',
    });
    // Backend lane should contain "Caching", "Auth"
    const lanes = container.querySelectorAll('.kanban-lane');
    const backendLane = Array.from(lanes).find(
      (l) => l.getAttribute('data-lane-name') === 'Backend'
    );
    expect(backendLane).toBeTruthy();
    const cards = backendLane!.querySelectorAll('.kanban-card');
    expect(cards.length).toBe(2);
  });

  it('keeps card coloring driven by activeTagGroup independent of currentSwimlaneGroup', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Team',
      activeTagGroup: 'Priority',
    });
    // Cards should have data-tag-priority attribute, not data-tag-team
    const highCard = container.querySelector('[data-tag-priority="high"]');
    const teamCard = container.querySelector('[data-tag-team]');
    expect(highCard).toBeTruthy();
    expect(teamCard).toBeNull();
  });

  it('falls back to normal column layout when currentSwimlaneGroup is null', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false);
    expect(container.querySelectorAll('.kanban-lane').length).toBe(0);
    expect(container.querySelectorAll('.kanban-column').length).toBeGreaterThan(
      0
    );
  });

  it('ignores currentSwimlaneGroup if it does not match any existing tag group', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Nonexistent',
    });
    expect(container.querySelectorAll('.kanban-lane').length).toBe(0);
    // Should not throw, falls back to normal layout
    expect(container.querySelectorAll('.kanban-column').length).toBeGreaterThan(
      0
    );
  });

  it("routes cards with the swimlane group's defaultValue to the matching lane (not the No lane)", () => {
    const inputWithDefault = `kanban

tag Team
  Frontend blue default
  Backend green

[Backlog]
  Untagged card`;
    const parsed = parseKanban(inputWithDefault, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Team',
    });
    const noLane = container.querySelector('[data-lane-name="No Team"]');
    expect(noLane).toBeNull();
    const frontendLane = container.querySelector('[data-lane-name="Frontend"]');
    expect(frontendLane).toBeTruthy();
    expect(frontendLane!.querySelectorAll('.kanban-card').length).toBe(1);
  });

  it('omits the ≡ icon when exportDims is set', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      onSwimlaneChange: () => {},
      exportDims: { width: 800, height: 600 },
    });
    const icons = container.querySelectorAll('.kanban-swimlane-icon');
    expect(icons.length).toBe(0);
  });

  it('omits the ≡ icon when onSwimlaneChange is undefined', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false);
    const icons = container.querySelectorAll('.kanban-swimlane-icon');
    expect(icons.length).toBe(0);
  });
});

// ============================================================
// Export view state: collapsed columns
// ============================================================

describe('kanban collapsed columns', () => {
  const input = `kanban

tag Priority
  High red
  Low green

[Backlog]
  Fix login priority: High

[In Progress]
  Auth priority: High

[Done]
  Notes priority: Low`;

  it('renders collapsed column as narrow strip without cards', () => {
    const parsed = parseKanban(input, palette.light);
    // Find the Done column ID
    const doneColId = parsed.columns.find((c) => c.name === 'Done')!.id;
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      collapsedColumns: new Set([doneColId]),
    });

    // Collapsed column should still exist
    const cols = container.querySelectorAll('.kanban-column');
    expect(cols.length).toBe(3);

    // The Done column should have no cards rendered
    const doneCol = Array.from(cols).find(
      (c) => c.getAttribute('data-column-id') === doneColId
    );
    expect(doneCol).toBeTruthy();
    expect(doneCol!.querySelectorAll('.kanban-card').length).toBe(0);
  });

  it('renders non-collapsed columns normally with cards', () => {
    const parsed = parseKanban(input, palette.light);
    const doneColId = parsed.columns.find((c) => c.name === 'Done')!.id;
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      collapsedColumns: new Set([doneColId]),
    });

    const backlogCol = Array.from(
      container.querySelectorAll('.kanban-column')
    ).find(
      (c) =>
        c.getAttribute('data-column-id') ===
        parsed.columns.find((col) => col.name === 'Backlog')!.id
    );
    expect(backlogCol).toBeTruthy();
    expect(backlogCol!.querySelectorAll('.kanban-card').length).toBe(1);
  });

  it('no regression: renders all cards when no collapsedColumns', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false);

    const allCards = container.querySelectorAll('.kanban-card');
    expect(allCards.length).toBe(3);
  });
});

// ============================================================
// Export view state: collapsed lanes in swimlane mode
// ============================================================

describe('kanban collapsed lanes', () => {
  const swimInput = `kanban

tag Team
  Frontend blue
  Backend green
  QA orange

[Backlog]
  Redesign team: Frontend
  Caching team: Backend

[In Progress]
  Auth team: Backend
  Polish team: Frontend

[Done]
  Notes team: QA`;

  it('renders collapsed lane without full card rendering', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Team',
      collapsedLanes: new Set(['Backend']),
    });

    // Backend lane should exist
    const backendLane = container.querySelector('[data-lane-name="Backend"]');
    expect(backendLane).toBeTruthy();

    // But its cards should NOT be rendered as full card elements
    expect(backendLane!.querySelectorAll('.kanban-card').length).toBe(0);
  });

  it('renders non-collapsed lanes with full cards', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Team',
      collapsedLanes: new Set(['Backend']),
    });

    const frontendLane = container.querySelector('[data-lane-name="Frontend"]');
    expect(frontendLane).toBeTruthy();
    expect(frontendLane!.querySelectorAll('.kanban-card').length).toBe(2);
  });

  it('silently ignores non-existent lane names in collapsedLanes', () => {
    const parsed = parseKanban(swimInput, palette.light);
    const container = document.createElement('div');
    // Should not throw
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Team',
      collapsedLanes: new Set(['NonExistentCrew']),
    });

    // All lanes should render with full cards (nothing actually collapsed)
    const cards = container.querySelectorAll('.kanban-card');
    expect(cards.length).toBe(5);
  });
});

// ============================================================
// Export view state: compact meta
// ============================================================

describe('kanban compact meta', () => {
  const input = `kanban

tag Team
  Frontend blue
  Backend green

tag Priority
  High red
  Low yellow

[Backlog]
  Fix login team: Frontend, priority: High
  Caching team: Backend, priority: Low`;

  it('hides active tag group meta from cards when compactMeta is true', () => {
    const parsed = parseKanban(input, palette.light);

    // Without compact: cards show both Team and Priority meta
    const containerFull = document.createElement('div');
    renderKanban(containerFull, parsed, palette.light, false, {
      activeTagGroup: 'Team',
    });
    // With compact: active tag group (Team) meta should be hidden
    const containerCompact = document.createElement('div');
    renderKanban(containerCompact, parsed, palette.light, false, {
      activeTagGroup: 'Team',
      compactMeta: true,
    });

    // Both should still render cards
    expect(containerCompact.querySelectorAll('.kanban-card').length).toBe(2);

    // The compact version should have fewer text elements (hidden team meta)
    const fullTexts = containerFull.querySelectorAll('.kanban-card text');
    const compactTexts = containerCompact.querySelectorAll('.kanban-card text');
    expect(compactTexts.length).toBeLessThan(fullTexts.length);
  });
});

// ============================================================
// Export view state: partial state (no crash)
// ============================================================

describe('kanban partial view state', () => {
  const input = `kanban

tag Crew
  Blackbeard red
  Anne Bonny blue

[Backlog]
  Swab deck crew: Blackbeard
  Mend sails crew: Anne Bonny

[Done]
  Navigate crew: Blackbeard`;

  it('renders swimlanes when only currentSwimlaneGroup is set (no crash from missing cl/cc/cm)', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    // Only swim set, no cl/cc/cm
    renderKanban(container, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Crew',
    });

    expect(container.querySelectorAll('.kanban-lane').length).toBeGreaterThan(
      0
    );
    expect(container.querySelectorAll('.kanban-card').length).toBe(3);
  });

  it('handles empty sets for collapsedLanes/collapsedColumns identically to undefined', () => {
    const parsed = parseKanban(input, palette.light);

    const containerUndef = document.createElement('div');
    renderKanban(containerUndef, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Crew',
    });

    const containerEmpty = document.createElement('div');
    renderKanban(containerEmpty, parsed, palette.light, false, {
      currentSwimlaneGroup: 'Crew',
      collapsedLanes: new Set(),
      collapsedColumns: new Set(),
    });

    // Both should produce identical card counts
    expect(containerEmpty.querySelectorAll('.kanban-card').length).toBe(
      containerUndef.querySelectorAll('.kanban-card').length
    );
  });

  it('handles stale view state referencing non-existent column without crash', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    // Reference a column that doesn't exist
    renderKanban(container, parsed, palette.light, false, {
      collapsedColumns: new Set(['nonexistent-column']),
    });

    // Should render normally, no crash
    expect(container.querySelectorAll('.kanban-card').length).toBe(3);
  });
});
