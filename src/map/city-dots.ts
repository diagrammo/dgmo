import type { Gazetteer } from './data/types';

/** A subtle gazetteer city dot for basemap orientation (§24B `no-cities`). Just
 *  a position + radius; the renderer paints it muted/low-opacity. No label, no
 *  interactivity — purely decorative context. */
export interface MapLayoutCityDot {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** Projects lon/lat to canvas px, or null when the point does not project. */
export type ProjectFn = (lon: number, lat: number) => [number, number] | null;

const CITY_DOT_SPACING = 12; // min px between two dots (and dot↔POI)
const CITY_DOT_CAP = 220;
const SPACING_SQ = CITY_DOT_SPACING * CITY_DOT_SPACING;
// Radius scales with population on a log axis (pop spans ~50k → 37M, so a
// linear map would collapse everything but the megacities to one size). A
// metropolis reads as a slightly fatter dot; a small town stays a faint
// speck. Still decorative — the range is deliberately tight so the layer
// never competes with POIs.
const CITY_DOT_R_MIN = 0.7;
const CITY_DOT_R_MAX = 2.6;
const CITY_POP_MIN = 50_000; // ≤ this → R_MIN
const CITY_POP_MAX = 15_000_000; // ≥ this → R_MAX
const LOG_MIN = Math.log10(CITY_POP_MIN);
const LOG_SPAN = Math.log10(CITY_POP_MAX) - LOG_MIN;

function cityDotRadius(pop: number): number {
  if (!(pop > CITY_POP_MIN)) return CITY_DOT_R_MIN;
  const t = Math.min(1, (Math.log10(pop) - LOG_MIN) / LOG_SPAN);
  return CITY_DOT_R_MIN + t * (CITY_DOT_R_MAX - CITY_DOT_R_MIN);
}

/**
 * Decorative gazetteer city dots, placed after POIs so they can dodge them.
 *
 * Population-ranked and spacing-culled against what is already on the canvas,
 * so at world scale only the biggest of a dense cluster (Europe) survive; zoomed
 * into one country the same cities spread apart and more local ones fill in.
 * Explicit POIs always win — a city dot never sits under a referenced marker.
 *
 * The ON-CANVAS projected-pixel test is the ONLY cull — NOT a lon/lat extent
 * box. `resolved.extent` wraps the antimeridian for albers-usa whenever AK/HI
 * are referenced (west lon > east lon), which a naive `lon<w||lon>e` box reads
 * as "reject every mainland city" → an all-blank US map. The pixel test is
 * projection-agnostic and antimeridian-safe, and it naturally includes the
 * near-border neighbour cities the viewport actually shows.
 *
 * `occupied` is the POI positions already placed on this canvas — the seam this
 * stage depends on, and the reason it runs after POI placement rather than
 * alongside it.
 */
export function layoutCityDots(args: {
  readonly cities: Gazetteer['cities'];
  readonly occupied: readonly { readonly x: number; readonly y: number }[];
  readonly project: ProjectFn;
  readonly width: number;
  readonly height: number;
}): MapLayoutCityDot[] {
  const { cities, occupied, project, width, height } = args;
  const cityDots: MapLayoutCityDot[] = [];

  // Seed the occupancy set with explicit POI positions so dots dodge markers.
  const placed: { x: number; y: number }[] = occupied.map((p) => ({
    x: p.x,
    y: p.y,
  }));
  const sorted = [...cities].sort((a, b) => b[3] - a[3]);
  for (const c of sorted) {
    if (cityDots.length >= CITY_DOT_CAP) break;
    const lat = c[0];
    const lon = c[1];
    const p = project(lon, lat);
    if (!p) continue;
    const [px, py] = p;
    if (px < 0 || px > width || py < 0 || py > height) continue;
    let tooClose = false;
    for (const q of placed) {
      const dx = q.x - px;
      const dy = q.y - py;
      if (dx * dx + dy * dy < SPACING_SQ) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    placed.push({ x: px, y: py });
    cityDots.push({ cx: px, cy: py, r: cityDotRadius(c[3]) });
  }

  return cityDots;
}
