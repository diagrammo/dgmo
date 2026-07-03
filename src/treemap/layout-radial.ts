// ============================================================
// Treemap — Radial (sunburst) angle-partition layout (d3-hierarchy)
// ============================================================
//
// Disjoint from the squarified `layout.ts`: a treemap encodes value as AREA
// (2-D); a sunburst encodes value as ANGLE (1-D sweep) and radius encodes DEPTH
// only (no magnitude). So this is a net-new angle-partition, not an adaptation
// of the area-packing layout.
//
// Core invariant: `arc.sweep = node.value / root.value × 2π`; every child's arc
// is nested within its parent's angular wedge. Children are laid out in SOURCE
// ORDER (NO value-sort — deliberately unlike the rectangular treemap, which
// value-sorts at layout.ts:129), clockwise from 12 o'clock. The synthetic
// `__root` is the center disc (chart title holder, NOT drawn as a ring); its
// children (`roots`) are ring 1, their descendants successive rings.
//
// Static export = FULL tree: no depth cap, no collapse bands, no "+N more".
// `maxDepth` is accepted (defaults to Infinity) for the app to pass an
// interactive render budget; dgmo static export never sets it.

import {
  hierarchy,
  partition,
  type HierarchyRectangularNode,
} from 'd3-hierarchy';
import type { TreemapNode } from './types';

/** Internal datum fed to d3-hierarchy (carries the original node ref).
 *  Duplicated from `layout.ts` (which keeps it module-private) so this radial
 *  path needs no edit to the squarify layout. */
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

/** A positioned sunburst arc. Reuses every geometry-NEUTRAL field of
 *  `TreemapCell`, swapping the 4 rect coords for polar `{start/endAngle,
 *  inner/outerR}`. */
export interface RadialCell {
  /** Original parsed node, or null for the synthetic root. */
  readonly node: TreemapNode | null;
  readonly label: string;
  /** Radians, clockwise, 0 = 12 o'clock (d3.arc convention). */
  readonly startAngle: number;
  readonly endAngle: number;
  readonly innerR: number;
  readonly outerR: number;
  /** 1-based depth (ring index; depth 1 = first ring outward from the disc). */
  readonly depth: number;
  readonly value: number;
  /** Has children (drawn as an inner ring with its own outer rings). */
  readonly isContainer: boolean;
  /** Always false for static export (full tree); kept for TreemapCell parity. */
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

export interface RadialLayoutResult {
  readonly cells: readonly RadialCell[];
  /** Grand total (sum of all leaf values). */
  readonly total: number;
  /** Radius of the center disc (title + total holder). */
  readonly discRadius: number;
  /** Deepest ring depth actually present (0 when empty). */
  readonly maxDepthReached: number;
  /** True when `roots` exist but the grand total is 0 (all-zero leaves) —
   *  the renderer draws an empty-state marker in the disc, no arcs. */
  readonly isEmpty: boolean;
}

export interface RadialLayoutOptions {
  /** Outer radius available for the whole sunburst (disc + rings). */
  readonly radius: number;
  /** Center disc radius; defaults to a sensible fraction of `radius`. */
  readonly discRadius?: number;
  /** Interactive render budget; static export leaves it Infinity (full tree). */
  readonly maxDepth?: number;
}

/** Convert a parsed node into a layout datum (mirrors layout.ts `toDatum`). */
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

/** Mean heat across the leaves under a datum (mirrors layout.ts `datumHeat`). */
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

/** Default center-disc radius. Pinned to a fraction of the outer radius, but
 *  capped to ~one ring's share when the tree is deep so the rings stay usable. */
function defaultDiscRadius(radius: number, treeDepth: number): number {
  const frac = radius * 0.32;
  const share = radius / (Math.max(1, treeDepth) + 1);
  return Math.min(frac, share);
}

export function layoutTreemapRadial(
  roots: readonly TreemapNode[],
  opts: RadialLayoutOptions
): RadialLayoutResult {
  const maxDepth = opts.maxDepth ?? Infinity;
  const radius = Math.max(1, opts.radius);

  const rootDatum: LayoutDatum = {
    label: '__root',
    children: roots.map((r) => toDatum(r)),
  };

  // NO `.sort()` — d3.hierarchy preserves input (source) order when sort is not
  // called, which is exactly ADR-4's contract (unlike the rect layout).
  const h = hierarchy<LayoutDatum>(rootDatum).sum((d) =>
    d.children?.length ? 0 : (d.value ?? 0)
  );

  const total = h.value ?? 0;
  // F5: `roots` exist but grand total is 0 (all-zero leaves) → empty-state, no
  // divide-by-zero / NaN arcs. (The truly empty tree never reaches here.)
  if (total <= 0) {
    return {
      cells: [],
      total: 0,
      discRadius: opts.discRadius ?? defaultDiscRadius(radius, 1),
      maxDepthReached: 0,
      isEmpty: true,
    };
  }

  // Angle-partition: x0/x1 are ANGLES in [0, 2π] (radius axis normalized to
  // [0,1]; we compute the actual radii ourselves so the disc keeps a fixed
  // fraction regardless of tree depth).
  const hroot = partition<LayoutDatum>().size([2 * Math.PI, 1])(h);

  const treeDepth = hroot.height; // deepest level below the synthetic root
  const discRadius = Math.min(
    radius - 1,
    opts.discRadius ?? defaultDiscRadius(radius, treeDepth)
  );
  const ringSpan = Math.max(1, radius - discRadius);
  const ringWidth = ringSpan / Math.max(1, treeDepth);

  // Tag each node with the index of its depth-1 ancestor (branch hue), matching
  // the rect layout's `_topIndex` tagging.
  (hroot.children ?? []).forEach((top, i) => {
    top.each((d) => {
      (d as { _topIndex?: number })._topIndex = i;
    });
  });

  const cells: RadialCell[] = [];
  let maxDepthReached = 0;

  for (const d of hroot.descendants()) {
    if (d.depth === 0) continue; // synthetic root = the disc, drawn separately
    if (d.depth > maxDepth) continue; // beyond the (interactive) render window

    const hasChildren = !!d.children && d.children.length > 0;
    if (d.depth > maxDepthReached) maxDepthReached = d.depth;

    const path: string[] = [];
    let p: HierarchyRectangularNode<LayoutDatum> | null = d;
    while (p && p.depth > 0) {
      path.unshift(p.data.label);
      p = p.parent;
    }

    const innerR = discRadius + (d.depth - 1) * ringWidth;
    const outerR = discRadius + d.depth * ringWidth;
    const heatVal = datumHeat(d);

    cells.push({
      node: d.data.ref ?? null,
      label: d.data.label,
      startAngle: d.x0,
      endAngle: d.x1,
      innerR,
      outerR,
      depth: d.depth,
      value: d.value ?? 0,
      isContainer: hasChildren,
      isCollapsed: false,
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

  return { cells, total, discRadius, maxDepthReached, isEmpty: false };
}
