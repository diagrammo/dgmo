// `highlight` story view for flowchart and state (#2041). Both draw
// GraphNode/GraphEdge, so one resolver serves the two parsers and renderers.
import {
  resolveHighlightPaths,
  highlightPathWarnings,
  type EmphasisDirective,
  type ResolvedPaths,
} from '../utils/emphasis';
import type { GraphNode, GraphEdge } from './types';

export interface GraphHighlight {
  readonly active: boolean;
  readonly litNodeIds: ReadonlySet<string>;
  readonly litEdgeIdx: ReadonlySet<number>;
  readonly unknown: readonly string[];
}

const INACTIVE: GraphHighlight = {
  active: false,
  litNodeIds: new Set(),
  litEdgeIdx: new Set(),
  unknown: [],
};

/**
 * Names an author may type: the bare label (`OK?`, as written inside shape
 * brackets) or the node id. Resolved once per spelling, then unioned; an
 * item is unknown only when both spellings miss it.
 */
export function resolveGraphHighlight(
  emphasis: EmphasisDirective | undefined,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): GraphHighlight {
  if (emphasis?.kind !== 'highlight') return INACTIVE;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgesBy = (name: (n: GraphNode) => string) =>
    edges.map((e) => ({
      from: name(byId.get(e.source)!),
      to: name(byId.get(e.target)!),
      ...(e.label !== undefined && { label: e.label }),
    }));
  const byLabel: ResolvedPaths = resolveHighlightPaths(
    emphasis,
    nodes.map((n) => n.label),
    edgesBy((n) => n.label)
  );
  const byIdPaths: ResolvedPaths = resolveHighlightPaths(
    emphasis,
    nodes.map((n) => n.id),
    edgesBy((n) => n.id)
  );
  const litNodeIds = new Set<string>();
  for (const n of nodes) {
    if (byLabel.litNodes.has(n.label) || byIdPaths.litNodes.has(n.id))
      litNodeIds.add(n.id);
  }
  const litEdgeIdx = new Set<number>([
    ...byLabel.litEdges,
    ...byIdPaths.litEdges,
  ]);
  const idUnknown = new Set(byIdPaths.unknown);
  const unknown = byLabel.unknown.filter((u) => idUnknown.has(u));
  return {
    active: litNodeIds.size > 0 || litEdgeIdx.size > 0,
    litNodeIds,
    litEdgeIdx,
    unknown,
  };
}

/** Warning messages for the parser to push on the directive's line. */
export function graphHighlightWarnings(h: GraphHighlight): string[] {
  return highlightPathWarnings({
    active: h.active,
    litNodes: new Set(),
    litEdges: new Set(),
    unknown: h.unknown,
  });
}
