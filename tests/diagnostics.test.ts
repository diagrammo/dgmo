import { describe, it, expect } from 'vitest';
import { suggest } from '../src/diagnostics';
import { parseDgmo } from '../src/dgmo-router';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseOrg } from '../src/org/parser';
import { parseChart } from '../src/chart';
import { parseEChart } from '../src/echarts';
import { parseD3 } from '../src/d3';

// ============================================================
// suggest() utility
// ============================================================

describe('suggest()', () => {
  const chartTypes = ['bar', 'line', 'pie', 'doughnut', 'area', 'radar', 'polar-area', 'bar-stacked'];

  it('suggests close match for common typos', () => {
    expect(suggest('ber', chartTypes)).toBe("Did you mean 'bar'?");
    expect(suggest('lne', chartTypes)).toBe("Did you mean 'line'?");
    expect(suggest('pe', chartTypes)).toBe("Did you mean 'pie'?");
  });

  it('returns null for exact match', () => {
    expect(suggest('bar', chartTypes)).toBeNull();
  });

  it('returns null for completely unrelated input', () => {
    expect(suggest('zzzzzzz', chartTypes)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(suggest('', chartTypes)).toBeNull();
  });

  it('returns null for empty candidates', () => {
    expect(suggest('bar', [])).toBeNull();
  });

  it('suggests for echarts types', () => {
    const ecTypes = ['scatter', 'sankey', 'chord', 'function', 'heatmap', 'funnel'];
    expect(suggest('scater', ecTypes)).toBe("Did you mean 'scatter'?");
    expect(suggest('snakey', ecTypes)).toBe("Did you mean 'sankey'?");
  });
});

// ============================================================
// Sequence: multiple errors collected
// ============================================================

describe('sequence: multiple recoverable errors', () => {
  it('collects hex color errors across group + section, continues parsing', () => {
    const content = [
      'chart: sequence',
      '## Backend(#ff0000)',
      '  API',
      '== Phase(#00ff00) ==',
      'User -request-> API',
    ].join('\n');

    const result = parseSequenceDgmo(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    // Both hex color lines should produce errors
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0].message).toContain('named color');
    expect(errors[1].message).toContain('named color');
    // The message should still be parsed
    expect(result.messages).toHaveLength(1);
  });

  it('collects # comment error and continues parsing', () => {
    const content = [
      'chart: sequence',
      '# this is wrong',
      'User -request-> API',
    ].join('\n');

    const result = parseSequenceDgmo(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Use //');
    // Message still parsed
    expect(result.messages).toHaveLength(1);
  });

  it('collects duplicate group membership and continues', () => {
    const content = [
      'chart: sequence',
      '## Frontend',
      '  User',
      '',
      '## Backend',
      '  User',
      '',
      'User -request-> API',
    ].join('\n');

    const result = parseSequenceDgmo(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('already in group');
    // Message still parsed
    expect(result.messages).toHaveLength(1);
  });

  it('collects options-after-content error and continues', () => {
    const content = [
      'chart: sequence',
      'User -request-> API',
      'activations: off',
      'API -query-> DB',
    ].join('\n');

    const result = parseSequenceDgmo(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('before the first message');
    // Both messages parsed
    expect(result.messages).toHaveLength(2);
  });

  it('collects async prefix error and continues', () => {
    const content = [
      'chart: sequence',
      'async User -request-> API',
      'API -query-> DB',
    ].join('\n');

    const result = parseSequenceDgmo(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('~>');
    // Second message still parsed
    expect(result.messages).toHaveLength(1);
  });
});

// ============================================================
// Org: multiple recoverable errors
// ============================================================

describe('org: multiple recoverable errors', () => {
  it('collects tag group errors and continues parsing', () => {
    const content = [
      'chart: org',
      '## Department',
      '  Engineering',
      '  Sales',
      '',
      'Alice',
      '  department: Engineering',
      'Bob',
      '  department: Sales',
    ].join('\n');

    const result = parseOrg(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    // Both tag group entries missing color should produce errors
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toContain('Value(color)');
    // Nodes still parsed
    expect(result.roots).toHaveLength(2);
  });

  it('collects metadata-without-parent error and continues', () => {
    const content = [
      'chart: org',
      '    role: Engineer',
      'Alice',
    ].join('\n');

    const result = parseOrg(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('parent node');
    // Alice still parsed
    expect(result.roots).toHaveLength(1);
  });
});

// ============================================================
// Chart type suggestions
// ============================================================

describe('chart type suggestions in error messages', () => {
  it('suggests correct chart type for misspellings', () => {
    const result = parseChart('chart: bra\nFoo: 1');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('bar');
    expect(result.diagnostics[0].message).toContain("Did you mean 'bar'?");
  });

  it('suggests echart type for misspellings', () => {
    const result = parseEChart('chart: scater\nA: 1, 2');
    expect(result.error).toBeDefined();
    expect(result.diagnostics[0].message).toContain("Did you mean 'scatter'?");
  });

  it('suggests d3 type for misspellings', () => {
    const result = parseD3('chart: slop\nA, B\nX: 1, 2');
    expect(result.error).toBeDefined();
    expect(result.diagnostics[0].message).toContain("Did you mean 'slope'?");
  });
});

// ============================================================
// Venn: recoverable overlap errors
// ============================================================

describe('venn: recoverable overlap errors', () => {
  it('collects unknown set reference and skips bad overlap', () => {
    const content = [
      'chart: venn',
      'Math: 100',
      'Science: 80',
      'Math & Typo: 20',
      'Math & Science: 30',
    ].join('\n');

    const result = parseD3(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Typo');
    // Good overlap kept, bad one removed
    expect(result.vennOverlaps).toHaveLength(1);
    expect(result.vennOverlaps[0].sets).toContain('Math');
    expect(result.vennOverlaps[0].sets).toContain('Science');
  });
});

// ============================================================
// parseDgmo() unified diagnostics
// ============================================================

describe('parseDgmo()', () => {
  it('returns diagnostics for sequence diagrams', () => {
    const { diagnostics } = parseDgmo('chart: sequence\n# bad comment\nA -msg-> B');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain('Use //');
  });

  it('returns diagnostics for chart type errors', () => {
    const { diagnostics } = parseDgmo('chart: bra\nFoo: 1');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain('Unsupported chart type');
  });

  it('returns empty diagnostics for valid input', () => {
    const { diagnostics } = parseDgmo('chart: bar\nFoo: 1\nBar: 2');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('returns diagnostics for org errors', () => {
    const { diagnostics } = parseDgmo('chart: org\n    role: Engineer\nAlice');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('parent node');
  });

  it('returns warnings for missing data', () => {
    const { diagnostics } = parseDgmo('chart: bar');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});
