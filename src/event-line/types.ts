import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

// ============================================================
// Event Line — Parsed Types (spec §28)
// ============================================================

export interface EventLineEvent {
  readonly label: string;
  readonly lineNumber: number;
  /** ISO date as written (verbatim caption), or null when the event has no date. */
  readonly date: string | null;
  /** Numeric date value (timeline scale) for to-scale positioning, or null. */
  readonly dateValue: number | null;
  /** True when the date was written as `TBD` — a not-yet-scheduled FUTURE event.
   *  Its `date` caption is `'TBD'`; `dateValue` is inferred from source-order
   *  dated neighbors so the to-scale axis still positions it (see `futureSpan`). */
  readonly future: boolean;
  /** For a `future` event, the dateValue gap it is interpolated WITHIN
   *  (`[lo, hi]`) — present when a dated event follows it. `null` for a trailing
   *  TBD (no dated event after it): the open horizon, drawn as a dashed spine
   *  tail. Distinguishes bracketed vs trailing placement; always null for
   *  non-future events. */
  readonly futureSpan: readonly [number, number] | null;
  /** Tag/metadata — keys are `tagAttrKey(group)` (e.g. `{ genre: 'Pop' }`). */
  readonly metadata: Readonly<Record<string, string>>;
  /** Bare-body description lines (markdown-light; `- ` normalized to `• `). */
  readonly description: readonly string[];
  /** Name of the enclosing era (`[Name]` run delimiter, §28.6a), or null. */
  readonly era: string | null;
}

/**
 * An **era** — a `[Name]` run delimiter (§28.6a) that brackets a contiguous run
 * of events into a labeled section of the spine. Not an indentation container:
 * events stay at indent 0 and belong to the most-recently opened era. Drawn as a
 * horizontal `]` bracket on the side opposite the cards; `collapsed` folds the
 * run into one event-like summary card (bulleted member list) while the bracket
 * stays on the spine.
 */
export interface EventLineEra {
  readonly name: string;
  /** Resolved color token (palette name) tinting the bracket/label, or null. */
  readonly color: string | null;
  /** Authored default collapse state (the export/CLI state; the app toggles live). */
  readonly collapsed: boolean;
  readonly lineNumber: number;
}

/**
 * A **now marker** (§28.6b) — a "grounded pin" at "today": a palette-red
 * (`palette.destructive`) diamond planted on the spine with a short stem to a
 * labeled tab, slotted into a card-free lane, plus a dotted "today line" that
 * fades out within the leader gap (full-height only on hover, preview).
 * `now` alone is *computed* (resolved to the render-time date);
 * `now <date>` *pins* it to an explicit ISO date (deterministic, snapshot-safe).
 * Only drawn on a to-scale axis (every event dated); ignored under `no-scale`.
 */
export interface EventLineNow {
  /** True for bare `now` (date resolved at render time); false when pinned. */
  readonly computed: boolean;
  /** Pinned ISO date as written, or null when computed. */
  readonly date: string | null;
  /** Numeric value for the pinned date (timeline scale), or null when computed. */
  readonly dateValue: number | null;
  /**
   * Author-supplied tab caption, or null to caption the tab with the marker's
   * own resolved date (the default — a tab reading `now` cannot tell a diagram
   * redrawn today from one exported two years ago).
   */
  readonly label: string | null;
  readonly lineNumber: number;
}

export interface EventLineOptions {
  /** False when `no-scale` — events are spaced evenly instead of by date. */
  readonly scale: boolean;
  /** Card placement: `alternate` (default) or all on one `above`/`below` side. */
  readonly side: 'alternate' | 'above' | 'below';
  /** True when `no-title`. */
  readonly noTitle: boolean;
  /** True when `no-box` — render a card-less label + date on a soft tag-tinted
   *  shelf (with a colored leader-landing edge) + description (slides). */
  readonly noBox: boolean;
  /** True when `no-legend` — hide the tag legend. */
  readonly noLegend: boolean;
  /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
  readonly legendInline?: boolean;
  /** §1.9 fill family: 'solid' | 'outline'; undefined ⇒ canonical soft tint. */
  readonly fillMode: 'solid' | 'outline' | undefined;
}

export interface ParsedEventLine {
  readonly type: 'event-line';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly events: readonly EventLineEvent[];
  readonly eras: readonly EventLineEra[];
  /** The `now` marker (§28.6b), or null when the directive is absent. */
  readonly now: EventLineNow | null;
  readonly tagGroups: readonly TagGroup[];
  readonly options: EventLineOptions;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
