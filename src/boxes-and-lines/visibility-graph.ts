// ============================================================
// Boxes and Lines — Visibility Graph Construction
// ============================================================
//
// Builds a graph of line-of-sight connections between node corners
// and edge ports, used for A* pathfinding.

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export interface VisibilityVertex {
  x: number;
  y: number;
  id: string;
}

export interface VisibilityEdge {
  from: string;
  to: string;
  distance: number;
}

export interface VisibilityGraph {
  vertices: Map<string, VisibilityVertex>;
  adjacency: Map<string, { to: string; distance: number }[]>;
}

const CLEARANCE = 5;

function vertexId(x: number, y: number): string {
  return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
}

/** Generate 4 padded corner points for a rectangle */
function paddedCorners(rect: Rect): Point[] {
  const pad = CLEARANCE;
  return [
    { x: rect.x - pad, y: rect.y - pad },
    { x: rect.x + rect.width + pad, y: rect.y - pad },
    { x: rect.x + rect.width + pad, y: rect.y + rect.height + pad },
    { x: rect.x - pad, y: rect.y + rect.height + pad },
  ];
}

/** Check if a line segment from p1 to p2 intersects a rectangle */
export function segmentIntersectsRect(
  p1: Point,
  p2: Point,
  rect: Rect,
  shrink = 0
): boolean {
  // Shrink the rect slightly for the test to allow corner-grazing
  const rx = rect.x + shrink;
  const ry = rect.y + shrink;
  const rw = rect.width - 2 * shrink;
  const rh = rect.height - 2 * shrink;

  if (rw <= 0 || rh <= 0) return false;

  // Cohen-Sutherland style — check if segment enters the rectangle
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return false;

  // Check all 4 edges of the rect for intersection
  const edges: [Point, Point][] = [
    [
      { x: rx, y: ry },
      { x: rx + rw, y: ry },
    ],
    [
      { x: rx + rw, y: ry },
      { x: rx + rw, y: ry + rh },
    ],
    [
      { x: rx + rw, y: ry + rh },
      { x: rx, y: ry + rh },
    ],
    [
      { x: rx, y: ry + rh },
      { x: rx, y: ry },
    ],
  ];

  for (const [e1, e2] of edges) {
    if (segmentsIntersect(p1, p2, e1, e2)) return true;
  }

  // Check if either endpoint is inside the rect
  if (p1.x >= rx && p1.x <= rx + rw && p1.y >= ry && p1.y <= ry + rh) {
    return true;
  }
  if (p2.x >= rx && p2.x <= rx + rw && p2.y >= ry && p2.y <= ry + rh) {
    return true;
  }

  return false;
}

/** Check if two line segments intersect (proper intersection) */
export function segmentsIntersect(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): boolean {
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  // Collinear cases
  if (d1 === 0 && onSegment(a1, a2, b1)) return true;
  if (d2 === 0 && onSegment(a1, a2, b2)) return true;
  if (d3 === 0 && onSegment(b1, b2, a1)) return true;
  if (d4 === 0 && onSegment(b1, b2, a2)) return true;

  return false;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y)
  );
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Check if a line from p1 to p2 has clear line-of-sight (no obstacles) */
function hasClearSight(p1: Point, p2: Point, obstacles: Rect[]): boolean {
  for (const rect of obstacles) {
    if (segmentIntersectsRect(p1, p2, rect, 1)) return false;
  }
  return true;
}

/**
 * Build a visibility graph from positioned nodes and edge ports.
 *
 * @param obstacles - Bounding boxes of all positioned nodes
 * @param ports - Source and target port positions for each edge
 * @returns Visibility graph with adjacency lists
 */
export function buildVisibilityGraph(
  obstacles: Rect[],
  ports: Point[]
): VisibilityGraph {
  const vertices = new Map<string, VisibilityVertex>();
  const adjacency = new Map<string, { to: string; distance: number }[]>();

  // Add padded corner vertices for each obstacle
  const allPoints: Point[] = [];
  for (const rect of obstacles) {
    const corners = paddedCorners(rect);
    for (const c of corners) {
      const id = vertexId(c.x, c.y);
      if (!vertices.has(id)) {
        vertices.set(id, { x: c.x, y: c.y, id });
        adjacency.set(id, []);
        allPoints.push(c);
      }
    }
  }

  // Add port positions as vertices
  for (const p of ports) {
    const id = vertexId(p.x, p.y);
    if (!vertices.has(id)) {
      vertices.set(id, { x: p.x, y: p.y, id });
      adjacency.set(id, []);
      allPoints.push(p);
    }
  }

  // Build edges: connect all vertex pairs with clear line-of-sight
  const pointList = [...vertices.values()];
  for (let i = 0; i < pointList.length; i++) {
    for (let j = i + 1; j < pointList.length; j++) {
      const a = pointList[i];
      const b = pointList[j];
      if (hasClearSight(a, b, obstacles)) {
        const dist = distance(a, b);
        adjacency.get(a.id)!.push({ to: b.id, distance: dist });
        adjacency.get(b.id)!.push({ to: a.id, distance: dist });
      }
    }
  }

  return { vertices, adjacency };
}
