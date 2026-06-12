// ============================================================
// slope parser door — Story 109.2 (arch-review).
//
// The six visualizations share one parse state machine (visualizations/parse.ts);
// this is slope's typed entry point into it, returning the narrowed
// ParsedSlope shape. The registry binds the 'slope' chart type to this door.
// ============================================================

import type { PaletteColors } from '../palettes';
import { parseVisualization } from '../visualizations/parse';
import type { ParsedSlope } from '../visualizations/types';

export function parseSlope(
  content: string,
  palette?: PaletteColors
): ParsedSlope {
  return parseVisualization(content, palette) as ParsedSlope;
}
