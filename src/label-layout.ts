// ---------------------------------------------------------------------------
// Shared label collision detection and placement utilities
// ---------------------------------------------------------------------------

export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PointCircle {
  cx: number;
  cy: number;
  r: number;
}

/** Axis-aligned bounding box overlap test. */
export function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/** Rect vs circle overlap using nearest-point-on-rect distance check. */
export function rectCircleOverlap(
  rect: LabelRect,
  circle: PointCircle
): boolean {
  const nearestX = Math.max(rect.x, Math.min(circle.cx, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(circle.cy, rect.y + rect.h));
  const dx = nearestX - circle.cx;
  const dy = nearestY - circle.cy;
  return dx * dx + dy * dy < circle.r * circle.r;
}

// ---------------------------------------------------------------------------
// Quadrant chart point label placement
// ---------------------------------------------------------------------------

const CHAR_WIDTH_RATIO = 0.6;

export interface QuadrantLabelPoint {
  label: string;
  cx: number; // pixel x
  cy: number; // pixel y
}

export interface PlacedQuadrantLabel {
  label: string;
  x: number; // text x
  y: number; // text y (center of label)
  anchor: 'middle' | 'start' | 'end';
  connectorLine?: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * Greedy label placement for quadrant chart points.
 * Avoids collisions with other point labels, point circles, and obstacle rects
 * (quadrant watermark labels). Labels are constrained within chartBounds.
 *
 * Pure function — no DOM dependency.
 */
export function computeQuadrantPointLabels(
  points: QuadrantLabelPoint[],
  chartBounds: { left: number; top: number; right: number; bottom: number },
  obstacles: LabelRect[],
  pointRadius: number,
  fontSize: number
): PlacedQuadrantLabel[] {
  const labelHeight = fontSize + 4;
  const stepSize = labelHeight + 2;
  const minGap = pointRadius + 4;

  // Build collision circles for all points
  const pointCircles: PointCircle[] = points.map((p) => ({
    cx: p.cx,
    cy: p.cy,
    r: pointRadius,
  }));

  const placedLabels: LabelRect[] = [];
  const results: PlacedQuadrantLabel[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const labelWidth = pt.label.length * fontSize * CHAR_WIDTH_RATIO + 8;

    // Try 4 directions: above, below, left, right
    // Each direction generates candidate (labelX, labelY, anchor)
    type Candidate = {
      rect: LabelRect;
      textX: number;
      textY: number;
      anchor: 'middle' | 'start' | 'end';
      dist: number;
    };

    let best: Candidate | null = null;

    // Direction generators: for a given offset, produce a candidate rect + text position
    const directions: Array<{
      gen: (offset: number) => {
        rect: LabelRect;
        textX: number;
        textY: number;
        anchor: 'middle' | 'start' | 'end';
      } | null;
    }> = [
      {
        // Above
        gen: (offset) => {
          const lx = pt.cx - labelWidth / 2;
          const ly = pt.cy - offset - labelHeight;
          if (
            ly < chartBounds.top ||
            lx < chartBounds.left ||
            lx + labelWidth > chartBounds.right
          )
            return null;
          return {
            rect: { x: lx, y: ly, w: labelWidth, h: labelHeight },
            textX: pt.cx,
            textY: ly + labelHeight / 2,
            anchor: 'middle',
          };
        },
      },
      {
        // Below
        gen: (offset) => {
          const lx = pt.cx - labelWidth / 2;
          const ly = pt.cy + offset;
          if (
            ly + labelHeight > chartBounds.bottom ||
            lx < chartBounds.left ||
            lx + labelWidth > chartBounds.right
          )
            return null;
          return {
            rect: { x: lx, y: ly, w: labelWidth, h: labelHeight },
            textX: pt.cx,
            textY: ly + labelHeight / 2,
            anchor: 'middle',
          };
        },
      },
      {
        // Right
        gen: (offset) => {
          const lx = pt.cx + offset;
          const ly = pt.cy - labelHeight / 2;
          if (
            lx + labelWidth > chartBounds.right ||
            ly < chartBounds.top ||
            ly + labelHeight > chartBounds.bottom
          )
            return null;
          return {
            rect: { x: lx, y: ly, w: labelWidth, h: labelHeight },
            textX: lx,
            textY: pt.cy,
            anchor: 'start',
          };
        },
      },
      {
        // Left
        gen: (offset) => {
          const lx = pt.cx - offset - labelWidth;
          const ly = pt.cy - labelHeight / 2;
          if (
            lx < chartBounds.left ||
            ly < chartBounds.top ||
            ly + labelHeight > chartBounds.bottom
          )
            return null;
          return {
            rect: { x: lx, y: ly, w: labelWidth, h: labelHeight },
            textX: lx + labelWidth,
            textY: pt.cy,
            anchor: 'end',
          };
        },
      },
    ];

    for (const { gen } of directions) {
      for (let offset = minGap; ; offset += stepSize) {
        const cand = gen(offset);
        if (!cand) break; // out of bounds in this direction

        // Check collisions with placed labels
        let collision = false;
        for (const pl of placedLabels) {
          if (rectsOverlap(cand.rect, pl)) {
            collision = true;
            break;
          }
        }

        // Check collisions with point circles
        if (!collision) {
          for (const circle of pointCircles) {
            if (rectCircleOverlap(cand.rect, circle)) {
              collision = true;
              break;
            }
          }
        }

        // Check collisions with obstacle rects (quadrant labels)
        if (!collision) {
          for (const obs of obstacles) {
            if (rectsOverlap(cand.rect, obs)) {
              collision = true;
              break;
            }
          }
        }

        if (!collision) {
          const dist = offset;
          if (!best || dist < best.dist) {
            best = {
              rect: cand.rect,
              textX: cand.textX,
              textY: cand.textY,
              anchor: cand.anchor,
              dist,
            };
          }
          break; // best for this direction found
        }
      }
    }

    // Fallback: place above at minGap (may overlap, but at least visible)
    if (!best) {
      const lx = pt.cx - labelWidth / 2;
      const ly = pt.cy - minGap - labelHeight;
      best = {
        rect: { x: lx, y: ly, w: labelWidth, h: labelHeight },
        textX: pt.cx,
        textY: ly + labelHeight / 2,
        anchor: 'middle',
        dist: minGap,
      };
    }

    placedLabels.push(best.rect);

    // Connector line when label is pushed beyond immediate adjacency
    let connectorLine: PlacedQuadrantLabel['connectorLine'];
    if (best.dist > minGap + stepSize) {
      // Determine connector endpoints: from point edge to label edge
      const dx = best.textX - pt.cx;
      const dy = best.textY - pt.cy;
      const angle = Math.atan2(dy, dx);
      const x1 = pt.cx + Math.cos(angle) * pointRadius;
      const y1 = pt.cy + Math.sin(angle) * pointRadius;

      // Label edge: closest point on label rect to the point
      const x2 = Math.max(
        best.rect.x,
        Math.min(pt.cx, best.rect.x + best.rect.w)
      );
      const y2 = Math.max(
        best.rect.y,
        Math.min(pt.cy, best.rect.y + best.rect.h)
      );

      connectorLine = { x1, y1, x2, y2 };
    }

    results.push({
      label: pt.label,
      x: best.textX,
      y: best.textY,
      anchor: best.anchor,
      connectorLine,
    });
  }

  return results;
}
