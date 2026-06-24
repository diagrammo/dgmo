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
  /** Original parsed node; undefined for the synthetic root + Other buckets. */
  ref?: TreemapNode;
  label: string;
  /** Leaf size (only meaningful on leaves). */
  value?: number;
  heat?: number;
  children?: LayoutDatum[];
  isOther: boolean;
  /** Source line for click-to-source wiring (when available). */
  lineNumber?: number;
}

export interface TreemapCell {
  /** Original parsed node, or null for the synthetic Other bucket. */
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
  readonly isOther: boolean;
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
  /** Roll children below this percent of their parent into an `Other` bucket. */
  readonly otherBelow?: number;
}

/**
 * Header band height for a container, scaled with its size so big sections get
 * a more prominent header (and room for a larger header font). `base` is the
 * minimum/floor; the band tops out at ~2.4× base.
 */
export function headerBandHeight(w: number, h: number, base: number): number {
  if (base <= 0) return base;
  const scaled = Math.round(Math.min(w, h) * 0.1);
  return Math.max(base, Math.min(scaled, Math.round(base * 2.4)));
}

/** Summed value of a parsed node (leaf value or sum of descendants). */
export function sumValue(node: TreemapNode): number {
  if (node.children.length === 0) return node.value ?? 0;
  let s = 0;
  for (const c of node.children) s += sumValue(c);
  return s;
}

/** Convert a parsed node into a layout datum, applying `other-below` rollup. */
function toDatum(node: TreemapNode, otherBelow?: number): LayoutDatum {
  if (node.children.length === 0) {
    return {
      ref: node,
      label: node.label,
      value: node.value ?? 0,
      ...(node.heat !== undefined && { heat: node.heat }),
      isOther: false,
      lineNumber: node.lineNumber,
    };
  }

  let kids = node.children.map((c) => toDatum(c, otherBelow));

  if (otherBelow !== undefined) {
    const total = kids.reduce((a, k) => a + datumSum(k), 0);
    if (total > 0) {
      const small: LayoutDatum[] = [];
      const keep: LayoutDatum[] = [];
      for (const k of kids) {
        const pct = (datumSum(k) / total) * 100;
        (pct < otherBelow ? small : keep).push(k);
      }
      // Only roll when ≥2 children qualify (a lone small child stays visible).
      if (small.length >= 2) {
        keep.push({
          label: 'Other',
          isOther: true,
          children: small,
        });
        kids = keep;
      }
    }
  }

  return {
    ref: node,
    label: node.label,
    ...(node.heat !== undefined && { heat: node.heat }),
    isOther: false,
    lineNumber: node.lineNumber,
    children: kids,
  };
}

function datumSum(d: LayoutDatum): number {
  if (!d.children || d.children.length === 0) return d.value ?? 0;
  let s = 0;
  for (const c of d.children) s += datumSum(c);
  return s;
}

/** Mean heat across the leaves under a datum (own heat if it is a leaf). */
function datumHeat(
  node: HierarchyRectangularNode<LayoutDatum>
): number | undefined {
  if (node.data.heat !== undefined) return node.data.heat;
  const xs: number[] = [];
  for (const l of node.leaves()) {
    if (l.data.heat !== undefined) xs.push(l.data.heat);
  }
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function layoutTreemap(
  roots: readonly TreemapNode[],
  opts: TreemapLayoutOptions
): TreemapLayoutResult {
  const maxDepth = opts.maxDepth ?? Infinity;
  const rootDatum: LayoutDatum = {
    label: '__root',
    isOther: false,
    children: roots.map((r) => toDatum(r, opts.otherBelow)),
  };

  const h = hierarchy<LayoutDatum>(rootDatum)
    .sum((d) => (d.children?.length ? 0 : (d.value ?? 0)))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const outer = opts.paddingOuter ?? 3;
  const hroot = treemap<LayoutDatum>()
    .tile(treemapSquarify)
    .size([opts.width, opts.height])
    .paddingOuter(outer)
    // Header band scales with the section's size (bigger section → taller band)
    // so its header font can grow. The synthetic root (depth 0) has no header,
    // so it just uses the outer padding.
    .paddingTop((d) =>
      opts.headerH > 0 && d.depth > 0
        ? headerBandHeight(d.x1 - d.x0, d.y1 - d.y0, opts.headerH)
        : opts.headerH > 0
          ? outer
          : (opts.paddingInner ?? 2)
    )
    .paddingInner(opts.paddingInner ?? 2)
    .round(true)(h);

  const total = hroot.value ?? 0;

  // Tag each node with the index of its depth-1 ancestor (branch hue).
  (hroot.children ?? []).forEach((top, i) => {
    top.each((d) => {
      (d as { _topIndex?: number })._topIndex = i;
    });
  });

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

    const heatVal = datumHeat(d);
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
      isOther: d.data.isOther,
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
