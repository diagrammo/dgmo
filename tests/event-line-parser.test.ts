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

  describe('eras (`[Name]` run delimiters, §28.6a)', () => {
    it('opens an era that runs to the next `[Name]` or EOF', () => {
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
      // events stay at indent 0 → bare-body description preserved
      expect(p.events[0]!.description).toEqual(['one']);
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

    it('events before any era have a null era', () => {
      const p = parseEventLine(`event-line X
no-scale

2019 Pre
  zero

[Phase One]
2020 A
  one`);
      expect(p.events[0]!.era).toBeNull();
      expect(p.events[1]!.era).toBe('Phase One');
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
  });
});
