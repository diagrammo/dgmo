// ============================================================
// Initiative Status Diagram — Types
// ============================================================

import type { DgmoError } from '../diagnostics';
import type { ParticipantType } from '../sequence/parser';
import type { TagGroup } from '../utils/tag-groups';

export type InitiativeStatus = 'done' | 'doing' | 'blocked' | 'todo' | 'na' | null;

export const VALID_STATUSES: readonly string[] = ['done', 'doing', 'blocked', 'todo', 'na'];

/** Aliases that map to canonical status values during parsing. */
export const STATUS_ALIASES: Record<string, string> = {
  wip: 'doing',
  paused: 'blocked',
  waiting: 'blocked',
};

export interface ISNode {
  label: string;
  status: InitiativeStatus;
  shape: ParticipantType;
  lineNumber: number;
  metadata: Record<string, string>;
}

export interface ISEdge {
  source: string; // node label
  target: string; // node label
  label?: string; // e.g. "getUser"
  status: InitiativeStatus;
  lineNumber: number;
  metadata: Record<string, string>;
}

export interface ISGroup {
  label: string;
  nodeLabels: string[];
  lineNumber: number;
  metadata?: Record<string, string>;
}

export interface ParsedInitiativeStatus {
  type: 'initiative-status';
  title: string | null;
  titleLineNumber: number | null;
  nodes: ISNode[];
  edges: ISEdge[];
  groups: ISGroup[];
  tagGroups: TagGroup[];
  options: Record<string, string>;
  /** Initial hidden tag values from `hide:` DSL directive. Map<groupKey, Set<values>> */
  initialHiddenTagValues: Map<string, Set<string>>;
  diagnostics: DgmoError[];
  error: string | null;
}
