// ============================================================
// RACI / RASCI / DACI matrix — AST types
// ============================================================
//
// Tasks × roles assignment matrix. Three variants share the same
// shape; only the marker alphabet and constraint rules differ.
// See `variants.ts` for variant-specific behavior, `parser.ts` for
// how AST is built, `mutations.ts` for source-text edits.

import type { DgmoError } from '../diagnostics';

/** Marker alphabet member for any variant. */
export type RaciMarker = 'R' | 'A' | 'S' | 'C' | 'I' | 'D';

/** Variant identifier — selects alphabet + constraint rule set. */
export type RaciVariant = 'raci' | 'rasci' | 'daci';

/**
 * One `Role: <markers>` line under a task.
 *
 * `id` is the normalized role key — used by mutations to look up the
 * cell and by validation to detect unknown roles. `displayName` is the
 * first-seen casing/spacing for rendering.
 */
export interface RaciRoleAssignment {
  readonly id: string;
  readonly displayName: string;
  readonly markers: readonly RaciMarker[];
  readonly lineNumber: number;
  readonly endLineNumber: number;
}

/** One task — flush-left under a phase or directly under the chart. */
export interface RaciTask {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly roleAssignments: readonly RaciRoleAssignment[];
  readonly lineNumber: number;
  readonly endLineNumber: number;
}

/** Optional `[Phase Label]` group header — one level deep. */
export interface RaciPhase {
  readonly id: string;
  readonly displayName: string;
  /** Optional palette color from a `[Label](color)` suffix on the bracket. */
  readonly color?: string;
  readonly tasks: readonly RaciTask[];
  readonly lineNumber: number;
  readonly endLineNumber: number;
}

/** Top-level parse result. */
export interface ParsedRaci {
  readonly type: 'raci';
  /** Optional title from the chart-type header line. */
  readonly title?: string;
  readonly titleLineNumber?: number;
  /** Variant selected by directive, or by chart-type id when absent. */
  readonly variant: RaciVariant;
  /**
   * Canonical column order. Populated either from an explicit
   * `roles:` directive or, when absent, from first-seen role usage.
   */
  readonly roles: readonly string[];
  /** Display name for each role (parallel to `roles`). */
  readonly roleDisplayNames: readonly string[];
  /**
   * Optional per-role palette color from the `Cap blue` trailing-token
   * suffix in the roles block (or the long pipe form `Cap | color: blue`).
   * Parallel to `roles`; entries default to `undefined` (renderer falls
   * back to the neutral column tint).
   */
  readonly roleColors: ReadonlyArray<string | undefined>;
  readonly phases: readonly RaciPhase[];
  /** Tasks declared without a parent phase. */
  readonly tasksWithoutPhase: readonly RaciTask[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
