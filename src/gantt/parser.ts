// ============================================================
// Gantt Chart Parser
// ============================================================

import { formatDgmoError, makeDgmoError } from '../diagnostics';
import {
  GANTT_REGISTRY,
  withTagAliases,
  isReservedKey,
} from '../utils/reserved-key-registry';
import { splitNameAndMeta, warnUnknownMetaKeys } from '../utils/parsing';
import { GANTT_OPTION_SET, GANTT_BOOLEAN_SET } from '../directives-registry';
import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  validateTagGroupNames,
  tagAttrKey,
} from '../utils/tag-groups';
import { measureIndent, extractColor, parseFirstLine } from '../utils/parsing';
import {
  parseOffset,
  parseOffsetPrefix,
  parseDuration,
} from '../utils/duration';
import { normalizeName } from '../utils/name-normalize';
import type { PaletteColors } from '../palettes';
import { getSeriesColors } from '../palettes';
import type {
  ParsedGantt,
  GanttNode,
  GanttTask,
  GanttGroup,
  GanttDependency,
  GanttParallelBlock,
  Duration,
  DurationUnit,
  Offset,
  Weekday,
} from './types';

// ── Regexes ─────────────────────────────────────────────────

/** Group container: `[GroupName]` with optional pipe metadata */
const GROUP_RE = /^\[(.+?)\]\s*(.*)$/;

/** Dependency: `-> TargetName` or `-label-> TargetName` (label captured) */
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

// ── New-syntax regexes (v2: positional duration, arrow graph) ─

/** Offset prefix at line start: `+4w Task...` or `+10bd [Group]` */
const OFFSET_PREFIX_RE = /^\+(\d+(?:\.\d+)?(?:min|bd|d|w|m|q|y|h|s))\s+(.*)/;

/** Duration token (for right-to-left positional scan) */
const DURATION_TOKEN_RE = /^(\d+(?:\.\d+)?)(min|bd|d|w|m|q|y|h|s)(\?)?$/;

/** Arrow with lag: `-3w-> Rest` */
const LAG_ARROW_RE = /^-(\d+(?:\.\d+)?(?:min|bd|d|w|m|q|y|h|s))->\s*(.*)/;

/** Arrow with lead (negative lag): `--2w-> Rest` */
const LEAD_ARROW_RE = /^--(\d+(?:\.\d+)?(?:min|bd|d|w|m|q|y|h|s))->\s*(.*)/;

/** Basic arrow: `-> Rest` */
const BASIC_ARROW_RE = /^->\s*(.*)/;

/** Era with offset: `era +4w -> +8w Label [color]` */
const ERA_OFFSET_RE =
  /^era\s+\+(\d+(?:\.\d+)?(?:min|bd|d|w|m|q|y|h|s))\s*(?:->|–>)\s*\+(\d+(?:\.\d+)?(?:min|bd|d|w|m|q|y|h|s))\s+(.+)$/i;

/** Marker with offset: `marker +10w Label [color]` */
const MARKER_OFFSET_RE =
  /^marker\s+\+(\d+(?:\.\d+)?(?:min|bd|d|w|m|q|y|h|s))\s+(.+)$/i;

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
  taskRef?: Writable<GanttNode & { kind: 'task' }>;
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
    syntaxMode: 'new', // always new-mode at 1.0
  };

  // Bespoke (not the shared makeFail, Story 111.4): gantt accumulates into a
  // local `diagnostics` array, not `result.diagnostics`.
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
    // Walk down from the top of the stack to find the nearest
    // group/parallel container. Skip task entries — tasks don't
    // contain other tasks in the tree (deps are via arrows, not nesting).
    for (let k = blockStack.length - 1; k >= 0; k--) {
      if (blockStack[k]!.containerType !== 'task') {
        return blockStack[k]!.node.children;
      }
    }
    return result.nodes;
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
  // 1.0: parser is always new-mode; legacy scheduling forms were removed.
  const syntaxMode = 'new' as const;
  result.syntaxMode = syntaxMode;
  // const definedTaskNames = new Map<string, string>(); // normalized name → scope key (Phase 6 diagnostics)

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

        warn(
          lineNumber,
          `Unrecognized holiday entry: "${line}". Use a date '2024-02-19 Presidents Day' or a range '2024-05-27 -> 2024-05-29 Memorial Weekend'. (§13.3)`
        );
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
          const eraExtracted = extractColor(
            eraLabelRaw,
            palette,
            diagnostics,
            lineNumber
          );
          result.eras.push({
            startDate: eraEntryMatch[1]!,
            endDate: eraEntryMatch[2]!,
            label: eraExtracted.label,
            color: eraExtracted.color || null,
            lineNumber,
          });
        } else {
          warn(
            lineNumber,
            `Unrecognized era entry: "${line}". Use 'YYYY-MM-DD -> YYYY-MM-DD Label [color]' (e.g. '2026-04-06 -> 2026-04-10 Conference purple'). (§13.5)`
          );
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
          const markerExtracted = extractColor(
            markerLabelRaw,
            palette,
            diagnostics,
            lineNumber
          );
          result.markers.push({
            date: markerEntryMatch[1]!,
            label: markerExtracted.label,
            color: markerExtracted.color || null,
            lineNumber,
          });
        } else {
          warn(
            lineNumber,
            `Unrecognized marker entry: "${line}". Use 'YYYY-MM-DD Label [color]' (e.g. '2026-03-27 Board Review' or '2026-06-15 Release green'). (§13.6)`
          );
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
        const extracted = extractColor(
          cleanEntry,
          palette,
          diagnostics,
          lineNumber
        );
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

    // Track pop depth for sequential vs parallel arrow semantics.
    // Consecutive same-indent arrows = sequential chain.
    // Returning from a deeper subtree = parallel branch from parent.
    {
      let hadDeeperPop = false;
      let lastPoppedTaskRef: typeof lastTaskNode = null;

      while (blockStack.length > 0) {
        const top = blockStack[blockStack.length - 1]!;
        if (indent <= top.indent) {
          if (top.indent > indent) hadDeeperPop = true;
          if (top.containerType === 'task' && top.taskRef) {
            lastPoppedTaskRef = top.taskRef;
          }
          blockStack.pop();
        } else {
          break;
        }
      }

      if (hadDeeperPop) {
        // Came back from deeper subtree → parallel from parent
        for (let k = blockStack.length - 1; k >= 0; k--) {
          if (
            blockStack[k]!.containerType === 'task' &&
            blockStack[k]!.taskRef
          ) {
            lastTaskNode = blockStack[k]!.taskRef!;
            break;
          }
        }
        if (
          blockStack.length === 0 ||
          !blockStack.some((e) => e.containerType === 'task')
        ) {
          lastTaskNode = null;
        }
      } else if (lastPoppedTaskRef) {
        // Same-indent pop only → sequential from popped sibling
        lastTaskNode = lastPoppedTaskRef;
      }
      // If nothing was popped, lastTaskNode stays the same
    }

    // ── NEW-MODE: arrow / task / group / metadata parsing ──

    if (syntaxMode === 'new') {
      // 1. Arrow lines: `->`, `-3w->`, `--2w->`, `-label-> Target`
      const arrowResult = matchArrowLine(line);
      if (arrowResult) {
        // Parse remainder as task content (name + optional duration +
        // metadata).
        const content = parseNewTaskContent(arrowResult.rest, lineNumber);

        if (content.duration || content.explicitStart) {
          // Definition + dependency: create task AND edge
          const task = makeTask(
            content.name,
            content.duration,
            content.uncertain,
            lineNumber,
            content.explicitStart,
            content.preExtracted
          );
          const taskNode: GanttNode = { kind: 'task', ...task };

          // Add dependency ON lastTaskNode pointing TO the new task.
          // Convention: task.dependencies[].targetName = "the task that starts after this task finishes"
          if (lastTaskNode) {
            (lastTaskNode.dependencies as GanttDependency[]).push({
              targetName: content.name,
              ...(arrowResult.label !== undefined && {
                label: arrowResult.label,
              }),
              ...(arrowResult.lag !== undefined && { offset: arrowResult.lag }),
              lineNumber,
            });
          }

          currentContainer().push(taskNode);
          const writableTask = taskNode as Writable<
            GanttNode & { kind: 'task' }
          >;
          lastTaskNode = writableTask;
          blockStack.push({
            node: taskNode as unknown as Writable<GanttGroup>,
            indent,
            containerType: 'task',
            taskRef: writableTask,
          });
        } else {
          // Reference only: dependency edge from lastTaskNode to target.
          // The target body may carry offset metadata in the §1.4
          // (`Target offset: 2bd`) form.
          if (lastTaskNode) {
            const depBody = arrowResult.rest;
            let targetSegment: string;
            let meta: Record<string, string>;
            {
              const depRegistry = withTagAliases(
                GANTT_REGISTRY,
                new Set(metaAliasMap.keys())
              );
              const split = splitNameAndMeta(
                depBody.trim(),
                depRegistry,
                metaAliasMap
              );
              warnUnknownMetaKeys(
                split.meta,
                depRegistry,
                (msg) => warn(lineNumber, msg),
                split.name
              );
              targetSegment = split.name;
              meta = split.meta;
            }
            const targetName = resolveAliasTarget(targetSegment);
            let offset: Offset | undefined = arrowResult.lag;

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

            (lastTaskNode.dependencies as GanttDependency[]).push({
              targetName,
              ...(arrowResult.label !== undefined && {
                label: arrowResult.label,
              }),
              ...(offset !== undefined && { offset }),
              lineNumber,
            });
          } else {
            softError(
              lineNumber,
              `Arrow '-> ${content.name}' has no source task — indent it under the task it follows (e.g. 'Design 5bd' then indented '-> ${content.name} 3bd'). (§13)`
            );
          }
        }
        continue;
      }

      // 2. Scope-based metadata: indented `key: value` under a task
      if (indent > 0 && lastTaskNode) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const candidateKey = line.substring(0, colonIdx).trim().toLowerCase();
          const registry = withTagAliases(
            GANTT_REGISTRY,
            new Set(metaAliasMap.keys())
          );
          const resolvedKey =
            metaAliasMap.get(normalizeName(candidateKey)) ?? candidateKey;
          if (isReservedKey(registry, resolvedKey)) {
            const value = line.substring(colonIdx + 1).trim();
            // Attach to the owning task (walk up block stack)
            const ownerTask =
              findOwningTask(blockStack, indent) ?? lastTaskNode;
            if (ownerTask) {
              const mutableMeta = ownerTask.metadata as Record<string, string>;
              if (resolvedKey === 'progress') {
                const p = parseFloat(value);
                if (!Number.isNaN(p)) {
                  (ownerTask as Writable<GanttTask>).progress = p;
                }
              } else if (resolvedKey === 'offset') {
                const off = parseOffsetPrefix(value) ?? parseOffset(value);
                if (off) (ownerTask as Writable<GanttTask>).offset = off;
              } else {
                mutableMeta[resolvedKey] = value;
              }
            }
            continue;
          }
        }
      }

      // 3. Comment under a task
      if (lastTaskNode && indent > 0 && COMMENT_RE.test(line)) {
        const commentText = line.replace(/^\/\/\s?/, '');
        lastTaskNode.comment = lastTaskNode.comment
          ? lastTaskNode.comment + '\n' + commentText
          : commentText;
        continue;
      }

      // 4. Top-level comment
      if (COMMENT_RE.test(line)) continue;

      // 5. Skip to shared header options (holidays, tags, eras, markers, options)
      // These are handled below in the shared section. Fall through to them.
      // But first check for: era/marker with offsets, offset+group, offset+task, group, positional task

      // 6. Era with offset: `era +4w -> +8w Label [color]`
      const eraOffsetMatch = line.match(ERA_OFFSET_RE);
      if (eraOffsetMatch) {
        const startOff = parseOffsetPrefix('+' + eraOffsetMatch[1]!);
        const endOff = parseOffsetPrefix('+' + eraOffsetMatch[2]!);
        const eraLabelRaw = eraOffsetMatch[3]!.trim();
        const eraExtracted = extractColor(
          eraLabelRaw,
          palette,
          diagnostics,
          lineNumber
        );
        result.eras.push({
          startDate: '',
          endDate: '',
          label: eraExtracted.label,
          color: eraExtracted.color || null,
          lineNumber,
          ...(startOff && { offsetStart: startOff }),
          ...(endOff && { offsetEnd: endOff }),
        });
        continue;
      }

      // 7. Marker with offset: `marker +10w Label [color]`
      const markerOffsetMatch = line.match(MARKER_OFFSET_RE);
      if (markerOffsetMatch) {
        const dateOff = parseOffsetPrefix('+' + markerOffsetMatch[1]!);
        const markerLabelRaw = markerOffsetMatch[2]!.trim();
        const markerExtracted = extractColor(
          markerLabelRaw,
          palette,
          diagnostics,
          lineNumber
        );
        result.markers.push({
          date: '',
          label: markerExtracted.label,
          color: markerExtracted.color || null,
          lineNumber,
          ...(dateOff && { offsetDate: dateOff }),
        });
        continue;
      }

      // Fall through to shared sections (holidays, tags, date-based eras/markers,
      // options). They will continue if matched. If nothing matches, we reach
      // the new-mode task/group section below (after shared options).
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
          tagAttrKey(tagMatch.name)
        );
      }
      metaAliasMap.set(normalizeName(tagMatch.name), tagAttrKey(tagMatch.name));
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
      const eraExtracted = extractColor(
        eraLabelRaw,
        palette,
        diagnostics,
        lineNumber
      );
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
      const markerExtracted = extractColor(
        markerLabelRaw,
        palette,
        diagnostics,
        lineNumber
      );
      result.markers.push({
        date: markerMatch[1]!,
        label: markerExtracted.label,
        color: markerExtracted.color || null,
        lineNumber,
      });
      continue;
    }

    // ── New-syntax task: `Name duration: Xd` or `Name start: DATE` ─
    {
      const registry = withTagAliases(
        GANTT_REGISTRY,
        new Set(metaAliasMap.keys())
      );
      const split = splitNameAndMeta(
        line,
        registry,
        metaAliasMap,
        undefined,
        diagnostics,
        lineNumber
      );
      warnUnknownMetaKeys(
        split.meta,
        registry,
        (msg) => warn(lineNumber, msg),
        split.name
      );
      const rawDur = split.meta['duration'];
      const rawStart = split.meta['start'];

      if (rawDur !== undefined || rawStart !== undefined) {
        let duration: Duration | null = null;
        let uncertain = false;

        if (rawDur !== undefined) {
          const uncertainMatch = rawDur.match(/^(.+)\?$/);
          const durStr = uncertainMatch ? uncertainMatch[1]! : rawDur;
          if (uncertainMatch) uncertain = true;
          duration = parseDuration(durStr);
          if (!duration) {
            softError(
              lineNumber,
              `Invalid duration: "${rawDur}". Expected format like "30bd", "5d", "1.5w".`
            );
            continue;
          }
        }

        let explicitStart: string | undefined;
        if (rawStart !== undefined) {
          if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(rawStart)) {
            softError(
              lineNumber,
              `Invalid start date: "${rawStart}". Expected YYYY-MM-DD or YYYY-MM-DD HH:MM.`
            );
            continue;
          }
          explicitStart = rawStart;
        }

        const taskName = split.name.trim();
        if (!taskName) {
          softError(lineNumber, `Task name cannot be empty.`);
          continue;
        }

        if (split.alias) nameAliasMap.set(split.alias, taskName);

        const preExtracted = { ...split.meta };
        delete preExtracted['duration'];
        delete preExtracted['start'];
        if (split.color) preExtracted['color'] = split.color;

        const task = makeTask(
          taskName,
          duration,
          uncertain,
          lineNumber,
          explicitStart,
          preExtracted
        );
        const taskNode: GanttNode = { kind: 'task', ...task };
        currentContainer().push(taskNode);
        const writableTaskN = taskNode as Writable<
          GanttNode & { kind: 'task' }
        >;
        lastTaskNode = writableTaskN;
        blockStack.push({
          node: taskNode as unknown as Writable<GanttGroup>,
          indent,
          containerType: 'task',
          taskRef: writableTaskN,
        });
        continue;
      }
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

    // ── NEW-MODE: offset prefix + group / positional task ──

    if (syntaxMode === 'new') {
      // Check for offset prefix: `+4w [Group]` or `+4w Task 30bd`
      let restAfterOffset = line;
      let lineOffset: Offset | undefined;
      const offMatch = line.match(OFFSET_PREFIX_RE);
      if (offMatch) {
        lineOffset = parseOffsetPrefix('+' + offMatch[1]!) ?? undefined;
        restAfterOffset = offMatch[2]!;
      }

      // Group: `[GroupName]` with optional offset
      const gm = restAfterOffset.match(GROUP_RE);
      if (gm) {
        if (
          blockStack.length > 0 &&
          blockStack[blockStack.length - 1]!.containerType === 'task'
        ) {
          softError(
            lineNumber,
            `Cannot nest a group inside a task. Groups must be inside other groups.`
          );
          continue;
        }
        const afterBrackets = gm[2]!.trim();
        let metadata: Record<string, string> = {};
        if (afterBrackets) {
          const groupRegistry = withTagAliases(
            GANTT_REGISTRY,
            new Set(metaAliasMap.keys())
          );
          // `afterBrackets` is the same-line metadata tail; run it through
          // splitNameAndMeta with a placeholder name so only the meta region
          // is parsed (§1.4 same-line `key: value`).
          const split = splitNameAndMeta(
            `_ ${afterBrackets}`,
            groupRegistry,
            metaAliasMap,
            undefined,
            result.diagnostics,
            lineNumber
          );
          warnUnknownMetaKeys(
            split.meta,
            groupRegistry,
            (msg) => warn(lineNumber, msg),
            split.name
          );
          metadata = split.meta;
        }
        // `[Group] collapsed: true` view-state marker (§ mirrors sequence): a
        // reserved same-line key that seeds the group collapsed. Extracted into
        // a typed field so it drives render/export; dropped from metadata.
        let collapsed = false;
        if (metadata['collapsed']?.toLowerCase() === 'true') {
          collapsed = true;
          delete metadata['collapsed'];
        }
        const groupPeeled = peelAlias(gm[1]!);
        if (groupPeeled.alias)
          nameAliasMap.set(groupPeeled.alias, groupPeeled.label);
        const group: Writable<GanttGroup> = {
          name: groupPeeled.label,
          color: null,
          metadata,
          ...(lineOffset && { offset: lineOffset }),
          ...(collapsed && { collapsed: true }),
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

      // Positional task: `[+offset] Name Duration [metadata]`
      // Also handles milestones: `Launch 0d`, offset tasks: `+4w Task 30bd`
      {
        const content = parseNewTaskContent(restAfterOffset, lineNumber);
        if (
          content.name &&
          !content.duration &&
          !content.explicitStart &&
          !lineOffset
        ) {
          softError(
            lineNumber,
            `Expected task with duration/start (e.g., "${content.name} 5d"), group brackets (e.g., "[Group]"), or keyword. Got: "${line}"`
          );
          continue;
        }
        if (content.name || content.duration || content.explicitStart) {
          const task = makeTask(
            content.name,
            content.duration,
            content.uncertain,
            lineNumber,
            content.explicitStart,
            content.preExtracted
          );
          if (lineOffset) {
            (task as Writable<GanttTask>).offset = lineOffset;
          }
          const taskNode: GanttNode = { kind: 'task', ...task };
          currentContainer().push(taskNode);
          const writableTask = taskNode as Writable<
            GanttNode & { kind: 'task' }
          >;
          lastTaskNode = writableTask;
          blockStack.push({
            node: taskNode as unknown as Writable<GanttGroup>,
            indent,
            containerType: 'task',
            taskRef: writableTask,
          });
          continue;
        }
      }

      // If nothing matched in new mode, emit error
      softError(
        lineNumber,
        `Expected task (e.g., "Task Name 5d"), arrow (e.g., "-> Task 3w"), group (e.g., "[Group]"), or directive. Got: "${line}"`
      );
      continue;
    }
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

  // ── Helper: match arrow line (new syntax) ──────────────

  interface ArrowMatch {
    rest: string;
    lag?: Offset | undefined;
    label?: string | undefined;
  }

  function matchArrowLine(trimmedLine: string): ArrowMatch | null {
    // Lead arrow: `--2w-> Rest` (negative lag)
    const leadMatch = trimmedLine.match(LEAD_ARROW_RE);
    if (leadMatch) {
      const dur = parseDuration(leadMatch[1]!);
      const match: ArrowMatch = { rest: leadMatch[2]! };
      if (dur) match.lag = { duration: dur, direction: -1 };
      return match;
    }
    // Lag arrow: `-3w-> Rest` (positive lag)
    const lagMatch = trimmedLine.match(LAG_ARROW_RE);
    if (lagMatch) {
      const dur = parseDuration(lagMatch[1]!);
      const match: ArrowMatch = { rest: lagMatch[2]! };
      if (dur) match.lag = { duration: dur, direction: 1 };
      return match;
    }
    // Basic arrow: `-> Rest`
    const basicMatch = trimmedLine.match(BASIC_ARROW_RE);
    if (basicMatch) {
      return { rest: basicMatch[1]! };
    }
    // Labeled arrow: `-blocks-> Rest` / `-depends on-> Rest`.
    // The label is any text between the leading `-` and `->` that is
    // NOT a pure lag/lead duration (those are handled above).
    const labeledMatch = trimmedLine.match(DEPENDENCY_RE);
    if (labeledMatch?.[1]) {
      return { rest: labeledMatch[2]!, label: labeledMatch[1].trim() };
    }
    return null;
  }

  // ── Helper: parse new task content (positional duration) ─

  interface NewTaskContent {
    name: string;
    duration: Duration | null;
    uncertain: boolean;
    explicitStart?: string | undefined;
    preExtracted: Record<string, string>;
  }

  function parseNewTaskContent(rawContent: string, ln: number): NewTaskContent {
    const registry = withTagAliases(
      GANTT_REGISTRY,
      new Set(metaAliasMap.keys())
    );
    const split = splitNameAndMeta(
      rawContent,
      registry,
      metaAliasMap,
      undefined,
      diagnostics,
      ln
    );
    warnUnknownMetaKeys(
      split.meta,
      registry,
      (msg) => warn(ln, msg),
      split.name
    );

    let name = split.name;
    let duration: Duration | null = null;
    let uncertain = false;
    let explicitStart: string | undefined;
    const metadata = { ...split.meta };

    // Check for explicit `duration:` key (fallback for ambiguous names)
    if (metadata['duration']) {
      const durStr = metadata['duration'];
      const uncertainMatch = durStr.match(/^(.+)\?$/);
      const cleanDur = uncertainMatch ? uncertainMatch[1]! : durStr;
      if (uncertainMatch) uncertain = true;
      duration = parseDuration(cleanDur);
      if (!duration) {
        softError(
          ln,
          `Invalid duration: "${durStr}". Expected format like "30bd", "5d", "1.5w".`
        );
      }
      delete metadata['duration'];
    }

    // Check for explicit `start:` key
    if (metadata['start']) {
      const raw = metadata['start'];
      if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(raw)) {
        softError(ln, `Invalid start date: "${raw}". Expected YYYY-MM-DD.`);
      } else {
        explicitStart = raw;
      }
      delete metadata['start'];
    }

    // Right-to-left scan for positional duration (only if no explicit keys)
    if (!duration && !explicitStart) {
      const tokens = name.split(/\s+/).filter(Boolean);
      for (let j = tokens.length - 1; j >= 0; j--) {
        const m = tokens[j]!.match(DURATION_TOKEN_RE);
        if (m) {
          duration = { amount: parseFloat(m[1]!), unit: m[2]! as DurationUnit };
          uncertain = !!m[3];
          name = tokens.slice(0, j).join(' ');
          break;
        }
      }
    }

    // Build pre-extracted metadata (color, remaining keys)
    const preExtracted = { ...metadata };
    if (split.color) preExtracted['color'] = split.color;

    return {
      name: name.trim(),
      duration,
      uncertain,
      explicitStart,
      preExtracted,
    };
  }

  // ── Helper: find owning task for scope-based metadata ───

  function findOwningTask(
    stack: BlockEntry[],
    metaIndent: number
  ): Writable<GanttNode & { kind: 'task' }> | null {
    for (let k = stack.length - 1; k >= 0; k--) {
      const entry = stack[k]!;
      if (
        entry.containerType === 'task' &&
        entry.taskRef &&
        entry.indent < metaIndent
      ) {
        return entry.taskRef;
      }
    }
    return null;
  }

  // ── Helper: create a task ───────────────────────────────

  function makeTask(
    labelRaw: string,
    duration: Duration | null,
    uncertain: boolean,
    ln: number,
    explicitStart?: string,
    preExtractedMeta?: Record<string, string>
  ): GanttTask {
    // TD-18: peel optional `as <alias>` from the label.
    const peeled = peelAlias(labelRaw);
    let label = peeled.label;
    if (peeled.alias) nameAliasMap.set(peeled.alias, label);

    // Check for reserved keyword
    if (label.toLowerCase() === 'parallel') {
      softError(
        ln,
        `"parallel" is a reserved keyword and cannot be used as a task name.`
      );
    }

    const metadata: Record<string, string> = {};

    // §1.4 unified metadata grammar — pick up the same-line form
    // (`Name key: value`) by running splitNameAndMeta on the label.
    {
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
      warnUnknownMetaKeys(
        split.meta,
        registry,
        (msg) => warn(ln, msg),
        split.name
      );
      if (Object.keys(split.meta).length > 0) {
        label = split.name;
        Object.assign(metadata, split.meta);
      }
    }

    if (preExtractedMeta) {
      Object.assign(metadata, preExtractedMeta);
    }

    // Extract progress from metadata or shorthand
    let progress: number | null = null;
    if (metadata['progress']) {
      progress = parseFloat(metadata['progress']);
      delete metadata['progress'];
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
      isDefinition: duration !== null || explicitStart !== undefined,
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

// Derived from the single-source directives registry; the anti-drift guard
// (tests/highlight-coverage.test.ts) cross-checks this vocab against the
// editor keyword sets. Re-exported under the historical names for callers.
export const GANTT_KNOWN_OPTIONS = GANTT_OPTION_SET;
const KNOWN_OPTIONS = GANTT_KNOWN_OPTIONS;

/** Boolean options that can appear as bare keywords or with `no-` prefix. */
export const GANTT_KNOWN_BOOLEANS = GANTT_BOOLEAN_SET;
const KNOWN_BOOLEANS = GANTT_KNOWN_BOOLEANS;

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
