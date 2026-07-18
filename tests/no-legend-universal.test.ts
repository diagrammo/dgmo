/**
 * Universal `no-legend` tests (spec §1.9, decision #48).
 *
 * Decision #48 makes `no-legend` cross-cutting: EVERY chart type that renders a
 * legend must suppress it when the bare directive is present, and the token must
 * parse without diagnostics everywhere. Before #48 it existed only on the seven
 * post-2026 types (treemap, map, event-line, block, sketch, body, bracket) while
 * data charts documented their legend as "always shown" and the legacy tag
 * charts offered no opt-out at all.
 *
 * These go through the public `render()` entry rather than per-chart
 * parse+layout+render triples, so they exercise the same path embeds and the
 * CLI take. `data-legend-group` is the marker emitted by both legend backends
 * (`legend-d3.ts` for the DOM charts, `legend-svg.ts` for the data charts).
 */
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

/** Count legend groups in a rendered SVG string. */
function legendGroupCount(svg: string): number {
  return svg.match(/data-legend-group=/g)?.length ?? 0;
}

/** Add the bare `no-legend` directive just after the chart-type header line. */
function withNoLegend(src: string): string {
  const lines = src.split('\n');
  return [lines[0], 'no-legend', ...lines.slice(1)].join('\n');
}

async function renderOk(src: string) {
  const { svg, diagnostics } = await render(src, { theme: 'light' });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  return { svg, diagnostics, errors };
}

/**
 * Charts that render a legend. Each source declares a tag group (or, for the
 * data charts, a multi-series block) so a legend is actually produced.
 */
const LEGEND_CHARTS: ReadonlyArray<{ type: string; src: string }> = [
  // ── Legacy tag charts (no opt-out before #48) ──────────────
  {
    type: 'kanban',
    src: `kanban

tag Priority
  High red
  Low green

[To Do]
  Fix bug priority: High
  Write tests priority: Low`,
  },
  {
    type: 'timeline',
    src: `timeline

tag Status
  Done green
  Active blue

2024-01-01 -> 2024-06-01: Feature A status: Done
2024-03-01 -> 2024-12-01: Feature B status: Active`,
  },
  {
    type: 'boxes-and-lines',
    src: `boxes-and-lines

tag Layer
  Edge blue
  Core green

Gateway layer: Edge
Service layer: Core
Gateway -> Service`,
  },
  {
    type: 'org',
    src: `org

tag Region
  North blue
  South green

CEO
  VP North region: North
  VP South region: South`,
  },
  {
    type: 'sequence',
    src: `sequence

tag Team
  Frontend blue
  Backend red

Alice is a actor team: Frontend
Bob is a actor team: Backend
Alice -request-> Bob`,
  },
  {
    type: 'er',
    src: `er

tag Domain
  Sales blue
  Ops green

users domain: Sales
  id int pk
orders domain: Ops
  id int pk
users -- orders`,
  },
  {
    type: 'sitemap',
    src: `sitemap

tag Access
  Public blue
  Private red

Home access: Public
  Admin access: Private`,
  },
  {
    type: 'class',
    src: `class

interface Shape
  +area(): number
Circle implements Shape
  +r: number`,
  },
  // ── State — legend added by decision #48 ───────────────────
  {
    type: 'state',
    src: `state

tag Phase
  Warm blue
  Cold green

Idle phase: Cold
Running phase: Warm
Idle -> Running`,
  },
  // ── Data charts — "always shown" special case removed ──────
  {
    // Bar declares multiple series with a `group`/`stack` header, not `series`.
    type: 'bar',
    src: `bar Revenue
group
  Q1 blue
  Q2 green

North 10 20
South 15 25`,
  },
  {
    type: 'line',
    src: `line Traffic
series
  Web blue
  App green

Jan 10 20
Feb 15 25`,
  },
  // ── Types that already supported it (regression guard) ─────
  {
    type: 'treemap',
    src: `treemap Spend

tag Unit
  Eng blue
  Ops green

Engineering 100 unit: Eng
Operations 50 unit: Ops`,
  },
  {
    type: 'block',
    src: `block Mesh

tag Status as s
  Healthy green
  Down red

[Services] s: Healthy
  [Auth] [Billing] s: Down`,
  },
];

describe('no-legend (universal, decision #48)', () => {
  for (const { type, src } of LEGEND_CHARTS) {
    describe(type, () => {
      it('renders a legend by default', async () => {
        const { svg, errors } = await renderOk(src);
        expect(errors).toEqual([]);
        expect(legendGroupCount(svg)).toBeGreaterThan(0);
      });

      it('suppresses the legend with `no-legend`', async () => {
        const { svg, errors } = await renderOk(withNoLegend(src));
        expect(errors).toEqual([]);
        expect(legendGroupCount(svg)).toBe(0);
      });

      it('parses `no-legend` without any diagnostic', async () => {
        const { diagnostics } = await renderOk(withNoLegend(src));
        const aboutLegend = diagnostics.filter((d) =>
          /legend/i.test(d.message)
        );
        expect(aboutLegend).toEqual([]);
      });

      it('collapses the height reserved for the legend band', async () => {
        const { svg: withLegend } = await renderOk(src);
        const { svg: without } = await renderOk(withNoLegend(src));
        const h = (s: string) => {
          const vb = s.match(/viewBox="[^"]*?\s([\d.]+)"/);
          return vb ? parseFloat(vb[1]) : null;
        };
        const a = h(withLegend);
        const b = h(without);
        // Suppressing must never make the diagram taller — charts that reserve
        // a band shrink, charts that overlay stay equal.
        if (a !== null && b !== null) expect(b).toBeLessThanOrEqual(a);
      });
    });
  }
});

describe('no-legend on charts that render no legend', () => {
  // The token is universal on the parse side (GLOBAL_BOOLEANS), so authors
  // never have to remember which types honour it. On a legend-less chart it is
  // a harmless no-op and must not raise a diagnostic.
  const NO_LEGEND_CHARTS: ReadonlyArray<{ type: string; src: string }> = [
    { type: 'pyramid', src: 'pyramid\n\nAwareness 100\nInterest 60' },
    {
      type: 'venn',
      src: 'venn\n\nAlpha as a blue\nBeta as b green\na + b 4',
    },
    {
      type: 'flowchart',
      src: 'flowchart\n\n(Start) -> [Process]\n[Process] -> (End)',
    },
  ];

  for (const { type, src } of NO_LEGEND_CHARTS) {
    it(`${type} accepts \`no-legend\` as a no-op`, async () => {
      const { svg, errors } = await renderOk(withNoLegend(src));
      expect(errors).toEqual([]);
      expect(legendGroupCount(svg)).toBe(0);
      expect(svg).toContain('<svg');
    });
  }
});
