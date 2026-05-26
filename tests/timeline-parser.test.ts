import { describe, it, expect } from 'vitest';
import { parseVisualization } from '../src/d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

function parse(src: string) {
  return parseVisualization(src, palette);
}

function events(src: string) {
  return parse(src).timelineEvents;
}

function diagnostics(src: string) {
  return parse(src).diagnostics;
}

function warnings(src: string) {
  return diagnostics(src).filter((d) => d.severity === 'warning');
}

describe('timeline parser — new name-first syntax', () => {
  describe('happy path', () => {
    it('parses point event with year-month', () => {
      const evts = events('timeline\nBlockades Charleston start: 1718-05');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1718-05');
      expect(evts[0].endDate).toBeNull();
      expect(evts[0].label).toBe('Blockades Charleston');
    });

    it('parses point event with year-only', () => {
      const evts = events('timeline\nEvent start: 1716');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1716');
      expect(evts[0].endDate).toBeNull();
    });

    it('parses range event', () => {
      const evts = events(
        'timeline\nSails under Hornigold start: 1716, end: 1717'
      );
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1716');
      expect(evts[0].endDate).toBe('1717');
      expect(evts[0].label).toBe('Sails under Hornigold');
    });

    it('parses duration event', () => {
      const evts = events('timeline\nSprint 1 start: 2026-03, duration: 30d');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2026-03');
      expect(evts[0].endDate).not.toBeNull();
      expect(evts[0].label).toBe('Sprint 1');
    });

    it('parses metadata alongside scheduling keys', () => {
      const evts = events(
        'timeline\ntag Pirate as p\n  Blackbeard\nBlockades Charleston start: 1718-05, p: Blackbeard'
      );
      expect(evts).toHaveLength(1);
      expect(evts[0].metadata['pirate']).toBe('Blackbeard');
      expect(evts[0].metadata['start']).toBeUndefined();
    });

    it('parses HH:MM datetime values', () => {
      const evts = events(
        'timeline\nMeeting start: 2024-01-15 14:30, end: 2024-01-16 09:00'
      );
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2024-01-15 14:30');
      expect(evts[0].endDate).toBe('2024-01-16 09:00');
    });

    it('parses multi-word name correctly', () => {
      const evts = events('timeline\nPhase 2 Rollout start: 2024-03');
      expect(evts).toHaveLength(1);
      expect(evts[0].label).toBe('Phase 2 Rollout');
    });

    it('does not emit diagnostics for valid new syntax', () => {
      const diags = diagnostics(
        'timeline\nEvent A start: 1718\nEvent B start: 1719, end: 1720'
      );
      expect(diags).toHaveLength(0);
    });
  });

  describe('uncertain ? suffix', () => {
    it('strips ? from end date and sets uncertain', () => {
      const evts = events('timeline\nEvent start: 1718, end: 1719?');
      expect(evts).toHaveLength(1);
      expect(evts[0].uncertain).toBe(true);
      expect(evts[0].endDate).toBe('1719');
    });

    it('strips ? from duration and sets uncertain', () => {
      const evts = events('timeline\nEvent start: 2026-03, duration: 30d?');
      expect(evts).toHaveLength(1);
      expect(evts[0].uncertain).toBe(true);
      expect(evts[0].endDate).not.toBeNull();
    });
  });

  describe('validation errors', () => {
    it('emits diagnostic when both end and duration present', () => {
      const result = parse(
        'timeline\nEvent start: 1718, end: 1719, duration: 30d'
      );
      expect(result.timelineEvents).toHaveLength(1);
      expect(result.timelineEvents[0].endDate).toBe('1719');
      const w = result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('not both')
      );
      expect(w).toHaveLength(1);
    });

    it('emits diagnostic when start is missing', () => {
      const result = parse('timeline\nEvent end: 1719');
      expect(result.timelineEvents).toHaveLength(0);
      const w = result.diagnostics.filter((d) =>
        d.message.includes("Expected 'start:'")
      );
      expect(w).toHaveLength(1);
    });

    it('emits diagnostic for empty start value', () => {
      const result = parse('timeline\nEvent start:, end: 1719');
      const w = result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('Empty start')
      );
      expect(w).toHaveLength(1);
    });

    it('emits diagnostic for invalid date format', () => {
      const result = parse('timeline\nEvent start: not-a-date');
      const w = result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('Invalid start')
      );
      expect(w).toHaveLength(1);
    });

    it('emits soft error for bare name without scheduling keys', () => {
      const result = parse('timeline\nJust A Name');
      const w = result.diagnostics.filter((d) =>
        d.message.includes("Expected 'start:'")
      );
      expect(w).toHaveLength(1);
    });
  });

  describe('migration warnings (legacy dual-accept)', () => {
    it('parses legacy point and emits migration warning', () => {
      const result = parse('timeline\n1718-05 Event Name');
      expect(result.timelineEvents).toHaveLength(1);
      expect(result.timelineEvents[0].date).toBe('1718-05');
      expect(result.timelineEvents[0].label).toBe('Event Name');
      const w = warnings('timeline\n1718-05 Event Name').filter((d) =>
        d.message.includes('syntax changed')
      );
      expect(w).toHaveLength(1);
      expect(w[0].message).toContain('Event Name start: 1718-05');
    });

    it('parses legacy range and emits migration warning', () => {
      const result = parse('timeline\n1716->1717 Event Name');
      expect(result.timelineEvents).toHaveLength(1);
      expect(result.timelineEvents[0].date).toBe('1716');
      expect(result.timelineEvents[0].endDate).toBe('1717');
      const w = warnings('timeline\n1716->1717 Event Name').filter((d) =>
        d.message.includes('syntax changed')
      );
      expect(w).toHaveLength(1);
      expect(w[0].message).toContain('Event Name start: 1716, end: 1717');
    });

    it('parses legacy duration and emits migration warning', () => {
      const result = parse('timeline\n2026-03->30d Sprint 1');
      expect(result.timelineEvents).toHaveLength(1);
      expect(result.timelineEvents[0].date).toBe('2026-03');
      const w = warnings('timeline\n2026-03->30d Sprint 1').filter((d) =>
        d.message.includes('syntax changed')
      );
      expect(w).toHaveLength(1);
      expect(w[0].message).toContain('Sprint 1 start: 2026-03, duration: 30d');
    });

    it('includes trailing metadata in migration suggestion', () => {
      const src =
        'timeline\ntag Pirate as p\n  Blackbeard\ntag Outcome as o\n  Victory\n1716->1717 Label p: Blackbeard, o: Victory';
      const w = warnings(src).filter((d) =>
        d.message.includes('syntax changed')
      );
      expect(w).toHaveLength(1);
      expect(w[0].message).toContain('pirate: Blackbeard');
      expect(w[0].message).toContain('outcome: Victory');
    });

    it('collapses warnings after 3rd occurrence', () => {
      const lines = [
        'timeline',
        '1716 Event A',
        '1717 Event B',
        '1718 Event C',
        '1719 Event D',
        '1720 Event E',
      ];
      const result = parse(lines.join('\n'));
      expect(result.timelineEvents).toHaveLength(5);
      const migrationWarns = result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('syntax changed')
      );
      expect(migrationWarns).toHaveLength(3);
      const collapseWarns = result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('more events use')
      );
      expect(collapseWarns).toHaveLength(1);
      expect(collapseWarns[0].message).toContain('2 more');
    });
  });

  describe('block-context safety', () => {
    it('era block entries do not trigger migration warnings', () => {
      const src = `timeline
era
  1716->1718 Nassau Republic
Event start: 1718`;
      const result = parse(src);
      expect(result.timelineEras).toHaveLength(1);
      const migrationWarns = result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('syntax changed')
      );
      expect(migrationWarns).toHaveLength(0);
    });

    it('marker block entries do not trigger migration warnings', () => {
      const src = `timeline
marker
  1718-07 Woodes Rogers arrives
Event start: 1718`;
      const result = parse(src);
      expect(result.timelineMarkers).toHaveLength(1);
      const migrationWarns = result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('syntax changed')
      );
      expect(migrationWarns).toHaveLength(0);
    });

    it('inline era does not trigger migration warnings', () => {
      const src = `timeline
era 1716->1718 Nassau Republic
Event start: 1718`;
      const result = parse(src);
      expect(result.timelineEras).toHaveLength(1);
      const migrationWarns = result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.message.includes('syntax changed')
      );
      expect(migrationWarns).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('name starting with digits uses new-syntax path', () => {
      const evts = events('timeline\n1776 Revolution start: 1776, end: 1783');
      expect(evts).toHaveLength(1);
      expect(evts[0].label).toBe('1776 Revolution');
      expect(evts[0].date).toBe('1776');
      expect(evts[0].endDate).toBe('1783');
    });

    it('parses decimal duration', () => {
      const evts = events('timeline\nEvent start: 2024-01, duration: 1.5m');
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
    });

    it('parses duration unit min', () => {
      const evts = events('timeline\nEvent start: 2024-01-15, duration: 30min');
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
    });

    it('preserves group context for new-syntax events', () => {
      const src = `timeline
[Phase 1]
  Event A start: 2024-01
  Event B start: 2024-02`;
      const evts = events(src);
      expect(evts).toHaveLength(2);
      expect(evts[0].group).toBe('Phase 1');
      expect(evts[1].group).toBe('Phase 1');
    });
  });
});
