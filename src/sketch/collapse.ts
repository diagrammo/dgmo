// ============================================================
// Sketch diagram — Collapse transform (Pattern B, pre-layout)
// ============================================================
//
// Cloned from boxes-and-lines/collapse.ts: a collapsed box becomes a virtual
// node (its own box id), its children disappear, and edges re-target the
// virtual node (internal edges drop, duplicates dedupe). Pure — layout and
// the renderer never special-case collapsed state beyond drawing the
// collapse-bar on virtual nodes.

import type { ParsedSketch, SketchBox, SketchEdge, SketchNode } from './types';

export interface SketchCollapseResult {
  /** Visible shapes (collapsed boxes' children removed). */
  readonly nodes: readonly SketchNode[];
  /** Boxes still rendered as frames (the expanded ones). */
  readonly boxes: readonly SketchBox[];
  /** Collapsed boxes — each renders as one virtual node card. */
  readonly virtualBoxes: readonly SketchBox[];
  /** Edges with endpoints re-targeted to virtual boxes; deduped. */
  readonly edges: readonly SketchEdge[];
  /** box label → immediate child count (for the collapse-bar affordance). */
  readonly collapsedChildCounts: ReadonlyMap<string, number>;
}

/**
 * @param collapsedLabels box LABELS to fold. Defaults to the authored
 *   `collapsed` flags; the app/viewState passes an explicit set instead
 *   (interactive-vs-export split — options win when supplied).
 */
export function collapseSketch(
  parsed: Pick<ParsedSketch, 'nodes' | 'edges' | 'boxes'>,
  collapsedLabels?: ReadonlySet<string>
): SketchCollapseResult {
  const collapsed =
    collapsedLabels ??
    new Set(parsed.boxes.filter((b) => b.collapsed).map((b) => b.label));

  if (collapsed.size === 0) {
    return {
      nodes: parsed.nodes,
      boxes: parsed.boxes,
      virtualBoxes: [],
      edges: parsed.edges,
      collapsedChildCounts: new Map(),
    };
  }

  const virtualBoxes = parsed.boxes.filter((b) => collapsed.has(b.label));
  const boxes = parsed.boxes.filter((b) => !collapsed.has(b.label));

  // node id → virtual box id, for children of collapsed boxes.
  const nodeToVirtual = new Map<string, string>();
  const collapsedChildCounts = new Map<string, number>();
  for (const box of virtualBoxes) {
    collapsedChildCounts.set(box.label, box.children.length);
    for (const childId of box.children) nodeToVirtual.set(childId, box.id);
  }

  const nodes = parsed.nodes.filter((n) => !nodeToVirtual.has(n.id));

  const edges: SketchEdge[] = [];
  const seen = new Set<string>();
  for (const edge of parsed.edges) {
    const sourceId = nodeToVirtual.get(edge.sourceId) ?? edge.sourceId;
    const targetId = nodeToVirtual.get(edge.targetId) ?? edge.targetId;
    if (sourceId === targetId) continue; // internal to a collapsed box
    const key = `${sourceId}|${targetId}|${edge.label ?? ''}|${edge.heads}|${edge.dashed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...edge, sourceId, targetId });
  }

  return { nodes, boxes, virtualBoxes, edges, collapsedChildCounts };
}
