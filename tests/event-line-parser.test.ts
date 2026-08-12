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

  it('keeps a blank line inside a body as a paragraph break', () => {
    const p = parseEventLine(`event-line Apollo
no-scale

Translunar Injection
  The stack leaves Earth orbit.

  Three days to the Moon.`);
    expect(errors(p)).toHaveLength(0);
    expect(p.events[0]!.description).toEqual([
      'The stack leaves Earth orbit.',
      '',
      'Three days to the Moon.',
    ]);
  });

  it('does not leave an empty line from blanks around a body', () => {
    const p = parseEventLine(`event-line Apollo
no-scale


Translunar Injection

  The stack leaves Earth orbit.


Splashdown
  Recovery in the Pacific.`);
    expect(errors(p)).toHaveLength(0);
    expect(p.events[0]!.description).toEqual(['The stack leaves Earth orbit.']);
    expect(p.events[1]!.description).toEqual(['Recovery in the Pacific.']);
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

  it('accepts `direction-lr` (default restate) but flags `direction-tb` (decision #48)', () => {
    const lr = parseEventLine(`event-line X
direction-lr

2020 A
  one`);
    expect(
      lr.diagnostics.some((d) => d.code === 'E_EVENT_LINE_UNSUPPORTED')
    ).toBe(false);
    const tb = parseEventLine(`event-line X
direction-tb

2020 A
  one`);
    const diag = tb.diagnostics.find(
      (d) => d.code === 'E_EVENT_LINE_UNSUPPORTED'
    );
    expect(diag).toBeDefined();
    // The diagnostic names the boolean form, not the legacy space form.
    expect(diag!.message).toContain('direction-tb');
    // not parsed as junk events
    expect(lr.events).toHaveLength(1);
    expect(tb.events).toHaveLength(1);
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

  it('`year` directive supplies the year for bare month-days (BL-121)', () => {
    const p = parseEventLine(`event-line X
year 2026

7/4 Independence
9/2 Labor Day`);
    expect(p.events.map((e) => e.date)).toEqual(['2026-07-04', '2026-09-02']);
    expect(p.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('carry-forward + rollover from an explicit anchor (BL-121)', () => {
    const p = parseEventLine(`event-line X

2026-11-01 Kickoff
12-15 Release candidate
01-10 Launch`);
    expect(p.events.map((e) => e.date)).toEqual([
      '2026-11-01',
      '2026-12-15',
      '2027-01-10', // rolled: Jan < Dec
    ]);
  });

  it('`date-order dmy` reads a slash date day-first (BL-121)', () => {
    const p = parseEventLine(`event-line X
year 2026
date-order dmy

7/4 Something`);
    expect(p.events[0]!.date).toBe('2026-04-07');
  });

  it('accepts a US slash date (month-first) and normalizes to ISO (BL-121)', () => {
    const p = parseEventLine(`event-line X

7/16/1969 Liftoff
  Departs.`);
    expect(p.diagnostics.some((d) => d.code === 'E_EVENT_LINE_BAD_DATE')).toBe(
      false
    );
    expect(p.events[0]!.date).toBe('1969-07-16');
    expect(p.events[0]!.label).toBe('Liftoff');
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

  describe('out-of-order event dates', () => {
    it('warns on a dated event listed before an earlier-dated one', () => {
      const p = parseEventLine(`event-line X

2020 A
2024 B
2022 C`);
      const w = p.diagnostics.filter(
        (d) => d.code === 'E_EVENT_LINE_DATE_ORDER'
      );
      expect(w).toHaveLength(1);
      expect(w[0]!.severity).toBe('warning');
      expect(w[0]!.message).toContain('C');
      expect(w[0]!.message).toContain('2022');
      expect(w[0]!.message).toContain('B');
    });

    it('does not warn when events are listed chronologically', () => {
      const p = parseEventLine(`event-line X

2020 A
2022 B
2024 C`);
      expect(
        p.diagnostics.filter((d) => d.code === 'E_EVENT_LINE_DATE_ORDER')
      ).toHaveLength(0);
    });

    it('treats coincident dates as in order', () => {
      const p = parseEventLine(`event-line X

1969-07-16 Liftoff
1969-07-16 Translunar Injection`);
      expect(
        p.diagnostics.filter((d) => d.code === 'E_EVENT_LINE_DATE_ORDER')
      ).toHaveLength(0);
    });

    it('skips undated events when checking order', () => {
      const p = parseEventLine(`event-line X

2020 A
Undated note
2022 B`);
      expect(
        p.diagnostics.filter((d) => d.code === 'E_EVENT_LINE_DATE_ORDER')
      ).toHaveLength(0);
    });

    it('warns even when the date scale is off', () => {
      const p = parseEventLine(`event-line X
no-scale

2024 late
2020 early`);
      const w = p.diagnostics.filter(
        (d) => d.code === 'E_EVENT_LINE_DATE_ORDER'
      );
      expect(w).toHaveLength(1);
      expect(w[0]!.message).toContain('early');
    });

    it('does not double-flag an era-spanning inversion', () => {
      // The straggler is reported once, by the richer ERA_DATE_ORDER check.
      const p = parseEventLine(`event-line X

[A]
  2020 First
  2024 Late

[B]
  2022 Early`);
      const order = p.diagnostics.filter(
        (d) => d.code === 'E_EVENT_LINE_DATE_ORDER'
      );
      const eraOrder = p.diagnostics.filter(
        (d) => d.code === 'E_EVENT_LINE_ERA_DATE_ORDER'
      );
      expect(eraOrder.some((d) => d.message.includes('Early'))).toBe(true);
      expect(order).toHaveLength(0);
    });
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

  describe('TBD / future events', () => {
    it('reads a TBD prefix as a future event with a "TBD" caption', () => {
      const p = parseEventLine(`event-line Roadmap
2024-01-01 Shipped
TBD Someday Feature
  Not yet scheduled.`);
      expect(errors(p)).toHaveLength(0);
      const f = p.events[1]!;
      expect(f.future).toBe(true);
      expect(f.date).toBe('TBD');
      expect(f.label).toBe('Someday Feature');
      expect(f.description).toEqual(['Not yet scheduled.']);
    });

    it('does not emit a BAD_DATE warning for TBD', () => {
      const p = parseEventLine(`event-line X
2024 A
TBD B`);
      expect(
        p.diagnostics.filter((d) => d.code === 'E_EVENT_LINE_BAD_DATE')
      ).toHaveLength(0);
    });

    it('resolves a future event past the latest real date so scale survives', () => {
      const p = parseEventLine(`event-line X
2020 A
2024 B
TBD C`);
      const [a, , c] = p.events;
      expect(c!.dateValue).not.toBeNull();
      // Future event plots to the RIGHT of every real-dated event.
      expect(c!.dateValue!).toBeGreaterThan(a!.dateValue!);
      expect(c!.dateValue!).toBeGreaterThan(2024);
    });

    it('keeps coincident TBD events distinct (so dots fan apart)', () => {
      const p = parseEventLine(`event-line X
2020 A
TBD B
TBD C`);
      const b = p.events[1]!;
      const c = p.events[2]!;
      expect(b.dateValue).not.toBe(c.dateValue);
    });

    it('leaves a lone TBD event undated when there is nothing to anchor against', () => {
      const p = parseEventLine(`event-line X
TBD A
TBD B`);
      expect(p.events[0]!.future).toBe(true);
      expect(p.events[0]!.dateValue).toBeNull();
    });

    it('interpolates a TBD between two dated neighbors (hard date after)', () => {
      const p = parseEventLine(`event-line X
2020 A
TBD B
2030 C`);
      const b = p.events[1]!;
      expect(b.future).toBe(true);
      // Sits strictly inside the (2020, 2030) gap, not parked past the end.
      expect(b.dateValue!).toBeGreaterThan(2020);
      expect(b.dateValue!).toBeLessThan(2030);
      // Carries the gap span for the whisker cue.
      expect(b.futureSpan).toEqual([2020, 2030]);
    });

    it('parks a trailing TBD past the last date with no span (open horizon)', () => {
      const p = parseEventLine(`event-line X
2020 A
2030 C
TBD B`);
      const b = p.events[2]!;
      expect(b.dateValue!).toBeGreaterThan(2030);
      expect(b.futureSpan).toBeNull();
    });

    it('fans multiple TBDs evenly across a shared gap', () => {
      const p = parseEventLine(`event-line X
2020 A
TBD B
TBD C
2030 D`);
      const b = p.events[1]!;
      const c = p.events[2]!;
      expect(b.dateValue!).toBeGreaterThan(2020);
      expect(b.dateValue!).toBeLessThan(c.dateValue!);
      expect(c.dateValue!).toBeLessThan(2030);
    });

    it('does not flag an interpolated TBD as out-of-order', () => {
      const p = parseEventLine(`event-line X
2020 A
TBD B
2030 C`);
      expect(
        p.diagnostics.filter((d) => d.code === 'E_EVENT_LINE_DATE_ORDER')
      ).toHaveLength(0);
    });

    it('places a leading TBD before the first dated event', () => {
      const p = parseEventLine(`event-line X
TBD A
2030 B`);
      const a = p.events[0]!;
      expect(a.future).toBe(true);
      expect(a.dateValue!).toBeLessThan(2030);
      expect(a.futureSpan![1]).toBe(2030);
    });

    it('matches TBD case-insensitively', () => {
      const p = parseEventLine(`event-line X
2020 A
tbd B`);
      expect(p.events[1]!.future).toBe(true);
      expect(p.events[1]!.label).toBe('B');
    });

    it('treats a word merely starting with "tbd" as a normal title', () => {
      const p = parseEventLine(`event-line X
Tbderror happens`);
      expect(p.events[0]!.future).toBe(false);
      expect(p.events[0]!.label).toBe('Tbderror happens');
    });
  });

  describe('now marker (§28.7)', () => {
    it('parses bare `now` as computed with the default label', () => {
      const p = parseEventLine(`event-line X
now

2020 A
2024 B`);
      expect(errors(p)).toHaveLength(0);
      expect(p.now).not.toBeNull();
      expect(p.now!.computed).toBe(true);
      expect(p.now!.date).toBeNull();
      expect(p.now!.dateValue).toBeNull();
      // No author caption — the renderer captions the tab with the date it
      // resolves, so the mark says WHEN it was drawn.
      expect(p.now!.label).toBeNull();
    });

    it('pins `now <date>` to an explicit ISO date', () => {
      const p = parseEventLine(`event-line X
now 2022-06

2020 A
2024 B`);
      expect(errors(p)).toHaveLength(0);
      expect(p.now!.computed).toBe(false);
      expect(p.now!.date).toBe('2022-06');
      expect(p.now!.dateValue).not.toBeNull();
      expect(p.now!.label).toBeNull();
    });

    it('takes a trailing token after the pinned date as a custom label', () => {
      const p = parseEventLine(`event-line X
now 2022-06 Today

2020 A
2024 B`);
      expect(p.now!.label).toBe('Today');
      expect(p.now!.date).toBe('2022-06');
    });

    it('warns on an unparseable `now` date', () => {
      const p = parseEventLine(`event-line X
now someday

2020 A`);
      const warns = p.diagnostics.filter((d) => d.severity === 'warning');
      expect(warns.some((d) => d.code === 'E_EVENT_LINE_BAD_DATE')).toBe(true);
      expect(p.now).toBeNull();
    });

    it('warns that `now` is ignored under `no-scale`', () => {
      const p = parseEventLine(`event-line X
no-scale
now 2022

2020 A
2024 B`);
      const warns = p.diagnostics.filter((d) => d.severity === 'warning');
      expect(
        warns.some(
          (d) =>
            d.code === 'E_EVENT_LINE_UNSUPPORTED' && /no-scale/.test(d.message)
        )
      ).toBe(true);
    });

    it('takes a trailing named color on a bare `now`', () => {
      const p = parseEventLine(`event-line X
now blue

2020 A
2024 B`);
      expect(errors(p)).toHaveLength(0);
      expect(p.now!.computed).toBe(true);
      expect(p.now!.color).toBe('blue');
      expect(p.now!.date).toBeNull();
      expect(p.now!.label).toBeNull();
    });

    it('takes a trailing named color after a pinned date', () => {
      const p = parseEventLine(`event-line X
now 2022-06 teal

2020 A
2024 B`);
      expect(errors(p)).toHaveLength(0);
      expect(p.now!.color).toBe('teal');
      expect(p.now!.date).toBe('2022-06');
      expect(p.now!.label).toBeNull();
    });

    it('takes a color after a custom caption, keeping both', () => {
      const p = parseEventLine(`event-line X
now 2022-06 Today purple

2020 A
2024 B`);
      expect(p.now!.color).toBe('purple');
      expect(p.now!.label).toBe('Today');
      expect(p.now!.date).toBe('2022-06');
    });

    it('leaves the pin red when no color is given', () => {
      const p = parseEventLine(`event-line X
now 2022-06

2020 A`);
      expect(p.now!.color).toBeNull();
    });

    it('keeps a capitalized caption word out of the color slot', () => {
      // The trailing-token color rule is case-sensitive (§1.5), so a caption
      // reading `Red` stays a caption.
      const p = parseEventLine(`event-line X
now 2022-06 Red

2020 A`);
      expect(p.now!.color).toBeNull();
      expect(p.now!.label).toBe('Red');
    });

    it('rejects a hex value and leaves the pin red', () => {
      const p = parseEventLine(`event-line X
now 2022-06 #ff0000

2020 A`);
      expect(p.now!.color).toBeNull();
      expect(p.now!.date).toBe('2022-06');
    });

    it('last `now` directive wins', () => {
      const p = parseEventLine(`event-line X
now 2021
now 2023

2020 A`);
      expect(p.now!.date).toBe('2023');
    });
  });
});
