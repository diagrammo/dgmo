// ============================================================
// Gantt Chart Parser
// ============================================================

import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { TagGroup, TagEntry } from '../utils/tag-groups';
import { matchTagBlockHeading } from '../utils/tag-groups';
import { measureIndent, extractColor, parsePipeMetadata } from '../utils/parsing';
import type { PaletteColors } from '../palettes';
import { resolveColor } from '../colors';
import { getSeriesColors } from '../palettes';
import type {
  ParsedGantt,
  GanttNode,
  GanttTask,
  GanttGroup,
  GanttParallelBlock,
  GanttDependency,
  GanttHolidays,
  GanttEra,
  GanttMarker,
  GanttOptions,
  Duration,
  DurationUnit,
  Weekday,
} from './types';

// ── Regexes ─────────────────────────────────────────────────

/** Duration task: `30d: Label`, `1.5w: Label`, `10bd?: Label` */
const DURATION_RE = /^(\d+(?:\.\d+)?)(d|bd|w|m|q|y)(\?)?:\s*(.+)$/;

/** Explicit date task: `2024-01-15: Label` */
const EXPLICIT_DATE_RE = /^(\d{4}-\d{2}-\d{2}):\s*(.+)$/;

/** Timeline migration syntax: `2024-01-15 -> 30d: Label` */
const TIMELINE_DURATION_RE = /^(\d{4}-\d{2}-\d{2})\s*->\s*(\d+(?:\.\d+)?)(d|bd|w|m|q|y)(\?)?:\s*(.+)$/;

/** Group container: `[GroupName]` with optional pipe metadata */
const GROUP_RE = /^\[(.+?)\]\s*(.*)$/;

/** Dependency: `-> TargetName` with optional pipe metadata */
const DEPENDENCY_RE = /^->\s*(.+)$/;

/** Comment line */
const COMMENT_RE = /^\/\//;

/** Era: `era YYYY[-MM[-DD]] -> YYYY[-MM[-DD]]: Label (color?)` */
const ERA_RE = /^era\s+(\d{4}(?:-\d{2}(?:-\d{2})?)?)\s*->\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?)\s*:\s*(.+)$/i;

/** Marker: `marker YYYY[-MM[-DD]]: Label (color?)` */
const MARKER_RE = /^marker\s+(\d{4}(?:-\d{2}(?:-\d{2})?)?)\s*:\s*(.+)$/i;

/** Holiday date: `2024-01-15: Label` */
const HOLIDAY_DATE_RE = /^(\d{4}-\d{2}-\d{2}):\s*(.+)$/;

/** Holiday range: `2024-12-24 -> 2024-12-31: Label` */
const HOLIDAY_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\s*->\s*(\d{4}-\d{2}-\d{2}):\s*(.+)$/;

/** Workweek override: `workweek: sun-thu` */
const WORKWEEK_RE = /^workweek:\s*(.+)$/i;

/** chart: gantt */
const CHART_TYPE_RE = /^chart\s*:\s*(.+)/i;

/** Option lines */
const OPTION_RE = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/i;

// Valid weekday names
const WEEKDAY_MAP: Record<string, Weekday> = {
  mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun',
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun',
};

// ── Block Stack ─────────────────────────────────────────────

type ContainerType = 'group' | 'parallel' | 'task';

interface BlockEntry {
  node: GanttGroup | GanttParallelBlock;
  indent: number;
  containerType: ContainerType;
}

// ── Parser ──────────────────────────────────────────────────

export function parseGantt(content: string, palette?: PaletteColors): ParsedGantt {
  const lines = content.split('\n');
  const diagnostics: DgmoError[] = [];

  const result: ParsedGantt = {
    nodes: [],
    holidays: { dates: [], ranges: [], workweek: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    tagGroups: [],
    eras: [],
    markers: [],
    options: {
      start: null,
      title: null,
      titleLineNumber: null,
      orientation: 'horizontal',
      todayMarker: 'off',
      criticalPath: false,
      dependencies: false,
      sort: 'default',
      defaultSwimlaneGroup: null,
    },
    diagnostics,
    error: null,
  };

  const fail = (line: number, message: string): ParsedGantt => {
    const diag = makeDgmoError(line, message);
    diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const warn = (line: number, message: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  // ── Alias map for pipe metadata ─────────────────────────

  const aliasMap = new Map<string, string>();

  // ── Block stack ─────────────────────────────────────────

  const blockStack: BlockEntry[] = [];

  const currentContainer = (): GanttNode[] => {
    if (blockStack.length === 0) return result.nodes;
    const top = blockStack[blockStack.length - 1];
    return top.node.children;
  };

  const currentGroupPath = (): string[] => {
    const path: string[] = [];
    for (const entry of blockStack) {
      if (entry.containerType === 'group') {
        path.push((entry.node as GanttGroup).name);
      }
    }
    return path;
  };

  // ── State ───────────────────────────────────────────────

  let seenChartType = false;
  let inHeaderBlock = true; // options must come before content
  let inHolidaysBlock = false;
  let holidaysBlockIndent = 0;
  let inTagBlock = false;
  let currentTagGroup: TagGroup | null = null;
  let tagBlockIndent = 0;
  let lastTaskNode: (GanttNode & { kind: 'task' }) | null = null;
  let taskIdCounter = 0;
  const seriesColors = palette ? getSeriesColors(palette) : [];

  // ── Main Parse Loop ─────────────────────────────────────

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    const indent = measureIndent(rawLine);
    const lineNumber = i + 1;

    // Skip empty lines
    if (!line) {
      // Empty line ends holidays/tag blocks only if at root indent
      if (inHolidaysBlock && indent <= holidaysBlockIndent) {
        inHolidaysBlock = false;
      }
      if (inTagBlock && indent <= tagBlockIndent) {
        inTagBlock = false;
        if (currentTagGroup) {
          result.tagGroups.push(currentTagGroup);
          currentTagGroup = null;
        }
      }
      continue;
    }

    // ── Chart type ────────────────────────────────────────

    const chartTypeMatch = line.match(CHART_TYPE_RE);
    if (chartTypeMatch) {
      const type = chartTypeMatch[1].trim().toLowerCase();
      if (type !== 'gantt') {
        return fail(lineNumber, `Expected chart type "gantt", got "${type}"`);
      }
      seenChartType = true;
      continue;
    }

    // ── Holidays block ────────────────────────────────────

    if (inHolidaysBlock) {
      if (indent <= holidaysBlockIndent) {
        inHolidaysBlock = false;
        // fall through to process this line normally
      } else {
        // Parse holiday entries
        const rangeMatch = line.match(HOLIDAY_RANGE_RE);
        if (rangeMatch) {
          result.holidays.ranges.push({
            startDate: rangeMatch[1],
            endDate: rangeMatch[2],
            label: rangeMatch[3].trim(),
            lineNumber,
          });
          continue;
        }

        const dateMatch = line.match(HOLIDAY_DATE_RE);
        if (dateMatch) {
          result.holidays.dates.push({
            date: dateMatch[1],
            label: dateMatch[2].trim(),
            lineNumber,
          });
          continue;
        }

        const workweekMatch = line.match(WORKWEEK_RE);
        if (workweekMatch) {
          const days = parseWorkweek(workweekMatch[1].trim());
          if (days) {
            result.holidays.workweek = days;
          } else {
            warn(lineNumber, `Invalid workweek format: "${workweekMatch[1]}". Use day range like "sun-thu" or comma-separated days.`);
          }
          continue;
        }

        // Skip comments inside holidays
        if (COMMENT_RE.test(line)) continue;

        warn(lineNumber, `Unrecognized holiday entry: "${line}"`);
        continue;
      }
    }

    // ── Tag block entries ─────────────────────────────────

    if (inTagBlock && currentTagGroup) {
      if (indent <= tagBlockIndent) {
        // End of tag block
        inTagBlock = false;
        result.tagGroups.push(currentTagGroup);
        currentTagGroup = null;
        // fall through to process this line normally
      } else {
        // Parse tag entry: `Value(color)` or `Value` with optional `default` suffix
        if (COMMENT_RE.test(line)) continue;
        let entryLine = line;
        let isDefault = false;
        if (entryLine.endsWith(' default') || entryLine.endsWith('\tdefault')) {
          isDefault = true;
          entryLine = entryLine.replace(/\s+default$/, '').trim();
        }
        const extracted = extractColor(entryLine, palette);
        const color = extracted.color || seriesColors[currentTagGroup.entries.length % seriesColors.length] || '#888888';
        currentTagGroup.entries.push({
          value: extracted.label,
          color,
          lineNumber,
        });
        if (isDefault) {
          currentTagGroup.defaultValue = extracted.label;
        }
        continue;
      }
    }

    // ── Close blocks when indent decreases ────────────────
    // CRITICAL: close blocks BEFORE matching new elements

    while (blockStack.length > 0) {
      const top = blockStack[blockStack.length - 1];
      if (indent <= top.indent) {
        blockStack.pop();
        lastTaskNode = null;
      } else {
        break;
      }
    }

    // ── Check if we're inside a task (for deps/comments) ──

    if (lastTaskNode && indent > 0) {
      // Dependency under a task
      const depMatch = line.match(DEPENDENCY_RE);
      if (depMatch) {
        const depParts = depMatch[1].split('|');
        const targetName = depParts[0].trim();
        let lag: Duration | undefined;

        if (depParts.length > 1) {
          const meta = parsePipeMetadata(['', ...depParts.slice(1)], aliasMap);
          if (meta.lag) {
            lag = parseDuration(meta.lag) ?? undefined;
            if (!lag) {
              warn(lineNumber, `Invalid lag duration: "${meta.lag}". Expected format like "3bd" or "5d".`);
            }
          }
        }

        lastTaskNode.dependencies.push({
          targetName,
          lag,
          lineNumber,
        });
        continue;
      }

      // Comment under a task
      if (COMMENT_RE.test(line)) {
        const commentText = line.replace(/^\/\/\s?/, '');
        lastTaskNode.comment = lastTaskNode.comment
          ? lastTaskNode.comment + '\n' + commentText
          : commentText;
        continue;
      }
    }

    // ── Top-level comment ─────────────────────────────────

    if (COMMENT_RE.test(line)) continue;

    // ── Header options ────────────────────────────────────

    if (line.toLowerCase() === 'holidays') {
      inHolidaysBlock = true;
      holidaysBlockIndent = indent;
      inHeaderBlock = false;
      continue;
    }

    // Tag block heading
    const tagMatch = matchTagBlockHeading(line);
    if (tagMatch) {
      inTagBlock = true;
      tagBlockIndent = indent;
      inHeaderBlock = false;
      currentTagGroup = {
        name: tagMatch.name,
        alias: tagMatch.alias,
        entries: [],
        lineNumber,
      };
      if (tagMatch.alias) {
        aliasMap.set(tagMatch.alias.toLowerCase(), tagMatch.name.toLowerCase());
      }
      continue;
    }

    // Era
    const eraMatch = line.match(ERA_RE);
    if (eraMatch) {
      const eraLabelRaw = eraMatch[3].trim();
      const eraExtracted = extractColor(eraLabelRaw, palette);
      result.eras.push({
        startDate: eraMatch[1],
        endDate: eraMatch[2],
        label: eraExtracted.label,
        color: eraExtracted.color || null,
      });
      inHeaderBlock = false;
      continue;
    }

    // Marker
    const markerMatch = line.match(MARKER_RE);
    if (markerMatch) {
      const markerLabelRaw = markerMatch[2].trim();
      const markerExtracted = extractColor(markerLabelRaw, palette);
      result.markers.push({
        date: markerMatch[1],
        label: markerExtracted.label,
        color: markerExtracted.color || null,
        lineNumber,
      });
      inHeaderBlock = false;
      continue;
    }

    // Options (start, title, orientation, etc.)
    const optMatch = line.match(OPTION_RE);
    if (optMatch && isKnownOption(optMatch[1].toLowerCase())) {
      const key = optMatch[1].toLowerCase();
      const value = optMatch[2].trim();

      switch (key) {
        case 'start':
          result.options.start = value;
          break;
        case 'title':
          result.options.title = value;
          result.options.titleLineNumber = lineNumber;
          break;
        case 'orientation':
          if (value === 'horizontal' || value === 'vertical') {
            result.options.orientation = value;
          } else {
            warn(lineNumber, `Invalid orientation: "${value}". Expected "horizontal" or "vertical".`);
          }
          break;
        case 'today-marker':
          if (value === 'on' || value === 'off') {
            result.options.todayMarker = value;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            result.options.todayMarker = value;
          } else {
            warn(lineNumber, `Invalid today-marker value: "${value}". Expected "on", "off", or YYYY-MM-DD.`);
          }
          break;
        case 'critical-path':
          result.options.criticalPath = value === 'on';
          break;
        case 'dependencies':
          result.options.dependencies = value === 'on';
          break;
        case 'sort':
          if (value === 'tag' || value.startsWith('tag:')) {
            result.options.sort = 'tag';
            const colonIdx = value.indexOf(':');
            if (colonIdx !== -1) {
              result.options.defaultSwimlaneGroup = value.slice(colonIdx + 1).trim() || null;
            }
          } else {
            warn(lineNumber, `Invalid sort value: "${value}". Expected "tag" or "tag:GroupName".`);
          }
          break;
      }
      continue;
    }

    inHeaderBlock = false;

    // ── Parallel block ────────────────────────────────────

    if (line === 'parallel') {
      const parallel: GanttParallelBlock = {
        kind: 'parallel',
        lineNumber,
        children: [],
      };
      currentContainer().push(parallel);
      blockStack.push({ node: parallel, indent, containerType: 'parallel' });
      lastTaskNode = null;
      continue;
    }

    // ── Group container ───────────────────────────────────

    const groupMatch = line.match(GROUP_RE);
    if (groupMatch) {
      // Validate nesting: group under a task is invalid
      if (blockStack.length > 0 && blockStack[blockStack.length - 1].containerType === 'task') {
        return fail(lineNumber, `Cannot nest a group inside a task. Groups must be inside other groups or parallel blocks.`);
      }

      const afterBrackets = groupMatch[2].trim();
      const segments = afterBrackets ? afterBrackets.split('|') : [];

      // First segment could be empty (just `[Group]`) or have metadata
      let metadata: Record<string, string> = {};
      let color: string | null = null;

      if (segments.length > 0 && segments[0].trim()) {
        // Check if first segment after brackets is pipe metadata
        metadata = parsePipeMetadata(['', ...segments], aliasMap);
      } else if (segments.length > 1) {
        metadata = parsePipeMetadata(['', ...segments.slice(1)], aliasMap);
      }

      // Extract color from group name if present
      const nameExtracted = extractColor(groupMatch[1], palette);
      if (nameExtracted.color) {
        color = nameExtracted.color;
      }

      const group: GanttGroup = {
        name: nameExtracted.label,
        color,
        metadata,
        lineNumber,
        children: [],
      };
      const groupNode: GanttNode = { kind: 'group', ...group };
      currentContainer().push(groupNode);
      blockStack.push({
        node: groupNode as GanttGroup,
        indent,
        containerType: 'group',
      });
      lastTaskNode = null;
      continue;
    }

    // ── Timeline migration syntax: 2024-01-15 -> 30d: Label ─

    const timelineDurMatch = line.match(TIMELINE_DURATION_RE);
    if (timelineDurMatch) {
      const startDate = timelineDurMatch[1];
      const amount = parseFloat(timelineDurMatch[2]);
      const unit = timelineDurMatch[3] as DurationUnit;
      const uncertain = !!timelineDurMatch[4];
      const labelRaw = timelineDurMatch[5];

      const task = makeTask(labelRaw, { amount, unit }, uncertain, lineNumber, startDate);
      if (result.error) return result;
      const taskNode: GanttNode = { kind: 'task', ...task };
      currentContainer().push(taskNode);
      lastTaskNode = taskNode as GanttNode & { kind: 'task' };
      blockStack.push({ node: taskNode as unknown as GanttGroup, indent, containerType: 'task' });
      continue;
    }

    // ── Duration task: 30d: Label ─────────────────────────

    const durMatch = line.match(DURATION_RE);
    if (durMatch) {
      const amount = parseFloat(durMatch[1]);
      const unit = durMatch[2] as DurationUnit;
      const uncertain = !!durMatch[3];
      const labelRaw = durMatch[4];

      const task = makeTask(labelRaw, { amount, unit }, uncertain, lineNumber);
      if (result.error) return result;
      const taskNode: GanttNode = { kind: 'task', ...task };
      currentContainer().push(taskNode);
      lastTaskNode = taskNode as GanttNode & { kind: 'task' };
      blockStack.push({ node: taskNode as unknown as GanttGroup, indent, containerType: 'task' });
      continue;
    }

    // ── Explicit date task: 2024-01-15: Label ─────────────

    const explicitDateMatch = line.match(EXPLICIT_DATE_RE);
    if (explicitDateMatch) {
      const task = makeTask(
        explicitDateMatch[2],
        null, // no duration — it's a date anchor / milestone
        false,
        lineNumber,
        explicitDateMatch[1],
      );
      if (result.error) return result;
      // Explicit date tasks with no duration are milestones
      const taskNode: GanttNode = { kind: 'task', ...task };
      currentContainer().push(taskNode);
      lastTaskNode = taskNode as GanttNode & { kind: 'task' };
      blockStack.push({ node: taskNode as unknown as GanttGroup, indent, containerType: 'task' });
      continue;
    }

    // ── Dependency at root level (under a task context) ───

    const depMatch = line.match(DEPENDENCY_RE);
    if (depMatch) {
      // Dependency without a task context is an error
      if (!lastTaskNode) {
        return fail(lineNumber, `Dependency "-> ${depMatch[1]}" must be indented under a task.`);
      }
      // This happens when the dep is at the same indent as the task
      const depParts = depMatch[1].split('|');
      const targetName = depParts[0].trim();
      let lag: Duration | undefined;

      if (depParts.length > 1) {
        const meta = parsePipeMetadata(['', ...depParts.slice(1)], aliasMap);
        if (meta.lag) {
          lag = parseDuration(meta.lag) ?? undefined;
          if (!lag) {
            warn(lineNumber, `Invalid lag duration: "${meta.lag}". Expected format like "3bd" or "5d".`);
          }
        }
      }

      lastTaskNode.dependencies.push({ targetName, lag, lineNumber });
      continue;
    }

    // ── Bare label = parse error ──────────────────────────

    return fail(lineNumber, `Expected duration (e.g., "10d: Task"), group brackets (e.g., "[Group]"), or keyword. Got: "${line}"`);
  }

  // ── Finalize ────────────────────────────────────────────

  // Push final tag group if still open
  if (currentTagGroup) {
    result.tagGroups.push(currentTagGroup);
  }

  // If no chart type was declared, that's acceptable (inferred from context)

  // Validate sort: tag requires tag groups
  if (result.options.sort === 'tag' && result.tagGroups.length === 0) {
    warn(0, 'sort: tag has no effect — no tag groups defined.');
    result.options.sort = 'default';
  }

  return result;

  // ── Helper: create a task ───────────────────────────────

  function makeTask(
    labelRaw: string,
    duration: Duration | null,
    uncertain: boolean,
    ln: number,
    explicitStart?: string,
  ): GanttTask {
    const segments = labelRaw.split('|');
    const label = segments[0].trim();

    // Check for reserved keyword
    if (label.toLowerCase() === 'parallel') {
      fail(ln, `"parallel" is a reserved keyword and cannot be used as a task name.`);
    }

    // Parse pipe metadata
    const metadata = segments.length > 1
      ? parsePipeMetadata(segments, aliasMap)
      : {};

    // Extract progress from metadata or shorthand
    let progress: number | null = null;
    if (metadata.progress) {
      progress = parseFloat(metadata.progress);
      delete metadata.progress;
    }
    // Check for progress shorthand: `| 80%`
    for (let j = 1; j < segments.length; j++) {
      const seg = segments[j].trim();
      const progressMatch = seg.match(/^(\d+)%$/);
      if (progressMatch) {
        progress = parseInt(progressMatch[1], 10);
      }
    }

    // Inherit metadata from parent groups (tag inheritance)
    const groupPath = currentGroupPath();
    const inheritedMeta: Record<string, string> = {};
    for (const entry of blockStack) {
      if (entry.containerType === 'group') {
        const groupNode = entry.node as GanttGroup;
        Object.assign(inheritedMeta, groupNode.metadata);
      }
      // parallel blocks are transparent for tags — skip
    }
    // Task's own metadata overrides inherited
    const effectiveMetadata = { ...inheritedMeta, ...metadata };

    const id = `task_${taskIdCounter++}`;

    return {
      id,
      label,
      duration,
      explicitStart,
      uncertain,
      progress,
      dependencies: [],
      metadata: effectiveMetadata,
      lineNumber: ln,
      groupPath,
    };
  }
}

// ── Utility: parse a duration string like "3bd" or "5d" ───

function parseDuration(s: string): Duration | null {
  const match = s.trim().match(/^(\d+(?:\.\d+)?)(d|bd|w|m|q|y)$/);
  if (!match) return null;
  return { amount: parseFloat(match[1]), unit: match[2] as DurationUnit };
}

// ── Utility: parse workweek string ────────────────────────

function parseWorkweek(s: string): Weekday[] | null {
  // Try range format: "sun-thu"
  const rangeParts = s.toLowerCase().split('-');
  if (rangeParts.length === 2) {
    const start = WEEKDAY_MAP[rangeParts[0].trim()];
    const end = WEEKDAY_MAP[rangeParts[1].trim()];
    if (start && end) {
      const allDays: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const startIdx = allDays.indexOf(start);
      const endIdx = allDays.indexOf(end);
      const days: Weekday[] = [];
      let idx = startIdx;
      while (true) {
        days.push(allDays[idx]);
        if (idx === endIdx) break;
        idx = (idx + 1) % 7;
      }
      return days;
    }
  }

  // Try comma-separated: "mon, tue, wed, thu, fri"
  const parts = s.toLowerCase().split(',').map(p => p.trim());
  const days: Weekday[] = [];
  for (const part of parts) {
    const day = WEEKDAY_MAP[part];
    if (!day) return null;
    days.push(day);
  }
  return days.length > 0 ? days : null;
}

// ── Known option keys ─────────────────────────────────────

const KNOWN_OPTIONS = new Set([
  'start', 'title', 'orientation', 'today-marker',
  'critical-path', 'dependencies', 'chart', 'sort',
]);

function isKnownOption(key: string): boolean {
  return KNOWN_OPTIONS.has(key);
}
