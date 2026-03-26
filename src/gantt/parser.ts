// ============================================================
// Gantt Chart Parser
// ============================================================

import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { TagGroup, TagEntry } from '../utils/tag-groups';
import { matchTagBlockHeading } from '../utils/tag-groups';
import { measureIndent, extractColor, parsePipeMetadata, MULTIPLE_PIPE_WARNING, parseFirstLine, prescanOptions, GROUP_HASH_RE } from '../utils/parsing';
import { parseOffset } from '../utils/duration';
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
  Offset,
  Weekday,
} from './types';

// ── Regexes ─────────────────────────────────────────────────

/** Duration task: `30d Label`, `1.5w Label`, `10bd? Label`, `2h Label`, `90min Label` */
const DURATION_RE = /^(\d+(?:\.\d+)?)(min|bd|d|w|m|q|y|h)(\?)?\s+(.+)$/;

/** Explicit date task: `2024-01-15 Label` or `2024-01-15 14:30 Label` */
const EXPLICIT_DATE_RE = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s+(.+)$/;

/** Timeline migration syntax: `2024-01-15 -> 30d Label` or `2024-01-15 14:30 -> 2h Label` */
const TIMELINE_DURATION_RE = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s*->\s*(\d+(?:\.\d+)?)(min|bd|d|w|m|q|y|h)(\?)?\s+(.+)$/;

/** Group container: `[GroupName]` with optional pipe metadata */
const GROUP_RE = /^\[(.+?)\]\s*(.*)$/;

/** Dependency: `-> TargetName` or `-label-> TargetName` with optional pipe metadata */
const DEPENDENCY_RE = /^(?:-(.+?))?->\s*(.+)$/;

/** Comment line */
const COMMENT_RE = /^\/\//;

/** Era: `era YYYY[-MM[-DD[ HH:MM]]] -> YYYY[-MM[-DD[ HH:MM]]] Label (color?)` */
const ERA_RE = /^era\s+(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s*->\s*(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s+(.+)$/i;

/** Marker: `marker YYYY[-MM[-DD[ HH:MM]]] Label (color?)` */
const MARKER_RE = /^marker\s+(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s+(.+)$/i;

/** Holiday date: `2024-01-15 Label` */
const HOLIDAY_DATE_RE = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/;

/** Holiday range: `2024-12-24 -> 2024-12-31 Label` */
const HOLIDAY_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\s*->\s*(\d{4}-\d{2}-\d{2})\s+(.+)$/;

/** Workweek override: `workweek sun-thu` */
const WORKWEEK_RE = /^workweek\s+(.+)$/i;

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
      todayMarker: 'off',
      criticalPath: false,
      dependencies: true,
      sort: 'default',
      defaultSwimlaneGroup: null,
      optionLineNumbers: {},
      holidaysLineNumber: null,
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

  /** Red squiggly but parsing continues — line is wrong, rest of chart is fine */
  const softError = (line: number, message: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'error'));
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

    if (!seenChartType) {
      const firstLineResult = parseFirstLine(line);
      if (firstLineResult) {
        if (firstLineResult.chartType !== 'gantt') {
          return fail(lineNumber, `Expected chart type "gantt", got "${firstLineResult.chartType}"`);
        }
        seenChartType = true;
        if (firstLineResult.title) {
          result.options.title = firstLineResult.title;
          result.options.titleLineNumber = lineNumber;
        }
        continue;
      }
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
        // Parse tag entry: `Value(color)` or `Value`
        // First entry is the default (no `default` keyword needed)
        if (COMMENT_RE.test(line)) continue;
        const extracted = extractColor(line, palette);
        const color = extracted.color || seriesColors[currentTagGroup.entries.length % seriesColors.length] || '#888888';
        const isFirstEntry = currentTagGroup.entries.length === 0;
        currentTagGroup.entries.push({
          value: extracted.label,
          color,
          lineNumber,
        });
        if (isFirstEntry) {
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
        const label = depMatch[1]?.trim() || undefined;
        const depParts = depMatch[2].split('|');
        const targetName = depParts[0].trim();
        let offset: Offset | undefined;

        if (depParts.length > 1) {
          const meta = parsePipeMetadata(['', ...depParts.slice(1)], aliasMap, () => warn(lineNumber, MULTIPLE_PIPE_WARNING));
          if (meta.lag || meta.lead) {
            const key = meta.lag ? 'lag' : 'lead';
            softError(lineNumber, `"${key}" is no longer supported — use "offset: ${meta[key]}" instead.${key === 'lead' ? ' Negate the value for lead behavior: "offset: -...".' : ''}`);
          }
          if (meta.offset) {
            const raw = meta.offset;
            if (raw.trim().startsWith('+')) {
              warn(lineNumber, `Invalid offset: "${raw}". Explicit "+" is not supported — use "${raw.trim().slice(1)}" instead.`);
            } else {
              offset = parseOffset(raw) ?? undefined;
              if (!offset) {
                warn(lineNumber, `Invalid offset: "${raw}". Expected format like "3bd", "-5d", or "0bd".`);
              }
            }
          }
        }

        lastTaskNode.dependencies.push({
          targetName,
          label,
          offset,
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

    if (line.toLowerCase() === 'holiday' || line.toLowerCase() === 'holidays') {
      inHolidaysBlock = true;
      holidaysBlockIndent = indent;
      inHeaderBlock = false;
      result.options.holidaysLineNumber = lineNumber;
      continue;
    }

    // Single-line holiday: `holiday 2024-12-25 Christmas`
    const holidayInlineMatch = line.match(/^holiday\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/i);
    if (holidayInlineMatch) {
      result.holidays.dates.push({
        date: holidayInlineMatch[1],
        label: holidayInlineMatch[2].trim(),
        lineNumber,
      });
      result.options.holidaysLineNumber ??= lineNumber;
      inHeaderBlock = false;
      continue;
    }

    // Tag block heading
    const tagMatch = matchTagBlockHeading(line);
    if (tagMatch) {
      if (tagMatch.deprecated) {
        softError(lineNumber, `'## ${tagMatch.name}' is no longer supported — use 'tag ${tagMatch.name}' instead`);
        continue;
      }
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
        lineNumber,
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

    // Options — space-separated: `start 2024-04-01`, `title My Plan`
    // Boolean options: bare keyword = on, `no-X` = off
    const optNoColonMatch = line.match(/^([a-z][a-z0-9-]*)\s+(.+)$/i);
    const bareKeyword = line.match(/^([a-z][a-z0-9-]*)$/i);

    // Bare boolean keywords
    if (bareKeyword && KNOWN_BOOLEANS.has(bareKeyword[1].toLowerCase())) {
      const key = bareKeyword[1].toLowerCase();
      result.options.optionLineNumbers[key] = lineNumber;
      switch (key) {
        case 'critical-path':
          result.options.criticalPath = true;
          break;
        case 'today-marker':
          result.options.todayMarker = 'on';
          break;
      }
      continue;
    }

    // Negated booleans: `no-dependencies`, `no-critical-path`
    if (bareKeyword && bareKeyword[1].toLowerCase().startsWith('no-')) {
      const base = bareKeyword[1].toLowerCase().substring(3);
      if (KNOWN_BOOLEANS.has(base)) {
        result.options.optionLineNumbers[base] = lineNumber;
        switch (base) {
          case 'dependencies':
            result.options.dependencies = false;
            break;
          case 'critical-path':
            result.options.criticalPath = false;
            break;
          case 'today-marker':
            result.options.todayMarker = 'off';
            break;
        }
        continue;
      }
    }

    if (optNoColonMatch && isKnownOption(optNoColonMatch[1].toLowerCase())) {
      const key = optNoColonMatch[1].toLowerCase();
      const value = optNoColonMatch[2].trim();
      result.options.optionLineNumbers[key] = lineNumber;

      switch (key) {
        case 'start':
          result.options.start = value;
          break;
        case 'title':
          result.options.title = value;
          result.options.titleLineNumber = lineNumber;
          break;
        case 'orientation':
          warn(lineNumber, `'orientation' is not supported for gantt charts`);
          break;
        case 'today-marker':
          if (/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(value)) {
            result.options.todayMarker = value;
          } else {
            warn(lineNumber, `Invalid today-marker value: "${value}". Expected YYYY-MM-DD.`);
          }
          break;
        case 'critical-path':
          result.options.criticalPath = true;
          break;
        case 'dependencies':
          // Boolean with value — but `dependencies` is now default ON, so only `no-dependencies` turns it off
          result.options.dependencies = true;
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

    // ── `# Group` alternate syntax ──────────────────────────

    const hashGroupMatch = line.match(GROUP_HASH_RE);
    if (hashGroupMatch) {
      const nameExtracted = extractColor(hashGroupMatch[1], palette);
      const group: GanttGroup = {
        name: nameExtracted.label,
        color: nameExtracted.color || null,
        metadata: {},
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
        softError(lineNumber, `Cannot nest a group inside a task. Groups must be inside other groups or parallel blocks.`);
        continue;
      }

      const afterBrackets = groupMatch[2].trim();
      const segments = afterBrackets ? afterBrackets.split('|') : [];

      // First segment could be empty (just `[Group]`) or have metadata
      let metadata: Record<string, string> = {};
      let color: string | null = null;

      const pipeWarn = () => warn(lineNumber, MULTIPLE_PIPE_WARNING);
      if (segments.length > 0 && segments[0].trim()) {
        // Check if first segment after brackets is pipe metadata
        metadata = parsePipeMetadata(['', ...segments], aliasMap, pipeWarn);
      } else if (segments.length > 1) {
        metadata = parsePipeMetadata(['', ...segments.slice(1)], aliasMap, pipeWarn);
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
        softError(lineNumber, `Dependency "-> ${depMatch[2]}" must be indented under a task.`);
        continue;
      }
      // This happens when the dep is at the same indent as the task
      const label = depMatch[1]?.trim() || undefined;
      const depParts = depMatch[2].split('|');
      const targetName = depParts[0].trim();
      let offset: Offset | undefined;

      if (depParts.length > 1) {
        const meta = parsePipeMetadata(['', ...depParts.slice(1)], aliasMap, () => warn(lineNumber, MULTIPLE_PIPE_WARNING));
        if (meta.lag || meta.lead) {
          const key = meta.lag ? 'lag' : 'lead';
          softError(lineNumber, `"${key}" is no longer supported — use "offset: ${meta[key]}" instead.${key === 'lead' ? ' Negate the value for lead behavior: "offset: -...".' : ''}`);
        }
        if (meta.offset) {
          const raw = meta.offset;
          if (raw.trim().startsWith('+')) {
            warn(lineNumber, `Invalid offset: "${raw}". Explicit "+" is not supported — use "${raw.trim().slice(1)}" instead.`);
          } else {
            offset = parseOffset(raw) ?? undefined;
            if (!offset) {
              warn(lineNumber, `Invalid offset: "${raw}". Expected format like "3bd", "-5d", or "0bd".`);
            }
          }
        }
      }

      lastTaskNode.dependencies.push({ targetName, label, offset, lineNumber });
      continue;
    }

    // ── Bare label = parse error ──────────────────────────

    softError(lineNumber, `Expected duration (e.g., "10d Task"), group brackets (e.g., "[Group]"), or keyword. Got: "${line}"`);
    continue;
  }

  // ── Finalize ────────────────────────────────────────────

  // Push final tag group if still open
  if (currentTagGroup) {
    result.tagGroups.push(currentTagGroup);
  }

  // If no chart type was declared, that's acceptable (inferred from context)

  // Validate sort: tag requires tag groups
  if (result.options.sort === 'tag' && result.tagGroups.length === 0) {
    warn(0, 'sort tag has no effect — no tag groups defined.');
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
      softError(ln, `"parallel" is a reserved keyword and cannot be used as a task name.`);
    }

    // Parse pipe metadata
    const metadata = segments.length > 1
      ? parsePipeMetadata(segments, aliasMap, () => warn(ln, MULTIPLE_PIPE_WARNING))
      : {};

    // Extract progress from metadata or shorthand
    let progress: number | null = null;
    if (metadata.progress) {
      progress = parseFloat(metadata.progress);
      delete metadata.progress;
    }
    // Check for progress shorthand: `| 80%` or `| t:X, 80%`
    for (const part of segments.slice(1).join(',').split(',')) {
      const seg = part.trim();
      const progressMatch = seg.match(/^(\d+)%$/);
      if (progressMatch) {
        progress = parseInt(progressMatch[1], 10);
      }
    }

    // Reject lag/lead — use offset instead
    if (metadata.lag || metadata.lead) {
      const key = metadata.lag ? 'lag' : 'lead';
      softError(ln, `"${key}" is no longer supported — use "offset: ${metadata[key]}" instead.${key === 'lead' ? ' Negate the value for lead behavior: "offset: -...".' : ''}`);
    }

    // Extract task-level offset from metadata
    let taskOffset: Offset | undefined;
    if (metadata.offset) {
      const raw = metadata.offset;
      if (raw.trim().startsWith('+')) {
        warn(ln, `Invalid offset: "${raw}". Explicit "+" is not supported — use "${raw.trim().slice(1)}" instead.`);
      } else {
        taskOffset = parseOffset(raw) ?? undefined;
        if (!taskOffset) {
          warn(ln, `Invalid offset: "${raw}". Expected format like "3bd", "-5d", or "0bd".`);
        }
      }
      delete metadata.offset;
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
      offset: taskOffset,
      dependencies: [],
      metadata: effectiveMetadata,
      lineNumber: ln,
      groupPath,
    };
  }
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

/** Boolean options that can appear as bare keywords or with `no-` prefix. */
const KNOWN_BOOLEANS = new Set([
  'critical-path', 'today-marker', 'dependencies',
]);

function isKnownOption(key: string): boolean {
  return KNOWN_OPTIONS.has(key);
}
