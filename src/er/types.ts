// ============================================================
// ER Diagram Types
// ============================================================

export type ERConstraint = 'pk' | 'fk' | 'unique' | 'nullable';

export type ERCardinality = '1' | '*' | '?';

export interface ERColumn {
  name: string;
  type?: string;
  constraints: ERConstraint[];
  lineNumber: number;
}

export interface ERTable {
  id: string;
  name: string;
  color?: string;
  columns: ERColumn[];
  lineNumber: number;
}

export interface ERRelationship {
  source: string; // table id
  target: string; // table id
  cardinality: { from: ERCardinality; to: ERCardinality };
  label?: string;
  lineNumber: number;
}

import type { DgmoError } from '../diagnostics';

export interface ParsedERDiagram {
  type: 'er';
  title?: string;
  titleLineNumber?: number;
  options: Record<string, string>;
  tables: ERTable[];
  relationships: ERRelationship[];
  diagnostics: DgmoError[];
  error: string | null;
}
