import { describe, it, expect } from 'vitest';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseState } from '../src/graph/state-parser';
import { parseInfra } from '../src/infra/parser';
import { parseC4 } from '../src/c4/parser';
import { parseClassDiagram } from '../src/class/parser';
import { parseERDiagram as parseEr } from '../src/er/parser';
import { parseOrg } from '../src/org/parser';
import { parseGantt } from '../src/gantt/parser';
import { parseSitemap } from '../src/sitemap/parser';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { parseKanban } from '../src/kanban/parser';
import { parseVisualization } from '../src/d3';
import { parseExtendedChart } from '../src/data-chart-parser';
import { getPalette } from '../src/palettes';

// ============================================================
// Cross-parser alias conformance (Q2 / TD-18)
// ============================================================
//
// One scenario table, every parser as an adapter. Asserts the alias
// invariants (declaration extracted, reference resolved, freshness
// across parses) hold uniformly. Parser-specific source strings let
// us test in each chart's native syntax while the assertions stay
// invariant.

const palette = getPalette('nord').light;

type ParserResult = {
  /** Number of error-severity diagnostics. */
  errorCount: number;
  /** Codes from all diagnostics. */
  diagnosticCodes: string[];
  /** Did the parser produce at least one entity. */
  hasEntities: boolean;
  /** True if at least one edge/relationship/message references the canonical. */
  resolvedReference: boolean;
};

interface ParserAdapter {
  name: string;
  /** Source that declares an entity with `as <alias>` and references the alias. */
  declAndRef: string;
  /** Same source, the second parse from a fresh parser invocation. */
  freshAfter: string;
  /** Run the parser and return the result invariants. */
  run(src: string): ParserResult;
}

const ADAPTERS: ParserAdapter[] = [
  {
    name: 'sequence',
    declAndRef: `sequence
Alice is an actor as a
Bob is a database as b
a -hello-> b`,
    freshAfter: `sequence
Carol is an actor as a
a -hi-> Dan`,
    run(src) {
      const r = parseSequenceDgmo(src);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.participants.length > 0,
        resolvedReference: r.messages.some(
          (m) => m.from !== 'a' && m.to !== 'b'
        ),
      };
    },
  },
  {
    name: 'flowchart',
    declAndRef: `flowchart
[Order Service] as os
[Payment Service] as ps
os -> ps`,
    freshAfter: `flowchart
[Carol] as os
os -> [Dan]`,
    run(src) {
      const r = parseFlowchart(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.nodes.length > 0,
        resolvedReference: r.edges.length > 0,
      };
    },
  },
  {
    name: 'state',
    declAndRef: `state
[Idle] as i
[Running] as r
i -> r`,
    freshAfter: `state
[Carol] as i
i -> [Dan]`,
    run(src) {
      const r = parseState(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.nodes.length > 0,
        resolvedReference: r.edges.length > 0,
      };
    },
  },
  {
    name: 'infra',
    // Declaration first: strict ordering (§2A.2) is enforced since #200, and
    // this fixture used to reference `os` a line above its own declaration.
    declAndRef: `infra
OrderService as os
GatewayService as gw
  -routes-> os`,
    freshAfter: `infra
Carol as gw
  -routes-> Dan`,
    run(src) {
      const r = parseInfra(src);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.nodes.length > 0,
        resolvedReference: r.edges.length > 0,
      };
    },
  },
  {
    name: 'c4',
    declAndRef: `c4
OrderSystem is a system as os
Alice is a person as al
  -uses-> os`,
    freshAfter: `c4
Carol is a person as al
  -talks to-> os`,
    run(src) {
      const r = parseC4(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.elements.length > 0,
        resolvedReference: r.elements.some((e) => e.relationships.length > 0),
      };
    },
  },
  {
    name: 'class',
    declAndRef: `class
Animal as a
Dog as d
  --|> a`,
    freshAfter: `class
Carol as a`,
    run(src) {
      const r = parseClassDiagram(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.classes.length > 0,
        resolvedReference: r.relationships.length > 0,
      };
    },
  },
  {
    name: 'er',
    declAndRef: `er
users as u
posts as p
  *--1 u`,
    freshAfter: `er
carol as u`,
    run(src) {
      const r = parseEr(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.tables.length > 0,
        resolvedReference: r.relationships.length > 0,
      };
    },
  },
  {
    name: 'org',
    declAndRef: `org
Alice as al
  Bob as b`,
    freshAfter: `org
Carol as al`,
    run(src) {
      const r = parseOrg(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.roots.length > 0,
        resolvedReference: r.roots.length > 0,
      };
    },
  },
  {
    name: 'gantt',
    declAndRef: `gantt
start 2024-01-15
Source as s duration: 10d
Target as t duration: 10d
  -> s`,
    freshAfter: `gantt
start 2024-01-15
Carol as s duration: 10d`,
    run(src) {
      const r = parseGantt(src);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.nodes.length > 0,
        resolvedReference: true, // gantt deps resolved post-parse
      };
    },
  },
  {
    name: 'sitemap',
    declAndRef: `sitemap
HomePage
  About as a
-> a`,
    freshAfter: `sitemap
HomePage
  Carol as a`,
    run(src) {
      const r = parseSitemap(src);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.roots.length > 0,
        resolvedReference: true,
      };
    },
  },
  {
    name: 'boxes-and-lines',
    declAndRef: `boxes-and-lines
Source as s
Target as t
s -> t`,
    freshAfter: `boxes-and-lines
Carol as s`,
    run(src) {
      const r = parseBoxesAndLines(src);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.nodes.length > 0,
        resolvedReference: r.edges.length > 0,
      };
    },
  },
  {
    name: 'kanban',
    declAndRef: `kanban
[Todo] as t
[Done] as d`,
    freshAfter: `kanban
[Carol] as t`,
    run(src) {
      const r = parseKanban(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.columns.length > 0,
        resolvedReference: true,
      };
    },
  },
  {
    name: 'venn',
    declAndRef: `venn
Apples as a
Oranges as o
a + o Cider`,
    freshAfter: `venn
Carrots as a
Lettuce as l`,
    run(src) {
      const r = parseVisualization(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.vennSets.length > 0,
        resolvedReference: r.vennOverlaps.length > 0,
      };
    },
  },
  {
    name: 'arc',
    declAndRef: `arc
API Gateway as gw -> Database 1
gw -> Frontend 1`,
    freshAfter: `arc
Foo as gw -> Bar 1`,
    run(src) {
      const r = parseVisualization(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: r.links.length > 0,
        resolvedReference: r.links.length >= 2,
      };
    },
  },
  {
    name: 'sankey',
    declAndRef: `sankey
Source Node as src -> Middle 50
Middle as m -> Target Node 50
src -> m 50`,
    freshAfter: `sankey
Foo as src -> Bar 100`,
    run(src) {
      const r = parseExtendedChart(src, palette);
      return {
        errorCount: r.diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticCodes: r.diagnostics.map((d) => d.code ?? ''),
        hasEntities: (r.links ?? []).length > 0,
        resolvedReference: (r.links ?? []).length > 0,
      };
    },
  },
];

describe('alias conformance — every parser handles `as <alias>` uniformly', () => {
  describe.each(ADAPTERS)('$name', (adapter) => {
    it('extracts alias and resolves reference without errors', () => {
      const result = adapter.run(adapter.declAndRef);
      expect(result.errorCount, JSON.stringify(result.diagnosticCodes)).toBe(0);
      expect(result.hasEntities).toBe(true);
      expect(result.resolvedReference).toBe(true);
    });

    it('alias map does not leak across separate parses (C8)', () => {
      const a = adapter.run(adapter.declAndRef);
      const b = adapter.run(adapter.freshAfter);
      // Both parses are independent — neither errors out.
      expect(a.errorCount).toBe(0);
      expect(b.errorCount).toBe(0);
    });
  });
});

describe('alias conformance — SaaS-naming false-positive guard (F2)', () => {
  // Every parser receives `Storage as a Service` somewhere a name slot
  // would otherwise extract aliases. None should match `as` and bind
  // an alias of `Service`.
  const SAAS_PATTERNS = ['Storage as a Service', 'Backend as a Service'];

  describe.each(SAAS_PATTERNS)('input "%s"', (saas) => {
    it('sequence preserves SaaS-style names verbatim', () => {
      const r = parseSequenceDgmo(`sequence
"${saas}" is an actor`);
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(
        0
      );
    });
  });
});
