// Resolved model produced by resolveMap (src/map/resolver.ts) — the contract the
// layout/renderer (step 4) consumes. Regions are bound to ISO geometry, POIs are
// geocoded, the basemap/extent/projection are chosen. See §24B.2/.8.
import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import type { MapDirectives } from './types';
import type { Gazetteer, BoundaryTopology } from './data/types';

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
  /** North-America-clipped 10m country land, used as crisp neighbour context
   *  under the albers-usa US view so Canada/Mexico match the 10m states instead
   *  of the coarser world tiers. Optional, like `lakes`. */
  naLand?: BoundaryTopology;
  /** North-America-clipped 10m major lakes (Great Lakes etc.), used in place of
   *  the coarse `lakes` under the albers-usa US view. Optional. */
  naLakes?: BoundaryTopology;
  gazetteer: Gazetteer;
}

export type ProjectionFamily =
  | 'equirectangular'
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
  readonly score?: number;
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
  readonly meta: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

export interface ResolvedRoute {
  readonly stopIds: readonly string[];
  readonly meta: Readonly<Record<string, string>>;
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
