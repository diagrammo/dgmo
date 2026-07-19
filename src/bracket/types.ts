import type { DgmoError } from '../diagnostics';
import type { FillMode } from '../utils/parsing';
import type { TagGroup } from '../utils/tag-groups';

// ============================================================
// Bracket chart — Parsed Types
// ============================================================
//
// A single-elimination tournament bracket. Two authoring modes:
//   - CASUAL: results-only; the tree structure is INFERRED from `beats`/`vs`
//     lines (a competitor first seen in a later round is a bye).
//   - SEEDED: any `seed N Name` line switches on seeded mode. The full skeleton
//     (standard single-elim seeding, top seeds bye) renders on day 0; unplayed
//     slots show as dashed TBD and fill as `beats` lines arrive.
//
// The parser produces the raw match/seed/side lists + flags; `layout.ts` turns
// them into positioned nodes; `renderer.ts` draws boxes + elbow connectors.

export type BracketMode = 'single-elim' | 'double-elim';

/** One authored match line. `p1` is left of the keyword (= winner if decided). */
export interface RawMatch {
  /** Left operand — the winner for a `beats` line. */
  readonly p1: string;
  /** Right operand — the loser for a `beats` line. */
  readonly p2: string;
  /** True for `beats` (decided); false for `vs` (pending). */
  readonly decided: boolean;
  /** Cosmetic score text (`2-1`), if present. Never changes the winner (§3). */
  readonly score: string | null;
  /** Owning side label, or null for an indent-0 championship / single ladder. */
  readonly side: string | null;
  /** Home competitor for this match (`@ Name`), or null. */
  readonly home: string | null;
  /** Prose commentary lines indented under the match (`- ` → •, inline md). */
  readonly commentary: readonly string[];
  readonly lineNumber: number;
}

/** A `seed N Name` declaration (seeded mode only). */
export interface RawSeed {
  readonly seed: number;
  readonly name: string;
  readonly side: string | null;
  readonly lineNumber: number;
}

export interface BracketSide {
  readonly label: string;
  /** Resolved trailing-token color for the side, if any. */
  readonly color?: string;
}

/** A round/column: its name plus an optional color (tints the label + column). */
export interface RoundDef {
  readonly name: string;
  readonly color?: string;
}

export interface ParsedBracket {
  readonly type: 'bracket';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly mode: BracketMode;
  /** True when any `seed` line was present → full-skeleton (day-0) rendering. */
  readonly seeded: boolean;
  /** Column definitions from `rounds` (entry round → inner), each colorable. */
  readonly roundNames: readonly RoundDef[];
  readonly sides: readonly BracketSide[];
  readonly matches: readonly RawMatch[];
  readonly seeds: readonly RawSeed[];
  /** Tag groups (block/org idiom) — a competitor's tag colors its box outline. */
  readonly tagGroups: readonly TagGroup[];
  /** competitor name → its metadata (`{ tk: 'MLB Ballpark' }`). */
  readonly competitorMeta: ReadonlyMap<string, Record<string, string>>;
  /** Resolved active tag group name (drives outline color + legend), or null. */
  readonly activeTag: string | null;
  /** Hide the tag legend. */
  readonly noLegend: boolean;
  /** Suppress round/column labels (`no-round`). */
  readonly noRounds: boolean;
  /**
   * Winner accent color override; default blue. Set by a trailing color token
   * on the title line (§1.5, canonical) or the legacy `accent <color>`
   * directive — the title-line token wins on conflict.
   */
  readonly accentColor?: string;
  /** §1.9 fill family (`fill-solid` / `fill-outline`); absent ⇒ 25% tint. */
  readonly fillMode?: FillMode;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
