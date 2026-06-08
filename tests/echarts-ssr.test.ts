import { describe, it, expect } from 'vitest';
import { renderExtendedChartForExport } from '../src/echarts';

// Minimal valid inputs for each ECharts chart type
const SCATTER_INPUT = `scatter Test Scatter
A 1, 2
B 3, 4
C 5, 6`;

const SANKEY_INPUT = `sankey Test Sankey
A -> B 10
B -> C 5
A -> C 3`;

const CHORD_INPUT = `chord Test Chord
A -> B 10
B -> C 5
C -> A 3`;

const FUNCTION_INPUT = `function Test Function
x -5 to 5
f(x) x^2
g(x) sin(x)`;

const HEATMAP_INPUT = `heatmap Test Heatmap
columns Mon, Tue, Wed
Morning 10, 20, 30
Afternoon 40, 50, 60`;

const FUNNEL_INPUT = `funnel Test Funnel
Visitors 1000
Signups 500
Paid 100`;

describe('renderExtendedChartForExport', () => {
  it('renders scatter chart to SVG', async () => {
    const svg = await renderExtendedChartForExport(SCATTER_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders sankey chart to SVG', async () => {
    const svg = await renderExtendedChartForExport(SANKEY_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders chord chart to SVG', async () => {
    const svg = await renderExtendedChartForExport(CHORD_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders function chart to SVG', async () => {
    const svg = await renderExtendedChartForExport(FUNCTION_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders heatmap chart to SVG', async () => {
    const svg = await renderExtendedChartForExport(HEATMAP_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders funnel chart to SVG', async () => {
    const svg = await renderExtendedChartForExport(FUNNEL_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('returns SVG with warning for empty scatter input', async () => {
    const svg = await renderExtendedChartForExport('scatter\n', 'light');
    // No data is now a warning, not a fatal error — diagram renders empty
    expect(svg).toContain('<svg');
  });

  it('returns empty string for unsupported chart type', async () => {
    // With new colon-free syntax, an unrecognized first token falls through
    // to the standard chart parser which produces an empty result
    const svg = await renderExtendedChartForExport('unknown\nA 1', 'light');
    expect(svg).toBe('');
  });

  it('includes font-family in SVG output', async () => {
    const svg = await renderExtendedChartForExport(SCATTER_INPUT, 'light');
    expect(svg).toContain('font-family');
  });

  it('renders with dark theme', async () => {
    const svg = await renderExtendedChartForExport(SCATTER_INPUT, 'dark');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with transparent theme', async () => {
    const svg = await renderExtendedChartForExport(
      SCATTER_INPUT,
      'transparent'
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with explicit palette', async () => {
    const { getPalette } = await import('../src/palettes');
    const palette = getPalette('catppuccin').light;
    const svg = await renderExtendedChartForExport(
      SCATTER_INPUT,
      'light',
      palette
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});

// ============================================================
// Scatter label collision avoidance (SSR integration)
// ============================================================

const SCATTER_LABELS_INPUT = `scatter Test Labels
x-label X
y-label Y
A 1, 2
B 3, 4
C 5, 6`;

const SCATTER_DENSE_INPUT = `scatter Dense Cluster
P1 5, 5
P2 5.1, 5
P3 5.2, 5
P4 4.9, 5
P5 5, 5.1
P6 5.1, 5.1
P7 4.9, 4.9
P8 5.2, 4.9`;

describe('scatter label SSR integration', () => {
  it('renders scatter with labels: on — SVG contains point names as text', async () => {
    const svg = await renderExtendedChartForExport(
      SCATTER_LABELS_INPUT,
      'light'
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('A');
    expect(svg).toContain('B');
    expect(svg).toContain('C');
  });

  it('renders dense cluster with all 8 point names visible', async () => {
    const svg = await renderExtendedChartForExport(
      SCATTER_DENSE_INPUT,
      'light'
    );
    expect(svg).toContain('<svg');
    for (let i = 1; i <= 8; i++) {
      expect(svg).toContain(`P${i}`);
    }
  });

  it('produces deterministic label positions', async () => {
    // ECharts SSR auto-increments internal CSS class names (zrN-cls-M),
    // so full SVG string identity isn't possible across calls.
    // Instead, verify label text elements are identical.
    const svg1 = await renderExtendedChartForExport(
      SCATTER_LABELS_INPUT,
      'light'
    );
    const svg2 = await renderExtendedChartForExport(
      SCATTER_LABELS_INPUT,
      'light'
    );
    // Extract all <text> elements (our labels + axis labels)
    const textPattern = /<text[^>]*>.*?<\/text>/g;
    const texts1 = svg1.match(textPattern) ?? [];
    const texts2 = svg2.match(textPattern) ?? [];
    expect(texts1).toEqual(texts2);
  });
});
