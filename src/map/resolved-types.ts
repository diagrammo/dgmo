// Resolved model produced by resolveMap (src/map/resolver.ts) — the contract the
// layout/renderer (step 4) consumes. Regions are bound to ISO geometry, POIs are
// geocoded, the basemap/extent/projection are chosen. See §24B.2/.8.
import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import type { MapDirectives } from './types';
import type { Gazetteer, BoundaryTopology, WaterBodies } from './data/types';

/** The four static assets, injected into the pure resolver (DI). */
export interface MapData {
  worldCoarse: BoundaryTopology;
  worldDetail: BoundaryTopology;
  usStates: BoundaryTopology;
  /** Major lakes (Natural Earth 110m) drawn as water over land — e.g. the Great
   *  Lakes. Optional so hand-built test fixtures need not supply it. */
  lakes?: BoundaryTopology;
  /** Major river centerlines (Natural Earth 110m) drawn as thin water lines over
   *  land — e.g. the Amazon, Nile, Mississippi. Optional, like `lakes`. */
  rivers?: BoundaryTopology;
  /** Notable mountain-range polygons (Natural Earth 50m geography regions) drawn
   *  as a subtle gradient relief cue over base land when the `relief` directive
   *  is on — e.g. the Rockies, Andes, Himalayas. Optional, like `lakes`. */
  mountainRanges?: BoundaryTopology;
  /** North-America-clipped 10m country land, used as crisp neighbour context
   *  under the albers-usa US view so Canada/Mexico match the 10m states instead
   *  of the coarser world tiers. Optional, like `lakes`. */
  naLand?: BoundaryTopology;
  /** North-America-clipped 10m major lakes (Great Lakes etc.), used in place of
   *  the coarse `lakes` under the albers-usa US view. Optional. */
  naLakes?: BoundaryTopology;
  /** Water-body orientation labels (Natural Earth marine polys) drawn when the
   *  `context-labels` directive is on — oceans/seas/gulfs/bays/etc. Optional, so
   *  hand-built test fixtures and older bundles need not supply it. */
  waterBodies?: WaterBodies;
  gazetteer: Gazetteer;
}

export type ProjectionFamily =
  | 'equal-earth'
  | 'natural-earth'
  | 'albers-usa'
  | 'mercator';

/** Which geometry layers the renderer draws. */
export interface Basemaps {
  /** World country tier: coarse (world-scale) | detail (regional/zoom). */
  world: 'coarse' | 'detail';
  /** Loaded subdivision layers (v1: only 'us-states'). */
  subdivisions: Array<'us-states'>;
}

export interface ResolvedRegion {
  /** ISO code: alpha-2 (country) or 3166-2 `US-XX` (state) — the geometry id. */
  readonly iso: string;
  readonly name: string; // display name
  readonly layer: 'country' | 'us-state';
  readonly value?: number;
  /** §1.5 trailing-token color NAME → flat override fill (§24B.4). */
  readonly color?: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

export interface ResolvedPoi {
  /** Folded registry id (alias|name folded, or `@lat,lon` for coord POIs). */
  readonly id: string;
  /** Display name (original casing): the city/place name, alias, or endpoint
   *  string. The on-map label falls back to this when `label` is absent (the
   *  folded `id` is for binding, not display). */
  readonly name?: string;
  readonly lat: number;
  readonly lon: number;
  readonly label?: string;
  /** §1.5 trailing-token color NAME → flat marker fill (§24B.5). */
  readonly color?: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly lineNumber: number;
  /** True when created from an undeclared edge/route endpoint (§24B.10). */
  readonly implicit?: boolean;
}

export interface ResolvedEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly label?: string;
  readonly directed: boolean;
  readonly style: 'straight' | 'arc';
  /** Best-effort surface constraint (§24B.6): the leg arrow bows to stay over the
   *  named surface. Absent = feature off. After resolve this carries the map-level
   *  directive default when the edge set none. */
  readonly surface?: 'water' | 'land';
  readonly meta: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

export interface ResolvedRouteLeg {
  readonly fromId: string;
  readonly toId: string;
  readonly label?: string;
  readonly style: 'straight' | 'arc';
  /** Best-effort surface constraint (§24B.6); see {@link ResolvedEdge.surface}. */
  readonly surface?: 'water' | 'land';
  readonly value?: string; // leg thickness
  readonly lineNumber: number;
}

export interface ResolvedRoute {
  /** Ordered UNIQUE stop ids (for numbering + the origin marker). A loop-closing
   *  leg whose destination is an earlier stop adds a leg but no duplicate stop. */
  readonly stopIds: readonly string[];
  readonly legs: readonly ResolvedRouteLeg[];
  readonly lineNumber: number;
}

/** Geographic bounding box `[[west, south], [east, north]]` in degrees.
 *
 *  WRAP CONVENTION (#12): for an antimeridian-crossing extent the resolver keeps
 *  `west` in [−180, 180] and returns `east` UNWRAPPED in (180, 540] (i.e.
 *  `east = west + span`, span ≤ 360). So `east > 180` signals a dateline-crossing
 *  extent; the renderer (step 4) must mod `east` back into [−180, 180] (or shift
 *  the projection's center) rather than assume `east ≤ 180`. `south`/`north` are
 *  always plain degrees in [−90, 90]. */
export type GeoExtent = [[number, number], [number, number]];

export interface ResolvedMap {
  readonly title: string | null;
  /** DEAD — the `subtitle` directive was removed (2026-06-02 defaults-on review).
   *  Never populated; the renderer's subtitle branch is now unreachable. Left for
   *  a later cleanup pass (mirrors the deferred surface dead code). */
  readonly subtitle?: string;
  readonly caption?: string;
  readonly tagGroups: readonly TagGroup[];
  readonly directives: MapDirectives;
  readonly basemaps: Basemaps;
  readonly regions: readonly ResolvedRegion[];
  readonly pois: readonly ResolvedPoi[];
  readonly edges: readonly ResolvedEdge[];
  readonly routes: readonly ResolvedRoute[];
  readonly extent: GeoExtent;
  readonly projection: ProjectionFamily;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
