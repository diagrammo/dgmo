import type { TagGroup } from '../utils/tag-groups';
import type { DgmoError } from '../diagnostics';

export interface BLNode {
  label: string;
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
  direction: 'LR' | 'TB';
  diagnostics: DgmoError[];
  error: string | null;
}
