import type { DgmoError } from '../diagnostics';
import type { ChartFrame } from '../utils/chart-frame-parse';
import type { TagGroup } from '../utils/tag-groups';

/** The reserved `type:` values; the type picks the shape. */
export const ENTITY_TYPES = [
  'corporation',
  'partnership',
  'individual',
  'trust',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface OwnershipEntity {
  /** Stable id, `e1`, `e2`, … in declaration order. */
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  /** Tag values keyed by the group's attr key (`jurisdiction: UK`). */
  readonly metadata: Readonly<Record<string, string>>;
  /** Free description lines (§34.6 simple markdown), in source order. */
  readonly description: readonly string[];
  /** True when the entity is not in the main tree (a fund, a person). */
  readonly outside: boolean;
  /** Indent-0 entities have no tree parent. */
  readonly treeParentId: string | null;
  readonly lineNumber: number;
}

export interface OwnershipLink {
  readonly id: string;
  readonly ownerId: string;
  readonly ownedId: string;
  /** The stake, 0 < pct ≤ 100. */
  readonly pct: number;
  /** As written, without the `%` (`33.3`). */
  readonly pctText: string;
  /** `->` form: a cross-holding or an outside owner's stake. */
  readonly arrow: boolean;
  readonly lineNumber: number;
}

export interface ParsedOwnership {
  readonly type: 'ownership';
  readonly title?: string;
  readonly titleLineNumber?: number;
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  readonly frame?: ChartFrame;
  /** Entities in declaration order; the first in-group one is the root. */
  readonly entities: readonly OwnershipEntity[];
  readonly links: readonly OwnershipLink[];
  readonly rootId: string | null;
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
