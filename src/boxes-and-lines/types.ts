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
  parentGroup?: string;
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

// ── v2 Layout Types ───────────────────────────────────────

export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface BLLayoutNodeV2 {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  rankOrder: number;
  spine: boolean;
  group?: string;
}

export interface BLLayoutEdgeV2 {
  source: string;
  target: string;
  label?: string;
  bidirectional: boolean;
  lineNumber: number;
  sourcePort: { x: number; y: number; side: PortSide };
  targetPort: { x: number; y: number; side: PortSide };
  routedPath: { x: number; y: number }[];
  smoothPath: string;
  hops: { x: number; y: number }[];
  reversed: boolean;
  selfRef: boolean;
  yOffset: number;
  parallelCount: number;
  metadata: Record<string, string>;
}

export interface BLLayoutGroupV2 {
  label: string;
  lineNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  childCount?: number;
  nestingLevel: number;
  parentGroup?: string;
}

export interface BLLayoutResultV2 {
  nodes: BLLayoutNodeV2[];
  edges: BLLayoutEdgeV2[];
  groups: BLLayoutGroupV2[];
  width: number;
  height: number;
  direction: 'LR' | 'TB';
  spineNodeLabels: string[];
  reversedEdges: { source: string; target: string }[];
}
