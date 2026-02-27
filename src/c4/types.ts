// ============================================================
// C4 Architecture Diagram — Types
// ============================================================

import type { OrgTagGroup, OrgTagEntry } from '../org/parser';
import type { DgmoError } from '../diagnostics';

// Re-export tag types for convenience
export type { OrgTagGroup as C4TagGroup, OrgTagEntry as C4TagEntry };

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
  tagGroups: OrgTagGroup[];
  elements: C4Element[];
  relationships: C4Relationship[];
  deployment: C4DeploymentNode[];
  diagnostics: DgmoError[];
  error: string | null;
}
