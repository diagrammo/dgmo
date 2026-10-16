// Every chart that draws a legend must bake a legend hover rule into its
// embed SVG (diagrammo/diagrammo#1215). An embed (remark-dgmo, Obsidian, the
// CLI) gets its hover from the CSS `injectHoverStyles` bakes, so a legend whose
// chart has no `legend` rule in `HOVER_SPECS` does nothing on hover — and reads
// as broken next to one that works.
//
// The enumeration is the gallery fixtures plus `TAGGED_SOURCES`: every chart
// type in the registry must have a fixture, and every chart type that takes
// tags must be rendered here WITH a `tag` block, since a tag legend is drawn
// only when there are tags. Every render that draws a `data-legend-entry` must
// come back with a `[data-legend-entry=…]` rule in its baked `<style>`. A new
// chart type, or a new render that draws a legend, fails here until it is
// wired. A legend drawn without `data-legend-entry` is invisible to this test.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHART_TYPE_REGISTRY } from '../src/chart-type-registry';
import { loadMapData } from '../src/map/load-data';
import { render } from '../src/render';

const FIXTURES_DIR = join(__dirname, '..', 'gallery', 'fixtures');

/** Chart types with no gallery fixture, and why one cannot exist. */
const NO_FIXTURE: Record<string, string> = {
  'live-link':
    'a reference to a shared diagram; what it draws is the diagram it points at',
};

/**
 * The chart types that take a `tag` block — "Diagram types that support
 * tags" in docs/language-reference.md §1.3. Each must be rendered here with
 * tags, by a fixture or by `TAGGED_SOURCES`.
 */
const TAG_CAPABLE = [
  'sequence',
  'infra',
  'org',
  'c4',
  'er',
  'kanban',
  'gantt',
  'sitemap',
  'timeline',
  'boxes-and-lines',
  'state',
  'pert',
  'swimlane',
  'mindmap',
  'journey-map',
  'event-line',
  'treemap',
  'map',
  'block',
  'sketch',
  'bracket',
  'family',
];

/** Tagged sources for the tag-capable chart types no gallery fixture tags. */
const TAGGED_SOURCES: Record<string, string> = {
  'tagged:pert': [
    'pert Refit',
    'time-unit d',
    '',
    'tag Crew as c',
    '  Gunners blue',
    '  Riggers green',
    '',
    'kickoff 0 c: Gunners',
    '  -> scrape hull',
    '',
    'scrape hull 1 2 3 c: Riggers',
  ].join('\n'),
  'tagged:er': [
    'er Fleet',
    '',
    'tag Status as s',
    '  Active green',
    '  Retired gray',
    '',
    'ships s: Active',
    '  id int pk',
    '  1-carries-* cannons',
    '',
    'cannons s: Retired',
    '  id int pk',
  ].join('\n'),
  'tagged:journey-map': [
    'journey-map Boarding',
    '',
    'tag Crew as c',
    '  Gunners blue',
    '  Riggers green',
    '',
    '[Dock]',
    '  Climbs the gangway score: 3, c: Gunners',
    '  Stows the kit score: 4, c: Riggers',
  ].join('\n'),
  'tagged:bracket': [
    'bracket Regatta',
    '',
    'tag Region as r',
    '  East blue',
    '  West green',
    '',
    'seed 1 One r: East',
    'seed 2 Two r: West',
    'One beats Two',
  ].join('\n'),
};

/**
 * Renders that draw a legend whose entries pair with nothing on the marks yet.
 * Each is work still owed by diagrammo/diagrammo#1215 — never a place to park a
 * new chart. Remove an entry the moment its render bakes a legend rule; the
 * test below fails until you do.
 */
const LEGEND_HOVER_PENDING: Record<string, string> = {
  'class-full.dgmo':
    'class — the legend names class kinds, the `.cd-class` marks carry no matching attr',
  'er.dgmo':
    'er — the legend names table roles, the `.er-table` marks carry no matching attr',
  'kanban.dgmo':
    'kanban — the tags sit on `.kanban-card`, inside the `.kanban-column` marks its structural row keys on',
  'family.dgmo': 'family — no registry row; the tags sit on `.family-card`',
  'function.dgmo':
    'function — a self-only row; the legend names curves, the `.dgmo-datum` paths carry no matching attr',
  'body.dgmo':
    'body — the legend names effort tags, the `.dgmo-body-part` marks carry no `data-tag-effort`',
  'treemap-branch.dgmo':
    'treemap — a branch legend, the cells carry no `data-tag-branch`',
  'map-categorical.dgmo':
    'map — no `legend` on its row; it carries two tag kinds on different marks',
  'map-categorical-world.dgmo':
    'map — no `legend` on its row; it carries two tag kinds on different marks',
  'map-tagged-legs.dgmo':
    'map — no `legend` on its row; it carries two tag kinds on different marks',
  'tagged:journey-map':
    'journey-map — no `legend` on its row, which keys `.journey-face` on `data-score`',
  'tagged:bracket': 'bracket — no registry row at all',
};

function fixtures(): string[] {
  return (readdirSync(FIXTURES_DIR, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.dgmo'))
    .sort();
}

const SOURCES: Record<string, string> = {
  ...Object.fromEntries(
    fixtures().map((rel) => [
      rel,
      readFileSync(join(FIXTURES_DIR, rel), 'utf8'),
    ])
  ),
  ...TAGGED_SOURCES,
};
const NAMES = Object.keys(SOURCES);

const LEGEND_ENTRY = /data-legend-entry="/;
const LEGEND_RULE = /svg:has\(\[data-legend-entry="/;
const TAG_BLOCK = /^tag\s/m;

interface Rendered {
  chartType: string | undefined;
  legend: boolean;
  rule: boolean;
}
const RENDERED = new Map<string, Rendered>();

describe('legend hover coverage (#1215)', () => {
  beforeAll(async () => {
    for (const name of NAMES) {
      const { svg, chartType } = await render(SOURCES[name]!, {
        mapData: loadMapData,
      });
      const style = svg.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
      RENDERED.set(name, {
        chartType,
        legend: LEGEND_ENTRY.test(svg),
        rule: LEGEND_RULE.test(style),
      });
    }
  }, 180_000);

  it('every registered chart type has a gallery fixture', () => {
    const covered = new Set(
      fixtures().map((rel) => RENDERED.get(rel)!.chartType)
    );
    const missing = CHART_TYPE_REGISTRY.map((d) => d.id).filter(
      (id) => !covered.has(id) && !(id in NO_FIXTURE)
    );
    expect(missing).toEqual([]);
  });

  it('every chart type that takes tags is rendered with a tag block', () => {
    const tagged = new Set(
      NAMES.filter((n) => TAG_BLOCK.test(SOURCES[n]!)).map(
        (n) => RENDERED.get(n)!.chartType
      )
    );
    expect(TAG_CAPABLE.filter((t) => !tagged.has(t))).toEqual([]);
  });

  it('every tagged source draws its tag legend', () => {
    expect(
      Object.keys(TAGGED_SOURCES).filter((n) => !RENDERED.get(n)!.legend)
    ).toEqual([]);
  });

  it('every pending entry names a render that exists', () => {
    expect(
      Object.keys(LEGEND_HOVER_PENDING).filter((n) => !(n in SOURCES))
    ).toEqual([]);
  });

  it.each(NAMES)('%s: a drawn legend bakes a legend hover rule', (name) => {
    const { chartType, legend, rule } = RENDERED.get(name)!;
    const pending = LEGEND_HOVER_PENDING[name];
    if (!legend) {
      expect(
        pending,
        `${name} draws no legend — remove it from LEGEND_HOVER_PENDING`
      ).toBeUndefined();
      return;
    }
    if (pending) {
      expect(
        rule,
        `${name} now bakes a legend rule — remove it from LEGEND_HOVER_PENDING`
      ).toBe(false);
      return;
    }
    expect(
      rule,
      `${name} (${chartType}) draws a legend but bakes no legend hover rule — give its HOVER_SPECS row \`legend: true\` and a mark attr to pair on`
    ).toBe(true);
  });
});
