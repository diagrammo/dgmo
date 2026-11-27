// ============================================================
// sankey — the per-column node limit (#2462, owner's decision 2026-11-26)
// ============================================================
//
// A sankey column holds one bar and one name per node. Past
// MAX_SANKEY_NODES_PER_COLUMN the names cannot stack at the smallest readable
// size, so the parser keeps the first MAX_SANKEY_NODES_PER_COLUMN nodes of the
// column (first appearance), drops the links that reach the rest, and raises
// an error on the first dropped link. Not author-tunable: crowding is the
// renderer's decision (dgmo/CLAUDE.md → Output rules).
//
// The column a node lands in comes from `rankSankey`, which the renderer
// uses too, so the parser counts the same columns the renderer draws.

import type { DiagnosticSpec } from '../diagnostics';

/**
 * Most real nodes one sankey column draws. Chosen from the label stack, the
 * tallest thing in a column: at the smallest readable type
 * (MIN_READABLE_TYPE_PX, 11px) a name line is 13px and two names sit 1px
 * apart, so 50 names take 50 × 13 + 49 × 1 = 699px. A titled chart on the
 * default sheet (EXPORT_HEIGHT 800) has a 716px plot, so 50 is the most that
 * fit without the drawing growing. Nodes take 8px each at the floor
 * (SANKEY_MIN_NODE_H) plus a 2px gap, 498px, well inside the same plot.
 */
export const MAX_SANKEY_NODES_PER_COLUMN = 50;

export const SANKEY_DX = {
  TOO_MANY_NODES: {
    code: 'E_SANKEY_TOO_MANY_NODES',
    severity: 'error',
    chartType: 'sankey',
    title: 'Too many nodes in one column',
    message: (p) =>
      `This sankey has ${(p.count as number) ?? 'too many'} nodes in one column; only the first ${MAX_SANKEY_NODES_PER_COLUMN} are drawn. Group the small targets into one node, such as Other.`,
    hint: `Keep a sankey column to ${MAX_SANKEY_NODES_PER_COLUMN} nodes or fewer: add the small targets up into one node, such as Other, or split the chart.`,
    example: `sankey Traffic\n\nSearch -> Signup 120\nAds -> Signup 80\nAds -> Other 30`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const SANKEY_DIAGNOSTICS: DiagnosticSpec[] = Object.values(SANKEY_DX);

interface RankLink {
  source: string;
  target: string;
}

/**
 * Column of every node, and the links that close a loop. Authors write
 * cycles (an issue bouncing between two statuses twice), and longest-path
 * ranking never converges on one: each pass pushes the loop a column further
 * right (#1218). A DFS from the true sources marks each edge that closes a
 * loop; ranking ignores those, and the renderer draws them as return ribbons
 * under the chart.
 */
export function rankSankey<L extends RankLink>(
  links: readonly L[]
): { names: string[]; rank: Map<string, number>; back: Set<L> } {
  const names = Array.from(new Set(links.flatMap((l) => [l.source, l.target])));
  const outgoing = new Map<string, L[]>();
  for (const l of links) {
    const list = outgoing.get(l.source) ?? [];
    list.push(l);
    outgoing.set(l.source, list);
  }
  const back = new Set<L>();
  const visitState = new Map<string, 'open' | 'done'>();
  const visit = (name: string): void => {
    visitState.set(name, 'open');
    for (const l of outgoing.get(name) ?? []) {
      const st = visitState.get(l.target);
      if (st === 'open') back.add(l);
      else if (st === undefined) visit(l.target);
    }
    visitState.set(name, 'done');
  };
  const hasIncoming = new Set(links.map((l) => l.target));
  for (const name of names) if (!hasIncoming.has(name)) visit(name);
  // a component that is all cycle has no source; enter it at its first name
  for (const name of names) if (!visitState.has(name)) visit(name);

  const rank = new Map(names.map((n) => [n, 0]));
  const forward = links.filter((l) => !back.has(l));
  for (let pass = 0; pass < names.length; pass++) {
    let changed = false;
    for (const l of forward) {
      const s = rank.get(l.source)!;
      if (rank.get(l.target)! < s + 1) {
        rank.set(l.target, s + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { names, rank, back };
}

/**
 * Keep each column's first MAX_SANKEY_NODES_PER_COLUMN nodes (in order of
 * first appearance). Returns the kept links, the first dropped link and the
 * size of the largest column, or null when no column is over the limit.
 * Dropping links can move a node to another column, so this repeats until
 * every column fits.
 */
export function capSankeyColumns<L extends RankLink>(
  links: readonly L[]
): { kept: L[]; first: L; count: number } | null {
  let kept = [...links];
  let first: L | undefined;
  let count = 0;
  for (let round = 0; round < 8; round++) {
    const { names, rank } = rankSankey(kept);
    const perCol = new Map<number, string[]>();
    for (const n of names) {
      const r = rank.get(n)!;
      const col = perCol.get(r) ?? [];
      col.push(n);
      perCol.set(r, col);
    }
    const over = new Set<string>();
    for (const col of perCol.values()) {
      if (col.length <= MAX_SANKEY_NODES_PER_COLUMN) continue;
      if (first === undefined) count = Math.max(count, col.length);
      for (const n of col.slice(MAX_SANKEY_NODES_PER_COLUMN)) over.add(n);
    }
    if (over.size === 0) break;
    const drop = (l: L) => over.has(l.source) || over.has(l.target);
    first ??= kept.find(drop);
    kept = kept.filter((l) => !drop(l));
  }
  return first === undefined ? null : { kept, first, count };
}
