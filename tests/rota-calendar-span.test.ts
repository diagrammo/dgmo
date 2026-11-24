import { describe, it, expect } from 'vitest';
import { parseCalendar, CALENDAR_MAX_SPAN_YEARS } from '../src/calendar/parser';

const codes = (src: string) =>
  parseCalendar(src).diagnostics.map((d) => d.code);

describe('calendar span cap (#2274)', () => {
  it('reports E_CALENDAR_SPAN_TOO_LONG past the cap and clamps the span', () => {
    const r = parseCalendar('calendar Big\nfrom 2000-01-01 to 9999-12-31\n');
    expect(r.diagnostics.map((d) => d.code)).toContain(
      'E_CALENDAR_SPAN_TOO_LONG'
    );
    expect(r.start).not.toBeNull();
    expect(r.end! - r.start!).toBeLessThanOrEqual(
      CALENDAR_MAX_SPAN_YEARS * 366
    );
  });

  it('a span of exactly the cap is accepted', () => {
    expect(codes('calendar Ok\nfrom 2020-01-01 to 2029-12-31\n')).not.toContain(
      'E_CALENDAR_SPAN_TOO_LONG'
    );
  });

  it('the parsed span does not follow the requested span past the cap', () => {
    const size = (to: string) => {
      const r = parseCalendar(`calendar Big\nfrom 2000-01-01 to ${to}\n`);
      return r.end! - r.start!;
    };
    expect(size('9999-12-31')).toBe(size('2500-12-31'));
  });

  it('entries far apart are clamped too', () => {
    const r = parseCalendar('calendar Far\n2000-01-01 1\n9999-12-31 1\n');
    expect(r.diagnostics.map((d) => d.code)).toContain(
      'E_CALENDAR_SPAN_TOO_LONG'
    );
    expect(r.end! - r.start!).toBeLessThanOrEqual(
      CALENDAR_MAX_SPAN_YEARS * 366
    );
  });
});
