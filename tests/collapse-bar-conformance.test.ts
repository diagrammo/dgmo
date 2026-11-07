// One fold mark across every chart type (diagrammo/diagrammo#1741, decided
// 2026-11-07): each folded thing draws exactly ONE collapse bar through
// `renderCollapseBar` (utils/card.ts) — COLLAPSE_BAR_HEIGHT tall at the
// export scale, in every render mode — and an expanded thing draws none.
//
// The static path (`render()`) is the one Obsidian, the docs sites, the CLI and
// every PNG/SVG export draw through, so it is the path under test. Types whose
// fold is runtime-only today (sitemap, boxes-and-lines, timeline, journey-map,
// raci, pert) are driven through the collapsed set their renderer accepts.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import { COLLAPSE_BAR_HEIGHT } from '../src/utils/visual-conventions';
import { parseVisualization, renderTimeline } from '../src/d3';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { parseJourneyMap } from '../src/journey-map/parser';
import { renderJourneyMap } from '../src/journey-map/renderer';
import { parseRaci } from '../src/raci/parser';
import { renderRaci } from '../src/raci/renderer';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';
import { relayoutPert } from '../src/pert/layout';
import { renderPert } from '../src/pert/renderer';

const BAR = '.dgmo-collapse-bar';
const palette = getPalette('nord').light;

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

function mount(): HTMLDivElement {
  const c = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(c);
  return c;
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
    folded: 'sitemap Site\n\nHome\n  Products\n    Widgets\n  About',
    expanded: 'sitemap Site\n\nHome\n  Products\n    Widgets\n  About',
  },
};

describe('one collapse bar per folded thing, in the static render (#1741)', () => {
  for (const [name, c] of Object.entries(STATIC)) {
    it(`${name} — folded draws one bar`, async () => {
      // Sequence sections fold through the share-link view state, sitemap
      // through its collapsed-node set (no source marker yet: slice 3).
      const viewState =
        name === 'sitemap'
          ? { cg: await sitemapFoldId(c.folded) }
          : c.viewState;
      expectBars(await staticBars(c.folded, viewState), 1, name);
    });
    it(`${name} — expanded draws none`, async () => {
      expectBars(await staticBars(c.expanded), 0, name);
    });
  }
});

/** The id of the sitemap's "Products" node, which the fixture folds. */
async function sitemapFoldId(source: string): Promise<string[]> {
  const { svg } = await render(source, { theme: 'light' });
  const doc = new win.DOMParser().parseFromString(svg, 'image/svg+xml');
  const ids = [...doc.querySelectorAll('[data-node-id]')]
    .filter((el) => el.textContent?.trim().startsWith('Products'))
    .map((el) => el.getAttribute('data-node-id')!);
  expect(ids.length).toBeGreaterThan(0);
  return [ids[0]!];
}

describe('one collapse bar per folded thing, runtime-folded types (#1741)', () => {
  it('boxes-and-lines — a folded group', async () => {
    const src = 'boxes-and-lines Sys\n\n[Core]\n  A\n  B\nA -> B\nC -> A';
    for (const folded of [true, false]) {
      const parsed = parseBoxesAndLines(src);
      const cr = collapseBoxesAndLines(parsed, new Set(folded ? ['Core'] : []));
      const layout = await layoutBoxesAndLines(cr.parsed, {
        collapsedChildCounts: cr.collapsedChildCounts,
        originalGroups: cr.originalGroups,
      });
      const c = mount();
      renderBoxesAndLines(c, cr.parsed, layout, palette, false, {
        exportDims: { width: 800, height: 600 },
      });
      expectBars([...c.querySelectorAll(BAR)], folded ? 1 : 0, 'bl');
    }
  });

  it('timeline — a folded lane', () => {
    const src =
      'timeline\n\n[Alpha]\n  2020 Kickoff\n  2021 Launch\n[Beta]\n  2020 Draft';
    const c = mount();
    renderTimeline(
      c,
      parseVisualization(src, palette),
      palette,
      false,
      undefined,
      {
        width: 1200,
        height: 600,
      }
    );
    expectBars([...c.querySelectorAll(BAR)], 0, 'timeline expanded');
    c.querySelector('.tl-group-header[data-group="Alpha"]')!.dispatchEvent(
      new win.Event('click')
    );
    expectBars([...c.querySelectorAll(BAR)], 1, 'timeline folded');
  });

  it('journey-map — a folded phase', () => {
    const src =
      'journey-map Trip\n\n[Discover]\n  Search\n  Compare\n[Book]\n  Pay';
    const parsed = parseJourneyMap(src, palette);
    for (const folded of [true, false]) {
      const c = mount();
      renderJourneyMap(c, parsed, palette, false, {
        exportDims: { width: 1000, height: 600 },
        collapsedPhases: new Set(folded ? ['Discover'] : []),
      });
      expectBars([...c.querySelectorAll(BAR)], folded ? 1 : 0, 'journey');
    }
  });

  it('raci — a folded phase', () => {
    const src =
      'raci Project\n\nroles\n  Dev\n  PM\n\n[Plan]\n  Scope\n    Dev: R\n    PM: A\n[Build]\n  Code\n    Dev: R';
    const parsed = parseRaci(src, palette);
    const phaseId = parsed.phases[0]!.id;
    for (const folded of [true, false]) {
      const c = mount();
      renderRaci(
        c,
        parsed,
        palette,
        false,
        { collapsedPhases: new Set(folded ? [phaseId] : []) },
        { width: 1000, height: 600 }
      );
      expectBars([...c.querySelectorAll(BAR)], folded ? 1 : 0, 'raci');
    }
  });

  it('pert — a folded group', () => {
    const src = readFileSync(
      join(__dirname, '../test-fixtures/pert/with-groups.dgmo'),
      'utf8'
    );
    const resolved = analyzePert(parsePert(src));
    const groupId = resolved.groups[0]!.group.id;
    for (const folded of [true, false]) {
      const ids = new Set(folded ? [groupId] : []);
      const c = mount();
      renderPert(c, resolved, relayoutPert(resolved, {}, ids), palette, false, {
        collapsedGroupIds: [...ids],
        exportDims: { width: 1200, height: 800 },
      });
      expectBars([...c.querySelectorAll(BAR)], folded ? 1 : 0, 'pert');
    }
  });
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
