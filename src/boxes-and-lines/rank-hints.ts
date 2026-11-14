/**
 * Rank hints for the dagre engine (#1840): `same-rank A, B, …` puts boxes on
 * one rank, and `order A, B, …` keeps boxes that share a rank in that order
 * across it.
 *
 * dagre has no rank constraint, but it accepts a FUNCTION as `ranker` and
 * calls it on its internal non-compound graph (boxes, group borders, the
 * nesting root and long-edge structure, with each edge's `minlen`/`weight`).
 * `rankWithHints` ranks that graph itself: each same-rank set is contracted
 * to one vertex, the contracted DAG gets a longest-path ranking, and
 * coordinate-descent sweeps then pull every vertex toward its heavier side —
 * the tightening network simplex would do, closely enough for a hinted graph.
 * A hint that would close a cycle (one member already reaches another) is
 * skipped; the parser warns about the ones it can see.
 */

type Edge = { v: string; w: string };
type RankGraph = {
  nodes(): string[];
  edges(): Edge[];
  node(v: string): { rank?: number };
  edge(e: Edge): { minlen?: number; weight?: number };
};

const TIGHTEN_SWEEPS = 8;

export function rankWithHints(
  lg: RankGraph,
  sameRank: readonly (readonly string[])[],
  tighten: boolean
): void {
  const nodes = lg.nodes();
  const present = new Set(nodes);
  const edges = lg.edges().map((e) => {
    const lab = lg.edge(e);
    return { v: e.v, w: e.w, minlen: lab.minlen ?? 1, weight: lab.weight ?? 1 };
  });

  // Union-find over the hint sets; a union that closes a cycle is undone.
  const parent = new Map<string, string>(nodes.map((v) => [v, v]));
  const find = (v: string): string => {
    let r = v;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(v, r);
    return r;
  };
  const acyclic = (): boolean => {
    const out = new Map<string, string[]>();
    for (const e of edges) {
      const a = find(e.v);
      const b = find(e.w);
      if (a === b) {
        if (e.minlen > 0) return false;
        continue;
      }
      const arr = out.get(a) ?? [];
      arr.push(b);
      out.set(a, arr);
    }
    const state = new Map<string, 1 | 2>();
    const visit = (v: string): boolean => {
      const s = state.get(v);
      if (s === 2) return true;
      if (s === 1) return false;
      state.set(v, 1);
      for (const w of out.get(v) ?? []) if (!visit(w)) return false;
      state.set(v, 2);
      return true;
    };
    for (const v of nodes) if (!visit(find(v))) return false;
    return true;
  };
  for (const set of sameRank) {
    const members = set.filter((v) => present.has(v));
    if (members.length < 2) continue;
    const saved = new Map(parent);
    for (let i = 1; i < members.length; i++) {
      const a = find(members[0]!);
      const b = find(members[i]!);
      if (a !== b) parent.set(b, a);
    }
    if (!acyclic()) {
      parent.clear();
      for (const [k, val] of saved) parent.set(k, val);
    }
  }

  // Contracted DAG.
  type CEdge = { to: string; minlen: number; weight: number };
  const outs = new Map<string, CEdge[]>();
  const ins = new Map<string, CEdge[]>();
  const reps = new Set<string>();
  for (const v of nodes) reps.add(find(v));
  for (const e of edges) {
    const a = find(e.v);
    const b = find(e.w);
    if (a === b) continue;
    (outs.get(a) ?? outs.set(a, []).get(a)!).push({
      to: b,
      minlen: e.minlen,
      weight: e.weight,
    });
    (ins.get(b) ?? ins.set(b, []).get(b)!).push({
      to: a,
      minlen: e.minlen,
      weight: e.weight,
    });
  }

  // Longest path, dagre's convention: sinks at 0, every other vertex as close
  // above its successors as `minlen` allows.
  const rank = new Map<string, number>();
  const onPath = new Set<string>();
  const dfs = (v: string): number => {
    const known = rank.get(v);
    if (known !== undefined) return known;
    onPath.add(v);
    let r = Infinity;
    for (const e of outs.get(v) ?? [])
      if (!onPath.has(e.to)) r = Math.min(r, dfs(e.to) - e.minlen);
    onPath.delete(v);
    if (r === Infinity) r = 0;
    rank.set(v, r);
    return r;
  };
  for (const v of reps) dfs(v);

  // Tightening: a vertex moves to whichever end of its feasible interval the
  // heavier side of its edges pulls it to.
  if (tighten) {
    const order = [...reps].sort((a, b) => rank.get(a)! - rank.get(b)!);
    for (let sweep = 0; sweep < TIGHTEN_SWEEPS; sweep++) {
      let moved = false;
      for (const v of order) {
        let lo = -Infinity;
        let hi = Infinity;
        let pull = 0;
        for (const e of ins.get(v) ?? []) {
          lo = Math.max(lo, rank.get(e.to)! + e.minlen);
          pull += e.weight;
        }
        for (const e of outs.get(v) ?? []) {
          hi = Math.min(hi, rank.get(e.to)! - e.minlen);
          pull -= e.weight;
        }
        const cur = rank.get(v)!;
        const next =
          pull > 0 && lo > -Infinity
            ? lo
            : pull < 0 && hi < Infinity
              ? hi
              : cur;
        if (next !== cur && next >= lo && next <= hi) {
          rank.set(v, next);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  for (const v of nodes) lg.node(v).rank = rank.get(find(v))!;
}

type OrderGraph = {
  nodes(): string[];
  node(v: string): { rank?: number; order?: number };
  isCompound(): boolean;
  parent(v: string): string | undefined | void;
};

/**
 * dagre `customOrder` step: wherever two or more boxes of one `order` hint are
 * siblings (same rank, same parent group), give them their run's slots in the
 * hint's order. Other entries keep their slots, so a group's band stays
 * contiguous. Later hints win where two disagree.
 */
export function applyRankOrder(
  lg: OrderGraph,
  orderHints: readonly (readonly string[])[]
): void {
  for (const hint of orderHints) {
    const runs = new Map<string, string[]>();
    for (const v of hint) {
      if (!lg.nodes().includes(v)) continue;
      const nd = lg.node(v);
      if (nd.rank === undefined || nd.order === undefined) continue;
      const p = lg.isCompound() ? lg.parent(v) : undefined;
      const key = `${nd.rank}\u0000${p ?? ''}`;
      (runs.get(key) ?? runs.set(key, []).get(key)!).push(v);
    }
    for (const run of runs.values()) {
      if (run.length < 2) continue;
      const slots = run.map((v) => lg.node(v).order!).sort((a, b) => a - b);
      run.forEach((v, i) => (lg.node(v).order = slots[i]!));
    }
  }
}
