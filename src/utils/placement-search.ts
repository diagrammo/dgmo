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
  deroutePierces,
  searchBudget,
} from '../boxes-and-lines/layout-search';
import type { BLLayoutResult } from '../boxes-and-lines/layout';

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
}

const SEARCH_RANKERS = ['tight-tree', 'longest-path'];
// Seed-shuffles tried, below the boxes-and-lines count. The callers lay out
// synchronously, so every candidate (~27 ms of dagre on a 9-node state
// diagram) blocks the editor. On the 13 flowchart and state fixtures every
// winning candidate came within the first 6 attempts; the full count added
// ~600 ms to the two diagrams it could not finish and found nothing more.
const SEARCH_SEEDS = 6;

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
  place: (ranker: string, shuffle?: Shuffle) => G,
  score: (g: G) => ScoredPlacement
): { g: G; edgePoints?: Pt[][] } {
  const asScored = (g: G): BLLayoutResult => {
    const s = score(g);
    return {
      nodes: s.nodes.map((n) => ({ ...n, label: n.id })),
      edges: s.edges,
      groups: [],
      width: 0,
      height: 0,
    } as unknown as BLLayoutResult;
  };
  const rest = (lay: BLLayoutResult): number =>
    countEdgeOverlaps(lay) + countEdgeNodePierces(lay);
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

  let best = place('network-simplex');
  let bestLay = asScored(best);
  const plainX = countSplineCrossings(bestLay);
  let bestBad = plainX + rest(bestLay);
  if (bestBad === 0) return { g: best };
  const plainBack = backward(bestLay);

  const budget = searchBudget(bestLay.nodes.length, bestLay.edges.length);
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
    let g: G;
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
