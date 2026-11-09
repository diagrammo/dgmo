// ============================================================
// Content bounds — the bounding box every node-and-edge layout computes
// ============================================================
//
// Flowchart, ER, class and the four C4 layouts each grew their own
// min/max loop over node boxes, group rects and edge points (#1762). This
// is that loop once. Comparisons are strict and run left, top, right,
// bottom, exactly as the copies did, so every result is byte-identical.

export interface XY {
  x: number;
  y: number;
}

/** A box anchored at its centre, as dagre reports nodes. */
export interface CentredBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A box anchored at its top-left corner. */
export type CornerBox = CentredBox;

/** A growing bounding box; empty (infinite) until something is added. */
export class Bounds {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  /** Grow to cover the edges `l t r b`. */
  add(l: number, t: number, r: number, b: number): void {
    if (l < this.minX) this.minX = l;
    if (t < this.minY) this.minY = t;
    if (r > this.maxX) this.maxX = r;
    if (b > this.maxY) this.maxY = b;
  }

  /** Grow to cover a centre-anchored box. */
  addCentred(box: CentredBox): void {
    this.add(
      box.x - box.width / 2,
      box.y - box.height / 2,
      box.x + box.width / 2,
      box.y + box.height / 2
    );
  }

  /** Grow to cover a top-left-anchored box. */
  addRect(box: CornerBox): void {
    this.add(box.x, box.y, box.x + box.width, box.y + box.height);
  }

  /** Grow to cover every point. */
  addPoints(
    points: readonly { readonly x: number; readonly y: number }[]
  ): void {
    for (const pt of points) this.add(pt.x, pt.y, pt.x, pt.y);
  }

  /** Whether nothing has been added. */
  get empty(): boolean {
    return !Number.isFinite(this.minX);
  }

  /** Collapse an empty box to the origin, so sums over it stay finite. */
  orZero(): this {
    if (this.empty) {
      this.minX = 0;
      this.minY = 0;
      this.maxX = 0;
      this.maxY = 0;
    }
    return this;
  }

  /** The box grown by `pad` on every side, top-left anchored. */
  padded(pad: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    return {
      x: this.minX - pad,
      y: this.minY - pad,
      width: this.maxX - this.minX + pad * 2,
      height: this.maxY - this.minY + pad * 2,
    };
  }
}

/** Move every item by `dx dy`, in place. */
export function translateInPlace(
  items: readonly XY[],
  dx: number,
  dy: number
): void {
  for (const it of items) {
    it.x += dx;
    it.y += dy;
  }
}

/**
 * Shifted copies of a layout's nodes, edges and groups. With no shift the
 * same arrays come back, so an un-shifted layout keeps its identities.
 */
export function shiftLayout<
  N extends { readonly x: number; readonly y: number },
  E extends { readonly points: readonly { x: number; y: number }[] },
  G extends { readonly x: number; readonly y: number },
>(
  shiftX: number,
  shiftY: number,
  nodes: N[],
  edges: E[],
  groups: G[] = []
): { nodes: N[]; edges: E[]; groups: G[] } {
  if (shiftX === 0 && shiftY === 0) return { nodes, edges, groups };
  return {
    nodes: nodes.map((n) => ({ ...n, x: n.x + shiftX, y: n.y + shiftY })),
    edges: edges.map((e) => ({
      ...e,
      points: e.points.map((pt) => ({ x: pt.x + shiftX, y: pt.y + shiftY })),
    })),
    groups: groups.map((g) => ({ ...g, x: g.x + shiftX, y: g.y + shiftY })),
  };
}
