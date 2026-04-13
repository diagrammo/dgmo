import type { DgmoError } from '../diagnostics.js';
import type { TagGroup } from '../utils/tag-groups.js';

export interface MindmapNode {
  id: string;
  label: string;
  description?: string;
  metadata: Record<string, string>;
  children: MindmapNode[];
  parentId: string | null;
  lineNumber: number;
  color?: string;
  collapsed?: boolean;
}

export interface ParsedMindmap {
  title: string | null;
  titleLineNumber: number | null;
  roots: MindmapNode[];
  tagGroups: TagGroup[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

export interface MindmapLayoutNode {
  id: string;
  label: string;
  description?: string;
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
