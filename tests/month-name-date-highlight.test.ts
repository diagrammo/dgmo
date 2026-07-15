/**
 * Month-name date highlighting (§ BL-121, "not covered" follow-up).
 *
 * The Lezer grammar tokenizes numeric/ISO/slash dates as `DateLiteral`, but it
 * cannot join a month WORD to its day across a space (`Jan 3`). A post-pass
 * (`applyMonthNameDates` → `scanMonthNameDates`) re-roles those spans to
 * `number` so they render like numeric dates. It is gated to the date-bearing
 * charts and mirrors the parser's MONTH_D / D_MONTH acceptance exactly.
 */
import { describe, expect, it } from 'vitest';

import { highlightDgmo } from '../src/editor/highlight-api';
import { scanMonthNameDates } from '../src/utils/date';

/** Roles of every non-whitespace token overlapping the first `text` span. */
function rolesOver(source: string, text: string): string[] {
  const tokens = highlightDgmo(source);
  const idx = source.indexOf(text);
  const end = idx + text.length;
  const roles: string[] = [];
  let pos = 0;
  for (const t of tokens) {
    const tEnd = pos + t.text.length;
    if (tEnd > idx && pos < end && t.text.trim().length > 0) roles.push(t.role);
    pos = tEnd;
  }
  return roles;
}

const g = (line: string) => `gantt\n${line}\n`;

describe('scanMonthNameDates — pure classifier', () => {
  const yes: [string, string][] = [
    ['Jan 3', 'Jan 3'],
    ['3 Jan', '3 Jan'],
    ['January 3', 'January 3'],
    ['3 January', '3 January'],
    ['Jan 3, 2026', 'Jan 3, 2026'],
    ['Jan 3 2026', 'Jan 3 2026'],
    ['3 Jan 2026', '3 Jan 2026'],
    ['Jan. 3', 'Jan. 3'],
  ];
  for (const [input, span] of yes) {
    it(`matches "${input}"`, () => {
      const spans = scanMonthNameDates(input);
      expect(spans.length).toBe(1);
      expect(input.slice(spans[0]!.start, spans[0]!.end)).toBe(span);
    });
  }

  it('finds a date mid-line', () => {
    const spans = scanMonthNameDates('Kickoff Jan 3 launch');
    expect(
      spans.map((s) => 'Kickoff Jan 3 launch'.slice(s.start, s.end))
    ).toEqual(['Jan 3']);
  });

  it('finds multiple dates', () => {
    const line = 'Sprint 3 Jan to Feb 5';
    expect(spans(line)).toEqual(['3 Jan', 'Feb 5']);
  });

  const no = [
    '3 items', // `items` is not a month
    'January', // bare month word, no day
    'March forward', // month word + non-numeric
    'Task 5', // number without a month
    'Q1 2026', // quarters are NOT dates in the parser
  ];
  for (const input of no) {
    it(`rejects "${input}"`, () => {
      expect(scanMonthNameDates(input)).toEqual([]);
    });
  }

  it('replicates parser month-prefix over-acceptance (Marina → March)', () => {
    // In sync with monthNameToNum: first 3 letters `mar` ∈ abbr set.
    expect(spans('5 Marina')).toEqual(['5 Marina']);
  });

  function spans(line: string): string[] {
    return scanMonthNameDates(line).map((s) => line.slice(s.start, s.end));
  }
});

describe('applyMonthNameDates — highlight post-pass (gated)', () => {
  it('colors `Jan 3` as number in a gantt', () => {
    expect(rolesOver(g('Design Jan 3'), 'Jan 3')).toEqual(['number', 'number']);
  });

  it('colors the whole `3 Jan 2026` incl. year', () => {
    expect(rolesOver(g('Build 3 Jan 2026'), '3 Jan 2026')).toEqual([
      'number',
      'number',
      'number',
    ]);
  });

  it('applies in every date-bearing chart', () => {
    for (const ct of ['gantt', 'pert', 'countdown', 'timeline', 'event-line']) {
      const roles = rolesOver(`${ct}\nEvent Jan 3\n`, 'Jan 3');
      expect(roles, ct).toEqual(['number', 'number']);
    }
  });

  it('does NOT highlight month words outside date charts (gated)', () => {
    const roles = rolesOver('flowchart\nMarch forward\n', 'March');
    expect(roles).not.toContain('number');
  });

  it('does NOT pull a non-month word into a date (`3 items`)', () => {
    // The bare `3` is a legit Number token; the point is `items` stays default
    // — the post-pass must not treat `3 items` as a date literal.
    expect(rolesOver(g('Backlog 3 items'), 'items')).toEqual(['default']);
  });
});
