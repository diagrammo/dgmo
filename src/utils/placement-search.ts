// ============================================================
// The dagre placement search (#1240), borrowed from boxes-and-lines and shared
// by the chart types that lay out with one plain dagre run: several dagre
// placements, scored on the boxes-and-lines search's own badness — true spline
// crossings + overlap runs + node pierces — then the winner's pierces bent
// around the node. The plain placement (network-simplex, source order) is the
// first candidate, and another replaces it only when it lowers badness WITHOUT
// adding a crossing: a picture with nothing to fix lays out exactly as before,
// and no fixture ever gains a crossing.
// ============================================================

import {
  countSplineCrossings,
  countEdgeOverlaps,
  countEdgeNodePierces,
  countForeignGroupCrossings,
  deroutePierces,
  derouteForeignGroups,
  searchBudget,
} from '../boxes-and-lines/layout-search';
import type { BLGroup } from '../boxes-and-lines/types';
import type { BLLayoutResult } from '../boxes-and-lines/layout';
import type { GraphLabel } from '@dagrejs/dagre';

export type Pt = { readonly x: number; readonly y: number };

/** Reorders a list; a seeded search candidate's insertion order. */
export type Shuffle = <T>(a: readonly T[]) => T[];

/** One placement, in the shape the scorers read. */
export interface ScoredPlacement {
  /** Every node box, keyed by `id`, centred on (x, y). */
  readonly nodes: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
  /** The edges to score, in a fixed order — a rerouted edge maps back by index. */
  readonly edges: readonly {
    readonly source: string;
    readonly target: string;
    readonly points: readonly Pt[];
  }[];
  /**
   * The group boxes as drawn, centred on (x, y), with the node ids each holds.
   * An edge through a box that holds neither of its endpoints counts as badness
   * (#1839), so the search prefers placements whose curves go around groups.
   */
  readonly groups?: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly members: readonly string[];
  }[];
}

type Ranker = NonNullable<GraphLabel['ranker']>;

/** The plain placement's insertion order: the list as given. */
export const sourceOrder: Shuffle = <T>(a: readonly T[]): T[] => a.slice();

/** The read side of a laid-out dagre graph, as `dagreScored` uses it. */
interface LaidOut {
  node(id: string): {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  edge(
    v: string,
    w: string,
    name?: string
  ): { readonly points?: readonly Pt[] } | undefined;
}

/**
 * `searchPlacement`'s `score` for a plain dagre run: each node's box and each
 * edge's route, in the orders given — a rerouted edge maps back by index.
 * `edgeName` keys a multigraph's edges (ER passes the line number).
 */
export function dagreScored<E extends { source: string; target: string }>(
  lay: LaidOut,
  nodes: readonly { readonly id: string }[],
  edges: readonly E[],
  edgeName?: (e: E) => string
): ScoredPlacement {
  return {
    nodes: nodes.map((n) => {
      const p = lay.node(n.id);
      return { id: n.id, x: p.x, y: p.y, width: p.width, height: p.height };
    }),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      points:
        (edgeName
          ? lay.edge(e.source, e.target, edgeName(e))
          : lay.edge(e.source, e.target)
        )?.points ?? [],
    })),
  };
}

const SEARCH_RANKERS: Ranker[] = ['tight-tree', 'longest-path'];
// Seed-shuffles tried, below the boxes-and-lines count. The callers lay out
// synchronously, so every candidate (~27 ms of dagre on a 9-node state
// diagram) blocks the editor. On the 13 flowchart and state fixtures every
// winning candidate came within the first 6 attempts; the full count added
// ~600 ms to the two diagrams it could not finish and found nothing more.
const SEARCH_SEEDS = 6;
// Seed-shuffles stop after this many in a row that do not lower badness
// (#1281). A diagram that cannot reach zero crossings otherwise pays for every
// seed: the state example's winner is the second ranker, and its six seeds
// all lost, so 9 dagre layouts cost ~245 ms per edit. On the flowchart, state,
// class and ER gallery and example fixtures, every winning seed came first or
// straight after one losing seed. The rankers always run.
const SEED_PATIENCE = 2;
// Above this many nodes plus edges the plain placement is drawn as is, with no
// search and no scoring (#1890). Every candidate is scored by an all-pairs
// crossing count, so the search grew with about the square of the diagram:
// at 90 states it took ~2.4 s against ~0.2 s for the plain layout (2026-11-10).
// The largest flowchart, state, class or ER diagram in the test suite is 76
// (31 nodes, 45 edges), so every one of them keeps the layout it had.
const SEARCH_SIZE_LIMIT = 80;

function seeded(s: number): () => number {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffler(seed: number): Shuffle {
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

/**
 * The best of several dagre placements. `place` runs dagre once — `shuffle`
 * (a seeded candidate) varies the insertion order of nodes and edges, which is
 * what dagre's within-rank ordering starts from. `score` reads a placement back.
 * `edgePoints`, when present, replaces the winner's edge routes (by `score`'s
 * edge order): the detour bent them around nodes they pierced.
 */
export function searchPlacement<G>(
  direction: string,
  place: (ranker: Ranker, shuffle?: Shuffle) => G,
  score: (g: G) => ScoredPlacement
): { g: G; edgePoints?: Pt[][] } {
  // Which nodes each group holds — the same for every candidate, so read once.
  let held: BLGroup[] | undefined;
  const asScored = (g: G): BLLayoutResult => {
    const s = score(g);
    held ??= (s.groups ?? []).map((gr) => ({
      label: gr.id,
      children: gr.members,
      lineNumber: 0,
      metadata: {},
    }));
    return {
      nodes: s.nodes.map((n) => ({ ...n, label: n.id })),
      edges: s.edges,
      groups: (s.groups ?? []).map((gr) => ({
        label: gr.id,
        x: gr.x,
        y: gr.y,
        width: gr.width,
        height: gr.height,
        collapsed: false,
      })),
      width: 0,
      height: 0,
    } as unknown as BLLayoutResult;
  };
  const rest = (lay: BLLayoutResult): number =>
    countEdgeOverlaps(lay) +
    countEdgeNodePierces(lay) +
    (held?.length ? countForeignGroupCrossings(lay, held) : 0);
  // Edges drawn against the flow (target before source on the rank axis).
  // dagre picks which edge of a cycle to reverse from insertion order, so a
  // shuffled candidate can turn the main path around — the state fixture's
  // Pending landed right of everything it leads to. A candidate may only
  // draw an edge backward where the plain placement already does.
  const along = direction === 'LR' ? 'x' : 'y';
  const backward = (lay: BLLayoutResult): Set<number> => {
    const at = new Map(lay.nodes.map((n) => [n.label, n[along]]));
    const out = new Set<number>();
    lay.edges.forEach((e, i) => {
      if (e.source === e.target) return;
      if (at.get(e.target)! < at.get(e.source)! - 1) out.add(i);
    });
    return out;
  };

  // A candidate whose curves still run through a foreign group box is also
  // tried with those edges bent around it (#1839); the bent copy stands in for
  // the candidate when it scores better on the same terms.
  const withGroupDetour = (
    lay: BLLayoutResult,
    floor: number,
    bad: number
  ): { lay: BLLayoutResult; bad: number } => {
    if (!held?.length) return { lay, bad };
    const bent = derouteForeignGroups(lay, held);
    if (bent === lay) return { lay, bad };
    const x = countSplineCrossings(bent, floor);
    if (x > floor) return { lay, bad };
    const b = x + rest(bent);
    return b < bad ? { lay: bent, bad: b } : { lay, bad };
  };

  let best = place('network-simplex');
  const plain = score(best);
  if (plain.nodes.length + plain.edges.length > SEARCH_SIZE_LIMIT) {
    return { g: best };
  }
  const plainLay = asScored(best);
  const plainX = countSplineCrossings(plainLay);
  const plainBad = plainX + rest(plainLay);
  if (plainBad === 0) return { g: best };
  const plainBack = backward(plainLay);
  let { lay: bestLay, bad: bestBad } = withGroupDetour(
    plainLay,
    plainX,
    plainBad
  );
  // Set while the best candidate is a bent copy: its routes replace dagre's.
  const routesOf = (lay: BLLayoutResult, raw: BLLayoutResult) =>
    lay === raw ? undefined : lay.edges.map((e) => e.points as Pt[]);
  let rerouted = routesOf(bestLay, plainLay);

  const budget = searchBudget(bestLay.nodes.length, bestLay.edges.length);
  const configs: { ranker: Ranker; seed?: number }[] = [
    ...SEARCH_RANKERS.map((ranker) => ({ ranker })),
    ...Array.from(
      { length: Math.min(budget.seeds, SEARCH_SEEDS) },
      (_, seed): { ranker: Ranker; seed: number } => ({
        ranker: 'network-simplex',
        seed,
      })
    ),
  ];
  // The plain placement is the first attempt.
  let attempts = 1;
  let losingSeeds = 0;
  for (const cfg of configs) {
    if (bestBad === 0 || attempts >= budget.maxCandidates) break;
    if (losingSeeds >= SEED_PATIENCE) break;
    attempts++;
    if (cfg.seed !== undefined) losingSeeds++;
    let g: G;
    try {
      g = place(
        cfg.ranker,
        cfg.seed === undefined ? undefined : shuffler(cfg.seed)
      );
    } catch {
      continue; // some rankers choke on odd graphs
    }
    const raw = asScored(g);
    if ([...backward(raw)].some((i) => !plainBack.has(i))) continue;
    // Past `floor` it cannot win: more crossings than plain, or no lower badness.
    const floor = Math.min(plainX, bestBad - 1);
    const x = countSplineCrossings(raw, floor);
    if (x > floor) continue;
    const { lay, bad } = withGroupDetour(raw, floor, x + rest(raw));
    if (bad < bestBad) {
      best = g;
      bestLay = lay;
      bestBad = bad;
      rerouted = routesOf(lay, raw);
      losingSeeds = 0;
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
  return rerouted ? { g: best, edgePoints: rerouted } : { g: best };
}
