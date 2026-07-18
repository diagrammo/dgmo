import type { DgmoError } from '../diagnostics';

// ============================================================
// Version-Control — Parsed Types (spec §29)
// ============================================================

export type VCNodeKind = 'commit' | 'merge' | 'cherry';
export type VCCommitType = 'normal' | 'highlight' | 'reverse';
export type VCDirection = 'LR' | 'TB';

/** A node on the commit DAG (commit / merge / cherry-pick). */
export interface VCNode {
  readonly key: number;
  readonly branch: string;
  /** Lane index (the branch's row/column). */
  lane: number;
  /** Topological position along the time axis. */
  readonly seq: number;
  readonly kind: VCNodeKind;
  /** Commit message (the bare line text), or null for an empty/dotless commit. */
  readonly message: string | null;
  readonly type: VCCommitType;
  /** Short SHA — shown only when authored via `id:` (else null). */
  readonly id: string | null;
  /** Release/ref tag rendered as a pill badge. */
  readonly tag: string | null;
  readonly lineNumber: number;
  /** Previous node on the same branch (straight lane segment). */
  prev: number | null;
  /** Branch-point parent (rounded elbow into the first commit of a new branch). */
  parent: number | null;
  /** Merge source tip. */
  mergeFrom: number | null;
  /** Cherry-pick source. */
  cherryFrom: number | null;
  /** Reverted commit (dashed link, reverse styling). */
  revertFrom: number | null;
  /** Squash source tip (dashed link; source commits ghosted). */
  squashFrom: number | null;
  /** Rebase: the solid copy this (faded) original was replayed to. */
  movedTo: number | null;
  /** Faded/dashed abandoned commit (rebase original / reset orphan / squash source). */
  ghost: boolean;
}

export interface VCAheadBehind {
  readonly ahead: number;
  readonly behind: number;
}

export interface VCBranch {
  readonly name: string;
  readonly lane: number;
  /** Named color token (§1.5), or null → auto by lane order. */
  readonly colorToken: string | null;
  /** Explicit `order:` override, or null → declaration order. */
  readonly order: number | null;
  /** Key of the branch's current tip node, or null if empty. */
  tip: number | null;
  /** Ahead/behind vs an `origin/<name>` ref, or null. */
  ab: VCAheadBehind | null;
}

export interface VCRef {
  readonly name: string;
  /** Node the pointer sits on, or null if unresolved. */
  readonly atKey: number | null;
  /** Remote-tracking (origin/…) → ghosted pill. */
  readonly remote: boolean;
  /** HEAD pointer. */
  readonly head: boolean;
  readonly lineNumber: number;
}

export interface VCNote {
  readonly num: number;
  readonly anchorKey: number | null;
  readonly text: string;
  readonly lineNumber: number;
}

export interface VCOptions {
  readonly direction: VCDirection;
  readonly noLabels: boolean;
  readonly noLanes: boolean;
  readonly noHead: boolean;
}

export interface ParsedVersionControl {
  readonly type: 'version-control';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly nodes: readonly VCNode[];
  readonly branches: readonly VCBranch[];
  readonly refs: readonly VCRef[];
  readonly notes: readonly VCNote[];
  readonly options: VCOptions;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
