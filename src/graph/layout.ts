import dagre from '@dagrejs/dagre';
import type {
  ParsedGraph,
  GraphNode,
  GraphEdge,
  GraphGroup,
  GraphShape,
} from './types';
import { resolveNotes } from './notes';
import { noteBoxSize } from '../utils/note-box';
import { placeNotes, noteCanvasShift } from '../utils/notes';
import type { WrappedDescLine } from '../utils/wrapped-desc';

export type NoteSide = 'above' | 'below' | 'left' | 'right';

/** A note box positioned relative to its anchor node's center. */
export interface NoteLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Which side of the node the box sits on (drives the connector). */
  readonly side: NoteSide;
  /** Resolved hex accent (border + faded fill); default yellow if absent. */
  readonly color?: string;
  readonly lines: readonly WrappedDescLine[];
  readonly lineNumber: number;
  readonly endLineNumber: number;
  /**
   * When true the note is collapsed: the renderer draws a small badge at
   * the node corner instead of the floated box, and `x/y/width/height/side/
   * lines` are unused. Collapsed notes reserve no layout space.
   */
  readonly collapsed?: boolean;
}

export interface LayoutNode {
  readonly id: string;
  readonly label: string;
  readonly shape: GraphShape;
  readonly color?: string;
  readonly group?: string;
  /** §1.4 tag metadata carried through from the parsed node (state only). */
  readonly metadata?: Readonly<Record<string, string>>;
  readonly lineNumber: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * A note floated beside this node. The shape keeps its natural dagre
   * position and dimensions (so its edges stay connected) — the note is
   * placed in adjacent space and the canvas bounds are expanded to fit
   * it. Absent on un-annotated nodes.
   */
  readonly note?: NoteLayout;
}

export interface LayoutEdge {
  readonly source: string;
  readonly target: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly label?: string;
  readonly lineNumber: number;
}

export interface LayoutGroup {
  readonly id: string;
  readonly label: string;
  readonly color?: string;
  readonly lineNumber: number;
  readonly collapsed?: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutOptions {
  /** Map of group ID → number of child nodes (for collapsed groups) */
  collapsedChildCounts?: Map<string, number>;
  /** Original groups before collapse (includes collapsed ones) */
  originalGroups?: readonly GraphGroup[];
  /**
   * 1-based source line numbers of notes the user has collapsed. A
   * collapsed note renders as a corner badge and reserves no space.
   */
  collapsedNotes?: ReadonlySet<number>;
}

export interface LayoutResult {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly groups: readonly LayoutGroup[];
  readonly width: number;
  readonly height: number;
}

const GROUP_PADDING = 20;

function computeNodeWidth(label: string, shape: GraphShape): number {
  if (shape === 'pseudostate') return 24;
  const base = Math.max(120, label.length * 9 + 40);
  if (shape === 'subroutine') return base + 10;
  return base;
}

function computeNodeHeight(shape: GraphShape): number {
  if (shape === 'pseudostate') return 24;
  return shape === 'decision' ? 60 : 50;
}

export function layoutGraph(
  graph: ParsedGraph,
  options?: LayoutOptions
): LayoutResult {
  const collapsedChildCounts = options?.collapsedChildCounts;
  const originalGroups = options?.originalGroups;
  const collapsedNotes = options?.collapsedNotes;

  // Collapsed groups become synthetic nodes in the graph
  const collapsedGroupNodes: GraphNode[] = [];
  if (collapsedChildCounts && originalGroups) {
    for (const group of originalGroups) {
      if (collapsedChildCounts.has(group.id)) {
        const count = collapsedChildCounts.get(group.id)!;
        collapsedGroupNodes.push({
          id: group.id,
          label: `${group.label} (${count} state${count !== 1 ? 's' : ''})`,
          shape: 'state',
          lineNumber: group.lineNumber,
          ...(group.color && { color: group.color }),
        });
      }
    }
  }

  const allNodes = [...graph.nodes, ...collapsedGroupNodes];

  if (allNodes.length === 0) {
    return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  }

  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: graph.direction,
    nodesep: 50,
    ranksep: 60,
    edgesep: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Build a lookup for original node data
  const nodeDataMap = new Map<string, GraphNode>();
  for (const node of allNodes) {
    nodeDataMap.set(node.id, node);
  }

  // Add group parent nodes (only non-collapsed groups)
  if (graph.groups) {
    for (const group of graph.groups) {
      g.setNode(group.id, {
        label: group.label,
        clusterLabelPos: 'top',
      });
    }
  }

  // Resolve note anchors (no diagnostics here — the parser already
  // emitted them). `no-notes` drops the reserved footprint entirely so
  // layout matches an un-annotated diagram (ADR-4 / AC8).
  const notesSuppressed = graph.options?.['no-notes'] === 'on';
  const noteByNode =
    notesSuppressed || !graph.notes
      ? new Map()
      : resolveNotes(graph.notes, graph.nodes);

  // Pre-computed note geometry, keyed by node id, threaded into LayoutNode.
  // The note does NOT change the node's dagre dims — the shape keeps its
  // position and its edge connections; the note floats beside it and the
  // canvas bounds are expanded to fit it.
  interface NoteGeom {
    noteW: number;
    noteH: number;
    color?: string;
    lines: WrappedDescLine[];
    lineNumber: number;
    endLineNumber: number;
  }
  const noteGeoms = new Map<string, NoteGeom>();

  // Add nodes with their natural dimensions (notes never inflate them).
  for (const node of allNodes) {
    const width = computeNodeWidth(node.label, node.shape);
    const height = computeNodeHeight(node.shape);
    g.setNode(node.id, { label: node.label, width, height });

    const note = noteByNode.get(node.id);
    if (note) {
      const size = noteBoxSize(note.body);
      noteGeoms.set(node.id, {
        noteW: size.width,
        noteH: size.height,
        ...(note.color && { color: note.color }),
        lines: size.lines,
        lineNumber: note.lineNumber,
        endLineNumber: note.endLineNumber,
      });
    }

    // Set parent for grouped nodes (only for non-collapsed groups)
    if (node.group && graph.groups?.some((gr) => gr.id === node.group)) {
      g.setParent(node.id, node.group);
    }
  }

  // Build edge lookup for original data
  const edgeDataMap = new Map<string, GraphEdge>();
  for (const edge of graph.edges) {
    const key = `${edge.source}->${edge.target}`;
    edgeDataMap.set(key, edge);
  }

  // Seed dagre so a node's children read left-to-right in source-definition
  // order (the first-defined branch sits leftmost). dagre's ordering pass is
  // initialized from edge-insertion order, and empirically the first sibling
  // edge inserted lands RIGHTMOST — so we insert each source node's outgoing
  // edges in REVERSE source order while preserving the order sources first
  // appear (keeps multi-root and cross-parent order intact). Crossing
  // minimization still runs on top; this only biases ties toward source order.
  const outgoingBySource = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    let group = outgoingBySource.get(edge.source);
    if (!group) {
      group = [];
      outgoingBySource.set(edge.source, group);
    }
    group.push(edge);
  }
  for (const group of outgoingBySource.values()) {
    for (let i = group.length - 1; i >= 0; i--) {
      const edge = group[i]!;
      g.setEdge(edge.source, edge.target, {
        label: edge.label ?? '',
      });
    }
  }

  // Run layout
  dagre.layout(g);

  // Extract positioned nodes
  const collapsedGroupIds = collapsedChildCounts
    ? new Set(collapsedChildCounts.keys())
    : new Set<string>();

  // Positioned nodes (no notes yet) — feeds collision-aware placement.
  const basePositioned = allNodes.map((node) => {
    const pos = g.node(node.id);
    return { node, x: pos.x, y: pos.y, width: pos.width, height: pos.height };
  });

  // ── Collision-aware note placement (shared `utils/notes`) ───
  // The note floats beside its node WITHOUT moving it: try the default
  // side, flip to the opposite, then push outward past blockers — each
  // placed note becoming an obstacle for later notes. Collapsed notes
  // reserve no space (drawn as a corner badge).
  const noteRequests = basePositioned
    .filter((p) => noteGeoms.has(p.node.id))
    .map((p) => {
      const ng = noteGeoms.get(p.node.id)!;
      return {
        key: p.node.id,
        node: { x: p.x, y: p.y, width: p.width, height: p.height },
        noteW: ng.noteW,
        noteH: ng.noteH,
        collapsed: collapsedNotes?.has(ng.lineNumber) ?? false,
      };
    });
  const placements = placeNotes(
    basePositioned.map((p) => ({
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
    })),
    noteRequests,
    graph.direction === 'LR' ? 'LR' : 'TB'
  );

  const layoutNodes: LayoutNode[] = basePositioned.map((p): LayoutNode => {
    const node = p.node;
    const ng = noteGeoms.get(node.id);
    const placed = placements.get(node.id);
    return {
      id: node.id,
      label: node.label,
      shape: node.shape,
      ...(node.color !== undefined && { color: node.color }),
      ...(node.group !== undefined && { group: node.group }),
      ...(node.metadata !== undefined && { metadata: node.metadata }),
      lineNumber: node.lineNumber,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      ...(ng &&
        placed && {
          // Local coords relative to the node center (translate origin).
          note: placed.collapsed
            ? {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                side: 'right' as NoteSide,
                ...(ng.color && { color: ng.color }),
                lines: [],
                lineNumber: ng.lineNumber,
                endLineNumber: ng.endLineNumber,
                collapsed: true,
              }
            : {
                x: placed.x,
                y: placed.y,
                width: ng.noteW,
                height: ng.noteH,
                side: placed.side,
                ...(ng.color && { color: ng.color }),
                lines: ng.lines,
                lineNumber: ng.lineNumber,
                endLineNumber: ng.endLineNumber,
              },
        }),
    };
  });

  // Extract edge waypoints
  const layoutEdges: LayoutEdge[] = graph.edges.map((edge): LayoutEdge => {
    const edgeData = g.edge(edge.source, edge.target);
    return {
      source: edge.source,
      target: edge.target,
      points: edgeData?.points ?? [],
      ...(edge.label !== undefined && { label: edge.label }),
      lineNumber: edge.lineNumber,
    };
  });

  // Compute group bounding boxes from member node positions
  // Collapsed groups are included as layout groups with collapsed=true
  // (their synthetic node is in layoutNodes for positioning)
  const layoutGroups: LayoutGroup[] = [];
  const allGroups = graph.groups ?? [];

  // Also include collapsed groups from originalGroups
  if (originalGroups) {
    for (const group of originalGroups) {
      if (collapsedGroupIds.has(group.id)) {
        const syntheticNode = layoutNodes.find((n) => n.id === group.id);
        if (syntheticNode) {
          layoutGroups.push({
            id: group.id,
            label: group.label,
            ...(group.color !== undefined && { color: group.color }),
            lineNumber: group.lineNumber,
            collapsed: true,
            x: syntheticNode.x - syntheticNode.width / 2,
            y: syntheticNode.y - syntheticNode.height / 2,
            width: syntheticNode.width,
            height: syntheticNode.height,
          });
        }
      }
    }
  }

  if (allGroups.length > 0) {
    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));
    for (const group of allGroups) {
      const members = group.nodeIds
        .map((id) => nodeMap.get(id))
        .filter((n): n is LayoutNode => n !== undefined);

      if (members.length === 0) {
        layoutGroups.push({
          id: group.id,
          label: group.label,
          ...(group.color !== undefined && { color: group.color }),
          lineNumber: group.lineNumber,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });
        continue;
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const member of members) {
        const left = member.x - member.width / 2;
        const right = member.x + member.width / 2;
        const top = member.y - member.height / 2;
        const bottom = member.y + member.height / 2;
        if (left < minX) minX = left;
        if (right > maxX) maxX = right;
        if (top < minY) minY = top;
        if (bottom > maxY) maxY = bottom;
      }

      layoutGroups.push({
        id: group.id,
        label: group.label,
        ...(group.color !== undefined && { color: group.color }),
        lineNumber: group.lineNumber,
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2,
      });
    }
  }

  // Content bounding box over nodes, their (floated) notes, and groups.
  // Notes placed above/left of a node can land at negative coordinates;
  // when they do, everything is shifted so nothing clips on export. Edges
  // are intentionally excluded (matching the prior bounds behavior) so
  // un-annotated layouts are byte-for-byte unchanged.
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
    if (node.note) {
      extend(
        node.x + node.note.x,
        node.y + node.note.y,
        node.x + node.note.x + node.note.width,
        node.y + node.note.y + node.note.height
      );
    }
  }
  for (const group of layoutGroups) {
    extend(group.x, group.y, group.x + group.width, group.y + group.height);
  }
  if (!Number.isFinite(bbMinX)) {
    bbMinX = 0;
    bbMinY = 0;
    bbMaxX = 0;
    bbMaxY = 0;
  }

  // Shift only when content runs off the top/left (note placed above/left).
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
  const finalGroups = shifted
    ? layoutGroups.map((gr) => ({ ...gr, x: gr.x + shiftX, y: gr.y + shiftY }))
    : layoutGroups;

  // Add margin (matches prior behavior: max-edge + 40).
  const totalWidth = bbMaxX + shiftX + 40;
  const totalHeight = bbMaxY + shiftY + 40;

  return {
    nodes: finalNodes,
    edges: finalEdges,
    groups: finalGroups,
    width: totalWidth,
    height: totalHeight,
  };
}
