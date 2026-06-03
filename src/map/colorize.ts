// Political fill-assignment pass (§24B colorize). PURE + DETERMINISTIC — no
// projection, no palette, no DOM. Given the per-topology arc-adjacency graph
// (from geo.ts buildAdjacency), assign every drawn region a colour INDEX such
// that no two arc-neighbours share one. The only job of a political fill is
// boundary disambiguation; "no two neighbours share a hue" is the minimal
// property — and a planar political map famously needs only a handful of colours.
//
// FIRST-FIT greedy: each region takes the LOWEST index not used by an
// already-coloured neighbour. This is collision-free by construction (a node with
// k coloured neighbours has at most k forbidden indices, so index ≤ k is always
// free) AND clusters regions into the FEWEST colours — on the shipped graphs the
// max index used is 5 (world) / 4 (us-states), i.e. 5–6 colours total. The caller
// generates exactly that many palette tints, so the fills stay on-palette (no
// need for the old Δ+1 ≈ 17 wheel hues).

/** Result of {@link assignColors}: a colour INDEX per ISO + the number of
 *  distinct colours actually used (`= maxIndex + 1`). The index is a stable
 *  function of (ISO, global arc-adjacency) — extent-independent (AC10). */
export interface ColorAssignment {
  readonly byIso: Map<string, number>;
  readonly huesNeeded: number;
}

/** First-fit greedy graph-coloring over `isos` using `adjacency` (ISO → neighbour
 *  ISOs). Visits ISOs in stable ascending order; each takes the lowest index not
 *  taken by an already-coloured neighbour — collision-free, and minimises the
 *  total colour count.
 *
 *  EVERY iso in `isos` is assigned an index — including zero-degree nodes
 *  (islands, DC, territories with no neighbour entry) — so the caller never needs
 *  a fallback fill (F14). */
export function assignColors(
  isos: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>
): ColorAssignment {
  const sorted = [...isos].sort();
  const byIso = new Map<string, number>();
  let maxIndex = -1;

  for (const iso of sorted) {
    const taken = new Set<number>();
    for (const n of adjacency.get(iso) ?? []) {
      const c = byIso.get(n);
      if (c !== undefined) taken.add(c);
    }
    // Lowest index not taken by a neighbour (always exists: ≤ neighbour count).
    let h = 0;
    while (taken.has(h)) h++;
    byIso.set(iso, h);
    if (h > maxIndex) maxIndex = h;
  }

  return { byIso, huesNeeded: maxIndex + 1 };
}
