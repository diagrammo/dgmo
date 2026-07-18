// ============================================================
// Treemap — Squarified Layout (d3-hierarchy)
// ============================================================
//
// Pure geometry: takes the parsed roots + a rectangle and returns positioned
// cells. Two data transforms happen here so the export renderer and the app's
// interactive renderer share them:
//   - `other-below N` rollup (per-parent, against the parent's summed total).
//   - `depth N` windowing (collapse nodes at the cap into solid drillable blocks).

import {
  hierarchy,
  treemap,
  treemapSquarify,
  type HierarchyRectangularNode,
} from 'd3-hierarchy';
import type { TreemapNode } from './types';

/** Internal datum fed to d3-hierarchy (carries the original node ref). */
interface LayoutDatum {
  /** Original parsed node; undefined for the synthetic root. */
  ref?: TreemapNode;
  label: string;
  /** Leaf size (only meaningful on leaves). */
  value?: number;
  heat?: number;
  children?: LayoutDatum[];
  /** Source line for click-to-source wiring (when available). */
  lineNumber?: number;
}

export interface TreemapCell {
  /** Original parsed node, or null for the synthetic root. */
  readonly node: TreemapNode | null;
  readonly label: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** 1-based depth within the laid-out (post-drill) tree. */
  readonly depth: number;
  /** Summed value (d3 rollup). */
  readonly value: number;
  /** Has children AND is drawn as a container (depth below the cap). */
  readonly isContainer: boolean;
  /** Has children but sits AT the depth cap — a solid drillable block. */
  readonly isCollapsed: boolean;
  /** Index of the top-level ancestor (drives branch-mode hue). */
  readonly topIndex: number;
  readonly pctOfRoot: number;
  readonly pctOfParent: number;
  /** Own heat, else the mean of descendant leaf heats; undefined if none. */
  readonly heat?: number;
  /** Path of labels from the laid-out root (for tooltips / data-node-path). */
  readonly path: readonly string[];
  readonly lineNumber?: number;
}

export interface TreemapLayoutResult {
  readonly cells: readonly TreemapCell[];
  readonly total: number;
}

export interface TreemapLayoutOptions {
  readonly width: number;
  readonly height: number;
  /** Top gutter reserved for parent header bars (0 when headers off). */
  readonly headerH: number;
  readonly paddingInner?: number;
  readonly paddingOuter?: number;
  /** Render budget; nodes at this depth collapse to solid blocks. */
  readonly maxDepth?: number;
}

/** Summed value of a parsed node (leaf value or sum of descendants). */
export function sumValue(node: TreemapNode): number {
  if (node.children.length === 0) return node.value ?? 0;
  let s = 0;
  for (const c of node.children) s += sumValue(c);
  return s;
}

/** Convert a parsed node into a layout datum. */
function toDatum(node: TreemapNode): LayoutDatum {
  if (node.children.length === 0) {
    return {
      ref: node,
      label: node.label,
      value: node.value ?? 0,
      ...(node.heat !== undefined && { heat: node.heat }),
      lineNumber: node.lineNumber,
    };
  }

  return {
    ref: node,
    label: node.label,
    ...(node.heat !== undefined && { heat: node.heat }),
    lineNumber: node.lineNumber,
    children: node.children.map((c) => toDatum(c)),
  };
}

/** Per-node aggregate of descendant-leaf heats (sum + count). */
interface HeatAgg {
  sum: number;
  count: number;
}

/**
 * Aggregate leaf heats for every node in a single traversal, replacing the
 * per-node `leaves()` subtree walk (O(N × subtree) → O(leaves × depth)).
 * Leaves are visited in the same pre-order `leaves()` used, and each ancestor
 * accumulates them one at a time from 0, so every node's sum is bit-identical
 * to the old per-node left fold.
 */
function collectHeatAggs(
  root: HierarchyRectangularNode<LayoutDatum>
): Map<HierarchyRectangularNode<LayoutDatum>, HeatAgg> {
  const aggs = new Map<HierarchyRectangularNode<LayoutDatum>, HeatAgg>();
  root.eachBefore((node) => {
    if (node.children) return; // leaves only
    const heat = node.data.heat;
    if (heat === undefined) return;
    let p: HierarchyRectangularNode<LayoutDatum> | null = node;
    while (p) {
      const agg = aggs.get(p);
      if (agg) {
        agg.sum += heat;
        agg.count += 1;
      } else {
        aggs.set(p, { sum: heat, count: 1 });
      }
      p = p.parent;
    }
  });
  return aggs;
}

/** Mean heat across the leaves under a datum (own heat if it is a leaf). */
function datumHeat(
  node: HierarchyRectangularNode<LayoutDatum>,
  heatAggs: Map<HierarchyRectangularNode<LayoutDatum>, HeatAgg>
): number | undefined {
  if (node.data.heat !== undefined) return node.data.heat;
  const agg = heatAggs.get(node);
  if (agg === undefined) return undefined;
  return agg.sum / agg.count;
}

export function layoutTreemap(
  roots: readonly TreemapNode[],
  opts: TreemapLayoutOptions
): TreemapLayoutResult {
  const maxDepth = opts.maxDepth ?? Infinity;
  const rootDatum: LayoutDatum = {
    label: '__root',
    children: roots.map((r) => toDatum(r)),
  };

  const h = hierarchy<LayoutDatum>(rootDatum)
    .sum((d) => (d.children?.length ? 0 : (d.value ?? 0)))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const hroot = treemap<LayoutDatum>()
    .tile(treemapSquarify)
    .size([opts.width, opts.height])
    .paddingOuter(opts.paddingOuter ?? 3)
    .paddingTop(opts.headerH > 0 ? opts.headerH : (opts.paddingInner ?? 2))
    .paddingInner(opts.paddingInner ?? 2)
    .round(true)(h);

  const total = hroot.value ?? 0;

  // Tag each node with the index of its depth-1 ancestor (branch hue).
  (hroot.children ?? []).forEach((top, i) => {
    top.each((d) => {
      (d as { _topIndex?: number })._topIndex = i;
    });
  });

  const heatAggs = collectHeatAggs(hroot);

  const cells: TreemapCell[] = [];
  for (const d of hroot.descendants()) {
    if (d.depth === 0) continue; // skip synthetic root
    if (d.depth > maxDepth) continue; // beyond the render window

    const hasChildren = !!d.children && d.children.length > 0;
    const isCollapsed = hasChildren && d.depth >= maxDepth;
    const isContainer = hasChildren && !isCollapsed;

    const path: string[] = [];
    let p: HierarchyRectangularNode<LayoutDatum> | null = d;
    while (p && p.depth > 0) {
      path.unshift(p.data.label);
      p = p.parent;
    }

    const heatVal = datumHeat(d, heatAggs);
    cells.push({
      node: d.data.ref ?? null,
      label: d.data.label,
      x0: d.x0,
      y0: d.y0,
      x1: d.x1,
      y1: d.y1,
      depth: d.depth,
      value: d.value ?? 0,
      isContainer,
      isCollapsed,
      topIndex: (d as { _topIndex?: number })._topIndex ?? 0,
      pctOfRoot: total > 0 ? (d.value ?? 0) / total : 0,
      pctOfParent:
        d.parent && (d.parent.value ?? 0) > 0
          ? (d.value ?? 0) / (d.parent.value ?? 1)
          : 1,
      ...(heatVal !== undefined && { heat: heatVal }),
      path,
      ...(d.data.lineNumber !== undefined && { lineNumber: d.data.lineNumber }),
    });
  }

  return { cells, total };
}
