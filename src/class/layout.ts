import dagre from '@dagrejs/dagre';
import type {
  ParsedClassDiagram,
  ClassNode,
  RelationshipType,
} from './types';

// ============================================================
// Layout types
// ============================================================

export interface ClassLayoutNode extends ClassNode {
  x: number;
  y: number;
  width: number;
  height: number;
  headerHeight: number;
  fieldsHeight: number;
  methodsHeight: number;
}

export interface ClassLayoutEdge {
  source: string;
  target: string;
  type: RelationshipType;
  points: { x: number; y: number }[];
  label?: string;
  lineNumber: number;
}

export interface ClassLayoutResult {
  nodes: ClassLayoutNode[];
  edges: ClassLayoutEdge[];
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
const MODIFIER_BADGE = 16; // extra height for <<interface>> etc.
const MEMBER_LINE_HEIGHT = 18;
const COMPARTMENT_PADDING_Y = 8;
const SEPARATOR_HEIGHT = 1;

// ============================================================
// Node sizing
// ============================================================

function computeNodeDimensions(node: ClassNode): {
  width: number;
  height: number;
  headerHeight: number;
  fieldsHeight: number;
  methodsHeight: number;
} {
  const fields = node.members.filter((m) => !m.isMethod);
  const methods = node.members.filter((m) => m.isMethod);
  const isEnum = node.modifier === 'enum';

  // Width: max of class name, member text lengths
  let maxTextLen = node.name.length;
  if (node.modifier) {
    maxTextLen = Math.max(maxTextLen, `<<${node.modifier}>>`.length);
  }
  for (const m of node.members) {
    let memberText = m.name;
    if (m.isMethod) {
      memberText += `(${m.params ?? ''})`;
      if (m.type) memberText += `: ${m.type}`;
    } else if (m.type) {
      memberText += `: ${m.type}`;
    }
    // Add visibility prefix width
    memberText = `+ ${memberText}`;
    maxTextLen = Math.max(maxTextLen, memberText.length);
  }
  const width = Math.max(MIN_WIDTH, maxTextLen * CHAR_WIDTH + PADDING_X);

  // Header height
  const headerHeight = HEADER_BASE + (node.modifier ? MODIFIER_BADGE : 0);

  // Fields compartment
  let fieldsHeight: number;
  if (isEnum) {
    // Enum values go in fields compartment
    const enumValues = node.members; // all members are enum values
    if (enumValues.length > 0) {
      fieldsHeight =
        COMPARTMENT_PADDING_Y * 2 +
        enumValues.length * MEMBER_LINE_HEIGHT +
        SEPARATOR_HEIGHT;
    } else {
      fieldsHeight = SEPARATOR_HEIGHT + COMPARTMENT_PADDING_Y;
    }
  } else {
    if (fields.length > 0) {
      fieldsHeight =
        COMPARTMENT_PADDING_Y * 2 +
        fields.length * MEMBER_LINE_HEIGHT +
        SEPARATOR_HEIGHT;
    } else {
      // UML: always show attributes compartment
      fieldsHeight = SEPARATOR_HEIGHT + COMPARTMENT_PADDING_Y;
    }
  }

  // Methods compartment (not for enums)
  let methodsHeight = 0;
  if (!isEnum) {
    if (methods.length > 0) {
      methodsHeight =
        COMPARTMENT_PADDING_Y * 2 +
        methods.length * MEMBER_LINE_HEIGHT +
        SEPARATOR_HEIGHT;
    } else {
      // UML: always show methods compartment
      methodsHeight = SEPARATOR_HEIGHT + COMPARTMENT_PADDING_Y;
    }
  }

  const height = headerHeight + fieldsHeight + methodsHeight;

  return { width, height, headerHeight, fieldsHeight, methodsHeight };
}

// ============================================================
// Layout engine
// ============================================================

export function layoutClassDiagram(
  parsed: ParsedClassDiagram
): ClassLayoutResult {
  if (parsed.classes.length === 0) {
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
      fieldsHeight: number;
      methodsHeight: number;
    }
  >();

  for (const node of parsed.classes) {
    const dims = computeNodeDimensions(node);
    dimMap.set(node.id, dims);
    g.setNode(node.id, {
      label: node.name,
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
  const layoutNodes: ClassLayoutNode[] = parsed.classes.map((node) => {
    const pos = g.node(node.id);
    const dims = dimMap.get(node.id)!;
    return {
      ...node,
      x: pos.x,
      y: pos.y,
      width: dims.width,
      height: dims.height,
      headerHeight: dims.headerHeight,
      fieldsHeight: dims.fieldsHeight,
      methodsHeight: dims.methodsHeight,
    };
  });

  // Extract edge waypoints
  const layoutEdges: ClassLayoutEdge[] = parsed.relationships.map((rel) => {
    const edgeData = g.edge(rel.source, rel.target);
    return {
      source: rel.source,
      target: rel.target,
      type: rel.type,
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
