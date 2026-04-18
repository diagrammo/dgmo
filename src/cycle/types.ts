import type { DgmoError } from '../diagnostics';

// ============================================================
// Cycle Diagram — Parsed Types
// ============================================================

export interface CycleNode {
  label: string;
  lineNumber: number;
  color?: string;
  span: number;
  description: string[];
  metadata: Record<string, string>;
}

export interface CycleEdge {
  sourceIndex: number;
  targetIndex: number;
  label?: string;
  color?: string;
  width?: number;
  description: string[];
  lineNumber?: number;
  metadata: Record<string, string>;
}

export interface ParsedCycle {
  type: 'cycle';
  title: string;
  titleLineNumber: number;
  nodes: CycleNode[];
  edges: CycleEdge[];
  direction: 'clockwise' | 'counterclockwise';
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Cycle Diagram — Layout Types
// ============================================================

export interface CycleLayoutNode {
  label: string;
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
  /** Pre-wrapped description lines (fit to node width). Empty if no descriptions. */
  wrappedDesc: string[];
}

export interface CycleLayoutEdge {
  sourceIndex: number;
  targetIndex: number;
  path: string;
  labelX: number;
  labelY: number;
  /** Angle of the label position on the circle (radians), for text-anchor. */
  labelAngle: number;
  label?: string;
}

export interface CycleLayoutResult {
  nodes: CycleLayoutNode[];
  edges: CycleLayoutEdge[];
  cx: number;
  cy: number;
  radius: number;
  width: number;
  height: number;
  /** Scale factor applied to nodes (1 = no scaling, <1 = shrunk to fit). */
  scale: number;
}
