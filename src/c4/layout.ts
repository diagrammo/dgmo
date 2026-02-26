// ============================================================
// C4 Context Diagram Layout Engine (dagre)
// ============================================================

import dagre from '@dagrejs/dagre';
import type { ParsedC4, C4Element, C4Relationship, C4ArrowType } from './types';
import type { OrgTagGroup } from '../org/parser';

// ============================================================
// Types
// ============================================================

export interface C4LayoutNode {
  id: string;
  name: string;
  type: 'person' | 'system';
  description?: string;
  metadata: Record<string, string>;
  lineNumber: number;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface C4LayoutEdge {
  source: string;
  target: string;
  arrowType: C4ArrowType;
  label?: string;
  technology?: string;
  lineNumber: number;
  points: { x: number; y: number }[];
}

export interface C4LegendEntry {
  value: string;
  color: string;
}

export interface C4LegendGroup {
  name: string;
  entries: C4LegendEntry[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface C4LayoutResult {
  nodes: C4LayoutNode[];
  edges: C4LayoutEdge[];
  legend: C4LegendGroup[];
  width: number;
  height: number;
}

// ============================================================
// Constants
// ============================================================

const CHAR_WIDTH = 8;
const MIN_NODE_WIDTH = 160;
const MAX_NODE_WIDTH = 260;
const TYPE_LABEL_HEIGHT = 18;
const DIVIDER_GAP = 6;
const NAME_HEIGHT = 20;
const DESC_LINE_HEIGHT = 16;
const DESC_CHAR_WIDTH = 6.5;
const CARD_V_PAD = 14;
const CARD_H_PAD = 20;
const MARGIN = 40;

// Legend constants (match org)
const LEGEND_HEIGHT = 28;
const LEGEND_PILL_FONT_SIZE = 11;
const LEGEND_PILL_FONT_W = LEGEND_PILL_FONT_SIZE * 0.6;
const LEGEND_PILL_PAD = 16;
const LEGEND_DOT_R = 4;
const LEGEND_ENTRY_FONT_SIZE = 10;
const LEGEND_ENTRY_FONT_W = LEGEND_ENTRY_FONT_SIZE * 0.6;
const LEGEND_ENTRY_DOT_GAP = 4;
const LEGEND_ENTRY_TRAIL = 8;
const LEGEND_CAPSULE_PAD = 4;

// ============================================================
// Roll-Up Logic
// ============================================================

export interface ContextRelationship {
  sourceName: string;
  targetName: string;
  label?: string;
  technology?: string;
  arrowType: C4ArrowType;
  lineNumber: number;
}

/**
 * Build a map from element name → top-level ancestor name.
 * Top-level elements map to themselves.
 */
function buildOwnershipMap(elements: C4Element[]): Map<string, string> {
  const map = new Map<string, string>();

  function walk(el: C4Element, ancestor: string): void {
    map.set(el.name, ancestor);
    for (const child of el.children) {
      walk(child, ancestor);
    }
    for (const group of el.groups) {
      for (const child of group.children) {
        walk(child, ancestor);
      }
    }
  }

  for (const el of elements) {
    walk(el, el.name);
  }

  return map;
}

/**
 * Collect all relationships from the entire element tree.
 */
function collectAllRelationships(
  elements: C4Element[],
  ownerMap: Map<string, string>
): { sourceName: string; rel: C4Relationship }[] {
  const result: { sourceName: string; rel: C4Relationship }[] = [];

  function walk(el: C4Element): void {
    for (const rel of el.relationships) {
      result.push({ sourceName: el.name, rel });
    }
    for (const child of el.children) {
      walk(child);
    }
    for (const group of el.groups) {
      for (const child of group.children) {
        walk(child);
      }
    }
  }

  for (const el of elements) {
    walk(el);
  }

  return result;
}

/**
 * Roll up container/component-level relationships to system-to-system edges.
 * - Skips internal relationships (same top-level ancestor).
 * - Deduplicates: same source→target pair keeps only one (first seen).
 * - Explicit system-level relationships override rolled-up ones.
 */
export function rollUpContextRelationships(parsed: ParsedC4): ContextRelationship[] {
  const ownerMap = buildOwnershipMap(parsed.elements);
  const allRels = collectAllRelationships(parsed.elements, ownerMap);

  // Also include orphan relationships
  for (const rel of parsed.relationships) {
    // Orphan rels have no source element name — skip them for context roll-up
  }

  // Separate system-level (explicit) from nested (rolled-up)
  const topLevelNames = new Set(parsed.elements.map((e) => e.name));
  const explicitKeys = new Set<string>();
  const explicit: ContextRelationship[] = [];
  const nested: ContextRelationship[] = [];

  for (const { sourceName, rel } of allRels) {
    const sourceAncestor = ownerMap.get(sourceName) ?? sourceName;
    const targetAncestor = ownerMap.get(rel.target) ?? rel.target;

    // Skip internal relationships (both in same system)
    if (sourceAncestor === targetAncestor) continue;

    const entry: ContextRelationship = {
      sourceName: sourceAncestor,
      targetName: targetAncestor,
      label: rel.label,
      technology: rel.technology,
      arrowType: rel.arrowType,
      lineNumber: rel.lineNumber,
    };

    // Check if source is a top-level element (explicit system-level rel)
    if (topLevelNames.has(sourceName) && sourceName === sourceAncestor) {
      const key = `${sourceAncestor}→${targetAncestor}`;
      explicitKeys.add(key);
      explicit.push(entry);
    } else {
      nested.push(entry);
    }
  }

  // Deduplicate: explicit overrides rolled-up
  const result = [...explicit];
  const seenKeys = new Set(explicitKeys);

  for (const rel of nested) {
    const key = `${rel.sourceName}→${rel.targetName}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(rel);
    }
  }

  return result;
}

// ============================================================
// Tag Group Color Resolution
// ============================================================

function resolveNodeColor(
  el: C4Element,
  tagGroups: OrgTagGroup[],
  activeGroupName: string | null
): string | undefined {
  // Check metadata for explicit color
  const colorMeta = el.metadata['color'];
  if (colorMeta) return colorMeta;
  if (!activeGroupName) return undefined;

  const group = tagGroups.find(
    (g) => g.name.toLowerCase() === activeGroupName.toLowerCase()
  );
  if (!group) return undefined;
  const metaValue =
    el.metadata[group.name.toLowerCase()] ?? group.defaultValue;
  if (!metaValue) return '#999999';
  return (
    group.entries.find(
      (e) => e.value.toLowerCase() === metaValue.toLowerCase()
    )?.color ?? '#999999'
  );
}

// ============================================================
// Node Sizing
// ============================================================

function wrapText(text: string, maxWidth: number, charWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length * charWidth > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function computeC4NodeDimensions(el: C4Element): { width: number; height: number } {
  // Width: based on name length, clamped
  const nameWidth = el.name.length * CHAR_WIDTH + CARD_H_PAD * 2;
  const width = Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, nameWidth));

  // Height: type label + divider + name + optional description
  let height = CARD_V_PAD + TYPE_LABEL_HEIGHT + DIVIDER_GAP + NAME_HEIGHT;

  const desc = el.metadata['description'];
  if (desc) {
    const contentWidth = width - CARD_H_PAD * 2;
    const lines = wrapText(desc, contentWidth, DESC_CHAR_WIDTH);
    height += lines.length * DESC_LINE_HEIGHT;
  }

  height += CARD_V_PAD;

  return { width, height };
}

// ============================================================
// Legend Helpers
// ============================================================

function computeLegendGroups(
  tagGroups: OrgTagGroup[],
  usedValuesByGroup?: Map<string, Set<string>>
): C4LegendGroup[] {
  const result: C4LegendGroup[] = [];

  for (const group of tagGroups) {
    const entries: C4LegendEntry[] = [];
    for (const entry of group.entries) {
      if (usedValuesByGroup) {
        const used = usedValuesByGroup.get(group.name.toLowerCase());
        if (!used?.has(entry.value.toLowerCase())) continue;
      }
      entries.push({ value: entry.value, color: entry.color });
    }
    if (entries.length === 0) continue;

    // Compute pill width: group name + entries
    const nameW = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD * 2;
    let capsuleW = LEGEND_CAPSULE_PAD;
    for (const e of entries) {
      capsuleW +=
        LEGEND_DOT_R * 2 +
        LEGEND_ENTRY_DOT_GAP +
        e.value.length * LEGEND_ENTRY_FONT_W +
        LEGEND_ENTRY_TRAIL;
    }
    capsuleW += LEGEND_CAPSULE_PAD;

    result.push({
      name: group.name,
      entries,
      x: 0,
      y: 0,
      width: nameW + capsuleW,
      height: LEGEND_HEIGHT,
    });
  }

  return result;
}

// ============================================================
// Main Layout
// ============================================================

export function layoutC4Context(
  parsed: ParsedC4,
  activeTagGroup?: string | null
): C4LayoutResult {
  // Filter to person + system elements only
  const contextElements = parsed.elements.filter(
    (el) => el.type === 'person' || el.type === 'system'
  );

  if (contextElements.length === 0) {
    return { nodes: [], edges: [], legend: [], width: 0, height: 0 };
  }

  // Roll up relationships
  const contextRels = rollUpContextRelationships(parsed);

  // Create dagre graph
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    nodesep: 80,
    ranksep: 100,
    edgesep: 30,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  const nameToElement = new Map<string, C4Element>();
  for (const el of contextElements) {
    nameToElement.set(el.name, el);
    const dims = computeC4NodeDimensions(el);
    g.setNode(el.name, { width: dims.width, height: dims.height });
  }

  // Add edges — only between known nodes
  const validRels: ContextRelationship[] = [];
  for (const rel of contextRels) {
    if (nameToElement.has(rel.sourceName) && nameToElement.has(rel.targetName)) {
      validRels.push(rel);
      g.setEdge(rel.sourceName, rel.targetName, { label: rel.label ?? '' });
    }
  }

  // Run layout
  dagre.layout(g);

  // Extract positioned nodes
  const nodes: C4LayoutNode[] = contextElements.map((el) => {
    const pos = g.node(el.name);
    const color = resolveNodeColor(el, parsed.tagGroups, activeTagGroup ?? null);
    return {
      id: el.name,
      name: el.name,
      type: el.type as 'person' | 'system',
      description: el.metadata['description'],
      metadata: el.metadata,
      lineNumber: el.lineNumber,
      color,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    };
  });

  // Extract edges with waypoints
  const edges: C4LayoutEdge[] = validRels.map((rel) => {
    const edgeData = g.edge(rel.sourceName, rel.targetName);
    return {
      source: rel.sourceName,
      target: rel.targetName,
      arrowType: rel.arrowType,
      label: rel.label,
      technology: rel.technology,
      lineNumber: rel.lineNumber,
      points: edgeData?.points ?? [],
    };
  });

  // Compute diagram dimensions
  let totalWidth = 0;
  let totalHeight = 0;
  for (const node of nodes) {
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }

  // Legend
  const usedValuesByGroup = new Map<string, Set<string>>();
  for (const el of contextElements) {
    for (const group of parsed.tagGroups) {
      const key = group.name.toLowerCase();
      const val = el.metadata[key];
      if (val) {
        if (!usedValuesByGroup.has(key)) usedValuesByGroup.set(key, new Set());
        usedValuesByGroup.get(key)!.add(val.toLowerCase());
      }
    }
  }

  const legendGroups = computeLegendGroups(parsed.tagGroups, usedValuesByGroup);

  // Position legend below diagram
  if (legendGroups.length > 0) {
    const legendY = totalHeight + MARGIN;
    let legendX = MARGIN;
    for (const lg of legendGroups) {
      lg.x = legendX;
      lg.y = legendY;
      legendX += lg.width + 12;
    }
    const legendRight = legendX;
    const legendBottom = legendY + LEGEND_HEIGHT;
    if (legendRight > totalWidth) totalWidth = legendRight;
    if (legendBottom > totalHeight) totalHeight = legendBottom;
  }

  totalWidth += MARGIN;
  totalHeight += MARGIN;

  return { nodes, edges, legend: legendGroups, width: totalWidth, height: totalHeight };
}
