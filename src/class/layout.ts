import dagre from '@dagrejs/dagre';
import { measureText } from '../utils/text-measure';
import {
  resolveNotes,
  buildPlacedNotes,
  noteCanvasShift,
  type PlacedNote,
} from '../utils/notes';
import type { ParsedClassDiagram, ClassNode, RelationshipType } from './types';

// ============================================================
// Layout types
// ============================================================

export interface ClassLayoutNode extends ClassNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly headerHeight: number;
  readonly fieldsHeight: number;
  readonly methodsHeight: number;
  /** A note floated beside this class (never moves the box). */
  readonly note?: PlacedNote;
}

export interface ClassLayoutOptions {
  /**
   * 1-based source line numbers of notes the user has collapsed. A
   * collapsed note renders as a corner badge and reserves no space.
   */
  collapsedNotes?: ReadonlySet<number>;
}

export interface ClassLayoutEdge {
  readonly source: string;
  readonly target: string;
  readonly type: RelationshipType;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly label?: string;
  readonly lineNumber: number;
}

export interface ClassLayoutResult {
  readonly nodes: readonly ClassLayoutNode[];
  readonly edges: readonly ClassLayoutEdge[];
  readonly width: number;
  readonly height: number;
}

// ============================================================
// Sizing constants
// ============================================================

const MIN_WIDTH = 140;
const PADDING_X = 24;
const HEADER_BASE = 36;
// Font sizes mirror the renderer: class name at CLASS_FONT_SIZE, members and
// the modifier badge at MEMBER_FONT_SIZE. Keep these in sync with renderer.ts.
const CLASS_FONT_SIZE = 13;
const MEMBER_FONT_SIZE = 11;
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

  // Width: max rendered pixel width of class name, modifier badge, and members.
  // Measure each at the font size the renderer draws it with.
  let maxTextWidth = measureText(node.name, CLASS_FONT_SIZE);
  if (node.modifier) {
    // Renderer draws the badge as «modifier» at MEMBER_FONT_SIZE.
    maxTextWidth = Math.max(
      maxTextWidth,
      measureText(`«${node.modifier}»`, MEMBER_FONT_SIZE)
    );
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
    maxTextWidth = Math.max(
      maxTextWidth,
      measureText(memberText, MEMBER_FONT_SIZE)
    );
  }
  const width = Math.max(MIN_WIDTH, maxTextWidth + PADDING_X);

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
  parsed: ParsedClassDiagram,
  options?: ClassLayoutOptions
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

  // ── Notes ──────────────────────────────────────────────────
  // Resolve note anchors (no diagnostics here — the parser already emitted
  // them). `no-notes` drops the reserved footprint so layout matches an
  // un-annotated diagram. The note floats beside its class WITHOUT moving
  // it (class TB layout → default side right).
  const notesSuppressed = parsed.options?.['no-notes'] === 'on';
  const noteByNode =
    notesSuppressed || !parsed.notes
      ? new Map()
      : resolveNotes(
          parsed.notes,
          parsed.classes.map((c) => ({ id: c.id, label: c.name }))
        );
  const placedNotes = buildPlacedNotes(
    parsed.classes.map((node) => {
      const pos = g.node(node.id);
      return {
        id: node.id,
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
      };
    }),
    noteByNode,
    'TB',
    options?.collapsedNotes
  );

  // Extract positioned nodes
  const layoutNodes: ClassLayoutNode[] = parsed.classes.map((node) => {
    const pos = g.node(node.id);
    const dims = dimMap.get(node.id)!;
    const note = placedNotes.get(node.id);
    return {
      ...node,
      x: pos.x,
      y: pos.y,
      width: dims.width,
      height: dims.height,
      headerHeight: dims.headerHeight,
      fieldsHeight: dims.fieldsHeight,
      methodsHeight: dims.methodsHeight,
      ...(note && { note }),
    };
  });

  // Extract edge waypoints
  const layoutEdges: ClassLayoutEdge[] = parsed.relationships.map((rel) => {
    const edgeData = g.edge(rel.source, rel.target);
    const layoutEdge: ClassLayoutEdge = {
      source: rel.source,
      target: rel.target,
      type: rel.type,
      points: edgeData?.points ?? [],
      ...(rel.label !== undefined && { label: rel.label }),
      lineNumber: rel.lineNumber,
    };
    return layoutEdge;
  });

  // Content bbox over nodes and their (floated) notes. A note placed
  // above/left can land at negative coords; when it does, shift everything
  // so nothing clips. Un-annotated diagrams keep min ≥ 0 → no shift.
  let bbMinX = Infinity;
  let bbMinY = Infinity;
  let bbMaxX = -Infinity;
  let bbMaxY = -Infinity;
  const extend = (l: number, t: number, r: number, b: number): void => {
    if (l < bbMinX) bbMinX = l;
    if (t < bbMinY) bbMinY = t;
    if (r > bbMaxX) bbMaxX = r;
    if (b > bbMaxY) bbMaxY = b;
  };
  for (const node of layoutNodes) {
    extend(
      node.x - node.width / 2,
      node.y - node.height / 2,
      node.x + node.width / 2,
      node.y + node.height / 2
    );
    if (node.note && !node.note.collapsed) {
      extend(
        node.x + node.note.x,
        node.y + node.note.y,
        node.x + node.note.x + node.note.width,
        node.y + node.note.y + node.note.height
      );
    }
  }
  if (!Number.isFinite(bbMinX)) {
    bbMinX = 0;
    bbMinY = 0;
    bbMaxX = 0;
    bbMaxY = 0;
  }

  const { shiftX, shiftY } = noteCanvasShift(bbMinX, bbMinY);
  const shifted = shiftX !== 0 || shiftY !== 0;
  const finalNodes = shifted
    ? layoutNodes.map((n) => ({ ...n, x: n.x + shiftX, y: n.y + shiftY }))
    : layoutNodes;
  const finalEdges = shifted
    ? layoutEdges.map((e) => ({
        ...e,
        points: e.points.map((pt) => ({ x: pt.x + shiftX, y: pt.y + shiftY })),
      }))
    : layoutEdges;

  // Totals: max extent (incl. notes) + the prior 40 px margin.
  const totalWidth = bbMaxX + shiftX + 40;
  const totalHeight = bbMaxY + shiftY + 40;

  return {
    nodes: finalNodes,
    edges: finalEdges,
    width: totalWidth,
    height: totalHeight,
  };
}
