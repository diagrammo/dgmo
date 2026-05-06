import type { DgmoError } from '../diagnostics';

// ============================================================
// Ring Diagram — Parsed Types
// ============================================================

export interface RingLayer {
  label: string;
  lineNumber: number;
  /** Optional palette color name (red/green/blue/…). */
  color?: string;
  /** Description lines — from bare pipe shorthand or indented body. */
  description: string[];
  /** Unconsumed pipe metadata (reserved for future use). */
  metadata: Record<string, string>;
}

export interface ParsedRing {
  type: 'ring';
  title: string;
  titleLineNumber: number;
  /** Source order: layers[0] = innermost (filled disc); last = outermost ring. */
  layers: RingLayer[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}
