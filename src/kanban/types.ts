import type { DgmoError } from '../diagnostics';
import type { TagGroup, TagEntry } from '../utils/tag-groups';

/** @deprecated Use `TagEntry` from `utils/tag-groups` */
export type KanbanTagEntry = TagEntry;
/** @deprecated Use `TagGroup` from `utils/tag-groups` */
export type KanbanTagGroup = TagGroup;

export interface KanbanCard {
  readonly id: string;
  readonly title: string;
  readonly tags: Readonly<Record<string, string>>; // groupName → value
  readonly details: readonly string[]; // freeform indented lines
  readonly lineNumber: number; // first line of the card (1-based)
  readonly endLineNumber: number; // last line inclusive (1-based)
  readonly color?: string; // explicit color override via (color) suffix
}

export interface KanbanColumn {
  readonly id: string;
  readonly name: string;
  readonly wipLimit?: number;
  readonly color?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly cards: readonly KanbanCard[];
  readonly lineNumber: number;
}

export interface ParsedKanban {
  readonly type: 'kanban';
  readonly title?: string;
  readonly titleLineNumber?: number;
  readonly columns: readonly KanbanColumn[];
  readonly tagGroups: readonly KanbanTagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
