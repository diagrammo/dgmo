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
}

export interface SketchLayoutOptions {
  /** Box labels to fold; defaults to the authored `collapsed` flags. */
  readonly collapsedBoxes?: ReadonlySet<string>;
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

function rectsOverlap(a: SlotRect, b: SlotRect): boolean {
  return (
    a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h
  );
}

function collidesAny(rect: SlotRect, occupied: readonly SlotRect[]): boolean {
  for (const o of occupied) if (rectsOverlap(rect, o)) return true;
  return false;
}

/**
 * Nearest free integer offset for `base`, scanning Manhattan rings.
 * Deterministic: within a ring prefer down, then right (reading order-ish).
 */
function nearestFree(
  base: SlotRect,
  occupied: readonly SlotRect[]
): { c: number; r: number } {
  if (!collidesAny(base, occupied)) return { c: base.c, r: base.r };
  for (let d = 1; d <= 200; d++) {
    const candidates: Array<{ c: number; r: number }> = [];
    for (let dc = -d; dc <= d; dc++) {
      const dr = d - Math.abs(dc);
      candidates.push({ c: base.c + dc, r: base.r + dr });
      if (dr !== 0) candidates.push({ c: base.c + dc, r: base.r - dr });
    }
    // Prefer reading order: right, then down, then left/up.
    candidates.sort((a, b) => {
      const costA = (a.r < base.r ? 2 : 0) + (a.c < base.c ? 1 : 0);
      const costB = (b.r < base.r ? 2 : 0) + (b.c < base.c ? 1 : 0);
      return costA - costB || a.r - b.r || a.c - b.c;
    });
    for (const cand of candidates) {
      if (!collidesAny({ ...base, c: cand.c, r: cand.r }, occupied)) {
        return cand;
      }
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
  warn: (line: number, label: string) => void
): { children: LocalChild[]; extent: SlotRect } {
  const occupied: SlotRect[] = [];
  const children: LocalChild[] = [];
  const pending: SketchNode[] = [];

  for (const id of box.children) {
    const node = nodesById.get(id);
    if (!node) continue;
    if (node.at === null) {
      pending.push(node);
      continue;
    }
    const target = unitRect(node.at.c, node.at.r);
    const spot = nearestFree(target, occupied);
    if (spot.c !== node.at.c || spot.r !== node.at.r) {
      warn(node.lineNumber, node.label);
    }
    occupied.push(unitRect(spot.c, spot.r));
    children.push({ node, c: spot.c, r: spot.r });
  }

  // Flow-place un-positioned children in rows below the positioned content.
  let flowRow =
    occupied.length > 0
      ? Math.max(...occupied.map((o) => o.r)) + SKETCH_SEP
      : 0;
  let flowCol = 0;
  const wrapAt = Math.max(
    SKETCH_SEP * 3,
    occupied.length > 0
      ? Math.max(...occupied.map((o) => o.c)) + SKETCH_SEP
      : SKETCH_SEP * 3
  );
  for (const node of pending) {
    let placed = false;
    while (!placed) {
      const rect = unitRect(flowCol, flowRow);
      if (!collidesAny(rect, occupied)) {
        occupied.push(rect);
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
  if (occupied.length === 0) {
    extent = { c: 0, r: 0, w: SKETCH_SEP, h: SKETCH_SEP };
  } else {
    const cMin = Math.min(...occupied.map((o) => o.c));
    const rMin = Math.min(...occupied.map((o) => o.r));
    const cMax = Math.max(...occupied.map((o) => o.c + o.w));
    const rMax = Math.max(...occupied.map((o) => o.r + o.h));
    extent = { c: cMin, r: rMin, w: cMax - cMin, h: rMax - rMin };
  }
  return { children, extent };
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

  const collapsed = collapseSketch(parsed, options.collapsedBoxes);
  const nodesById = new Map(collapsed.nodes.map((n) => [n.id, n]));

  // Frame margins in half-slot units (for collision + extent math).
  const padHsX = SKETCH_GEOMETRY.boxPadPx / SKETCH_HALF_SLOT_X;
  const padHsY = SKETCH_GEOMETRY.boxPadPx / SKETCH_HALF_SLOT_Y;
  const bandHs = SKETCH_GEOMETRY.bandPx / SKETCH_HALF_SLOT_Y;

  // 1. Box-local child layout (children of expanded boxes).
  const boxLocal = new Map<
    string,
    { children: LocalChild[]; extent: SlotRect }
  >();
  const inExpandedBox = new Set<string>();
  for (const box of collapsed.boxes) {
    const local = layoutChildren(box, nodesById, overlapWarn);
    boxLocal.set(box.id, local);
    for (const child of local.children) inExpandedBox.add(child.node.id);
  }

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
    rootUnits.push({ kind: 'box', box });
  }
  // Keep source order — flow placement is reading order by declaration.
  rootUnits.sort((a, b) => {
    const la = a.kind === 'shape' ? a.node.lineNumber : a.box.lineNumber;
    const lb = b.kind === 'shape' ? b.node.lineNumber : b.box.lineNumber;
    return la - lb;
  });

  const rectFor = (unit: RootUnit, c: number, r: number): SlotRect => {
    if (unit.kind === 'box') {
      const local = boxLocal.get(unit.box.id)!;
      return {
        c: c + local.extent.c - padHsX,
        r: r + local.extent.r - bandHs,
        w: local.extent.w + 2 * padHsX,
        h: local.extent.h + bandHs + padHsY,
      };
    }
    return unitRect(c, r);
  };

  const occupied: SlotRect[] = [];
  const placedAt = new Map<RootUnit, { c: number; r: number }>();
  const pending: RootUnit[] = [];

  for (const unit of rootUnits) {
    const at = unit.kind === 'shape' ? unit.node.at : unit.box.at;
    if (at === null) {
      pending.push(unit);
      continue;
    }
    const base = rectFor(unit, at.c, at.r);
    let spot = { c: at.c, r: at.r };
    if (collidesAny(base, occupied)) {
      const freed = nearestFree(base, occupied);
      spot = {
        c: at.c + (freed.c - base.c),
        r: at.r + (freed.r - base.r),
      };
      const line =
        unit.kind === 'shape' ? unit.node.lineNumber : unit.box.lineNumber;
      const label = unit.kind === 'shape' ? unit.node.label : unit.box.label;
      overlapWarn(line, label);
    }
    occupied.push(rectFor(unit, spot.c, spot.r));
    placedAt.set(unit, spot);
  }

  // Flow-place the un-positioned roots below all placed content.
  let flowRow =
    occupied.length > 0
      ? Math.ceil(Math.max(...occupied.map((o) => o.r + o.h)))
      : 0;
  let flowCol = 0;
  const wrapAt = Math.max(
    SKETCH_SEP * 4,
    occupied.length > 0
      ? Math.ceil(Math.max(...occupied.map((o) => o.c + o.w)))
      : SKETCH_SEP * 4
  );
  for (const unit of pending) {
    let placed = false;
    while (!placed) {
      const rect = rectFor(unit, flowCol, flowRow);
      if (!collidesAny(rect, occupied)) {
        occupied.push(rect);
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
  const cMin = allRects.length > 0 ? Math.min(...allRects.map((r) => r.c)) : 0;
  const rMin = allRects.length > 0 ? Math.min(...allRects.map((r) => r.r)) : 0;

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
      const { x, y } = toPx(spot.c, spot.r);
      nodes.push({
        id: unit.box.id,
        label: unit.box.label,
        shape: 'rectangle',
        metadata: unit.box.metadata,
        lineNumber: unit.box.lineNumber,
        slot: spot,
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

  return {
    nodes,
    boxes,
    edges: collapsed.edges,
    width,
    height,
    diagnostics,
  };
}
