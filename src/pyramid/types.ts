import type { DgmoError } from '../diagnostics';

// ============================================================
// Pyramid Diagram — Parsed Types
// ============================================================

export interface PyramidLayer {
  readonly label: string;
  readonly lineNumber: number;
  /** Optional palette color name (red/green/blue/…). */
  readonly color?: string;
  /** Description lines — from bare pipe shorthand or indented body. */
  readonly description: readonly string[];
  /** Unconsumed pipe metadata (reserved for future use). */
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ParsedPyramid {
  readonly type: 'pyramid';
  readonly title: string;
  readonly titleLineNumber: number;
  readonly layers: readonly PyramidLayer[];
  /** When true, apex points down instead of up. */
  readonly inverted: boolean;
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
