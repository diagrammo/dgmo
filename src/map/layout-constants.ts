/**
 * Map layout constants shared by `layout.ts` and the passes it calls.
 *
 * These live apart from `layout.ts` so that a module it imports can read them
 * without importing `layout.ts` back. `region-labels.ts` needs both, and took
 * them from `layout.ts` directly until 2026-08-10 — a value import, which made
 * a real runtime cycle out of a pair the file's own comment says was meant to
 * be type-only. Types erase at build time; constants do not.
 */

/** px padding inside the viewport */
export const FIT_PAD = 24;

/**
 * A few countries have far-flung territory that drags the area-weighted centroid
 * off the mainland (US → Alaska pulls it up into Canada). Anchor their world-layer
 * label/hover point to a mainland [lon, lat] instead. Antimeridian crossers whose
 * body dominates by area (Russia) are NOT listed — their area-weighted centroid
 * already lands on the mainland; only the naive bounding-box centre (which the app
 * previously used for hover) mistook the wrapped sliver for half the shape.
 */
export const WORLD_LABEL_ANCHORS: Record<string, [number, number]> = {
  US: [-98.5, 39.5], // CONUS geographic centre (near Lebanon, Kansas)
  // Russia crosses the antimeridian (Chukotka at ~170°W), so on a non-global
  // (e.g. Europe) projection its geometry smears across the whole frame and the
  // area-weighted centroid lands mid-map (over Europe) — useless as a label
  // anchor. Pin it to European Russia (~Volga) so a Europe view labels visible
  // western Russia on its eastern margin; on a world view this still sits over
  // Russian land. (See the curated-anchor smear-gate bypass in context-labels.)
  RU: [45, 58],
};
