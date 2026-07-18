// ============================================================
// Bare `collapsed` trailing-flag unification (decision #48, spec §1.8)
// ============================================================
//
// Canonical collapse spelling: a bare lowercase `collapsed` token in
// trailing position on the group/container line (`[Backend] collapsed`).
// The older `collapsed: true` metadata form stays accepted as legacy.
// Per chart: bare flag folds; legacy still folds; a name containing
// capitalized "Collapsed" never triggers (case-sensitive match, same
// hazard class as trailing colors).

import { describe, expect, it } from 'vitest';

import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseInfra } from '../src/infra/parser';
import { parseGantt } from '../src/gantt/parser';
import type { GanttGroup, GanttNode } from '../src/gantt/types';
import { parseKanban } from '../src/kanban/parser';
import { parseMindmap } from '../src/mindmap/parser';
import { parsePert } from '../src/pert/parser';
import { parseState } from '../src/graph/state-parser';
import { parseC4 } from '../src/c4/parser';
import { parseEventLine } from '../src/event-line/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('slate').light;

function ganttGroupsOf(nodes: readonly GanttNode[]): GanttGroup[] {
  const out: GanttGroup[] = [];
  for (const n of nodes) {
    if (n.kind === 'group') {
      out.push(n);
      out.push(...ganttGroupsOf(n.children));
    } else if (n.kind === 'parallel') {
      out.push(...ganttGroupsOf(n.children));
    }
  }
  return out;
}

// ── sequence ─────────────────────────────────────────────────

describe('sequence — bare `collapsed` flag (§1.8)', () => {
  it('bare flag folds the group', () => {
    const parsed = parseSequenceDgmo(
      'sequence\n[Backend] collapsed\n  API\n  DB'
    );
    expect(parsed.error).toBeNull();
    const g = parsed.groups.find((gr) => gr.name === 'Backend')!;
    expect(g.collapsed).toBe(true);
    expect(g.metadata).toBeUndefined();
  });

  it('legacy `collapsed: true` still folds', () => {
    const parsed = parseSequenceDgmo(
      'sequence\n[Backend] collapsed: true\n  API'
    );
    expect(parsed.groups[0]!.collapsed).toBe(true);
  });

  it('flag coexists with same-line metadata', () => {
    const parsed = parseSequenceDgmo(
      '[Backend] description: Core collapsed\n  API'
    );
    const g = parsed.groups[0]!;
    expect(g.collapsed).toBe(true);
    expect(g.metadata?.['description']).toBe('Core');
  });

  it('a group named "Auth Collapsed" keeps its name and stays expanded', () => {
    const parsed = parseSequenceDgmo('sequence\n[Auth Collapsed]\n  API');
    const g = parsed.groups[0]!;
    expect(g.name).toBe('Auth Collapsed');
    expect(g.collapsed).toBeUndefined();
  });
});

// ── infra ────────────────────────────────────────────────────

describe('infra — bare `collapsed` flag + instances forms (§4.6)', () => {
  it('bare flag on the [Group] line folds the group', () => {
    const parsed = parseInfra('infra\n[Backend] collapsed\n  API');
    const g = parsed.groups.find((gr) => gr.label === 'Backend')!;
    expect(g.collapsed).toBe(true);
  });

  it('bare flag combines with an `as` alias', () => {
    const parsed = parseInfra('infra\n[Backend] as be collapsed\n  API');
    expect(parsed.groups[0]!.collapsed).toBe(true);
  });

  it('same-line legacy `collapsed: true` folds without cascading into child tags', () => {
    const parsed = parseInfra('infra\n[Backend] collapsed: true\n  API');
    const g = parsed.groups[0]!;
    expect(g.collapsed).toBe(true);
    expect(g.metadata?.['collapsed']).toBeUndefined();
    const api = parsed.nodes.find((n) => n.label === 'API')!;
    expect(api.tags['collapsed']).toBeUndefined();
  });

  it('indented legacy `collapsed: true` colon property still folds', () => {
    const parsed = parseInfra('infra\n[Backend]\n  collapsed: true\n  API');
    expect(parsed.groups[0]!.collapsed).toBe(true);
  });

  it('indented legacy `collapsed true` space form still folds', () => {
    const parsed = parseInfra('infra\n[Backend]\n  collapsed true\n  API');
    expect(parsed.groups[0]!.collapsed).toBe(true);
  });

  it('canonical `instances: 3` colon form sets group instances', () => {
    const parsed = parseInfra('infra\n[Backend]\n  instances: 3\n  API');
    expect(parsed.groups[0]!.instances).toBe(3);
  });

  it('canonical `instances: 2-8` colon range form sets group instances', () => {
    const parsed = parseInfra('infra\n[Backend]\n  instances: 2-8\n  API');
    expect(parsed.groups[0]!.instances).toBe('2-8');
  });

  it('legacy `instances 3` space form still sets group instances', () => {
    const parsed = parseInfra('infra\n[Backend]\n  instances 3\n  API');
    expect(parsed.groups[0]!.instances).toBe(3);
  });

  it('legacy `instances 2-8` space range form still sets group instances', () => {
    const parsed = parseInfra('infra\n[Backend]\n  instances 2-8\n  API');
    expect(parsed.groups[0]!.instances).toBe('2-8');
  });

  it('a group named "Backend Collapsed" keeps its name and stays expanded', () => {
    const parsed = parseInfra('infra\n[Backend Collapsed]\n  API');
    const g = parsed.groups[0]!;
    expect(g.label).toBe('Backend Collapsed');
    expect(g.collapsed).toBeUndefined();
  });
});

// ── gantt ────────────────────────────────────────────────────

describe('gantt — bare `collapsed` flag (§13)', () => {
  it('bare flag folds the group', () => {
    const parsed = parseGantt(
      'gantt\n[Backend] collapsed\n  API duration: 5d',
      palette
    );
    const g = ganttGroupsOf(parsed.nodes).find((x) => x.name === 'Backend')!;
    expect(g.collapsed).toBe(true);
    expect(g.metadata['collapsed']).toBeUndefined();
  });

  it('legacy `collapsed: true` still folds', () => {
    const parsed = parseGantt(
      'gantt\n[Backend] collapsed: true\n  API duration: 5d',
      palette
    );
    expect(
      ganttGroupsOf(parsed.nodes).find((x) => x.name === 'Backend')!.collapsed
    ).toBe(true);
  });

  it('a group named "Phase Collapsed" keeps its name and stays expanded', () => {
    const parsed = parseGantt(
      'gantt\n[Phase Collapsed]\n  API duration: 5d',
      palette
    );
    const g = ganttGroupsOf(parsed.nodes)[0]!;
    expect(g.name).toBe('Phase Collapsed');
    expect(g.collapsed).toBeUndefined();
  });
});

// ── kanban ───────────────────────────────────────────────────

describe('kanban — bare `collapsed` flag on columns (§11)', () => {
  it('bare flag folds the column', () => {
    const parsed = parseKanban('kanban\n[Done] collapsed\n  Task 1');
    const col = parsed.columns.find((c) => c.name === 'Done')!;
    expect(col.collapsed).toBe(true);
    expect(col.metadata?.['collapsed']).toBeUndefined();
  });

  it('bare flag follows a trailing color token', () => {
    const parsed = parseKanban('kanban\n[Done] blue collapsed\n  Task 1');
    const col = parsed.columns[0]!;
    expect(col.collapsed).toBe(true);
    expect(col.color).toBeDefined();
  });

  it('bare flag follows same-line metadata (wip)', () => {
    const parsed = parseKanban('kanban\n[Done] wip: 3 collapsed\n  Task 1');
    const col = parsed.columns[0]!;
    expect(col.collapsed).toBe(true);
    expect(col.wipLimit).toBe(3);
  });

  it('legacy `collapsed: true` still folds', () => {
    const parsed = parseKanban('kanban\n[Done] collapsed: true\n  Task 1');
    expect(parsed.columns[0]!.collapsed).toBe(true);
  });

  it('a column named "Collapsed" keeps its name and stays expanded', () => {
    const parsed = parseKanban('kanban\n[Collapsed]\n  Task 1');
    const col = parsed.columns[0]!;
    expect(col.name).toBe('Collapsed');
    expect(col.collapsed).toBeUndefined();
  });
});

// ── mindmap ──────────────────────────────────────────────────

describe('mindmap — bare `collapsed` flag on node lines', () => {
  it('bare flag folds the subtree', () => {
    const parsed = parseMindmap('mindmap Root\n  Research collapsed\n    A');
    const node = parsed.roots[0]!.children[0]!;
    expect(node.label).toBe('Research');
    expect(node.collapsed).toBe(true);
  });

  it('bare flag follows a trailing color token', () => {
    const parsed = parseMindmap(
      'mindmap Root\n  Research blue collapsed\n    A'
    );
    const node = parsed.roots[0]!.children[0]!;
    expect(node.label).toBe('Research');
    expect(node.metadata['color']).toBe('blue');
    expect(node.collapsed).toBe(true);
  });

  it('legacy `collapsed: true` still folds', () => {
    const parsed = parseMindmap(
      'mindmap Root\n  Research collapsed: true\n    A'
    );
    expect(parsed.roots[0]!.children[0]!.collapsed).toBe(true);
  });

  it('a node named "Research Collapsed" keeps its name and stays expanded', () => {
    const parsed = parseMindmap('mindmap Root\n  Research Collapsed\n    A');
    const node = parsed.roots[0]!.children[0]!;
    expect(node.label).toBe('Research Collapsed');
    expect(node.collapsed).toBeUndefined();
  });
});

// ── pert ─────────────────────────────────────────────────────

describe('pert — bare `collapsed` flag on group headers', () => {
  const groupSrc = (marker: string): string =>
    `pert Voyage\n[outfit ship]${marker}\n  recruit crew 1 2 4`;

  it('bare flag folds the group', () => {
    const parsed = parsePert(groupSrc(' collapsed'));
    expect(parsed.groups[0]!.collapsed).toBe(true);
  });

  it('legacy `collapsed: true` still folds', () => {
    const parsed = parsePert(groupSrc(' collapsed: true'));
    expect(parsed.groups[0]!.collapsed).toBe(true);
  });

  it('a group named "phase Collapsed" keeps its name and stays expanded', () => {
    const parsed = parsePert(
      'pert Voyage\n[phase Collapsed]\n  recruit crew 1 2 4'
    );
    const g = parsed.groups[0]!;
    expect(g.name).toBe('phase Collapsed');
    expect(g.collapsed).toBe(false);
  });
});

// ── state ────────────────────────────────────────────────────

describe('state — bare `collapsed` flag on composite groups', () => {
  it('bare flag folds the group', () => {
    const groups =
      parseState('state\n[Fulfillment] collapsed\n  Processing').groups ?? [];
    expect(groups.find((g) => g.label === 'Fulfillment')!.collapsed).toBe(true);
  });

  it('bare flag follows a trailing color token', () => {
    const groups =
      parseState('state\n[Fulfillment] blue collapsed\n  Processing').groups ??
      [];
    const g = groups.find((gr) => gr.label === 'Fulfillment')!;
    expect(g.collapsed).toBe(true);
    expect(g.color).toBeDefined();
  });

  it('legacy `collapsed: false` does not fold', () => {
    const groups =
      parseState('state\n[Fulfillment] collapsed: false\n  Processing')
        .groups ?? [];
    expect(
      groups.find((g) => g.label === 'Fulfillment')!.collapsed
    ).toBeUndefined();
  });

  it('a group named "Order Collapsed" keeps its name and stays expanded', () => {
    const groups =
      parseState('state\n[Order Collapsed]\n  Processing').groups ?? [];
    const g = groups[0]!;
    expect(g.label).toBe('Order Collapsed');
    expect(g.collapsed).toBeUndefined();
  });
});

// ── c4 ───────────────────────────────────────────────────────

describe('c4 — bare `collapsed` flag on group boundaries', () => {
  const src = (marker: string): string =>
    [
      'c4',
      'Banking is a system',
      '  containers',
      `    [API Layer]${marker}`,
      '      API is a container',
    ].join('\n');

  it('bare flag sets the group collapsed marker', () => {
    const result = parseC4(src(' collapsed'));
    const g = result.elements[0]!.groups[0]!;
    expect(g.name).toBe('API Layer');
    expect(g.collapsed).toBe(true);
    expect(g.children).toHaveLength(1);
  });

  it('legacy `collapsed: true` still sets the marker', () => {
    const result = parseC4(src(' collapsed: true'));
    expect(result.elements[0]!.groups[0]!.collapsed).toBe(true);
  });

  it('legacy `collapsed: false` leaves the group expanded', () => {
    const result = parseC4(src(' collapsed: false'));
    expect(result.elements[0]!.groups[0]!.collapsed).toBeUndefined();
  });

  it('a group named "API Collapsed" keeps its name and stays expanded', () => {
    const result = parseC4(
      [
        'c4',
        'Banking is a system',
        '  containers',
        '    [API Collapsed]',
        '      API is a container',
      ].join('\n')
    );
    const g = result.elements[0]!.groups[0]!;
    expect(g.name).toBe('API Collapsed');
    expect(g.collapsed).toBeUndefined();
  });
});

// ── event-line (eras) ────────────────────────────────────────

describe('event-line — bare `collapsed` flag on era lines (§28.6a)', () => {
  const src = (marker: string): string =>
    `event-line Ages\n[Golden Age]${marker}\n  1700 Treasure fleet\n  1710 Blockade`;

  it('bare flag folds the era', () => {
    const p = parseEventLine(src(' collapsed'));
    expect(p.error).toBeNull();
    expect(p.eras[0]!.collapsed).toBe(true);
    expect(p.eras[0]!.name).toBe('Golden Age');
  });

  it('bare flag before a color token folds and tints', () => {
    const p = parseEventLine(src(' collapsed blue'));
    expect(p.eras[0]!.collapsed).toBe(true);
    expect(p.eras[0]!.color).toBe('blue');
  });

  it('bare flag after a color token folds and tints', () => {
    const p = parseEventLine(src(' blue collapsed'));
    expect(p.eras[0]!.collapsed).toBe(true);
    expect(p.eras[0]!.color).toBe('blue');
  });

  it('legacy `collapsed: true` still folds', () => {
    const p = parseEventLine(src(' collapsed: true'));
    expect(p.eras[0]!.collapsed).toBe(true);
  });

  it('legacy `collapsed: false` stays expanded', () => {
    const p = parseEventLine(src(' collapsed: false'));
    expect(p.eras[0]!.collapsed).toBe(false);
  });

  it('an era named "The Collapsed Age" keeps its name and stays expanded', () => {
    const p = parseEventLine(
      'event-line Ages\n[The Collapsed Age]\n  1700 Treasure fleet'
    );
    expect(p.eras[0]!.name).toBe('The Collapsed Age');
    expect(p.eras[0]!.collapsed).toBe(false);
  });
});
