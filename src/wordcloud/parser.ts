// ============================================================
// wordcloud parser door — Story 109.2 (arch-review).
//
// The six visualizations share one parse state machine (visualizations/parse.ts);
// this is wordcloud's typed entry point into it, returning the narrowed
// ParsedWordcloud shape. The registry binds the 'wordcloud' chart type to this door.
// ============================================================

import type { PaletteColors } from '../palettes';
import { parseVisualization } from '../visualizations/parse';
import type { ParsedWordcloud } from '../visualizations/types';

export function parseWordcloud(
  content: string,
  palette?: PaletteColors
): ParsedWordcloud {
  return parseVisualization(content, palette) as ParsedWordcloud;
}
