import type { ParticipantType } from '../sequence/parser';
import type { TagGroup } from '../utils/tag-groups';
import type { DgmoError } from '../diagnostics';

export type BLRenderMode = 'rectangles' | 'shapes';

export interface BLNode {
  label: string;
  shape: ParticipantType;
  shapeOverride?: ParticipantType;
  lineNumber: number;
  metadata: Record<string, string>;
  description?: string;
}

export interface BLEdge {
  source: string;
  target: string;
  label?: string;
  bidirectional: boolean;
  lineNumber: number;
  metadata: Record<string, string>;
}

export interface BLGroup {
  label: string;
  children: string[];
  parentGroup?: string;
  lineNumber: number;
  metadata: Record<string, string>;
}

export interface ParsedBoxesAndLines {
  type: 'boxes-and-lines';
  title: string | null;
  titleLineNumber: number | null;
  nodes: BLNode[];
  edges: BLEdge[];
  groups: BLGroup[];
  tagGroups: TagGroup[];
  options: Record<string, string>;
  initialHiddenTagValues: Map<string, Set<string>>;
  renderMode: BLRenderMode;
  direction: 'LR' | 'TB';
  diagnostics: DgmoError[];
  error: string | null;
}
