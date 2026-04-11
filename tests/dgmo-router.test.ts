import { describe, it, expect } from 'vitest';
import {
  parseDgmoChartType,
  parseDgmo,
  looksLikeGantt,
  looksLikeC4,
} from '../src/dgmo-router';

describe('parseDgmoChartType — explicit declaration', () => {
  it('recognizes bare chart type on first line (new syntax)', () => {
    expect(parseDgmoChartType('gantt\n10bd Task')).toBe('gantt');
    expect(parseDgmoChartType('sequence\nA -> B')).toBe('sequence');
    expect(parseDgmoChartType('bar\nQ1 150')).toBe('bar');
  });

  it('recognizes chart type with title (new syntax)', () => {
    expect(parseDgmoChartType('gantt Product Launch 2026\n10bd Task')).toBe(
      'gantt'
    );
    expect(parseDgmoChartType('sequence My Flow\nA -> B')).toBe('sequence');
  });

  it('no longer recognizes old chart: syntax on first line', () => {
    // chart: gantt is not recognized as explicit type, but gantt is inferred from content
    expect(parseDgmoChartType('chart: gantt\n10bd Task A')).toBe('gantt');
    // These have no inferable content, so null
    expect(parseDgmoChartType('chart: sequence')).toBeNull();
    expect(parseDgmoChartType('chart: bar')).toBeNull();
  });

  it('skips leading comments', () => {
    expect(parseDgmoChartType('// comment\ngantt\n10bd Task')).toBe('gantt');
    expect(parseDgmoChartType('// comment\nsequence')).toBe('sequence');
  });

  it('is case-insensitive', () => {
    expect(parseDgmoChartType('Gantt\n10bd Task')).toBe('gantt');
    expect(parseDgmoChartType('SEQUENCE\nA -> B')).toBe('sequence');
  });
});

describe('parseDgmoChartType inference', () => {
  // === Gantt inference ===
  describe('gantt', () => {
    it('detects gantt from duration patterns', () => {
      const content = '10bd Task A\n5d Task B';
      expect(parseDgmoChartType(content)).toBe('gantt');
    });

    it('detects gantt from fractional durations', () => {
      const content = '1.5w Design\n3d Build';
      expect(parseDgmoChartType(content)).toBe('gantt');
    });

    it('detects gantt from date patterns', () => {
      const content = '2025-01-15 Launch\n2025-02-01 Review';
      expect(parseDgmoChartType(content)).toBe('gantt');
    });
  });

  // === C4 inference ===
  describe('c4', () => {
    it('detects c4 from is-a declarations', () => {
      const content = 'MyApp is a system\nDB is a container';
      expect(parseDgmoChartType(content)).toBe('c4');
    });

    it('detects c4 with person type', () => {
      const content = 'Alice is a person\nMyApp is a system';
      expect(parseDgmoChartType(content)).toBe('c4');
    });

    it('prefers sequence over c4 when is-a uses sequence types', () => {
      // "is a actor" triggers sequence inference (via arrow patterns too)
      const content = 'User is a actor\nUser -login-> App';
      expect(parseDgmoChartType(content)).toBe('sequence');
    });

    it('does not detect c4 from bare container word', () => {
      // "container-registry" with infra-like metadata should NOT trigger C4
      const content = 'container-registry\n  rps: 100';
      expect(parseDgmoChartType(content)).not.toBe('c4');
    });
  });
});

describe('looksLikeGantt', () => {
  it('returns true for duration lines', () => {
    expect(looksLikeGantt('10bd Task A')).toBe(true);
    expect(looksLikeGantt('5d Task B')).toBe(true);
    expect(looksLikeGantt('1.5w Design')).toBe(true);
    expect(looksLikeGantt('2h Meeting')).toBe(true);
  });

  it('returns true for date lines', () => {
    expect(looksLikeGantt('2025-01-15 Launch')).toBe(true);
  });

  it('returns false for non-gantt content', () => {
    expect(looksLikeGantt('Home\n  About')).toBe(false);
    expect(looksLikeGantt('A -> B')).toBe(false);
  });

  it('skips comments', () => {
    expect(looksLikeGantt('// 5d not a task')).toBe(false);
  });
});

describe('looksLikeC4', () => {
  it('returns true for C4 type declarations', () => {
    expect(looksLikeC4('MyApp is a system')).toBe(true);
    expect(looksLikeC4('DB is a container')).toBe(true);
    expect(looksLikeC4('Alice is a person')).toBe(true);
    expect(looksLikeC4('API is a component')).toBe(true);
  });

  it('returns false for bare type words', () => {
    expect(looksLikeC4('container-registry\n  rps: 100')).toBe(false);
    expect(looksLikeC4('system status: ok')).toBe(false);
  });

  it('skips comments', () => {
    expect(looksLikeC4('// MyApp is a system')).toBe(false);
  });
});

describe('parseDgmo — common-mistake detection', () => {
  describe('colon in chart type', () => {
    it('detects colon in known chart type declaration', () => {
      const { diagnostics } = parseDgmo('bar: Sales');
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Remove the colon');
      expect(errors[0].message).toContain('bar Sales');
    });

    it('detects colon in pie chart type', () => {
      const { diagnostics } = parseDgmo('pie: Revenue');
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Remove the colon');
    });

    it('detects colon with misspelled chart type', () => {
      const { diagnostics } = parseDgmo('sequnce: Flow');
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Did you mean');
      expect(errors[0].message).toContain("don't use colons");
    });

    it('does not flag data lines as colon errors', () => {
      const { diagnostics } = parseDgmo('pie\nApples: 30\nBananas: 20');
      const colonErrors = diagnostics.filter(
        (d) => d.severity === 'error' && d.message.includes('colon')
      );
      expect(colonErrors.length).toBe(0);
    });

    it('handles bare colon with no title', () => {
      const { diagnostics } = parseDgmo('pie:');
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Remove the colon');
    });
  });

  describe('empty content after chart type', () => {
    it('warns when only chart type line is present', () => {
      const { diagnostics } = parseDgmo('bar');
      const warnings = diagnostics.filter((d) => d.severity === 'warning');
      expect(warnings.some((w) => w.message.includes('No content'))).toBe(true);
    });

    it('does not warn when content follows chart type', () => {
      const { diagnostics } = parseDgmo('bar\nA: 10\nB: 20');
      const warnings = diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('No content')
      );
      expect(warnings.length).toBe(0);
    });
  });
});
