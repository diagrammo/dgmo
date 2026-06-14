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

describe('timeline parser — date-first syntax', () => {
  describe('point events', () => {
    it('parses year-only date', () => {
      const evts = events('timeline\n1716 Joins crew');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1716');
      expect(evts[0].endDate).toBeNull();
      expect(evts[0].label).toBe('Joins crew');
    });

    it('parses year-month date', () => {
      const evts = events('timeline\n1718-05 Blockades Charleston');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1718-05');
      expect(evts[0].endDate).toBeNull();
      expect(evts[0].label).toBe('Blockades Charleston');
    });

    it('parses full date', () => {
      const evts = events('timeline\n1718-11-22 Final battle');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1718-11-22');
    });

    it('parses datetime with HH:MM', () => {
      const evts = events('timeline\n2026-03-20 14:30 Standup Meeting');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2026-03-20 14:30');
      expect(evts[0].label).toBe('Standup Meeting');
    });

    it('parses single-digit hour', () => {
      const evts = events('timeline\n2026-03-20 9:30 Morning Standup');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2026-03-20 9:30');
      expect(evts[0].label).toBe('Morning Standup');
    });

    it('parses midnight 00:00', () => {
      const evts = events('timeline\n2026-03-20 0:00 Midnight Event');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2026-03-20 0:00');
    });

    it('parses noon 12:00', () => {
      const evts = events('timeline\n2026-03-20 12:00 Noon Event');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2026-03-20 12:00');
    });
  });

  describe('range events', () => {
    it('parses range with spaces around arrow', () => {
      const evts = events('timeline\n1716 -> 1717 Sails under Hornigold');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1716');
      expect(evts[0].endDate).toBe('1717');
      expect(evts[0].label).toBe('Sails under Hornigold');
    });

    it('parses range with no spaces around arrow', () => {
      const evts = events('timeline\n1716->1717 Sails under Hornigold');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1716');
      expect(evts[0].endDate).toBe('1717');
      expect(evts[0].label).toBe('Sails under Hornigold');
    });

    it('parses range with full dates', () => {
      const evts = events('timeline\n2024-01-15 -> 2024-03-15 Sprint Planning');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2024-01-15');
      expect(evts[0].endDate).toBe('2024-03-15');
    });

    it('parses range with datetime', () => {
      const evts = events(
        'timeline\n2024-01-15 14:30 -> 2024-01-16 09:00 Meeting'
      );
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2024-01-15 14:30');
      expect(evts[0].endDate).toBe('2024-01-16 09:00');
    });
  });

  describe('duration events', () => {
    it('parses duration after name', () => {
      const evts = events('timeline\n2026-03-20 Sprint 1 30d');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('2026-03-20');
      expect(evts[0].label).toBe('Sprint 1');
      expect(evts[0].endDate).not.toBeNull();
    });

    it('parses weeks duration', () => {
      const evts = events('timeline\n2026-03-20 Sprint 1 2w');
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
    });

    it('parses months duration', () => {
      const evts = events('timeline\n2024-01 Phase 1 3m');
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
    });

    it('parses year duration', () => {
      const evts = events('timeline\n2024 Long project 2y');
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
    });

    it('parses hour duration', () => {
      const evts = events('timeline\n2024-01-15 10:00 Session 2h');
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
    });

    it('parses minute duration', () => {
      const evts = events('timeline\n2024-01-15 10:00 Break 30min');
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
    });

    it('parses decimal duration', () => {
      const evts = events('timeline\n2024-01 Phase 1 1.5m');
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
    });

    it('duration: metadata key is canonical (no positional-duration error)', () => {
      const src = 'timeline\n2026-03-20 Phase Review duration: 30d';
      const evts = events(src);
      expect(evts).toHaveLength(1);
      expect(evts[0].endDate).not.toBeNull();
      expect(
        diagnostics(src).some(
          (d) => d.code === 'E_TIMELINE_BARE_DURATION_REMOVED'
        )
      ).toBe(false);
    });

    it('positional duration still applies but errors (1.0: duration: is canonical)', () => {
      const src = 'timeline\n2026-03-20 Sprint 1 30d';
      expect(events(src)[0].endDate).not.toBeNull();
      const err = diagnostics(src).find(
        (d) => d.code === 'E_TIMELINE_BARE_DURATION_REMOVED'
      );
      expect(err).toBeDefined();
      expect(err!.severity).toBe('error');
    });
  });

  describe('uncertain ? suffix', () => {
    it('uncertain end date', () => {
      const evts = events('timeline\n1718 -> 1719? Rackham builds crew');
      expect(evts).toHaveLength(1);
      expect(evts[0].uncertain).toBe(true);
      expect(evts[0].endDate).toBe('1719');
    });

    it('uncertain duration', () => {
      const evts = events('timeline\n2026-03-20 Sprint 1 30d?');
      expect(evts).toHaveLength(1);
      expect(evts[0].uncertain).toBe(true);
      expect(evts[0].endDate).not.toBeNull();
    });
  });

  describe('metadata', () => {
    it('parses trailing metadata', () => {
      const evts = events(
        'timeline\ntag Pirate as p\n  Blackbeard red\n1718-05 Blockades Charleston p: Blackbeard'
      );
      expect(evts).toHaveLength(1);
      expect(evts[0].metadata['pirate']).toBe('Blackbeard');
    });

    it('parses multiple metadata keys', () => {
      const evts = events(
        'timeline\ntag Pirate as p\n  Blackbeard red\n1718-05 Blockades Charleston p: Blackbeard, color: red'
      );
      expect(evts).toHaveLength(1);
      expect(evts[0].metadata['pirate']).toBe('Blackbeard');
    });

    it('parses metadata with duration', () => {
      const evts = events(
        'timeline\ntag Team as t\n  Engineering blue\n2026-03-20 Sprint 1 30d t: Engineering'
      );
      expect(evts).toHaveLength(1);
      expect(evts[0].label).toBe('Sprint 1');
      expect(evts[0].metadata['team']).toBe('Engineering');
      expect(evts[0].endDate).not.toBeNull();
    });
  });

  describe('groups', () => {
    it('assigns group to indented events', () => {
      const src = `timeline
[Phase 1]
  2024-01 Event A
  2024-02 Event B`;
      const evts = events(src);
      expect(evts).toHaveLength(2);
      expect(evts[0].group).toBe('Phase 1');
      expect(evts[1].group).toBe('Phase 1');
    });

    it('clears group on un-indented line', () => {
      const src = `timeline
[Phase 1]
  2024-01 Event A
2024-02 Event B`;
      const evts = events(src);
      expect(evts).toHaveLength(2);
      expect(evts[0].group).toBe('Phase 1');
      expect(evts[1].group).toBeNull();
    });

    it('parses group with trailing metadata', () => {
      const src = `timeline
tag Team as t
  British blue
[Royal Navy] t: British
  1718-07 Woodes Rogers arrives`;
      const result = parse(src);
      expect(result.timelineGroups).toHaveLength(1);
      expect(result.timelineGroups[0].metadata).toHaveProperty('team');
      expect(result.timelineGroups[0].metadata['team']).toBe('British');
    });

    it('group metadata inherits to child events', () => {
      const src = `timeline
tag Team as t
  British blue
  Pirate red
[Royal Navy] t: British
  1718-07 Woodes Rogers arrives`;
      const evts = events(src);
      expect(evts).toHaveLength(1);
      expect(evts[0].metadata['team']).toBe('British');
    });

    it('event metadata overrides group metadata', () => {
      const src = `timeline
tag Team as t
  British blue
  Pirate red
[Royal Navy] t: British
  1718-07 Woodes Rogers arrives t: Pirate`;
      const evts = events(src);
      expect(evts).toHaveLength(1);
      expect(evts[0].metadata['team']).toBe('Pirate');
    });

    it('parses group with trailing color', () => {
      const src = `timeline
[Royal Navy] blue
  1718-07 Woodes Rogers arrives`;
      const result = parse(src);
      expect(result.timelineGroups).toHaveLength(1);
      expect(result.timelineGroups[0].color).not.toBeNull();
    });
  });

  describe('duration guard', () => {
    it('does not misparse duration-like token right after date', () => {
      const evts = events('timeline\n1918 42d Street Parade');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1918');
      expect(evts[0].label).toBe('42d Street Parade');
      expect(evts[0].endDate).toBeNull();
    });

    it('allows positional duration after name word', () => {
      const evts = events('timeline\n1918 42d Street Parade 30d');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1918');
      expect(evts[0].label).toBe('42d Street Parade');
      expect(evts[0].endDate).not.toBeNull();
    });
  });

  describe('names starting with numbers', () => {
    it('handles numeric name prefix', () => {
      const evts = events('timeline\n1718 3rd Crusade');
      expect(evts).toHaveLength(1);
      expect(evts[0].date).toBe('1718');
      expect(evts[0].label).toBe('3rd Crusade');
    });
  });

  describe('eras and markers (unchanged)', () => {
    it('parses inline era', () => {
      const src = 'timeline\nera 1716 -> 1718 Nassau Republic';
      const result = parse(src);
      expect(result.timelineEras).toHaveLength(1);
      expect(result.timelineEras[0].startDate).toBe('1716');
      expect(result.timelineEras[0].endDate).toBe('1718');
      expect(result.timelineEras[0].label).toBe('Nassau Republic');
    });

    it('parses inline marker', () => {
      const src = 'timeline\nmarker 1718-07 Woodes Rogers arrives orange';
      const result = parse(src);
      expect(result.timelineMarkers).toHaveLength(1);
      expect(result.timelineMarkers[0].date).toBe('1718-07');
      expect(result.timelineMarkers[0].label).toBe('Woodes Rogers arrives');
    });

    it('parses era block', () => {
      const src = `timeline
era
  1716->1718 Nassau Republic
1718 Event`;
      const result = parse(src);
      expect(result.timelineEras).toHaveLength(1);
      expect(result.timelineEvents).toHaveLength(1);
    });

    it('parses marker block', () => {
      const src = `timeline
marker
  1718-07 Woodes Rogers arrives
1718 Event`;
      const result = parse(src);
      expect(result.timelineMarkers).toHaveLength(1);
      expect(result.timelineEvents).toHaveLength(1);
    });
  });

  describe('tag groups', () => {
    it('parses tag block', () => {
      const src = `timeline
tag Crew as p
  Blackbeard red
  Hornigold blue
1716 Joins crew p: Blackbeard`;
      const result = parse(src);
      expect(result.timelineTagGroups).toHaveLength(1);
      expect(result.timelineTagGroups[0].name).toBe('Crew');
      expect(result.timelineEvents[0].metadata['crew']).toBe('Blackbeard');
    });
  });

  describe('diagnostics', () => {
    it('warns on invalid time', () => {
      const w = warnings('timeline\n2026-03-20 25:00 Invalid Time');
      expect(w.some((d) => d.message.includes('Hours must be 0-23'))).toBe(
        true
      );
    });

    it('warns on bare name without date', () => {
      const w = warnings('timeline\nJust A Name');
      expect(w.some((d) => d.message.includes('Expected a date'))).toBe(true);
    });

    it('warns when line starts with invalid numeric prefix', () => {
      const w = warnings('timeline\n17 Some Event');
      expect(w.some((d) => d.message.includes('Expected date format'))).toBe(
        true
      );
    });

    it('no diagnostics for valid events', () => {
      const diags = diagnostics('timeline\n1718 Event A\n1716 -> 1717 Event B');
      expect(diags).toHaveLength(0);
    });

    it('warns on bare date with no name (AC 17)', () => {
      const w = warnings('timeline\n1718');
      expect(w.some((d) => d.message.includes('Event needs a name'))).toBe(
        true
      );
    });

    it('warns on bare range with no name', () => {
      const w = warnings('timeline\n1716 -> 1717');
      expect(w.some((d) => d.message.includes('Event needs a name'))).toBe(
        true
      );
    });

    it('warns when both end date and duration: metadata present', () => {
      const result = parse('timeline\n1716 -> 1717 Event duration: 30d');
      const w = result.diagnostics.filter(
        (d) =>
          d.severity === 'warning' &&
          d.message.includes('both an end date and duration')
      );
      expect(w).toHaveLength(1);
      expect(result.timelineEvents[0].endDate).toBe('1717');
    });

    it('range with trailing duration-like token keeps it in name', () => {
      const evts = events('timeline\n1716 -> 1717 Event 30d');
      expect(evts).toHaveLength(1);
      expect(evts[0].label).toBe('Event 30d');
      expect(evts[0].endDate).toBe('1717');
    });

    it('no events found warning', () => {
      const w = warnings('timeline');
      expect(w.some((d) => d.message.includes('No events found'))).toBe(true);
    });
  });

  describe('realistic multi-event timeline', () => {
    it('parses the pirate timeline from the spec', () => {
      const src = `timeline Golden Age of Piracy

tag Crew as p
  Blackbeard red
  Hornigold blue
  Rackham green

era 1716 -> 1718 Nassau Republic
era 1718 -> 1720 Woodes Rogers Era orange

[Blackbeard]
  1716 Joins Hornigold's crew p: Blackbeard
  1716 -> 1717 Learns navigation p: Blackbeard
  1717 -> 1718 Commands Queen Anne's Revenge p: Blackbeard
  1718-05 Blockades Charleston p: Blackbeard
  1718-11 Final battle at Ocracoke p: Blackbeard

[Hornigold]
  1713 Begins privateering p: Hornigold
  1716 -> 1717 Mentors Blackbeard p: Hornigold
  1718 Accepts royal pardon p: Hornigold
  1718 -> 1719 Hunts former allies p: Hornigold

[Royal Navy] t: British
  1718-07 Woodes Rogers arrives
  1718 -> 1720 Nassau occupation
  1720-01 Pardons expire

marker 1718-07 Woodes Rogers arrives orange
marker 1720-01 End of Golden Age red`;

      const result = parse(src);
      expect(result.title).toBe('Golden Age of Piracy');
      expect(result.timelineEvents.length).toBeGreaterThanOrEqual(12);
      expect(result.timelineEras).toHaveLength(2);
      expect(result.timelineMarkers).toHaveLength(2);
      expect(result.timelineGroups).toHaveLength(3);
      expect(result.timelineTagGroups).toHaveLength(1);

      // Verify group assignment
      const blackbeardEvents = result.timelineEvents.filter(
        (e) => e.group === 'Blackbeard'
      );
      expect(blackbeardEvents.length).toBe(5);

      // Verify duration event
      const nassauOccupation = result.timelineEvents.find((e) =>
        e.label.includes('Nassau occupation')
      );
      expect(nassauOccupation).toBeDefined();
      expect(nassauOccupation!.endDate).not.toBeNull();

      // Verify tag metadata
      const joinsCrew = result.timelineEvents.find((e) =>
        e.label.includes('Joins Hornigold')
      );
      expect(joinsCrew).toBeDefined();
      expect(joinsCrew!.metadata['crew']).toBe('Blackbeard');
    });
  });
});

describe('timeline parser — display directives (§15.6)', () => {
  it('defaults: scale on, swimlanes off, no active-tag', () => {
    const p = parse('timeline\n1716 Joins crew');
    expect(p.timelineScale).toBe(true);
    expect(p.timelineSwimlanes).toBe(false);
    expect(p.timelineActiveTag).toBeUndefined();
  });

  it('`no-scale` drops the date scale', () => {
    const p = parse('timeline\nno-scale\n1716 Joins crew');
    expect(p.timelineScale).toBe(false);
    // directive is consumed, not treated as an event
    expect(p.timelineEvents).toHaveLength(1);
    expect(warnings('timeline\nno-scale\n1716 Joins crew')).toHaveLength(0);
  });

  it('`swimlanes` forces swimlane rendering', () => {
    const p = parse('timeline\nswimlanes\n1716 Joins crew');
    expect(p.timelineSwimlanes).toBe(true);
    expect(p.timelineEvents).toHaveLength(1);
  });

  it('`active-tag <group>` is captured for render-time resolution', () => {
    const p = parse(
      'timeline\ntag Crew as c\n  Blackbeard red\n  Bonnet green\nactive-tag Crew\n1716 Joins crew c: Blackbeard'
    );
    expect(p.timelineActiveTag).toBe('Crew');
  });

  it('`active-tag none` is captured (suppresses colouring at render)', () => {
    const p = parse('timeline\nactive-tag none\n1716 Joins crew');
    expect(p.timelineActiveTag).toBe('none');
  });

  it('none of the directives emit "expected a date" warnings', () => {
    const w = warnings(
      'timeline\nno-scale\nswimlanes\nactive-tag none\n1716 Joins crew'
    );
    expect(w).toHaveLength(0);
  });
});
