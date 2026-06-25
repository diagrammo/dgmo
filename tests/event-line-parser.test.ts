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
    expect(p.options.alternate).toBe(true);
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

  it('honours no-scale and no-alternate directives', () => {
    const p = parseEventLine(`event-line X
no-scale
no-alternate

2020 A
  one`);
    expect(p.options.scale).toBe(false);
    expect(p.options.alternate).toBe(false);
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
    expect(
      p.diagnostics.some((d) => d.code === 'E_EVENT_LINE_BAD_DATE')
    ).toBe(true);
  });

  it('rejects a date range as a reserved seam', () => {
    const p = parseEventLine(`event-line X

2010 -> 2012 Era
  spans.`);
    expect(
      p.diagnostics.some((d) => d.code === 'E_EVENT_LINE_UNSUPPORTED')
    ).toBe(true);
  });

  it('flags `section` and `side` as unsupported v1 seams', () => {
    const p = parseEventLine(`event-line X

section Decade
side above

2020 A
  one`);
    const seams = p.diagnostics.filter(
      (d) => d.code === 'E_EVENT_LINE_UNSUPPORTED'
    );
    expect(seams.length).toBeGreaterThanOrEqual(2);
  });

  it('errors when there are no events', () => {
    const p = parseEventLine('event-line Empty');
    expect(
      p.diagnostics.some((d) => d.code === 'E_EVENT_LINE_NO_EVENTS')
    ).toBe(true);
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
});
