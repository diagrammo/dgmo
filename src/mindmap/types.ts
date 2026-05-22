import type { DgmoError } from '../diagnostics.js';
import type { TagGroup } from '../utils/tag-groups.js';

export interface MindmapNode {
  readonly id: string;
  readonly label: string;
  readonly description?: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly children: readonly MindmapNode[];
  readonly parentId: string | null;
  readonly lineNumber: number;
  readonly color?: string;
  readonly collapsed?: boolean;
}

export interface ParsedMindmap {
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly roots: readonly MindmapNode[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

// Layout types — keep mutable for now; will be addressed in wave 4
// (layout result types) so layout helpers can incrementally build them.
export interface MindmapLayoutNode {
  id: string;
  label: string;
  description?: string[];
  metadata: Record<string, string>;
  lineNumber: number;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  angle: number;
  radius: number;
  hiddenCount?: number;
  hasChildren?: boolean;
}

export interface MindmapLayoutEdge {
  sourceId: string;
  targetId: string;
  path: string; // SVG path d attribute
}

export interface MindmapLayoutResult {
  nodes: MindmapLayoutNode[];
  edges: MindmapLayoutEdge[];
  width: number;
  height: number;
}
