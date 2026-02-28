// ============================================================
// Class Diagram Types
// ============================================================

export type ClassModifier = 'abstract' | 'interface' | 'enum';

export type MemberVisibility = 'public' | 'private' | 'protected';

export type RelationshipType =
  | 'extends'     // --|>  solid line, filled triangle
  | 'implements'  // ..|>  dashed line, hollow triangle
  | 'composes'    // *--   solid line, filled diamond
  | 'aggregates'  // o--   solid line, hollow diamond
  | 'depends'     // ..>   dashed line, open arrow
  | 'associates'; // ->    solid line, open arrow

export interface ClassMember {
  name: string;
  type?: string;           // field type or return type
  params?: string;         // method params (empty string for no-arg methods)
  visibility: MemberVisibility;
  isStatic: boolean;
  isMethod: boolean;
  lineNumber: number;
}

export interface ClassNode {
  id: string;
  name: string;
  modifier?: ClassModifier;
  color?: string;
  members: ClassMember[];
  lineNumber: number;
}

export interface ClassRelationship {
  source: string;          // class name
  target: string;          // class name
  type: RelationshipType;
  label?: string;
  lineNumber: number;
}

import type { DgmoError } from '../diagnostics';

export interface ParsedClassDiagram {
  type: 'class';
  title?: string;
  titleLineNumber?: number;
  classes: ClassNode[];
  relationships: ClassRelationship[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}
