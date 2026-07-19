// ============================================================
// Event Line Diagram — Diagnostic Catalog
// ============================================================
//
// Declarative metadata for every coded diagnostic the event-line parser
// (`src/event-line/parser.ts`) can emit. The parser emits these via
// `emit(EVENT_LINE_DX.<KEY>, line, params)` — the canonical wording lives here
// only, never re-typed at the call site — so consumers (CLI `diagnostics`,
// console error-review, MCP `validate_diagram`, spec docs) can enumerate the
// catalog and the parser output can't drift from it.
//
// Every message builder tolerates being called with `{}` so the catalog can
// render a representative string with no live params.
//
// NOTE: the parser ALSO emits the universal `E_TAG_DECLARED_AFTER_CONTENT`
// (`tag` after content); that is catalogued with the universal metadata codes,
// not here.

import type { DiagnosticSpec } from '../diagnostics';

/** Keyed specs — referenced by the parser's `emit()` call sites. */
export const EVENT_LINE_DX = {
  // parser.ts: 'event-line has no events.'
  NO_EVENTS: {
    code: 'E_EVENT_LINE_NO_EVENTS',
    severity: 'error',
    chartType: 'event-line',
    title: 'No events',
    message: 'event-line has no events.',
    hint: 'Add at least one event line (e.g. `2020 Something happened`) below the header.',
    example: `event-line Empty`,
  },
  // parser.ts parseEventHeader:
  //   `Use ISO dates (YYYY, YYYY-MM, or YYYY-MM-DD). Got '${firstToken}'.`
  BAD_DATE: {
    code: 'E_EVENT_LINE_BAD_DATE',
    // Runtime: emitted at `warning` despite the E_ prefix (see registry allowlist).
    severity: 'warning',
    chartType: 'event-line',
    title: 'Non-ISO date',
    message: (p) =>
      `Use ISO dates (YYYY, YYYY-MM, or YYYY-MM-DD). Got '${p.token ?? '7/16/1969'}'.`,
    hint: 'Write dates as YYYY, YYYY-MM, or YYYY-MM-DD — slash and dot separators are not parsed.',
    example: `event-line X

7/16/1969 Liftoff
  Departs.`,
  },
  // parser.ts emits three wordings under this one code (each passes the full
  // wording as `reason`):
  //   directive handler: `event-line is horizontal-only in v1; \`direction-tb\`
  //                        (vertical orientation) is a fast-follow.` (the
  //                        legacy key+value form words it as \`direction ${dir}\`)
  //   `section` seam:     'Group events with `[Name]` era brackets (§28.6a), not `section`.'
  //   parseEventHeader:   'event-line events are points; a date range (`->`) is not
  //                        supported — using the start date.'
  UNSUPPORTED: {
    code: 'E_EVENT_LINE_UNSUPPORTED',
    // Runtime: emitted at `warning` despite the E_ prefix (see registry allowlist).
    severity: 'warning',
    chartType: 'event-line',
    title: 'Unsupported construct',
    message: (p) =>
      typeof p.reason === 'string' && p.reason
        ? p.reason
        : 'event-line is horizontal-only in v1; `direction-tb` (vertical orientation) is a fast-follow.',
    hint: 'Only horizontal (`direction-lr`) is supported; use `[Name]` era brackets (not `section`); events are single points, not date ranges (`->`).',
    example: `event-line X
direction-tb

2020 A
  one`,
  },
  // parser.ts validateEraDateOrder, two wordings switched by `rel`/`edge`:
  //   `… but dated after era "${ahead.era}" begins (${ahead.date}). …`   rel=after,  edge=begins
  //   `… but dated before era "${behind.era}" ends (${behind.date}). …`  rel=before, edge=ends
  ERA_DATE_ORDER: {
    code: 'E_EVENT_LINE_ERA_DATE_ORDER',
    // Runtime: emitted at `warning` despite the E_ prefix (see registry allowlist).
    severity: 'warning',
    chartType: 'event-line',
    title: 'Event breaks era chronology',
    message: (p) =>
      `"${p.label ?? 'Sean Curtis CTO'}" (${p.date ?? '2025-04-15'}) is in era "${p.era ?? 'Curtis'}" but dated ${p.rel ?? 'after'} era "${p.otherEra ?? 'Vasanth'}" ${p.edge ?? 'begins'} (${p.otherDate ?? '2025-05-09'}). event-line eras run left-to-right by date — fix the date or move it to the right era, or their brackets will overlap.`,
    hint: 'Eras render as date-spanning brackets; keep every event dated within its era, or move it to the era that covers its date.',
    example: `event-line X

[Vasanth]
  2025-04-01 Opening Day Outage
  2025-05-09 Fire Kevin C

[Curtis]
  2025-04-15 Sean Curtis CTO
  2025-09-01 The incident`,
  },
  // parser.ts validateEventDateOrder:
  //   `"${ev.label}" (${ev.date}) is out of order — it is dated before
  //    "${prev.label}" (${prev.date}) listed above it. event-line reads
  //    left-to-right by date; list events chronologically.`
  DATE_ORDER: {
    code: 'E_EVENT_LINE_DATE_ORDER',
    // Runtime: emitted at `warning` despite the E_ prefix (see registry allowlist).
    severity: 'warning',
    chartType: 'event-line',
    title: 'Events out of chronological order',
    message: (p) =>
      `"${p.label ?? 'C'}" (${p.date ?? '2022'}) is out of order — it is dated before "${p.prevLabel ?? 'B'}" (${p.prevDate ?? '2024'}) listed above it. event-line reads left-to-right by date; list events chronologically.`,
    hint: 'List dated events chronologically top-to-bottom; a later-listed event dated before the one above it is almost always a slip.',
    example: `event-line X

2020 A
2024 B
2022 C`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const EVENT_LINE_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(EVENT_LINE_DX);
