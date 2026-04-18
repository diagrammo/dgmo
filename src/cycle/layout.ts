// ============================================================
// Cycle Diagram — Layout Engine
// ============================================================

import type {
  ParsedCycle,
  CycleLayoutNode,
  CycleLayoutEdge,
  CycleLayoutResult,
} from './types';

/** Minimum arc angle in radians (~15°) to keep arcs readable. */
const MIN_ARC_ANGLE = (15 * Math.PI) / 180;

/** Estimated character width at 13px label font. */
const LABEL_CHAR_W = 8;

/** Estimated character width at 16px circle label font. */
const CIRCLE_LABEL_CHAR_W = 10;

/** Estimated character width at 11px description font. */
const DESC_CHAR_W = 6.5;

/** Minimum node width. */
const MIN_NODE_WIDTH = 70;

/** Maximum node width. */
const MAX_NODE_WIDTH = 180;

/** Node height for label-only nodes. */
const PLAIN_NODE_HEIGHT = 50;

/** Header height (label zone) in described nodes. */
const HEADER_HEIGHT = 36;

/** Extra height per wrapped description line. */
const DESC_LINE_HEIGHT = 16;

/** Vertical padding around description zone. */
const DESC_PAD_Y = 14;

/** Horizontal padding inside node for text. */
const NODE_PAD_X = 20;

/** Minimum circle-node radius. */
const MIN_CIRCLE_RADIUS = 35;

/** Padding inside circle for text. */
const CIRCLE_PAD = 14;

/**
 * Compute cycle diagram layout: positions nodes equidistant (or span-weighted)
 * on a circle, and generates curved edge paths between consecutive nodes.
 */
export function computeCycleLayout(
  parsed: ParsedCycle,
  options?: { width?: number; height?: number; hideDescriptions?: boolean }
): CycleLayoutResult {
  const width = options?.width ?? 800;
  const height = options?.height ?? 600;
  const hideDescriptions = options?.hideDescriptions ?? false;

  if (parsed.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      cx: width / 2,
      cy: height / 2,
      radius: 0,
      width,
      height,
      scale: 1,
    };
  }

  const nodeCount = parsed.nodes.length;
  const cx = width / 2;
  const cy = height / 2;
  const circleNodes = parsed.options['circle-nodes'] === 'true';

  // ── Compute node dimensions with word wrapping ──
  const nodeDims = parsed.nodes.map((node) => {
    const hasDesc = !hideDescriptions && node.description.length > 0;
    const labelWidth = Math.max(
      MIN_NODE_WIDTH,
      node.label.length * LABEL_CHAR_W + NODE_PAD_X * 2
    );

    if (circleNodes) {
      return computeCircleNodeDims(node, hasDesc);
    }

    if (!hasDesc) {
      return {
        width: Math.min(MAX_NODE_WIDTH, labelWidth),
        height: PLAIN_NODE_HEIGHT,
        wrappedDesc: [] as string[],
      };
    }

    // Determine node width: fit the label and a reasonable description width
    const nodeWidth = Math.min(MAX_NODE_WIDTH, Math.max(labelWidth, 150));
    const textWidth = nodeWidth - NODE_PAD_X * 2;
    const charsPerLine = Math.max(10, Math.floor(textWidth / DESC_CHAR_W));

    const wrappedDesc = wrapLines(node.description, charsPerLine);

    const descHeight =
      HEADER_HEIGHT + wrappedDesc.length * DESC_LINE_HEIGHT + DESC_PAD_Y;
    return { width: nodeWidth, height: descHeight, wrappedDesc };
  });

  // ── Uniform circle sizing: all circles match the largest ──
  if (circleNodes) {
    const maxDiam = Math.max(...nodeDims.map((d) => d.width));
    for (const d of nodeDims) {
      d.width = maxDiam;
      d.height = maxDiam;
      // Re-wrap descriptions to fit the larger circle
      const nodeIdx = nodeDims.indexOf(d);
      const node = parsed.nodes[nodeIdx];
      const hasDesc = !hideDescriptions && node.description.length > 0;
      if (hasDesc) {
        d.wrappedDesc = wrapLinesForCircle(node.description, maxDiam / 2);
      }
    }
  }

  // ── Compute angles using span weights ──
  const totalSpan = parsed.nodes.reduce((sum, n) => sum + n.span, 0);

  // Clamp: ensure no arc angle falls below MIN_ARC_ANGLE
  let rawAngles = parsed.nodes.map((n) => (n.span / totalSpan) * 2 * Math.PI);
  const tooSmall = rawAngles.filter((a) => a < MIN_ARC_ANGLE);
  if (tooSmall.length > 0 && tooSmall.length < nodeCount) {
    const deficit = tooSmall.reduce((sum, a) => sum + (MIN_ARC_ANGLE - a), 0);
    const largeTotal = rawAngles
      .filter((a) => a >= MIN_ARC_ANGLE)
      .reduce((sum, a) => sum + a, 0);

    rawAngles = rawAngles.map((a) => {
      if (a < MIN_ARC_ANGLE) return MIN_ARC_ANGLE;
      return a - (a / largeTotal) * deficit;
    });
  }

  // ── Compute radius that prevents node overlap ──
  const isClockwise = parsed.direction === 'clockwise';

  // For each pair of adjacent nodes, compute the minimum radius so they
  // don't overlap: the chord between adjacent centers must be >= sum of
  // their half-diagonals + a gap.
  const GAP = 20;
  let minRadiusForNodes = 0;
  for (let i = 0; i < nodeCount; i++) {
    const j = (i + 1) % nodeCount;
    const diA = Math.sqrt(nodeDims[i].width ** 2 + nodeDims[i].height ** 2) / 2;
    const diB = Math.sqrt(nodeDims[j].width ** 2 + nodeDims[j].height ** 2) / 2;
    const neededChord = diA + diB + GAP;
    // chord = 2 * r * sin(angle/2)  →  r = chord / (2 * sin(angle/2))
    const halfAngle = rawAngles[i] / 2;
    if (halfAngle > 0.001) {
      const r = neededChord / (2 * Math.sin(halfAngle));
      minRadiusForNodes = Math.max(minRadiusForNodes, r);
    }
  }

  // Max radius that fits in the canvas (leave room for the largest node)
  const maxNodeHalf = Math.max(
    ...nodeDims.map((d) => Math.max(d.width, d.height) / 2)
  );
  const maxRadius = Math.min(cx, cy) - maxNodeHalf - 10;

  let radius: number;
  let scale = 1;

  if (minRadiusForNodes <= maxRadius) {
    // Fill the available canvas — use maxRadius so the diagram scales up
    radius = Math.max(100, maxRadius);
  } else {
    // Nodes are too big to fit without overlap — shrink them
    radius = Math.max(80, maxRadius);
    scale = radius / minRadiusForNodes;
    // Scale down all node dimensions
    for (const d of nodeDims) {
      d.width = Math.max(50, d.width * scale);
      d.height = Math.max(30, d.height * scale);
    }
  }

  // ── Compute angular footprints for uniform edge-gap spacing ──
  // Iteratively refine: estimate footprints at current positions, redistribute
  // with uniform gaps, then recompute footprints at the new positions. Converges
  // in 2-3 iterations so positions and footprints are self-consistent.
  const nodeAngles = new Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    nodeAngles[i] =
      -Math.PI / 2 + i * ((2 * Math.PI) / nodeCount) * (isClockwise ? 1 : -1);
  }

  const ITERATIONS = 3;
  const footprints = new Array(nodeCount);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Compute footprints at current estimated positions
    for (let i = 0; i < nodeCount; i++) {
      const theta = nodeAngles[i];
      const approxX = cx + radius * Math.cos(theta);
      const approxY = cy + radius * Math.sin(theta);
      const hw = nodeDims[i].width / 2;
      const hh = nodeDims[i].height / 2;
      let exitCW: number, exitCCW: number;
      if (circleNodes) {
        const nodeR = hw; // width === height for circles
        exitCW = circleNodeExitAngle(nodeR, radius, theta, 1);
        exitCCW = circleNodeExitAngle(nodeR, radius, theta, -1);
      } else {
        exitCW = circleRectExitAngle(
          approxX,
          approxY,
          hw,
          hh,
          cx,
          cy,
          radius,
          theta,
          1
        );
        exitCCW = circleRectExitAngle(
          approxX,
          approxY,
          hw,
          hh,
          cx,
          cy,
          radius,
          theta,
          -1
        );
      }
      footprints[i] = Math.abs(exitCW - exitCCW);
    }

    // Distribute remaining arc as gaps (weighted by span)
    const totalFootprint = footprints.reduce(
      (s: number, f: number) => s + f,
      0
    );
    const totalGapAngle = Math.max(0, 2 * Math.PI - totalFootprint);
    const gapAngles = parsed.nodes.map(
      (n) => (n.span / totalSpan) * totalGapAngle
    );

    // Reposition nodes
    let cumAngle = -Math.PI / 2;
    for (let i = 0; i < nodeCount; i++) {
      nodeAngles[i] = cumAngle;
      const nextIdx = (i + 1) % nodeCount;
      const advance =
        footprints[i] / 2 + gapAngles[i] + footprints[nextIdx] / 2;
      cumAngle += isClockwise ? advance : -advance;
    }
  }

  // ── Build layout nodes at converged positions ──
  const layoutNodes: CycleLayoutNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const angle = nodeAngles[i];
    layoutNodes.push({
      label: parsed.nodes[i].label,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      angle,
      width: nodeDims[i].width,
      height: nodeDims[i].height,
      wrappedDesc: nodeDims[i].wrappedDesc,
      isCircle: circleNodes,
    });
  }

  // ── Compute edge paths ──
  let layoutEdges = computeEdgePaths(
    layoutNodes,
    parsed,
    cx,
    cy,
    radius,
    isClockwise
  );

  // ── Fit-to-canvas: shrink if edge labels overflow ──
  const fitResult = fitToCanvas(
    layoutNodes,
    layoutEdges,
    parsed,
    cx,
    cy,
    radius,
    width,
    height,
    isClockwise
  );
  if (fitResult) {
    radius = fitResult.radius;
    // Reposition nodes on the smaller circle
    for (let i = 0; i < nodeCount; i++) {
      layoutNodes[i].x = cx + radius * Math.cos(nodeAngles[i]);
      layoutNodes[i].y = cy + radius * Math.sin(nodeAngles[i]);
    }
    layoutEdges = computeEdgePaths(
      layoutNodes,
      parsed,
      cx,
      cy,
      radius,
      isClockwise
    );
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    cx,
    cy,
    radius,
    width,
    height,
    scale,
  };
}

// ── Helper: word-wrap lines ──

function wrapLines(lines: string[], charsPerLine: number): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const words = line.split(/\s+/);
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (test.length > charsPerLine && current) {
        result.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) result.push(current);
  }
  return result;
}

// ── Helper: circle node dimensions ──

function computeCircleNodeDims(
  node: { label: string; description: string[] },
  hasDesc: boolean
): { width: number; height: number; wrappedDesc: string[] } {
  if (!hasDesc) {
    // Label-only circle: radius fits the larger label text
    const textW = node.label.length * CIRCLE_LABEL_CHAR_W;
    const r = Math.max(MIN_CIRCLE_RADIUS, textW / 2 + CIRCLE_PAD);
    return { width: r * 2, height: r * 2, wrappedDesc: [] };
  }

  // With descriptions: iteratively find a circle radius that fits the text.
  // Start with a reasonable guess and grow until all text fits.
  let r = MIN_CIRCLE_RADIUS;

  for (let attempt = 0; attempt < 10; attempt++) {
    const wrappedDesc = wrapLinesForCircle(node.description, r);
    const totalLines = 1 + wrappedDesc.length; // label + desc lines
    const textBlockH = totalLines * DESC_LINE_HEIGHT + CIRCLE_PAD;

    // Check if text fits vertically within the circle
    if (textBlockH / 2 <= r * 0.85) {
      // Also check the label fits horizontally at its y-position (larger font)
      const labelW = node.label.length * CIRCLE_LABEL_CHAR_W;
      const labelY = -textBlockH / 2 + DESC_LINE_HEIGHT; // relative to center
      const availW = 2 * Math.sqrt(Math.max(0, r * r - labelY * labelY));
      if (labelW <= availW - CIRCLE_PAD) {
        return { width: r * 2, height: r * 2, wrappedDesc };
      }
    }
    r += 10;
  }

  const wrappedDesc = wrapLinesForCircle(node.description, r);
  return { width: r * 2, height: r * 2, wrappedDesc };
}

/**
 * Wrap description lines to fit inside a circle of given radius.
 * Each line gets a different max width based on its vertical position
 * within the circle — wider at the center, narrower near edges.
 */
function wrapLinesForCircle(descriptions: string[], radius: number): string[] {
  // First pass: wrap with center-width to estimate line count
  const centerWidth = radius * 2 * 0.75;
  const centerChars = Math.max(8, Math.floor(centerWidth / DESC_CHAR_W));
  const roughWrapped = wrapLines(descriptions, centerChars);
  const totalLines = 1 + roughWrapped.length; // +1 for label line
  const blockH = totalLines * DESC_LINE_HEIGHT;

  // Second pass: re-wrap each source line with position-aware width
  const result: string[] = [];
  let lineIdx = 1; // start after label line
  for (const srcLine of descriptions) {
    const words = srcLine.split(/\s+/);
    let current = '';
    for (const word of words) {
      // Compute available width at this line's y position
      const y = -blockH / 2 + (lineIdx + 0.5) * DESC_LINE_HEIGHT;
      const rSq = radius * radius;
      const availPx =
        y * y < rSq ? 2 * Math.sqrt(rSq - y * y) - CIRCLE_PAD * 2 : centerWidth;
      const maxChars = Math.max(6, Math.floor(availPx / DESC_CHAR_W));

      const test = current ? `${current} ${word}` : word;
      if (test.length > maxChars && current) {
        result.push(current);
        lineIdx++;
        current = word;
      } else {
        current = test;
      }
    }
    if (current) {
      result.push(current);
      lineIdx++;
    }
  }
  return result;
}

// ── Circle-circle intersection exit angle ──

/**
 * For a circular node of radius `nodeR` centered on the cycle circle of radius
 * `cycleR`, compute the angle where the cycle circle exits the node boundary.
 * Uses the law of cosines: the half-angle subtended at the cycle center is
 * arccos(1 - nodeR²/(2·cycleR²)).
 */
function circleNodeExitAngle(
  nodeR: number,
  cycleR: number,
  nodeAngle: number,
  direction: number
): number {
  // Law of cosines in the triangle: cycle-center, node-center, intersection-point
  // sides: R (to intersection), R (to node center), nodeR (node center to intersection)
  // cos(α) = (R² + R² - nodeR²) / (2·R·R) = 1 - nodeR²/(2·R²)
  const cosAlpha = Math.max(
    -1,
    Math.min(1, 1 - (nodeR * nodeR) / (2 * cycleR * cycleR))
  );
  const halfAngle = Math.acos(cosAlpha);
  return nodeAngle + direction * halfAngle;
}

/** Is the point (px, py) inside the rect centered at (rx, ry) with half-dims (hw, hh)? */
function insideRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  hw: number,
  hh: number
): boolean {
  return Math.abs(px - rx) < hw && Math.abs(py - ry) < hh;
}

/**
 * Find the exact angle where the circle exits the node rect boundary.
 * Uses coarse walk + binary search refinement for pixel-accurate results.
 */
function circleRectExitAngle(
  nodeCx: number,
  nodeCy: number,
  halfW: number,
  halfH: number,
  circleCx: number,
  circleCy: number,
  radius: number,
  nodeAngle: number,
  direction: number // +1 or -1
): number {
  // Coarse walk to find the first angle outside the rect
  const steps = 90;
  const maxSweep = Math.PI;
  const step = maxSweep / steps;
  let insideAngle = nodeAngle;
  let outsideAngle = nodeAngle + direction * step;

  for (let i = 1; i <= steps; i++) {
    const angle = nodeAngle + direction * step * i;
    const px = circleCx + radius * Math.cos(angle);
    const py = circleCy + radius * Math.sin(angle);
    if (!insideRect(px, py, nodeCx, nodeCy, halfW, halfH)) {
      outsideAngle = angle;
      insideAngle = nodeAngle + direction * step * (i - 1);
      break;
    }
  }

  // Binary search between insideAngle and outsideAngle for exact boundary
  for (let i = 0; i < 16; i++) {
    const mid = (insideAngle + outsideAngle) / 2;
    const px = circleCx + radius * Math.cos(mid);
    const py = circleCy + radius * Math.sin(mid);
    if (insideRect(px, py, nodeCx, nodeCy, halfW, halfH)) {
      insideAngle = mid;
    } else {
      outsideAngle = mid;
    }
  }

  // Return the boundary crossing point (midpoint of final bracket)
  return (insideAngle + outsideAngle) / 2;
}

/** Default edge stroke width (must match renderer). */
const DEFAULT_EDGE_WIDTH = 3;
/** Arrowhead marker width in stroke-width units (must match renderer). */
const ARROWHEAD_MARKER_W = 8;

/** Compute edge paths for all edges in the parsed diagram. */
function computeEdgePaths(
  layoutNodes: CycleLayoutNode[],
  parsed: ParsedCycle,
  cx: number,
  cy: number,
  radius: number,
  isClockwise: boolean
): CycleLayoutEdge[] {
  return parsed.edges.map((edge) => {
    const src = layoutNodes[edge.sourceIndex];
    const tgt = layoutNodes[edge.targetIndex];
    const strokeWidth = edge.width ?? DEFAULT_EDGE_WIDTH;
    // Arrowhead rendered length in pixels (markerUnits = strokeWidth)
    const arrowLen = ARROWHEAD_MARKER_W * strokeWidth;
    const { path, labelX, labelY, labelAngle } = buildEdgeArc(
      src,
      tgt,
      cx,
      cy,
      radius,
      isClockwise,
      arrowLen
    );
    return {
      sourceIndex: edge.sourceIndex,
      targetIndex: edge.targetIndex,
      path,
      labelX,
      labelY,
      labelAngle,
      label: edge.label,
    };
  });
}

/** Estimated character width at 11px edge label font. */
const EDGE_LABEL_CHAR_W = 7;

/**
 * Check if edge labels overflow the canvas and return a reduced radius if needed.
 * Returns null if everything fits.
 */
function fitToCanvas(
  nodes: CycleLayoutNode[],
  edges: CycleLayoutEdge[],
  parsed: ParsedCycle,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  height: number,
  _isClockwise: boolean
): { radius: number } | null {
  const PADDING = 10;
  let contentMinX = Infinity,
    contentMaxX = -Infinity;
  let contentMinY = Infinity,
    contentMaxY = -Infinity;

  // Node extents
  for (const n of nodes) {
    contentMinX = Math.min(contentMinX, n.x - n.width / 2);
    contentMaxX = Math.max(contentMaxX, n.x + n.width / 2);
    contentMinY = Math.min(contentMinY, n.y - n.height / 2);
    contentMaxY = Math.max(contentMaxY, n.y + n.height / 2);
  }

  // Edge label extents (estimate text width from character count)
  for (let i = 0; i < edges.length; i++) {
    const le = edges[i];
    const edge = parsed.edges[i];

    let maxLineLen = 0;
    if (le.label) maxLineLen = Math.max(maxLineLen, le.label.length);
    for (const desc of edge.description) {
      maxLineLen = Math.max(maxLineLen, desc.length);
    }
    if (maxLineLen === 0) continue;

    const textWidth = maxLineLen * EDGE_LABEL_CHAR_W;

    // Determine text-anchor direction from label angle (mirrors renderer logic)
    const normAngle =
      ((le.labelAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const isRight = normAngle < Math.PI * 0.4 || normAngle > Math.PI * 1.6;
    const isLeft = normAngle > Math.PI * 0.6 && normAngle < Math.PI * 1.4;

    let labelLeft: number, labelRight: number;
    if (isRight) {
      labelLeft = le.labelX;
      labelRight = le.labelX + textWidth;
    } else if (isLeft) {
      labelLeft = le.labelX - textWidth;
      labelRight = le.labelX;
    } else {
      labelLeft = le.labelX - textWidth / 2;
      labelRight = le.labelX + textWidth / 2;
    }

    contentMinX = Math.min(contentMinX, labelLeft);
    contentMaxX = Math.max(contentMaxX, labelRight);

    // Vertical: rough estimate for multi-line labels
    let lineCount = le.label ? 1 : 0;
    lineCount += edge.description.length;
    contentMinY = Math.min(contentMinY, le.labelY - 12);
    contentMaxY = Math.max(contentMaxY, le.labelY + (lineCount - 1) * 15);
  }

  // Check overflow
  const overflowX =
    Math.max(0, PADDING - contentMinX) +
    Math.max(0, contentMaxX - (width - PADDING));
  const overflowY =
    Math.max(0, PADDING - contentMinY) +
    Math.max(0, contentMaxY - (height - PADDING));

  if (overflowX <= 0 && overflowY <= 0) return null;

  // Shrink radius proportionally to eliminate overflow
  const contentW = contentMaxX - contentMinX;
  const contentH = contentMaxY - contentMinY;
  const availW = width - 2 * PADDING;
  const availH = height - 2 * PADDING;
  const shrink = Math.min(availW / contentW, availH / contentH);
  const newRadius = Math.max(80, radius * shrink);

  return { radius: newRadius };
}

/**
 * Build an SVG arc path that follows the circle circumference between two nodes.
 * Uses SVG `A` (arc) command so the edge traces the actual circle, not a chord.
 * Start/end points are computed as the exact intersection of the circle with
 * each node's boundary (rect or circle) — no gaps.
 */
function buildEdgeArc(
  src: CycleLayoutNode,
  tgt: CycleLayoutNode,
  cx: number,
  cy: number,
  radius: number,
  isClockwise: boolean,
  arrowLength: number = 0
): { path: string; labelX: number; labelY: number; labelAngle: number } {
  const dir = isClockwise ? 1 : -1;

  // Find where the cycle circle exits the source node
  const startAngle = src.isCircle
    ? circleNodeExitAngle(src.width / 2, radius, src.angle, dir)
    : circleRectExitAngle(
        src.x,
        src.y,
        src.width / 2,
        src.height / 2,
        cx,
        cy,
        radius,
        src.angle,
        dir
      );

  // Find where the cycle circle exits the target node
  const nodeEndAngle = tgt.isCircle
    ? circleNodeExitAngle(tgt.width / 2, radius, tgt.angle, -dir)
    : circleRectExitAngle(
        tgt.x,
        tgt.y,
        tgt.width / 2,
        tgt.height / 2,
        cx,
        cy,
        radius,
        tgt.angle,
        -dir
      );

  // Pull back the path endpoint by the arrowhead length so the stroke
  // stops at the arrow base (refX=0 means arrow extends forward from endpoint)
  const arrowPullback = arrowLength > 0 ? arrowLength / radius : 0;
  const endAngle = nodeEndAngle - dir * arrowPullback;

  const startX = cx + radius * Math.cos(startAngle);
  const startY = cy + radius * Math.sin(startAngle);
  const endX = cx + radius * Math.cos(endAngle);
  const endY = cy + radius * Math.sin(endAngle);

  // Compute effective sweep for large-arc-flag
  let effectiveSweep = (endAngle - startAngle) * dir;
  if (effectiveSweep <= 0) effectiveSweep += 2 * Math.PI;

  const largeArc = effectiveSweep > Math.PI ? 1 : 0;
  const sweepFlag = isClockwise ? 1 : 0;

  const path = `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${endX} ${endY}`;

  // Label position: pushed outward from the arc midpoint
  const midAngle = startAngle + (dir * effectiveSweep) / 2;
  const LABEL_OUTWARD_OFFSET = 16;
  const labelR = radius + LABEL_OUTWARD_OFFSET;
  const labelX = cx + labelR * Math.cos(midAngle);
  const labelY = cy + labelR * Math.sin(midAngle);

  return { path, labelX, labelY, labelAngle: midAngle };
}
