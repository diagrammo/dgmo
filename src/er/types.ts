// ============================================================
// ER Diagram Types
// ============================================================

export type ERConstraint = 'pk' | 'fk' | 'unique' | 'nullable';

export type ERCardinality = '1' | '*' | '?';

export interface ERColumn {
  readonly name: string;
  readonly type?: string;
  readonly constraints: readonly ERConstraint[];
  readonly lineNumber: number;
}

export interface ERTable {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
  readonly columns: readonly ERColumn[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

export interface ERRelationship {
  readonly source: string; // table id
  readonly target: string; // table id
  readonly cardinality: {
    readonly from: ERCardinality;
    readonly to: ERCardinality;
  };
  readonly label?: string;
  readonly lineNumber: number;
}

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import type { DiagramNote } from '../utils/notes';

export interface ParsedERDiagram {
  readonly type: 'er';
  readonly title?: string;
  readonly titleLineNumber?: number;
  readonly options: Readonly<Record<string, string>>;
  readonly tables: readonly ERTable[];
  readonly relationships: readonly ERRelationship[];
  readonly tagGroups: readonly TagGroup[];
  /** Generic node notes (`note <Table> …`); resolved in layout. */
  readonly notes?: readonly DiagramNote[];
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
