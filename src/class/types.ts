// ============================================================
// Class Diagram Types
// ============================================================

export type ClassModifier = 'abstract' | 'interface' | 'enum';

export type MemberVisibility = 'public' | 'private' | 'protected';

export type RelationshipType =
  | 'extends' // --|>  solid line, filled triangle
  | 'implements' // ..|>  dashed line, hollow triangle
  | 'composes' // *--   solid line, filled diamond
  | 'aggregates' // o--   solid line, hollow diamond
  | 'depends' // ..>   dashed line, open arrow
  | 'associates'; // ->    solid line, open arrow

export interface ClassMember {
  readonly name: string;
  readonly type?: string; // field type or return type
  readonly params?: string; // method params (empty string for no-arg methods)
  readonly visibility: MemberVisibility;
  readonly isStatic: boolean;
  readonly isMethod: boolean;
  readonly lineNumber: number;
}

export interface ClassNode {
  readonly id: string;
  readonly name: string;
  readonly modifier?: ClassModifier;
  readonly color?: string;
  readonly members: readonly ClassMember[];
  readonly lineNumber: number;
}

export interface ClassRelationship {
  readonly source: string; // class name
  readonly target: string; // class name
  readonly type: RelationshipType;
  readonly label?: string;
  readonly lineNumber: number;
}

import type { DgmoError } from '../diagnostics';
import type { DiagramNote } from '../utils/notes';

export interface ParsedClassDiagram {
  readonly type: 'class';
  readonly title?: string;
  readonly titleLineNumber?: number;
  readonly classes: readonly ClassNode[];
  readonly relationships: readonly ClassRelationship[];
  readonly options: Readonly<Record<string, string>>;
  /** Generic node notes (`note <ClassName> …`); resolved in layout. */
  readonly notes?: readonly DiagramNote[];
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
