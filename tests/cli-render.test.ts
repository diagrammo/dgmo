import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderD3ForExport } from '../src/d3';
import { renderEChartsForExport } from '../src/echarts';
import {
  DGMO_CHART_TYPE_MAP,
  getDgmoFramework,
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
A -> B: hello
B -> A: world`,

  slope: `chart: slope
series: Before, After
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
A: 100
B: 80
A & B: 30`,

  quadrant: `chart: quadrant
xlabel: Effort
ylabel: Impact
High Impact, Low Effort: 20, 80
Low Impact, High Effort: 80, 20`,
};

// D3 types that work in jsdom (have full DOM support)
const D3_JSDOM_TYPES = ['sequence'];

// D3 types that need real browser SVG layout (fail in jsdom)
const D3_BROWSER_ONLY_TYPES = [
  'slope',
  'wordcloud',
  'arc',
  'timeline',
  'venn',
  'quadrant',
];

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
};

// ============================================================
// D3 render tests
// ============================================================

describe('renderD3ForExport', () => {
  for (const type of D3_JSDOM_TYPES) {
    it(`renders ${type} chart to non-empty SVG`, async () => {
      const svg = await renderD3ForExport(D3_INPUTS[type], 'light');
      expect(svg).toBeTruthy();
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });
  }

  // These D3 types need real browser SVG layout (getBBox, etc.)
  // They work via the actual CLI (which uses jsdom + full DOM setup)
  // but not in the vitest jsdom environment.
  for (const type of D3_BROWSER_ONLY_TYPES) {
    it.todo(
      `renders ${type} chart to non-empty SVG (requires browser SVG layout)`
    );
  }
});

// ============================================================
// ECharts render tests (all work via SSR — no DOM needed)
// ============================================================

describe('renderEChartsForExport', () => {
  for (const [type, input] of Object.entries(ECHART_INPUTS)) {
    it(`renders ${type} chart to non-empty SVG`, async () => {
      const svg = await renderEChartsForExport(input, 'light');
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
  it('every chart type in DGMO_CHART_TYPE_MAP has a test input', () => {
    const allInputs = { ...D3_INPUTS, ...ECHART_INPUTS };
    for (const chartType of Object.keys(DGMO_CHART_TYPE_MAP)) {
      const framework = getDgmoFramework(chartType);
      // Skip chartjs — not yet supported in CLI
      if (framework === 'chartjs') continue;
      expect(
        allInputs[chartType],
        `Missing test input for chart type "${chartType}" (framework: ${framework})`
      ).toBeDefined();
    }
  });

  it('every ECharts chart type produces SVG via renderEChartsForExport', async () => {
    for (const [chartType, framework] of Object.entries(DGMO_CHART_TYPE_MAP)) {
      if (framework !== 'echart') continue;
      const input = ECHART_INPUTS[chartType];
      if (!input) continue;
      const svg = await renderEChartsForExport(input, 'light');
      expect(
        svg,
        `ECharts type "${chartType}" produced empty SVG`
      ).toBeTruthy();
    }
  });

  it('parseDgmoChartType extracts chart type from content', () => {
    expect(parseDgmoChartType('chart: scatter\nA: 1, 2')).toBe('scatter');
    expect(parseDgmoChartType('chart: sankey\nA -> B: 10')).toBe('sankey');
    expect(parseDgmoChartType('chart: sequence\nA -> B: hi')).toBe('sequence');
  });

  it('getDgmoFramework maps types to frameworks', () => {
    expect(getDgmoFramework('scatter')).toBe('echart');
    expect(getDgmoFramework('sankey')).toBe('echart');
    expect(getDgmoFramework('sequence')).toBe('d3');
    expect(getDgmoFramework('bar')).toBe('chartjs');
    expect(getDgmoFramework('nonexistent')).toBeNull();
  });
});
