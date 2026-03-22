import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { renderExtendedChartForExport } from '../src/echarts';
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
  sequence: `chart: sequence
A -hello-> B
B -world-> A`,

  slope: `chart: slope
Before, After
Alpha: 10, 20
Beta: 30, 15`,

  wordcloud: `chart: wordcloud
hello: 100
world: 80
test: 60
data: 40`,

  arc: `chart: arc
A -> B: 5
B -> C: 3
C -> A: 2`,

  timeline: `chart: timeline
2020-01: Project Start
2020-06: Phase 1 Complete
2021-01: Launch`,

  venn: `chart: venn
Apples
Oranges
Apples + Oranges: Cider`,

  quadrant: `chart: quadrant
xlabel: Effort
ylabel: Impact
High Impact, Low Effort: 20, 80
Low Impact, High Effort: 80, 20`,

  flowchart: `chart: flowchart
(Start) -> [Process] -> <Check?>
  -yes-> (End)
  -no-> [Retry] -> (Start)`,

  class: `chart: class
Animal
  name: string
  speak(): void
Dog --|> Animal`,

  er: `chart: er
users
  id: int [pk]
  name: varchar
posts
  id: int [pk]
  author_id: int [fk]
users 1--* posts`,

  org: `chart: org
Jane Smith
  role: CEO
  Alex Chen
    role: CTO`,

  kanban: `chart: kanban
[To Do]
  Task A
[Done]
  Task B`,

  c4: `chart: c4
person Customer
system Banking
  -> Customer: Serves`,

  'initiative-status': `chart: initiative-status
title: Test
Mobile | done
Back End | wip
Mobile -> Back End: getUser | done`,

  state: `chart: state
[*] -> Idle
Idle -click-> Active
Active -> [*]`,

  sitemap: `chart: sitemap
title: Test Site
Home
  -go-> About
[Pages]
  About`,

  infra: `chart: infra

edge
  rps: 1000
  -> API

API
  latency-ms: 10`,

  gantt: `chart: gantt
start: 2024-01-15
14d: Research
7d: Design
3d: Testing
0d: Ship`,
};

// All D3 types now render in JSDOM via explicit dimensions (Epic 41)
const D3_TYPES = ['sequence', 'slope', 'arc', 'timeline', 'venn', 'quadrant', 'flowchart', 'org', 'kanban', 'c4', 'initiative-status', 'state', 'sitemap', 'infra', 'gantt'];

// Wordcloud requires HTMLCanvasElement.getContext('2d') for d3-cloud text measurement —
// not available in JSDOM without the `canvas` npm package.
const D3_CANVAS_TYPES = ['wordcloud'];

const ECHART_INPUTS: Record<string, string> = {
  scatter: `chart: scatter
A: 1, 2
B: 3, 4
C: 5, 6`,

  sankey: `chart: sankey
A -> B: 10
B -> C: 5
A -> C: 3`,

  chord: `chart: chord
A -> B: 10
B -> C: 5
C -> A: 3`,

  function: `chart: function
x: -5 to 5
f(x): x^2`,

  heatmap: `chart: heatmap
columns: Mon, Tue, Wed
Morning: 10, 20, 30
Afternoon: 40, 50, 60`,

  funnel: `chart: funnel
Visitors: 1000
Signups: 500
Paid: 100`,

  // Chart.js types (now rendered via ECharts)
  bar: `chart: bar
A: 10
B: 20
C: 30`,

  line: `chart: line
A: 10
B: 20
C: 30`,

  'multi-line': `chart: multi-line
series: X, Y
A: 10, 20
B: 30, 40`,

  area: `chart: area
A: 10
B: 20
C: 30`,

  pie: `chart: pie
A: 10
B: 20
C: 30`,

  doughnut: `chart: doughnut
A: 10
B: 20
C: 30`,

  radar: `chart: radar
Speed: 80
Power: 60
Defense: 90`,

  'polar-area': `chart: polar-area
A: 10
B: 20
C: 30`,

  'bar-stacked': `chart: bar-stacked
series: X, Y
A: 10, 20
B: 30, 40`,
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

  for (const type of D3_CANVAS_TYPES) {
    it.todo(
      `renders ${type} chart to non-empty SVG (requires canvas npm package)`
    );
  }
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
    expect(parseDgmoChartType('chart: scatter\nA: 1, 2')).toBe('scatter');
    expect(parseDgmoChartType('chart: sankey\nA -> B: 10')).toBe('sankey');
    expect(parseDgmoChartType('chart: sequence\nA -hi-> B')).toBe('sequence');
  });

  it('getRenderCategory maps types to categories', () => {
    expect(getRenderCategory('scatter')).toBe('data-chart');
    expect(getRenderCategory('sankey')).toBe('data-chart');
    expect(getRenderCategory('sequence')).toBe('diagram');
    expect(getRenderCategory('bar')).toBe('data-chart');
    expect(getRenderCategory('nonexistent')).toBeNull();
  });
});
