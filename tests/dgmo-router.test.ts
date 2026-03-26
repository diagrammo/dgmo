import { describe, it, expect } from 'vitest';
import { parseDgmoChartType, looksLikeGantt, looksLikeC4 } from '../src/dgmo-router';

describe('parseDgmoChartType — explicit declaration', () => {
  it('recognizes bare chart type on first line (new syntax)', () => {
    expect(parseDgmoChartType('gantt\n10bd Task')).toBe('gantt');
    expect(parseDgmoChartType('sequence\nA -> B')).toBe('sequence');
    expect(parseDgmoChartType('bar\nQ1 150')).toBe('bar');
    expect(parseDgmoChartType('initiative-status\nFoo | done')).toBe('initiative-status');
  });

  it('recognizes chart type with title (new syntax)', () => {
    expect(parseDgmoChartType('gantt Product Launch 2026\n10bd Task')).toBe('gantt');
    expect(parseDgmoChartType('sequence My Flow\nA -> B')).toBe('sequence');
  });

  it('still recognizes old chart: syntax', () => {
    expect(parseDgmoChartType('chart: gantt\n10bd: Task A')).toBe('gantt');
    expect(parseDgmoChartType('chart: sequence')).toBe('sequence');
    expect(parseDgmoChartType('chart: bar')).toBe('bar');
  });

  it('skips leading comments', () => {
    expect(parseDgmoChartType('// comment\ngantt\n10bd Task')).toBe('gantt');
    expect(parseDgmoChartType('// comment\nchart: sequence')).toBe('sequence');
  });

  it('is case-insensitive', () => {
    expect(parseDgmoChartType('Gantt\n10bd Task')).toBe('gantt');
    expect(parseDgmoChartType('SEQUENCE\nA -> B')).toBe('sequence');
  });
});

describe('parseDgmoChartType inference', () => {
  // === Gantt inference ===
  describe('gantt', () => {
    it('detects gantt from duration patterns (old colon syntax)', () => {
      const content = '10bd: Task A\n5d: Task B';
      expect(parseDgmoChartType(content)).toBe('gantt');
    });

    it('detects gantt from duration patterns (new syntax)', () => {
      const content = '10bd Task A\n5d Task B';
      expect(parseDgmoChartType(content)).toBe('gantt');
    });

    it('detects gantt from fractional durations', () => {
      const content = '1.5w: Design\n3d: Build';
      expect(parseDgmoChartType(content)).toBe('gantt');
    });

    it('detects gantt from date patterns (old syntax)', () => {
      const content = '2025-01-15: Launch\n2025-02-01: Review';
      expect(parseDgmoChartType(content)).toBe('gantt');
    });

    it('detects gantt from date patterns (new syntax)', () => {
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
  it('returns true for duration lines (old colon syntax)', () => {
    expect(looksLikeGantt('10bd: Task A')).toBe(true);
    expect(looksLikeGantt('5d: Task B')).toBe(true);
    expect(looksLikeGantt('1.5w: Design')).toBe(true);
    expect(looksLikeGantt('2h: Meeting')).toBe(true);
  });

  it('returns true for duration lines (new syntax)', () => {
    expect(looksLikeGantt('10bd Task A')).toBe(true);
    expect(looksLikeGantt('5d Task B')).toBe(true);
    expect(looksLikeGantt('1.5w Design')).toBe(true);
    expect(looksLikeGantt('2h Meeting')).toBe(true);
  });

  it('returns true for date lines (old syntax)', () => {
    expect(looksLikeGantt('2025-01-15: Launch')).toBe(true);
    expect(looksLikeGantt('2025-01-15 14:00: Meeting')).toBe(true);
  });

  it('returns true for date lines (new syntax)', () => {
    expect(looksLikeGantt('2025-01-15 Launch')).toBe(true);
  });

  it('returns false for non-gantt content', () => {
    expect(looksLikeGantt('Home\n  About')).toBe(false);
    expect(looksLikeGantt('A -> B')).toBe(false);
  });

  it('skips comments', () => {
    expect(looksLikeGantt('// 5d: not a task')).toBe(false);
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
