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

// Layout types — wave 4 of Story 105.18b.
export interface MindmapLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly description?: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly lineNumber: number;
  readonly color?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly angle: number;
  readonly radius: number;
  readonly hiddenCount?: number;
  readonly hasChildren?: boolean;
}

export interface MindmapLayoutEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly path: string; // SVG path d attribute
}

export interface MindmapLayoutResult {
  readonly nodes: readonly MindmapLayoutNode[];
  readonly edges: readonly MindmapLayoutEdge[];
  readonly width: number;
  readonly height: number;
}
