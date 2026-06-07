import dagre from '@dagrejs/dagre';
import type {
  ParsedGraph,
  GraphNode,
  GraphEdge,
  GraphGroup,
  GraphShape,
} from './types';
import { resolveNotes } from './notes';
import { noteBoxSize, NOTE_GAP } from '../utils/note-box';
import type { WrappedDescLine } from '../utils/wrapped-desc';

/** A note box positioned relative to its anchor node's center. */
export interface NoteLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lines: readonly WrappedDescLine[];
  readonly lineNumber: number;
  readonly endLineNumber: number;
}

export interface LayoutNode {
  readonly id: string;
  readonly label: string;
  readonly shape: GraphShape;
  readonly color?: string;
  readonly group?: string;
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
    g.setEdge(edge.source, edge.target, {
      label: edge.label ?? '',
    });
  }

  // Run layout
  dagre.layout(g);

  // Extract positioned nodes
  const collapsedGroupIds = collapsedChildCounts
    ? new Set(collapsedChildCounts.keys())
    : new Set<string>();

  const layoutNodes: LayoutNode[] = allNodes.map((node): LayoutNode => {
    const pos = g.node(node.id);
    const ng = noteGeoms.get(node.id);
    return {
      id: node.id,
      label: node.label,
      shape: node.shape,
      ...(node.color !== undefined && { color: node.color }),
      ...(node.group !== undefined && { group: node.group }),
      lineNumber: node.lineNumber,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      ...(ng && {
        // Local coords relative to the node center (translate origin). The
        // note floats into the rank-gap direction so it lands beside the
        // flow, not across it: to the RIGHT for top-down graphs, BELOW for
        // left-right graphs. The shape itself is never moved.
        note:
          graph.direction === 'LR'
            ? {
                x: -pos.width / 2,
                y: pos.height / 2 + NOTE_GAP,
                width: ng.noteW,
                height: ng.noteH,
                lines: ng.lines,
                lineNumber: ng.lineNumber,
                endLineNumber: ng.endLineNumber,
              }
            : {
                x: pos.width / 2 + NOTE_GAP,
                y: -ng.noteH / 2,
                width: ng.noteW,
                height: ng.noteH,
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

  // Compute total diagram dimensions
  let totalWidth = 0;
  let totalHeight = 0;
  for (const node of layoutNodes) {
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
    // Floated notes live outside the node extent — expand bounds so the
    // box is never clipped on export (the shape's position is untouched).
    if (node.note) {
      const noteRight = node.x + node.note.x + node.note.width;
      const noteBottom = node.y + node.note.y + node.note.height;
      if (noteRight > totalWidth) totalWidth = noteRight;
      if (noteBottom > totalHeight) totalHeight = noteBottom;
    }
  }
  for (const group of layoutGroups) {
    const right = group.x + group.width;
    const bottom = group.y + group.height;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  // Add margin
  totalWidth += 40;
  totalHeight += 40;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    groups: layoutGroups,
    width: totalWidth,
    height: totalHeight,
  };
}
