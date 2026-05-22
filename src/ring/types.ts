import type { DgmoError } from '../diagnostics';

// ============================================================
// Ring Diagram — Parsed Types
// ============================================================

export interface RingLayer {
  readonly label: string;
  readonly lineNumber: number;
  /** Optional palette color name (red/green/blue/…). */
  readonly color?: string;
  /** Description lines — from bare pipe shorthand or indented body. */
  readonly description: readonly string[];
  /** Unconsumed pipe metadata (reserved for future use). */
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ParsedRing {
  readonly type: 'ring';
  readonly title: string;
  readonly titleLineNumber: number;
  /** Source order: layers[0] = innermost (filled disc); last = outermost ring. */
  readonly layers: readonly RingLayer[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
