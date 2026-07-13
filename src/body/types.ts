// ============================================================
// Body chart — Parsed Types (vertical slice: male-front muscle)
// ============================================================
//
// A `body` diagram renders a human figure annotated by muscle/bone/joint name
// (medical, exercise, educational). Names come from a built-in anatomy catalog;
// tag groups color parts by intensity/severity; each named part gets a gutter
// label with a leader line to a pre-computed anchor. See docs/brainstorming-body.md.
//
// This slice ships ONE figure — male, front, muscle form. The parser records
// `form`/`sex`/`view` so the grammar is forward-compatible; the renderer falls
// back to the single available figure and flags unsupported combinations.

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

/** A named part annotation (`chest e: Primary` + bare-body notes). */
export interface BodyPart {
  /** Canonical part name as written (label text). */
  readonly name: string;
  /** Tag metadata — keys are `tagAttrKey(group)` (e.g. `{ effort: 'Primary' }`). */
  readonly metadata: Readonly<Record<string, string>>;
  /** Bare indented body lines (markdown-light; `- ` bullets normalized). */
  readonly notes: readonly string[];
  readonly lineNumber: number;
  /**
   * Optional anatomical side (patient's own left/right) from a `left `/`right `
   * prefix, e.g. `right pec`. Aims the leader at just that side's component.
   */
  readonly side?: 'left' | 'right';
}

export type BodyView = 'front' | 'back';
export type BodySex = 'male' | 'female';
/** Asset key for a figure (sex × view). */
export type FigureKey = 'maleFront' | 'maleBack' | 'femaleFront' | 'femaleBack';

export interface BodyOptions {
  /** Figure form: `muscle` (default) · `skin` · `skeletal` (reserved). */
  readonly form: 'muscle' | 'skin' | 'skeletal';
  /** `male` (default) · `female`. */
  readonly sex: BodySex;
  /** Requested views in declaration order — `['front']` default; both when the
   *  diagram names `front` and `back` (rendered side by side). */
  readonly views: readonly BodyView[];
  /** True when `no-legend` — hide the tag legend. */
  readonly noLegend: boolean;
  /** True when `no-title` — hide the diagram title. */
  readonly noTitle: boolean;
}

export interface ParsedBody {
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly options: BodyOptions;
  readonly tagGroups: readonly TagGroup[];
  readonly parts: readonly BodyPart[];
  readonly diagnostics: readonly DgmoError[];
  readonly error?: DgmoError;
}

// ── Baked figure asset (generated; see assets/male-front.ts) ──

/** A resolvable catalog entry: its path geometry + a baked leader anchor. */
export interface BodyPartGeometry {
  readonly paths: readonly string[];
  /** Union centroid — used for gutter side (L/R) + vertical ordering. */
  readonly anchor: { readonly x: number; readonly y: number };
  /**
   * Centroids of each disjoint muscle component (e.g. left + right pec). The
   * renderer aims a leader at whichever component sits nearest the label, so a
   * bilateral muscle connects to the side it's labelled on — not the midline.
   */
  readonly centers?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

/** One figure: silhouette + muscle geometry + catalog lookup. */
export interface BodyFigure {
  /** SVG viewBox, e.g. `"0 0 724 1448"`. */
  readonly viewBox: string;
  /** True visible extent of the figure (outline + head + hair) in viewBox
   *  coords — used to align/scale figures by real body size, not the padded
   *  viewBox, so front/back line up exactly. */
  readonly contentBox: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  /** Silhouette outline path `d`. */
  readonly outline: string;
  /** Every muscle path `d` (gray base fill). */
  readonly base: readonly string[];
  /** Head silhouette path(s) — excluded from `outline`; used by skin form. */
  readonly headPaths: readonly string[];
  /** Hair path(s) — drawn atop the head in skin form. */
  readonly hairPaths: readonly string[];
  /** Catalog: canonical name (fine or slug-group) → geometry + anchor. */
  readonly parts: Readonly<Record<string, BodyPartGeometry>>;
}
