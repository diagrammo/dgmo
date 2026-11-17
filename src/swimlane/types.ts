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
import type { ChartFrame } from '../utils/chart-frame-parse';

/**
 * Node vocabulary (closed). `terminal` is the BPMN event circle; its look
 * (start / mid-flow / end) comes from where it sits in the flow, not from a
 * shape of its own (see `SwimEventPosition`).
 */
export type SwimShape =
  | 'task'
  | 'exclusive'
  | 'parallel'
  | 'inclusive'
  | 'event-based'
  | 'terminal'
  | 'subprocess';

/**
 * Event typing (closed): `(!x)` is `error`; the trailing words `success`,
 * `terminate`, `message`, `timer` and `signal` set the rest.
 */
export type SwimEvent =
  | 'none'
  | 'error'
  | 'success'
  | 'terminate'
  | 'message'
  | 'timer'
  | 'signal';

/**
 * Where an event sits: no inbound sequence flow is a start (thin circle), no
 * outbound is an end (thick circle), anything else — and every boundary
 * event — is mid-flow (double ring). Message flow (`~>`) does not count.
 */
export type SwimEventPosition = 'start' | 'mid' | 'end';

/** BPMN task marker set by `type:` on a task (drawn in its top-left corner). */
export type SwimTaskType =
  | 'user'
  | 'service'
  | 'manual'
  | 'script'
  | 'send'
  | 'receive';

/** The six `type:` values, in the order diagnostics list them. */
export const SWIM_TASK_TYPES: readonly SwimTaskType[] = [
  'user',
  'service',
  'manual',
  'script',
  'send',
  'receive',
];

/**
 * Something attached to a node with a dotted association line: `store:` (data
 * store, a cylinder), `data:` (data object, a folded page) or `note:` (text
 * annotation, an open bracket).
 */
export type SwimArtifactKind = 'store' | 'data' | 'note';

export interface SwimArtifact {
  readonly kind: SwimArtifactKind;
  readonly label: string;
}

/**
 * A declared pool (`pool Name` at indent 0). A pool with no lanes is an
 * outside party, drawn as a collapsed bar that only sends or receives `~>`.
 */
export interface SwimPool {
  readonly id: string;
  readonly label: string;
  /** Lane ids indented under this pool, in declaration order. */
  readonly lanes: readonly string[];
  readonly lineNumber: number;
}

/** One message flow (`~>`). Either end may be a node or a whole pool. */
export interface SwimMessage {
  /** Node id, or pool id when `sourceIsPool`. */
  readonly source: string;
  readonly target: string;
  readonly sourceIsPool: boolean;
  readonly targetIsPool: boolean;
  readonly lineNumber: number;
}

export type SwimDirection = 'LR' | 'TB';

/** A declared lane (row in LR / column in TB), occupant-neutral. */
export interface SwimLane {
  readonly id: string;
  readonly label: string;
  /** Resolved hex color (from the trailing §1.5 color token), if any. */
  readonly color?: string;
  /** Pool id, when the lane is indented under a `pool`. */
  readonly pool?: string;
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
  /** `type:` marker on a task. */
  readonly taskType?: SwimTaskType;
  /** Host node id when this event is a boundary event on a task. */
  readonly boundaryOf?: string;
  /** `store:` / `data:` / `note:` attachments, in source order. */
  readonly artifacts?: readonly SwimArtifact[];
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
  /** Pools in declaration order (empty for a diagram with no `pool` lines). */
  readonly pools: readonly SwimPool[];
  /** Message flows (`~>`), between pools only. */
  readonly messages: readonly SwimMessage[];
  /** Phases in declaration order (empty for a 2-deep, phase-less diagram). */
  readonly phases: readonly SwimPhase[];
  readonly nodes: readonly SwimNode[];
  readonly edges: readonly SwimEdge[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  readonly frame?: ChartFrame;
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
  readonly taskType?: SwimTaskType;
  /** Set on `terminal` nodes. */
  readonly eventPosition?: SwimEventPosition;
  readonly boundaryOf?: string;
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

/** A laid-out `store:` / `data:` / `note:` attachment (center coordinates). */
export interface SwimLayoutArtifact {
  readonly id: string;
  readonly kind: SwimArtifactKind;
  readonly label: string;
  /** The label wrapped to lines (a note's text; a store's or data object's caption). */
  readonly lines: readonly string[];
  /** Host node id. */
  readonly host: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The dotted association line, host edge → artifact edge. */
  readonly link: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly lineNumber: number;
}

/** A laid-out message flow (`~>`). */
export interface SwimLayoutMessage {
  readonly source: string;
  readonly target: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly lineNumber: number;
}

/**
 * A laid-out pool. Top-left origin. `headerSize` is the name band (left in
 * LR, top in TB); a collapsed pool (no lanes) is one thin bar.
 */
export interface LayoutPool extends LayoutBand {
  readonly collapsed: boolean;
}

export interface SwimlaneLayoutResult {
  readonly nodes: readonly SwimLayoutNode[];
  readonly edges: readonly SwimLayoutEdge[];
  readonly messages: readonly SwimLayoutMessage[];
  readonly artifacts: readonly SwimLayoutArtifact[];
  readonly pools: readonly LayoutPool[];
  readonly lanes: readonly LayoutBand[];
  readonly phases: readonly LayoutBand[];
  readonly width: number;
  readonly height: number;
}
