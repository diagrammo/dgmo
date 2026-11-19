// ============================================================
// Treemap — Icicle partition layout (d3-hierarchy)
// ============================================================
//
// The same parsed hierarchy as the sunburst, drawn as bands: root on the left,
// depth to the right. One column per level, all of equal width; a node's
// HEIGHT is its share of the whole (`cell.h = node.value / root.value ×
// height`), and every child sits inside its parent's vertical extent.
//
// Children keep SOURCE ORDER (no value-sort), top to bottom, as on the
// sunburst. The synthetic `__root` is not drawn; its children (`roots`) are the
// first column. Static export = FULL tree; `maxDepth` is the app's interactive
// render budget and drops the columns past it.

import {
  hierarchy,
  partition,
  type HierarchyRectangularNode,
} from 'd3-hierarchy';
import type { TreemapNode } from './types';
import { datumHeat, toDatum, type LayoutDatum } from './layout-sunburst';

/** A positioned icicle band. The geometry-neutral fields match `SunburstCell`;
 *  the geometry is a plain rectangle. */
export interface IcicleCell {
  /** Original parsed node, or null for the synthetic root. */
  readonly node: TreemapNode | null;
  readonly label: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** 1-based depth (column index; depth 1 = the top-level nodes). */
  readonly depth: number;
  readonly value: number;
  /** Has children (more columns to its right). */
  readonly isContainer: boolean;
  /** Always false for static export (full tree). */
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

export interface IcicleLayoutResult {
  readonly cells: readonly IcicleCell[];
  /** Grand total (sum of all leaf values). */
  readonly total: number;
  /** Width of one depth column. */
  readonly columnWidth: number;
  /** Deepest column actually present (0 when empty). */
  readonly maxDepthReached: number;
  /** True when `roots` exist but the grand total is 0 (all-zero leaves). */
  readonly isEmpty: boolean;
}

export interface IcicleLayoutOptions {
  readonly width: number;
  readonly height: number;
  /** Interactive render budget; static export leaves it Infinity (full tree). */
  readonly maxDepth?: number;
}

export function layoutTreemapIcicle(
  roots: readonly TreemapNode[],
  opts: IcicleLayoutOptions
): IcicleLayoutResult {
  const maxDepth = opts.maxDepth ?? Infinity;
  const width = Math.max(1, opts.width);
  const height = Math.max(1, opts.height);

  const rootDatum: LayoutDatum = {
    label: '__root',
    children: roots.map((r) => toDatum(r)),
  };

  // NO `.sort()` — source order, as on the sunburst.
  const h = hierarchy<LayoutDatum>(rootDatum).sum((d) =>
    d.children?.length ? 0 : (d.value ?? 0)
  );

  const total = h.value ?? 0;
  if (total <= 0) {
    return {
      cells: [],
      total: 0,
      columnWidth: width,
      maxDepthReached: 0,
      isEmpty: true,
    };
  }

  // x0/x1 from the partition are the VERTICAL extent in [0, height]; the
  // column comes from the depth alone.
  const hroot = partition<LayoutDatum>().size([height, 1])(h);
  const columns = Math.max(1, Math.min(hroot.height, maxDepth));
  const columnWidth = width / columns;

  (hroot.children ?? []).forEach((top, i) => {
    top.each((d) => {
      (d as { _topIndex?: number })._topIndex = i;
    });
  });

  const cells: IcicleCell[] = [];
  let maxDepthReached = 0;

  for (const d of hroot.descendants()) {
    if (d.depth === 0) continue; // synthetic root, not drawn
    if (d.depth > maxDepth) continue;

    if (d.depth > maxDepthReached) maxDepthReached = d.depth;
    const path: string[] = [];
    let p: HierarchyRectangularNode<LayoutDatum> | null = d;
    while (p && p.depth > 0) {
      path.unshift(p.data.label);
      p = p.parent;
    }
    const heatVal = datumHeat(d);

    cells.push({
      node: d.data.ref ?? null,
      label: d.data.label,
      x0: (d.depth - 1) * columnWidth,
      x1: d.depth * columnWidth,
      y0: d.x0,
      y1: d.x1,
      depth: d.depth,
      value: d.value ?? 0,
      isContainer: !!d.children && d.children.length > 0,
      isCollapsed: false,
      topIndex: (d as { _topIndex?: number })._topIndex ?? 0,
      pctOfRoot: (d.value ?? 0) / total,
      pctOfParent:
        d.parent && (d.parent.value ?? 0) > 0
          ? (d.value ?? 0) / (d.parent.value ?? 1)
          : 1,
      ...(heatVal !== undefined && { heat: heatVal }),
      path,
      ...(d.data.lineNumber !== undefined && { lineNumber: d.data.lineNumber }),
    });
  }

  return { cells, total, columnWidth, maxDepthReached, isEmpty: false };
}
