import { describe, it, expect } from 'vitest';
import { parseEventLine } from '../src/event-line/parser';

const errors = (p: ReturnType<typeof parseEventLine>) =>
  p.diagnostics.filter((d) => d.severity === 'error');

describe('event-line parser', () => {
  it('parses title + line-prefix date + trailing tag + bare-body description', () => {
    const p = parseEventLine(`event-line Super Bowl Halftime Shows

tag Genre as g
  Pop blue
  R&B teal

2012-02-05 XLVI  g: Pop
  **Madonna** with LMFAO, Nicki Minaj, M.I.A.
  - Greek-temple set, gladiators
  - Marching-band finale

2013-02-03 XLVII  g: R&B
  Beyoncé reunites Destiny's Child.`);

    expect(errors(p)).toHaveLength(0);
    expect(p.title).toBe('Super Bowl Halftime Shows');
    expect(p.tagGroups).toHaveLength(1);
    expect(p.events).toHaveLength(2);

    const [a, b] = p.events;
    expect(a!.label).toBe('XLVI');
    expect(a!.date).toBe('2012-02-05');
    expect(a!.dateValue).not.toBeNull();
    expect(a!.metadata['genre']).toBe('Pop');
    expect(a!.description).toEqual([
      '**Madonna** with LMFAO, Nicki Minaj, M.I.A.',
      '• Greek-temple set, gladiators',
      '• Marching-band finale',
    ]);
    expect(b!.metadata['genre']).toBe('R&B');
    expect(p.options.scale).toBe(true);
    expect(p.options.side).toBe('alternate');
  });

  it('defaults untagged events to the first tag value (§28.5)', () => {
    const p = parseEventLine(`event-line Defaults
tag Type as t
  Scope green
  Changes blue

2020-01-01 Alpha t: Changes
2021-01-01 Beta`);
    const [a, b] = p.events;
    // Explicit value is preserved; an untagged event inherits the first value.
    expect(a!.metadata['type']).toBe('Changes');
    expect(b!.metadata['type']).toBe('Scope');
  });

  it('treats a spaced title with no date prefix as the whole title', () => {
    const p = parseEventLine(`event-line Apollo 11

Translunar Injection
  The stack leaves Earth orbit.`);
    expect(errors(p)).toHaveLength(0);
    const e = p.events[0]!;
    expect(e.label).toBe('Translunar Injection');
    expect(e.date).toBeNull();
    expect(e.dateValue).toBeNull();
    expect(e.description).toEqual(['The stack leaves Earth orbit.']);
  });

  it('accepts year-only and full ISO dates', () => {
    const p = parseEventLine(`event-line A Short History of the Web
no-scale

1991 WorldWideWeb
  The first website at CERN.`);
    expect(errors(p)).toHaveLength(0);
    expect(p.options.scale).toBe(false);
    expect(p.events[0]!.date).toBe('1991');
    expect(p.events[0]!.label).toBe('WorldWideWeb');
  });

  it('honours no-scale, side, and no-box directives', () => {
    const p = parseEventLine(`event-line X
no-scale
side below
no-box

2020 A
  one`);
    expect(p.options.scale).toBe(false);
    expect(p.options.side).toBe('below');
    expect(p.options.noBox).toBe(true);
  });

  it('accepts side above', () => {
    const p = parseEventLine(`event-line X
side above

2020 A
  one`);
    expect(p.options.side).toBe('above');
  });

  it('honours no-legend', () => {
    const p = parseEventLine(`event-line X
no-legend

2020 A  one`);
    expect(p.options.noLegend).toBe(true);
  });

  it('accepts `direction LR` but flags `direction TB` as fast-follow', () => {
    const lr = parseEventLine(`event-line X
direction LR

2020 A
  one`);
    expect(
      lr.diagnostics.some((d) => d.code === 'E_EVENT_LINE_UNSUPPORTED')
    ).toBe(false);
    const tb = parseEventLine(`event-line X
direction TB

2020 A
  one`);
    expect(
      tb.diagnostics.some((d) => d.code === 'E_EVENT_LINE_UNSUPPORTED')
    ).toBe(true);
    // not parsed as a junk event
    expect(tb.events).toHaveLength(1);
    expect(tb.events[0]!.label).toBe('A');
  });

  it('keeps coincident dates and parses both events', () => {
    const p = parseEventLine(`event-line Apollo 11

1969-07-16 Liftoff
  Departs.
1969-07-16 Translunar Injection
  Leaves orbit.`);
    expect(errors(p)).toHaveLength(0);
    expect(p.events).toHaveLength(2);
    expect(p.events[0]!.dateValue).toBe(p.events[1]!.dateValue);
  });

  it('warns on a non-ISO (slash) date', () => {
    const p = parseEventLine(`event-line X

7/16/1969 Liftoff
  Departs.`);
    expect(p.diagnostics.some((d) => d.code === 'E_EVENT_LINE_BAD_DATE')).toBe(
      true
    );
  });

  it('rejects a date range as a reserved seam', () => {
    const p = parseEventLine(`event-line X

2010 -> 2012 Era
  spans.`);
    expect(
      p.diagnostics.some((d) => d.code === 'E_EVENT_LINE_UNSUPPORTED')
    ).toBe(true);
  });

  it('flags `section` as an unsupported v1 seam', () => {
    const p = parseEventLine(`event-line X

section Decade

2020 A
  one`);
    const seams = p.diagnostics.filter(
      (d) => d.code === 'E_EVENT_LINE_UNSUPPORTED'
    );
    expect(seams.length).toBeGreaterThanOrEqual(1);
  });

  it('errors when there are no events', () => {
    const p = parseEventLine('event-line Empty');
    expect(p.diagnostics.some((d) => d.code === 'E_EVENT_LINE_NO_EVENTS')).toBe(
      true
    );
  });

  it('errors on a tag block declared after content', () => {
    const p = parseEventLine(`event-line X

2020 A
  one

tag Genre as g
  Pop blue`);
    expect(
      p.diagnostics.some((d) => d.code === 'E_TAG_DECLARED_AFTER_CONTENT')
    ).toBe(true);
  });

  it('auto-colors a bare tag value', () => {
    const p = parseEventLine(`event-line X

tag Genre as g
  Pop

2020 A  g: Pop
  one`);
    expect(errors(p)).toHaveLength(0);
    expect(p.tagGroups[0]!.entries[0]!.color).not.toBe('');
  });

  describe('eras (`[Name]` indentation containers, §28.6a)', () => {
    it('nests indented events under each era; their bare body is the description', () => {
      const p = parseEventLine(`event-line A History of the Web
no-scale

[The Early Web]
  1991 WorldWideWeb
    one
  1993 Mosaic
    two

[The App Era]
  2005 Ajax
    three`);
      expect(errors(p)).toHaveLength(0);
      expect(p.eras.map((e) => e.name)).toEqual([
        'The Early Web',
        'The App Era',
      ]);
      expect(p.events.map((e) => e.era)).toEqual([
        'The Early Web',
        'The Early Web',
        'The App Era',
      ]);
      // event body is indented one level deeper than its (indented) event
      expect(p.events[0]!.description).toEqual(['one']);
      expect(p.events[0]!.label).toBe('WorldWideWeb');
    });

    it('accepts events outside any era (indent 0) alongside grouped ones', () => {
      const p = parseEventLine(`event-line X
no-scale

2018 Prologue
  before the eras

[Phase One]
  2020 A
    one`);
      expect(errors(p)).toHaveLength(0);
      expect(p.events[0]!.era).toBeNull();
      expect(p.events[0]!.description).toEqual(['before the eras']);
      expect(p.events[1]!.era).toBe('Phase One');
    });

    it('a dedent back to indent 0 ends the era (event becomes era-less)', () => {
      const p = parseEventLine(`event-line X
no-scale

[Phase One]
  2020 A
    one
2021 Epilogue
  after the era`);
      expect(errors(p)).toHaveLength(0);
      expect(p.events.map((e) => e.era)).toEqual(['Phase One', null]);
      expect(p.events[1]!.label).toBe('Epilogue');
      expect(p.events[1]!.description).toEqual(['after the era']);
    });

    it('parses `collapsed: true` and an optional era color', () => {
      const p = parseEventLine(`event-line X
no-scale

[Phase One] collapsed: true blue
  2020 A
    one

[Phase Two]
  2021 B
    two`);
      expect(errors(p)).toHaveLength(0);
      expect(p.eras[0]!.name).toBe('Phase One');
      expect(p.eras[0]!.collapsed).toBe(true);
      expect(p.eras[0]!.color).toBe('blue');
      expect(p.eras[1]!.collapsed).toBe(false);
      expect(p.eras[1]!.color).toBeNull();
    });

    it('preserves era name casing verbatim (no forced caps)', () => {
      const p = parseEventLine(`event-line X
no-scale

[the eARLY web]
  2020 A
    one`);
      expect(p.eras[0]!.name).toBe('the eARLY web');
    });

    it('treats an era declaration as content (tags after it error)', () => {
      const p = parseEventLine(`event-line X

[Phase One]
  2020 A
    one

tag Genre as g
  Pop blue`);
      expect(
        p.diagnostics.some((d) => d.code === 'E_TAG_DECLARED_AFTER_CONTENT')
      ).toBe(true);
    });

    it('warns when an event reaches forward past a later era start', () => {
      const p = parseEventLine(`event-line X

[Vasanth]
  2025-04-01 Opening Day Outage
  2025-05-09 Fire Kevin C

[Curtis]
  2025-04-15 Sean Curtis CTO
  2025-09-01 The incident`);
      const w = p.diagnostics.filter(
        (d) => d.code === 'E_EVENT_LINE_ERA_DATE_ORDER'
      );
      expect(w.length).toBeGreaterThan(0);
      // The straggler poking into the later era is flagged on its own line.
      const fwd = w.find((d) => d.message.includes('Fire Kevin C'));
      expect(fwd).toBeDefined();
      expect(fwd!.severity).toBe('warning');
      expect(fwd!.message).toContain('Curtis');
      expect(fwd!.message).toContain('2025-04-15');
    });

    it('warns when an event is dated before an earlier era ends', () => {
      const p = parseEventLine(`event-line X

[A]
  2020 First
  2024 Late

[B]
  2022 Early`);
      const w = p.diagnostics.filter(
        (d) => d.code === 'E_EVENT_LINE_ERA_DATE_ORDER'
      );
      expect(w.some((d) => d.message.includes('Early'))).toBe(true);
    });

    it('does not warn when eras are chronologically ordered', () => {
      const p = parseEventLine(`event-line X

[A]
  2020 a1
  2021 a2

[B]
  2022 b1
  2023 b2`);
      expect(
        p.diagnostics.filter((d) => d.code === 'E_EVENT_LINE_ERA_DATE_ORDER')
      ).toHaveLength(0);
    });

    it('skips the era-order check when the date scale is off', () => {
      const p = parseEventLine(`event-line X
no-scale

[A]
  2024 late

[B]
  2020 early`);
      expect(
        p.diagnostics.filter((d) => d.code === 'E_EVENT_LINE_ERA_DATE_ORDER')
      ).toHaveLength(0);
    });
  });
});
