import type { DgmoError } from '../diagnostics';

// ============================================================
// Pyramid Diagram — Parsed Types
// ============================================================

export interface PyramidLayer {
  label: string;
  lineNumber: number;
  /** Optional palette color name (red/green/blue/…). */
  color?: string;
  /** Description lines — from bare pipe shorthand or indented body. */
  description: string[];
  /** Unconsumed pipe metadata (reserved for future use). */
  metadata: Record<string, string>;
}

export interface ParsedPyramid {
  type: 'pyramid';
  title: string;
  titleLineNumber: number;
  layers: PyramidLayer[];
  /** When true, apex points down instead of up. */
  inverted: boolean;
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}
