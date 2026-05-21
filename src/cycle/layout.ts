// ============================================================
// Cycle Diagram — Layout Engine
// ============================================================

import {
  DEFAULT_EDGE_WIDTH,
  MIN_EDGE_WIDTH,
  arrowHeadLength,
  type ParsedCycle,
  type CycleLayoutNode,
  type CycleLayoutEdge,
  type CycleLayoutResult,
} from './types';
import {
  wrapDescriptionLines,
  type WrappedDescLine,
} from '../utils/wrapped-desc';

/** Minimum arc angle in radians (~15°) to keep arcs readable. */
const MIN_ARC_ANGLE = (15 * Math.PI) / 180;

/** Estimated character width at 13px label font. */
const LABEL_CHAR_W = 8;

/** Estimated character width at 16px circle label font. */
const CIRCLE_LABEL_CHAR_W = 10;

/**
 * Estimated character width at 11px description font (Inter).
 * Average glyph width is ~5.5–6.0 px for typical English text — using 6.0
 * gives us a small margin of safety for wide glyphs (m, w) without leaving
 * obvious dead space on the right side of the rectangle.
 */
const DESC_CHAR_W = 6.0;

/** Minimum node width. */
const MIN_NODE_WIDTH = 70;

/** Maximum node width. */
const MAX_NODE_WIDTH = 260;

/** Minimum width to consider for described nodes (avoid ultra-narrow columns). */
const DESC_MIN_WIDTH = 140;

/** Width sweep step when choosing the best aspect ratio for described nodes. */
const DESC_WIDTH_STEP = 20;

/** Target width:height ratio for described rectangular nodes. */
const DESC_TARGET_RATIO = 1.6;

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
        wrappedDesc: [] as WrappedDescLine[],
      };
    }

    return chooseDescribedRectDims(node.description, labelWidth);
  });

  // ── Uniform circle sizing: all circles match the largest ──
  if (circleNodes) {
    const maxDiam = Math.max(...nodeDims.map((d) => d.width));
    for (const d of nodeDims) {
      d.width = maxDiam;
      d.height = maxDiam;
      // Re-wrap descriptions to fit the larger circle
      const nodeIdx = nodeDims.indexOf(d);
      // In-bounds: nodeDims is built 1:1 from parsed.nodes.
      const node = parsed.nodes[nodeIdx]!;
      const hasDesc = !hideDescriptions && node.description.length > 0;
      if (hasDesc) {
        d.wrappedDesc = wrapLinesForCircle(node.description, maxDiam / 2).map(
          (text) => ({ text, kind: 'plain' as const })
        );
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
    // In-bounds: i and j are within [0, nodeCount), nodeDims.length === nodeCount.
    const diA =
      Math.sqrt(nodeDims[i]!.width ** 2 + nodeDims[i]!.height ** 2) / 2;
    const diB =
      Math.sqrt(nodeDims[j]!.width ** 2 + nodeDims[j]!.height ** 2) / 2;
    const neededChord = diA + diB + GAP;
    // chord = 2 * r * sin(angle/2)  →  r = chord / (2 * sin(angle/2))
    const halfAngle = rawAngles[i]! / 2;
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
    // Scale down all node dimensions and re-wrap descriptions so text always
    // fits inside the shrunk rectangle (font scales linearly in the renderer,
    // so chars-per-line stays roughly constant — but line *count* must match
    // the new height budget).
    for (let i = 0; i < nodeDims.length; i++) {
      // In-bounds by loop guard; nodeDims and parsed.nodes are parallel arrays.
      const d = nodeDims[i]!;
      const node = parsed.nodes[i]!;
      const hasDesc = !hideDescriptions && node.description.length > 0;
      const newW = Math.max(50, d.width * scale);
      if (circleNodes) {
        d.width = newW;
        d.height = newW;
        if (hasDesc) {
          d.wrappedDesc = wrapLinesForCircle(node.description, newW / 2).map(
            (text) => ({ text, kind: 'plain' as const })
          );
        }
      } else if (hasDesc) {
        d.width = newW;
        // Re-wrap at the unscaled width: layout-space char count stays
        // constant under uniform font scaling, so wrap on d.width / scale,
        // which equals the original chosen width in pre-scale units.
        const layoutWidth = newW / scale;
        d.wrappedDesc = wrapDescForWidth(node.description, layoutWidth);
        d.height = renderedDescNodeHeight(d.wrappedDesc.length, scale);
      } else {
        d.width = newW;
        d.height = Math.max(30, d.height * scale);
      }
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
      // In-bounds by loop guard.
      const hw = nodeDims[i]!.width / 2;
      const hh = nodeDims[i]!.height / 2;
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
      // In-bounds: i, nextIdx in [0, nodeCount); arrays sized to nodeCount.
      const advance =
        footprints[i] / 2 + gapAngles[i]! + footprints[nextIdx] / 2;
      cumAngle += isClockwise ? advance : -advance;
    }
  }

  // ── Build layout nodes at converged positions ──
  const layoutNodes: CycleLayoutNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    // In-bounds by loop guard; all arrays sized to nodeCount.
    const angle = nodeAngles[i];
    layoutNodes.push({
      label: parsed.nodes[i]!.label,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      angle,
      width: nodeDims[i]!.width,
      height: nodeDims[i]!.height,
      wrappedDesc: nodeDims[i]!.wrappedDesc,
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
      // In-bounds by loop guard.
      layoutNodes[i]!.x = cx + radius * Math.cos(nodeAngles[i]);
      layoutNodes[i]!.y = cy + radius * Math.sin(nodeAngles[i]);
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

/**
 * Choose width + height for a described rectangular node by sweeping candidate
 * widths and picking the one whose resulting aspect ratio is closest to
 * DESC_TARGET_RATIO. Width grows with content so long descriptions get wider
 * boxes instead of tall thin columns.
 */
function chooseDescribedRectDims(
  description: string[],
  labelWidth: number
): { width: number; height: number; wrappedDesc: WrappedDescLine[] } {
  const minW = Math.min(
    MAX_NODE_WIDTH,
    Math.max(MIN_NODE_WIDTH, labelWidth, DESC_MIN_WIDTH)
  );
  let best: {
    width: number;
    height: number;
    wrappedDesc: WrappedDescLine[];
  } | null = null;
  let bestScore = Infinity;
  for (let w = minW; w <= MAX_NODE_WIDTH; w += DESC_WIDTH_STEP) {
    const wrapped = wrapDescForWidth(description, w);
    const h = HEADER_HEIGHT + wrapped.length * DESC_LINE_HEIGHT + DESC_PAD_Y;
    const ratio = w / h;
    const score = Math.abs(Math.log(ratio / DESC_TARGET_RATIO));
    if (score < bestScore) {
      bestScore = score;
      best = { width: w, height: h, wrappedDesc: wrapped };
    }
  }
  if (best) return best;
  const wrapped = wrapDescForWidth(description, minW);
  return {
    width: minW,
    height: HEADER_HEIGHT + wrapped.length * DESC_LINE_HEIGHT + DESC_PAD_Y,
    wrappedDesc: wrapped,
  };
}

/** Wrap description lines for a rect node of the given total width. */
function wrapDescForWidth(
  description: string[],
  nodeWidth: number
): WrappedDescLine[] {
  const textWidth = nodeWidth - NODE_PAD_X * 2;
  const charsPerLine = Math.max(8, Math.floor(textWidth / DESC_CHAR_W));
  return wrapDescriptionLines(description, charsPerLine);
}

// ── Renderer-aligned font/line-height clamps ──
// These mirror the floor clamps in cycle/renderer.ts so the layout's reserved
// height always matches what the renderer actually draws — preventing the
// "text spills out the bottom of the box" bug at small scales.
const RENDERER_DESC_FONT = 11;
const RENDERER_DESC_FONT_MIN = 8;
const RENDERER_DESC_LINE_H = 15;
const RENDERER_DESC_LINE_H_MIN = 11;

/**
 * Reserved height for a rectangular described node at the given scale,
 * computed using the renderer's clamped font + line-height so text always
 * fits inside the rectangle even when scale is small enough to trigger the
 * renderer's minimum-size clamps.
 */
function renderedDescNodeHeight(numLines: number, scale: number): number {
  const headerH = HEADER_HEIGHT * scale;
  const descFont = Math.max(
    RENDERER_DESC_FONT_MIN,
    Math.round(RENDERER_DESC_FONT * scale)
  );
  const descLineH = Math.max(
    RENDERER_DESC_LINE_H_MIN,
    Math.round(RENDERER_DESC_LINE_H * scale)
  );
  // Renderer: descStartY = sepY + 4 + scaledDescFont, then (N-1) more lines
  // at scaledDescLineH. Add a small bottom pad so the last descender clears
  // the box border.
  const textBlockH = 4 + descFont + (numLines - 1) * descLineH;
  const bottomPad = 8;
  return headerH + textBlockH + bottomPad;
}

// ── Edge-label wrapping (shared with renderer) ──

/**
 * Maximum characters per line for edge labels and edge descriptions.
 * Long single-line text gets wrapped to multiple lines so it doesn't
 * shoot off-canvas when positioned at a cycle quadrant.
 */
export const EDGE_LABEL_MAX_CHARS = 32;

/**
 * Wrap an edge label string + description lines into rendered lines.
 * Used by both layout (for fit-to-canvas sizing) and renderer (for drawing).
 * The label, if present, is the first wrapped block; each description string
 * is its own wrapped block. Empty strings are filtered.
 */
export function wrapEdgeLabelText(
  label: string | undefined,
  description: string[],
  maxChars: number = EDGE_LABEL_MAX_CHARS
): { labelLines: string[]; descLines: string[] } {
  const labelLines = label ? wrapLines([label], maxChars) : [];
  const descLines: string[] = [];
  for (const d of description) {
    descLines.push(...wrapLines([d], maxChars));
  }
  return { labelLines, descLines };
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
): { width: number; height: number; wrappedDesc: WrappedDescLine[] } {
  if (!hasDesc) {
    const textW = node.label.length * CIRCLE_LABEL_CHAR_W;
    const r = Math.max(MIN_CIRCLE_RADIUS, textW / 2 + CIRCLE_PAD);
    return { width: r * 2, height: r * 2, wrappedDesc: [] };
  }

  let r = MIN_CIRCLE_RADIUS;

  for (let attempt = 0; attempt < 10; attempt++) {
    const wrappedDesc = wrapLinesForCircle(node.description, r);
    const totalLines = 1 + wrappedDesc.length;
    const textBlockH = totalLines * DESC_LINE_HEIGHT + CIRCLE_PAD;

    if (textBlockH / 2 <= r * 0.85) {
      const labelW = node.label.length * CIRCLE_LABEL_CHAR_W;
      const labelY = -textBlockH / 2 + DESC_LINE_HEIGHT;
      const availW = 2 * Math.sqrt(Math.max(0, r * r - labelY * labelY));
      if (labelW <= availW - CIRCLE_PAD) {
        return {
          width: r * 2,
          height: r * 2,
          wrappedDesc: wrappedDesc.map((text) => ({
            text,
            kind: 'plain' as const,
          })),
        };
      }
    }
    r += 10;
  }

  const wrappedDesc = wrapLinesForCircle(node.description, r);
  return {
    width: r * 2,
    height: r * 2,
    wrappedDesc: wrappedDesc.map((text) => ({ text, kind: 'plain' as const })),
  };
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
    // In-bounds: sourceIndex/targetIndex are validated by the parser to point into nodes.
    const src = layoutNodes[edge.sourceIndex]!;
    const tgt = layoutNodes[edge.targetIndex]!;
    const strokeWidth = Math.max(
      edge.width ?? DEFAULT_EDGE_WIDTH,
      MIN_EDGE_WIDTH
    );
    // Arrowhead effective reach: full length minus the 10% overlap that
    // slides the marker back to cover the stroke/arrowhead junction line.
    const arrowLen = arrowHeadLength(strokeWidth) * 0.9;
    const { path, midAngle } = buildEdgeArc(
      src,
      tgt,
      cx,
      cy,
      radius,
      isClockwise,
      arrowLen
    );

    // Smart label placement: scale offset with label size and pick whichever
    // side of the arc (outward toward canvas edge, inward toward center) has
    // the most clearance from node bounding boxes.
    const { labelLines, descLines } = wrapEdgeLabelText(
      edge.label,
      edge.description
    );
    const lineCount = labelLines.length + descLines.length;
    let maxCharLen = 0;
    for (const l of labelLines) maxCharLen = Math.max(maxCharLen, l.length);
    for (const l of descLines) maxCharLen = Math.max(maxCharLen, l.length);
    const { labelX, labelY, labelAngle } = computeEdgeLabelPosition(
      midAngle,
      radius,
      cx,
      cy,
      lineCount,
      maxCharLen,
      layoutNodes
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

/**
 * Position an edge label so its inner corner (the corner of the text bbox
 * closest to the cycle center) sits exactly `EDGE_LABEL_CORNER_OFFSET`
 * pixels radially outward from the arc midpoint. The bbox extends from that
 * corner *away* from the cycle, into the empty quadrant between adjacent
 * nodes — so the label visibly belongs to the arrow, not to either node.
 *
 * For mostly-vertical arc midpoints (top/bottom of the cycle) the bbox is
 * centered horizontally on the radial axis. If the resulting placement still
 * overlaps a node, we flip to inward placement (corner toward center) and
 * adjust labelAngle so the renderer's text-anchor logic points text away
 * from the ring.
 */
function computeEdgeLabelPosition(
  midAngle: number,
  radius: number,
  cx: number,
  cy: number,
  lineCount: number,
  maxCharLen: number,
  layoutNodes: CycleLayoutNode[]
): { labelX: number; labelY: number; labelAngle: number } {
  if (lineCount === 0 || maxCharLen === 0) {
    return {
      labelX: cx + radius * Math.cos(midAngle),
      labelY: cy + radius * Math.sin(midAngle),
      labelAngle: midAngle,
    };
  }

  const EDGE_LABEL_CORNER_OFFSET = 10;
  const labelW = maxCharLen * EDGE_LABEL_CHAR_W;
  const labelH = lineCount * 15;
  const cosT = Math.cos(midAngle);
  const sinT = Math.sin(midAngle);

  type Placement = {
    labelX: number;
    labelY: number;
    labelAngle: number;
    bbX1: number;
    bbX2: number;
    bbY1: number;
    bbY2: number;
    overlap: number;
  };

  function place(sign: 1 | -1): Placement {
    // Inner corner of bbox = arc midpoint M + sign * offset along radial.
    // sign=+1: bbox extends outward (corner inside the cycle, body outside).
    // sign=-1: bbox extends inward (corner outside the cycle, body toward
    // center) — used as fallback when outward overlaps a node.
    const cornerX = cx + (radius + sign * EDGE_LABEL_CORNER_OFFSET) * cosT;
    const cornerY = cy + (radius + sign * EDGE_LABEL_CORNER_OFFSET) * sinT;

    // Bbox extends from inner corner in the direction opposite the cycle
    // center (when sign=+1) or toward the center (sign=-1). Treated axis-
    // aligned: x extends in sign(cosT), y extends in sign(sinT), each scaled
    // by `sign`.
    const ROUND_THRESH = 0.3;
    const radialX = sign * cosT;
    const radialY = sign * sinT;
    const sx = Math.abs(radialX) < ROUND_THRESH ? 0 : Math.sign(radialX);
    const sy = Math.abs(radialY) < ROUND_THRESH ? 0 : Math.sign(radialY);

    const bboxCx = cornerX + (sx * labelW) / 2;
    const bboxCy = cornerY + (sy * labelH) / 2;

    // Map bbox sx → text-anchor: +1 right (start), -1 left (end), 0 middle.
    let labelX: number;
    if (sx > 0) labelX = bboxCx - labelW / 2;
    else if (sx < 0) labelX = bboxCx + labelW / 2;
    else labelX = bboxCx;

    // First-line baseline ≈ top of bbox + 12 (font ascent).
    const labelY = bboxCy - labelH / 2 + 12;

    const bbX1 = bboxCx - labelW / 2;
    const bbX2 = bboxCx + labelW / 2;
    const bbY1 = bboxCy - labelH / 2;
    const bbY2 = bboxCy + labelH / 2;

    let overlap = 0;
    for (const n of layoutNodes) {
      const nx1 = n.x - n.width / 2;
      const nx2 = n.x + n.width / 2;
      const ny1 = n.y - n.height / 2;
      const ny2 = n.y + n.height / 2;
      const ox = Math.max(0, Math.min(bbX2, nx2) - Math.max(bbX1, nx1));
      const oy = Math.max(0, Math.min(bbY2, ny2) - Math.max(bbY1, ny1));
      overlap += ox * oy;
    }

    // For inward placement, flip labelAngle by π so the renderer's anchor
    // logic (driven by labelAngle quadrant) picks an anchor consistent with
    // text growing toward the cycle center rather than away.
    const labelAngle = sign === 1 ? midAngle : midAngle + Math.PI;
    return { labelX, labelY, labelAngle, bbX1, bbX2, bbY1, bbY2, overlap };
  }

  const outward = place(1);
  if (outward.overlap === 0) {
    return {
      labelX: outward.labelX,
      labelY: outward.labelY,
      labelAngle: outward.labelAngle,
    };
  }
  const inward = place(-1);
  const best = inward.overlap < outward.overlap ? inward : outward;
  return {
    labelX: best.labelX,
    labelY: best.labelY,
    labelAngle: best.labelAngle,
  };
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
  _cx: number,
  _cy: number,
  radius: number,
  width: number,
  height: number,
  _isClockwise: boolean
): { radius: number } | null {
  const PADDING = 30;
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

  // Edge label extents (estimate text width from character count, accounting
  // for line-wrapping that the renderer will apply to long edge labels).
  for (let i = 0; i < edges.length; i++) {
    // In-bounds by loop guard; edges and parsed.edges are parallel arrays.
    const le = edges[i]!;
    const edge = parsed.edges[i]!;

    const { labelLines, descLines } = wrapEdgeLabelText(
      le.label,
      edge.description
    );
    let maxLineLen = 0;
    for (const l of labelLines) maxLineLen = Math.max(maxLineLen, l.length);
    for (const l of descLines) maxLineLen = Math.max(maxLineLen, l.length);
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

    // Vertical: account for wrapped label + description line counts
    const lineCount = labelLines.length + descLines.length;
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
): { path: string; midAngle: number } {
  const dir = isClockwise ? 1 : -1;

  // Path starts at source center (covered by source node), but the *visible*
  // arrow starts where the ring exits the source's boundary. Compute both:
  // the path's startAngle for SVG, and srcExitAngle for the visible midpoint.
  const startAngle = src.angle;
  const srcExitAngle = src.isCircle
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

  // Where the cycle circle enters the target node (visible end of arrow).
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
  // stops at the arrow base.
  const arrowPullback = arrowLength > 0 ? arrowLength / radius : 0;
  const endAngle = nodeEndAngle - dir * arrowPullback;

  const startX = cx + radius * Math.cos(startAngle);
  const startY = cy + radius * Math.sin(startAngle);
  const endX = cx + radius * Math.cos(endAngle);
  const endY = cy + radius * Math.sin(endAngle);

  let effectiveSweep = (endAngle - startAngle) * dir;
  if (effectiveSweep <= 0) effectiveSweep += 2 * Math.PI;

  const largeArc = effectiveSweep > Math.PI ? 1 : 0;
  const sweepFlag = isClockwise ? 1 : 0;

  const path = `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${endX} ${endY}`;

  // Visible-arrow midpoint: between where the ring leaves the source rectangle
  // and where it enters the target rectangle (after arrow pullback). For
  // asymmetric nodes this differs noticeably from the geometric path midpoint.
  let visibleSweep = (nodeEndAngle - srcExitAngle) * dir;
  if (visibleSweep <= 0) visibleSweep += 2 * Math.PI;
  const midAngle = srcExitAngle + (dir * visibleSweep) / 2;
  return { path, midAngle };
}
