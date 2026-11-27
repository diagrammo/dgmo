import { describe, it, expect } from 'vitest';
import { parseEventLine } from '../src/event-line/parser';
import { EVENT_LINE_MAX_EVENTS } from '../src/event-line/diagnostics';
import { render } from '../src/render';

// Monthly events from 1900-01, each with a description (the #2434 pressure file shape).
function monthly(n: number, header = ''): string {
  const lines = [`event-line Pressure${header}`, ''];
  for (let i = 0; i < n; i++) {
    const y = 1900 + Math.floor(i / 12);
    const m = String((i % 12) + 1).padStart(2, '0');
    lines.push(
      `${y}-${m} Event ${i + 1}`,
      `  Something happened in month ${i + 1}.`
    );
  }
  return lines.join('\n');
}

const errors = (p: ReturnType<typeof parseEventLine>) =>
  p.diagnostics.filter((d) => d.severity === 'error');

describe('event-line event limit (#2434)', () => {
  it('is 50', () => {
    expect(EVENT_LINE_MAX_EVENTS).toBe(50);
  });

  it('draws 50 events with no diagnostic', () => {
    const p = parseEventLine(monthly(EVENT_LINE_MAX_EVENTS));
    expect(p.diagnostics).toHaveLength(0);
    expect(p.events).toHaveLength(EVENT_LINE_MAX_EVENTS);
  });

  it('51 events: one error, the first 50 drawn, the latest dropped', () => {
    const p = parseEventLine(monthly(EVENT_LINE_MAX_EVENTS + 1));
    const errs = errors(p);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.code).toBe('E_EVENT_LINE_TOO_MANY_EVENTS');
    expect(p.error).toBeNull();
    expect(p.events).toHaveLength(EVENT_LINE_MAX_EVENTS);
    expect(p.events.map((e) => e.label)).not.toContain('Event 51');
    // Event 51 is 1904-03 → on line 3 + 50*2.
    expect(errs[0]!.line).toBe(3 + 50 * 2);
    expect(errs[0]!.message).toBe(
      'This event-line has 51 events; only the first 50 (to 1904-02) are drawn. Split it into several charts by period.'
    );
  });

  it('300 events: one error naming count, limit and stop date', () => {
    const p = parseEventLine(monthly(300));
    const errs = errors(p);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('has 300 events');
    expect(errs[0]!.message).toContain('first 50 (to 1904-02)');
    expect(p.events).toHaveLength(50);
  });

  it('keeps the first 50 in date order, not source order', () => {
    // The earliest event listed last: it is drawn, the latest one is dropped.
    const src = monthly(EVENT_LINE_MAX_EVENTS) + '\n1899-06 Earliest';
    const p = parseEventLine(src);
    const labels = p.events.map((e) => e.label);
    expect(labels).toContain('Earliest');
    expect(labels).not.toContain('Event 50');
    expect(
      p.diagnostics.find((d) => d.code === 'E_EVENT_LINE_TOO_MANY_EVENTS')!
        .message
    ).toContain('(to 1904-01)');
  });

  it('applies under no-scale', () => {
    const src = monthly(60).replace(
      'event-line Pressure\n',
      'event-line Pressure\nno-scale\n'
    );
    const p = parseEventLine(src);
    expect(p.options.scale).toBe(false);
    expect(p.events).toHaveLength(50);
    expect(errors(p)).toHaveLength(1);
  });

  it('counts TBD and collapsed-era events the same as dated ones', () => {
    const lines = ['event-line X', '', '[Early] collapsed'];
    for (let i = 0; i < 30; i++) lines.push(`  ${1900 + i} E${i}`);
    for (let i = 30; i < 50; i++) lines.push(`${1900 + i} E${i}`);
    lines.push('TBD Later');
    const p = parseEventLine(lines.join('\n'));
    expect(p.events).toHaveLength(50);
    expect(p.events.map((e) => e.label)).not.toContain('Later');
    expect(errors(p)).toHaveLength(1);
  });

  it('the render path reports the error and still draws', async () => {
    const { svg, diagnostics } = await render(monthly(300), { theme: 'light' });
    expect(
      diagnostics.filter((d) => d.code === 'E_EVENT_LINE_TOO_MANY_EVENTS')
    ).toHaveLength(1);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Event 50');
    expect(svg).not.toContain('Event 51<');
  });
});
