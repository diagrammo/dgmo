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
  readonly tagGroups: readonly TagGroup[];
  readonly options: EventLineOptions;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
