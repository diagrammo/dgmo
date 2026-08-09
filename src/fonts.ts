export const FONT_FAMILY =
  'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif';
export const DEFAULT_FONT_NAME = 'Inter';

// There is deliberately no centre-the-text-by-hand constant here.
//
// One lived here between 2026-08-07 and 2026-08-09 — the em offset from a
// line's centre down to its alphabetic baseline, 0.3638em, read off
// fonts/Inter-Regular.ttf. It was exact for Inter and wrong wherever Inter is
// not what draws, and dgmo does not control that: FONT_FAMILY names Inter
// first and falls back, and plenty of hosts embed a diagram without loading
// it. Renderers centre with `dominant-baseline: central` instead, which the
// renderer computes from the font actually in use. Measurements and the one
// thing this does NOT fix are above `centerText` in utils/legend-d3.ts.
