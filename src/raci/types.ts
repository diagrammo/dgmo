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

/** Recognized per-task `# annotation` flags. */
export type RaciTaskAnnotation = 'allow-incomplete';

/**
 * One `Role: <markers>` line under a task.
 *
 * `id` is the normalized role key — used by mutations to look up the
 * cell and by validation to detect unknown roles. `displayName` is the
 * first-seen casing/spacing for rendering.
 */
export interface RaciRoleAssignment {
  id: string;
  displayName: string;
  markers: RaciMarker[];
  lineNumber: number;
  endLineNumber: number;
}

/** One task — flush-left under a phase or directly under the chart. */
export interface RaciTask {
  id: string;
  displayName: string;
  description: string;
  /** Parsed `# annotation-name` flags from the trailing comment, validated. */
  annotations: Set<RaciTaskAnnotation>;
  roleAssignments: RaciRoleAssignment[];
  lineNumber: number;
  endLineNumber: number;
}

/** Optional `[Phase Label]` group header — one level deep. */
export interface RaciPhase {
  id: string;
  displayName: string;
  tasks: RaciTask[];
  lineNumber: number;
  endLineNumber: number;
}

/** Top-level parse result. */
export interface ParsedRaci {
  type: 'raci';
  /** Optional title from the chart-type header line. */
  title?: string;
  titleLineNumber?: number;
  /** Variant selected by directive, or by chart-type id when absent. */
  variant: RaciVariant;
  /**
   * Canonical column order. Populated either from an explicit
   * `roles:` directive or, when absent, from first-seen role usage.
   */
  roles: string[];
  /** Display name for each role (parallel to `roles`). */
  roleDisplayNames: string[];
  phases: RaciPhase[];
  /** Tasks declared without a parent phase. */
  tasksWithoutPhase: RaciTask[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}
