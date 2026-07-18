// ============================================================
// C4 Architecture Diagram — Types
// ============================================================

import type { TagGroup, TagEntry } from '../utils/tag-groups';
import type { DgmoError } from '../diagnostics';

/** @deprecated Use `TagEntry` from `utils/tag-groups` */
export type C4TagEntry = TagEntry;
/** @deprecated Use `TagGroup` from `utils/tag-groups` */
export type C4TagGroup = TagGroup;

// ── String unions ────────────────────────────────────────────

export type C4ElementType = 'person' | 'system' | 'container' | 'component';

export type C4Shape =
  | 'default'
  | 'database'
  | 'cache'
  | 'queue'
  | 'cloud'
  | 'external';

export type C4ArrowType =
  | 'sync'
  | 'async'
  | 'bidirectional'
  | 'bidirectional-async';

// ── Relationships ────────────────────────────────────────────

export interface C4Relationship {
  readonly target: string;
  readonly label?: string;
  readonly technology?: string;
  readonly arrowType: C4ArrowType;
  readonly lineNumber: number;
}

// ── Groups ───────────────────────────────────────────────────

export interface C4Group {
  readonly name: string;
  readonly children: readonly C4Element[];
  /**
   * Authored collapse marker (§1.8, decision #48): bare trailing
   * `collapsed` flag on the `[Group]` line (legacy: `collapsed: true`).
   * Parsed and exposed for consumers; the c4 layout does not yet fold
   * group boundaries.
   */
  readonly collapsed?: boolean;
  readonly lineNumber: number;
}

// ── Elements ─────────────────────────────────────────────────

export interface C4Element {
  readonly name: string;
  readonly type: C4ElementType;
  readonly shape: C4Shape;
  readonly metadata: Readonly<Record<string, string>>;
  readonly description?: readonly string[];
  readonly children: readonly C4Element[];
  readonly groups: readonly C4Group[];
  readonly relationships: readonly C4Relationship[];
  readonly importPath?: string;
  readonly lineNumber: number;
  readonly sectionHeader?: 'containers' | 'components';
  readonly sectionHeaderLineNumber?: number;
}

// ── Deployment ───────────────────────────────────────────────

export interface C4DeploymentNode {
  readonly name: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly shape: C4Shape;
  readonly children: readonly C4DeploymentNode[];
  readonly containerRefs: readonly string[];
  readonly lineNumber: number;
}

// ── Parsed result ────────────────────────────────────────────

export interface ParsedC4 {
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly options: Readonly<Record<string, string>>;
  readonly tagGroups: readonly TagGroup[];
  readonly elements: readonly C4Element[];
  readonly relationships: readonly C4Relationship[];
  readonly deployment: readonly C4DeploymentNode[];
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
