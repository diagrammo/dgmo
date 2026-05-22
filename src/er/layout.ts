import dagre from '@dagrejs/dagre';
import type { ParsedERDiagram, ERTable, ERRelationship } from './types';

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

const HALF_MARGIN = 30;
const COMP_GAP = 60; // gap between packed components

// ============================================================
// Node sizing
// ============================================================

function computeNodeDimensions(table: ERTable): {
  width: number;
  height: number;
  headerHeight: number;
  columnsHeight: number;
} {
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

  const height = headerHeight + columnsHeight + (columnsHeight === 0 ? 4 : 0);
  return { width, height, headerHeight, columnsHeight };
}

// ============================================================
// Connected component detection (undirected BFS)
// ============================================================

function findConnectedComponents(
  tableIds: string[],
  relationships: ERRelationship[]
): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const id of tableIds) adj.set(id, new Set());
  for (const rel of relationships) {
    adj.get(rel.source)?.add(rel.target);
    adj.get(rel.target)?.add(rel.source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of tableIds) {
    if (visited.has(id)) continue;
    const comp: string[] = [];
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      comp.push(cur);
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) queue.push(nb);
      }
    }
    components.push(comp);
  }
  return components;
}

// ============================================================
// Per-component layout (independent dagre run)
// ============================================================

interface ComponentLayout {
  /** Node center positions relative to this component's top-left origin */
  nodePositions: Map<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
      headerHeight: number;
      columnsHeight: number;
    }
  >;
  /** Edge waypoints keyed by relationship lineNumber, relative to origin */
  edgePoints: Map<number, { x: number; y: number }[]>;
  width: number;
  height: number;
}

function layoutComponent(
  tables: ERTable[],
  rels: ERRelationship[],
  dimMap: Map<
    string,
    {
      width: number;
      height: number;
      headerHeight: number;
      columnsHeight: number;
    }
  >
): ComponentLayout {
  const nodePositions = new Map<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
      headerHeight: number;
      columnsHeight: number;
    }
  >();
  const edgePoints = new Map<number, { x: number; y: number }[]>();

  if (tables.length === 1) {
    // Single node — skip dagre
    // In-bounds by length-1 guard above.
    const onlyTable = tables[0]!;
    const dims = dimMap.get(onlyTable.id)!;
    nodePositions.set(onlyTable.id, {
      x: dims.width / 2,
      y: dims.height / 2,
      ...dims,
    });
    return {
      nodePositions,
      edgePoints,
      width: dims.width,
      height: dims.height,
    };
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, edgesep: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const table of tables) {
    const dims = dimMap.get(table.id)!;
    g.setNode(table.id, { width: dims.width, height: dims.height });
  }

  // Use lineNumber as edge name to support multigraph (multiple edges between same pair)
  for (const rel of rels) {
    g.setEdge(
      rel.source,
      rel.target,
      { label: rel.label ?? '' },
      String(rel.lineNumber)
    );
  }

  dagre.layout(g);

  // Compute bounding box (dagre coordinates)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const table of tables) {
    const pos = g.node(table.id);
    const dims = dimMap.get(table.id)!;
    minX = Math.min(minX, pos.x - dims.width / 2);
    minY = Math.min(minY, pos.y - dims.height / 2);
    maxX = Math.max(maxX, pos.x + dims.width / 2);
    maxY = Math.max(maxY, pos.y + dims.height / 2);
  }

  for (const rel of rels) {
    const ed = g.edge(rel.source, rel.target, String(rel.lineNumber));
    for (const pt of ed?.points ?? []) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
    if (rel.label && (ed?.points ?? []).length > 0) {
      const pts = ed!.points;
      const mid = pts[Math.floor(pts.length / 2)];
      const hw = (rel.label.length * 7 + 8) / 2;
      minX = Math.min(minX, mid.x - hw);
      maxX = Math.max(maxX, mid.x + hw);
    }
  }

  // Normalize positions to component origin (0, 0)
  for (const table of tables) {
    const pos = g.node(table.id);
    const dims = dimMap.get(table.id)!;
    nodePositions.set(table.id, {
      x: pos.x - minX,
      y: pos.y - minY,
      ...dims,
    });
  }
  for (const rel of rels) {
    const ed = g.edge(rel.source, rel.target, String(rel.lineNumber));
    edgePoints.set(
      rel.lineNumber,
      (ed?.points ?? []).map((pt: { x: number; y: number }) => ({
        x: pt.x - minX,
        y: pt.y - minY,
      }))
    );
  }

  return {
    nodePositions,
    edgePoints,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

// ============================================================
// Row packing (Next Fit Decreasing Height)
// ============================================================

interface PackedComponent {
  compIds: string[];
  compLayout: ComponentLayout;
  offsetX: number;
  offsetY: number;
}

function packComponents(
  items: Array<{ compIds: string[]; compLayout: ComponentLayout }>
): PackedComponent[] {
  if (items.length === 0) return [];

  // Sort: multi-node components (have relationships, more interesting) first,
  // then isolated single-node components. Within each group, sort by height descending.
  const sorted = [...items].sort((a, b) => {
    const aConnected = a.compIds.length > 1 ? 1 : 0;
    const bConnected = b.compIds.length > 1 ? 1 : 0;
    if (aConnected !== bConnected) return bConnected - aConnected;
    return b.compLayout.height - a.compLayout.height;
  });

  // Target width: sqrt of total content area × aspect factor (~1.5 = slightly landscape)
  const totalArea = items.reduce(
    (s, c) =>
      s +
      (c.compLayout.width || MIN_WIDTH) * (c.compLayout.height || HEADER_BASE),
    0
  );
  const targetW = Math.max(
    Math.sqrt(totalArea) * 1.5,
    // In-bounds: sorted.length === items.length and items.length === 0 returned above.
    sorted[0]!.compLayout.width // at least as wide as the widest component
  );

  const placements: PackedComponent[] = [];
  let curX = 0;
  let curY = 0;
  let rowH = 0;

  for (const item of sorted) {
    const w = item.compLayout.width || MIN_WIDTH;
    const h = item.compLayout.height || HEADER_BASE;

    // Wrap to next row if this item doesn't fit (but always place if row is empty)
    if (curX > 0 && curX + w > targetW) {
      curY += rowH + COMP_GAP;
      curX = 0;
      rowH = 0;
    }

    placements.push({
      compIds: item.compIds,
      compLayout: item.compLayout,
      offsetX: curX,
      offsetY: curY,
    });
    curX += w + COMP_GAP;
    rowH = Math.max(rowH, h);
  }

  return placements;
}

// ============================================================
// Layout engine
// ============================================================

export function layoutERDiagram(parsed: ParsedERDiagram): ERLayoutResult {
  if (parsed.tables.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  // ── 1. Node dimensions ──────────────────────────────────────────────────────
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
    dimMap.set(table.id, computeNodeDimensions(table));
  }

  // ── 2. Find connected components ────────────────────────────────────────────
  const compIdSets = findConnectedComponents(
    parsed.tables.map((t) => t.id),
    parsed.relationships
  );

  // ── 3. Layout each component independently ──────────────────────────────────
  const tableById = new Map(parsed.tables.map((t) => [t.id, t]));

  const componentItems = compIdSets.map((ids) => {
    const tables = ids.map((id) => tableById.get(id)!);
    const rels = parsed.relationships.filter((r) => ids.includes(r.source));
    return { compIds: ids, compLayout: layoutComponent(tables, rels, dimMap) };
  });

  // ── 4. Pack component bounding boxes into rows ───────────────────────────────
  const packed = packComponents(componentItems);

  // Build lookup: tableId → packed placement
  const placementByTableId = new Map<string, PackedComponent>();
  for (const p of packed) {
    for (const id of p.compIds) placementByTableId.set(id, p);
  }

  // Build lookup: lineNumber → packed placement (for edges)
  const placementByRelLine = new Map<number, PackedComponent>();
  for (const p of packed) {
    for (const lineNum of p.compLayout.edgePoints.keys()) {
      placementByRelLine.set(lineNum, p);
    }
  }

  // ── 5. Assemble final layout ─────────────────────────────────────────────────
  const layoutNodes: ERLayoutNode[] = parsed.tables.map((table) => {
    const p = placementByTableId.get(table.id)!;
    const pos = p.compLayout.nodePositions.get(table.id)!;
    return {
      ...table,
      x: pos.x + p.offsetX + HALF_MARGIN,
      y: pos.y + p.offsetY + HALF_MARGIN,
      width: pos.width,
      height: pos.height,
      headerHeight: pos.headerHeight,
      columnsHeight: pos.columnsHeight,
    };
  });

  const layoutEdges: ERLayoutEdge[] = parsed.relationships.map((rel) => {
    const p = placementByRelLine.get(rel.lineNumber);
    const pts = p?.compLayout.edgePoints.get(rel.lineNumber) ?? [];
    return {
      source: rel.source,
      target: rel.target,
      cardinality: rel.cardinality,
      points: pts.map((pt) => ({
        x: pt.x + (p?.offsetX ?? 0) + HALF_MARGIN,
        y: pt.y + (p?.offsetY ?? 0) + HALF_MARGIN,
      })),
      ...(rel.label !== undefined && { label: rel.label }),
      lineNumber: rel.lineNumber,
    };
  });

  // ── 6. Total canvas dimensions ───────────────────────────────────────────────
  let maxX = 0;
  let maxY = 0;
  for (const node of layoutNodes) {
    maxX = Math.max(maxX, node.x + node.width / 2);
    maxY = Math.max(maxY, node.y + node.height / 2);
  }
  for (const edge of layoutEdges) {
    for (const pt of edge.points) {
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: maxX + HALF_MARGIN,
    height: maxY + HALF_MARGIN,
  };
}
