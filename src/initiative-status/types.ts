// ============================================================
// Initiative Status Diagram — Types
// ============================================================

import type { DgmoError } from '../diagnostics';
import type { ParticipantType } from '../sequence/parser';

export type InitiativeStatus = 'done' | 'wip' | 'todo' | 'na' | null;

export const VALID_STATUSES: readonly string[] = ['done', 'wip', 'todo', 'na'];

export interface ISNode {
  label: string;
  status: InitiativeStatus;
  shape: ParticipantType;
  lineNumber: number;
}

export interface ISEdge {
  source: string; // node label
  target: string; // node label
  label?: string; // e.g. "getUser"
  status: InitiativeStatus;
  lineNumber: number;
}

export interface ISGroup {
  label: string;
  nodeLabels: string[];
  lineNumber: number;
}

export interface ParsedInitiativeStatus {
  type: 'initiative-status';
  title: string | null;
  titleLineNumber: number | null;
  nodes: ISNode[];
  edges: ISEdge[];
  groups: ISGroup[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error?: string;
}
