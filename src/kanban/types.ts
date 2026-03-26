import type { DgmoError } from '../diagnostics';
import type { TagGroup, TagEntry } from '../utils/tag-groups';

/** @deprecated Use `TagEntry` from `utils/tag-groups` */
export type KanbanTagEntry = TagEntry;
/** @deprecated Use `TagGroup` from `utils/tag-groups` */
export type KanbanTagGroup = TagGroup;

export interface KanbanCard {
  id: string;
  title: string;
  tags: Record<string, string>; // groupName → value
  details: string[]; // freeform indented lines
  lineNumber: number; // first line of the card (1-based)
  endLineNumber: number; // last line inclusive (1-based)
  color?: string; // explicit color override via (color) suffix
}

export interface KanbanColumn {
  id: string;
  name: string;
  wipLimit?: number;
  color?: string;
  metadata?: Record<string, string>;
  cards: KanbanCard[];
  lineNumber: number;
}

export interface ParsedKanban {
  type: 'kanban';
  title?: string;
  titleLineNumber?: number;
  columns: KanbanColumn[];
  tagGroups: KanbanTagGroup[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}
