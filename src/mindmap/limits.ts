// ============================================================
// mindmap — the node limit (#2454) and the depth limit (#2455)
// ============================================================
//
// The preview fits the whole map to the canvas, so each node past a point
// shrinks all of them; at 3,900 nodes the map was one faint hairline. The
// value was measured on the default 1200x800 canvas (2026-11-27), with
// balanced trees of fan-out 2, 3, 4, 5 and 8 in the default layout. Labels
// are 17px at the root, 14px for branches, 11px, then 9px (text-wrap.ts):
//   - 60 nodes: scale 0.62–0.93; the 14px branches read 8.6–13px.
//   - 100 nodes: scale 0.52–0.61; branches read 7.3–8.6px, leaves 4.7–5.5px.
//   - 200 nodes: scale 0.30–0.32; leaves read 2.7–2.9px, no label readable.
//   - 500 nodes: scale 0.12–0.15; leaves read 1.0–1.4px.
// MAX_MINDMAP_NODES = 100 keeps the map at about half its drawn size or more,
// the same scale as the deepest chain MAX_MINDMAP_DEPTH allows. A strict
// 11px rule for the branch labels would stop at about 70 nodes.
// Past the limit the parser keeps the first nodes in source order and raises
// one error on the first node left out, naming the count. Not author-tunable:
// crowding is the renderer's decision (dgmo/CLAUDE.md → Output rules).

// The depth limit counts the root as level 1. A chain is width-bound: every
// level adds a column, so the map shrinks with depth. Measured on the same
// canvas (2026-11-27), one node per level:
//   - 8 levels: scale 0.83; the 14px branch reads 11.6px, leaves 7.5px.
//   - 12 levels: scale 0.55; the branch reads 7.7px, leaves 5.0px.
//   - 16 levels: scale 0.42; the branch reads 5.8px, leaves 3.7px.
//   - 60 levels (the pressure file): one thin strip, no label readable.
// The issue's rule was 16, lowered to 12 if a 16-deep chain is not readable;
// it is not, so MAX_MINDMAP_DEPTH = 12, the low end of the owner's 12–16.
// Past the limit the parser drops the deeper lines (and their descriptions),
// so the map draws down to the limit, and raises one error on the first line
// too deep.

import type { DiagnosticSpec } from '../diagnostics';

/** Most nodes one mindmap draws, the title root included. */
export const MAX_MINDMAP_NODES = 100;

/** Most nesting levels one mindmap draws, the root as level 1. */
export const MAX_MINDMAP_DEPTH = 12;

export const MINDMAP_DX = {
  TOO_MANY_NODES: {
    code: 'E_MINDMAP_TOO_MANY_NODES',
    severity: 'error',
    chartType: 'mindmap',
    title: 'Too many nodes',
    message: (p) =>
      `This mindmap has ${(p.count as number) ?? 'too many'} nodes; only the first ${MAX_MINDMAP_NODES} are drawn. Collapse branches into fewer nodes, or split the map into several mindmaps.`,
    hint: `Keep a mindmap to ${MAX_MINDMAP_NODES} nodes or fewer: collapse branches into fewer nodes, or split the map into several mindmaps (one per branch).`,
    example: `mindmap Launch\n\nDesign\n  Research\nBuild\nShip`,
  },
  TOO_DEEP: {
    code: 'E_MINDMAP_TOO_DEEP',
    severity: 'error',
    chartType: 'mindmap',
    title: 'Nesting too deep',
    message: `This branch nests deeper than ${MAX_MINDMAP_DEPTH} levels; a mindmap draws at most ${MAX_MINDMAP_DEPTH}, so deeper lines are left out. Flatten the branch, or split the map into several mindmaps.`,
    hint: `Keep a mindmap to ${MAX_MINDMAP_DEPTH} levels or fewer, the root as level 1: flatten the branch, or split the deep part into its own mindmap.`,
    example: `mindmap Launch\n\nDesign\n  Research\n    Interviews`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const MINDMAP_DIAGNOSTICS: DiagnosticSpec[] = Object.values(MINDMAP_DX);
