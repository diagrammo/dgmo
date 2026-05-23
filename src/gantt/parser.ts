// ============================================================
// Gantt Chart Parser
// ============================================================

import {
  formatDgmoError,
  ganttBarePercentRemovedMessage,
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  pipeOperatorRemovedMessage,
} from '../diagnostics';
import { GANTT_REGISTRY, withTagAliases } from '../utils/reserved-key-registry';
import { splitNameAndMeta } from '../utils/parsing';
import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  stripDefaultModifier,
  validateTagGroupNames,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  MULTIPLE_PIPE_ERROR,
  parseFirstLine,
} from '../utils/parsing';
import { parseOffset, parseDuration } from '../utils/duration';
import { normalizeName } from '../utils/name-normalize';
import type { PaletteColors } from '../palettes';
import { getSeriesColors } from '../palettes';
import type {
  ParsedGantt,
  GanttNode,
  GanttTask,
  GanttGroup,
  GanttParallelBlock,
  Duration,
  DurationUnit,
  Offset,
  Weekday,
} from './types';

// ── Regexes ─────────────────────────────────────────────────

/** Duration task: `30d Label`, `1.5w Label`, `10bd? Label`, `2h Label`, `90min Label` */
const DURATION_RE = /^(\d+(?:\.\d+)?)(min|bd|d|w|m|q|y|h|s)(\?)?\s+(.+)$/;

/** Explicit date task: `2024-01-15 Label` or `2024-01-15 14:30 Label` */
const EXPLICIT_DATE_RE = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s+(.+)$/;

/** Timeline migration syntax: `2024-01-15 -> 30d Label` or `2024-01-15 14:30 -> 2h Label` */
const TIMELINE_DURATION_RE =
  /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s*(?:->|\u2013>)\s*(\d+(?:\.\d+)?)(min|bd|d|w|m|q|y|h|s)(\?)?\s+(.+)$/;

/** Group container: `[GroupName]` with optional pipe metadata */
const GROUP_RE = /^\[(.+?)\]\s*(.*)$/;

/** Dependency: `-> TargetName` or `-label-> TargetName` with optional pipe metadata */
const DEPENDENCY_RE = /^(?:-(.+?))?->\s*(.+)$/;

/** Comment line */
const COMMENT_RE = /^\/\//;

/** Era: `era YYYY[-MM[-DD[ HH:MM]]] -> YYYY[-MM[-DD[ HH:MM]]] Label (color?)` */
const ERA_RE =
  /^era\s+(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s+(.+)$/i;

/** Marker: `marker YYYY[-MM[-DD[ HH:MM]]] Label (color?)` */
const MARKER_RE =
  /^marker\s+(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s+(.+)$/i;

/** Holiday date: `2024-01-15 Label` */
const HOLIDAY_DATE_RE = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/;

/** Holiday range: `2024-12-24 -> 2024-12-31 Label` */
const HOLIDAY_RANGE_RE =
  /^(\d{4}-\d{2}-\d{2})\s*(?:->|\u2013>)\s*(\d{4}-\d{2}-\d{2})\s+(.+)$/;

/** Workweek override: `workweek sun-thu` */
const WORKWEEK_RE = /^workweek\s+(.+)$/i;

/** Era entry (inside era block, no `era` prefix): `YYYY[-MM[-DD[ HH:MM]]] -> YYYY[-MM[-DD[ HH:MM]]] Label` */
const ERA_ENTRY_RE =
  /^(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s+(.+)$/;

/** Marker entry (inside marker block, no `marker` prefix): `YYYY[-MM[-DD[ HH:MM]]] Label` */
const MARKER_ENTRY_RE =
  /^(\d{4}(?:-\d{2}(?:-\d{2}(?: \d{2}:\d{2})?)?)?)\s+(.+)$/;

// Valid weekday names
const WEEKDAY_MAP: Record<string, Weekday> = {
  mon: 'mon',
  tue: 'tue',
  wed: 'wed',
  thu: 'thu',
  fri: 'fri',
  sat: 'sat',
  sun: 'sun',
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
  sunday: 'sun',
};

// ── Block Stack ─────────────────────────────────────────────

type ContainerType = 'group' | 'parallel' | 'task';

interface BlockEntry {
  node: Writable<GanttGroup> | Writable<GanttParallelBlock>;
  indent: number;
  containerType: ContainerType;
}

// ── Parser ──────────────────────────────────────────────────

export function parseGantt(
  content: string,
  palette?: PaletteColors
): ParsedGantt {
  const lines = content.split('\n');
  const diagnostics: DgmoError[] = [];

  const holidays: Writable<ParsedGantt['holidays']> = {
    dates: [],
    ranges: [],
    workweek: ['mon', 'tue', 'wed', 'thu', 'fri'],
  };
  const result: Writable<ParsedGantt> = {
    nodes: [],
    holidays,
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
      activeTag: null,
      optionLineNumbers: {},
      holidaysLineNumber: null,
      sprintLength: null,
      sprintNumber: null,
      sprintStart: null,
      sprintMode: null,
      solidFill: false,
      noTitle: false,
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

  // ── Alias map for pipe metadata (per A1 convention) ─────

  const metaAliasMap = new Map<string, string>();
  // ── nameAliasMap: TD-18 entity-name aliases (per C8) ────
  const nameAliasMap = new Map<string, string>();
  function peelAlias(label: string): { label: string; alias?: string } {
    const trimmed = label.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (!m) return { label: trimmed };
    // Capture groups 1 and 2 are guaranteed by successful regex match.
    return { label: m[1]!.trim(), alias: m[2]! };
  }
  function resolveAliasTarget(token: string): string {
    return nameAliasMap.get(token.trim()) ?? token;
  }

  // ── Block stack ─────────────────────────────────────────

  const blockStack: BlockEntry[] = [];

  const currentContainer = (): GanttNode[] => {
    if (blockStack.length === 0) return result.nodes;
    // In-bounds by length > 0 guard above.
    const top = blockStack[blockStack.length - 1]!;
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
  let inHolidaysBlock = false;
  let holidaysBlockIndent = 0;
  let inTagBlock = false;
  let currentTagGroup: Writable<TagGroup> | null = null;
  let tagBlockIndent = 0;
  let inEraBlock = false;
  let eraBlockIndent = 0;
  let inMarkerBlock = false;
  let markerBlockIndent = 0;
  let lastTaskNode: Writable<GanttNode & { kind: 'task' }> | null = null;
  let taskIdCounter = 0;
  const seriesColors = palette ? getSeriesColors(palette) : [];

  // ── Main Parse Loop ─────────────────────────────────────

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    const indent = measureIndent(rawLine);
    const lineNumber = i + 1;

    // Skip empty lines
    if (!line) {
      // Empty line ends holidays/tag/era/marker blocks only if at root indent
      if (inHolidaysBlock && indent <= holidaysBlockIndent) {
        inHolidaysBlock = false;
      }
      if (inEraBlock && indent <= eraBlockIndent) {
        inEraBlock = false;
      }
      if (inMarkerBlock && indent <= markerBlockIndent) {
        inMarkerBlock = false;
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
          return fail(
            lineNumber,
            `Expected chart type "gantt", got "${firstLineResult.chartType}"`
          );
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
          // Capture groups 1-3 guaranteed by successful regex match.
          holidays.ranges.push({
            startDate: rangeMatch[1]!,
            endDate: rangeMatch[2]!,
            label: rangeMatch[3]!.trim(),
            lineNumber,
          });
          continue;
        }

        const dateMatch = line.match(HOLIDAY_DATE_RE);
        if (dateMatch) {
          // Capture groups 1-2 guaranteed by successful regex match.
          holidays.dates.push({
            date: dateMatch[1]!,
            label: dateMatch[2]!.trim(),
            lineNumber,
          });
          continue;
        }

        const workweekMatch = line.match(WORKWEEK_RE);
        if (workweekMatch) {
          // Capture group 1 guaranteed by successful regex match.
          const days = parseWorkweek(workweekMatch[1]!.trim());
          if (days) {
            holidays.workweek = days;
          } else {
            warn(
              lineNumber,
              `Invalid workweek format: "${workweekMatch[1]}". Use day range like "sun-thu" or comma-separated days.`
            );
          }
          continue;
        }

        // Skip comments inside holidays
        if (COMMENT_RE.test(line)) continue;

        warn(lineNumber, `Unrecognized holiday entry: "${line}"`);
        continue;
      }
    }

    // ── Era block entries ─────────────────────────────────

    if (inEraBlock) {
      if (indent <= eraBlockIndent) {
        inEraBlock = false;
        // fall through to process this line normally
      } else {
        if (COMMENT_RE.test(line)) continue;
        const eraEntryMatch = line.match(ERA_ENTRY_RE);
        if (eraEntryMatch) {
          // Capture groups 1-3 guaranteed by successful regex match.
          const eraLabelRaw = eraEntryMatch[3]!.trim();
          const eraExtracted = extractColor(eraLabelRaw, palette);
          result.eras.push({
            startDate: eraEntryMatch[1]!,
            endDate: eraEntryMatch[2]!,
            label: eraExtracted.label,
            color: eraExtracted.color || null,
            lineNumber,
          });
        } else {
          warn(lineNumber, `Unrecognized era entry: "${line}"`);
        }
        continue;
      }
    }

    // ── Marker block entries ─────────────────────────────

    if (inMarkerBlock) {
      if (indent <= markerBlockIndent) {
        inMarkerBlock = false;
        // fall through to process this line normally
      } else {
        if (COMMENT_RE.test(line)) continue;
        const markerEntryMatch = line.match(MARKER_ENTRY_RE);
        if (markerEntryMatch) {
          // Capture groups 1-2 guaranteed by successful regex match.
          const markerLabelRaw = markerEntryMatch[2]!.trim();
          const markerExtracted = extractColor(markerLabelRaw, palette);
          result.markers.push({
            date: markerEntryMatch[1]!,
            label: markerExtracted.label,
            color: markerExtracted.color || null,
            lineNumber,
          });
        } else {
          warn(lineNumber, `Unrecognized marker entry: "${line}"`);
        }
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
        // Parse tag entry: `Value color` or `Value`
        // First entry is the default unless another is marked `default`
        if (COMMENT_RE.test(line)) continue;
        const { text: cleanEntry, isDefault } = stripDefaultModifier(line);
        const extracted = extractColor(cleanEntry, palette);
        const color =
          extracted.color ||
          seriesColors[currentTagGroup.entries.length % seriesColors.length] ||
          '#888888';
        const isFirstEntry = currentTagGroup.entries.length === 0;
        currentTagGroup.entries.push({
          value: extracted.label,
          color,
          lineNumber,
        });
        if (isDefault) {
          currentTagGroup.defaultValue = extracted.label;
        } else if (isFirstEntry) {
          currentTagGroup.defaultValue = extracted.label;
        }
        continue;
      }
    }

    // ── Close blocks when indent decreases ────────────────
    // CRITICAL: close blocks BEFORE matching new elements

    while (blockStack.length > 0) {
      // In-bounds by while-loop guard.
      const top = blockStack[blockStack.length - 1]!;
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
        // Capture group 2 guaranteed by successful regex match.
        const depParts = depMatch[2]!.split('|');
        // TD-18: resolve alias literal → canonical task label; depParts has at
        // least one element from split.
        const targetName = resolveAliasTarget(depParts[0]!.trim());
        let offset: Offset | undefined;

        if (depParts.length > 1) {
          const meta = parsePipeMetadata(
            ['', ...depParts.slice(1)],
            metaAliasMap,
            () => warn(lineNumber, MULTIPLE_PIPE_ERROR)
          );
          if (meta['lag'] || meta['lead']) {
            const key = meta['lag'] ? 'lag' : 'lead';
            softError(
              lineNumber,
              `"${key}" is no longer supported — use "offset: ${meta[key]}" instead.${key === 'lead' ? ' Negate the value for lead behavior: "offset: -...".' : ''}`
            );
          }
          if (meta['offset']) {
            const raw = meta['offset'];
            if (raw.trim().startsWith('+')) {
              warn(
                lineNumber,
                `Invalid offset: "${raw}". Explicit "+" is not supported — use "${raw.trim().slice(1)}" instead.`
              );
            } else {
              offset = parseOffset(raw) ?? undefined;
              if (!offset) {
                warn(
                  lineNumber,
                  `Invalid offset: "${raw}". Expected format like "3bd", "-5d", or "0bd".`
                );
              }
            }
          }
        }

        lastTaskNode.dependencies.push({
          targetName,
          ...(label !== undefined && { label }),
          ...(offset !== undefined && { offset }),
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
      result.options.holidaysLineNumber = lineNumber;
      continue;
    }

    // Single-line holiday: `holiday 2024-12-25 Christmas`
    const holidayInlineMatch = line.match(
      /^holiday\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/i
    );
    if (holidayInlineMatch) {
      // Capture groups 1-2 guaranteed by successful regex match.
      holidays.dates.push({
        date: holidayInlineMatch[1]!,
        label: holidayInlineMatch[2]!.trim(),
        lineNumber,
      });
      result.options.holidaysLineNumber ??= lineNumber;
      continue;
    }

    // Tag block heading
    const tagMatch = matchTagBlockHeading(line);
    if (tagMatch) {
      emitTagLegacyDiagnostic(tagMatch, lineNumber, result.diagnostics);
      inTagBlock = true;
      tagBlockIndent = indent;
      currentTagGroup = {
        name: tagMatch.name,
        ...(tagMatch.alias !== undefined && { alias: tagMatch.alias }),
        entries: [],
        lineNumber,
      };
      if (tagMatch.alias) {
        metaAliasMap.set(
          normalizeName(tagMatch.alias),
          tagMatch.name.toLowerCase()
        );
      }
      continue;
    }

    // Top-level workweek (outside holiday block)
    const topWorkweekMatch = line.match(WORKWEEK_RE);
    if (topWorkweekMatch) {
      // Capture group 1 guaranteed by successful regex match.
      const days = parseWorkweek(topWorkweekMatch[1]!.trim());
      if (days) {
        holidays.workweek = days;
      } else {
        warn(
          lineNumber,
          `Invalid workweek format: "${topWorkweekMatch[1]}". Use day range like "sun-thu" or comma-separated days.`
        );
      }
      continue;
    }

    // Era block: bare `era` keyword starts a block
    if (line.toLowerCase() === 'era') {
      inEraBlock = true;
      eraBlockIndent = indent;
      continue;
    }

    // Era (inline)
    const eraMatch = line.match(ERA_RE);
    if (eraMatch) {
      // Capture groups 1-3 guaranteed by successful regex match.
      const eraLabelRaw = eraMatch[3]!.trim();
      const eraExtracted = extractColor(eraLabelRaw, palette);
      result.eras.push({
        startDate: eraMatch[1]!,
        endDate: eraMatch[2]!,
        label: eraExtracted.label,
        color: eraExtracted.color || null,
        lineNumber,
      });
      continue;
    }

    // Marker block: bare `marker` keyword starts a block
    if (line.toLowerCase() === 'marker') {
      inMarkerBlock = true;
      markerBlockIndent = indent;
      continue;
    }

    // Marker (inline)
    const markerMatch = line.match(MARKER_RE);
    if (markerMatch) {
      // Capture groups 1-2 guaranteed by successful regex match.
      const markerLabelRaw = markerMatch[2]!.trim();
      const markerExtracted = extractColor(markerLabelRaw, palette);
      result.markers.push({
        date: markerMatch[1]!,
        label: markerExtracted.label,
        color: markerExtracted.color || null,
        lineNumber,
      });
      continue;
    }

    // Options — space-separated: `start 2024-04-01`, `title My Plan`
    // Boolean options: bare keyword = on, `no-X` = off
    const optNoColonMatch = line.match(/^([a-z][a-z0-9-]*)\s+(.+)$/i);
    const bareKeyword = line.match(/^([a-z][a-z0-9-]*)$/i);

    // Bare boolean keywords
    // Capture group 1 guaranteed by successful regex match.
    if (bareKeyword && KNOWN_BOOLEANS.has(bareKeyword[1]!.toLowerCase())) {
      const key = bareKeyword[1]!.toLowerCase();
      result.options.optionLineNumbers[key] = lineNumber;
      switch (key) {
        case 'critical-path':
          result.options.criticalPath = true;
          break;
        case 'today-marker':
          result.options.todayMarker = 'on';
          break;
        case 'solid-fill':
          result.options.solidFill = true;
          break;
        case 'no-title':
          result.options.noTitle = true;
          break;
      }
      continue;
    }

    // Negated booleans: `no-dependencies`, `no-critical-path`
    // Capture group 1 guaranteed by successful regex match.
    if (bareKeyword && bareKeyword[1]!.toLowerCase().startsWith('no-')) {
      const base = bareKeyword[1]!.toLowerCase().substring(3);
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

    // Capture groups 1-2 guaranteed by successful regex match.
    if (optNoColonMatch && isKnownOption(optNoColonMatch[1]!.toLowerCase())) {
      const key = optNoColonMatch[1]!.toLowerCase();
      const value = optNoColonMatch[2]!.trim();
      result.options.optionLineNumbers[key] = lineNumber;

      switch (key) {
        case 'start':
          result.options.start = value;
          break;
        case 'title':
          result.options.title = value;
          result.options.titleLineNumber = lineNumber;
          break;
        case 'today-marker':
          if (/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(value)) {
            result.options.todayMarker = value;
          } else {
            warn(
              lineNumber,
              `Invalid today-marker value: "${value}". Expected YYYY-MM-DD.`
            );
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
              result.options.defaultSwimlaneGroup =
                value.slice(colonIdx + 1).trim() || null;
            }
          } else {
            warn(
              lineNumber,
              `Invalid sort value: "${value}". Expected "tag" or "tag:GroupName".`
            );
          }
          break;
        case 'active-tag':
          result.options.activeTag = value;
          break;
        case 'sprint-length': {
          const dur = parseDuration(value);
          if (!dur) {
            warn(
              lineNumber,
              `Invalid sprint-length value: "${value}". Expected a duration like "2w" or "10d".`
            );
          } else if (dur.unit !== 'd' && dur.unit !== 'w') {
            warn(
              lineNumber,
              `sprint-length only accepts "d" or "w" units, got "${dur.unit}".`
            );
          } else if (dur.amount <= 0) {
            warn(lineNumber, `sprint-length must be greater than 0.`);
          } else if (
            !Number.isInteger(dur.amount * (dur.unit === 'w' ? 7 : 1))
          ) {
            warn(
              lineNumber,
              `sprint-length must resolve to a whole number of days.`
            );
          } else {
            result.options.sprintLength = dur;
          }
          break;
        }
        case 'sprint-number': {
          const n = Number(value);
          if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
            warn(
              lineNumber,
              `sprint-number must be a positive integer, got "${value}".`
            );
          } else {
            result.options.sprintNumber = n;
          }
          break;
        }
        case 'sprint-start': {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            warn(
              lineNumber,
              `sprint-start requires a full date (YYYY-MM-DD), got "${value}".`
            );
          } else if (Number.isNaN(new Date(value + 'T00:00:00').getTime())) {
            warn(lineNumber, `sprint-start is not a valid date: "${value}".`);
          } else {
            result.options.sprintStart = value;
          }
          break;
        }
      }
      continue;
    }

    // ── Parallel block ────────────────────────────────────

    if (line === 'parallel') {
      const parallel: Writable<GanttParallelBlock> = {
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
      // In-bounds by blockStack.length > 0 guard.
      if (
        blockStack.length > 0 &&
        blockStack[blockStack.length - 1]!.containerType === 'task'
      ) {
        softError(
          lineNumber,
          `Cannot nest a group inside a task. Groups must be inside other groups or parallel blocks.`
        );
        continue;
      }

      // Capture group 2 guaranteed by successful regex match.
      const afterBrackets = groupMatch[2]!.trim();
      const segments = afterBrackets ? afterBrackets.split('|') : [];

      // First segment could be empty (just `[Group]`) or have metadata
      let metadata: Record<string, string> = {};
      const color: string | null = null;

      const pipeWarn = () => warn(lineNumber, MULTIPLE_PIPE_ERROR);
      // In-bounds by segments.length > 0 guard.
      if (segments.length > 0 && segments[0]!.trim()) {
        // Check if first segment after brackets is pipe metadata
        metadata = parsePipeMetadata(['', ...segments], metaAliasMap, pipeWarn);
      } else if (segments.length > 1) {
        metadata = parsePipeMetadata(
          ['', ...segments.slice(1)],
          metaAliasMap,
          pipeWarn
        );
      }

      // TD-18: peel optional `as <alias>` from the group label.
      // Capture group 1 guaranteed by successful regex match.
      const groupPeeled = peelAlias(groupMatch[1]!);
      if (groupPeeled.alias)
        nameAliasMap.set(groupPeeled.alias, groupPeeled.label);
      const group: Writable<GanttGroup> = {
        name: groupPeeled.label,
        color,
        metadata,
        lineNumber,
        children: [],
      };
      const groupNode: GanttNode = { kind: 'group', ...group };
      currentContainer().push(groupNode);
      blockStack.push({
        node: groupNode as unknown as Writable<GanttGroup>,
        indent,
        containerType: 'group',
      });
      lastTaskNode = null;
      continue;
    }

    // ── Timeline migration syntax: 2024-01-15 -> 30d: Label ─

    const timelineDurMatch = line.match(TIMELINE_DURATION_RE);
    if (timelineDurMatch) {
      // Capture groups 1, 2, 3, 5 guaranteed by successful regex match; group 4 is optional.
      const startDate = timelineDurMatch[1]!;
      const amount = parseFloat(timelineDurMatch[2]!);
      const unit = timelineDurMatch[3] as DurationUnit;
      const uncertain = !!timelineDurMatch[4];
      const labelRaw = timelineDurMatch[5]!;

      const task = makeTask(
        labelRaw,
        { amount, unit },
        uncertain,
        lineNumber,
        startDate
      );
      const taskNode: GanttNode = { kind: 'task', ...task };
      currentContainer().push(taskNode);
      lastTaskNode = taskNode as Writable<GanttNode & { kind: 'task' }>;
      blockStack.push({
        node: taskNode as unknown as Writable<GanttGroup>,
        indent,
        containerType: 'task',
      });
      continue;
    }

    // ── Duration task: 30d: Label ─────────────────────────

    const durMatch = line.match(DURATION_RE);
    if (durMatch) {
      // Capture groups 1, 2, 4 guaranteed by successful regex match; group 3 is optional.
      const amount = parseFloat(durMatch[1]!);
      const unit = durMatch[2] as DurationUnit;
      const uncertain = !!durMatch[3];
      const labelRaw = durMatch[4]!;

      const task = makeTask(labelRaw, { amount, unit }, uncertain, lineNumber);
      const taskNode: GanttNode = { kind: 'task', ...task };
      currentContainer().push(taskNode);
      lastTaskNode = taskNode as Writable<GanttNode & { kind: 'task' }>;
      blockStack.push({
        node: taskNode as unknown as Writable<GanttGroup>,
        indent,
        containerType: 'task',
      });
      continue;
    }

    // ── Explicit date task: 2024-01-15: Label ─────────────

    const explicitDateMatch = line.match(EXPLICIT_DATE_RE);
    if (explicitDateMatch) {
      // Capture groups 1-2 guaranteed by successful regex match.
      const task = makeTask(
        explicitDateMatch[2]!,
        null, // no duration — it's a date anchor / milestone
        false,
        lineNumber,
        explicitDateMatch[1]!
      );
      // Explicit date tasks with no duration are milestones
      const taskNode: GanttNode = { kind: 'task', ...task };
      currentContainer().push(taskNode);
      lastTaskNode = taskNode as Writable<GanttNode & { kind: 'task' }>;
      blockStack.push({
        node: taskNode as unknown as Writable<GanttGroup>,
        indent,
        containerType: 'task',
      });
      continue;
    }

    // ── Dependency at root level (under a task context) ───

    const depMatch = line.match(DEPENDENCY_RE);
    if (depMatch) {
      // Dependency without a task context is an error
      if (!lastTaskNode) {
        softError(
          lineNumber,
          `Dependency "-> ${depMatch[2]}" must be indented under a task.`
        );
        continue;
      }
      // This happens when the dep is at the same indent as the task
      const label = depMatch[1]?.trim() || undefined;
      // Capture group 2 guaranteed by successful regex match.
      const depParts = depMatch[2]!.split('|');
      // TD-18: resolve alias literal → canonical task label; depParts has at
      // least one element from split.
      const targetName = resolveAliasTarget(depParts[0]!.trim());
      let offset: Offset | undefined;

      if (depParts.length > 1) {
        const meta = parsePipeMetadata(
          ['', ...depParts.slice(1)],
          metaAliasMap,
          () => warn(lineNumber, MULTIPLE_PIPE_ERROR)
        );
        if (meta['lag'] || meta['lead']) {
          const key = meta['lag'] ? 'lag' : 'lead';
          softError(
            lineNumber,
            `"${key}" is no longer supported — use "offset: ${meta[key]}" instead.${key === 'lead' ? ' Negate the value for lead behavior: "offset: -...".' : ''}`
          );
        }
        if (meta['offset']) {
          const raw = meta['offset'];
          if (raw.trim().startsWith('+')) {
            warn(
              lineNumber,
              `Invalid offset: "${raw}". Explicit "+" is not supported — use "${raw.trim().slice(1)}" instead.`
            );
          } else {
            offset = parseOffset(raw) ?? undefined;
            if (!offset) {
              warn(
                lineNumber,
                `Invalid offset: "${raw}". Expected format like "3bd", "-5d", or "0bd".`
              );
            }
          }
        }
      }

      lastTaskNode.dependencies.push({
        targetName,
        ...(label !== undefined && { label }),
        ...(offset !== undefined && { offset }),
        lineNumber,
      });
      continue;
    }

    // ── Bare label = parse error ──────────────────────────

    softError(
      lineNumber,
      `Expected duration (e.g., "10d Task"), group brackets (e.g., "[Group]"), or keyword. Got: "${line}"`
    );
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

  validateTagGroupNames(result.tagGroups, warn, (line, msg) => {
    const diag = makeDgmoError(line, msg);
    diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  });

  // ── Sprint mode detection ──────────────────────────────
  const hasSprintOption =
    result.options.sprintLength !== null ||
    result.options.sprintNumber !== null ||
    result.options.sprintStart !== null;

  const hasSprintUnit = hasSprintDurationUnit(result.nodes);

  if (hasSprintOption) {
    result.options.sprintMode = 'explicit';
  } else if (hasSprintUnit) {
    result.options.sprintMode = 'auto';
  }

  // Apply defaults when sprint mode is active
  if (result.options.sprintMode) {
    if (!result.options.sprintLength) {
      result.options.sprintLength = { amount: 2, unit: 'w' };
    }
    if (result.options.sprintNumber === null) {
      result.options.sprintNumber = 1;
    }
    // sprintStart defaults to chart start or today — handled in calculator
  }

  return result;

  // ── Helper: create a task ───────────────────────────────

  function makeTask(
    labelRaw: string,
    duration: Duration | null,
    uncertain: boolean,
    ln: number,
    explicitStart?: string
  ): GanttTask {
    // Legacy `|` detection per §1.4.
    if (labelRaw.includes('|')) {
      result.diagnostics.push(
        makeDgmoError(
          ln,
          pipeOperatorRemovedMessage(),
          'error',
          METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
        )
      );
    }

    const segments = labelRaw.split('|');
    // TD-18: peel optional `as <alias>` from the label (pre-pipe).
    // split('|') always yields at least one element.
    const peeled = peelAlias(segments[0]!);
    let label = peeled.label;
    if (peeled.alias) nameAliasMap.set(peeled.alias, label);

    // Check for reserved keyword
    if (label.toLowerCase() === 'parallel') {
      softError(
        ln,
        `"parallel" is a reserved keyword and cannot be used as a task name.`
      );
    }

    // Parse pipe metadata (legacy back-compat).
    const metadata: Record<string, string> =
      segments.length > 1
        ? parsePipeMetadata(segments, metaAliasMap, () =>
            warn(ln, MULTIPLE_PIPE_ERROR)
          )
        : {};

    // §1.4 unified metadata grammar — also pick up new same-line form
    // (no pipe) by running splitNameAndMeta on the label segment.
    if (segments.length === 1) {
      const registry = withTagAliases(
        GANTT_REGISTRY,
        new Set(metaAliasMap.keys())
      );
      const split = splitNameAndMeta(
        label,
        registry,
        metaAliasMap,
        undefined,
        result.diagnostics,
        ln
      );
      if (Object.keys(split.meta).length > 0) {
        label = split.name;
        Object.assign(metadata, split.meta);
      }
    }

    // Extract progress from metadata or shorthand
    let progress: number | null = null;
    if (metadata['progress']) {
      progress = parseFloat(metadata['progress']);
      delete metadata['progress'];
    }
    // Legacy bare-percent (`| 80%`) → emit hard error + extract for back-compat.
    for (const part of segments.slice(1).join(',').split(',')) {
      const seg = part.trim();
      const progressMatch = seg.match(/^(\d+)%$/);
      if (progressMatch) {
        result.diagnostics.push(
          makeDgmoError(
            ln,
            ganttBarePercentRemovedMessage(seg),
            'error',
            METADATA_DIAGNOSTIC_CODES.GANTT_BARE_PERCENT_REMOVED
          )
        );
        progress = parseInt(progressMatch[1]!, 10);
      }
    }

    // Reject lag/lead — use offset instead
    if (metadata['lag'] || metadata['lead']) {
      const key = metadata['lag'] ? 'lag' : 'lead';
      softError(
        ln,
        `"${key}" is no longer supported — use "offset: ${metadata[key]}" instead.${key === 'lead' ? ' Negate the value for lead behavior: "offset: -...".' : ''}`
      );
    }

    // Extract task-level offset from metadata
    let taskOffset: Offset | undefined;
    if (metadata['offset']) {
      const raw = metadata['offset'];
      if (raw.trim().startsWith('+')) {
        warn(
          ln,
          `Invalid offset: "${raw}". Explicit "+" is not supported — use "${raw.trim().slice(1)}" instead.`
        );
      } else {
        taskOffset = parseOffset(raw) ?? undefined;
        if (!taskOffset) {
          warn(
            ln,
            `Invalid offset: "${raw}". Expected format like "3bd", "-5d", or "0bd".`
          );
        }
      }
      delete metadata['offset'];
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
      ...(explicitStart !== undefined && { explicitStart }),
      uncertain,
      progress,
      ...(taskOffset !== undefined && { offset: taskOffset }),
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
    // In-bounds by length === 2 check.
    const start = WEEKDAY_MAP[rangeParts[0]!.trim()];
    const end = WEEKDAY_MAP[rangeParts[1]!.trim()];
    if (start && end) {
      const allDays: Weekday[] = [
        'mon',
        'tue',
        'wed',
        'thu',
        'fri',
        'sat',
        'sun',
      ];
      const startIdx = allDays.indexOf(start);
      const endIdx = allDays.indexOf(end);
      const days: Weekday[] = [];
      let idx = startIdx;
      while (true) {
        // In-bounds: allDays has length 7 and idx stays in [0..6] via % 7.
        days.push(allDays[idx]!);
        if (idx === endIdx) break;
        idx = (idx + 1) % 7;
      }
      return days;
    }
  }

  // Try comma-separated: "mon, tue, wed, thu, fri"
  const parts = s
    .toLowerCase()
    .split(',')
    .map((p) => p.trim());
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
  'start',
  'title',
  'today-marker',
  'critical-path',
  'dependencies',
  'chart',
  'sort',
  'active-tag',
  'sprint-length',
  'sprint-number',
  'sprint-start',
]);

/** Boolean options that can appear as bare keywords or with `no-` prefix. */
const KNOWN_BOOLEANS = new Set([
  'critical-path',
  'today-marker',
  'dependencies',
  'solid-fill',
  'no-title',
]);

function isKnownOption(key: string): boolean {
  return KNOWN_OPTIONS.has(key);
}

/** Check if any task in the tree uses the `s` (sprint) duration unit. */
function hasSprintDurationUnit(nodes: readonly GanttNode[]): boolean {
  for (const node of nodes) {
    if (node.kind === 'task') {
      if (node.duration?.unit === 's') return true;
    } else if (node.kind === 'group' || node.kind === 'parallel') {
      if (hasSprintDurationUnit(node.children)) return true;
    }
  }
  return false;
}
