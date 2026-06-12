// ============================================================
// Timeline parser door — Story 109.2 (arch-review).
//
// Separate from timeline/parser.ts (which holds the date helpers +
// parseTimelineEventLine that visualizations/parse.ts imports) — keeping the
// door here avoids a timeline/parser <-> visualizations/parse import cycle.
// This is timeline's typed entry point into the shared parse state machine,
// returning the narrowed ParsedTimeline shape; the registry binds 'timeline'
// to it.
// ============================================================

import type { PaletteColors } from '../palettes';
import { parseVisualization } from '../visualizations/parse';
import type { ParsedTimeline } from '../visualizations/types';

export function parseTimeline(
  content: string,
  palette?: PaletteColors
): ParsedTimeline {
  return parseVisualization(content, palette) as ParsedTimeline;
}
