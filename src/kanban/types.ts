import type { DgmoError } from '../diagnostics';

export interface KanbanTagEntry {
  value: string;
  color: string;
  lineNumber: number;
}

export interface KanbanTagGroup {
  name: string;
  alias?: string;
  entries: KanbanTagEntry[];
  defaultValue?: string;
  lineNumber: number;
}

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
  error?: string;
}
