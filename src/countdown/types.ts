import type { DgmoError } from '../diagnostics';
import type { CountUnits, Field, RecurRule, RoundMode } from './resolve';

// ============================================================
// Countdown chart — Parsed Types
// ============================================================
//
// The only *dynamic* dgmo chart: "N days until X", recomputed against the
// viewer's clock on every load and ticking every second on live surfaces.
// Distinct from `goal` (static) — see docs/spikes/countdown-live-rendering-spike.md.
//
// A block has EITHER a one-shot `target` OR a recurring `every` rule, never
// both. Recurring blocks resolve to the NEXT matching instant and roll forward
// automatically (birthdays, anniversaries, standing meetings — never go stale).
//
// The renderer bakes a `<text data-dgmo-countdown*>` marker (the no-JS floor)
// plus a footer resolution line and an "as of" stamp; the page-level ticker
// (src/countdown/ticker.ts) overwrites them live. NEVER a `<script>` in the
// SVG — every sanitizer strips it.

/** How prominent the `since` ordinal is. Default `eyebrow` (day-count stays hero). */
export type SinceStyle = 'eyebrow' | 'headline' | 'tenure' | 'inline';

export interface ParsedCountdown {
  readonly type: 'countdown';
  readonly title: string | null;
  readonly titleLineNumber: number | null;

  // ── Target (one-shot) ──
  /**
   * Canonical one-shot target string emitted verbatim into `data-dgmo-countdown`.
   * A bare `YYYY-MM-DD` stays a date (ticker resolves it to viewer-local
   * midnight); a datetime keeps its authored form; `now` resolves to a fixed
   * render-time instant. Null for recurring blocks.
   */
  readonly target: string | null;
  /**
   * The one-shot target resolved to absolute epoch ms (bare date → local
   * midnight; `now` → the render-time instant). Null for recurring blocks or an
   * unparseable target. For one-shot blocks this equals `resolvedMs`.
   */
  readonly targetMs: number | null;

  // ── Recurrence (recurring) ──
  /** The recurrence rule, or null for one-shot blocks. */
  readonly rule: RecurRule | null;

  /**
   * The resolved next instant (epoch ms). For one-shot == the target; for
   * recurring == `resolveNext(rule, renderTime)`. Null when unresolvable.
   */
  readonly resolvedMs: number | null;
  /** Whether the resolved instant carries a meaningful time-of-day (drives footer). */
  readonly hasTime: boolean;

  // ── Ordinal / since ──
  readonly since: number | null;
  readonly sinceLabel: string | null;
  readonly sinceStyle: SinceStyle;

  // ── Display ──
  readonly units: CountUnits;
  readonly round: RoundMode;
  readonly fields: readonly Field[];
  readonly lang: string;
  /** Text shown on the occurrence day (recurring only). */
  readonly onDay: string | null;
  /** Explicit text shown once a one-shot target passes; null → count UP ("N ago"). */
  readonly expired: string | null;

  /**
   * Free-text note under the ancillary line — inline (`note buy flowers`) or a
   * `note` header + indented body lines. Simple markdown (**bold** / *italic* /
   * `code` / links / `- ` bullets), like `goal`'s caption.
   */
  readonly note: string | null;

  /**
   * Traffic-light urgency ramp `[amber, red]` in DAYS (amber > red). The hero
   * is green while remaining > amber, amber within, red once ≤ red. Ignored
   * when an explicit `color` is set (manual always wins). Null = no ramp.
   */
  readonly thresholds: readonly [number, number] | null;

  /** Resolved trailing-token / `color:` hex, if any. Overrides the ramp. */
  readonly color?: string;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
