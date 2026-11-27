// ============================================================
// mindmap — the node limit (#2454)
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

import type { DiagnosticSpec } from '../diagnostics';

/** Most nodes one mindmap draws, the title root included. */
export const MAX_MINDMAP_NODES = 100;

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
} satisfies Record<string, DiagnosticSpec>;

export const MINDMAP_DIAGNOSTICS: DiagnosticSpec[] = Object.values(MINDMAP_DX);
