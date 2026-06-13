// ============================================================
// arc parser door — Story 109.2 (arch-review).
//
// The six visualizations share one parse state machine (visualizations/parse.ts);
// this is arc's typed entry point into it, returning the narrowed
// ParsedArc shape. The registry binds the 'arc' chart type to this door.
// ============================================================

import type { PaletteColors } from '../palettes';
import { parseVisualization } from '../visualizations/parse';
import type { ParsedArc } from '../visualizations/types';

export function parseArc(content: string, palette?: PaletteColors): ParsedArc {
  return parseVisualization(content, palette) as ParsedArc;
}
