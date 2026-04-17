import type {
  ParsedTechRadar,
  TechRadarLayoutPoint,
  QuadrantPosition,
} from './types';

/** Clockwise quadrant order matching global numbering. */
const POSITION_ORDER: readonly QuadrantPosition[] = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

/**
 * Maps quadrant position to its angular arc range (in radians).
 * 0° = right (3 o'clock), counter-clockwise:
 *   top-right    →  0° to  90° (π/2)
 *   top-left     → 90° to 180° (π)
 *   bottom-left  → 180° to 270° (3π/2)
 *   bottom-right → 270° to 360° (2π)
 */
function getQuadrantArc(position: QuadrantPosition): {
  startAngle: number;
  endAngle: number;
} {
  switch (position) {
    case 'top-right':
      return { startAngle: 0, endAngle: Math.PI / 2 };
    case 'top-left':
      return { startAngle: Math.PI / 2, endAngle: Math.PI };
    case 'bottom-left':
      return { startAngle: Math.PI, endAngle: (3 * Math.PI) / 2 };
    case 'bottom-right':
      return { startAngle: (3 * Math.PI) / 2, endAngle: 2 * Math.PI };
  }
}

/** Blip circle radius in pixels — scales down when slices are dense. */
const BASE_BLIP_RADIUS = 9;
const MIN_BLIP_RADIUS = 5;

/**
 * Compute deterministic, non-overlapping blip positions for a tech radar.
 *
 * Each blip is positioned within its ring+quadrant slice using polar coordinates,
 * then converted to cartesian. The algorithm is:
 * - Stable: changes in one slice don't affect other slices
 * - Deterministic: same input always produces same output
 * - Collision-avoiding: nudges overlapping blips radially within their ring band
 */
export function computeRadarLayout(
  parsed: ParsedTechRadar,
  width: number,
  height: number
): TechRadarLayoutPoint[] {
  const points: TechRadarLayoutPoint[] = [];

  if (parsed.rings.length === 0 || parsed.quadrants.length === 0) return points;

  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(cx, cy) * 0.88; // leave margin for labels
  const ringCount = parsed.rings.length;
  const ringBandWidth = maxRadius / ringCount;
  const ringOrder = parsed.rings.map((r) => r.name);

  // Padding from ring/quadrant boundaries (fraction of band)
  const radialPadding = ringBandWidth * 0.12;
  const angularPadding = 0.05; // radians from quadrant dividers

  for (const quadrant of parsed.quadrants) {
    const quadrantIndex = POSITION_ORDER.indexOf(quadrant.position);
    const { startAngle, endAngle } = getQuadrantArc(quadrant.position);
    const usableArcStart = startAngle + angularPadding;
    const usableArcEnd = endAngle - angularPadding;

    // Group blips by ring
    const blipsByRing = new Map<string, typeof quadrant.blips>();
    for (const blip of quadrant.blips) {
      const list = blipsByRing.get(blip.ring) ?? [];
      list.push(blip);
      blipsByRing.set(blip.ring, list);
    }

    const blipRadius = Math.max(
      MIN_BLIP_RADIUS,
      Math.min(BASE_BLIP_RADIUS, (ringBandWidth - 2 * radialPadding) / 3)
    );

    for (const [ringName, blips] of blipsByRing) {
      const ringIndex = ringOrder.indexOf(ringName);
      if (ringIndex < 0) continue;

      const rInner = ringIndex * ringBandWidth + radialPadding;
      const rOuter = (ringIndex + 1) * ringBandWidth - radialPadding;
      const rMid = (rInner + rOuter) / 2;
      const usableRadial = rOuter - rInner - blipRadius * 2;

      // Distribute blips evenly across the arc
      const arcSpan = usableArcEnd - usableArcStart;
      const placedPoints: { angle: number; radius: number }[] = [];

      for (let bi = 0; bi < blips.length; bi++) {
        const blip = blips[bi];

        // Spread across arc evenly
        let angle: number;
        if (blips.length === 1) {
          angle = (usableArcStart + usableArcEnd) / 2;
        } else {
          angle = usableArcStart + ((bi + 0.5) / blips.length) * arcSpan;
        }

        // Stagger radially to avoid overlap in dense slices
        let radius: number;
        if (blips.length <= 3) {
          radius = rMid;
        } else {
          // Alternate between inner and outer portions
          const radialSlots = Math.min(3, Math.ceil(blips.length / 3));
          const slot = bi % radialSlots;
          radius =
            rInner +
            blipRadius +
            (slot / Math.max(1, radialSlots - 1)) * usableRadial;
        }

        // Collision detection: nudge if overlapping with already-placed blips
        let attempts = 0;
        while (attempts < 20) {
          const x = cx + radius * Math.cos(angle);
          const y = cy - radius * Math.sin(angle); // SVG y is inverted
          const overlapping = placedPoints.some((p) => {
            const px = cx + p.radius * Math.cos(p.angle);
            const py = cy - p.radius * Math.sin(p.angle);
            const dx = x - px;
            const dy = y - py;
            return Math.sqrt(dx * dx + dy * dy) < blipRadius * 2.2;
          });
          if (!overlapping) break;
          // Nudge: try different radial position within band
          radius += blipRadius * 0.8;
          if (radius > rOuter - blipRadius) {
            radius = rInner + blipRadius;
            angle += arcSpan * 0.05; // small angular shift
            // Clamp angle to stay within this quadrant's arc
            if (angle > usableArcEnd) angle = usableArcEnd;
          }
          attempts++;
        }

        placedPoints.push({ angle, radius });

        points.push({
          blip,
          x: cx + radius * Math.cos(angle),
          y: cy - radius * Math.sin(angle),
          quadrantIndex,
          ringIndex,
        });
      }
    }
  }

  return points;
}

/**
 * Get the center and max radius for a radar at the given dimensions.
 * Useful for renderers that need these values independently.
 */
export function getRadarGeometry(
  width: number,
  height: number,
  ringCount: number
): {
  cx: number;
  cy: number;
  maxRadius: number;
  ringBandWidth: number;
} {
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(cx, cy) * 0.88;
  return { cx, cy, maxRadius, ringBandWidth: maxRadius / ringCount };
}

/** Exported for testing. */
export { POSITION_ORDER, getQuadrantArc, BASE_BLIP_RADIUS, MIN_BLIP_RADIUS };
