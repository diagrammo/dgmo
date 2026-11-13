// The grouped boxes-and-lines layout rubric (diagrammo/diagrammo#1975) as
// geometry checks. The rules, their ranking and the target pictures are on the
// ecosystem-docs mockup page `mockups/2026-11-13-grouped-layout-rubric`.
// Rule 8 (collapsing never changes text size) is the app's fit-to-pane scale
// and cannot be measured from a dgmo layout, so it has no check here.
import { parseBoxesAndLines } from '../../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../../src/boxes-and-lines/collapse';
import { layoutBoxesAndLines } from '../../src/boxes-and-lines/layout';
import type { BLLayoutResult } from '../../src/boxes-and-lines/layout';
import type { BLGroup } from '../../src/boxes-and-lines/types';

export type RuleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 10;
/** Rules a first engine pass must satisfy; the rest are reported only. */
export const BLOCKING: readonly RuleId[] = [1, 2, 3];
export const RULES: readonly RuleId[] = [1, 2, 3, 4, 5, 6, 7, 9, 10];

/** Natural frame padding the engine leaves around one box (measured
 *  2026-11-13: 30 each side, 35 top and bottom). Rule 6 allows that plus 5%. */
const PAD_X = 30;
const PAD_Y = 35;
const DETOUR = 1.3;
const SPREAD = 12;

interface Rect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}
const left = (r: Rect) => r.cx - r.w / 2;
const right = (r: Rect) => r.cx + r.w / 2;
const top = (r: Rect) => r.cy - r.h / 2;
const bottom = (r: Rect) => r.cy + r.h / 2;

export interface StateResult {
  state: string;
  failures: Map<RuleId, string[]>;
}

/** Lays out `src` with `collapsed` groups folded. Collapsed states use the
 *  interactive path: stable collapse from the expanded layout's positions. */
async function layoutState(
  src: string,
  collapsed: readonly string[],
  expanded?: BLLayoutResult
) {
  const parsed = parseBoxesAndLines(src);
  if (collapsed.length === 0) {
    return {
      layout: await layoutBoxesAndLines(parsed),
      groups: parsed.groups,
      direction: parsed.direction,
    };
  }
  const cr = collapseBoxesAndLines(parsed, new Set(collapsed));
  const prev = new Map(
    (expanded?.nodes ?? []).map((n) => [n.label, { x: n.x, y: n.y }])
  );
  const layout = await layoutBoxesAndLines(
    cr.parsed,
    {
      collapsedChildCounts: cr.collapsedChildCounts,
      originalGroups: cr.originalGroups,
    },
    { previousPositions: prev, stableCollapse: true }
  );
  return { layout, groups: cr.originalGroups, direction: parsed.direction };
}

class View {
  readonly rects = new Map<string, Rect>();
  readonly parentOf = new Map<string, string | undefined>();
  readonly groupOfNode = new Map<string, string>();
  readonly flowX: boolean;
  constructor(
    readonly layout: BLLayoutResult,
    groups: readonly BLGroup[],
    direction: string | undefined
  ) {
    this.flowX = direction !== 'TB';
    for (const n of layout.nodes)
      this.rects.set(n.label, { cx: n.x, cy: n.y, w: n.width, h: n.height });
    for (const g of layout.groups)
      this.rects.set('__group_' + g.label, {
        cx: g.x,
        cy: g.y,
        w: g.width,
        h: g.height,
      });
    for (const g of groups) {
      this.parentOf.set(g.label, g.parentGroup);
      for (const c of g.children) this.groupOfNode.set(c, g.label);
    }
  }
  groupOf(label: string): string | undefined {
    return label.startsWith('__group_')
      ? this.parentOf.get(label.slice(8))
      : this.groupOfNode.get(label);
  }
  /** Top-level unit: the outermost group, or the box itself. */
  unit(label: string): string {
    let g = label.startsWith('__group_') ? label.slice(8) : this.groupOf(label);
    if (g === undefined) return label;
    while (this.parentOf.get(g) !== undefined) g = this.parentOf.get(g)!;
    return '__group_' + g;
  }
  /** The group itself (for a group endpoint) and every group around it. */
  ancestors(label: string): Set<string> {
    const out = new Set<string>();
    let g = label.startsWith('__group_') ? label.slice(8) : this.groupOf(label);
    while (g !== undefined) {
      out.add(g);
      g = this.parentOf.get(g);
    }
    return out;
  }
  unitRect(u: string): Rect | undefined {
    return this.rects.get(u);
  }
  along(r: Rect) {
    return this.flowX ? r.cx : r.cy;
  }
  across(r: Rect) {
    return this.flowX ? r.cy : r.cx;
  }
  crossEdges() {
    return this.layout.edges.filter(
      (e) => this.unit(e.source) !== this.unit(e.target)
    );
  }
}

function segHitsRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  r: Rect
): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    if (
      x > left(r) + 2 &&
      x < right(r) - 2 &&
      y > top(r) + 2 &&
      y < bottom(r) - 2
    )
      return true;
  }
  return false;
}

function checkState(v: View, expanded?: View): Map<RuleId, string[]> {
  const f = new Map<RuleId, string[]>(RULES.map((r) => [r, []]));
  const fail = (r: RuleId, msg: string) => f.get(r)!.push(msg);
  const L = v.layout;
  const expandedGroups = L.groups.filter((g) => !g.collapsed);

  // 1 — flow order: a cross-unit target is never before its source.
  for (const e of v.crossEdges()) {
    const s = v.rects.get(e.source);
    const t = v.rects.get(e.target);
    if (s && t && v.along(t) < v.along(s) - 1)
      fail(1, `${e.source} → ${e.target} runs against the flow`);
  }

  // 2 — no arrow crosses a group it neither leaves nor enters.
  for (const e of L.edges) {
    const own = new Set([...v.ancestors(e.source), ...v.ancestors(e.target)]);
    for (const g of expandedGroups) {
      if (own.has(g.label)) continue;
      const r = v.rects.get('__group_' + g.label)!;
      const pts = e.points;
      for (let i = 1; i < pts.length; i++)
        if (segHitsRect(pts[i - 1]!, pts[i]!, r)) {
          fail(2, `${e.source} → ${e.target} crosses [${g.label}]`);
          break;
        }
    }
  }

  // 3 — collapse keeps every unit's order along both axes.
  if (expanded) {
    const units = [
      ...new Set([
        ...L.nodes.map((n) => v.unit(n.label)),
        ...L.groups.map((g) => v.unit('__group_' + g.label)),
      ]),
    ];
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++) {
        const [a, b] = [units[i]!, units[j]!];
        const [ca, cb] = [v.unitRect(a), v.unitRect(b)];
        const [ea, eb] = [expanded.unitRect(a), expanded.unitRect(b)];
        if (!ca || !cb || !ea || !eb) continue;
        // Two units have an order on an axis only when they were apart on it
        // before the collapse; a box above a group's frame is neither before
        // nor after it on x. Ordered pairs must keep their centre order.
        for (const ax of ['cx', 'cy'] as const) {
          const [lo, hi] = ax === 'cx' ? [left, right] : [top, bottom];
          const apart = hi(ea) <= lo(eb) || hi(eb) <= lo(ea);
          const before = ea[ax] - eb[ax];
          const after = ca[ax] - cb[ax];
          if (apart && Math.abs(after) > 1 && before * after < 0)
            fail(3, `${a} and ${b} swap order on ${ax === 'cx' ? 'x' : 'y'}`);
        }
      }
  }

  // 4 — unlinked members fill a near-square grid; linked ones face their link.
  const linked = new Set(L.edges.flatMap((e) => [e.source, e.target]));
  for (const g of expandedGroups) {
    const members = [...v.groupOfNode]
      .filter(([n, gl]) => gl === g.label && v.rects.has(n))
      .map(([n]) => n);
    const free = members.filter((n) => !linked.has(n));
    if (free.length >= 4) {
      const xs = new Set(free.map((n) => Math.round(v.rects.get(n)!.cx)));
      const ys = new Set(free.map((n) => Math.round(v.rects.get(n)!.cy)));
      const side = Math.ceil(Math.sqrt(free.length));
      if (Math.max(xs.size, ys.size) > side + 1)
        fail(4, `[${g.label}] unlinked boxes span ${xs.size}×${ys.size}`);
      else if (xs.size * ys.size - free.length > Math.min(xs.size, ys.size) - 1)
        fail(4, `[${g.label}] unlinked grid has holes`);
    }
    // Facing: an arrow between a member and a box outside the group never
    // runs through a sibling. An empty cell it runs through is a corridor,
    // which rule 4 allows.
    for (const e of L.edges) {
      const m = members.includes(e.source)
        ? e.source
        : members.includes(e.target)
          ? e.target
          : undefined;
      if (!m) continue;
      const o = m === e.source ? e.target : e.source;
      if (v.ancestors(o).has(g.label)) continue;
      const blocker = members.find(
        (n) =>
          n !== m &&
          e.points.some(
            (p, i) => i > 0 && segHitsRect(e.points[i - 1]!, p, v.rects.get(n)!)
          )
      );
      if (blocker) fail(4, `${m} → ${o} runs through ${blocker}`);
    }
  }

  // 5 — arrows between groups run straight (no detour past 1.3× the chord).
  for (const e of v.crossEdges()) {
    const p = e.points;
    if (p.length < 2) continue;
    let len = 0;
    for (let i = 1; i < p.length; i++)
      len += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
    const chord = Math.hypot(
      p[p.length - 1]!.x - p[0]!.x,
      p[p.length - 1]!.y - p[0]!.y
    );
    if (chord > 0 && len > DETOUR * chord)
      fail(5, `${e.source} → ${e.target} detours ${(len / chord).toFixed(1)}×`);
  }

  // 6 — a frame is no bigger than its contents plus the natural padding.
  for (const g of expandedGroups) {
    const fr = v.rects.get('__group_' + g.label)!;
    const inside = [...v.rects]
      .filter(
        ([k]) => k !== '__group_' + g.label && v.ancestors(k).has(g.label)
      )
      .map(([, r]) => r);
    if (inside.length === 0) continue;
    const w = Math.max(...inside.map(right)) - Math.min(...inside.map(left));
    const h = Math.max(...inside.map(bottom)) - Math.min(...inside.map(top));
    if (fr.w * fr.h > 1.05 * (w + 2 * PAD_X) * (h + 2 * PAD_Y))
      fail(
        6,
        `[${g.label}] frame is ${Math.round(fr.w)}×${Math.round(fr.h)} around ${Math.round(w)}×${Math.round(h)}`
      );
  }

  // 7 — every top-level group shares a frame edge with at least one other.
  const tops = expandedGroups.filter((g) => !v.parentOf.get(g.label));
  if (tops.length > 1)
    for (const g of tops) {
      const r = v.rects.get('__group_' + g.label)!;
      const lined = tops.some((o) => {
        if (o === g) return false;
        const q = v.rects.get('__group_' + o.label)!;
        return [
          [top(r), top(q)],
          [bottom(r), bottom(q)],
          [left(r), left(q)],
          [right(r), right(q)],
        ].some(([x, y]) => Math.abs(x! - y!) <= 1);
      });
      if (!lined) fail(7, `[${g.label}] lines up with no other group`);
    }

  // 9 — two groups linked both ways stack across the flow.
  const pairs = new Map<string, { ab: boolean; ba: boolean }>();
  for (const e of v.crossEdges()) {
    const [a, b] = [v.unit(e.source), v.unit(e.target)];
    if (!a.startsWith('__group_') || !b.startsWith('__group_')) continue;
    const key = [a, b].sort().join('|');
    const p = pairs.get(key) ?? { ab: false, ba: false };
    if (a < b) p.ab = true;
    else p.ba = true;
    pairs.set(key, p);
  }
  for (const [key, p] of pairs) {
    if (!(p.ab && p.ba)) continue;
    const [a, b] = key.split('|') as [string, string];
    const [ra, rb] = [v.unitRect(a)!, v.unitRect(b)!];
    const [lo, hi] = v.flowX
      ? [Math.max(left(ra), left(rb)), Math.min(right(ra), right(rb))]
      : [Math.max(top(ra), top(rb)), Math.min(bottom(ra), bottom(rb))];
    if (hi <= lo)
      fail(
        9,
        `[${a.slice(8)}] and [${b.slice(8)}] link both ways but sit along the flow`
      );
  }

  // 10 — endpoints meeting one box are spread along it.
  const ends = new Map<string, { x: number; y: number }[]>();
  for (const e of L.edges) {
    if (e.points.length < 2) continue;
    const push = (k: string, pt: { x: number; y: number }) =>
      ends.set(k, [...(ends.get(k) ?? []), pt]);
    push(e.source, e.points[0]!);
    push(e.target, e.points[e.points.length - 1]!);
  }
  for (const [box, pts] of ends) {
    let close = false;
    for (let i = 0; i < pts.length && !close; i++)
      for (let j = i + 1; j < pts.length; j++)
        if (Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y) < SPREAD) {
          close = true;
          break;
        }
    if (close) fail(10, `${box} has arrows meeting at one point`);
  }
  return f;
}

/** Checks one laid-out state. `expanded` (the same diagram before any
 *  collapse) turns on rule 3. Exported so a hand-drawn target can be checked. */
export function checkLayout(
  layout: BLLayoutResult,
  groups: readonly BLGroup[],
  direction: string | undefined,
  expanded?: { layout: BLLayoutResult; groups: readonly BLGroup[] }
): Map<RuleId, string[]> {
  return checkState(
    new View(layout, groups, direction),
    expanded && new View(expanded.layout, expanded.groups, direction)
  );
}

/** Every state of one fixture: expanded, then each listed collapse. */
export async function scoreFixture(
  src: string,
  collapses: readonly (readonly string[])[]
): Promise<StateResult[]> {
  const ex = await layoutState(src, []);
  const exView = new View(ex.layout, ex.groups, ex.direction);
  const out: StateResult[] = [
    { state: 'expanded', failures: checkState(exView) },
  ];
  for (const c of collapses) {
    const s = await layoutState(src, c, ex.layout);
    out.push({
      state: c.join('+') + ' collapsed',
      failures: checkState(new View(s.layout, s.groups, s.direction), exView),
    });
  }
  return out;
}
