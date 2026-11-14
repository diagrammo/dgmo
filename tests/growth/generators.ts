// Size-scaling sources for the render growth sweep (diagrammo/diagrammo#2025).
//
// One generator per chart type in CHART_TYPE_REGISTRY: `gen(n)` returns a valid
// source with about n of the type's main element (nodes, rows, bars, shapes,
// tasks…), wired the way real files are, so the growth exponent measures what
// a bigger real diagram costs. A type that has no meaningful size goes in
// NOT_SCALABLE with the reason; the sweep fails on a type in neither.
//
// `limit` is the growth exponent the type must stay under. The default suits
// a layout that is linear to n log n; a type whose layout is honestly
// superlinear (dagre, force placement) states its own limit and why.

export interface Generator {
  gen: (n: number) => string;
  /** Growth-exponent ceiling; defaults to DEFAULT_LIMIT. */
  limit?: number;
  /** Why `limit` is above the default, when it is. */
  why?: string;
  /**
   * The open tracker row for a type that fails today. The test still fails —
   * the sweep never hides a regression — but the message names the row so
   * the nightly triage comments there instead of filing a duplicate.
   */
  known?: string;
}

export const DEFAULT_LIMIT = 1.5;

import { GENERATORS_A, NOT_SCALABLE_A } from './gen-a';
import { GENERATORS_B, NOT_SCALABLE_B } from './gen-b';
import { GENERATORS_C, NOT_SCALABLE_C } from './gen-c';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const GENERATORS: Record<string, Generator> = {
  ...GENERATORS_A,
  ...GENERATORS_B,
  ...GENERATORS_C,
  // `at:` is the top-left corner; arrows run centre to centre, so both ends
  // attach. The board that went cubic on 2026-11-11 (#2024): a grid of shapes, each
  // joined to its right and lower neighbour, every third pair joined twice
  // (a fan), plus a note per five shapes.
  whiteboard: {
    known: 'diagrammo/diagrammo#2024',
    gen: (n) => {
      const cols = Math.max(2, Math.ceil(Math.sqrt(n)));
      const at = (i: number) => ({
        x: (i % cols) * 300,
        y: Math.floor(i / cols) * 200,
      });
      const lines = ['whiteboard Growth board'];
      for (const i of range(n)) {
        const { x, y } = at(i);
        lines.push(`rectangle Shape ${i} at: ${x} ${y}, size: 130 70`);
      }
      for (const i of range(n)) {
        const { x, y } = at(i);
        if ((i + 1) % cols !== 0 && i + 1 < n) {
          lines.push(
            `arrow from: ${x + 65} ${y + 35}, to: ${x + 365} ${y + 35}`
          );
          if (i % 3 === 0)
            lines.push(
              `arrow from: ${x + 65} ${y + 35}, to: ${x + 365} ${y + 35}`
            );
        }
        if (i + cols < n)
          lines.push(
            `arrow from: ${x + 65} ${y + 35}, to: ${x + 65} ${y + 235}`
          );
        if (i % 5 === 0)
          lines.push(
            `note at: ${x + 150} ${y + 90}, size: 100 50\n  Note ${i}`
          );
      }
      return lines.join('\n');
    },
  },
};

export const NOT_SCALABLE: Record<string, string> = {
  ...NOT_SCALABLE_A,
  ...NOT_SCALABLE_B,
  ...NOT_SCALABLE_C,
};
