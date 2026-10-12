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
import {
  countSplineCrossings,
  countEdgeOverlaps,
  countEdgeNodePierces,
  deroutePierces,
  searchBudget,
} from '../boxes-and-lines/layout-search';
import type { BLLayoutResult } from '../boxes-and-lines/layout';

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
  /** The group's own tag metadata, carried through so the renderer can tint
   *  the frame from the active tag group (#585). */
  readonly metadata?: Readonly<Record<string, string>>;
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

type Pt = { readonly x: number; readonly y: number };
const newDagreGraph = () => new dagre.graphlib.Graph({ compound: true });
type DagreGraph = ReturnType<typeof newDagreGraph>;

// The placement search (#1240), borrowed from boxes-and-lines: several dagre
// placements, scored on the boxes-and-lines search's own badness — true spline
// crossings + overlap runs + node pierces — then the winner's pierces bent
// around the node. The plain placement (network-simplex, source order) is the
// first candidate, and another replaces it only when it lowers badness WITHOUT
// adding a crossing: a picture with nothing to fix lays out exactly as before,
// and no fixture ever gains a crossing.
const SEARCH_RANKERS = ['tight-tree', 'longest-path'];
// Seed-shuffles tried, below the boxes-and-lines count. `layoutGraph` is
// synchronous, so every candidate (~27 ms of dagre on a 9-node state diagram)
// blocks the editor. On the 13 flowchart and state fixtures every winning
// candidate came within the first 6 attempts; the full count added ~600 ms
// to the two diagrams it could not finish and found nothing more.
const SEARCH_SEEDS = 6;

function seeded(s: number): () => number {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffler(seed: number): <T>(a: readonly T[]) => T[] {
  const r = seeded(seed + 1);
  return <T>(a: readonly T[]): T[] => {
    const out = a.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
}

function searchPlacement(
  graph: ParsedGraph,
  allNodes: readonly GraphNode[],
  place: (ranker: string, shuffle?: <T>(a: readonly T[]) => T[]) => DagreGraph
): { g: DagreGraph; edgePoints?: Pt[][] } {
  // The scorers read boxes-and-lines' layout shape: nodes keyed by `label`,
  // edges in `graph.edges` order so a rerouted edge maps back by index.
  const asScored = (g: DagreGraph): BLLayoutResult =>
    ({
      nodes: allNodes.map((n) => {
        const p = g.node(n.id);
        return {
          label: n.id,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
        };
      }),
      edges: graph.edges.map((e) => ({
        source: e.source,
        target: e.target,
        points: (g.edge(e.source, e.target)?.points ?? []) as Pt[],
      })),
      groups: [],
      width: 0,
      height: 0,
    }) as unknown as BLLayoutResult;
  const rest = (lay: BLLayoutResult): number =>
    countEdgeOverlaps(lay) + countEdgeNodePierces(lay);
  // Edges drawn against the flow (target before source on the rank axis).
  // dagre picks which edge of a cycle to reverse from insertion order, so a
  // shuffled candidate can turn the main path around — the state fixture's
  // Pending landed right of everything it leads to. A candidate may only
  // draw an edge backward where the plain placement already does.
  const along = graph.direction === 'LR' ? 'x' : 'y';
  const backward = (lay: BLLayoutResult): Set<number> => {
    const at = new Map(lay.nodes.map((n) => [n.label, n[along]]));
    const out = new Set<number>();
    lay.edges.forEach((e, i) => {
      if (e.source === e.target) return;
      if (at.get(e.target)! < at.get(e.source)! - 1) out.add(i);
    });
    return out;
  };

  let best = place('network-simplex');
  let bestLay = asScored(best);
  const plainX = countSplineCrossings(bestLay);
  let bestBad = plainX + rest(bestLay);
  if (bestBad === 0) return { g: best };
  const plainBack = backward(bestLay);

  const budget = searchBudget(allNodes.length, graph.edges.length);
  const configs: { ranker: string; seed?: number }[] = [
    ...SEARCH_RANKERS.map((ranker) => ({ ranker })),
    ...Array.from(
      { length: Math.min(budget.seeds, SEARCH_SEEDS) },
      (_, seed) => ({
        ranker: 'network-simplex',
        seed,
      })
    ),
  ];
  // The plain placement is the first attempt.
  let attempts = 1;
  for (const cfg of configs) {
    if (bestBad === 0 || attempts >= budget.maxCandidates) break;
    attempts++;
    let g: DagreGraph;
    try {
      g = place(
        cfg.ranker,
        cfg.seed === undefined ? undefined : shuffler(cfg.seed)
      );
    } catch {
      continue; // some rankers choke on odd graphs
    }
    const lay = asScored(g);
    if ([...backward(lay)].some((i) => !plainBack.has(i))) continue;
    // Past `floor` it cannot win: more crossings than plain, or no lower badness.
    const floor = Math.min(plainX, bestBad - 1);
    const x = countSplineCrossings(lay, floor);
    if (x > floor) continue;
    const bad = x + rest(lay);
    if (bad < bestBad) {
      best = g;
      bestLay = lay;
      bestBad = bad;
    }
  }

  // The badness-gated detour: bend edges around the nodes they still pierce,
  // kept on the same terms as a candidate.
  const bent = deroutePierces(bestLay);
  if (bent !== bestLay) {
    const floor = Math.min(plainX, bestBad - 1);
    const x = countSplineCrossings(bent, floor);
    if (x <= floor && x + rest(bent) < bestBad)
      return {
        g: best,
        edgePoints: bent.edges.map((e) => e.points as Pt[]),
      };
  }
  return { g: best };
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

  // Build a lookup for original node data
  const nodeDataMap = new Map<string, GraphNode>();
  for (const node of allNodes) {
    nodeDataMap.set(node.id, node);
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
  for (const node of allNodes) {
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
  const edgeOrder: GraphEdge[] = [];
  for (const group of outgoingBySource.values())
    for (let i = group.length - 1; i >= 0; i--) edgeOrder.push(group[i]!);

  // One dagre placement. `shuffle` (a seeded search candidate) varies the
  // insertion order of nodes and edges, which is what dagre's within-rank
  // ordering starts from; without it the order is the source-order bias above.
  const place = (
    ranker: string,
    shuffle?: <T>(a: readonly T[]) => T[]
  ): DagreGraph => {
    const ord = shuffle ?? (<T>(a: readonly T[]): T[] => a.slice());
    const g = newDagreGraph();
    g.setGraph({
      rankdir: graph.direction,
      ranker,
      nodesep: 50,
      ranksep: 60,
      edgesep: 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add group parent nodes (only non-collapsed groups)
    if (graph.groups) {
      for (const group of graph.groups) {
        g.setNode(group.id, {
          label: group.label,
          clusterLabelPos: 'top',
        });
      }
    }

    // Add nodes with their natural dimensions (notes never inflate them).
    for (const node of ord(allNodes)) {
      const width = computeNodeWidth(node.label, node.shape);
      const height = computeNodeHeight(node.shape);
      g.setNode(node.id, { label: node.label, width, height });

      // Set parent for grouped nodes (only for non-collapsed groups)
      if (node.group && graph.groups?.some((gr) => gr.id === node.group)) {
        g.setParent(node.id, node.group);
      }
    }

    for (const edge of ord(edgeOrder)) {
      g.setEdge(edge.source, edge.target, {
        label: edge.label ?? '',
      });
    }

    dagre.layout(g);
    return g;
  };

  const { g, edgePoints } = searchPlacement(graph, allNodes, place);

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
  const layoutEdges: LayoutEdge[] = graph.edges.map((edge, i): LayoutEdge => {
    const edgeData = g.edge(edge.source, edge.target);
    return {
      source: edge.source,
      target: edge.target,
      points: edgePoints?.[i] ?? edgeData?.points ?? [],
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
            ...(group.metadata && { metadata: group.metadata }),
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
          ...(group.metadata && { metadata: group.metadata }),
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
        ...(group.metadata && { metadata: group.metadata }),
        lineNumber: group.lineNumber,
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2,
      });
    }
  }

  // Content bounding box over nodes, their (floated) notes, groups, and
  // self-loop edges. Notes placed above/left of a node can land at negative
  // coordinates; when they do, everything is shifted so nothing clips on
  // export. Ordinary edges are intentionally excluded (matching the prior
  // bounds behavior) so un-annotated layouts are byte-for-byte unchanged.
  //
  // Self-loops are the exception: dagre routes them on the axis
  // perpendicular to the flow (below the node under `LR`, beside it under
  // `TB`) and reserves rank space for them, but that space lies wholly
  // outside every node box — so a bbox over nodes alone puts the loop
  // exactly on the canvas edge and clips it.
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
  for (const edge of layoutEdges) {
    if (edge.source !== edge.target) continue;
    for (const pt of edge.points) extend(pt.x, pt.y, pt.x, pt.y);
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
