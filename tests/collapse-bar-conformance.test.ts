// One fold mark across every chart type (diagrammo/diagrammo#1741, decided
// 2026-11-07): each folded thing draws exactly ONE collapse bar through
// `renderCollapseBar` (utils/card.ts) — COLLAPSE_BAR_HEIGHT tall at the
// export scale, in every render mode — and an expanded thing draws none.
//
// The static path (`render()`) is the one Obsidian, the docs sites, the CLI and
// every PNG/SVG export draw through, so it is the path under test. Every type
// is driven through its SOURCE `collapsed` marker (slice 3a) — no runtime set —
// except sequence sections, which still fold through the share-link view state.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import { COLLAPSE_BAR_HEIGHT } from '../src/utils/visual-conventions';

const BAR = '.dgmo-collapse-bar';

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

async function staticBars(
  source: string,
  viewState?: Parameters<typeof render>[1] extends infer O
    ? O extends { viewState?: infer V }
      ? V
      : never
    : never
): Promise<Element[]> {
  const { svg, diagnostics } = await render(source, {
    theme: 'light',
    palette: 'nord',
    ...(viewState && { viewState }),
  });
  expect(
    diagnostics.filter((d) => d.severity === 'error'),
    source
  ).toEqual([]);
  expect(svg, source).not.toBe('');
  const doc = new win.DOMParser().parseFromString(svg, 'image/svg+xml');
  return [...doc.querySelectorAll(BAR)];
}

function expectBars(bars: readonly Element[], count: number, label: string) {
  expect(bars.length, label).toBe(count);
  for (const bar of bars) {
    // The export scale is 1, so the bar is exactly COLLAPSE_BAR_HEIGHT.
    expect(Number(bar.getAttribute('height')), label).toBe(COLLAPSE_BAR_HEIGHT);
    expect(bar.getAttribute('clip-path'), label).toMatch(/^url\(#.+\)$/);
    expect(bar.getAttribute('opacity'), label).toBeNull();
  }
}

/** A source with one folded thing, and the same source with it expanded. */
interface StaticCase {
  folded: string;
  expanded: string;
  viewState?: Parameters<typeof staticBars>[1];
}

const PERT = readFileSync(
  join(__dirname, '../test-fixtures/pert/with-groups.dgmo'),
  'utf8'
);

const STATIC: Record<string, StaticCase> = {
  org: {
    folded: 'org Crew\n\nCaptain\n  Mate collapsed: true\n    Deckhand\n  Cook',
    expanded: 'org Crew\n\nCaptain\n  Mate\n    Deckhand\n  Cook',
  },
  'org container': {
    folded:
      'org Crew\n\nCaptain\n  [Deck] collapsed: true\n    Mate\n    Deckhand',
    expanded: 'org Crew\n\nCaptain\n  [Deck]\n    Mate\n    Deckhand',
  },
  mindmap: {
    folded: 'mindmap Root\n  A collapsed\n    A1\n  B',
    expanded: 'mindmap Root\n  A\n    A1\n  B',
  },
  infra: {
    folded:
      'infra Net\n\nEdge\n  -> Api\n\n[Backend] collapsed\n  Api\n    -> Db\n  Db',
    expanded:
      'infra Net\n\nEdge\n  -> Api\n\n[Backend]\n  Api\n    -> Db\n  Db',
  },
  state: {
    folded:
      'state Flow\n\n[Fulfillment] collapsed\n  Processing\n    -pack-> Shipping\n  Shipping\n\n[*] -> Processing',
    expanded:
      'state Flow\n\n[Fulfillment]\n  Processing\n    -pack-> Shipping\n  Shipping\n\n[*] -> Processing',
  },
  'sequence participant group': {
    folded:
      'sequence Flow\n[Backend] collapsed\n  API\n  DB\nUser -request-> API',
    expanded: 'sequence Flow\n[Backend]\n  API\n  DB\nUser -request-> API',
  },
  'sequence section': {
    folded: 'sequence Flow\nA -hi-> B\n== Phase ==\nA -one-> B\nB -two-> A',
    expanded: 'sequence Flow\nA -hi-> B\n== Phase ==\nA -one-> B\nB -two-> A',
    viewState: { cs: [3] },
  },
  block: {
    folded:
      'block Health\n\n[Services]\n  [Auth] [Orders]\n\n[Data] collapsed\n  [Postgres] [Redis]',
    expanded:
      'block Health\n\n[Services]\n  [Auth] [Orders]\n\n[Data]\n  [Postgres] [Redis]',
  },
  gantt: {
    folded:
      'gantt\n[Backend] collapsed\n  API duration: 5d\n[Frontend]\n  UI duration: 3d',
    expanded:
      'gantt\n[Backend]\n  API duration: 5d\n[Frontend]\n  UI duration: 3d',
  },
  kanban: {
    folded: 'kanban\n[To Do] collapsed\n  Task 1\n[Done]\n  Task 2',
    expanded: 'kanban\n[To Do]\n  Task 1\n[Done]\n  Task 2',
  },
  wireframe: {
    folded: 'wireframe Test\n[Advanced] collapsed\n  Text Hello',
    expanded: 'wireframe Test\n[Advanced]\n  Text Hello',
  },
  'event-line': {
    folded:
      'event-line X\nno-scale\n\n[Phase One] collapsed\n  2020 A\n    one\n\n[Phase Two]\n  2021 B\n    two',
    expanded:
      'event-line X\nno-scale\n\n[Phase One]\n  2020 A\n    one\n\n[Phase Two]\n  2021 B\n    two',
  },
  sitemap: {
    folded: 'sitemap Site\n\nHome\n  Products collapsed\n    Widgets\n  About',
    expanded: 'sitemap Site\n\nHome\n  Products\n    Widgets\n  About',
  },
  'sitemap container': {
    folded:
      'sitemap Site\n\nHome\n  [Shop] collapsed: true\n    Cart\n    Checkout',
    expanded: 'sitemap Site\n\nHome\n  [Shop]\n    Cart\n    Checkout',
  },
  'boxes-and-lines': {
    folded: 'boxes-and-lines Sys\n\n[Core] collapsed\n  A\n  B\nA -> B\nC -> A',
    expanded: 'boxes-and-lines Sys\n\n[Core]\n  A\n  B\nA -> B\nC -> A',
  },
  timeline: {
    folded:
      'timeline\n\n[Alpha] collapsed\n  2020 Kickoff\n  2021 Launch\n[Beta]\n  2020 Draft',
    expanded:
      'timeline\n\n[Alpha]\n  2020 Kickoff\n  2021 Launch\n[Beta]\n  2020 Draft',
  },
  'journey-map': {
    folded:
      'journey-map Trip\n\n[Discover] collapsed\n  Search\n  Compare\n[Book]\n  Pay',
    expanded:
      'journey-map Trip\n\n[Discover]\n  Search\n  Compare\n[Book]\n  Pay',
  },
  raci: {
    folded:
      'raci Project\n\nroles\n  Dev\n  PM\n\n[Plan] collapsed\n  Scope\n    Dev: R\n    PM: A\n[Build]\n  Code\n    Dev: R',
    expanded:
      'raci Project\n\nroles\n  Dev\n  PM\n\n[Plan]\n  Scope\n    Dev: R\n    PM: A\n[Build]\n  Code\n    Dev: R',
  },
  pert: {
    folded: PERT.replace('[outfit ship]', '[outfit ship] collapsed'),
    expanded: PERT,
  },
  'sequence note': {
    folded:
      'sequence Flow\nAPI -> DB\nnote right of DB collapsed\n  First line\n  Second line\nDB -> API',
    expanded:
      'sequence Flow\nAPI -> DB\nnote right of DB\n  First line\n  Second line\nDB -> API',
  },
};

describe('one collapse bar per folded thing, in the static render (#1741)', () => {
  for (const [name, c] of Object.entries(STATIC)) {
    it(`${name} — folded draws one bar`, async () => {
      expectBars(await staticBars(c.folded, c.viewState), 1, name);
    });
    it(`${name} — expanded draws none`, async () => {
      expectBars(await staticBars(c.expanded), 0, name);
    });
  }
});

const TOGGLE_ATTRS = [
  'data-node-toggle',
  'data-group-toggle',
  'data-section-toggle',
  'data-note-toggle',
];

async function toggleAt(source: string, line: number): Promise<Element[]> {
  const { svg } = await render(source, { theme: 'light', palette: 'nord' });
  const doc = new win.DOMParser().parseFromString(svg, 'image/svg+xml');
  return [...doc.querySelectorAll(`[data-line-number="${line}"]`)].filter(
    (el) => TOGGLE_ATTRS.some((a) => el.hasAttribute(a))
  );
}

describe('the marker line carries the toggle, folded and expanded (#1741)', () => {
  for (const [name, c] of Object.entries(STATIC)) {
    if (c.viewState) continue; // sequence sections: no source marker
    // Wireframe groups carry no toggle markup yet (not in slice 3a).
    if (name === 'wireframe') continue;
    const line =
      c.folded.split('\n').findIndex((l) => /\bcollapsed\b/.test(l)) + 1;
    for (const [state, source, expanded] of [
      ['folded', c.folded, 'false'],
      ['expanded', c.expanded, 'true'],
    ] as const) {
      it(`${name} — ${state}`, async () => {
        const toggles = await toggleAt(source, line);
        expect(toggles.length, `${name} ${state} line ${line}`).toBe(1);
        const t = toggles[0]!;
        expect(t.getAttribute('aria-expanded')).toBe(expanded);
        expect(t.getAttribute('role')).toBe('button');
        expect(t.getAttribute('aria-label') ?? '').not.toBe('');
        expect(t.hasAttribute('tabindex')).toBe(false);
      });
    }
  }
});

describe('no renderer draws its own collapse bar (#1741)', () => {
  it('only utils/card.ts creates an element with a collapse-bar class', () => {
    const root = join(__dirname, '../src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts')) {
          const rel = relative(root, path);
          if (rel === join('utils', 'card.ts')) continue;
          const text = readFileSync(path, 'utf8');
          // A class attribute (or classList) naming a collapse bar.
          if (/['"`][\w-]*collapse-bar[\w\s-]*['"`]/.test(text)) {
            for (const [i, line] of text.split('\n').entries()) {
              if (/['"`][\w-]*collapse-bar[\w\s-]*['"`]/.test(line))
                offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            }
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
