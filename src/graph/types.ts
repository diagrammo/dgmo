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
}

import type { DgmoError } from '../diagnostics';

export interface ParsedGraph {
  readonly type: 'flowchart' | 'state';
  readonly title?: string;
  readonly titleLineNumber?: number;
  readonly direction: GraphDirection;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly groups?: readonly GraphGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
