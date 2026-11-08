// foldAtLine — the one fold edit a static host (Obsidian, the docs sites)
// calls for every toggle kind in every chart type (diagrammo/diagrammo#1741).
// Each case is driven through the static render: the toggle on the marker line
// reads aria-expanded="true", foldAtLine folds it to "false", and unfolding
// returns the original source byte for byte.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import { foldAtLine } from '../src/index';

const TOGGLE_ATTRS = [
  'data-node-toggle',
  'data-group-toggle',
  'data-section-toggle',
  'data-note-toggle',
] as const;
const TOGGLE_SELECTOR = TOGGLE_ATTRS.map((a) => `[${a}]`).join(', ');

let win: JSDOM['window'];
beforeAll(() => {
  win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;
  for (const key of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? win : win[key],
      configurable: true,
    });
  }
});

async function toggles(source: string): Promise<Element[]> {
  const { svg, diagnostics } = await render(source, {
    theme: 'light',
    palette: 'nord',
  });
  expect(
    diagnostics.filter((d) => d.severity === 'error'),
    source
  ).toEqual([]);
  const doc = new win.DOMParser().parseFromString(svg, 'image/svg+xml');
  return [...doc.querySelectorAll(TOGGLE_SELECTOR)].filter((el) =>
    el.hasAttribute('data-line-number')
  );
}

async function toggleAt(source: string, line: number): Promise<Element> {
  const at = (await toggles(source)).filter(
    (el) => el.getAttribute('data-line-number') === String(line)
  );
  expect(at.length, `one toggle on line ${line}\n${source}`).toBe(1);
  return at[0]!;
}

const PERT = readFileSync(
  join(__dirname, '../test-fixtures/pert/with-groups.dgmo'),
  'utf8'
);

/**
 * An expanded source, the line of the thing to fold, its toggle kind, and the
 * same source folded the way a person writes it by hand (the bare flag).
 */
interface Case {
  source: string;
  line: number;
  kind: (typeof TOGGLE_ATTRS)[number];
  handFolded: string;
}

const CASES: Record<string, Case> = {
  mindmap: {
    source: 'mindmap Root\n  A\n    A1\n  B',
    line: 2,
    kind: 'data-node-toggle',
    handFolded: 'mindmap Root\n  A collapsed\n    A1\n  B',
  },
  org: {
    source: 'org Crew\n\nCaptain\n  Mate\n    Deckhand\n  Cook',
    line: 4,
    kind: 'data-node-toggle',
    handFolded:
      'org Crew\n\nCaptain\n  Mate collapsed: true\n    Deckhand\n  Cook',
  },
  'org container': {
    source: 'org Crew\n\nCaptain\n  [Deck]\n    Mate\n    Deckhand',
    line: 4,
    kind: 'data-node-toggle',
    handFolded:
      'org Crew\n\nCaptain\n  [Deck] collapsed: true\n    Mate\n    Deckhand',
  },
  'org container, bare flag': {
    source: 'org Crew\n\nCaptain\n  [Deck]\n    Mate\n    Deckhand',
    line: 4,
    kind: 'data-node-toggle',
    handFolded:
      'org Crew\n\nCaptain\n  [Deck] collapsed\n    Mate\n    Deckhand',
  },
  sitemap: {
    source: 'sitemap Site\n\nHome\n  Products\n    Widgets\n  About',
    line: 4,
    kind: 'data-node-toggle',
    handFolded:
      'sitemap Site\n\nHome\n  Products collapsed\n    Widgets\n  About',
  },
  'sitemap container': {
    source: 'sitemap Site\n\nHome\n  [Shop]\n    Cart\n    Checkout',
    line: 4,
    kind: 'data-node-toggle',
    handFolded:
      'sitemap Site\n\nHome\n  [Shop] collapsed\n    Cart\n    Checkout',
  },
  infra: {
    source: 'infra Net\n\nEdge\n  -> Api\n\n[Backend]\n  Api\n    -> Db\n  Db',
    line: 6,
    kind: 'data-node-toggle',
    handFolded:
      'infra Net\n\nEdge\n  -> Api\n\n[Backend]\n  collapsed: true\n  Api\n    -> Db\n  Db',
  },
  state: {
    source:
      'state Flow\n\n[Fulfillment]\n  Processing\n    -pack-> Shipping\n  Shipping\n\n[*] -> Processing',
    line: 3,
    kind: 'data-group-toggle',
    handFolded:
      'state Flow\n\n[Fulfillment] collapsed\n  Processing\n    -pack-> Shipping\n  Shipping\n\n[*] -> Processing',
  },
  'sequence participant group': {
    source: 'sequence Flow\n[Backend]\n  API\n  DB\nUser -request-> API',
    line: 2,
    kind: 'data-group-toggle',
    handFolded:
      'sequence Flow\n[Backend] collapsed\n  API\n  DB\nUser -request-> API',
  },
  'sequence section': {
    source: 'sequence Flow\nA -hi-> B\n== Phase ==\nA -one-> B\nB -two-> A',
    line: 3,
    kind: 'data-section-toggle',
    handFolded:
      'sequence Flow\nA -hi-> B\n== Phase == collapsed\nA -one-> B\nB -two-> A',
  },
  'sequence note': {
    source:
      'sequence Flow\nAPI -> DB\nnote right of DB\n  First line\n  Second line\nDB -> API',
    line: 3,
    kind: 'data-note-toggle',
    handFolded:
      'sequence Flow\nAPI -> DB\nnote right of DB collapsed\n  First line\n  Second line\nDB -> API',
  },
  block: {
    source:
      'block Health\n\n[Services]\n  [Auth] [Orders]\n\n[Data]\n  [Postgres] [Redis]',
    line: 6,
    kind: 'data-group-toggle',
    handFolded:
      'block Health\n\n[Services]\n  [Auth] [Orders]\n\n[Data] collapsed\n  [Postgres] [Redis]',
  },
  gantt: {
    source:
      'gantt\n[Backend]\n  API duration: 5d\n[Frontend]\n  UI duration: 3d',
    line: 2,
    kind: 'data-group-toggle',
    handFolded:
      'gantt\n[Backend] collapsed\n  API duration: 5d\n[Frontend]\n  UI duration: 3d',
  },
  'gantt group with a start offset': {
    source:
      'gantt\nstart 2024-01-01\n[Backend]\n  API 5d\n+2d [Frontend]\n  UI 3d',
    line: 5,
    kind: 'data-group-toggle',
    handFolded:
      'gantt\nstart 2024-01-01\n[Backend]\n  API 5d\n+2d [Frontend] collapsed\n  UI 3d',
  },
  kanban: {
    source: 'kanban\n[To Do]\n  Task 1\n[Done]\n  Task 2',
    line: 2,
    kind: 'data-group-toggle',
    handFolded: 'kanban\n[To Do] collapsed\n  Task 1\n[Done]\n  Task 2',
  },
  'event-line': {
    source:
      'event-line X\nno-scale\n\n[Phase One]\n  2020 A\n    one\n\n[Phase Two]\n  2021 B\n    two',
    line: 4,
    kind: 'data-group-toggle',
    handFolded:
      'event-line X\nno-scale\n\n[Phase One] collapsed\n  2020 A\n    one\n\n[Phase Two]\n  2021 B\n    two',
  },
  'boxes-and-lines': {
    source: 'boxes-and-lines Sys\n\n[Core]\n  A\n  B\nA -> B\nC -> A',
    line: 3,
    kind: 'data-group-toggle',
    handFolded:
      'boxes-and-lines Sys\n\n[Core] collapsed\n  A\n  B\nA -> B\nC -> A',
  },
  timeline: {
    source:
      'timeline\n\n[Alpha]\n  2020 Kickoff\n  2021 Launch\n[Beta]\n  2020 Draft',
    line: 3,
    kind: 'data-group-toggle',
    handFolded:
      'timeline\n\n[Alpha] collapsed\n  2020 Kickoff\n  2021 Launch\n[Beta]\n  2020 Draft',
  },
  'journey-map': {
    source:
      'journey-map Trip\n\n[Discover]\n  Search\n  Compare\n[Book]\n  Pay',
    line: 3,
    kind: 'data-group-toggle',
    handFolded:
      'journey-map Trip\n\n[Discover] collapsed\n  Search\n  Compare\n[Book]\n  Pay',
  },
  raci: {
    source:
      'raci Project\n\nroles\n  Dev\n  PM\n\n[Plan]\n  Scope\n    Dev: R\n    PM: A\n[Build]\n  Code\n    Dev: R',
    line: 7,
    kind: 'data-group-toggle',
    handFolded:
      'raci Project\n\nroles\n  Dev\n  PM\n\n[Plan] collapsed\n  Scope\n    Dev: R\n    PM: A\n[Build]\n  Code\n    Dev: R',
  },
  pert: {
    source: PERT,
    line: PERT.split('\n').findIndex((l) => l === '[outfit ship]') + 1,
    kind: 'data-group-toggle',
    handFolded: PERT.replace('[outfit ship]', '[outfit ship] collapsed'),
  },
};

describe('foldAtLine folds and unfolds every toggle kind (#1741)', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(`${name} — fold renders aria-expanded="false", unfold restores the source`, async () => {
      const open = await toggleAt(c.source, c.line);
      expect(open.hasAttribute(c.kind), name).toBe(true);
      expect(open.getAttribute('aria-expanded')).toBe('true');

      const folded = foldAtLine(c.source, c.line, true);
      expect(folded, name).not.toBeNull();
      const shut = await toggleAt(folded!, c.line);
      expect(shut.getAttribute('aria-expanded')).toBe('false');

      expect(foldAtLine(folded!, c.line, false)).toBe(c.source);
      // Already in that state: nothing to write.
      expect(foldAtLine(folded!, c.line, true)).toBeNull();
      expect(foldAtLine(c.source, c.line, false)).toBeNull();
    });

    it(`${name} — unfolds the hand-written marker`, async () => {
      const shut = await toggleAt(c.handFolded, c.line);
      expect(shut.getAttribute('aria-expanded')).toBe('false');
      const opened = foldAtLine(c.handFolded, c.line, false);
      expect(opened, name).toBe(c.source);
    });
  }
});

describe('unfold removes an indented `collapsed: true` line (#1741)', () => {
  const INDENTED: Record<string, { source: string; line: number }> = {
    org: {
      source: 'org Crew\n\nCaptain\n  Mate\n    Deckhand\n  Cook',
      line: 4,
    },
    'org container': {
      source: 'org Crew\n\nCaptain\n  [Deck]\n    Mate\n    Deckhand',
      line: 4,
    },
    sitemap: {
      source: 'sitemap Site\n\nHome\n  Products\n    Widgets\n  About',
      line: 4,
    },
    'sitemap container': {
      source: 'sitemap Site\n\nHome\n  [Shop]\n    Cart\n    Checkout',
      line: 4,
    },
    infra: {
      source:
        'infra Net\n\nEdge\n  -> Api\n\n[Backend]\n  Api\n    -> Db\n  Db',
      line: 6,
    },
  };
  for (const [name, c] of Object.entries(INDENTED)) {
    it(name, async () => {
      const lines = c.source.split('\n');
      const child = lines[c.line]!;
      const indent = child.slice(0, child.length - child.trimStart().length);
      lines.splice(c.line, 0, `${indent}collapsed: true`);
      const folded = lines.join('\n');
      const shut = await toggleAt(folded, c.line);
      expect(shut.getAttribute('aria-expanded')).toBe('false');
      expect(foldAtLine(folded, c.line, false)).toBe(c.source);
    });
  }

  it("leaves a nested node's marker alone", () => {
    const src =
      'org Crew\n\nCaptain\n  Mate\n    collapsed: true\n    Deckhand\n      collapsed: true\n      Boy';
    expect(foldAtLine(src, 4, false)).toBe(
      'org Crew\n\nCaptain\n  Mate\n    Deckhand\n      collapsed: true\n      Boy'
    );
  });

  it('removes both forms when a line carries both', () => {
    const src =
      'sitemap Site\n\nHome\n  Products collapsed\n    collapsed: true\n    Widgets';
    expect(foldAtLine(src, 4, false)).toBe(
      'sitemap Site\n\nHome\n  Products\n    Widgets'
    );
  });
});

describe('every rendered toggle writes something (#1741)', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, async () => {
      for (const t of await toggles(c.source)) {
        const line = Number(t.getAttribute('data-line-number'));
        const collapse = t.getAttribute('aria-expanded') === 'true';
        expect(
          foldAtLine(c.source, line, collapse),
          `${name} line ${line}`
        ).not.toBeNull();
      }
    });
  }
});

describe('foldAtLine refuses what folds nothing', () => {
  it('a line past the end, line 0, a non-integer', () => {
    const src = CASES['mindmap']!.source;
    expect(foldAtLine(src, 99, true)).toBeNull();
    expect(foldAtLine(src, 0, true)).toBeNull();
    expect(foldAtLine(src, 1.5, true)).toBeNull();
  });
  it('a non-node line in a tree chart', () => {
    expect(foldAtLine('org Crew\n\nCaptain\n  Mate', 2, true)).toBeNull();
  });
  it('a chart type with no folds', () => {
    expect(
      foldAtLine('wireframe Test\n[Advanced]\n  Text Hello', 2, true)
    ).toBeNull();
    expect(foldAtLine('pie Pets\nDogs: 3\nCats: 2', 2, true)).toBeNull();
  });
  it('a sequence message line', () => {
    expect(foldAtLine('sequence Flow\nA -hi-> B', 2, true)).toBeNull();
  });
  it('== collapsed == is a section named "collapsed"', () => {
    const src = 'sequence Flow\nA -hi-> B\n== collapsed ==\nA -one-> B';
    expect(foldAtLine(src, 3, true)).toBe(
      'sequence Flow\nA -hi-> B\n== collapsed == collapsed: true\nA -one-> B'
    );
  });
});

describe('the block entry carries foldAtLine (#1741)', () => {
  it('is the same function the main entry exports', async () => {
    const block = await import('../src/embed/index');
    expect(block.foldAtLine).toBe(foldAtLine);
  });
});
