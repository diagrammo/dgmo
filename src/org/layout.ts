// ============================================================
// Org Chart Tree Layout Engine (d3-hierarchy)
// ============================================================

import { tagAttrKey } from '../utils/tag-groups';
import { hierarchy, tree } from 'd3-hierarchy';
import type { ParsedOrg, OrgNode } from './parser';
import type { Writable } from '../utils/brand';
import type { TagGroup } from '../utils/tag-groups';
import { resolveTagColor, injectDefaultTagMetadata } from '../utils/tag-groups';
import { legendSuppressed } from '../utils/parsing';
import {
  LEGEND_PILL_FONT_SIZE,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
  LEGEND_EYE_SIZE,
  LEGEND_EYE_GAP,
  measureLegendText,
} from '../utils/legend-constants';
import { measureText } from '../utils/text-measure';

// ============================================================
// Types
// ============================================================

export interface OrgLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly metadata: Readonly<Record<string, string>>;
  /** Original (unfiltered) metadata — used for tag-based hover dimming even when the group is hidden */
  readonly tagMetadata: Readonly<Record<string, string>>;
  readonly isContainer: boolean;
  readonly lineNumber: number;
  readonly color?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Count of hidden descendants when this node is collapsed */
  readonly hiddenCount?: number;
  /** True if node has children (expanded or collapsed) — drives toggle UI */
  readonly hasChildren?: boolean;
}

export interface OrgLayoutEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export interface OrgContainerBounds {
  readonly nodeId: string;
  readonly label: string;
  readonly lineNumber: number;
  readonly color?: string;
  readonly metadata: Readonly<Record<string, string>>;
  /** Original (unfiltered) metadata — used for tag-based hover dimming even when the group is hidden */
  readonly tagMetadata: Readonly<Record<string, string>>;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly labelHeight: number;
  /** Count of hidden descendants when this container is collapsed */
  readonly hiddenCount?: number;
  /** True if container has children (expanded or collapsed) — drives toggle UI */
  readonly hasChildren?: boolean;
}

export interface OrgLegendEntry {
  readonly value: string;
  readonly color: string;
}

export interface OrgLegendGroup {
  readonly name: string;
  readonly alias?: string;
  readonly entries: readonly OrgLegendEntry[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly minifiedWidth: number;
  readonly minifiedHeight: number;
}

export interface OrgLayoutResult {
  readonly nodes: readonly OrgLayoutNode[];
  readonly edges: readonly OrgLayoutEdge[];
  readonly containers: readonly OrgContainerBounds[];
  readonly legend: readonly OrgLegendGroup[];
  readonly width: number;
  readonly height: number;
  /**
   * How far every node, container and edge point was pushed DOWN to leave room
   * for a legend row drawn inside the diagram — 0 when no group is visible.
   * A renderer that draws the legend somewhere else (the app pins it above the
   * scaled diagram at native size) takes this back, so it must read the shift
   * that was actually applied rather than assume one (#325).
   */
  readonly legendShift: number;
}

// ============================================================
// Constants
// ============================================================

// Card text font sizes — MUST match the renderer (LABEL_FONT_SIZE / META_FONT_SIZE)
// so node sizing measures text at the exact size it is drawn.
const LABEL_FONT_SIZE = 13;
const META_FONT_SIZE = 11;
const META_LINE_HEIGHT = 16;
const HEADER_HEIGHT = 28;
const SEPARATOR_GAP = 6;
const CARD_H_PAD = 20;
const CARD_V_PAD = 10;
const MIN_CARD_WIDTH = 140;
const H_GAP = 30;
const V_GAP = 50;
const MARGIN = 40;
const CONTAINER_PAD_X = 24;
const CONTAINER_PAD_BOTTOM = 24;
const CONTAINER_LABEL_HEIGHT = 28;
const CONTAINER_META_LINE_HEIGHT = 16;
const STACK_V_GAP = 20;

// Legend (kanban-style pills)

// ============================================================
// Helpers
// ============================================================

/** Count all non-container descendants recursively, including hidden (collapsed) ones. */
function countDescendantNodes(
  node: OrgNode,
  hiddenCounts?: Map<string, number>
): number {
  let count = 0;
  for (const child of node.children) {
    count +=
      (child.isContainer ? 0 : 1) + countDescendantNodes(child, hiddenCounts);
    const hc = hiddenCounts?.get(child.id);
    if (hc) count += hc;
  }
  return count;
}

// ============================================================
// Card Sizing
// ============================================================

function filterMetadata(
  metadata: Record<string, string>,
  hiddenAttributes?: Set<string>
): Record<string, string> {
  if (!hiddenAttributes || hiddenAttributes.size === 0) return metadata;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!hiddenAttributes.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function computeCardWidth(label: string, meta: Record<string, string>): number {
  // Label is drawn bold at LABEL_FONT_SIZE; meta rows regular at META_FONT_SIZE.
  let maxTextWidth = measureText(label, LABEL_FONT_SIZE, { bold: true });

  for (const [key, value] of Object.entries(meta)) {
    const lineWidth = measureText(`${key}: ${value}`, META_FONT_SIZE);
    if (lineWidth > maxTextWidth) maxTextWidth = lineWidth;
  }

  return Math.max(MIN_CARD_WIDTH, Math.ceil(maxTextWidth) + CARD_H_PAD * 2);
}

function computeCardHeight(meta: Record<string, string>): number {
  const metaCount = Object.keys(meta).length;
  if (metaCount === 0) return HEADER_HEIGHT + CARD_V_PAD;
  return (
    HEADER_HEIGHT + SEPARATOR_GAP + metaCount * META_LINE_HEIGHT + CARD_V_PAD
  );
}

// ============================================================
// Tag Group Color Resolution
// ============================================================

function resolveNodeColor(
  node: OrgNode,
  tagGroups: readonly TagGroup[],
  activeGroupName: string | null
): string | undefined {
  // Explicit inline (color) always wins — handled before tag resolution
  if (node.color) return node.color;
  return resolveTagColor(
    node.metadata,
    [...tagGroups],
    activeGroupName,
    node.isContainer
  );
}

// ============================================================
// Hierarchy Helpers
// ============================================================

interface TreeNode {
  orgNode: OrgNode;
  children: TreeNode[];
  width: number;
  height: number;
}

function buildTreeNodes(
  nodes: readonly OrgNode[],
  hiddenCounts?: Map<string, number>,
  hiddenAttributes?: Set<string>,
  subNodeLabel?: string,
  showSubNodeCount?: boolean
): TreeNode[] {
  return nodes.map((orgNode) => {
    const meta = filterMetadata(orgNode.metadata, hiddenAttributes);
    const hc = hiddenCounts?.get(orgNode.id);
    if (!orgNode.isContainer && showSubNodeCount && !(hc != null && hc > 0)) {
      const count = countDescendantNodes(orgNode, hiddenCounts);
      if (count > 0) {
        meta[subNodeLabel ?? 'Sub-node Count'] = String(count);
      }
    }
    return {
      orgNode,
      children: buildTreeNodes(
        orgNode.children,
        hiddenCounts,
        hiddenAttributes,
        subNodeLabel,
        showSubNodeCount
      ),
      width: computeCardWidth(orgNode.label, meta),
      height: computeCardHeight(meta),
    };
  });
}

/**
 * Count total descendants (children + grandchildren + ...) of a TreeNode.
 */
function countDescendants(node: TreeNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

/**
 * Recursively reorder children so subtrees with the most descendants
 * occupy center positions. Produces a balanced, symmetrical layout.
 * Skips nodes with ≤2 children (no meaningful center to target).
 */
function centerHeavyChildren(node: TreeNode): void {
  for (const child of node.children) {
    centerHeavyChildren(child);
  }
  if (node.children.length <= 2) return;

  const weighted = node.children
    .map((child) => ({ child, weight: countDescendants(child) }))
    .sort((a, b) => b.weight - a.weight);

  const result: TreeNode[] = new Array(weighted.length);
  const mid = Math.floor((weighted.length - 1) / 2);
  let left = mid;
  let right = mid;

  for (let i = 0; i < weighted.length; i++) {
    // In-bounds by loop guard.
    const w = weighted[i]!;
    if (i === 0) {
      result[mid] = w.child;
    } else if (i % 2 === 1) {
      right++;
      result[right] = w.child;
    } else {
      left--;
      result[left] = w.child;
    }
  }

  node.children = result;
}

// ============================================================
// Layout
// ============================================================

function computeLegendGroups(
  tagGroups: readonly TagGroup[],
  showEyeIcons: boolean,
  usedValuesByGroup?: Map<string, Set<string>>
): Writable<OrgLegendGroup>[] {
  const groups: Writable<OrgLegendGroup>[] = [];

  for (const group of tagGroups) {
    if (group.entries.length === 0) continue;

    // Filter entries to only values actually used by nodes (if provided)
    const usedValues = usedValuesByGroup?.get(tagAttrKey(group.name));
    const visibleEntries = usedValues
      ? group.entries.filter((e) => usedValues.has(e.value.toLowerCase()))
      : group.entries;
    if (visibleEntries.length === 0) continue;

    // Pill label shows just the group name (alias is for DSL shorthand only)
    const pillWidth =
      measureLegendText(group.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
    const minPillWidth = pillWidth;

    // Capsule: pad + pill + gap + entries + pad
    let entriesWidth = 0;
    for (const entry of visibleEntries) {
      entriesWidth +=
        LEGEND_DOT_R * 2 +
        LEGEND_ENTRY_DOT_GAP +
        measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE) +
        LEGEND_ENTRY_TRAIL;
    }
    const eyeSpace = showEyeIcons ? LEGEND_EYE_SIZE + LEGEND_EYE_GAP : 0;
    const capsuleWidth =
      LEGEND_CAPSULE_PAD * 2 + pillWidth + 4 + eyeSpace + entriesWidth;

    groups.push({
      name: group.name,
      ...(group.alias !== undefined && { alias: group.alias }),
      entries: visibleEntries.map((e) => ({
        value: e.value,
        color: e.color,
      })),
      x: 0,
      y: 0,
      width: capsuleWidth,
      height: LEGEND_HEIGHT,
      minifiedWidth: minPillWidth,
      minifiedHeight: LEGEND_HEIGHT,
    });
  }

  return groups;
}

/**
 * Inject default tag group values into non-container node metadata.
 * Delegates to shared `injectDefaultTagMetadata` with org-specific skip logic.
 */
function injectDefaultMetadata(
  roots: readonly OrgNode[],
  tagGroups: readonly TagGroup[]
): void {
  // Flatten all nodes (recursive) for the shared utility
  const allNodes: OrgNode[] = [];
  const collect = (node: OrgNode) => {
    allNodes.push(node);
    for (const child of node.children) collect(child);
  };
  for (const root of roots) collect(root);

  injectDefaultTagMetadata(
    allNodes,
    tagGroups,
    (entity) => (entity as OrgNode).isContainer
  );
}

export function layoutOrg(
  parsed: ParsedOrg,
  hiddenCounts?: Map<string, number>,
  activeTagGroup?: string | null,
  hiddenAttributes?: Set<string>,
  expandAllLegend?: boolean
): OrgLayoutResult {
  if (parsed.roots.length === 0) {
    // Legend-only: compute and position legend groups even without nodes
    const showEyeIcons = hiddenAttributes !== undefined;
    const legendGroups = computeLegendGroups(
      legendSuppressed(parsed.options) ? [] : parsed.tagGroups,
      showEyeIcons
    );
    if (legendGroups.length === 0) {
      return {
        nodes: [],
        edges: [],
        containers: [],
        legend: [],
        width: 0,
        height: 0,
        legendShift: 0,
      };
    }

    // Legend-only mode: stack groups vertically, all expanded
    let cy = MARGIN;
    let maxWidth = 0;
    for (const g of legendGroups) {
      g.x = MARGIN;
      g.y = cy;
      cy += LEGEND_HEIGHT + LEGEND_GROUP_GAP;
      if (g.width > maxWidth) maxWidth = g.width;
    }
    return {
      nodes: [],
      edges: [],
      containers: [],
      legend: legendGroups,
      width: maxWidth + MARGIN * 2,
      height: cy - LEGEND_GROUP_GAP + MARGIN,
      legendShift: 0,
    };
  }

  // Layout direction (§7.5). The tree is always solved in an *abstract*
  // coordinate space where `y` runs along the depth axis (root → reports) and
  // `x` runs along the cross axis (sibling spread). Only two things vary by
  // direction: which card dimension spans each axis, and the final mapping
  // from abstract space to screen space. Keeping every intermediate pass in
  // abstract space means the tidy-tree solve, the compaction passes, the bus
  // router and the container fitter each exist exactly once.
  //
  // In TB the mapping is the identity, so the top-down output is unchanged.
  const isLR = parsed.direction === 'LR';

  /** Card extent along the depth axis (root → reports). */
  const depthExtent = (tn: { width: number; height: number }): number =>
    isLR ? tn.width : tn.height;
  /** Card extent along the cross axis (sibling spread). */
  const crossExtent = (tn: { width: number; height: number }): number =>
    isLR ? tn.height : tn.width;

  /**
   * Map an abstract point to screen space.
   *
   * Abstract `x` is the cross coordinate and `y` the depth coordinate; on
   * screen LR runs depth along the page's x axis, so the two simply swap.
   */
  const ptToScreen = (ax: number, ay: number): { x: number; y: number } =>
    isLR ? { x: ay, y: ax } : { x: ax, y: ay };

  /**
   * Map an abstract card position to its screen top-left corner.
   *
   * A node's abstract `x` is its cross-axis *centre* while its abstract `y` is
   * its depth-axis *near* edge, so the two axes de-anchor differently.
   */
  const screenTopLeft = (
    ax: number,
    ay: number,
    w: number,
    h: number
  ): { left: number; top: number } =>
    isLR ? { left: ay, top: ax - h / 2 } : { left: ax - w / 2, top: ay };

  // Inject default tag group values into node metadata for display.
  // Must happen before buildTreeNodes so card sizing accounts for extra rows.
  injectDefaultMetadata(parsed.roots, parsed.tagGroups);

  // Build tree structure
  const subNodeLabel = parsed.options['sub-node-label'] ?? undefined;
  const showSubNodeCount = ['yes', 'on'].includes(
    parsed.options['show-sub-node-count']?.toLowerCase() ?? ''
  );
  const treeNodes = buildTreeNodes(
    parsed.roots,
    hiddenCounts,
    hiddenAttributes,
    subNodeLabel,
    showSubNodeCount
  );

  // Single root or virtual root for multiple roots
  let root: TreeNode;
  if (treeNodes.length === 1) {
    // In-bounds by length === 1 guard.
    root = treeNodes[0]!;
  } else {
    root = {
      orgNode: {
        id: '__virtual_root__',
        label: '',
        metadata: {},
        children: parsed.roots,
        parentId: null,
        isContainer: false,
        lineNumber: 0,
      },
      children: treeNodes,
      width: 0,
      height: 0,
    };
  }

  // Pre-compute max card dimensions for node separation.
  // `maxWidth`/`maxHeight` stay literal card dimensions; the per-axis maxima
  // used for tree spacing are derived from them below.
  let maxWidth = 0;
  let maxHeight = 0;
  const allTreeNodes: TreeNode[] = [];
  const collectNodes = (tn: TreeNode) => {
    if (tn.orgNode.id !== '__virtual_root__') {
      allTreeNodes.push(tn);
      if (tn.width > maxWidth) maxWidth = tn.width;
      if (tn.height > maxHeight) maxHeight = tn.height;
    }
    for (const child of tn.children) collectNodes(child);
  };
  collectNodes(root);

  // Standardize all cards to the widest width for uniform appearance.
  // This also makes the depth extent uniform under LR, so ranks line up as
  // clean columns the same way they line up as clean rows under TB.
  for (const tn of allTreeNodes) {
    tn.width = maxWidth;
  }

  // Per-axis maxima, now that widths are uniform.
  const maxDepthExtent = isLR ? maxWidth : maxHeight;
  const maxCrossExtent = isLR ? maxHeight : maxWidth;
  // Gaps are named for their screen axis under TB but chosen by *role*, so
  // they do not swap with direction: V_GAP always separates ranks and H_GAP
  // always separates siblings, whichever way the tree happens to run.
  const depthGap = V_GAP;
  const crossGap = H_GAP;

  // Collapse leaf containers: when a container's children are ALL leaves
  // (no grandchildren), replace them with a single virtual stack node so
  // the d3 tree allocates a thin run along the depth axis rather than a
  // broad one across the cross axis. Under TB that reads as the familiar
  // narrow column instead of a wide row; under LR it is the transpose.
  const leafStacks = new Map<
    string,
    { children: TreeNode[]; placeholderId: string }
  >();

  const collapseLeafContainers = (tn: TreeNode): void => {
    for (const child of tn.children) collapseLeafContainers(child);

    if (
      tn.orgNode.isContainer &&
      tn.children.length > 0 &&
      tn.children.every((c) => c.children.length === 0)
    ) {
      const placeholderId = `__stack_${tn.orgNode.id}`;
      leafStacks.set(tn.orgNode.id, {
        children: [...tn.children],
        placeholderId,
      });

      const maxW = Math.max(...tn.children.map((c) => c.width));
      // Standardize all children to the widest card width
      for (const child of tn.children) {
        child.width = maxW;
      }
      // The placeholder is thin across the cross axis and long along the
      // depth axis: it stands in for the whole stack of leaves.
      const stackDepth =
        tn.children.reduce((s, c) => s + depthExtent(c), 0) +
        (tn.children.length - 1) * STACK_V_GAP;
      const stackCross = Math.max(...tn.children.map((c) => crossExtent(c)));

      tn.children = [
        {
          orgNode: {
            id: placeholderId,
            label: '',
            metadata: {},
            children: [],
            parentId: tn.orgNode.id,
            isContainer: false,
            lineNumber: 0,
          },
          children: [],
          width: isLR ? stackDepth : stackCross,
          height: isLR ? stackCross : stackDepth,
        },
      ];
    }
  };
  collapseLeafContainers(root);

  // Reorder children: heaviest subtrees in center positions
  centerHeavyChildren(root);

  // Build d3 hierarchy
  const h = hierarchy<TreeNode>(root, (d) => d.children);

  // Run Reingold-Tilford tree layout with nodeSize.
  // x = cross axis (sibling spread), y = depth axis.
  const treeLayout = tree<TreeNode>().nodeSize([
    maxCrossExtent + crossGap,
    maxDepthExtent + depthGap,
  ]);
  treeLayout(h);

  // Post-layout: compact vertical spacing per depth level.
  // D3 tree uses uniform nodeSize (maxHeight + V_GAP) for every level, which
  // creates disproportionate gaps when short nodes (no metadata) are placed at
  // the same level-spacing as tall nodes (multiple metadata rows). Recompute
  // Y positions so each level's gap is based on the actual max height at that
  // level rather than the global max.
  {
    const descendants = h
      .descendants()
      .filter((d) => d.data.orgNode.id !== '__virtual_root__');

    // Collect max actual card height per depth level.
    // Exclude __stack_ placeholders — their aggregate height (multiple
    // stacked cards) would inflate the level max and push sibling
    // subtrees' deeper children far below where they need to be.
    const levelMaxHeight = new Map<number, number>();
    for (const d of descendants) {
      if (d.data.orgNode.id.startsWith('__stack_')) continue;
      const cur = levelMaxHeight.get(d.depth) ?? 0;
      const ext = depthExtent(d.data);
      if (ext > cur) levelMaxHeight.set(d.depth, ext);
    }

    // Compute compacted Y position for each depth level
    const maxDepth = Math.max(...levelMaxHeight.keys(), 0);
    const compactedY = new Map<number, number>();
    // Virtual root (depth 0 in hierarchy) stays at y=0
    // First real level starts at depth 1 for multi-root or depth 0 for single root.
    // We compute based on the d3 hierarchy's depth numbering.
    const rootDepth = treeNodes.length === 1 ? 0 : 1;
    compactedY.set(rootDepth, 0);
    for (let d = rootDepth + 1; d <= maxDepth; d++) {
      const parentH = levelMaxHeight.get(d - 1) ?? maxDepthExtent;
      const prevY = compactedY.get(d - 1) ?? 0;
      compactedY.set(d, prevY + parentH + depthGap);
    }

    // Shift each node from uniform Y to compacted Y (top-aligned).
    // Siblings share the same Y so connecting edges align cleanly.
    for (const d of h.descendants()) {
      if (d.data.orgNode.id === '__virtual_root__') continue;
      d.y = compactedY.get(d.depth) ?? d.y!;
    }
  }

  // Post-layout: tighten vertical spacing inside containers.
  // Container-with-children nodes render as background boxes (not cards),
  // so their children can sit closer to the container header.
  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (!d.data.orgNode.isContainer) continue;
    if (!d.children || d.children.length === 0) continue;

    // Actual gap between this container and its direct children — in-bounds by length > 0 guard above.
    const childY = d.children[0]!.y!;
    const actualLevelGap = childY - d.y!;

    const metaCount = Object.keys(d.data.orgNode.metadata).length;
    const headerHeight =
      CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
    // The label strip is always drawn across the top of the box, so it only
    // consumes depth-axis room under TB. Under LR the depth axis runs across
    // the box and the children just need the box's side padding.
    const desiredGap = isLR ? CONTAINER_PAD_X : headerHeight + 15;
    const shiftUp = actualLevelGap - desiredGap;
    if (shiftUp <= 0) continue;

    // Shift all descendants upward
    const shift = (node: typeof d) => {
      if (node.children) {
        for (const child of node.children) {
          child.y! -= shiftUp;
          shift(child);
        }
      }
    };
    shift(d);
  }

  // Post-layout: tighten gap between non-container parents and their
  // container children. Containers render as header boxes (not full cards),
  // so the standard inter-level gap is visually excessive.
  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (d.data.orgNode.isContainer) continue; // only non-container parents
    if (!d.children || d.children.length === 0) continue;

    // Only apply when ALL direct children are containers — mixed children
    // need standard spacing so siblings stay aligned.
    if (!d.children.every((c) => c.data.orgNode.isContainer)) continue;

    const parentBottomY = d.y! + depthExtent(d.data);
    const firstChildY = Math.min(...d.children.map((c) => c.y!));
    const currentGap = firstChildY - parentBottomY;
    const desiredGap = depthGap * 0.6;
    const shiftUp = currentGap - desiredGap;
    if (shiftUp <= 0) continue;

    // Shift all container children and their descendants up
    const shiftDown = (node: typeof d) => {
      node.y! -= shiftUp;
      if (node.children) {
        for (const child of node.children) {
          shiftDown(child);
        }
      }
    };
    for (const child of d.children) {
      shiftDown(child);
    }
  }

  // Post-layout: compact sibling spacing based on actual subtree widths.
  // D3 uses uniform nodeSize so narrow stacks get the same gap as wide
  // subtrees. Process bottom-up so inner subtrees are compact first.
  {
    type HNode = typeof h;
    const subtreeExtent = (node: HNode): { minX: number; maxX: number } => {
      // Start with this node's own card/header bounds
      let min = node.x! - crossExtent(node.data) / 2;
      let max = node.x! + crossExtent(node.data) / 2;

      // Include children's subtree extents
      if (node.children) {
        for (const child of node.children) {
          const childExt = subtreeExtent(child);
          if (childExt.minX < min) min = childExt.minX;
          if (childExt.maxX > max) max = childExt.maxX;
        }
      }

      // Container boxes wrap their content with padding — mirror the
      // actual bounding-box computation so compaction sees the true width.
      if (node.data.orgNode.isContainer) {
        min -= CONTAINER_PAD_X;
        max += CONTAINER_PAD_X;
        // Under LR the box also reserves its label strip on the cross axis
        // (the label is always drawn across the top). Reserving it here too
        // keeps sibling containers from crowding the strip below them.
        if (isLR) {
          const metaCount = Object.keys(node.data.orgNode.metadata).length;
          min -=
            CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
        }
      }

      return { minX: min, maxX: max };
    };

    const shiftX = (node: HNode, dx: number) => {
      node.x! += dx;
      if (node.children) node.children.forEach((c) => shiftX(c, dx));
    };

    const internalNodes = h
      .descendants()
      .filter((d) => d.children && d.children.length >= 2)
      .sort((a, b) => b.depth - a.depth);

    for (const parent of internalNodes) {
      const children = parent.children!;

      const extents = children.map((child) => {
        const ext = subtreeExtent(child);
        return {
          relLeft: ext.minX - child.x!,
          relRight: ext.maxX - child.x!,
        };
      });

      // children filtered to length >= 2 above, so first and last are in-bounds.
      const currentCenter =
        (children[0]!.x! + children[children.length - 1]!.x!) / 2;

      const positions: number[] = [0];
      for (let i = 1; i < children.length; i++) {
        // In-bounds: i >= 1 so i-1 >= 0, and extents is parallel to children.
        const prevRight = positions[i - 1]! + extents[i - 1]!.relRight;
        positions[i] = prevRight + crossGap - extents[i]!.relLeft;
      }

      // positions has at least one element (initialized with [0]).
      const newCenter = (positions[0]! + positions[positions.length - 1]!) / 2;
      const centerShift = currentCenter - newCenter;

      for (let i = 0; i < children.length; i++) {
        // In-bounds by loop guard.
        const newX = positions[i]! + centerShift;
        const dx = newX - children[i]!.x!;
        if (Math.abs(dx) > 0.001) {
          shiftX(children[i]!, dx);
        }
      }
    }
  }

  // Post-layout: center each parent exactly over its direct children.
  // d3-hierarchy centers over the subtree centroid, which drifts when
  // grandchildren have asymmetric widths. Process bottom-up so parents
  // see already-adjusted child positions.
  {
    const parentNodes = h
      .descendants()
      .filter(
        (d) =>
          d.children &&
          d.children.length >= 1 &&
          d.data.orgNode.id !== '__virtual_root__'
      )
      .sort((a, b) => b.depth - a.depth);

    for (const parent of parentNodes) {
      const childXs = parent.children!.map((c) => c.x!);
      const desiredX = (Math.min(...childXs) + Math.max(...childXs)) / 2;
      parent.x = desiredX;
    }
  }

  // Collect positioned nodes and edges
  const layoutNodes: Writable<OrgLayoutNode>[] = [];
  const layoutEdges: Writable<OrgLayoutEdge>[] = [];

  // Find bounding box and build outputs
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Expand leaf container stacks: compute individual child positions
  // in d3 coordinate space (before offset) so bounding box is correct
  interface ExpandedChild {
    orgNode: OrgNode;
    width: number;
    height: number;
    cx: number;
    cy: number;
  }
  const expandedChildren: ExpandedChild[] = [];

  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (!d.data.orgNode.id.startsWith('__stack_')) continue;

    const containerId = d.data.orgNode.id.replace('__stack_', '');
    const stack = leafStacks.get(containerId);
    if (!stack) continue;

    // Lay the stacked leaves out along the depth axis, in abstract space.
    let currentY = d.y!;
    for (const child of stack.children) {
      expandedChildren.push({
        orgNode: child.orgNode,
        width: child.width,
        height: child.height,
        cx: d.x!,
        cy: currentY,
      });
      currentY += depthExtent(child) + STACK_V_GAP;
    }
  }

  /**
   * Screen-space rect (still pre-offset) for a card at an abstract position.
   * Cards never rotate, so width/height stay as measured — only the anchor
   * changes with direction.
   */
  const screenRect = (
    ax: number,
    ay: number,
    w: number,
    h: number
  ): { left: number; top: number; right: number; bottom: number } => {
    const { left, top } = screenTopLeft(ax, ay, w, h);
    return { left, top, right: left + w, bottom: top + h };
  };

  const growBBox = (r: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }): void => {
    if (r.left < minX) minX = r.left;
    if (r.right > maxX) maxX = r.right;
    if (r.top < minY) minY = r.top;
    if (r.bottom > maxY) maxY = r.bottom;
  };

  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (d.data.orgNode.id.startsWith('__stack_')) continue;

    growBBox(screenRect(d.x!, d.y!, d.data.width, d.data.height));
  }

  for (const ec of expandedChildren) {
    growBBox(screenRect(ec.cx, ec.cy, ec.width, ec.height));
  }

  // Translate so all coordinates are positive, starting at MARGIN
  const offsetX = -minX + MARGIN;
  const offsetY = -minY + MARGIN;

  /**
   * Final placed card coordinates, in the convention the renderer expects:
   * `x` is the horizontal centre and `y` the top edge.
   */
  const placeCard = (
    ax: number,
    ay: number,
    w: number,
    h: number
  ): { x: number; y: number } => {
    const r = screenRect(ax, ay, w, h);
    return { x: r.left + offsetX + w / 2, y: r.top + offsetY };
  };

  // Add expanded stack children as layout nodes
  const subNodeKey = subNodeLabel ?? 'Sub-node Count';
  for (const ec of expandedChildren) {
    const hc = hiddenCounts?.get(ec.orgNode.id);
    const meta = filterMetadata(ec.orgNode.metadata, hiddenAttributes);
    if (
      !ec.orgNode.isContainer &&
      showSubNodeCount &&
      !(hc != null && hc > 0)
    ) {
      const count = countDescendantNodes(ec.orgNode, hiddenCounts);
      if (count > 0) meta[subNodeKey] = String(count);
    }
    const ecColor = resolveNodeColor(
      ec.orgNode,
      parsed.tagGroups,
      activeTagGroup ?? null
    );
    const ecHasChildren =
      ec.orgNode.children.length > 0 || (hc != null && hc > 0) || undefined;
    layoutNodes.push({
      id: ec.orgNode.id,
      label: ec.orgNode.label,
      metadata: meta,
      tagMetadata: { ...ec.orgNode.metadata },
      isContainer: ec.orgNode.isContainer,
      lineNumber: ec.orgNode.lineNumber,
      ...(ecColor !== undefined && { color: ecColor }),
      ...placeCard(ec.cx, ec.cy, ec.width, ec.height),
      width: ec.width,
      height: ec.height,
      ...(hc !== undefined && { hiddenCount: hc }),
      ...(ecHasChildren !== undefined && { hasChildren: ecHasChildren }),
    });
  }

  /** Final edge waypoint, mapped out of abstract space and offset. */
  const placePoint = (ax: number, ay: number): { x: number; y: number } => {
    const p = ptToScreen(ax, ay);
    return { x: p.x + offsetX, y: p.y + offsetY };
  };

  // Map parent ID → { parentX, parentBottomY, children[] } for bus-style edges.
  // Held in abstract space: `parentX` is the parent's cross coordinate and
  // `parentBottomY` its far edge along the depth axis, so the bus geometry
  // below is written once and mapped to the screen on emit.
  const busGroups = new Map<
    string,
    {
      parentX: number;
      parentBottomY: number;
      children: { id: string; x: number; topY: number }[];
    }
  >();

  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (d.data.orgNode.id.startsWith('__stack_')) continue;

    const orgNode = d.data.orgNode;
    const w = d.data.width;
    const ht = d.data.height;
    const { x, y } = placeCard(d.x!, d.y!, w, ht);

    const hc = hiddenCounts?.get(orgNode.id);
    const nodeMeta = filterMetadata(orgNode.metadata, hiddenAttributes);
    if (!orgNode.isContainer && showSubNodeCount && !(hc != null && hc > 0)) {
      const count = countDescendantNodes(orgNode, hiddenCounts);
      if (count > 0) nodeMeta[subNodeKey] = String(count);
    }
    const nodeColor = resolveNodeColor(
      orgNode,
      parsed.tagGroups,
      activeTagGroup ?? null
    );
    const nodeHasChildren =
      (d.children != null && d.children.length > 0) ||
      (hc != null && hc > 0) ||
      undefined;
    layoutNodes.push({
      id: orgNode.id,
      label: orgNode.label,
      metadata: nodeMeta,
      tagMetadata: { ...orgNode.metadata },
      isContainer: orgNode.isContainer,
      lineNumber: orgNode.lineNumber,
      ...(nodeColor !== undefined && { color: nodeColor }),
      x,
      y,
      width: w,
      height: ht,
      ...(hc !== undefined && { hiddenCount: hc }),
      ...(nodeHasChildren !== undefined && { hasChildren: nodeHasChildren }),
    });

    // Collect children per parent for bus-style edge generation
    const parentIsContainerBox =
      d.parent?.data.orgNode.isContainer &&
      d.parent.children &&
      d.parent.children.length > 0;
    if (
      d.parent &&
      d.parent.data.orgNode.id !== '__virtual_root__' &&
      !parentIsContainerBox
    ) {
      const parentId = d.parent.data.orgNode.id;
      if (!busGroups.has(parentId)) {
        busGroups.set(parentId, {
          parentX: d.parent.x!,
          parentBottomY: d.parent.y! + depthExtent(d.parent.data),
          children: [],
        });
      }
      busGroups.get(parentId)!.children.push({
        id: orgNode.id,
        x: d.x!,
        topY: d.y!,
      });
    }
  }

  // Generate non-overlapping edges using bus pattern
  for (const [parentId, group] of busGroups) {
    const { parentX, parentBottomY, children } = group;

    if (children.length === 1) {
      // Single child: simple elbow (no overlap possible) — in-bounds by length === 1.
      const child = children[0]!;
      const midY = (parentBottomY + child.topY) / 2;
      layoutEdges.push({
        sourceId: parentId,
        targetId: child.id,
        points: [
          placePoint(parentX, parentBottomY),
          placePoint(parentX, midY),
          placePoint(child.x, midY),
          placePoint(child.x, child.topY),
        ],
      });
    } else {
      // Bus pattern: trunk + cross-axis bar + per-child drops — length >= 2 here.
      const midY = (parentBottomY + children[0]!.topY) / 2;
      const childXs = children.map((c) => c.x);
      const leftX = Math.min(...childXs);
      const rightX = Math.max(...childXs);

      // Trunk: parent's far edge → midY
      layoutEdges.push({
        sourceId: parentId,
        targetId: parentId,
        points: [placePoint(parentX, parentBottomY), placePoint(parentX, midY)],
      });

      // Bus bar: first child → last child along the cross axis at midY
      layoutEdges.push({
        sourceId: parentId,
        targetId: parentId,
        points: [placePoint(leftX, midY), placePoint(rightX, midY)],
      });

      // Drops: midY → each child's near edge
      for (const child of children) {
        layoutEdges.push({
          sourceId: parentId,
          targetId: child.id,
          points: [placePoint(child.x, midY), placePoint(child.x, child.topY)],
        });
      }
    }
  }

  // Compute container bounds from d3 hierarchy (bottom-up so inner
  // container boxes are available when computing outer containers)
  const allContainerNodes = h
    .descendants()
    .filter(
      (d) =>
        d.data.orgNode.id !== '__virtual_root__' && d.data.orgNode.isContainer
    );

  // Map from node ID to computed visual bounds (offset-space)
  const containerBoundsMap = new Map<
    string,
    { minX: number; maxX: number; minY: number; maxY: number }
  >();

  const containers: Writable<OrgContainerBounds>[] = [];

  // First pass: childless containers — simple boxes at their own position.
  // Must be computed before parent containers so their bounds are available.
  const EMPTY_CONTAINER_MIN_HEIGHT = 60;
  for (const d of allContainerNodes) {
    if (d.children && d.children.length > 0) continue;

    const metaCount = Object.keys(d.data.orgNode.metadata).length;
    const labelHeight =
      CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
    const boxWidth = d.data.width;
    const boxHeight = Math.max(
      labelHeight + CONTAINER_PAD_BOTTOM,
      EMPTY_CONTAINER_MIN_HEIGHT
    );
    const emptyTL = screenTopLeft(d.x!, d.y!, boxWidth, boxHeight);
    const boxX = emptyTL.left + offsetX;
    const boxY = emptyTL.top + offsetY;

    containerBoundsMap.set(d.data.orgNode.id, {
      minX: boxX,
      maxX: boxX + boxWidth,
      minY: boxY,
      maxY: boxY + boxHeight,
    });

    const chc = hiddenCounts?.get(d.data.orgNode.id);
    const cMeta = filterMetadata(d.data.orgNode.metadata, hiddenAttributes);
    const cColor = resolveNodeColor(
      d.data.orgNode,
      parsed.tagGroups,
      activeTagGroup ?? null
    );
    const cHasChildren = (chc != null && chc > 0) || undefined;
    containers.push({
      nodeId: d.data.orgNode.id,
      label: d.data.orgNode.label,
      lineNumber: d.data.orgNode.lineNumber,
      ...(cColor !== undefined && { color: cColor }),
      metadata: cMeta,
      tagMetadata: { ...d.data.orgNode.metadata },
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      labelHeight,
      ...(chc !== undefined && { hiddenCount: chc }),
      ...(cHasChildren !== undefined && { hasChildren: cHasChildren }),
    });
  }

  // Second pass: containers with children, deepest first
  const containerCandidates = allContainerNodes.filter(
    (d) => d.children && d.children.length > 0
  );
  containerCandidates.sort((a, b) => b.depth - a.depth);

  for (const d of containerCandidates) {
    // Collect all descendants (not just direct children)
    const allDesc: (typeof d)[] = [];
    const collectDesc = (node: typeof d) => {
      if (node.children) {
        for (const child of node.children) {
          allDesc.push(child);
          collectDesc(child);
        }
      }
    };
    collectDesc(d);

    if (allDesc.length === 0) continue;

    // Compute bounding box from all descendants, using inner container
    // bounds when available (so nested boxes don't overlap)
    let descMinX = Infinity;
    let descMaxX = -Infinity;
    let descMinY = Infinity;
    let descMaxY = -Infinity;

    /** Fold a screen-space, offset rect into the descendant bounds. */
    const growDesc = (
      left: number,
      top: number,
      right: number,
      bottom: number
    ): void => {
      if (left < descMinX) descMinX = left;
      if (right > descMaxX) descMaxX = right;
      if (top < descMinY) descMinY = top;
      if (bottom > descMaxY) descMaxY = bottom;
    };

    for (const desc of allDesc) {
      const innerBounds = containerBoundsMap.get(desc.data.orgNode.id);
      if (innerBounds) {
        // Use the inner container's expanded box
        growDesc(
          innerBounds.minX,
          innerBounds.minY,
          innerBounds.maxX,
          innerBounds.maxY
        );
      } else if (desc.data.orgNode.id.startsWith('__stack_')) {
        // Use expanded children positions for stack placeholders
        const cid = desc.data.orgNode.id.replace('__stack_', '');
        const stack = leafStacks.get(cid);
        if (stack) {
          for (const ec of expandedChildren) {
            if (ec.orgNode.parentId !== cid) continue;
            const r = screenRect(ec.cx, ec.cy, ec.width, ec.height);
            growDesc(
              r.left + offsetX,
              r.top + offsetY,
              r.right + offsetX,
              r.bottom + offsetY
            );
          }
        }
      } else {
        // Use card dimensions
        const r = screenRect(
          desc.x!,
          desc.y!,
          desc.data.width,
          desc.data.height
        );
        growDesc(
          r.left + offsetX,
          r.top + offsetY,
          r.right + offsetX,
          r.bottom + offsetY
        );
      }
    }

    const ownTL = screenTopLeft(d.x!, d.y!, d.data.width, d.data.height);
    // TB centres the box on the container's own x; LR anchors it to the
    // container's left edge, so keep both readings available.
    const containerCenterX = ownTL.left + d.data.width / 2 + offsetX;
    const containerLeftX = ownTL.left + offsetX;
    const containerY = ownTL.top + offsetY;
    const metaCount = Object.keys(d.data.orgNode.metadata).length;
    const labelHeight =
      CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;

    let boxY: number;
    let boxHeight: number;
    let centeredBoxX: number;
    let finalBoxWidth: number;

    if (isLR) {
      // Depth runs left→right, so the box starts at the container's own left
      // edge and stretches right to cover its reports. The label strip is
      // always drawn across the top, so it is reserved on the vertical axis
      // here rather than on the depth axis.
      centeredBoxX = containerLeftX;
      finalBoxWidth = Math.max(
        descMaxX - containerLeftX + CONTAINER_PAD_X,
        d.data.width
      );
      boxY = descMinY - labelHeight - CONTAINER_PAD_X;
      boxHeight = descMaxY - boxY + CONTAINER_PAD_BOTTOM;
    } else {
      // Box top = container's own y, extends to cover all children
      boxY = containerY;
      boxHeight = descMaxY - containerY + CONTAINER_PAD_BOTTOM;

      // Tight-fit box around content with padding
      const boxX = descMinX - CONTAINER_PAD_X;
      const contentWidth = descMaxX - descMinX + CONTAINER_PAD_X * 2;
      finalBoxWidth = Math.max(contentWidth, d.data.width);
      // Center the box if the label is wider than the content
      centeredBoxX =
        finalBoxWidth > contentWidth
          ? containerCenterX - finalBoxWidth / 2
          : boxX;
    }

    // Store bounds for parent containers to reference
    containerBoundsMap.set(d.data.orgNode.id, {
      minX: centeredBoxX,
      maxX: centeredBoxX + finalBoxWidth,
      minY: boxY,
      maxY: boxY + boxHeight,
    });

    const chc2 = hiddenCounts?.get(d.data.orgNode.id);
    const cMeta2 = filterMetadata(d.data.orgNode.metadata, hiddenAttributes);
    const c2Color = resolveNodeColor(
      d.data.orgNode,
      parsed.tagGroups,
      activeTagGroup ?? null
    );
    containers.push({
      nodeId: d.data.orgNode.id,
      label: d.data.orgNode.label,
      lineNumber: d.data.orgNode.lineNumber,
      ...(c2Color !== undefined && { color: c2Color }),
      metadata: cMeta2,
      tagMetadata: { ...d.data.orgNode.metadata },
      x: centeredBoxX,
      y: boxY,
      width: finalBoxWidth,
      height: boxHeight,
      labelHeight,
      ...(chc2 !== undefined && { hiddenCount: chc2 }),
      hasChildren: true,
    });
  }

  // Reverse so outer containers render first (behind inner containers)
  containers.reverse();

  // Bounding box — expand for container backgrounds that may extend beyond nodes
  // Convert container coords (offset space) back to pre-offset space for comparison
  let finalMinX = minX;
  let finalMaxX = maxX;
  let finalMinY = minY;
  let finalMaxY = maxY;
  for (const c of containers) {
    const cLeft = c.x - offsetX;
    const cRight = cLeft + c.width;
    const cTop = c.y - offsetY;
    const cBottom = cTop + c.height;
    if (cLeft < finalMinX) finalMinX = cLeft;
    if (cRight > finalMaxX) finalMaxX = cRight;
    if (cTop < finalMinY) finalMinY = cTop;
    if (cBottom > finalMaxY) finalMaxY = cBottom;
  }

  // Under LR a container reserves its label strip *above* its content, so its
  // box can reach past the topmost card. Push everything down by the overshoot
  // so the diagram still starts at MARGIN. (In TB a box top is always a card
  // top, so this is a no-op and the top-down output is untouched.)
  const topOvershoot = minY - finalMinY;
  if (topOvershoot > 0) {
    for (const n of layoutNodes) n.y += topOvershoot;
    for (const c of containers) c.y += topOvershoot;
    for (const e of layoutEdges) {
      for (const p of e.points as { x: number; y: number }[]) {
        p.y += topOvershoot;
      }
    }
  }

  const totalWidth = finalMaxX - finalMinX + MARGIN * 2;
  const totalHeight = finalMaxY - finalMinY + MARGIN * 2;

  // Collect which tag group values are actually used by nodes
  const usedValuesByGroup = new Map<string, Set<string>>();
  for (const group of parsed.tagGroups) {
    const key = tagAttrKey(group.name);
    const used = new Set<string>();
    const walk = (node: OrgNode) => {
      if (!node.isContainer && node.metadata[key]) {
        used.add(node.metadata[key].toLowerCase());
      }
      for (const child of node.children) walk(child);
    };
    for (const root of parsed.roots) walk(root);
    usedValuesByGroup.set(key, used);
  }

  // Compute legend for tag groups
  const showEyeIcons = hiddenAttributes !== undefined;
  const legendGroups = computeLegendGroups(
    legendSuppressed(parsed.options) ? [] : parsed.tagGroups,
    showEyeIcons,
    usedValuesByGroup
  );
  let finalWidth = totalWidth;
  let finalHeight = totalHeight;

  // When a tag group is active, only that group is laid out (full size).
  // When none is active, all groups are laid out minified — unless
  // expandAllLegend is set (export mode), which shows all groups expanded.
  const visibleGroups =
    activeTagGroup != null
      ? legendGroups.filter(
          (g) => g.name.toLowerCase() === activeTagGroup.toLowerCase()
        )
      : legendGroups;
  const allExpanded = expandAllLegend && activeTagGroup == null;
  const effectiveW = (g: OrgLegendGroup) =>
    activeTagGroup != null || allExpanded ? g.width : g.minifiedWidth;

  let appliedLegendShift = 0;
  if (visibleGroups.length > 0) {
    // Top: horizontal row above chart content, left-aligned
    const legendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP;
    appliedLegendShift = legendShift;

    // Push all chart content down
    for (const n of layoutNodes) n.y += legendShift;
    for (const c of containers) c.y += legendShift;
    for (const e of layoutEdges) {
      for (const p of e.points as Writable<(typeof e.points)[number]>[])
        p.y += legendShift;
    }

    const totalGroupsWidth =
      visibleGroups.reduce((s, g) => s + effectiveW(g), 0) +
      (visibleGroups.length - 1) * LEGEND_GROUP_GAP;

    let cx = MARGIN;
    for (const g of visibleGroups) {
      g.x = cx;
      g.y = MARGIN;
      cx += effectiveW(g) + LEGEND_GROUP_GAP;
    }

    finalHeight += legendShift;
    const neededWidth = totalGroupsWidth + MARGIN * 2;
    if (neededWidth > finalWidth) {
      // The legend row is wider than the tree, so the box grows to fit it.
      // Re-centre the tree inside the wider box: renderers centre the BOX in
      // the canvas, so leaving the tree at its old left-aligned x pushes it
      // off-centre by half the surplus. Invisible on most charts (the tree is
      // wider than the legend) — a `focus <name>` chart shrinks the tree to a
      // single card and makes it obvious.
      const shift = (neededWidth - finalWidth) / 2;
      finalWidth = neededWidth;
      for (const n of layoutNodes) n.x += shift;
      for (const c of containers) c.x += shift;
      for (const e of layoutEdges) {
        for (const p of e.points as Writable<(typeof e.points)[number]>[])
          p.x += shift;
      }
    }
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    containers,
    legend: legendGroups,
    width: finalWidth,
    height: finalHeight,
    legendShift: appliedLegendShift,
  };
}
