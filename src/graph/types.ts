export type GraphShape =
  | 'terminal' // ()  — rounded/stadium
  | 'process' // []  — rectangle
  | 'decision' // <>  — diamond
  | 'io' // //  — parallelogram
  | 'subroutine' // [[]] — double-bordered rectangle
  | 'document'; // [~] — wavy-bottom rectangle

export type GraphDirection = 'TB' | 'LR';

export interface GraphNode {
  id: string;
  label: string;
  shape: GraphShape;
  color?: string;
  group?: string;
  lineNumber: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  color?: string;
  lineNumber: number;
}

export interface GraphGroup {
  id: string;
  label: string;
  color?: string;
  nodeIds: string[];
  lineNumber: number;
}

export interface ParsedGraph {
  type: 'flowchart';
  title?: string;
  titleLineNumber?: number;
  direction: GraphDirection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups?: GraphGroup[];
  error?: string;
}
