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
  /** Whether this node should be rendered as a circle. */
  isCircle: boolean;
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

// ============================================================
// Shared arrow-sizing helpers (used by both layout + renderer)
// ============================================================

/** Default edge stroke width. */
export const DEFAULT_EDGE_WIDTH = 3;
/** Minimum rendered stroke width — thinner strokes produce unusable arrowheads. */
export const MIN_EDGE_WIDTH = 2;

/**
 * Compute the desired arrowhead length in user-space pixels using sublinear
 * scaling.  The renderer uses markerUnits="strokeWidth" with computed marker
 * dimensions so the arrowhead base always matches the stroke width (no gaps,
 * no lollipop effect) while the rendered length follows this formula.
 */
const BASE_ARROW_SIZE = 8;
const ARROW_SCALE = 6;
export function arrowHeadLength(strokeWidth: number): number {
  return BASE_ARROW_SIZE + ARROW_SCALE * Math.sqrt(strokeWidth);
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
