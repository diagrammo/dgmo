import { describe, it, expect } from 'vitest';
import { parseQuadrant, buildMermaidQuadrant } from '../src/dgmo-mermaid';

// ============================================================
// parseQuadrant()
// ============================================================

const FULL_QUADRANT = `quadrant
title Priority Matrix
x-label Low Effort, High Effort
y-label Low Value, High Value
top-right Promote (green)
top-left Consider
bottom-left Ignore
bottom-right Automate
# a comment
// another comment

Feature A 0.8, 0.9
Feature B 0.2, 0.3
`;

describe('parseQuadrant()', () => {
  it('parses title with line number', () => {
    const result = parseQuadrant(FULL_QUADRANT);
    expect(result.title).toBe('Priority Matrix');
    expect(result.titleLineNumber).toBe(2);
  });

  it('parses x-axis labels', () => {
    const result = parseQuadrant(FULL_QUADRANT);
    expect(result.xAxis).toEqual(['Low Effort', 'High Effort']);
    expect(result.xAxisLineNumber).toBe(3);
  });

  it('parses y-axis labels', () => {
    const result = parseQuadrant(FULL_QUADRANT);
    expect(result.yAxis).toEqual(['Low Value', 'High Value']);
    expect(result.yAxisLineNumber).toBe(4);
  });

  it('parses all 4 quadrant labels', () => {
    const result = parseQuadrant(FULL_QUADRANT);
    expect(result.quadrants.topRight?.text).toBe('Promote');
    expect(result.quadrants.topLeft?.text).toBe('Consider');
    expect(result.quadrants.bottomLeft?.text).toBe('Ignore');
    expect(result.quadrants.bottomRight?.text).toBe('Automate');
  });

  it('parses quadrant label color annotation', () => {
    const result = parseQuadrant(FULL_QUADRANT);
    // green resolves to nord14 = #a3be8c
    expect(result.quadrants.topRight?.color).toBe('#a3be8c');
    expect(result.quadrants.topLeft?.color).toBeNull();
  });

  it('parses data points with coordinates and line numbers', () => {
    const result = parseQuadrant(FULL_QUADRANT);
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toEqual({
      label: 'Feature A',
      x: 0.8,
      y: 0.9,
      lineNumber: 12,
    });
    expect(result.points[1]).toEqual({
      label: 'Feature B',
      x: 0.2,
      y: 0.3,
      lineNumber: 13,
    });
  });

  it('skips comments and blank lines', () => {
    const result = parseQuadrant('# comment\n// comment\n\nA 0.5, 0.5');
    expect(result.points).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('skips the chart directive line', () => {
    const result = parseQuadrant('quadrant\nA 0.5, 0.5');
    expect(result.title).toBeNull();
    expect(result.points).toHaveLength(1);
  });

  it('produces error when no data points present', () => {
    const result = parseQuadrant('title Empty Chart');
    expect(result.points).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].message).toContain('No data points');
    expect(result.error).toBeTruthy();
  });

  it('collects multiple points in order', () => {
    const input = 'A 0.1, 0.2\nB 0.3, 0.4\nC 0.5, 0.6';
    const result = parseQuadrant(input);
    expect(result.points.map((p) => p.label)).toEqual(['A', 'B', 'C']);
  });
});

// ============================================================
// buildMermaidQuadrant()
// ============================================================

/** Helper to parse then build for convenience */
function buildFromSource(
  content: string,
  options: {
    isDark?: boolean;
    textColor?: string;
    mutedTextColor?: string;
  } = {}
): string {
  return buildMermaidQuadrant(parseQuadrant(content), options);
}

describe('buildMermaidQuadrant()', () => {
  it('produces valid quadrantChart Mermaid syntax', () => {
    const output = buildFromSource('A 0.5, 0.5');
    expect(output).toContain('quadrantChart');
  });

  it('includes title line', () => {
    const output = buildFromSource('title My Chart\nA 0.5, 0.5');
    expect(output).toContain('    title My Chart');
  });

  it('includes axis syntax', () => {
    const output = buildFromSource(
      'x-label Low, High\ny-label Bad, Good\nA 0.5, 0.5'
    );
    expect(output).toContain('    x-axis Low --> High');
    expect(output).toContain('    y-axis Bad --> Good');
  });

  it('maps quadrant labels to quadrant-1 through quadrant-4', () => {
    const input = [
      'top-right Do First',
      'top-left Schedule',
      'bottom-left Eliminate',
      'bottom-right Delegate',
      'A 0.5, 0.5',
    ].join('\n');
    const output = buildFromSource(input);
    expect(output).toContain('quadrant-1 "Do First"');
    expect(output).toContain('quadrant-2 Schedule');
    expect(output).toContain('quadrant-3 Eliminate');
    expect(output).toContain('quadrant-4 Delegate');
  });

  it('formats data points as Label: [x, y]', () => {
    const output = buildFromSource('Task 0.8, 0.9');
    expect(output).toContain('    Task: [0.8, 0.9]');
  });

  it('quotes labels that contain spaces', () => {
    const output = buildFromSource('My Task 0.5, 0.5');
    expect(output).toContain('"My Task": [0.5, 0.5]');
  });

  it('uses 30% alpha for fills in dark mode', () => {
    const input = 'top-right Go (green)\nA 0.5, 0.5';
    const output = buildFromSource(input, { isDark: true });
    // green = #a3be8c + '30' alpha
    expect(output).toContain('#a3be8c30');
  });

  it('uses 55% alpha for fills in light mode', () => {
    const input = 'top-right Go (green)\nA 0.5, 0.5';
    const output = buildFromSource(input, { isDark: false });
    // green = #a3be8c + '55' alpha
    expect(output).toContain('#a3be8c55');
  });

  it('uses dark text colors in dark mode by default', () => {
    const output = buildFromSource('A 0.5, 0.5', { isDark: true });
    expect(output).toContain('#d0d0d0'); // primaryText
    expect(output).toContain('#888888'); // quadrantLabelText
  });

  it('uses light text colors in light mode by default', () => {
    const output = buildFromSource('A 0.5, 0.5', { isDark: false });
    expect(output).toContain('#333333'); // primaryText
    expect(output).toContain('#666666'); // quadrantLabelText
  });

  it('respects custom textColor and mutedTextColor options', () => {
    const output = buildFromSource('A 0.5, 0.5', {
      textColor: '#ff0000',
      mutedTextColor: '#00ff00',
    });
    expect(output).toContain('#ff0000'); // quadrantPointTextFill
    expect(output).toContain('#00ff00'); // quadrantLabelTextFill
  });
});
