import { describe, it, expect } from 'vitest';
import { suggest, dedupeDiagnostics } from '../src/diagnostics';
import type { DgmoError } from '../src/diagnostics';
import { parseDgmo } from '../src/dgmo-router';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseOrg } from '../src/org/parser';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/echarts';
import { parseVisualization } from '../src/d3';

// ============================================================
// suggest() utility
// ============================================================

describe('suggest()', () => {
  const chartTypes = [
    'bar',
    'line',
    'pie',
    'doughnut',
    'area',
    'radar',
    'polar-area',
    'bar-stacked',
  ];

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
    const ecTypes = [
      'scatter',
      'sankey',
      'chord',
      'function',
      'heatmap',
      'funnel',
    ];
    expect(suggest('scater', ecTypes)).toBe("Did you mean 'scatter'?");
    expect(suggest('snakey', ecTypes)).toBe("Did you mean 'sankey'?");
  });
});

// ============================================================
// Sequence: multiple errors collected
// ============================================================

describe('sequence: multiple recoverable errors', () => {
  it('collects color deprecation warnings across group + section, continues parsing', () => {
    // Warnings are scoped to the 11-name palette per §1.5; legacy parens
    // form `(red)` / `(green)` triggers deprecation. Hex codes pass through.
    const content = [
      'sequence',
      '[Backend(red)]',
      '  API',
      '== Phase(green) ==',
      'User -request-> API',
    ].join('\n');

    const result = parseSequenceDgmo(content);
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    // Both color lines should produce deprecation warnings
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings[0].message).toContain('parens-color syntax');
    expect(warnings[1].message).toContain('parens-color syntax');
    // The message should still be parsed
    expect(result.messages).toHaveLength(1);
  });

  it('collects # comment error and continues parsing', () => {
    const content = ['sequence', '# this is wrong', 'User -request-> API'].join(
      '\n'
    );

    const result = parseSequenceDgmo(content);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Use //');
    // Message still parsed
    expect(result.messages).toHaveLength(1);
  });

  it('collects duplicate group membership and continues', () => {
    const content = [
      'sequence',
      '[Frontend]',
      '  User',
      '',
      '[Backend]',
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
      'sequence',
      'User -request-> API',
      'no-activations',
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
      'sequence',
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
  it('ignores ## syntax (no longer recognized as tag heading)', () => {
    const content = [
      'org',
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
    // ## is not recognized as a tag heading — no tag groups created
    expect(result.tagGroups).toHaveLength(0);
    // All lines become org nodes (## Department, Engineering, Sales, Alice, Bob become roots/children)
    expect(result.roots.length).toBeGreaterThanOrEqual(2);
  });

  it('collects metadata-without-parent error and continues', () => {
    const content = ['org', '    role: Engineer', 'Alice'].join('\n');

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
    const result = parseChart('bra\nFoo: 1');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('bar');
    expect(result.diagnostics[0].message).toContain("Did you mean 'bar'?");
  });

  it('suggests echart type for misspellings', () => {
    const result = parseExtendedChart('scater\nA: 1, 2');
    expect(result.error).toBeDefined();
    expect(result.diagnostics[0].message).toContain("Did you mean 'scatter'?");
  });

  it('suggests d3 type for misspellings', () => {
    const result = parseVisualization('slop\nA, B\nX: 1, 2');
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Did you mean 'slope'?");
  });
});

// ============================================================
// Venn: recoverable overlap errors
// ============================================================

describe('venn: recoverable overlap errors', () => {
  it('collects unknown set reference and skips bad overlap', () => {
    const content = [
      'venn',
      'Math',
      'Science',
      'Math + Typo Shared',
      'Math + Science Both',
    ].join('\n');

    const result = parseVisualization(content);
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
    const { diagnostics } = parseDgmo('sequence\n# bad comment\nA -msg-> B');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain('Use //');
  });

  it('returns diagnostics for chart type errors', () => {
    const { diagnostics } = parseDgmo('bra\nFoo: 1');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain('Unsupported chart type');
  });

  it('returns empty diagnostics for valid input', () => {
    const { diagnostics } = parseDgmo('bar\nFoo: 1\nBar: 2');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('returns diagnostics for org errors', () => {
    const { diagnostics } = parseDgmo('org\n    role: Engineer\nAlice');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('parent node');
  });

  it('returns warnings for missing data', () => {
    const { diagnostics } = parseDgmo('bar');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// dedupeDiagnostics() + parseDgmo dedup boundary
// ============================================================

describe('dedupeDiagnostics', () => {
  const mk = (
    line: number,
    message: string,
    severity: DgmoError['severity'] = 'error',
    code?: string,
    column?: number
  ): DgmoError => ({
    line,
    message,
    severity,
    ...(code && { code }),
    ...(column && { column }),
  });

  it('drops exact duplicates, preserving first-seen order', () => {
    const out = dedupeDiagnostics([
      mk(2, 'pipe removed', 'error', 'E_PIPE'),
      mk(2, 'pipe removed', 'error', 'E_PIPE'),
      mk(2, 'pipe removed', 'error', 'E_PIPE'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('E_PIPE');
  });

  it('keeps diagnostics that differ in line, column, severity, code, or message', () => {
    const out = dedupeDiagnostics([
      mk(2, 'pipe removed', 'error', 'E_PIPE'),
      mk(3, 'pipe removed', 'error', 'E_PIPE'), // different line
      mk(2, 'pipe removed', 'warning', 'E_PIPE'), // different severity
      mk(2, 'different message', 'error', 'E_PIPE'), // different message
      mk(2, 'pipe removed', 'error', 'E_PIPE', 5), // different column
    ]);
    expect(out).toHaveLength(5);
  });

  it('preserves order of distinct diagnostics', () => {
    const out = dedupeDiagnostics([mk(5, 'b'), mk(1, 'a'), mk(5, 'b')]);
    expect(out.map((d) => d.message)).toEqual(['b', 'a']);
  });
});

describe('parseDgmo dedupes at the parse boundary', () => {
  it('reports one diagnostic per offending line, not N copies', () => {
    // Pre-fix this emitted 4 identical E_PIPE_OPERATOR_REMOVED diagnostics.
    const { diagnostics } = parseDgmo(
      'sequence\nUser | role: admin\nUser -hi-> API\n'
    );
    const pipeErrors = diagnostics.filter(
      (d) => d.code === 'E_PIPE_OPERATOR_REMOVED' && d.line === 2
    );
    expect(pipeErrors).toHaveLength(1);
  });
});
