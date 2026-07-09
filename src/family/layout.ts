// ============================================================
// Family Diagram — Layout (bespoke COUPLE-RANK engine)
// ============================================================
//
// NOT d3-hierarchy (single-parent) and NOT dagre (won't keep spouses adjacent
// with a marriage bar). See `couple-rank.ts` for the union-find quotient that
// makes both spouses share a class → the SAME generation row, so marriage bars
// stay horizontal and a married-in spouse is never stranded at row 0.
//
// Pipeline: build quotient → rank classes (longest path) → person row =
// class row → order within each row (discovery order keeps spouses/families
// adjacent — `orderRow`, isolated behind its own boundary so a future
// crossing-minimizer drops in) → assign x/y → emit cards, horizontal marriage
// bars, and children buses (org bus-edge pattern: trunk + bar + per-child drops).

import { measureText } from '../utils/text-measure';
import {
  HEADER_HEIGHT,
  LABEL_FONT_SIZE,
  META_FONT_SIZE,
  META_LINE_HEIGHT,
  SEPARATOR_GAP,
} from '../utils/visual-conventions';
import { buildCoupleQuotient, rankClasses } from './couple-rank';
import { familyCardRows } from './card-model';
import type {
  ParsedFamily,
  FamilyPerson,
  FamilyUnion,
  FamilyLayoutNode,
  FamilyLayoutResult,
  FamilyMarriageBar,
  FamilyChildEdge,
} from './types';

const MARGIN = 30;
const MIN_CARD_W = 132;
const CARD_H_PAD = 12; // bottom padding below the last meta row
const CARD_TEXT_PAD = 12; // horizontal text inset (each side)
const H_GAP = 60; // horizontal gap between adjacent cards (room for the `m. YYYY` bar label)
const ROW_GAP = 74; // vertical gap between generation rows (room for the bus)
const KEY_VALUE_GAP = 6;
const KEY_X = 10; // left inset of the key column (MUST match the renderer)

interface CardSize {
  width: number;
  height: number;
}

// Card width MUST mirror the renderer's row geometry exactly: labeled rows put
// their VALUE at a shared column `KEY_X + maxKeyWidth + KEY_VALUE_GAP` (aligned
// to the WIDEST key), not each row's own key width. Sizing per-row-key
// under-measured rows with a short key + long value, so those values overflowed
// the card's right edge (the "text outside the node" bug).
function cardSize(p: FamilyPerson): CardSize {
  const rows = familyCardRows(p);
  const labeled = rows.filter((r) => !r.year);
  const maxKeyW = labeled.length
    ? Math.max(...labeled.map((r) => measureText(`${r.key}: `, META_FONT_SIZE)))
    : 0;
  const valueX = KEY_X + maxKeyW + KEY_VALUE_GAP;
  let contentRight = 0;
  for (const r of rows) {
    const right = r.year
      ? KEY_X + measureText(r.value, META_FONT_SIZE)
      : valueX + measureText(r.value, META_FONT_SIZE);
    contentRight = Math.max(contentRight, right);
  }
  const labelW = measureText(p.label, LABEL_FONT_SIZE);
  const width = Math.max(
    MIN_CARD_W,
    labelW + CARD_TEXT_PAD * 2,
    contentRight + CARD_TEXT_PAD
  );
  const height =
    rows.length > 0
      ? HEADER_HEIGHT +
        SEPARATOR_GAP +
        rows.length * META_LINE_HEIGHT +
        CARD_H_PAD
      : HEADER_HEIGHT + CARD_H_PAD;
  return { width, height };
}

/**
 * Order persons within each row. Discovery order: DFS from each union's first
 * parent in declaration order, visiting spouses immediately (so union-mates land
 * adjacent) then descending into children. Isolated behind its own boundary so a
 * crossing-minimizer can replace it without touching rank/bar/bus geometry.
 */
function orderRow(
  persons: ReadonlyMap<string, FamilyPerson>,
  parentUnions: ReadonlyMap<string, string[]>, // personId → union ids they parent
  unionParents: ReadonlyMap<string, string[]>,
  unionChildren: ReadonlyMap<string, string[]>,
  unionOrder: readonly string[]
): Map<string, number> {
  const disco = new Map<string, number>();
  let seq = 0;
  const visit = (id: string): void => {
    if (disco.has(id)) return;
    disco.set(id, seq++);
    for (const uid of parentUnions.get(id) ?? []) {
      for (const sp of unionParents.get(uid) ?? []) visit(sp);
      for (const ch of unionChildren.get(uid) ?? []) visit(ch);
    }
  };
  for (const uid of unionOrder) {
    for (const p of unionParents.get(uid) ?? []) visit(p);
  }
  // Any persons not reached by union traversal (isolated) in declaration order.
  for (const id of persons.keys()) visit(id);
  return disco;
}

/**
 * Order one row so spouse pairs stay adjacent and a remarried HUB sits BETWEEN
 * its spouses. Persons in a row form components via spouse edges; each component
 * is laid out as a path (a degree-2 hub lands in the middle → spouse-hub-spouse).
 * Components (and singletons: children, unmarried people) are ordered by their
 * minimum discovery index, so overall left→right order still tracks declaration.
 */
function orderRowSpouses(
  ids: string[],
  spouseAdj: ReadonlyMap<string, Set<string>>,
  discoOf: (id: string) => number
): string[] {
  const inRow = new Set(ids);
  const nbrs = (id: string): string[] =>
    [...(spouseAdj.get(id) ?? [])].filter((n) => inRow.has(n));
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const seed of [...ids].sort((a, b) => discoOf(a) - discoOf(b))) {
    if (visited.has(seed)) continue;
    // Collect the connected component (spouse graph).
    const comp: string[] = [];
    const stack = [seed];
    visited.add(seed);
    while (stack.length) {
      const v = stack.pop()!;
      comp.push(v);
      for (const w of nbrs(v))
        if (!visited.has(w)) {
          visited.add(w);
          stack.push(w);
        }
    }
    if (comp.length === 1) {
      components.push(comp);
      continue;
    }
    // Walk the component as a path from an endpoint (degree ≤ 1) with the
    // smallest discovery index, so a hub (degree 2) becomes the middle.
    const start =
      comp
        .filter((id) => nbrs(id).length <= 1)
        .sort((a, b) => discoOf(a) - discoOf(b))[0] ??
      comp.slice().sort((a, b) => discoOf(a) - discoOf(b))[0]!;
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      cur = nbrs(cur)
        .filter((n) => !seen.has(n))
        .sort((a, b) => discoOf(a) - discoOf(b))[0];
    }
    // Any unwalked members (degree > 2 hubs) appended by discovery order.
    for (const id of comp) if (!seen.has(id)) path.push(id);
    components.push(path);
  }
  components.sort(
    (x, y) => Math.min(...x.map(discoOf)) - Math.min(...y.map(discoOf))
  );
  return components.flat();
}

/**
 * Focus on one person: keep the person + ALL their DESCENDANTS (and the spouses
 * of everyone in that subtree, so couples render), and return the focused
 * person's direct PARENTS separately — the renderer draws them as small dots
 * above the focused card (the org ancestor-trail analog). Ancestors above the
 * parents are dropped. Returns the full family if `focusId` is unknown.
 */
export function focusFamily(
  parsed: ParsedFamily,
  focusId: string
): {
  persons: ReadonlyMap<string, FamilyPerson>;
  unions: readonly FamilyUnion[];
  parents: readonly FamilyPerson[];
} {
  if (!parsed.persons.has(focusId)) {
    return { persons: parsed.persons, unions: parsed.unions, parents: [] };
  }
  const childOf = new Map<string, string[]>(); // person → union ids they are a child of
  const parentOf = new Map<string, string[]>(); // person → union ids they parent
  const unionById = new Map(parsed.unions.map((u) => [u.id, u]));
  for (const u of parsed.unions) {
    for (const p of u.parents)
      (parentOf.get(p) ?? parentOf.set(p, []).get(p)!).push(u.id);
    for (const c of u.children)
      (
        childOf.get(c.personId) ?? childOf.set(c.personId, []).get(c.personId)!
      ).push(u.id);
  }
  const visible = new Set<string>([focusId]);
  // Descendants: down through the unions a person parents.
  const down = [focusId];
  while (down.length) {
    const id = down.pop()!;
    for (const uid of parentOf.get(id) ?? [])
      for (const c of unionById.get(uid)!.children)
        if (!visible.has(c.personId)) {
          visible.add(c.personId);
          down.push(c.personId);
        }
  }
  // Spouses of everyone in the subtree (so couples render as couples).
  for (const id of [...visible])
    for (const uid of parentOf.get(id) ?? [])
      for (const p of unionById.get(uid)!.parents) visible.add(p);

  // Focused person's direct parents → collapsed ancestor dots (not full cards).
  const parentIds = new Set<string>();
  for (const uid of childOf.get(focusId) ?? [])
    for (const p of unionById.get(uid)!.parents) parentIds.add(p);
  const parents: FamilyPerson[] = [...parentIds]
    .map((id) => parsed.persons.get(id))
    .filter((p): p is FamilyPerson => p !== undefined);

  const persons = new Map<string, FamilyPerson>();
  for (const [id, p] of parsed.persons) if (visible.has(id)) persons.set(id, p);
  const unions = parsed.unions
    .filter((u) => u.parents.every((p) => visible.has(p)))
    .map((u) => ({
      ...u,
      children: u.children.filter((c) => visible.has(c.personId)),
    }));
  return { persons, unions, parents };
}

export function layoutFamily(
  parsed: ParsedFamily,
  focusId?: string | null
): FamilyLayoutResult {
  const focused = focusId ? focusFamily(parsed, focusId) : null;
  const persons = focused ? focused.persons : parsed.persons;
  const unions = focused ? focused.unions : parsed.unions;
  const focusParents = focused ? focused.parents : [];
  const ANCESTOR_BAND = focusParents.length > 0 ? 48 : 0;

  const quotient = buildCoupleQuotient(persons, unions);
  const classRow = quotient.cycle
    ? new Map<number, number>() // defensive: renderer bails before here on cycle
    : rankClasses(quotient);
  const rowOf = (id: string): number => {
    const c = quotient.classOf.get(id);
    return c === undefined ? 0 : (classRow.get(c) ?? 0);
  };

  // Union relation maps (for ordering + bus edges).
  const parentUnions = new Map<string, string[]>();
  const unionParents = new Map<string, string[]>();
  const unionChildren = new Map<string, string[]>();
  const unionOrder: string[] = [];
  for (const u of unions) {
    unionOrder.push(u.id);
    unionParents.set(u.id, [...u.parents]);
    unionChildren.set(
      u.id,
      u.children.map((c) => c.personId)
    );
    for (const p of u.parents) {
      (parentUnions.get(p) ?? parentUnions.set(p, []).get(p)!).push(u.id);
    }
  }

  const disco = orderRow(
    persons,
    parentUnions,
    unionParents,
    unionChildren,
    unionOrder
  );

  // Bucket persons per row, ordered by discovery index.
  const sizes = new Map<string, CardSize>();
  for (const [id, p] of persons) sizes.set(id, cardSize(p));

  const rowPersons = new Map<number, string[]>();
  let maxRow = 0;
  for (const id of persons.keys()) {
    const r = rowOf(id);
    maxRow = Math.max(maxRow, r);
    (rowPersons.get(r) ?? rowPersons.set(r, []).get(r)!).push(id);
  }
  // Spouse adjacency (both parents of a 2-parent union). A remarried person is a
  // HUB linking several spouses; ordering must keep it flanked by them so a
  // marriage bar never spans over a third card.
  const spouseAdj = new Map<string, Set<string>>();
  for (const u of unions) {
    if (u.parents.length !== 2) continue;
    const [a, b] = u.parents as [string, string];
    (spouseAdj.get(a) ?? spouseAdj.set(a, new Set()).get(a)!).add(b);
    (spouseAdj.get(b) ?? spouseAdj.set(b, new Set()).get(b)!).add(a);
  }
  const discoOf = (id: string): number => disco.get(id) ?? 0;
  for (const [r, arr] of rowPersons) {
    rowPersons.set(r, orderRowSpouses(arr, spouseAdj, discoOf));
  }

  // Row heights + y positions.
  const rowHeight = new Map<number, number>();
  for (let r = 0; r <= maxRow; r++) {
    let h = 0;
    for (const id of rowPersons.get(r) ?? [])
      h = Math.max(h, sizes.get(id)!.height);
    rowHeight.set(r, h);
  }
  const rowY = new Map<number, number>();
  {
    let acc = MARGIN + ANCESTOR_BAND;
    for (let r = 0; r <= maxRow; r++) {
      rowY.set(r, acc);
      acc += (rowHeight.get(r) ?? 0) + ROW_GAP;
    }
  }

  // ── X positions: bottom-up couple-over-children ─────────────
  // Each union's children form a block; the union's PARENTS are centered over
  // that block (spread apart if needed) so every child sits on a straight
  // vertical line under its parents' marriage bar — no zig-zag. Processed
  // bottom-up so a child's position is fixed before its parents are placed;
  // ancestors fan out to sit above their descendants. Order-preserving.
  const centerX = new Map<string, number>();
  for (let r = 0; r <= maxRow; r++) {
    let acc = 0;
    for (const id of rowPersons.get(r) ?? []) {
      const w = sizes.get(id)!.width;
      centerX.set(id, acc + w / 2);
      acc += w + H_GAP;
    }
  }

  // Place a row at its desired centers, left→right, enforcing order + min gap.
  const resolveRow = (ids: string[], desired: Map<string, number>): void => {
    let prevRight = -Infinity;
    for (const id of ids) {
      const half = sizes.get(id)!.width / 2;
      let c = desired.get(id) ?? centerX.get(id)!;
      const minC = prevRight + H_GAP + half;
      if (c < minC) c = minC;
      centerX.set(id, c);
      prevRight = c + half;
    }
  };

  // Geometric center of a union's children block (min..max of child centers).
  const childrenBlockCenter = (uid: string): number | undefined => {
    const cs = (unionChildren.get(uid) ?? [])
      .filter((c) => centerX.has(c))
      .map((c) => centerX.get(c)!);
    if (cs.length === 0) return undefined;
    return (Math.min(...cs) + Math.max(...cs)) / 2;
  };

  const rowOfPerson = new Map<string, number>();
  for (let r = 0; r <= maxRow; r++)
    for (const id of rowPersons.get(r) ?? []) rowOfPerson.set(id, r);

  for (let iter = 0; iter < 4; iter++) {
    for (let r = maxRow - 1; r >= 0; r--) {
      const desiredParts = new Map<string, number[]>();
      const add = (id: string, x: number): void => {
        (desiredParts.get(id) ?? desiredParts.set(id, []).get(id)!).push(x);
      };
      for (const u of unions) {
        const onRow = u.parents.filter((p) => rowOfPerson.get(p) === r);
        if (onRow.length === 0) continue;
        const cc = childrenBlockCenter(u.id);
        if (cc === undefined) continue; // childless union imposes no constraint
        if (onRow.length === 2) {
          // Straddle the children-block center so the bar midpoint is over it.
          const lr = [...onRow].sort(
            (a, b) => centerX.get(a)! - centerX.get(b)!
          );
          const [l, rr] = lr as [string, string];
          const d = sizes.get(l)!.width / 2 + H_GAP + sizes.get(rr)!.width / 2;
          add(l, cc - d / 2);
          add(rr, cc + d / 2);
        } else {
          for (const p of onRow) add(p, cc); // single parent centers on it
        }
      }
      const desired = new Map<string, number>();
      for (const [id, xs] of desiredParts)
        desired.set(id, xs.reduce((a, b) => a + b, 0) / xs.length);
      resolveRow(rowPersons.get(r) ?? [], desired);
    }
  }

  // Top-down finish: now that ancestors are spread, place each union's children
  // as a BLOCK centered exactly under its bar midpoint — so a single child lands
  // on a straight vertical line under the couple (the packed-at-left-margin case
  // that bottom-up alone couldn't center).
  const unionMid = (u: (typeof unions)[number]): number => {
    const ps = u.parents.filter((p) => centerX.has(p));
    return ps.reduce((s, p) => s + centerX.get(p)!, 0) / ps.length;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 1; r <= maxRow; r++) {
      const desired = new Map<string, number>();
      for (const u of unions) {
        const kids = u.children
          .map((c) => c.personId)
          .filter((id) => rowOfPerson.get(id) === r && centerX.has(id))
          .sort((a, b) => centerX.get(a)! - centerX.get(b)!);
        if (kids.length === 0 || u.parents.every((p) => !centerX.has(p)))
          continue;
        const blockW =
          kids.reduce((s, id) => s + sizes.get(id)!.width, 0) +
          H_GAP * (kids.length - 1);
        let left = unionMid(u) - blockW / 2;
        for (const id of kids) {
          const w = sizes.get(id)!.width;
          desired.set(id, left + w / 2);
          left += w + H_GAP;
        }
      }
      resolveRow(rowPersons.get(r) ?? [], desired);
    }
  }

  // Global shift so the leftmost card sits at MARGIN.
  let minLeft = Infinity;
  for (const id of persons.keys())
    minLeft = Math.min(minLeft, centerX.get(id)! - sizes.get(id)!.width / 2);
  const dx = Number.isFinite(minLeft) ? MARGIN - minLeft : MARGIN;

  const nodes: FamilyLayoutNode[] = [];
  const topY = new Map<string, number>();
  const bottomY = new Map<string, number>();
  for (let r = 0; r <= maxRow; r++) {
    for (const id of rowPersons.get(r) ?? []) {
      const p = persons.get(id)!;
      const s = sizes.get(id)!;
      const x = centerX.get(id)! - s.width / 2 + dx;
      const y = rowY.get(r)!;
      centerX.set(id, x + s.width / 2); // absolute (shifted) for bar/bus math
      topY.set(id, y);
      bottomY.set(id, y + s.height);
      nodes.push({
        id: p.id,
        label: p.label,
        sex: p.sex,
        metadata: p.metadata,
        ...(p.color !== undefined && { color: p.color }),
        tagMetadata: p.tagMetadata,
        x,
        y,
        width: s.width,
        height: s.height,
        row: r,
        lineNumber: p.lineNumber,
      });
    }
  }
  let contentRightEdge = 0;
  for (const n of nodes)
    contentRightEdge = Math.max(contentRightEdge, n.x + n.width);

  // Marriage bars (2-parent unions on a shared row).
  const bars: FamilyMarriageBar[] = [];
  for (const u of unions) {
    if (u.parents.length !== 2) continue;
    const [a, b] = u.parents;
    if (!centerX.has(a!) || !centerX.has(b!)) continue;
    // Vertical midpoint across BOTH spouse cards (heights can differ with
    // different meta-row counts, though both are top-aligned on the row).
    const ay =
      ((topY.get(a!)! + bottomY.get(a!)!) / 2 +
        (topY.get(b!)! + bottomY.get(b!)!) / 2) /
      2;
    const ax = centerX.get(a!)!;
    const bx = centerX.get(b!)!;
    const x1 = Math.min(ax, bx);
    const x2 = Math.max(ax, bx);
    bars.push({
      unionId: u.id,
      x1,
      x2,
      y: ay,
      midX: (x1 + x2) / 2,
      ...(u.metadata['m'] !== undefined && { year: u.metadata['m'] }),
      lineNumber: u.lineNumber,
    });
  }
  const barByUnion = new Map(bars.map((bar) => [bar.unionId, bar]));

  // Children buses (org bus-edge pattern).
  const edges: FamilyChildEdge[] = [];
  for (const u of unions) {
    if (u.children.length === 0) continue;
    // Anchor: marriage-bar midpoint (2 parents) or single parent bottom-center.
    let anchorX: number;
    let anchorY: number;
    const bar = barByUnion.get(u.id);
    if (bar) {
      anchorX = bar.midX;
      anchorY = bar.y;
    } else {
      const p = u.parents[0];
      if (p === undefined || !centerX.has(p)) continue;
      anchorX = centerX.get(p)!;
      anchorY = bottomY.get(p)!;
    }
    const kids = u.children.filter((c) => centerX.has(c.personId));
    if (kids.length === 0) continue;
    const childTop = Math.min(...kids.map((c) => topY.get(c.personId)!));
    // The horizontal distribution bar must sit in the ROW GAP — below the
    // BOTTOM of the deepest parent card — not at the marriage-bar height (which
    // is inside tall cards). Otherwise the bus runs behind a parent node.
    const parentsBottom = Math.max(
      ...u.parents.filter((p) => bottomY.has(p)).map((p) => bottomY.get(p)!)
    );
    const midY = (parentsBottom + childTop) / 2;
    for (const c of kids) {
      const cx = centerX.get(c.personId)!;
      const cTop = topY.get(c.personId)!;
      edges.push({
        unionId: u.id,
        childId: c.personId,
        points: [
          { x: anchorX, y: anchorY },
          { x: anchorX, y: midY },
          { x: cx, y: midY },
          { x: cx, y: cTop },
        ],
        adopted: c.adopted,
      });
    }
  }

  // Ancestor dots: the focused person's parents, spaced above their card.
  const ancestors: {
    label: string;
    sex: FamilyPerson['sex'];
    color?: string;
    x: number;
    y: number;
  }[] = [];
  let focusAnchor: { x: number; y: number } | undefined;
  if (focusId && focusParents.length > 0 && centerX.has(focusId)) {
    const fx = centerX.get(focusId)!;
    const fTop = topY.get(focusId)!;
    focusAnchor = { x: fx, y: fTop };
    const DOT_GAP = 26;
    const n = focusParents.length;
    const dy = MARGIN + ANCESTOR_BAND / 2;
    focusParents.forEach((p, i) => {
      ancestors.push({
        label: p.label,
        sex: p.sex,
        ...(p.color !== undefined && { color: p.color }),
        x: fx + (i - (n - 1) / 2) * DOT_GAP,
        y: dy,
      });
    });
  }

  const width = contentRightEdge + MARGIN;
  const lastR = maxRow;
  const height =
    (rowY.get(lastR) ?? MARGIN) + (rowHeight.get(lastR) ?? 0) + MARGIN;

  return {
    nodes,
    bars,
    edges,
    ancestors,
    ...(focusAnchor !== undefined && { focusAnchor }),
    width,
    height,
  };
}
