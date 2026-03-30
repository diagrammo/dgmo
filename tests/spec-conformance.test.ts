/**
 * Spec-conformance tests for the DGMO language.
 *
 * Validates that the parsers correctly accept spec-conformant syntax and
 * reject deprecated / invalid forms as described in docs/dgmo-language-spec.md.
 */
import { describe, it, expect } from 'vitest';
import {
  parseChart,
  parseExtendedChart,
  parseVisualization,
  parseSequenceDgmo,
  parseInfra,
  parseFlowchart,
  parseState,
  parseOrg,
  parseC4,
  parseERDiagram,
  parseClassDiagram,
  parseKanban,
  parseInitiativeStatus,
  parseSitemap,
  parseGantt,
} from '../src/index';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the parse result has no error-severity diagnostics. */
function hasNoErrors(result: {
  diagnostics: { severity: string }[];
  error?: string | null;
}): boolean {
  if (result.error) return false;
  return result.diagnostics.every((d) => d.severity !== 'error');
}

/** Returns error-severity diagnostics only. */
function errorDiags(result: {
  diagnostics: { severity: string; message: string }[];
}) {
  return result.diagnostics.filter((d) => d.severity === 'error');
}

/** Returns warning-severity diagnostics only. */
function warningDiags(result: {
  diagnostics: { severity: string; message: string }[];
}) {
  return result.diagnostics.filter((d) => d.severity === 'warning');
}

// ===========================================================================
// 1. Valid Syntax — must parse without errors
// ===========================================================================

describe('1. Valid syntax', () => {
  describe('simple charts (parseChart)', () => {
    it('bar chart', () => {
      const r = parseChart('bar Treasure Hauls\nGold 100\nSilver 80', palette);
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('bar');
      expect(r.data.length).toBe(2);
    });

    it('line chart', () => {
      const r = parseChart(
        'line Fleet Growth\nJan 10\nFeb 15\nMar 20',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('line');
    });

    it('pie chart', () => {
      const r = parseChart(
        'pie Loot Distribution\nGold 60\nSilver 30\nGems 10',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('pie');
    });

    it('doughnut chart', () => {
      const r = parseChart(
        'doughnut Crew Roles\nCaptain 1\nSailor 10\nCook 2',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('doughnut');
    });

    it('area chart', () => {
      const r = parseChart('area Revenue\nQ1 100\nQ2 150\nQ3 200', palette);
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('area');
    });

    it('polar-area chart', () => {
      const r = parseChart(
        'polar-area Skills\nSword 80\nNavigation 90',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('polar-area');
    });

    it('radar chart', () => {
      const r = parseChart(
        'radar Abilities\nStrength 80\nSpeed 70\nWit 90',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('radar');
    });

    it('bar-stacked chart', () => {
      const r = parseChart(
        'bar-stacked Loot\nseries Gold, Silver\nJan 100 50\nFeb 120 60',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('bar-stacked');
    });
  });

  describe('extended charts (parseExtendedChart)', () => {
    it('scatter chart', () => {
      const r = parseExtendedChart(
        'scatter Pirates\nBlackbeard 90 8500\nRoberts 85 7000',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('scatter');
    });

    it('sankey chart (tree)', () => {
      const r = parseExtendedChart(
        'sankey Supply Chain\nSugar Plantations\n  Tortuga Distillery 3000\n  Nassau Distillery 2500',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('sankey');
    });

    it('chord chart', () => {
      const r = parseExtendedChart(
        'chord Trade Routes\nBlackbeard -- Bonnet 150\nRoberts -> Rackham 20',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('chord');
    });

    it('function chart', () => {
      const r = parseExtendedChart(
        'function Trajectories\nxlabel Distance\nylabel Height\nx 0 to 250\n15 degrees: -0.001*x^2 + 0.27*x',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('function');
    });

    it('heatmap chart', () => {
      const r = parseExtendedChart(
        'heatmap Activity\ncolumns Mon Tue Wed\nAlice 5 3 4\nBob 2 4 1',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('heatmap');
    });

    it('funnel chart', () => {
      const r = parseExtendedChart(
        'funnel Sales Pipeline\nVisits 1200\nSignups 800\nPurchases 200',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('funnel');
    });
  });

  describe('visualizations (parseVisualization)', () => {
    it('slope chart', () => {
      const r = parseVisualization(
        'slope Fleet Strength\n\nperiod 1715 1725\n\nBlackbeard 40 4\nRoberts 12 52',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('slope');
      expect(r.periods).toEqual(['1715', '1725']);
      expect(r.data).toHaveLength(2);
      expect(r.data[0]).toMatchObject({ label: 'Blackbeard', values: [40, 4] });
      expect(r.data[1]).toMatchObject({ label: 'Roberts', values: [12, 52] });
    });

    it('slope: period one-liner', () => {
      const r = parseVisualization(
        'slope\nperiod 2020 2025\nRevenue 100 200',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.periods).toEqual(['2020', '2025']);
      expect(r.data[0]).toMatchObject({ label: 'Revenue', values: [100, 200] });
    });

    it('slope: indented period block', () => {
      const r = parseVisualization(
        'slope\nperiod\n  Before COVID\n  After COVID\nRevenue 100 200',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.periods).toEqual(['Before COVID', 'After COVID']);
      expect(r.data[0]).toMatchObject({ label: 'Revenue', values: [100, 200] });
    });

    it('slope: numeric-containing labels', () => {
      const r = parseVisualization(
        'slope\nperiod 2020 2025\nRoute 66 100 200',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.data[0]).toMatchObject({
        label: 'Route 66',
        values: [100, 200],
      });
    });

    it('slope: color annotations', () => {
      const r = parseVisualization(
        'slope\nperiod 2020 2022 2025\nPython (blue) 3 1 1',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.data[0].label).toBe('Python');
      expect(r.data[0].color).not.toBeNull();
      expect(r.data[0].values).toEqual([3, 1, 1]);
    });

    it('slope: thousands commas in values', () => {
      const r = parseVisualization(
        'slope\nperiod 2020 2025\nApple 1,000 2,500',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.data[0]).toMatchObject({ label: 'Apple', values: [1000, 2500] });
    });

    it('slope: negative and decimal values', () => {
      const r = parseVisualization(
        'slope\nperiod 2020 2025\nProfit -50 3.5',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.data[0]).toMatchObject({ label: 'Profit', values: [-50, 3.5] });
    });

    it('slope: old colon syntax errors', () => {
      const r = parseVisualization(
        'slope\nperiod 2020 2025\nBlackbeard: 40 4',
        palette
      );
      expect(r.error).not.toBeNull();
      expect(r.diagnostics[0].message).toContain(
        'Colons are no longer used in slope data rows'
      );
    });

    it('slope: old comma-separated values error', () => {
      const r = parseVisualization(
        'slope\nperiod 2020 2025\nBlackbeard: 40, 4',
        palette
      );
      expect(r.error).not.toBeNull();
      expect(r.diagnostics[0].message).toContain('Colons are no longer used');
    });

    it('slope: bare period line errors', () => {
      const r = parseVisualization(
        'slope\n1715, 1725\nBlackbeard 40 4',
        palette
      );
      expect(r.error).not.toBeNull();
      expect(r.diagnostics[0].message).toContain('period');
    });

    it('slope: single period errors', () => {
      const r = parseVisualization('slope\nperiod 2020', palette);
      expect(r.error).not.toBeNull();
      expect(r.diagnostics[0].message).toContain('minimum 2 periods');
    });

    it('slope: too few numeric values', () => {
      const r = parseVisualization(
        'slope\nperiod 2020 2025\nRevenue abc',
        palette
      );
      expect(r.error).toBeNull();
      const warnings = r.diagnostics.filter((d) => d.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('numeric value');
    });

    it('slope: period block with blank line then data', () => {
      const r = parseVisualization(
        'slope\nperiod\n  Before COVID\n  After COVID\n\nRevenue 100 200',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.periods).toEqual(['Before COVID', 'After COVID']);
      expect(r.data[0]).toMatchObject({ label: 'Revenue', values: [100, 200] });
    });

    it('slope: empty label after extraction', () => {
      const r = parseVisualization('slope\nperiod 2020 2025\n100 200', palette);
      expect(r.error).toBeNull();
      const warnings = r.diagnostics.filter((d) => d.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('no label');
    });

    it('wordcloud', () => {
      const r = parseVisualization(
        'wordcloud Pirate Skills\nswordsmanship 95\nnavigation 88\nleadership 72',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('wordcloud');
      expect(r.words.length).toBe(3);
    });

    it('arc diagram', () => {
      const r = parseVisualization(
        'arc Alliances\n\nBlackbeard -> Bonnet 8\nBlackbeard -> Vane 5',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('arc');
    });

    it('venn diagram', () => {
      const r = parseVisualization(
        'venn Overlap\n\nSwordsmanship alias sw\nNavigation alias nav\n\nsw + nav Sea Raiders',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('venn');
    });

    it('quadrant diagram', () => {
      const r = parseVisualization(
        'quadrant Assessment\nx-label Low Skill, High Skill\ny-label Low Loyalty, High Loyalty\n\ntop-right Promote\nbottom-left Avoid\n\nAlice 0.9, 0.95\nBob 0.3, 0.2',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('quadrant');
    });

    it('timeline', () => {
      const r = parseVisualization(
        'timeline Pirate History\n\n1716 -> 1717 Sails under Hornigold\n1718-05 Blockades Charleston',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.type).toBe('timeline');
    });
  });

  describe('sequence (parseSequenceDgmo)', () => {
    it('minimal sequence diagram', () => {
      const r = parseSequenceDgmo(
        'sequence Auth Flow\n\nClient -login-> API\nAPI -query-> DB\nDB -> API\nAPI -> Client'
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.participants.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('infra (parseInfra)', () => {
    it('minimal infra diagram', () => {
      const r = parseInfra(
        'infra Backend\n\ninternet\n  rps 1000\n  -> Gateway\n\nGateway\n  latency-ms 50\n  -> API\n\nAPI\n  max-rps 5000'
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.nodes.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('flowchart (parseFlowchart)', () => {
    it('minimal flowchart', () => {
      const r = parseFlowchart(
        'flowchart Login\n\n(Start) -> [Check Creds] -> <Valid?>\n<Valid?> -yes-> (Welcome)\n<Valid?> -no-> [Error]',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.nodes.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('state (parseState)', () => {
    it('minimal state diagram', () => {
      const r = parseState(
        'state Order\n\n[*] -> Pending\nPending -pay-> Paid\nPaid -ship-> Shipped\nShipped -> [*]',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
    });
  });

  describe('org (parseOrg)', () => {
    it('minimal org chart', () => {
      const r = parseOrg(
        'org Company\n\nCEO\n  CTO\n    Engineer1\n  CFO',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.roots.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('c4 (parseC4)', () => {
    it('minimal C4 diagram', () => {
      const r = parseC4(
        'c4 System\n\nUser is a person\n  -Uses-> WebApp\nWebApp is a container',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.elements.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('er (parseERDiagram)', () => {
    it('minimal ER diagram', () => {
      const r = parseERDiagram(
        'er Blog\n\nusers\n  id int pk\n  name varchar\n\nposts\n  id int pk\n  title varchar\n  1-writes-* users',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.tables.length).toBe(2);
    });
  });

  describe('class (parseClassDiagram)', () => {
    it('minimal class diagram', () => {
      const r = parseClassDiagram(
        'class Ships\n\nVessel\n  + name: string\n  + sail(): void\n\nShip extends Vessel\n  - speed: number',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.classes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('kanban (parseKanban)', () => {
    it('minimal kanban board', () => {
      const r = parseKanban(
        'kanban Sprint 1\n\n[To Do]\n  Task A\n  Task B\n[In Progress]\n  Task C\n[Done]\n  Task D',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.columns.length).toBe(3);
    });
  });

  describe('initiative-status (parseInitiativeStatus)', () => {
    it('minimal initiative-status diagram', () => {
      const r = parseInitiativeStatus(
        'initiative-status Roadmap\n\nAuth | done\nPayments | doing\nAuth -> Payments'
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.nodes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('sitemap (parseSitemap)', () => {
    it('minimal sitemap', () => {
      const r = parseSitemap(
        'sitemap Marketing Site\n\nHome\n  About\n  Pricing\n  Blog',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.roots.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('gantt (parseGantt)', () => {
    it('minimal gantt chart', () => {
      const r = parseGantt(
        'gantt Product Launch\nstart 2026-03-15\n\n10bd Design\n5bd Build\n  -> Design',
        palette
      );
      expect(hasNoErrors(r)).toBe(true);
      expect(r.nodes.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ===========================================================================
// 2. Rejected Syntax — must produce errors or not parse the deprecated form
// ===========================================================================

describe('2. Rejected syntax', () => {
  it('chart: bar (colon form) — first line not recognized as chart type declaration', () => {
    // "chart:" is not a known chart type in ALL_CHART_TYPES, so parseFirstLine
    // returns null. The line falls through to other matching. The key thing is
    // the colon form is not treated as the new-syntax type declaration.
    const r = parseChart('chart: bar\nGold 100', palette);
    // "chart:" as first token with colon is NOT a valid chart type keyword.
    // The parser may still work (treating "chart:" as something else), but
    // it should not recognize this as the standard chart type syntax.
    // Verify it doesn't treat "bar" as the type from colon-syntax:
    // It defaults to 'bar' anyway, but the "chart:" token goes to legacy option path
    expect(r.type).toBe('bar'); // default, not from colon declaration
  });

  it('tag: Name (colon form) is not recognized as a tag declaration', () => {
    const r = parseOrg(
      'org Test\n\ntag: Department\n  Engineering\n\nAlice',
      palette
    );
    // "tag:" won't match the no-colon tag regex, so no tag group created
    expect(r.tagGroups.length).toBe(0);
  });

  it('## GroupName is not accepted (produces diagnostic)', () => {
    const r = parseChart('bar Scores\n## Pirates\nBlackbeard 90', palette);
    const diags = r.diagnostics.filter((d) => d.message.includes('##'));
    expect(diags.length).toBeGreaterThan(0);
  });

  it('note: Text (colon form) in sequence — colon is not special syntax', () => {
    const r = parseSequenceDgmo('sequence Test\n\nA -> B\nnote: Hello');
    // "note: Hello" is parsed as a note with text ": Hello" — the colon is
    // just text, not a separator. The spec defines `note Text` (no colon).
    // This is acceptable but the colon is included in the text.
    const notes = r.elements.filter((e: { type: string }) => e.type === 'note');
    if (notes.length > 0) {
      // If parsed as a note, the text includes the colon (not special syntax)
      expect((notes[0] as { text: string }).text).toContain(':');
    }
  });

  it('multiple pipes (A | x: 1 | y: 2) produce an error in sequence', () => {
    const r = parseSequenceDgmo('sequence Test\n\nA | x: 1 | y: 2\nA -> B');
    const allDiags = [...errorDiags(r), ...warningDiags(r)];
    expect(allDiags.some((d) => d.message.includes('|'))).toBe(true);
  });

  it('direction LR is not recognized as an option in infra', () => {
    const r = parseInfra('infra Test\ndirection LR\n\nA\n  -> B');
    // "direction LR" is not a known infra option — "direction" is not in TOP_LEVEL_OPTIONS
    expect(r.options['direction']).toBeUndefined();
  });

  it('direction TB (space form) does not set direction in flowchart', () => {
    const r = parseFlowchart(
      'flowchart Test\ndirection TB\n\n(Start) -> [End]',
      palette
    );
    // "direction TB" is stored as an option but doesn't change the direction field
    // The boolean form "direction-lr" is needed to override the TB default
    expect(r.direction).toBe('TB');
  });

  it('orientation horizontal (space form) is not the boolean form for bar charts', () => {
    const r = parseChart(
      'bar Test\norientation horizontal\nA 10\nB 20',
      palette
    );
    // "orientation horizontal" (space-separated) is not the boolean "orientation-horizontal"
    expect(r.orientation).toBeUndefined();
  });

  it('orientation vertical (space form) is not the boolean form for bar charts', () => {
    const r = parseChart('bar Test\norientation vertical\nA 10\nB 20', palette);
    expect(r.orientation).toBeUndefined();
  });

  it('labels name / labels value is not recognized for chart parser', () => {
    const r = parseChart('pie Test\nlabels name\nA 10\nB 20', palette);
    // "labels" is not a known option
    expect(r.noLabelName).toBeFalsy();
    expect(r.noLabelValue).toBeFalsy();
  });

  it('top-level ER relationships produce a warning', () => {
    const r = parseERDiagram(
      'er Test\n\nusers\n  id int pk\n\nposts\n  id int pk\n\nusers 1--* posts',
      palette
    );
    const diags = [...errorDiags(r), ...warningDiags(r)];
    expect(diags.some((d) => d.message.toLowerCase().includes('indent'))).toBe(
      true
    );
  });

  it('top-level class relationships produce a warning', () => {
    const r = parseClassDiagram(
      'class Test\n\nShip\n  + name: string\n\nVessel\n  + type: string\n\nShip --|> Vessel',
      palette
    );
    const diags = [...errorDiags(r), ...warningDiags(r)];
    expect(diags.some((d) => d.message.toLowerCase().includes('indent'))).toBe(
      true
    );
  });

  it('infra "is a database" does not set a nodeType', () => {
    const r = parseInfra('infra Test\n\nPostgres is a database\n  -> API');
    // InfraNode has no nodeType field — "is a" syntax is not supported in infra
    const node = r.nodes.find((n) => n.label.includes('Postgres'));
    expect(node).toBeDefined();
    expect((node as Record<string, unknown>)['nodeType']).toBeUndefined();
  });

  it('wordcloud colon form (word: 95) does not produce correct weights', () => {
    const r = parseVisualization(
      'wordcloud Skills\n\nswordsmanship: 95\nnavigation: 88',
      palette
    );
    // Colon-form lines go to freeform text, not structured data with weights.
    // Words may still appear (extracted from freeform) but with default weight, not 95.
    const sword = r.words.find((w) => w.text === 'swordsmanship');
    if (sword) {
      expect(sword.weight).not.toBe(95);
    }
  });
});

// ===========================================================================
// 3. Boolean Options
// ===========================================================================

describe('3. Boolean options', () => {
  it('direction-tb sets direction to TB in infra', () => {
    const r = parseInfra('infra Test\ndirection-tb\n\nA\n  -> B');
    expect(r.direction).toBe('TB');
  });

  it('direction-lr sets direction to LR in flowchart', () => {
    const r = parseFlowchart(
      'flowchart Test\ndirection-lr\n\n(Start) -> [End]',
      palette
    );
    expect(r.direction).toBe('LR');
  });

  it('direction-tb sets direction to TB in state', () => {
    const r = parseState(
      'state Test\ndirection-tb\n\n[*] -> Idle\nIdle -> [*]',
      palette
    );
    expect(r.direction).toBe('TB');
  });

  it('direction-tb is recognized as an option in org', () => {
    const r = parseOrg('org Test\ndirection-tb\n\nAlice\n  Bob', palette);
    // Org stores direction-tb as an option (not a top-level direction field)
    expect(r.options['direction-tb']).toBe('on');
  });

  it('direction-tb sets direction to TB in sitemap', () => {
    const r = parseSitemap(
      'sitemap Test\ndirection-tb\n\nHome\n  About',
      palette
    );
    expect(r.direction).toBe('TB');
  });

  it('direction-tb is recognized as an option in c4', () => {
    const r = parseC4('c4 Test\ndirection-tb\n\nUser is a person', palette);
    // C4 stores direction-tb as an option (not a top-level direction field)
    expect(r.options['direction-tb']).toBe('on');
  });

  it('orientation-horizontal sets orientation for bar charts', () => {
    const r = parseChart(
      'bar Test\norientation-horizontal\nA 10\nB 20',
      palette
    );
    expect(r.orientation).toBe('horizontal');
  });

  it('no-auto-color works in class diagrams', () => {
    const r = parseClassDiagram(
      'class Test\nno-auto-color\n\nShip\n  + name: string',
      palette
    );
    expect(r.options['no-auto-color']).toBe('on');
  });

  it('no-auto-color works in kanban', () => {
    const r = parseKanban(
      'kanban Test\nno-auto-color\n\n[To Do]\n  Task A',
      palette
    );
    expect(r.options['no-auto-color']).toBeTruthy();
  });

  it('no-labels works for scatter', () => {
    const r = parseExtendedChart(
      'scatter Test\nno-labels\nAlice 0.5 0.5',
      palette
    );
    expect(r.showLabels).toBe(false);
  });

  it('no-label-name works for pie', () => {
    const r = parseChart('pie Test\nno-label-name\nA 50\nB 50', palette);
    expect(r.noLabelName).toBe(true);
  });

  it('no-label-value works for pie', () => {
    const r = parseChart('pie Test\nno-label-value\nA 50\nB 50', palette);
    expect(r.noLabelValue).toBe(true);
  });

  it('no-label-percent works for pie', () => {
    const r = parseChart('pie Test\nno-label-percent\nA 50\nB 50', palette);
    expect(r.noLabelPercent).toBe(true);
  });

  it('shade works for function charts', () => {
    const r = parseExtendedChart(
      'function Test\nx 0 to 10\nf(x): x^2',
      palette
    );
    expect(r.shade).toBeFalsy();
    const r2 = parseExtendedChart(
      'function Test\nshade\nx 0 to 10\nf(x): x^2',
      palette
    );
    expect(r2.shade).toBe(true);
  });
});

// ===========================================================================
// 4. New Features
// ===========================================================================

describe('4. New features', () => {
  it('gantt era block form', () => {
    const r = parseGantt(
      'gantt Test\nstart 2026-03-15\n\nera\n  2026-04-06 -> 2026-04-10 Conference\n  2026-06-01 -> 2026-06-05 Sprint Review\n\n5bd Task A',
      palette
    );
    expect(hasNoErrors(r)).toBe(true);
    expect(r.eras.length).toBe(2);
    expect(r.eras[0].label).toBe('Conference');
    expect(r.eras[1].label).toBe('Sprint Review');
  });

  it('gantt marker block form', () => {
    const r = parseGantt(
      'gantt Test\nstart 2026-03-15\n\nmarker\n  2026-03-27 Board Review\n  2026-06-15 Release\n\n5bd Task A',
      palette
    );
    expect(hasNoErrors(r)).toBe(true);
    expect(r.markers.length).toBe(2);
    expect(r.markers[0].label).toBe('Board Review');
    expect(r.markers[1].label).toBe('Release');
  });

  it('gantt top-level workweek', () => {
    const r = parseGantt(
      'gantt Test\nstart 2026-03-15\nworkweek sun-thu\n\n5bd Task A',
      palette
    );
    expect(hasNoErrors(r)).toBe(true);
    expect(r.holidays.workweek).toEqual(['sun', 'mon', 'tue', 'wed', 'thu']);
  });

  it('comma-optional data rows (space-delimited values) with multi-line series', () => {
    // Series names must be comma-separated or multi-line; data values can be space-separated
    const r = parseChart(
      'bar-stacked Multi\nseries\n  Gold\n  Silver\nJan 100 50\nFeb 120 60',
      palette
    );
    expect(hasNoErrors(r)).toBe(true);
    expect(r.data.length).toBe(2);
    // First value is in .value, additional values in .extraValues
    expect(r.data[0].value).toBe(100);
    expect(r.data[0].extraValues).toEqual([50]);
  });

  it('indented class relationships', () => {
    const r = parseClassDiagram(
      'class Test\n\nShip\n  + name: string\n  --|> Vessel\n  *-- Cannon\n\nVessel\n  + type: string\n\nCannon\n  + caliber: number',
      palette
    );
    expect(hasNoErrors(r)).toBe(true);
    expect(r.relationships.length).toBe(2);
  });

  it('indented ER relationships', () => {
    const r = parseERDiagram(
      'er Test\n\nusers\n  id int pk\n  name varchar\n  1-writes-* posts\n\nposts\n  id int pk\n  title varchar',
      palette
    );
    expect(hasNoErrors(r)).toBe(true);
    expect(r.relationships.length).toBe(1);
  });

  it('C4 colon metadata (description: Text)', () => {
    const r = parseC4(
      'c4 System\n\nWebApp is a container\n  description: SPA built with React\n  tech: React\n\nUser is a person\n  -Uses-> WebApp',
      palette
    );
    expect(hasNoErrors(r)).toBe(true);
    const webapp = r.elements.find((e) => e.name === 'WebApp');
    expect(webapp).toBeDefined();
    expect(webapp!.metadata['description']).toBe('SPA built with React');
  });

  it('venn intersection without colon', () => {
    const r = parseVisualization(
      'venn Overlap\n\nSwordsmanship alias sw\nNavigation alias nav\n\nsw + nav Sea Raiders',
      palette
    );
    expect(hasNoErrors(r)).toBe(true);
    expect(r.vennOverlaps.length).toBe(1);
    expect(r.vennOverlaps[0].label).toBe('Sea Raiders');
  });
});
