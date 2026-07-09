// ============================================================
// Family Diagram — Couple-Rank core (union-find quotient DAG)
// ============================================================
//
// The load-bearing genealogy layout primitive, shared by the parser (ancestry
// cycle diagnostic) and the layout (generation ranking) so the ONE mechanism is
// both the cycle check AND the layout's acyclicity precondition.
//
// Algorithm (validated by elicitation after two unsound attempts — see the
// tech-spec "Layout model — history"):
//   1. union-find every union's parents into a marriage "class" (a lone parent /
//      unmarried person = a singleton class).
//   2. build a quotient graph over classes: for each union, an edge
//      parentClass → childClass for every child.
//   3. a CYCLE in the quotient (including a self-loop) IS the ancestry error — a
//      self-ancestor, marriage to a direct ancestor, or a parent-child union all
//      cycle it. Self-loops are RETAINED (never silently dropped) so the error is
//      never hidden and no node is left unrankable.
//   4. Row(class) = longest path to the class from any source (Kahn topo relax);
//      Row(person) = Row(class(person)). A married-in spouse shares its partner's
//      class → same row (no married-in-at-row-0 bug).
//
// A cousin marriage / pedigree collapse is a DAG DIAMOND (re-convergence), NOT a
// cycle — it must pass.

import type { FamilyPerson, FamilyUnion } from './types';

export interface CoupleQuotient {
  /** personId → class id (union-find root, remapped to a dense 0..N-1). */
  readonly classOf: ReadonlyMap<string, number>;
  /** class id → member person ids (declaration order). */
  readonly classMembers: ReadonlyMap<number, readonly string[]>;
  /** Deduped quotient edges parentClass → childClass (self-loops retained). */
  readonly edges: ReadonlyArray<readonly [number, number]>;
  /** True iff the quotient contains a cycle (including any self-loop). */
  readonly cycle: boolean;
}

/** Minimal union-find over string ids. */
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let root = x;
    while (this.parent.get(root)! !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = x;
    while (this.parent.get(cur)! !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
}

/**
 * Build the couple quotient. `persons` provides the full node set (so childless
 * singletons still get a class); `unions` drives the marriage classes + edges.
 */
export function buildCoupleQuotient(
  persons: ReadonlyMap<string, FamilyPerson>,
  unions: readonly FamilyUnion[]
): CoupleQuotient {
  const uf = new UnionFind();
  for (const id of persons.keys()) uf.add(id);
  // 1. Marriage classes: union all parents of each union.
  for (const u of unions) {
    for (const p of u.parents) uf.add(p);
    for (let i = 1; i < u.parents.length; i++) {
      uf.union(u.parents[0]!, u.parents[i]!);
    }
  }

  // Dense class ids in first-seen (person declaration) order.
  const rootToClass = new Map<string, number>();
  const classOf = new Map<string, number>();
  const classMembers = new Map<number, string[]>();
  const claim = (id: string): number => {
    const root = uf.find(id);
    let c = rootToClass.get(root);
    if (c === undefined) {
      c = rootToClass.size;
      rootToClass.set(root, c);
      classMembers.set(c, []);
    }
    classOf.set(id, c);
    classMembers.get(c)!.push(id);
    return c;
  };
  for (const id of persons.keys()) claim(id);
  // Cover any parent/child id not present in `persons` (defensive — parser
  // registers every referenced person, so this is normally a no-op).
  for (const u of unions) {
    for (const p of u.parents) if (!classOf.has(p)) claim(p);
    for (const c of u.children) if (!classOf.has(c.personId)) claim(c.personId);
  }

  // 2. Quotient edges parentClass → childClass (retain self-loops, dedupe).
  const edgeSet = new Set<string>();
  const edges: Array<readonly [number, number]> = [];
  for (const u of unions) {
    if (u.parents.length === 0) continue;
    const pc = classOf.get(u.parents[0]!)!;
    for (const child of u.children) {
      const cc = classOf.get(child.personId)!;
      const key = `${pc}\x00${cc}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push([pc, cc]);
    }
  }

  const cycle = hasCycle(rootToClass.size, edges);
  return { classOf, classMembers, edges, cycle };
}

/** DFS 3-color cycle detection over the quotient (self-loop ⇒ cycle). */
function hasCycle(
  n: number,
  edges: ReadonlyArray<readonly [number, number]>
): boolean {
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    if (a === b) return true; // self-loop
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  }
  const color = new Int8Array(n); // 0=white 1=gray 2=black
  const stack: Array<{ v: number; i: number }> = [];
  for (let s = 0; s < n; s++) {
    if (color[s] !== 0) continue;
    stack.push({ v: s, i: 0 });
    color[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const nbrs = adj.get(top.v) ?? [];
      if (top.i < nbrs.length) {
        const w = nbrs[top.i++]!;
        if (color[w] === 1) return true; // back-edge
        if (color[w] === 0) {
          color[w] = 1;
          stack.push({ v: w, i: 0 });
        }
      } else {
        color[top.v] = 2;
        stack.pop();
      }
    }
  }
  return false;
}

/**
 * Longest-path row per class over the (acyclic) quotient. Caller must ensure
 * `q.cycle === false`. `Row(class) = longest path from any source`.
 */
export function rankClasses(q: CoupleQuotient): Map<number, number> {
  const n = q.classMembers.size;
  const adj = new Map<number, number[]>();
  const indeg = new Array<number>(n).fill(0);
  for (const [a, b] of q.edges) {
    if (a === b) continue; // defensive: ignore self-loops (cycle already flagged)
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    indeg[b] = (indeg[b] ?? 0) + 1;
  }
  const row = new Map<number, number>();
  const queue: number[] = [];
  for (let c = 0; c < n; c++) {
    row.set(c, 0);
    if ((indeg[c] ?? 0) === 0) queue.push(c);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi]!;
    const ru = row.get(u)!;
    for (const w of adj.get(u) ?? []) {
      if (ru + 1 > (row.get(w) ?? 0)) row.set(w, ru + 1);
      const nd = (indeg[w] ?? 0) - 1;
      indeg[w] = nd;
      if (nd === 0) queue.push(w);
    }
  }
  return row;
}
