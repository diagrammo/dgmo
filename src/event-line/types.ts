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

export interface EventLineOptions {
  /** False when `no-scale` — events are spaced evenly instead of by date. */
  readonly scale: boolean;
  /** Card placement: `alternate` (default) or all on one `above`/`below` side. */
  readonly side: 'alternate' | 'above' | 'below';
  /** True when `no-title`. */
  readonly noTitle: boolean;
  /** True when `no-box` — render a card-less label/rule/description (slides). */
  readonly noBox: boolean;
  /** True when `no-legend` — hide the tag legend. */
  readonly noLegend: boolean;
}

export interface ParsedEventLine {
  readonly type: 'event-line';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly events: readonly EventLineEvent[];
  readonly eras: readonly EventLineEra[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: EventLineOptions;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
