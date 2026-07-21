// ============================================================
// Gantt Chart Types
// ============================================================

import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

// ── Duration ────────────────────────────────────────────────

/** Calendar units: d (days), w (weeks), m (months), q (quarters), y (years), h (hours), min (minutes). bd = business days. s = sprints. */
export type DurationUnit =
  | 'd'
  | 'bd'
  | 'w'
  | 'm'
  | 'q'
  | 'y'
  | 'h'
  | 'min'
  | 's';

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
  readonly targetName: string; // raw string from `-> X` or `-> Group.X`
  readonly label?: string; // optional label from `-label-> X` syntax
  readonly offset?: Offset;
  readonly lineNumber: number;
}

export interface GanttTask {
  readonly id: string; // unique, generated during parse (e.g. "group:taskIdx")
  readonly label: string;
  readonly duration: Duration | null; // null for explicit-date-only tasks
  readonly explicitStart?: string; // YYYY-MM-DD from `2024-01-15 -> 30d:` or `2024-01-15:`
  readonly uncertain: boolean;
  readonly progress: number | null; // 0-100 or null
  readonly offset?: Offset; // task-level offset: shifts start date forward (+) or backward (-)
  readonly isDefinition: boolean; // true = inline definition (has duration), false = reference-only
  readonly dependencies: readonly GanttDependency[];
  readonly metadata: Readonly<Record<string, string>>; // tag values from pipe metadata
  readonly lineNumber: number;
  readonly groupPath: readonly string[]; // e.g. ["Backend", "API"] for nested groups
  readonly comment?: string; // accumulated // comment lines
}

export interface GanttGroup {
  readonly name: string;
  readonly color: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly offset?: Offset; // group-level offset: floor for all bare tasks inside
  readonly collapsed?: boolean; // `[Group] collapsed: true` view-state marker
  readonly lineNumber: number;
  readonly children: readonly GanttNode[];
}

export interface GanttParallelBlock {
  readonly kind: 'parallel';
  readonly lineNumber: number;
  readonly children: readonly GanttNode[];
}

/** A node in the gantt tree: either a task, group, or parallel block. */
export type GanttNode =
  | ({ kind: 'task' } & GanttTask)
  | ({ kind: 'group' } & GanttGroup)
  | GanttParallelBlock;

// ── Holidays ────────────────────────────────────────────────

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface HolidayDate {
  readonly date: string; // YYYY-MM-DD
  readonly label: string;
  readonly lineNumber: number;
}

export interface HolidayRange {
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string; // YYYY-MM-DD
  readonly label: string;
  readonly lineNumber: number;
}

export interface GanttHolidays {
  readonly dates: readonly HolidayDate[];
  readonly ranges: readonly HolidayRange[];
  readonly workweek: readonly Weekday[]; // default: ['mon', 'tue', 'wed', 'thu', 'fri']
}

// ── Eras & Markers (reuse timeline types) ───────────────────

export interface GanttEra {
  readonly startDate: string; // YYYY-MM-DD or '' when using offset form
  readonly endDate: string; // YYYY-MM-DD or '' when using offset form
  readonly label: string;
  readonly color: string | null;
  readonly lineNumber: number;
  readonly offsetStart?: Offset; // +Nunit form (resolved to date via chart start)
  readonly offsetEnd?: Offset; // +Nunit form (resolved to date via chart start)
}

export interface GanttMarker {
  readonly date: string; // YYYY-MM-DD or '' when using offset form
  readonly label: string;
  readonly color: string | null;
  readonly lineNumber: number;
  readonly offsetDate?: Offset; // +Nunit form (resolved to date via chart start)
}

// ── Chart Options ───────────────────────────────────────────

export interface GanttOptions {
  start: string | null; // YYYY[-MM[-DD]] or null for relative timeline
  title: string | null;
  titleLineNumber: number | null;
  todayMarker: 'off' | 'on' | string; // 'on' = current date, string = YYYY-MM-DD
  criticalPath: boolean;
  dependencies: boolean;
  sort: 'default' | 'tag';
  defaultSwimlaneGroup: string | null; // tag group name from `sort: tag:Team`
  activeTag: string | null; // from `active-tag GroupName` or `active-tag none`
  /** Line numbers for option/block keywords — maps key to source line */
  optionLineNumbers: Record<string, number>;
  holidaysLineNumber: number | null;
  // ── Sprint options ─────────────────────────────────────────
  sprintLength: Duration | null; // default { amount: 2, unit: 'w' } when sprint mode active
  sprintNumber: number | null; // which sprint the chart starts at (default 1)
  sprintStart: string | null; // YYYY-MM-DD — date that sprintNumber begins
  sprintMode: 'auto' | 'explicit' | null; // auto = activated by `s` unit, explicit = sprint-* option present
  /** When true, render bars at full intent saturation instead of the canonical 25% tint. */
  /** §1.9 fill family; undefined ⇒ canonical 25% tint. */
  fillMode: 'solid' | 'outline' | undefined;
  /** When true, the renderer suppresses the chart banner title. */
  noTitle: boolean;
  /** §1.9 `no-legend` — suppress the tag legend and collapse its reserved band. */
  noLegend: boolean;
  /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
  legendInline?: boolean;
}

// ── Parsed Result ───────────────────────────────────────────

export interface ParsedGantt {
  readonly nodes: readonly GanttNode[]; // top-level tree (groups, tasks, parallel blocks)
  readonly holidays: GanttHolidays;
  readonly tagGroups: readonly TagGroup[];
  readonly eras: readonly GanttEra[];
  readonly markers: readonly GanttMarker[];
  readonly options: GanttOptions;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
  readonly syntaxMode: 'new' | 'legacy';
}

// ── Resolved Schedule ───────────────────────────────────────

export interface ResolvedTask {
  task: GanttTask;
  startDate: Date;
  endDate: Date;
  isCriticalPath: boolean;
  isUncertain: boolean; // true if task.uncertain OR any predecessor is uncertain
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
  collapsed?: boolean; // seeded from the `[Group] collapsed: true` source marker
}

export interface ResolvedSprint {
  number: number;
  startDate: Date;
  endDate: Date;
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
  sprints: ResolvedSprint[];
  options: GanttOptions;
  diagnostics: DgmoError[];
  error: string | null;
}
