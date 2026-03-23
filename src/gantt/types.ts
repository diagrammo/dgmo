// ============================================================
// Gantt Chart Types
// ============================================================

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

// ── Duration ────────────────────────────────────────────────

/** Calendar units: d (days), w (weeks), m (months), q (quarters), y (years). bd = business days. */
export type DurationUnit = 'd' | 'bd' | 'w' | 'm' | 'q' | 'y';

export interface Duration {
  amount: number;
  unit: DurationUnit;
}

export interface Offset {
  duration: Duration;
  direction: 1 | -1;
}

// ── Parsed Elements ─────────────────────────────────────────

export interface GanttDependency {
  targetName: string; // raw string from `-> X` or `-> Group.X`
  offset?: Offset;
  lineNumber: number;
}

export interface GanttTask {
  id: string; // unique, generated during parse (e.g. "group:taskIdx")
  label: string;
  duration: Duration | null; // null for explicit-date-only tasks
  explicitStart?: string; // YYYY-MM-DD from `2024-01-15 -> 30d:` or `2024-01-15:`
  uncertain: boolean;
  progress: number | null; // 0-100 or null
  offset?: Offset; // task-level offset: shifts start date forward (+) or backward (-)
  dependencies: GanttDependency[];
  metadata: Record<string, string>; // tag values from pipe metadata
  lineNumber: number;
  groupPath: string[]; // e.g. ["Backend", "API"] for nested groups
  comment?: string; // accumulated // comment lines
}

export interface GanttGroup {
  name: string;
  color: string | null;
  metadata: Record<string, string>;
  lineNumber: number;
  children: GanttNode[];
}

export interface GanttParallelBlock {
  kind: 'parallel';
  lineNumber: number;
  children: GanttNode[];
}

/** A node in the gantt tree: either a task, group, or parallel block. */
export type GanttNode =
  | ({ kind: 'task' } & GanttTask)
  | ({ kind: 'group' } & GanttGroup)
  | GanttParallelBlock;

// ── Holidays ────────────────────────────────────────────────

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface HolidayDate {
  date: string; // YYYY-MM-DD
  label: string;
  lineNumber: number;
}

export interface HolidayRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  label: string;
  lineNumber: number;
}

export interface GanttHolidays {
  dates: HolidayDate[];
  ranges: HolidayRange[];
  workweek: Weekday[]; // default: ['mon', 'tue', 'wed', 'thu', 'fri']
}

// ── Eras & Markers (reuse timeline types) ───────────────────

export interface GanttEra {
  startDate: string;
  endDate: string;
  label: string;
  color: string | null;
}

export interface GanttMarker {
  date: string;
  label: string;
  color: string | null;
  lineNumber: number;
}

// ── Chart Options ───────────────────────────────────────────

export interface GanttOptions {
  start: string | null; // YYYY[-MM[-DD]] or null for relative timeline
  title: string | null;
  titleLineNumber: number | null;
  orientation: 'horizontal' | 'vertical';
  todayMarker: 'off' | 'on' | string; // 'on' = current date, string = YYYY-MM-DD
  criticalPath: boolean;
  dependencies: boolean;
  sort: 'default' | 'tag';
  defaultSwimlaneGroup: string | null; // tag group name from `sort: tag:Team`
}

// ── Parsed Result ───────────────────────────────────────────

export interface ParsedGantt {
  nodes: GanttNode[]; // top-level tree (groups, tasks, parallel blocks)
  holidays: GanttHolidays;
  tagGroups: TagGroup[];
  eras: GanttEra[];
  markers: GanttMarker[];
  options: GanttOptions;
  diagnostics: DgmoError[];
  error: string | null;
}

// ── Resolved Schedule ───────────────────────────────────────

export interface ResolvedTask {
  task: GanttTask;
  startDate: Date;
  endDate: Date;
  isCriticalPath: boolean;
  isMilestone: boolean;
  groupPath: string[];
  effectiveMetadata: Record<string, string>; // merged with inherited tags
}

export interface ResolvedGroup {
  name: string;
  color: string | null;
  metadata: Record<string, string>;
  startDate: Date;
  endDate: Date;
  progress: number | null; // aggregate progress (weighted average)
  lineNumber: number;
  depth: number;
}

export interface ResolvedSchedule {
  tasks: ResolvedTask[];
  groups: ResolvedGroup[];
  startDate: Date;
  endDate: Date;
  holidays: GanttHolidays;
  tagGroups: TagGroup[];
  eras: GanttEra[];
  markers: GanttMarker[];
  options: GanttOptions;
  diagnostics: DgmoError[];
  error: string | null;
}
