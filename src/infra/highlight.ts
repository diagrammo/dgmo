// `highlight` story view for infra (#2041): resolves the directive against a
// diagram's nodes, groups and edges. An author may write a node by its label
// or by its id, so both spellings are offered to the shared resolver and every
// edge is offered under all four label/id pairings.

import {
  resolveHighlightPaths,
  type EmphasisDirective,
} from '../utils/emphasis';

export interface HighlightGraph {
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly groupId?: string | null;
  }>;
  readonly groups: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
  }>;
  readonly edges: ReadonlyArray<{
    readonly sourceId: string;
    readonly targetId: string;
    readonly label: string;
  }>;
}

export interface InfraHighlight {
  readonly active: boolean;
  readonly unknown: readonly string[];
  readonly litNodeIds: ReadonlySet<string>;
  readonly litGroupIds: ReadonlySet<string>;
  /** Indexes into `graph.edges`. */
  readonly litEdges: ReadonlySet<number>;
}

export function resolveInfraHighlight(
  directive: EmphasisDirective | undefined,
  graph: HighlightGraph
): InfraHighlight {
  const spellings = new Map<string, string[]>();
  const add = (id: string, label: string) => {
    spellings.set(id, [...new Set([label, id])]);
  };
  for (const n of graph.nodes) add(n.id, n.label);
  for (const g of graph.groups) add(g.id, g.label);

  const names: string[] = [];
  // Labels first so that, on a case-insensitive clash, the id spelling wins.
  for (const s of spellings.values()) names.push(s[0]!);
  for (const id of spellings.keys()) names.push(id);

  const variants: { from: string; to: string; label: string }[] = [];
  const owner: number[] = [];
  graph.edges.forEach((e, i) => {
    const f = spellings.get(e.sourceId) ?? [e.sourceId];
    const t = spellings.get(e.targetId) ?? [e.targetId];
    for (const a of f) {
      for (const b of t) {
        variants.push({ from: a, to: b, label: e.label });
        owner.push(i);
      }
    }
  });

  const paths = resolveHighlightPaths(directive, names, variants);
  const litNames = new Set([...paths.litNodes].map((n) => n.toLowerCase()));
  const isLit = (id: string) =>
    (spellings.get(id) ?? [id]).some((s) => litNames.has(s.toLowerCase()));

  const litNodeIds = new Set<string>();
  const litGroupIds = new Set<string>();
  for (const n of graph.nodes) if (isLit(n.id)) litNodeIds.add(n.id);
  for (const g of graph.groups) if (isLit(g.id)) litGroupIds.add(g.id);
  // A frame around a lit node is lit too.
  for (const n of graph.nodes) {
    if (litNodeIds.has(n.id) && n.groupId) litGroupIds.add(n.groupId);
  }
  const litEdges = new Set<number>();
  paths.litEdges.forEach((i) => {
    litEdges.add(owner[i]!);
  });
  return {
    active: paths.active,
    unknown: paths.unknown,
    litNodeIds,
    litGroupIds,
    litEdges,
  };
}
