import dagre from '@dagrejs/dagre';
import type { ParsedERDiagram, ERTable } from './types';

// ============================================================
// Layout types
// ============================================================

export interface ERLayoutNode extends ERTable {
  x: number;
  y: number;
  width: number;
  height: number;
  headerHeight: number;
  columnsHeight: number;
}

export interface ERLayoutEdge {
  source: string;
  target: string;
  cardinality: { from: string; to: string };
  points: { x: number; y: number }[];
  label?: string;
  lineNumber: number;
}

export interface ERLayoutResult {
  nodes: ERLayoutNode[];
  edges: ERLayoutEdge[];
  width: number;
  height: number;
}

// ============================================================
// Sizing constants
// ============================================================

const MIN_WIDTH = 140;
const CHAR_WIDTH = 7.5;
const PADDING_X = 24;
const HEADER_BASE = 36;
const MEMBER_LINE_HEIGHT = 18;
const COMPARTMENT_PADDING_Y = 8;
const SEPARATOR_HEIGHT = 1;

// ============================================================
// Node sizing
// ============================================================

function computeNodeDimensions(table: ERTable): {
  width: number;
  height: number;
  headerHeight: number;
  columnsHeight: number;
} {
  // Width: max of table name, column text lengths
  let maxTextLen = table.name.length;
  for (const col of table.columns) {
    let colText = col.name;
    if (col.type) colText += `  ${col.type}`;
    if (col.constraints.length > 0) colText += `  XX`; // icon space
    maxTextLen = Math.max(maxTextLen, colText.length);
  }
  const width = Math.max(MIN_WIDTH, maxTextLen * CHAR_WIDTH + PADDING_X);

  const headerHeight = HEADER_BASE;

  let columnsHeight = 0;
  if (table.columns.length > 0) {
    columnsHeight =
      COMPARTMENT_PADDING_Y * 2 +
      table.columns.length * MEMBER_LINE_HEIGHT +
      SEPARATOR_HEIGHT;
  }

  const height =
    headerHeight + columnsHeight + (columnsHeight === 0 ? 4 : 0);

  return { width, height, headerHeight, columnsHeight };
}

// ============================================================
// Layout engine
// ============================================================

export function layoutERDiagram(parsed: ParsedERDiagram): ERLayoutResult {
  if (parsed.tables.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    nodesep: 60,
    ranksep: 80,
    edgesep: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Compute dimensions and add nodes
  const dimMap = new Map<
    string,
    {
      width: number;
      height: number;
      headerHeight: number;
      columnsHeight: number;
    }
  >();

  for (const table of parsed.tables) {
    const dims = computeNodeDimensions(table);
    dimMap.set(table.id, dims);
    g.setNode(table.id, {
      label: table.name,
      width: dims.width,
      height: dims.height,
    });
  }

  // Add edges
  for (const rel of parsed.relationships) {
    g.setEdge(rel.source, rel.target, { label: rel.label ?? '' });
  }

  // Run layout
  dagre.layout(g);

  // Extract positioned nodes
  const layoutNodes: ERLayoutNode[] = parsed.tables.map((table) => {
    const pos = g.node(table.id);
    const dims = dimMap.get(table.id)!;
    return {
      ...table,
      x: pos.x,
      y: pos.y,
      width: dims.width,
      height: dims.height,
      headerHeight: dims.headerHeight,
      columnsHeight: dims.columnsHeight,
    };
  });

  // Extract edge waypoints
  const layoutEdges: ERLayoutEdge[] = parsed.relationships.map((rel) => {
    const edgeData = g.edge(rel.source, rel.target);
    return {
      source: rel.source,
      target: rel.target,
      cardinality: rel.cardinality,
      points: edgeData?.points ?? [],
      label: rel.label,
      lineNumber: rel.lineNumber,
    };
  });

  // Compute total dimensions
  let totalWidth = 0;
  let totalHeight = 0;
  for (const node of layoutNodes) {
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  totalWidth += 40;
  totalHeight += 40;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: totalWidth,
    height: totalHeight,
  };
}
