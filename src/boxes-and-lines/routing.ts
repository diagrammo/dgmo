// ============================================================
// Boxes and Lines — Edge Routing
// ============================================================
//
// A* pathfinding on visibility graph + aesthetic nudge +
// curve smoothing + crossing hop detection + parallel edge handling.

import type { BLLayoutNodeV2, BLLayoutEdgeV2, PortSide } from './types';
import { buildVisibilityGraph } from './visibility-graph';

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Min-Heap Priority Queue ───────────────────────────────

class MinHeap {
  private heap: { id: string; priority: number }[] = [];

  push(id: string, priority: number): void {
    this.heap.push({ id, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  pop(): string | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top.id;
  }

  get size(): number {
    return this.heap.length;
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].priority >= this.heap[parent].priority) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  private _sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].priority < this.heap[smallest].priority)
        smallest = l;
      if (r < n && this.heap[r].priority < this.heap[smallest].priority)
        smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

// ── A* Pathfinding ────────────────────────────────────────

function heuristic(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function aStarPath(
  startId: string,
  endId: string,
  vertices: Map<string, { x: number; y: number; id: string }>,
  adjacency: Map<string, { to: string; distance: number }[]>
): Point[] | null {
  const start = vertices.get(startId);
  const end = vertices.get(endId);
  if (!start || !end) return null;

  const openHeap = new MinHeap();
  const inOpen = new Set<string>([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();

  gScore.set(startId, 0);
  openHeap.push(startId, heuristic(start, end));

  while (openHeap.size > 0) {
    const current = openHeap.pop()!;
    inOpen.delete(current);

    if (current === endId) {
      // Reconstruct path
      const path: Point[] = [];
      let cur: string | undefined = current;
      while (cur !== undefined) {
        const v = vertices.get(cur)!;
        path.unshift({ x: v.x, y: v.y });
        cur = cameFrom.get(cur);
      }
      return path;
    }

    const neighbors = adjacency.get(current) ?? [];

    for (const { to, distance } of neighbors) {
      const tentativeG = (gScore.get(current) ?? Infinity) + distance;
      if (tentativeG < (gScore.get(to) ?? Infinity)) {
        cameFrom.set(to, current);
        gScore.set(to, tentativeG);
        const toVertex = vertices.get(to)!;
        const f = tentativeG + heuristic(toVertex, end);
        // Always push — heap handles duplicates by naturally preferring lower f
        openHeap.push(to, f);
        inOpen.add(to);
      }
    }
  }

  return null; // No path found
}

// ── Aesthetic Nudge ───────────────────────────────────────

const NUDGE_ITERATIONS = 8;
const NUDGE_STRENGTH = 3;
const NUDGE_MIN_DIST = 15;

function aestheticNudge(paths: Point[][], obstacles: Rect[]): void {
  for (let iter = 0; iter < NUDGE_ITERATIONS; iter++) {
    for (const path of paths) {
      // Only nudge interior points (not start/end ports)
      for (let i = 1; i < path.length - 1; i++) {
        const p = path[i];
        let fx = 0;
        let fy = 0;

        // Repel from obstacle bounding boxes
        for (const rect of obstacles) {
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          const dx = p.x - cx;
          const dy = p.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < NUDGE_MIN_DIST + Math.max(rect.width, rect.height) / 2) {
            const force = NUDGE_STRENGTH / Math.max(dist, 1);
            fx += dx * force;
            fy += dy * force;
          }
        }

        // Repel from other edge control points
        for (const otherPath of paths) {
          if (otherPath === path) continue;
          for (let j = 1; j < otherPath.length - 1; j++) {
            const q = otherPath[j];
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < NUDGE_MIN_DIST) {
              const force = NUDGE_STRENGTH / Math.max(dist, 1);
              fx += dx * force;
              fy += dy * force;
            }
          }
        }

        // Apply force
        const newX = p.x + fx;
        const newY = p.y + fy;

        // Constraint: don't re-enter any obstacle
        let valid = true;
        for (const rect of obstacles) {
          if (
            newX >= rect.x &&
            newX <= rect.x + rect.width &&
            newY >= rect.y &&
            newY <= rect.y + rect.height
          ) {
            valid = false;
            break;
          }
        }

        if (valid) {
          p.x = newX;
          p.y = newY;
        }
      }
    }
  }
}

// ── Curve Smoothing ───────────────────────────────────────

function smoothPathToSvg(points: Point[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  // Catmull-Rom to cubic Bezier conversion for smooth curves
  // Each segment between points[i] and points[i+1] uses tangents
  // derived from the surrounding points.
  const t = 0.3; // tension factor
  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Control point 1: tangent at p1, forward direction
    const cp1x = p1.x + (p2.x - p0.x) * t;
    const cp1y = p1.y + (p2.y - p0.y) * t;

    // Control point 2: tangent at p2, backward direction
    const cp2x = p2.x - (p3.x - p1.x) * t;
    const cp2y = p2.y - (p3.y - p1.y) * t;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}

function straightLineSvg(points: Point[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

// ── Self-referencing Edge Arc ─────────────────────────────

function selfRefArc(
  node: { x: number; y: number; width: number; height: number },
  sourceSide: PortSide,
  targetSide: PortSide
): { path: Point[]; svgPath: string } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const arcRadius = Math.max(node.width, node.height) * 0.6;

  // If both ports are on the same side, use adjacent sides instead
  let effSrcSide = sourceSide;
  let effTgtSide = targetSide;
  if (sourceSide === targetSide) {
    const adjacentSides: Record<PortSide, [PortSide, PortSide]> = {
      right: ['top', 'bottom'],
      left: ['top', 'bottom'],
      top: ['left', 'right'],
      bottom: ['left', 'right'],
    };
    [effSrcSide, effTgtSide] = adjacentSides[sourceSide];
  }

  const srcPt = portPoint(node, effSrcSide);
  const tgtPt = portPoint(node, effTgtSide);

  // Arc control point — extend outward from center through midpoint
  const midX = (srcPt.x + tgtPt.x) / 2;
  const midY = (srcPt.y + tgtPt.y) / 2;
  const dx = midX - cx;
  const dy = midY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const arcX = midX + (dx / dist) * arcRadius;
  const arcY = midY + (dy / dist) * arcRadius;

  const points = [srcPt, { x: arcX, y: arcY }, tgtPt];
  const svgPath = `M ${srcPt.x} ${srcPt.y} Q ${arcX} ${arcY} ${tgtPt.x} ${tgtPt.y}`;

  return { path: points, svgPath };
}

function portPoint(
  node: { x: number; y: number; width: number; height: number },
  side: PortSide
): Point {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 };
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

// ── Crossing Hop Detection ────────────────────────────────

function lineSegmentIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): Point | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;

  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 0.001) return null;

  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom;

  if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99) {
    return {
      x: a1.x + t * dax,
      y: a1.y + t * day,
    };
  }

  return null;
}

function detectCrossingHops(
  edges: { routedPath: Point[]; index: number; hasLabel: boolean }[]
): Map<number, Point[]> {
  const hops = new Map<number, Point[]>();

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const pathA = edges[i].routedPath;
      const pathB = edges[j].routedPath;

      for (let ai = 0; ai < pathA.length - 1; ai++) {
        for (let bi = 0; bi < pathB.length - 1; bi++) {
          const pt = lineSegmentIntersection(
            pathA[ai],
            pathA[ai + 1],
            pathB[bi],
            pathB[bi + 1]
          );
          if (pt) {
            // The edge that gets the hop: unlabeled first, then later source order
            const hopEdge =
              !edges[i].hasLabel && edges[j].hasLabel
                ? i
                : !edges[j].hasLabel && edges[i].hasLabel
                  ? j
                  : j; // later in source order gets the hop
            const hopIdx = edges[hopEdge].index;
            if (!hops.has(hopIdx)) hops.set(hopIdx, []);
            hops.get(hopIdx)!.push(pt);
          }
        }
      }
    }
  }

  return hops;
}

// ── Parallel Edge Offset ──────────────────────────────────

function applyParallelOffset(
  path: Point[],
  offset: number,
  direction: 'LR' | 'TB'
): Point[] {
  if (offset === 0) return path;
  return path.map((p) => ({
    x: direction === 'TB' ? p.x + offset : p.x,
    y: direction === 'LR' ? p.y + offset : p.y,
  }));
}

// ── Main Routing Entry Point ──────────────────────────────

export function routeEdges(
  edges: BLLayoutEdgeV2[],
  nodes: BLLayoutNodeV2[],
  direction: 'LR' | 'TB'
): BLLayoutEdgeV2[] {
  const obstacles: Rect[] = nodes.map((n) => ({
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
  }));

  // Collect all ports for visibility graph
  const allPorts: Point[] = [];
  for (const edge of edges) {
    if (!edge.selfRef) {
      allPorts.push(
        { x: edge.sourcePort.x, y: edge.sourcePort.y },
        { x: edge.targetPort.x, y: edge.targetPort.y }
      );
    }
  }

  // Build visibility graph
  const visGraph = buildVisibilityGraph(obstacles, allPorts);

  // Route each edge
  const routedPaths: Point[][] = [];
  const routedEdges: { edge: BLLayoutEdgeV2; origIndex: number }[] = [];

  // Sort: labeled edges first (they get routing priority)
  const edgeOrder = edges
    .map((e, i) => ({ edge: e, origIndex: i }))
    .sort((a, b) => {
      if (a.edge.label && !b.edge.label) return -1;
      if (!a.edge.label && b.edge.label) return 1;
      return a.origIndex - b.origIndex;
    });

  for (const { edge, origIndex } of edgeOrder) {
    if (edge.selfRef) {
      // Self-referencing edge
      const node = nodes.find((n) => n.label === edge.source);
      if (node) {
        const arc = selfRefArc(
          node,
          edge.sourcePort.side,
          edge.targetPort.side
        );
        routedPaths.push(arc.path);
        routedEdges.push({
          edge: { ...edge, routedPath: arc.path, smoothPath: arc.svgPath },
          origIndex,
        });
      } else {
        routedEdges.push({ edge, origIndex });
      }
      continue;
    }

    // A* pathfinding through visibility graph
    const startId = `${Math.round(edge.sourcePort.x * 100) / 100},${Math.round(edge.sourcePort.y * 100) / 100}`;
    const endId = `${Math.round(edge.targetPort.x * 100) / 100},${Math.round(edge.targetPort.y * 100) / 100}`;

    let path = aStarPath(startId, endId, visGraph.vertices, visGraph.adjacency);

    if (!path) {
      // Fallback: straight line
      path = [
        { x: edge.sourcePort.x, y: edge.sourcePort.y },
        { x: edge.targetPort.x, y: edge.targetPort.y },
      ];
    }

    // Apply parallel offset
    path = applyParallelOffset(path, edge.yOffset, direction);

    routedPaths.push(path);
    routedEdges.push({
      edge: { ...edge, routedPath: path, smoothPath: '' },
      origIndex,
    });
  }

  // Aesthetic nudge pass
  aestheticNudge(routedPaths, obstacles);

  // Apply smoothed paths
  for (let i = 0; i < routedEdges.length; i++) {
    const path = routedPaths[i];
    if (!path) continue;
    routedEdges[i].edge.routedPath = path;

    // Use straight lines for 2-point paths, smooth curves for longer
    if (path.length <= 2) {
      routedEdges[i].edge.smoothPath = straightLineSvg(path);
    } else {
      routedEdges[i].edge.smoothPath = smoothPathToSvg(path);
    }
  }

  // Crossing hop detection
  const hopInput = routedEdges.map((re, i) => ({
    routedPath: re.edge.routedPath,
    index: i,
    hasLabel: !!re.edge.label,
  }));
  const hops = detectCrossingHops(hopInput);
  for (const [idx, hopPoints] of hops) {
    routedEdges[idx].edge.hops = hopPoints;
  }

  // Restore original order using stable index
  routedEdges.sort((a, b) => a.origIndex - b.origIndex);

  return routedEdges.map((re) => re.edge);
}
