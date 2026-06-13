// ============================================================
// quadrant parser door — Story 109.2 (arch-review).
//
// The six visualizations share one parse state machine (visualizations/parse.ts);
// this is quadrant's typed entry point into it, returning the narrowed
// ParsedQuadrant shape. The registry binds the 'quadrant' chart type to this door.
// ============================================================

import type { PaletteColors } from '../palettes';
import { parseVisualization } from '../visualizations/parse';
import type { ParsedQuadrant } from '../visualizations/types';

export function parseQuadrant(
  content: string,
  palette?: PaletteColors
): ParsedQuadrant {
  return parseVisualization(content, palette) as ParsedQuadrant;
}
