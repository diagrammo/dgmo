// ============================================================
// Swimlane Diagram — Types
// ============================================================
//
// Cross-functional / BPMN-flavored process diagrams: actors/systems as lanes,
// process flowing along the flow axis with branches, gateways, terminals and
// loops. Syntax source of truth: `docs/swimlane-syntax.html`.
//
// Coordinate convention (F15 — documented split, mirrors the rest of dgmo):
//   - `nodes` / `edges` carry **center** x/y (like boxes-and-lines
//     `BLLayoutNode`/`BLLayoutEdge`).
//   - `lanes` / `phases` (`LayoutBand`) carry **top-left** x/y (like
//     `graph/layout.ts` `LayoutGroup`).

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

/**
 * v1 node vocabulary (closed). Inclusive (`<o>`) and event-based (`<*>`)
 * gateways are fast-follow — they parse to an `E_SWIMLANE_UNSUPPORTED`
 * diagnostic, never to a shape here.
 */
export type SwimShape =
  | 'task'
  | 'exclusive'
  | 'parallel'
  | 'terminal'
  | 'subprocess';

/**
 * v1 terminal/event typing (closed). Timer/message/signal are fast-follow and
 * emit `E_SWIMLANE_UNSUPPORTED`.
 */
export type SwimEvent = 'none' | 'error' | 'success' | 'terminate';

export type SwimDirection = 'LR' | 'TB';

/** A declared lane (row in LR / column in TB), occupant-neutral. */
export interface SwimLane {
  readonly id: string;
  readonly label: string;
  /** Resolved hex color (from the trailing §1.5 color token), if any. */
  readonly color?: string;
  readonly lineNumber: number;
}

/** A declared phase column (`[Phase]`). */
export interface SwimPhase {
  readonly id: string;
  readonly label: string;
  readonly lineNumber: number;
}

export interface SwimNode {
  /** Canonical (display) name — globally unique. */
  readonly id: string;
  readonly label: string;
  readonly shape: SwimShape;
  /** Lane id this node belongs to. */
  readonly lane: string;
  /** Phase id, if declared under a `[Phase]`. */
  readonly phase?: string;
  /** Terminal/event type (only meaningful for `terminal` shapes). */
  readonly event: SwimEvent;
  /** Explicit trailing color token, if any (raw recognized name). */
  readonly color?: string;
  /** Same-line `key: value` metadata (tag-group values). */
  readonly tags: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

export interface SwimEdge {
  readonly source: string;
  readonly target: string;
  /** In-arrow label (`-invalid->`), if any. */
  readonly label?: string;
  readonly lineNumber: number;
}

export interface ParsedSwimlane {
  readonly title?: string;
  readonly titleLineNumber?: number;
  readonly direction: SwimDirection;
  /** Lanes in declaration order. */
  readonly lanes: readonly SwimLane[];
  /** Phases in declaration order (empty for a 2-deep, phase-less diagram). */
  readonly phases: readonly SwimPhase[];
  readonly nodes: readonly SwimNode[];
  readonly edges: readonly SwimEdge[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error?: string | null;
}

/**
 * A laid-out band (lane or phase). Top-left origin (mirrors `LayoutGroup`),
 * NOT center origin.
 */
export interface LayoutBand {
  readonly id: string;
  readonly label: string;
  /** Resolved hex color (lanes only); phases are neutral. */
  readonly color?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Thickness of the label gutter (left for lanes, top for phases, in LR;
   * transposed in TB). The renderer reserves this for the band label.
   */
  readonly headerSize: number;
  readonly lineNumber: number;
}

export interface SwimLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly shape: SwimShape;
  readonly event: SwimEvent;
  readonly lane: string;
  readonly phase?: string;
  readonly color?: string;
  readonly tags: Readonly<Record<string, string>>;
  /** Center coordinates. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lineNumber: number;
}

export interface SwimLayoutEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** True for a routed loop / back-edge (drawn dashed). */
  readonly back: boolean;
  readonly lineNumber: number;
}

export interface SwimlaneLayoutResult {
  readonly nodes: readonly SwimLayoutNode[];
  readonly edges: readonly SwimLayoutEdge[];
  readonly lanes: readonly LayoutBand[];
  readonly phases: readonly LayoutBand[];
  readonly width: number;
  readonly height: number;
}
