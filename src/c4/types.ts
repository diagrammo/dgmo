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
  target: string;
  label?: string;
  technology?: string;
  arrowType: C4ArrowType;
  lineNumber: number;
}

// ── Groups ───────────────────────────────────────────────────

export interface C4Group {
  name: string;
  children: C4Element[];
  lineNumber: number;
}

// ── Elements ─────────────────────────────────────────────────

export interface C4Element {
  name: string;
  type: C4ElementType;
  shape: C4Shape;
  metadata: Record<string, string>;
  description?: string[];
  children: C4Element[];
  groups: C4Group[];
  relationships: C4Relationship[];
  importPath?: string;
  lineNumber: number;
  sectionHeader?: 'containers' | 'components';
  sectionHeaderLineNumber?: number;
}

// ── Deployment ───────────────────────────────────────────────

export interface C4DeploymentNode {
  name: string;
  metadata: Record<string, string>;
  shape: C4Shape;
  children: C4DeploymentNode[];
  containerRefs: string[];
  lineNumber: number;
}

// ── Parsed result ────────────────────────────────────────────

export interface ParsedC4 {
  title: string | null;
  titleLineNumber: number | null;
  options: Record<string, string>;
  tagGroups: TagGroup[];
  elements: C4Element[];
  relationships: C4Relationship[];
  deployment: C4DeploymentNode[];
  diagnostics: DgmoError[];
  error: string | null;
}
