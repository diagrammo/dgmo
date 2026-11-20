// ============================================================
// Boxes and Lines — Node Metrics
// ============================================================
//
// Base node dimensions, in their own module because every placement strategy
// needs them. They used to live in layout.ts, which meant layout-search and
// each strategy it delegates to (grouped, layered, stable-collapse) imported a
// runtime value back from the module that calls them — a genuine import cycle
// per strategy, for two numbers. Splitting them out leaves those modules
// importing only types from layout.ts, which TypeScript erases.

const PHI = 1.618;

export const NODE_HEIGHT = 60;
export const NODE_WIDTH = Math.round(NODE_HEIGHT * PHI);

// Node-title text metrics. Layout reads them to size a box to its widest
// label word; the renderer reads them to draw that word. Box labels run smaller
// than the 13px org/infra use — boxes-and-lines nodes are narrower (~97px), so a
// smaller label fits more text per line before wrapping.
export const NODE_FONT_SIZE = 11;
export const MIN_NODE_FONT_SIZE = 9;
export const NODE_TEXT_PADDING = 12;
