// ============================================================
// Sketch diagram — Layout (spec §31.3)
// ============================================================
//
// Deliberately dumb by design: authored `at:` positions are truth, missing
// positions flow-place in rows below existing content (reading order), and
// hand-authored overlap auto-resolves to the nearest free slot with
// W_SKETCH_OVERLAP_RESOLVED. Never reject, never render broken.
//
// Pipeline: collapse (Pattern B) → box-local child layout → root placement
// (positioned first, then flow) → overlap resolution → px mapping.

import type { DgmoError } from '../diagnostics';
import { makeDgmoError } from '../diagnostics';
import { SKETCH_DIAGNOSTIC_CODES } from './diagnostics';
import {
  SKETCH_FOOT_H,
  SKETCH_FOOT_W,
  SKETCH_GEOMETRY,
  SKETCH_HALF_SLOT_X,
  SKETCH_HALF_SLOT_Y,
  SKETCH_SEP,
  SKETCH_SLOT_X,
  SKETCH_SLOT_Y,
} from './geometry';
import { collapseSketch } from './collapse';
import type {
  ParsedSketch,
  SketchBox,
  SketchEdge,
  SketchNode,
  SketchShapeKind,
} from './types';

export interface SketchLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly shape: SketchShapeKind;
  readonly metadata: Record<string, string>;
  readonly description?: string;
  readonly boxLabel?: string;
  readonly lineNumber: number;
  /** resolved ABSOLUTE half-slot origin */
  readonly slot: { c: number; r: number };
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** set when this card is a folded box (draws the collapse-bar) */
  readonly isCollapsedBox?: boolean;
  readonly childCount?: number;
}

export interface SketchLayoutBox {
  readonly id: string;
  readonly label: string;
  readonly metadata: Record<string, string>;
  readonly lineNumber: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly bandH: number;
}

export interface SketchLayout {
  readonly nodes: readonly SketchLayoutNode[];
  readonly boxes: readonly SketchLayoutBox[];
  readonly edges: readonly SketchEdge[];
  readonly width: number;
  readonly height: number;
  /** layout-time warnings (overlap auto-resolution) */
  readonly diagnostics: readonly DgmoError[];
  /**
   * Half-slot origin actually subtracted to map slots → px. With
   * `normalizeOrigin` on this is the live min corner; with it off (frozen
   * origin) callers capture this on first layout and feed it back as
   * `frozenOrigin` so later edits don't re-shift the whole diagram.
   */
  readonly origin: { c: number; r: number };
}

export interface SketchLayoutOptions {
  /** Box labels to fold; defaults to the authored `collapsed` flags. */
  readonly collapsedBoxes?: ReadonlySet<string>;
  /**
   * Auto-layout stage switches. Every flag defaults to `true` (current
   * behavior) when omitted — turning one off makes the authored `at:`
   * coordinate more authoritative. Wired to the app's dev "Auto-layout"
   * drawer so a drag can be observed with each stage on or off.
   */
  readonly autoLayout?: SketchAutoLayoutFlags;
  /**
   * Stable origin (half-slots) to subtract when `normalizeOrigin` is off.
   * Never lets content go negative: the effective origin is
   * `min(frozenOrigin, liveMin)`, so a node dragged left of the frozen corner
   * simply expands it rather than escaping the viewport. Ignored when
   * `normalizeOrigin` is on. See `SketchLayout.origin`.
   */
  readonly frozenOrigin?: { c: number; r: number };
}

export interface SketchAutoLayoutFlags {
  /**
   * M1 — re-anchor the whole diagram to the min corner every render.
   * Off (the default) is the WYSIWYG frozen-origin behaviour; without a
   * `frozenOrigin` it still anchors to the live min, so stateless callers
   * render identically either way.
   */
  readonly normalizeOrigin?: boolean;
  /**
   * M2 — order root placement by declaration line. Off (the default) is
   * geometry-stable: authored-`at` units place in coordinate order
   * (row-major), flow units in reading order after them.
   */
  readonly sortRootsBySource?: boolean;
  /** M3 — bump a colliding authored slot to the nearest free slot. */
  readonly resolveOverlap?: boolean;
  /** M3 — treat a group as one collision rectangle (else its origin cell). */
  readonly groupCollisionAsRect?: boolean;
  /** Flow-place nodes that have no `at:` (root + box children). */
  readonly flowPlaceUnpositioned?: boolean;
  /**
   * M5 — nudge a FLOW-PLACED shape off any non-incident edge it crosses.
   * Authored-`at` shapes are always exempt: authored position wins over edge
   * aesthetics.
   */
  readonly avoidEdges?: boolean;
}

interface ResolvedAutoFlags {
  normalizeOrigin: boolean;
  sortRootsBySource: boolean;
  resolveOverlap: boolean;
  groupCollisionAsRect: boolean;
  flowPlaceUnpositioned: boolean;
  avoidEdges: boolean;
}

/**
 * The one set of defaults every caller shares — the WYSIWYG behaviour the
 * editor ships (frozen origin, geometry-stable root order). The app's dev
 * drawer reads this rather than keeping its own copy, so the two cannot
 * drift apart again (issue #174).
 */
export const SKETCH_AUTO_LAYOUT_DEFAULTS: Required<SketchAutoLayoutFlags> = {
  normalizeOrigin: false,
  sortRootsBySource: false,
  resolveOverlap: true,
  groupCollisionAsRect: true,
  flowPlaceUnpositioned: true,
  avoidEdges: true,
};

function resolveAutoFlags(f: SketchAutoLayoutFlags = {}): ResolvedAutoFlags {
  const d = SKETCH_AUTO_LAYOUT_DEFAULTS;
  return {
    normalizeOrigin: f.normalizeOrigin ?? d.normalizeOrigin,
    sortRootsBySource: f.sortRootsBySource ?? d.sortRootsBySource,
    resolveOverlap: f.resolveOverlap ?? d.resolveOverlap,
    groupCollisionAsRect: f.groupCollisionAsRect ?? d.groupCollisionAsRect,
    flowPlaceUnpositioned: f.flowPlaceUnpositioned ?? d.flowPlaceUnpositioned,
    avoidEdges: f.avoidEdges ?? d.avoidEdges,
  };
}

// ── Slot-rect collision helpers (float half-slot units) ──────

interface SlotRect {
  c: number;
  r: number;
  w: number;
  h: number;
}

function unitRect(c: number, r: number): SlotRect {
  return { c, r, w: SKETCH_SEP, h: SKETCH_SEP };
}

/** An inner box placed inside its parent's local slot space (decision #58). */
interface LocalChildBox {
  boxId: string;
  c: number;
  r: number;
  /** the rect it occupies, frame included, in half-slots */
  rect: SlotRect;
}

/**
 * `at:` of each inner box, keyed by box id — filled before any parent is laid
 * out. A side-table rather than a parameter because `layoutChildren` already
 * takes five arguments and this is read only for nested boxes.
 */
const childBoxAt = new Map<string, { c: number; r: number } | null>();

/**
 * The first free slot on the Manhattan ring `d` around `base`, or null.
 *
 * Order is fixed and matters: prefer down-and-right, then right-and-up, then
 * down-and-left, then up-and-left; within one of those quadrants, ascending
 * row and then ascending column. Enumerating the ring row by row already
 * yields ascending (r, c), so four passes — one per quadrant — produce that
 * order without building a candidate array and sorting it. That array was
 * allocated and sorted once per ring per unit, which is what made a crowded
 * scene superlinear beyond the collision index (#484).
 */
function firstFreeOnRing(
  base: SlotRect,
  occupied: Occupancy,
  d: number
): { c: number; r: number } | null {
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    for (let dr = -d; dr <= d; dr++) {
      const r = base.r + dr;
      const spread = d - Math.abs(dr);
      // Ascending column: the left arm of the ring, then the right one.
      for (const c of spread === 0
        ? [base.c]
        : [base.c - spread, base.c + spread]) {
        const cost = (r < base.r ? 2 : 0) + (c < base.c ? 1 : 0);
        if (cost !== quadrant) continue;
        if (!occupied.hits({ ...base, c, r })) return { c, r };
      }
    }
  }
  return null;
}

/**
 * `nearestFree` for a unit of arbitrary size. The shape-sized version searches
 * from a SEP-square; an inner box's frame can be many slots across, so its
 * collision test has to use its own width and height.
 */
function nearestFreeRect(
  base: SlotRect,
  occupied: Occupancy
): { c: number; r: number } {
  if (!occupied.hits(base)) return { c: base.c, r: base.r };
  const key = `${base.c},${base.r},${base.w},${base.h}`;
  for (let d = occupied.ringStart.get(key) ?? 1; d <= 200; d++) {
    const found = firstFreeOnRing(base, occupied, d);
    if (found) {
      occupied.ringStart.set(key, d);
      return found;
    }
  }
  return { c: base.c, r: base.r };
}

function rectsOverlap(a: SlotRect, b: SlotRect): boolean {
  return (
    a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h
  );
}

/**
 * The rects placed so far, indexed so that a collision test does not walk all
 * of them.
 *
 * Placement asks "does this hit anything already down?" once per unit, and
 * `nearestFree` asks again for every candidate slot while it spirals outward.
 * Against a flat array that made laying out n shapes O(n²), and it showed:
 * 0.41 / 1.67 / 9.17 / 58.51 ms at 50 / 100 / 200 / 400 shapes — more than
 * quadrupling per doubling (#484). The guard that should have caught it was a
 * 1500ms ceiling on a 27ms operation, so it never did (#440).
 *
 * A uniform grid on the slot lattice fixes it: everything sits on a SKETCH_SEP
 * pitch, so a shape footprint touches at most four cells and a query reads only
 * the cells its own rect covers.
 *
 * Box frames are the exception — one can span the whole diagram, and indexing
 * it by area would cost more than scanning it — so a rect covering more than
 * OVERSIZED_CELLS cells goes in a list that is still walked linearly. A
 * diagram has a handful of boxes and hundreds of shapes, which is the whole
 * reason the split pays.
 *
 * The cell range is deliberately a SUPERSET of the cells a rect truly touches
 * (a rect ending exactly on a boundary claims the next cell too). An extra
 * bucket read costs nothing; a missed one would be a silent overlap.
 */
const CELL = SKETCH_SEP;
const OVERSIZED_CELLS = 64;

function cellRange(rect: SlotRect): [number, number, number, number] {
  return [
    Math.floor(rect.c / CELL),
    Math.floor(rect.r / CELL),
    Math.floor((rect.c + rect.w) / CELL),
    Math.floor((rect.r + rect.h) / CELL),
  ];
}

function cellSpan(range: [number, number, number, number]): number {
  return (range[2] - range[0] + 1) * (range[3] - range[1] + 1);
}

class Occupancy {
  private readonly grid = new Map<string, SlotRect[]>();
  private readonly oversized: SlotRect[] = [];
  /** Every rect, in insertion order — the extent and flow-origin maths want it. */
  readonly rects: SlotRect[] = [];
  /**
   * The ring a search from a given base last had to reach, keyed by that base.
   *
   * Slots are only ever taken here, never given back, so a ring that was full
   * once is full for the rest of the layout. The next unit authored at the
   * same slot can therefore start where the last one finished instead of
   * re-walking every ring inside it — which is what made a stack of shapes on
   * one coordinate cost more than linear even with the collision index in
   * place (#484). Skipping proven-full rings cannot change where a unit lands.
   */
  readonly ringStart = new Map<string, number>();

  add(rect: SlotRect): void {
    this.rects.push(rect);
    const range = cellRange(rect);
    if (cellSpan(range) > OVERSIZED_CELLS) {
      this.oversized.push(rect);
      return;
    }
    const [c0, r0, c1, r1] = range;
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = `${c},${r}`;
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(rect);
        else this.grid.set(key, [rect]);
      }
    }
  }

  hits(rect: SlotRect): boolean {
    for (const o of this.oversized) if (rectsOverlap(rect, o)) return true;
    const range = cellRange(rect);
    if (cellSpan(range) > OVERSIZED_CELLS) {
      // A query this wide would read most of the grid anyway; scanning the
      // flat list is cheaper and there are only ever a few such queries.
      for (const o of this.rects) if (rectsOverlap(rect, o)) return true;
      return false;
    }
    const [c0, r0, c1, r1] = range;
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const bucket = this.grid.get(`${c},${r}`);
        if (!bucket) continue;
        for (const o of bucket) if (rectsOverlap(rect, o)) return true;
      }
    }
    return false;
  }
}

/**
 * Nearest free integer offset for `base`, scanning Manhattan rings.
 * Deterministic: within a ring prefer down, then right (reading order-ish).
 */
function nearestFree(
  base: SlotRect,
  occupied: Occupancy
): { c: number; r: number } {
  if (!occupied.hits(base)) return { c: base.c, r: base.r };
  const key = `${base.c},${base.r},${base.w},${base.h}`;
  for (let d = occupied.ringStart.get(key) ?? 1; d <= 200; d++) {
    const found = firstFreeOnRing(base, occupied, d);
    if (found) {
      occupied.ringStart.set(key, d);
      return found;
    }
  }
  return { c: base.c, r: base.r }; // pathological; give up rather than loop
}

// ── Box-local child layout ──────────────────────────────────

interface LocalChild {
  node: SketchNode;
  c: number;
  r: number;
}

function layoutChildren(
  box: SketchBox,
  nodesById: ReadonlyMap<string, SketchNode>,
  warn: (line: number, label: string) => void,
  flags: ResolvedAutoFlags,
  /**
   * Decision #58 — a box may hold boxes, to depth 2. Each inner box has already
   * been laid out (they contain shapes only, so there is no recursion), and
   * arrives here as the SlotRect it needs including its own frame. It is placed
   * in the same Occupancy as the shapes, so an inner box and a loose shape
   * cannot overlap, and it counts toward this box's extent.
   */
  childBoxRects: ReadonlyMap<string, SlotRect> = new Map()
): { children: LocalChild[]; boxes: LocalChildBox[]; extent: SlotRect } {
  const occupied = new Occupancy();
  const children: LocalChild[] = [];
  const localBoxes: LocalChildBox[] = [];
  const pending: SketchNode[] = [];

  // Inner boxes first: they are the largest units and an authored `at:` on one
  // should win the slot over a shape that merely flows into it.
  for (const boxId of box.childBoxes) {
    const rect = childBoxRects.get(boxId);
    if (!rect) continue;
    const at = childBoxAt.get(boxId) ?? null;
    const base = at ?? { c: 0, r: 0 };
    const want: SlotRect = { ...rect, c: base.c, r: base.r };
    const spot = flags.resolveOverlap
      ? nearestFreeRect(want, occupied)
      : { c: want.c, r: want.r };
    occupied.add({ ...rect, c: spot.c, r: spot.r });
    localBoxes.push({ boxId, c: spot.c, r: spot.r, rect });
  }

  for (const id of box.children) {
    const node = nodesById.get(id);
    if (!node) continue;
    if (node.at === null) {
      pending.push(node);
      continue;
    }
    const target = unitRect(node.at.c, node.at.r);
    const spot = flags.resolveOverlap
      ? nearestFree(target, occupied)
      : { c: node.at.c, r: node.at.r };
    if (spot.c !== node.at.c || spot.r !== node.at.r) {
      warn(node.lineNumber, node.label);
    }
    occupied.add(unitRect(spot.c, spot.r));
    children.push({ node, c: spot.c, r: spot.r });
  }

  if (!flags.flowPlaceUnpositioned) {
    // Stack coord-less children at the box origin (no auto-flow).
    for (const node of pending) children.push({ node, c: 0, r: 0 });
    pending.length = 0;
  }

  // Flow-place un-positioned children in rows below the positioned content.
  let flowRow =
    occupied.rects.length > 0
      ? Math.max(...occupied.rects.map((o) => o.r)) + SKETCH_SEP
      : 0;
  let flowCol = 0;
  const wrapAt = Math.max(
    SKETCH_SEP * 3,
    occupied.rects.length > 0
      ? Math.max(...occupied.rects.map((o) => o.c)) + SKETCH_SEP
      : SKETCH_SEP * 3
  );
  for (const node of pending) {
    let placed = false;
    while (!placed) {
      const rect = unitRect(flowCol, flowRow);
      if (!occupied.hits(rect)) {
        occupied.add(rect);
        children.push({ node, c: flowCol, r: flowRow });
        placed = true;
      }
      flowCol += SKETCH_SEP;
      if (flowCol > wrapAt) {
        flowCol = 0;
        flowRow += SKETCH_SEP;
      }
    }
  }

  let extent: SlotRect;
  if (occupied.rects.length === 0) {
    extent = { c: 0, r: 0, w: SKETCH_SEP, h: SKETCH_SEP };
  } else {
    const cMin = Math.min(...occupied.rects.map((o) => o.c));
    const rMin = Math.min(...occupied.rects.map((o) => o.r));
    const cMax = Math.max(...occupied.rects.map((o) => o.c + o.w));
    const rMax = Math.max(...occupied.rects.map((o) => o.r + o.h));
    extent = { c: cMin, r: rMin, w: cMax - cMin, h: rMax - rMin };
  }
  return { children, boxes: localBoxes, extent };
}

// ── Main layout ─────────────────────────────────────────────

export function layoutSketch(
  parsed: Pick<ParsedSketch, 'nodes' | 'edges' | 'boxes'>,
  options: SketchLayoutOptions = {}
): SketchLayout {
  const diagnostics: DgmoError[] = [];
  const overlapWarn = (line: number, label: string): void => {
    diagnostics.push(
      makeDgmoError(
        line,
        `Shape "${label}" overlapped another at its authored position — moved to the nearest free slot`,
        'warning',
        SKETCH_DIAGNOSTIC_CODES.OVERLAP_RESOLVED
      )
    );
  };

  const flags = resolveAutoFlags(options.autoLayout);
  const collapsed = collapseSketch(parsed, options.collapsedBoxes);
  const nodesById = new Map(collapsed.nodes.map((n) => [n.id, n]));

  // Frame margins in half-slot units (for collision + extent math).
  const padHsX = SKETCH_GEOMETRY.boxPadPx / SKETCH_HALF_SLOT_X;
  const padHsY = SKETCH_GEOMETRY.boxPadPx / SKETCH_HALF_SLOT_Y;
  const bandHs = SKETCH_GEOMETRY.bandPx / SKETCH_HALF_SLOT_Y;

  // 1. Box-local child layout (children of expanded boxes).
  const boxLocal = new Map<
    string,
    { children: LocalChild[]; boxes: LocalChildBox[]; extent: SlotRect }
  >();
  const inExpandedBox = new Set<string>();
  const boxById = new Map(collapsed.boxes.map((b) => [b.id, b]));
  /** Boxes that sit inside another box — they are placed by their parent, not at root. */
  const nestedBoxIds = new Set(
    collapsed.boxes.filter((b) => b.parentBoxId !== null).map((b) => b.id)
  );
  // Two passes, because depth is capped at 2 (decision #58): inner boxes hold
  // only shapes, so laying them out first gives each one a finished rect for
  // its parent to reserve space against. No recursion is possible or needed.
  childBoxAt.clear();
  for (const box of collapsed.boxes) {
    if (!nestedBoxIds.has(box.id)) continue;
    childBoxAt.set(box.id, box.at);
    const local = layoutChildren(box, nodesById, overlapWarn, flags);
    boxLocal.set(box.id, local);
    for (const child of local.children) inExpandedBox.add(child.node.id);
  }
  /** An inner box's footprint in its parent's slot space: extent + frame. */
  const childBoxRects = new Map<string, SlotRect>();
  for (const box of collapsed.boxes) {
    if (!nestedBoxIds.has(box.id)) continue;
    const local = boxLocal.get(box.id)!;
    childBoxRects.set(box.id, {
      c: 0,
      r: 0,
      w: local.extent.w + 2 * padHsX,
      h: local.extent.h + bandHs + padHsY,
    });
  }
  for (const box of collapsed.boxes) {
    if (nestedBoxIds.has(box.id)) continue;
    const local = layoutChildren(
      box,
      nodesById,
      overlapWarn,
      flags,
      childBoxRects
    );
    boxLocal.set(box.id, local);
    for (const child of local.children) inExpandedBox.add(child.node.id);
  }

  // 1b. Would-be child layout of COLLAPSED boxes (children come from the
  // pre-collapse parse — the collapse transform removed them from `nodes`).
  // The collapsed card is centred inside this would-be frame, and the frame's
  // full footprint stays occupied, so folding a box moves NOTHING else and
  // unfolding is the exact inverse. Warnings stay silent: the children are
  // not rendered, so their overlap resolution is not the author's problem
  // until the box is expanded.
  const allNodesById = new Map(parsed.nodes.map((n) => [n.id, n]));
  const noWarn = (): void => {};
  const virtualLocal = new Map<
    string,
    { children: LocalChild[]; extent: SlotRect }
  >();
  for (const box of collapsed.virtualBoxes) {
    virtualLocal.set(box.id, layoutChildren(box, allNodesById, noWarn, flags));
  }
  // Card slot for a collapsed box anchored at `spot`: centred inside the
  // VISUAL would-be frame (the children's foot-sized bbox + frame margins —
  // NOT the SEP-padded collision rect, which is wider). Frame margins cancel
  // out of the centre on x; on y the band tops the frame and the pad bottoms
  // it, so the centre shifts by half their difference. Rounded to whole slots
  // so slot ↔ px stays on the shared lattice (drag/pin math relies on it).
  const footWs = SKETCH_FOOT_W / SKETCH_HALF_SLOT_X;
  const footHs = SKETCH_FOOT_H / SKETCH_HALF_SLOT_Y;
  const virtualCardSpot = (
    boxId: string,
    spot: { c: number; r: number }
  ): { c: number; r: number } => {
    const local = virtualLocal.get(boxId)!;
    if (local.children.length === 0) return { c: spot.c, r: spot.r };
    let minC = Infinity;
    let minR = Infinity;
    let maxC = -Infinity;
    let maxR = -Infinity;
    for (const ch of local.children) {
      minC = Math.min(minC, ch.c);
      minR = Math.min(minR, ch.r);
      maxC = Math.max(maxC, ch.c + footWs);
      maxR = Math.max(maxR, ch.r + footHs);
    }
    const cx = spot.c + (minC + maxC) / 2;
    const cy = spot.r + (minR + maxR) / 2 + (padHsY - bandHs) / 2;
    return {
      c: Math.round(cx - footWs / 2),
      r: Math.round(cy - footHs / 2),
    };
  };

  // 2. Root placement: root shapes + virtual (collapsed) boxes are unit
  //    footprints; expanded boxes are rects (children extent + frame).
  type RootUnit =
    | { kind: 'shape'; node: SketchNode }
    | { kind: 'virtual'; box: SketchBox }
    | { kind: 'box'; box: SketchBox };

  const rootUnits: RootUnit[] = [];
  for (const node of collapsed.nodes) {
    if (!inExpandedBox.has(node.id)) rootUnits.push({ kind: 'shape', node });
  }
  for (const box of collapsed.virtualBoxes) {
    rootUnits.push({ kind: 'virtual', box });
  }
  for (const box of collapsed.boxes) {
    // A nested box is placed by its parent (decision #58), never at root.
    if (nestedBoxIds.has(box.id)) continue;
    rootUnits.push({ kind: 'box', box });
  }
  // Placement order decides who keeps a contested slot under collision
  // resolution. Flag on (default): source order — flow placement is reading
  // order by declaration. Flag off (Stage 3): geometry-stable — authored-`at`
  // units sort by coordinate (row-major: r, then c; lineNumber tie-break for
  // determinism), so the outcome depends on where things are, not on which
  // source line declares them. Flow units (`at === null`) keep reading order
  // and still place after all positioned units, as always.
  const lineOf = (u: RootUnit): number =>
    u.kind === 'shape' ? u.node.lineNumber : u.box.lineNumber;
  const atOf = (u: RootUnit): { c: number; r: number } | null =>
    u.kind === 'shape' ? u.node.at : u.box.at;
  if (flags.sortRootsBySource) {
    rootUnits.sort((a, b) => lineOf(a) - lineOf(b));
  } else {
    rootUnits.sort((a, b) => {
      const aa = atOf(a);
      const ba = atOf(b);
      if (aa && ba) {
        return aa.r - ba.r || aa.c - ba.c || lineOf(a) - lineOf(b);
      }
      if (aa) return -1;
      if (ba) return 1;
      return lineOf(a) - lineOf(b);
    });
  }

  const rectFor = (unit: RootUnit, c: number, r: number): SlotRect => {
    // Expanded AND collapsed boxes both occupy the full frame rect: a
    // collapsed box keeps its would-be expanded footprint so fold/unfold is
    // positionally a no-op for everything around it (the card itself is
    // centred inside this rect at output time).
    if (unit.kind !== 'shape' && flags.groupCollisionAsRect) {
      const local = (unit.kind === 'box' ? boxLocal : virtualLocal).get(
        unit.box.id
      )!;
      return {
        c: c + local.extent.c - padHsX,
        r: r + local.extent.r - bandHs,
        w: local.extent.w + 2 * padHsX,
        h: local.extent.h + bandHs + padHsY,
      };
    }
    return unitRect(c, r);
  };

  const occupied = new Occupancy();
  const placedAt = new Map<RootUnit, { c: number; r: number }>();
  const pending: RootUnit[] = [];

  for (const unit of rootUnits) {
    const at = atOf(unit);
    if (at === null) {
      pending.push(unit);
      continue;
    }
    const base = rectFor(unit, at.c, at.r);
    let spot = { c: at.c, r: at.r };
    // An authored `at:` on a BOX (expanded or collapsed) is an explicit,
    // user-placed coordinate — it is NEVER shoved to avoid another box. Shoving
    // one group to de-overlap another cascades violently (drag a group toward
    // its neighbour and the whole diagram reflows — the neighbour teleports, a
    // third box jumps to make room). Authored boxes may overlap; the box lands
    // exactly where placed and nothing else moves (WYSIWYG). Only SHAPES still
    // de-overlap on collision (a small, local nudge — the desired "drop a shape
    // on another and it parts" behavior), and only FLOW-placed roots (no `at:`)
    // are auto-arranged below. A collapsed box still reserves its would-be
    // frame footprint (fold/unfold moves nothing) via rectFor.
    if (flags.resolveOverlap && unit.kind === 'shape' && occupied.hits(base)) {
      const freed = nearestFree(base, occupied);
      spot = {
        c: at.c + (freed.c - base.c),
        r: at.r + (freed.r - base.r),
      };
      overlapWarn(unit.node.lineNumber, unit.node.label);
    }
    occupied.add(rectFor(unit, spot.c, spot.r));
    placedAt.set(unit, spot);
  }

  if (!flags.flowPlaceUnpositioned) {
    // No auto-flow: park coord-less roots at the origin.
    for (const unit of pending) {
      occupied.add(rectFor(unit, 0, 0));
      placedAt.set(unit, { c: 0, r: 0 });
    }
    pending.length = 0;
  }

  // Flow-place the un-positioned roots below all placed content.
  let flowRow =
    occupied.rects.length > 0
      ? Math.ceil(Math.max(...occupied.rects.map((o) => o.r + o.h)))
      : 0;
  let flowCol = 0;
  const wrapAt = Math.max(
    SKETCH_SEP * 4,
    occupied.rects.length > 0
      ? Math.ceil(Math.max(...occupied.rects.map((o) => o.c + o.w)))
      : SKETCH_SEP * 4
  );
  for (const unit of pending) {
    let placed = false;
    while (!placed) {
      const rect = rectFor(unit, flowCol, flowRow);
      if (!occupied.hits(rect)) {
        occupied.add(rect);
        placedAt.set(unit, { c: flowCol, r: flowRow });
        placed = true;
      }
      flowCol += SKETCH_SEP;
      if (flowCol > wrapAt) {
        flowCol = 0;
        flowRow += SKETCH_SEP;
      }
    }
  }

  // 3. Normalize to a 0-based origin and map to px.
  const allRects = rootUnits.map((u) => {
    const spot = placedAt.get(u)!;
    return rectFor(u, spot.c, spot.r);
  });
  const liveCMin =
    allRects.length > 0 ? Math.min(...allRects.map((r) => r.c)) : 0;
  const liveRMin =
    allRects.length > 0 ? Math.min(...allRects.map((r) => r.r)) : 0;
  // Origin off = frozen: subtract a stable corner so moving one node doesn't
  // re-shift the rest. Clamp to the live min so content never goes negative
  // (which would escape the renderer's 0-origin viewBox). Falls back to the
  // live min when no frozen corner is supplied — safe, never blank.
  const cMin = flags.normalizeOrigin
    ? liveCMin
    : Math.min(options.frozenOrigin?.c ?? liveCMin, liveCMin);
  const rMin = flags.normalizeOrigin
    ? liveRMin
    : Math.min(options.frozenOrigin?.r ?? liveRMin, liveRMin);

  const toPx = (c: number, r: number): { x: number; y: number } => ({
    x: (c - cMin) * SKETCH_HALF_SLOT_X,
    y: (r - rMin) * SKETCH_HALF_SLOT_Y,
  });

  const nodes: SketchLayoutNode[] = [];
  const boxes: SketchLayoutBox[] = [];

  for (const unit of rootUnits) {
    const spot = placedAt.get(unit)!;
    if (unit.kind === 'shape') {
      const { x, y } = toPx(spot.c, spot.r);
      nodes.push({
        id: unit.node.id,
        label: unit.node.label,
        shape: unit.node.shape,
        metadata: unit.node.metadata,
        ...(unit.node.description && { description: unit.node.description }),
        lineNumber: unit.node.lineNumber,
        slot: spot,
        x,
        y,
        w: SKETCH_FOOT_W,
        h: SKETCH_FOOT_H,
      });
    } else if (unit.kind === 'virtual') {
      // Centre the card inside the would-be expanded frame (whose footprint
      // stayed occupied when it fits), instead of parking it on the frame's
      // top-left anchor slot — so folding reads as "the frame condensed into
      // a card", not "the frame teleported to its corner".
      const cardSpot = virtualCardSpot(unit.box.id, spot);
      const { x, y } = toPx(cardSpot.c, cardSpot.r);
      nodes.push({
        id: unit.box.id,
        label: unit.box.label,
        shape: 'rectangle',
        metadata: unit.box.metadata,
        lineNumber: unit.box.lineNumber,
        slot: cardSpot,
        x,
        y,
        w: SKETCH_FOOT_W,
        h: SKETCH_FOOT_H,
        isCollapsedBox: true,
        childCount: collapsed.collapsedChildCounts.get(unit.box.label) ?? 0,
      });
    } else {
      const local = boxLocal.get(unit.box.id)!;
      // Children px (absolute = box origin + local slot).
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const child of local.children) {
        const abs = toPx(spot.c + child.c, spot.r + child.r);
        nodes.push({
          id: child.node.id,
          label: child.node.label,
          shape: child.node.shape,
          metadata: child.node.metadata,
          ...(child.node.description && {
            description: child.node.description,
          }),
          boxLabel: unit.box.label,
          lineNumber: child.node.lineNumber,
          slot: { c: spot.c + child.c, r: spot.r + child.r },
          x: abs.x,
          y: abs.y,
          w: SKETCH_FOOT_W,
          h: SKETCH_FOOT_H,
        });
        minX = Math.min(minX, abs.x);
        minY = Math.min(minY, abs.y);
        maxX = Math.max(maxX, abs.x + SKETCH_FOOT_W);
        maxY = Math.max(maxY, abs.y + SKETCH_FOOT_H);
      }
      if (minX === Infinity) {
        // Empty box (all children merged away) — a band-height frame.
        const origin = toPx(spot.c, spot.r);
        minX = origin.x;
        minY = origin.y + SKETCH_GEOMETRY.bandPx;
        maxX = origin.x + SKETCH_FOOT_W;
        maxY = minY;
      }
      // Inner boxes (decision #58, depth 2). Each was laid out in pass 1 and
      // placed in this box's local slot space; emit its frame and its own
      // children at the absolute origin, and grow this frame to contain it.
      for (const inner of local.boxes) {
        const innerBox = boxById.get(inner.boxId);
        const innerLocal = boxLocal.get(inner.boxId);
        if (!innerBox || !innerLocal) continue;
        // The inner frame's top-left, in absolute px. `inner.c/r` is where its
        // RECT starts, and the rect leads with the frame margins, so the
        // content origin sits one pad in and one band down.
        const innerRectOrigin = toPx(spot.c + inner.c, spot.r + inner.r);
        const innerContentX =
          innerRectOrigin.x +
          SKETCH_GEOMETRY.boxPadPx -
          innerLocal.extent.c * SKETCH_HALF_SLOT_X;
        const innerContentY =
          innerRectOrigin.y +
          SKETCH_GEOMETRY.bandPx -
          innerLocal.extent.r * SKETCH_HALF_SLOT_Y;
        let iMinX = Infinity;
        let iMinY = Infinity;
        let iMaxX = -Infinity;
        let iMaxY = -Infinity;
        for (const gc of innerLocal.children) {
          const gx = innerContentX + gc.c * SKETCH_HALF_SLOT_X;
          const gy = innerContentY + gc.r * SKETCH_HALF_SLOT_Y;
          nodes.push({
            id: gc.node.id,
            label: gc.node.label,
            shape: gc.node.shape,
            metadata: gc.node.metadata,
            ...(gc.node.description && { description: gc.node.description }),
            boxLabel: innerBox.label,
            lineNumber: gc.node.lineNumber,
            slot: { c: spot.c + inner.c, r: spot.r + inner.r },
            x: gx,
            y: gy,
            w: SKETCH_FOOT_W,
            h: SKETCH_FOOT_H,
          });
          iMinX = Math.min(iMinX, gx);
          iMinY = Math.min(iMinY, gy);
          iMaxX = Math.max(iMaxX, gx + SKETCH_FOOT_W);
          iMaxY = Math.max(iMaxY, gy + SKETCH_FOOT_H);
        }
        if (iMinX === Infinity) {
          // Empty inner box — the same band-height frame an empty top-level
          // box gets, so "drag the last shape out" leaves something visible.
          iMinX = innerContentX;
          iMinY = innerContentY + SKETCH_GEOMETRY.bandPx;
          iMaxX = innerContentX + SKETCH_FOOT_W;
          iMaxY = iMinY;
        }
        const iFrame = {
          x: iMinX - SKETCH_GEOMETRY.boxPadPx,
          y: iMinY - SKETCH_GEOMETRY.bandPx,
          w: iMaxX - iMinX + 2 * SKETCH_GEOMETRY.boxPadPx,
          h: iMaxY - iMinY + SKETCH_GEOMETRY.bandPx + SKETCH_GEOMETRY.boxPadPx,
        };
        boxes.push({
          id: innerBox.id,
          label: innerBox.label,
          metadata: innerBox.metadata,
          lineNumber: innerBox.lineNumber,
          ...iFrame,
          bandH: SKETCH_GEOMETRY.bandPx,
        });
        // The outer frame must contain the inner one, frame and all.
        minX = Math.min(minX, iFrame.x);
        minY = Math.min(minY, iFrame.y);
        maxX = Math.max(maxX, iFrame.x + iFrame.w);
        maxY = Math.max(maxY, iFrame.y + iFrame.h);
      }
      boxes.push({
        id: unit.box.id,
        label: unit.box.label,
        metadata: unit.box.metadata,
        lineNumber: unit.box.lineNumber,
        x: minX - SKETCH_GEOMETRY.boxPadPx,
        y: minY - SKETCH_GEOMETRY.bandPx,
        w: maxX - minX + 2 * SKETCH_GEOMETRY.boxPadPx,
        h: maxY - minY + SKETCH_GEOMETRY.bandPx + SKETCH_GEOMETRY.boxPadPx,
        bandH: SKETCH_GEOMETRY.bandPx,
      });
    }
  }

  // Never let a FLOW-PLACED root shape sit on a NON-INCIDENT edge (a line
  // between two OTHER shapes). Approximate each edge as the segment between its
  // endpoints' centers; when a shape's footprint crosses one, nudge the shape a
  // full slot off the line (perpendicular to it) and warn. Bounded passes
  // handle cascades. Shapes with an authored `at:` are exempt (Stage 5) —
  // authored position wins over edge aesthetics.
  if (flags.avoidEdges) {
    const authored = new Set<string>();
    for (const unit of rootUnits) {
      if (atOf(unit) !== null) {
        authored.add(unit.kind === 'shape' ? unit.node.id : unit.box.id);
      }
    }
    const centerOf = (id: string): { x: number; y: number } | null => {
      const n = nodes.find((nd) => nd.id === id);
      if (n) return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
      const b = boxes.find((bx) => bx.id === id);
      if (b) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      return null;
    };
    // Liang–Barsky: does segment a→b touch the axis-aligned rect?
    const segHitsRect = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      rx0: number,
      ry0: number,
      rx1: number,
      ry1: number
    ): boolean => {
      let t0 = 0;
      let t1 = 1;
      const p = [-(bx - ax), bx - ax, -(by - ay), by - ay];
      const q = [ax - rx0, rx1 - ax, ay - ry0, ry1 - ay];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
          if (q[i]! < 0) return false;
        } else {
          const t = q[i]! / p[i]!;
          if (p[i]! < 0) {
            if (t > t1) return false;
            if (t > t0) t0 = t;
          } else {
            if (t < t0) return false;
            if (t < t1) t1 = t;
          }
        }
      }
      return t0 <= t1;
    };
    const warned = new Set<string>();
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const n of nodes) {
        if (n.boxLabel) continue; // box children ride their frame
        if (authored.has(n.id)) continue; // authored `at:` is never nudged
        for (const e of collapsed.edges) {
          if (e.sourceId === n.id || e.targetId === n.id) continue; // incident
          const a = centerOf(e.sourceId);
          const b = centerOf(e.targetId);
          if (!a || !b) continue;
          if (!segHitsRect(a.x, a.y, b.x, b.y, n.x, n.y, n.x + n.w, n.y + n.h))
            continue;
          const ncx = n.x + n.w / 2;
          const ncy = n.y + n.h / 2;
          const m = n as {
            x: number;
            y: number;
            slot: { c: number; r: number };
          };
          if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
            const lineY = a.y + ((b.y - a.y) * (ncx - a.x)) / (b.x - a.x || 1);
            let dir = ncy >= lineY ? 1 : -1;
            if (n.slot.r + dir * SKETCH_SEP < 0) dir = 1;
            m.y += dir * SKETCH_SLOT_Y;
            m.slot = { c: n.slot.c, r: n.slot.r + dir * SKETCH_SEP };
          } else {
            const lineX = a.x + ((b.x - a.x) * (ncy - a.y)) / (b.y - a.y || 1);
            let dir = ncx >= lineX ? 1 : -1;
            if (n.slot.c + dir * SKETCH_SEP < 0) dir = 1;
            m.x += dir * SKETCH_SLOT_X;
            m.slot = { c: n.slot.c + dir * SKETCH_SEP, r: n.slot.r };
          }
          if (!warned.has(n.id)) {
            overlapWarn(n.lineNumber, n.label);
            warned.add(n.id);
          }
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }

  let width = 0;
  let height = 0;
  for (const n of nodes) {
    width = Math.max(width, n.x + n.w);
    height = Math.max(height, n.y + n.h);
  }
  for (const b of boxes) {
    width = Math.max(width, b.x + b.w);
    height = Math.max(height, b.y + b.h);
  }

  // Outer frames must paint BEFORE the frames they contain, or a parent's fill
  // covers its own children (decision #58). Inner boxes are emitted first
  // because a parent's extent depends on them, so re-order here: a stable
  // partition, top-level frames ahead of nested ones.
  const orderedBoxes = [
    ...boxes.filter((b) => !nestedBoxIds.has(b.id)),
    ...boxes.filter((b) => nestedBoxIds.has(b.id)),
  ];

  return {
    nodes,
    boxes: orderedBoxes,
    edges: collapsed.edges,
    width,
    height,
    diagnostics,
    origin: { c: cMin, r: rMin },
  };
}
