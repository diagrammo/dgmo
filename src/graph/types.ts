export type GraphShape =
  | 'terminal' // ()  — rounded/stadium
  | 'process' // []  — rectangle
  | 'decision' // <>  — diamond
  | 'io' // //  — parallelogram
  | 'subroutine' // [[]] — double-bordered rectangle
  | 'document' // [~] — wavy-bottom rectangle
  | 'state' // state diagram — rounded rectangle
  | 'pseudostate'; // [*] — filled circle (start/end)

export type GraphDirection = 'TB' | 'LR';

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly shape: GraphShape;
  readonly color?: string;
  readonly group?: string;
  readonly lineNumber: number;
  /**
   * §1.4 tag metadata keyed by `tagAttrKey(group.name)` (state only —
   * decision #48). Absent on flowchart nodes and on state nodes in
   * diagrams that declare no tag groups.
   */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly color?: string;
  readonly lineNumber: number;
}

export interface GraphGroup {
  readonly id: string;
  readonly label: string;
  readonly color?: string;
  readonly nodeIds: readonly string[];
  readonly lineNumber: number;
  readonly collapsed?: boolean; // `[Group] collapsed: true` view-state marker
  /**
   * §1.4 same-line tag metadata authored on the group line itself
   * (`[Backend] s: Red`), present only when the author wrote some. The
   * renderer resolves it through `resolveTagColor(..., isContainer: true)`
   * so the frame tints only on an explicit value — a container must never
   * pick up the group's `defaultValue`, or every untagged frame in the
   * diagram would wear the first entry's color.
   */
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * A generic note as authored — anchors to a node by `ref` (the
 * author-typed id/label) and carries a multi-line `body`. Resolution
 * to a concrete node happens at end-of-parse via `resolveNotes`; this
 * model is intentionally a top-level list (ADR-1), not a field on
 * `GraphNode`, so the placement pass sees the whole set at once.
 */
// The graph note is now the chart-neutral `DiagramNote`; kept as a named
// alias so existing `graph/` imports of `GraphNote` stay valid.
import type { DiagramNote } from '../utils/notes/model';
export type GraphNote = DiagramNote;

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

export interface ParsedGraph {
  readonly type: 'flowchart' | 'state';
  readonly title?: string;
  readonly titleLineNumber?: number;
  readonly direction: GraphDirection;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly groups?: readonly GraphGroup[];
  readonly notes?: readonly GraphNote[];
  /**
   * Declared tag groups (state only — decision #48). Optional so the
   * flowchart parser, which has no tag channel, keeps its shape.
   */
  readonly tagGroups?: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
