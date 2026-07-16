import type { DgmoError } from '../diagnostics';
import type { FillMode } from '../utils/parsing';

// ============================================================
// Clock chart — Parsed Types
// ============================================================
//
// The second *dynamic* dgmo chart (after `countdown`): a live "what time is it
// right now for these people/places" world-clock board that ticks every second
// on live surfaces and is accurate on every load. Each row is a place in its own
// IANA time zone; the board shows an analog dial OR a digital readout (per the
// board-level `face`), the UTC offset, an optional working-hours status chip,
// and an optional sundown/sunrise line.
//
// The renderer bakes per-row `data-dgmo-clock*` anchors (the no-JS floor) —
// analog hand `<line transform>`s, the digital `<text>`, the offset, the status,
// and the sundown text — each individually addressable. The page-level ticker
// (src/clock/ticker.ts) recomputes them live. NEVER a `<script>` in the SVG —
// every sanitizer strips it. All `data-*` attributes survive them.
//
// Time math + formatting is shared with the ticker via ./resolve so the baked
// value and the live value never disagree.

/** Which clock face the whole board renders. EITHER/OR — never both. */
export type ClockFace = 'analog' | 'digital';

/**
 * What dimension drives each zone's color (`color-by <dimension>`). Time + label
 * render in the resolved solid color; the lane/column gets a soft wash of it. A
 * hand-set per-zone shade ("defined") always overrides the dimension for that
 * zone — `color-by` only fills the zones you did not color yourself.
 *   • `place`    — a distinct palette accent per place (identity, default)
 *   • `work`     — green in-hours / amber closing / grey off (needs `hours`)
 *   • `daylight` — warm sun-up / cool sun-down
 *   • `time`     — continuous dawn→dusk→night ramp by local hour
 *   • `none`     — neutral greyscale (`color-by none`)
 */
export type ClockColorBy = 'place' | 'work' | 'daylight' | 'time' | 'none';

/** A resolved working window, applied in each row's OWN zone-local time. */
export interface WorkWindow {
  /** Minutes past midnight the window opens (e.g. 9:00 → 540). */
  readonly startMin: number;
  /** Minutes past midnight the window closes (e.g. 17:00 → 1020). */
  readonly endMin: number;
  /**
   * Working days as a set keyed by the 3-letter weekday abbreviation the
   * `Intl` short weekday emits (`Mon`,`Tue`,…,`Sun`). A day maps to `true` when
   * it is a working day. Defaults to Mon–Fri when `hours` is given without
   * `days`.
   */
  readonly days: Record<string, boolean>;
}

/**
 * How a row's zone was named (§37.3). `iana` — a real, DST-aware zone reached by
 * a city name, an alias, or an explicit IANA id. `fixed` — a raw `UTC±HH:MM`
 * offset that never observes daylight saving (rendered with a "no DST" marker).
 */
export type ClockZoneKind = 'iana' | 'fixed';

/** One place/person row on the board. */
export interface ClockEntry {
  /** Whether the zone is a real IANA zone or a fixed UTC offset. */
  readonly kind: ClockZoneKind;
  /** The canonical display city ("New York"), or the offset label for a fixed row. */
  readonly place: string;
  /** The IANA zone ("America/New_York"), or the offset label ("UTC+5:30") when fixed. */
  readonly zone: string;
  /** Minutes east of UTC for a `fixed` row; null for an `iana` row. */
  readonly fixedOffsetMin: number | null;
  /** The display alias (`as <label>`), defaulting to `place`. */
  readonly label: string;
  /** Representative latitude for sundown math, or null when unknown. */
  readonly lat: number | null;
  /** Representative longitude for sundown math, or null when unknown. */
  readonly lon: number | null;
  /** Resolved trailing palette color (a faint row tint), or null. */
  readonly color: string | null;
  /** 1-based source line the entry was authored on. */
  readonly lineNumber: number;
}

export interface ParsedClock {
  readonly type: 'clock';
  readonly title: string | null;
  readonly titleLineNumber: number | null;

  /** Board-level face. Default `digital`. */
  readonly face: ClockFace;
  /** 12-hour am/pm display when true (default), 24-hour when false (`time-24`). */
  readonly hours12: boolean;
  /** Whether the sundown/sunrise line is drawn (default on; `sun false` to hide). */
  readonly sun: boolean;
  /** `no-title` directive — suppress the title AND the working-window summary. */
  readonly noTitle: boolean;
  /** `direction lr` lays entries out as vertical columns (time on top); default rows. */
  readonly columns: boolean;
  /** What drives each zone's color. Default `place`; disable via `color-by none`. */
  readonly colorBy: ClockColorBy;
  /**
   * §1.9 fill family (`fill-solid` / `fill-outline`; absent ⇒ canonical tint).
   * Restyles only DECORATIVE surface tints (card, identity lane washes, dial
   * faces) — state-encoding fills (day/night, work status) keep their fills.
   */
  readonly fillMode?: FillMode;
  /** The working window, or null when no `hours` directive was given. */
  readonly work: WorkWindow | null;

  readonly entries: readonly ClockEntry[];

  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
