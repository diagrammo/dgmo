// Every chart that draws a legend must bake a legend hover rule into its
// embed SVG (diagrammo/diagrammo#1215). An embed (remark-dgmo, Obsidian, the
// CLI) gets its hover from the CSS `injectHoverStyles` bakes, so a legend whose
// chart has no `legend` rule in `HOVER_SPECS` does nothing on hover — and reads
// as broken next to one that works.
//
// The gallery fixtures are the enumeration: every chart type in the registry
// must have one, and every fixture that draws a `data-legend-entry` must come
// back with a `[data-legend-entry=…]` rule in its baked `<style>`. A new chart
// type, or a new fixture that draws a legend, fails here until it is wired.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHART_TYPE_REGISTRY } from '../src/chart-type-registry';
import { render } from '../src/render';

const FIXTURES_DIR = join(__dirname, '..', 'gallery', 'fixtures');

/** Chart types with no gallery fixture, and why one cannot exist. */
const NO_FIXTURE: Record<string, string> = {
  'live-link':
    'a reference to a shared diagram; what it draws is the diagram it points at',
};

/**
 * Fixtures that draw a legend whose entries pair with nothing on the marks yet.
 * Each is work still owed by diagrammo/diagrammo#1215 — never a place to park a
 * new chart. Remove an entry the moment its fixture bakes a legend rule; the
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
};

function fixtures(): string[] {
  return (readdirSync(FIXTURES_DIR, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.dgmo'))
    .sort();
}

const LEGEND_ENTRY = /data-legend-entry="/;
const LEGEND_RULE = /svg:has\(\[data-legend-entry="/;

async function renderFixture(rel: string) {
  const src = readFileSync(join(FIXTURES_DIR, rel), 'utf8');
  const { svg, chartType } = await render(src);
  const style = svg.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  return { svg, chartType, style };
}

describe('legend hover coverage (#1215)', () => {
  const all = fixtures();

  it('every registered chart type has a gallery fixture', async () => {
    const covered = new Set<string>();
    for (const rel of all) {
      const { chartType } = await renderFixture(rel);
      if (chartType) covered.add(chartType);
    }
    const missing = CHART_TYPE_REGISTRY.map((d) => d.id).filter(
      (id) => !covered.has(id) && !(id in NO_FIXTURE)
    );
    expect(missing).toEqual([]);
  }, 120_000);

  it('every pending entry names a fixture that exists', () => {
    const missing = Object.keys(LEGEND_HOVER_PENDING).filter(
      (rel) => !all.includes(rel)
    );
    expect(missing).toEqual([]);
  });

  it.each(all)('%s: a drawn legend bakes a legend hover rule', async (rel) => {
    const { svg, chartType, style } = await renderFixture(rel);
    if (!LEGEND_ENTRY.test(svg)) {
      expect(
        LEGEND_HOVER_PENDING[rel],
        `${rel} draws no legend — remove it from LEGEND_HOVER_PENDING`
      ).toBeUndefined();
      return;
    }
    const pending = LEGEND_HOVER_PENDING[rel];
    if (pending) {
      expect(
        LEGEND_RULE.test(style),
        `${rel} now bakes a legend rule — remove it from LEGEND_HOVER_PENDING`
      ).toBe(false);
      return;
    }
    expect(
      LEGEND_RULE.test(style),
      `${rel} (${chartType}) draws a legend but bakes no legend hover rule — give its HOVER_SPECS row \`legend: true\` and a mark attr to pair on`
    ).toBe(true);
  });
});
