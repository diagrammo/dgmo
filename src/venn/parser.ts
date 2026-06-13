// ============================================================
// venn parser door — Story 109.2 (arch-review).
//
// The six visualizations share one parse state machine (visualizations/parse.ts);
// this is venn's typed entry point into it, returning the narrowed
// ParsedVenn shape. The registry binds the 'venn' chart type to this door.
// ============================================================

import type { PaletteColors } from '../palettes';
import { parseVisualization } from '../visualizations/parse';
import type { ParsedVenn } from '../visualizations/types';

export function parseVenn(
  content: string,
  palette?: PaletteColors
): ParsedVenn {
  return parseVisualization(content, palette) as ParsedVenn;
}
