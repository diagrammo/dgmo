// ============================================================
// Family Diagram (genealogy) — Types
// ============================================================
//
// Models a family tree: PERSONS declared with GEDCOM-flavored metadata, joined
// by UNION lines (`A + B`) into couples, with children indented underneath. The
// same person may appear in several unions (remarriage); a lone person line with
// indented children is a single-parent family.
//
// Syntax source of truth: `docs/dgmo-language-spec.md` (family chapter).
//
// Coordinate convention: layout `nodes` carry TOP-LEFT x/y (mirrors org's
// `LayoutNode`), so the renderer translates the card `<g>` directly to `(x, y)`.

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

/** Recognized sex values (drives node color). `unknown` = no `sex:` key. */
export type FamilySex = 'm' | 'f' | 'unknown';

/**
 * A person — identity is the normalized name. Declared standalone (with full
 * metadata) or first seen inside a union / as a child; later mentions merge
 * into the same person. Metadata lives ONLY on person lines (never per-side on
 * a union line — that form is unsupported).
 */
export interface FamilyPerson {
  /** Canonical (display) name — globally unique after name-normalization. */
  readonly id: string;
  readonly label: string;
  /** Resolved from the `sex:` key (`unknown` when unset). */
  readonly sex: FamilySex;
  /** Fixed-key metadata in declaration order (b, d, bp, dp, occupation, …). */
  readonly metadata: Readonly<Record<string, string>>;
  /** Explicit trailing/inline color (raw recognized name), if any — overrides sex color. */
  readonly color?: string;
  /** Tag-group values applied to this person (`{ concern: 'royal' }`). */
  readonly tagMetadata: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

/** One child of a union / single parent. */
export interface FamilyChild {
  /** Person id of the child. */
  readonly personId: string;
  /** True when the child line carried the bare `adopted` token (dashed edge). */
  readonly adopted: boolean;
}

/**
 * A union — a couple (1 or 2 parents) whose children are declared indented
 * beneath. A single parent is a union with exactly one parent. `metadata.m`
 * holds the marriage year (there is NO separate `marriageYear` field).
 */
export interface FamilyUnion {
  /** Stable synthetic id (declaration order). */
  readonly id: string;
  /** 1–2 parent person ids. */
  readonly parents: readonly string[];
  /** Union-level metadata — only `m` (marriage year) is recognized. */
  readonly metadata: Readonly<Record<string, string>>;
  readonly children: readonly FamilyChild[];
  readonly lineNumber: number;
}

export interface ParsedFamily {
  readonly title?: string;
  readonly titleLineNumber?: number;
  /** Persons keyed by normalized id, in first-seen declaration order via `.values()`. */
  readonly persons: ReadonlyMap<string, FamilyPerson>;
  readonly unions: readonly FamilyUnion[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  /** Set (fatal) on an ancestry cycle — the renderer bails before layout. */
  readonly error?: string | null;
}

// ── Layout output ──────────────────────────────────────────

/** A laid-out person card. Top-left origin (mirrors org's `LayoutNode`). */
export interface FamilyLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly sex: FamilySex;
  readonly metadata: Readonly<Record<string, string>>;
  readonly color?: string;
  readonly tagMetadata: Readonly<Record<string, string>>;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Assigned generation row (0 = top). */
  readonly row: number;
  readonly lineNumber: number;
}

/** A horizontal marriage bar joining two spouse cards on one row. */
export interface FamilyMarriageBar {
  readonly unionId: string;
  /** Bar endpoints (always horizontal — spouses share a row). */
  readonly x1: number;
  readonly x2: number;
  readonly y: number;
  /** Midpoint (child bus drops from here). */
  readonly midX: number;
  /** Center of the visible gap between the cards — where the `m.` label sits
   * (offset from midX when the two cards differ in width, so the label never
   * tucks under the wider card). */
  readonly labelX: number;
  /** Marriage year (`metadata.m`), if any — drawn at the label position. */
  readonly year?: string;
  readonly lineNumber: number;
}

/** A child drop edge (org bus-edge pattern: trunk + bar + per-child drops). */
export interface FamilyChildEdge {
  readonly unionId: string;
  readonly childId: string;
  /** Polyline points from the union anchor to the child card top. */
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** Adopted children render a dashed drop. */
  readonly adopted: boolean;
}

/** A collapsed ancestor shown as a small labeled dot above the focused card. */
export interface FamilyAncestorDot {
  readonly id: string;
  readonly label: string;
  readonly sex: FamilySex;
  readonly color?: string;
  readonly x: number;
  readonly y: number;
}

export interface FamilyLayoutResult {
  readonly nodes: readonly FamilyLayoutNode[];
  readonly bars: readonly FamilyMarriageBar[];
  readonly edges: readonly FamilyChildEdge[];
  /** Focus mode: the focused person's parents, drawn as dots above their card. */
  readonly ancestors: readonly FamilyAncestorDot[];
  /** Top-center of the focused card, for the ancestor-trail connector. */
  readonly focusAnchor?: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
}
