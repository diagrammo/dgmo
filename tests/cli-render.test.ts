import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { renderDataChartD3 as renderExtendedChartForExport } from '../src/charts-d3';
import {
  getAllChartTypes,
  getRenderCategory,
  parseDgmoChartType,
} from '../src/dgmo-router';

// Set up jsdom globals for D3 tests
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

// ============================================================
// Minimal valid inputs for each chart type
// ============================================================

const D3_INPUTS: Record<string, string> = {
  map: `map US Sales
region-heat Sales

California heat: 92
Texas heat: 78
Florida heat: 51`,

  sequence: `sequence
A -hello-> B
B -world-> A`,

  slope: `slope
period Before After
Alpha 10 20
Beta 30 15`,

  wordcloud: `wordcloud
hello 100
world 80
test 60
data 40`,

  arc: `arc
A -> B 5
B -> C 3
C -> A 2`,

  timeline: `timeline
2020-01 Project Start
2020-06 Phase 1 Complete
2021-01 Launch`,

  'event-line': `event-line Milestones
2020-01 Kickoff
  Project begins.
2021-06 Launch
  Shipped to users.`,

  body: `body Push Day
muscle

tag Effort as e
  Primary red

chest  e: Primary
  Barbell bench press.
deltoids  e: Primary
triceps  e: Primary`,

  'version-control': `version-control Feature Workflow
main
  Initial commit
  Add README
develop from main
  Set up CI
main
  merge develop tag: v1.0.0`,

  venn: `venn
Apples
Oranges
Apples + Oranges Cider`,

  quadrant: `quadrant
x-label Effort
y-label Impact
High Impact, Low Effort 20, 80
Low Impact, High Effort 80, 20`,

  flowchart: `flowchart
(Start) -> [Process] -> <Check?>
  -yes-> (End)
  -no-> [Retry] -> (Start)`,

  class: `class
Animal
  name string
  speak(): void
Dog
  --|> Animal`,

  er: `er
users
  id int pk
  name varchar
  1-* posts
posts
  id int pk
  author_id int fk`,

  org: `org
Jane Smith
  role CEO
  Alex Chen
    role CTO`,

  family: `family
Alice + Bob m: 1980
  Carol sex: f
  Dave sex: m`,

  kanban: `kanban
[To Do]
  Task A
[Done]
  Task B`,

  c4: `c4
Customer is a person
Banking is a system
  -Serves-> Customer`,

  state: `state
[*] -> Idle
Idle -click-> Active
Active -> [*]`,

  sitemap: `sitemap Test Site
Home
  -go-> About
[Pages]
  About`,

  infra: `infra

edge
  rps: 1000
  -> API

API
  latency-ms: 10`,

  gantt: `gantt
start 2024-01-15
14d Research
7d Design
3d Testing
0d Ship`,

  pert: `pert Sample
time-unit w
A 1 2 3
B 1 2 3
C 1 2 3
A
  -> B
B
  -> C`,

  'boxes-and-lines': `boxes-and-lines System
API -> Database
API -> Cache`,

  swimlane: `swimlane Review
lane Author blue
lane Editor green
Author
  Draft
Editor
  <Check>
Draft -> <Check>`,

  mindmap: `mindmap Ideas
  Feature A
  Feature B`,

  wireframe: `wireframe Login Page
Button Submit`,

  'tech-radar': `tech-radar My Radar

rings
  Adopt
  Trial
  Assess
  Hold

Techniques | quadrant: top-right
  CD | ring: Adopt, trend: stable

Tools | quadrant: top-left
  Vite | ring: Trial, trend: new

Platforms | quadrant: bottom-left
  K8s | ring: Adopt

Languages | quadrant: bottom-right
  TypeScript | ring: Adopt`,

  cycle: `cycle PDCA
Plan | color: blue
Do | color: green
Check | color: orange
Act | color: red`,

  'journey-map': `journey-map Test Journey

[Phase One]
  Step A | 4
  Step B | 2

[Phase Two]
  Step C | 5`,

  pyramid: `pyramid Test Pyramid

Top | apex description
Middle | middle description
Bottom | base description`,

  ring: `ring Test Ring

Inner | core description
Middle | middle description
Outer | outermost description`,

  treemap: `treemap Test Treemap

Engineering
  Platform 320
  Mobile 180
Operations
  Cloud 110
  Support 70`,

  sketch: `sketch Test Sketch

tag Crew
  Deck

Spyglass Feed shape: cloud, at: 0 0, crew: Deck
  -sightings-> con
Captain Console as con at: 2 0
`,

  block: `block Test Block

tag Layer as l
  Edge blue
  Service green

[Clients] l: Edge
  [Web] [Mobile]

[Backend] l: Service
  [Auth] [Orders]`,

  goal: `goal Doubloons Recovered ($)

thermometer

now 6400
target 10000`,

  countdown: `countdown Voyage to Tortuga

target 2099-08-21
units days`,

  clock: `clock Crew watch
hours 9-17

America/New_York as First mate
America/Jamaica as Quartermaster`,

  bracket: `bracket Grog Cup

Black Pearl beats Sea Serpent 5-3
Salty Dog beats Kraken 4-2
Black Pearl beats Salty Dog 6-5`,

  raci: `raci Test RACI
roles Cap, QM, Bos

[Voyage]
  Set sail
    Cap: A
    QM: R
  Drop anchor
    Cap: A
    Bos: R`,

  rasci: `rasci Test RASCI
roles Cap, QM, Bos, Crew

[Voyage]
  Hoist sails
    Cap: A
    QM: R
    Crew: S
  Furl sails
    Bos: A
    Crew: R`,

  daci: `daci Test DACI
roles PM, Cap, QM

[Decisions]
  Choose route
    PM: D
    Cap: A
  Set provisions
    QM: D
    Cap: A`,

  'live-link': `live-link Kraken sighting log
url https://online.diagrammo.app/d/dgm_7f2a91`,
};

// All D3 types now render in JSDOM via explicit dimensions (Epic 41)
const D3_TYPES = [
  'sequence',
  'slope',
  'arc',
  'timeline',
  'venn',
  'quadrant',
  'flowchart',
  'org',
  'kanban',
  'c4',
  'state',
  'sitemap',
  'infra',
  'gantt',
  'pert',
  'journey-map',
  'pyramid',
  'ring',
  // Wordcloud renders headless via a canvas-free spiral packer (d3-cloud's
  // sprite-based collision needs a real 2D canvas, absent in JSDOM/Node).
  'wordcloud',
];

const ECHART_INPUTS: Record<string, string> = {
  scatter: `scatter
A 1 2
B 3 4
C 5 6`,

  sankey: `sankey
A -> B 10
B -> C 5
A -> C 3`,

  chord: `chord
A -> B 10
B -> C 5
C -> A 3`,

  function: `function
x -5 to 5
f(x): x^2`,

  heatmap: `heatmap
columns Mon, Tue, Wed
Morning 10 20 30
Afternoon 40 50 60`,

  funnel: `funnel
Visitors 1000
Signups 500
Paid 100`,

  // Chart.js types (now rendered via ECharts)
  bar: `bar
A 10
B 20
C 30`,

  line: `line
A 10
B 20
C 30`,

  'multi-line': `line
series X, Y
A 10 20
B 30 40`,

  area: `line
fill
A 10
B 20
C 30`,

  pie: `pie
A 10
B 20
C 30`,

  doughnut: `pie
hole
A 10
B 20
C 30`,

  radar: `radar
Speed 80
Power 60
Defense 90`,

  'polar-area': `polar-area
A 10
B 20
C 30`,

  'bar-stack': `bar
stack X, Y
A 10 20
B 30 40`,

  'bar-group': `bar
group X, Y
A 10 20
B 30 40`,
};

// ============================================================
// D3 render tests
// ============================================================

describe('renderForExport', () => {
  for (const type of D3_TYPES) {
    it(`renders ${type} chart to non-empty SVG`, async () => {
      const svg = await renderForExport(D3_INPUTS[type], 'light');
      expect(svg).toBeTruthy();
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it(`renders ${type} chart in dark theme`, async () => {
      const svg = await renderForExport(D3_INPUTS[type], 'dark');
      expect(svg).toBeTruthy();
      expect(svg).toContain('<svg');
    });
  }

  // Regression: word clouds must place every word headlessly (no real canvas).
  it('wordcloud places all words as text in headless Node', async () => {
    const svg = await renderForExport(D3_INPUTS.wordcloud, 'light');
    for (const word of ['hello', 'world', 'test', 'data']) {
      expect(svg).toContain(`>${word}</text>`);
    }
  });
});

// ============================================================
// ECharts render tests (all work via SSR — no DOM needed)
// ============================================================

describe('renderExtendedChartForExport', () => {
  for (const [type, input] of Object.entries(ECHART_INPUTS)) {
    it(`renders ${type} chart to non-empty SVG`, async () => {
      const svg = await renderExtendedChartForExport(input, 'light');
      expect(svg).toBeTruthy();
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });
  }
});

// ============================================================
// Chart type coverage canary test
// ============================================================

describe('CLI chart type coverage', () => {
  it('every chart type in getAllChartTypes has a test input', () => {
    const allInputs = { ...D3_INPUTS, ...ECHART_INPUTS };
    for (const chartType of getAllChartTypes()) {
      const category = getRenderCategory(chartType);
      expect(
        allInputs[chartType],
        `Missing test input for chart type "${chartType}" (category: ${category})`
      ).toBeDefined();
    }
  });

  it('every data-chart type produces SVG via renderExtendedChartForExport', async () => {
    for (const chartType of getAllChartTypes()) {
      if (getRenderCategory(chartType) !== 'data-chart') continue;
      const input = ECHART_INPUTS[chartType];
      if (!input) continue;
      const svg = await renderExtendedChartForExport(input, 'light');
      expect(
        svg,
        `ECharts type "${chartType}" produced empty SVG`
      ).toBeTruthy();
    }
  });

  it('parseDgmoChartType extracts chart type from content', () => {
    expect(parseDgmoChartType('scatter\nA 1, 2')).toBe('scatter');
    expect(parseDgmoChartType('sankey\nA -> B 10')).toBe('sankey');
    expect(parseDgmoChartType('sequence\nA -hi-> B')).toBe('sequence');
  });

  it('getRenderCategory maps types to categories', () => {
    expect(getRenderCategory('scatter')).toBe('data-chart');
    expect(getRenderCategory('sankey')).toBe('data-chart');
    expect(getRenderCategory('sequence')).toBe('diagram');
    expect(getRenderCategory('bar')).toBe('data-chart');
    expect(getRenderCategory('nonexistent')).toBeNull();
  });
});
