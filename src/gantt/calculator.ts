// ============================================================
// Gantt Schedule Calculator
// ============================================================
//
// Takes a ParsedGantt and resolves all tasks to concrete start/end dates.
// Algorithm:
// 1. Flatten task tree, build dependency graph
// 2. Topological sort with cycle detection
// 3. Forward pass: resolve dates using universal max rule
// 4. (Optional) Critical path: backward pass to find zero-slack chain

import { makeDgmoError, formatDgmoError } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type {
  ParsedGantt,
  GanttNode,
  GanttTask,
  GanttGroup,
  GanttHolidays,
  GanttOptions,
  Duration,
  ResolvedSchedule,
  ResolvedSprint,
  ResolvedGroup,
  Offset,
} from './types';
import { collectTasks, resolveTaskName, isResolverError } from './resolver';
import {
  addGanttDuration,
  buildHolidaySet,
  parseGanttDate,
} from '../utils/duration';

// ── Internal types ──────────────────────────────────────────

interface TaskNode {
  task: GanttTask;
  /** IDs of tasks this task depends on (both implicit and explicit) */
  predecessors: string[];
  /** Resolved start/end dates (filled during forward pass) */
  startDate: Date | null;
  endDate: Date | null;
}

// ── Main calculator ─────────────────────────────────────────

export function calculateSchedule(parsed: ParsedGantt): ResolvedSchedule {
  const diagnostics: DgmoError[] = [...parsed.diagnostics];
  const result: ResolvedSchedule = {
    tasks: [],
    groups: [],
    startDate: new Date(),
    endDate: new Date(),
    holidays: parsed.holidays,
    tagGroups: parsed.tagGroups,
    eras: parsed.eras,
    markers: parsed.markers,
    sprints: [],
    options: parsed.options,
    diagnostics,
    error: parsed.error,
  };

  if (parsed.error) return result;

  const warn = (line: number, message: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _fail = (line: number, message: string): ResolvedSchedule => {
    const diag = makeDgmoError(line, message);
    diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  // ── Build holiday set ───────────────────────────────────

  const holidaySet = buildHolidaySet(parsed.holidays);

  // ── Determine project start ─────────────────────────────

  let projectStart: Date;
  if (parsed.options.start) {
    projectStart = parseGanttDate(parsed.options.start);
  } else {
    // Relative timeline: use epoch-like reference (Day 1 = Jan 1, 2000)
    projectStart = new Date(2000, 0, 1);
  }

  // ── Sprint config ──────────────────────────────────────

  const sprintOpts = parsed.options.sprintLength
    ? { sprintLength: parsed.options.sprintLength }
    : undefined;

  // ── Dep offset storage ─────────────────────────────────

  const depOffsetMap = new Map<string, Offset>();

  // ── Collect all tasks ───────────────────────────────────

  const allTasks = collectTasks(parsed.nodes);
  if (allTasks.length === 0) {
    return result; // empty chart is valid
  }

  // Build task map by ID
  const taskMap = new Map<string, TaskNode>();
  for (const task of allTasks) {
    taskMap.set(task.id, {
      task,
      predecessors: [],
      startDate: null,
      endDate: null,
    });
  }

  // ── Build implicit sequential dependencies ──────────────

  buildImplicitDeps(parsed.nodes, taskMap);

  // ── Resolve explicit -> dependencies ────────────────────

  for (const task of allTasks) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _node = taskMap.get(task.id)!;
    for (const dep of task.dependencies) {
      const resolved = resolveTaskName(dep.targetName, allTasks);
      if (isResolverError(resolved)) {
        warn(dep.lineNumber, `\`-> ${dep.targetName}\` — ${resolved.message}`);
        continue;
      }

      // The dependency means: target starts after source
      // In our model: target's predecessor is source
      const targetNode = taskMap.get(resolved.task.id);
      if (targetNode) {
        // Check for redundant dependency (already a sequential predecessor)
        if (targetNode.predecessors.includes(task.id)) {
          warn(
            dep.lineNumber,
            `Redundant dependency: "${dep.targetName}" already follows "${task.label}" sequentially. Did you mean to wrap groups in \`parallel\`?`
          );
        } else {
          targetNode.predecessors.push(task.id);
          // Store dep offset info — we need it during scheduling
          if (dep.offset) {
            depOffsetMap.set(`${task.id}->${resolved.task.id}`, dep.offset);
          }
        }
      }
    }
  }

  // ── Topological sort with cycle detection ───────────────

  let sortedIds = topologicalSort(taskMap);
  if (!sortedIds) {
    // Find cycle, warn, and break it by removing one explicit dep edge
    const cycle = findCycle(taskMap);
    const cycleStr = cycle.map((id) => taskMap.get(id)!.task.label).join(' → ');
    warn(
      taskMap.get(cycle[0])!.task.lineNumber,
      `Circular dependency detected: ${cycleStr}. The cycle-creating dependency was dropped.`
    );

    // Remove the last edge in the cycle to break it
    // (prefer removing explicit -> deps over implicit sequential ones)
    breakCycle(cycle, taskMap, depOffsetMap);

    // Retry — if still cyclic after breaking, keep breaking until resolved
    sortedIds = topologicalSort(taskMap);
    let safety = 10;
    while (!sortedIds && safety-- > 0) {
      const nextCycle = findCycle(taskMap);
      if (nextCycle.length === 0) break;
      breakCycle(nextCycle, taskMap, depOffsetMap);
      sortedIds = topologicalSort(taskMap);
    }

    if (!sortedIds) {
      // Truly unresolvable — fall back to task insertion order
      sortedIds = [...taskMap.keys()];
    }
  }

  // ── Forward pass: resolve dates ─────────────────────────

  for (const taskId of sortedIds) {
    const node = taskMap.get(taskId)!;
    const task = node.task;

    // Determine start date: max of all predecessors' end dates (+ dep offset)
    let start: Date;

    if (task.explicitStart) {
      // Explicit date anchor
      start = parseGanttDate(task.explicitStart);
    } else if (node.predecessors.length === 0) {
      // No predecessors: starts at project start
      start = new Date(projectStart);
    } else {
      // Universal max rule: start = max(all predecessor end dates + dep offset)
      start = new Date(0); // epoch
      for (const predId of node.predecessors) {
        const predNode = taskMap.get(predId)!;
        if (!predNode.endDate) continue; // shouldn't happen after topo sort

        let predEnd = new Date(predNode.endDate);

        // Apply dep offset if present
        const depOffset = depOffsetMap.get(`${predId}->${taskId}`);
        if (depOffset) {
          predEnd = addGanttDuration(
            predEnd,
            depOffset.duration,
            parsed.holidays,
            holidaySet,
            depOffset.direction,
            sprintOpts
          );
        }

        if (predEnd.getTime() > start.getTime()) {
          start = predEnd;
        }
      }
    }

    // Apply task-level offset (shifts start forward or backward)
    if (task.offset) {
      start = addGanttDuration(
        start,
        task.offset.duration,
        parsed.holidays,
        holidaySet,
        task.offset.direction,
        sprintOpts
      );
      if (start.getTime() < projectStart.getTime()) {
        warn(
          task.lineNumber,
          `Negative offset on task '${task.label}' exceeds available range; start clamped to project start.`
        );
        start = new Date(projectStart);
      }
    } else if (start.getTime() < projectStart.getTime()) {
      warn(
        task.lineNumber,
        `Negative offset on dependency exceeds available range; start of '${task.label}' clamped to project start.`
      );
      start = new Date(projectStart);
    }

    // If explicit start (+ offset) conflicts with predecessors, warn but honor explicit
    if (task.explicitStart && node.predecessors.length > 0) {
      let maxPredEnd = new Date(0);
      for (const predId of node.predecessors) {
        const predNode = taskMap.get(predId)!;
        if (
          predNode.endDate &&
          predNode.endDate.getTime() > maxPredEnd.getTime()
        ) {
          maxPredEnd = predNode.endDate;
        }
      }
      if (start.getTime() < maxPredEnd.getTime()) {
        warn(
          task.lineNumber,
          `Explicit date ${task.explicitStart}${task.offset ? ' (with offset)' : ''} overlaps with predecessor ending ${formatDate(maxPredEnd)}. Using explicit date.`
        );
      }
    }

    // Calculate end date
    let end: Date;
    if (task.duration) {
      if (task.duration.amount === 0) {
        // Milestone: zero duration, end = start
        end = new Date(start);
      } else {
        end = addGanttDuration(
          start,
          task.duration,
          parsed.holidays,
          holidaySet,
          1,
          sprintOpts
        );
      }
    } else {
      // Explicit date task with no duration = milestone at that date
      end = new Date(start);
    }

    node.startDate = start;
    node.endDate = end;
  }

  // ── Build resolved tasks ────────────────────────────────

  // Critical path calculation (if enabled)
  const criticalSet = parsed.options.criticalPath
    ? computeCriticalPath(
        sortedIds,
        taskMap,
        depOffsetMap,
        parsed.holidays,
        holidaySet,
        sprintOpts
      )
    : new Set<string>();

  // Cascading uncertainty: uncertain if task itself is uncertain OR any predecessor is
  const uncertainSet = new Set<string>();
  for (const taskId of sortedIds) {
    const node = taskMap.get(taskId)!;
    if (node.task.uncertain) {
      uncertainSet.add(taskId);
    } else {
      for (const predId of node.predecessors) {
        if (uncertainSet.has(predId)) {
          uncertainSet.add(taskId);
          break;
        }
      }
    }
  }

  for (const taskId of sortedIds) {
    const node = taskMap.get(taskId)!;
    result.tasks.push({
      task: node.task,
      startDate: node.startDate!,
      endDate: node.endDate!,
      isCriticalPath: criticalSet.has(taskId),
      isUncertain: uncertainSet.has(taskId),
      isMilestone:
        node.task.duration?.amount === 0 ||
        (!node.task.duration && !node.task.explicitStart),
      groupPath: node.task.groupPath,
      effectiveMetadata: node.task.metadata,
    });
  }

  // ── Build resolved groups ───────────────────────────────

  buildResolvedGroups(parsed.nodes, taskMap, result.groups, 0);

  // ── Compute overall date range ──────────────────────────

  if (result.tasks.length > 0) {
    let minDate = result.tasks[0].startDate;
    let maxDate = result.tasks[0].endDate;
    for (const t of result.tasks) {
      if (t.startDate.getTime() < minDate.getTime()) minDate = t.startDate;
      if (t.endDate.getTime() > maxDate.getTime()) maxDate = t.endDate;
    }
    result.startDate = minDate;
    result.endDate = maxDate;
  }

  // ── Generate sprint bands ──────────────────────────────

  if (
    parsed.options.sprintMode &&
    parsed.options.sprintLength &&
    result.tasks.length > 0
  ) {
    result.sprints = generateSprintBands(
      parsed.options,
      result.startDate,
      result.endDate,
      projectStart
    );

    // Extend chart range to include the last sprint's end so it doesn't clip
    if (result.sprints.length > 0) {
      const lastSprintEnd = result.sprints[result.sprints.length - 1].endDate;
      if (lastSprintEnd.getTime() > result.endDate.getTime()) {
        result.endDate = lastSprintEnd;
      }
    }
  }

  // ── Warnings ────────────────────────────────────────────

  // Missing parallel warning: 2+ top-level groups without parallel wrapper
  const topLevelGroups = parsed.nodes.filter((n) => n.kind === 'group');
  if (topLevelGroups.length >= 2) {
    const names = topLevelGroups.map(
      (g) => (g as GanttGroup & { kind: 'group' }).name
    );
    warn(
      topLevelGroups[0].lineNumber,
      `${names.join(' and ')} are sequential. Wrap in \`parallel\` if they should run concurrently.`
    );
  }

  return result;
}

// ── Implicit dependency builder ─────────────────────────────

/**
 * Walk the gantt tree and create implicit sequential dependencies.
 * - Siblings are sequential (each task depends on the previous sibling)
 * - Parallel block children all share the parent's predecessor
 * - Groups: children are sequential within the group
 */
function buildImplicitDeps(
  nodes: GanttNode[],
  taskMap: Map<string, TaskNode>
): void {
  walkChildren(nodes, null);

  function walkChildren(children: GanttNode[], afterTaskId: string | null) {
    let prevTaskId = afterTaskId;

    for (const node of children) {
      if (node.kind === 'task') {
        if (prevTaskId) {
          const taskNode = taskMap.get(node.id);
          if (taskNode && !taskNode.predecessors.includes(prevTaskId)) {
            taskNode.predecessors.push(prevTaskId);
          }
        }
        prevTaskId = node.id;
      } else if (node.kind === 'group') {
        // Walk group children sequentially, starting after prevTaskId
        const lastId = walkSequential(node.children, prevTaskId);
        if (lastId) prevTaskId = lastId;
      } else if (node.kind === 'parallel') {
        // All parallel children start after prevTaskId
        // The parallel block "ends" when all children end
        // We need to find the last task in each branch
        const branchLastIds: string[] = [];
        for (const child of node.children) {
          if (child.kind === 'task') {
            if (prevTaskId) {
              const taskNode = taskMap.get(child.id);
              if (taskNode && !taskNode.predecessors.includes(prevTaskId)) {
                taskNode.predecessors.push(prevTaskId);
              }
            }
            branchLastIds.push(child.id);
          } else if (child.kind === 'group') {
            // First task in group depends on prevTaskId
            const firstId = findFirstTask(child.children);
            if (firstId && prevTaskId) {
              const taskNode = taskMap.get(firstId);
              if (taskNode && !taskNode.predecessors.includes(prevTaskId)) {
                taskNode.predecessors.push(prevTaskId);
              }
            }
            // Walk sequentially within the group
            walkSequential(child.children, null); // internal deps only
            const lastId = findLastTask(child.children);
            if (lastId) branchLastIds.push(lastId);
          } else if (child.kind === 'parallel') {
            // Nested parallel — recurse
            walkChildren([child], prevTaskId);
            const lastId = findLastTask(child.children);
            if (lastId) branchLastIds.push(lastId);
          }
        }
        // After parallel, next sibling depends on ALL branch ends
        if (branchLastIds.length > 0) {
          prevTaskId = null;
          const nextIdx = children.indexOf(node) + 1;
          if (nextIdx < children.length) {
            const nextFirstId = findFirstTask([children[nextIdx]]);
            if (nextFirstId) {
              const nextNode = taskMap.get(nextFirstId);
              if (nextNode) {
                for (const branchId of branchLastIds) {
                  if (!nextNode.predecessors.includes(branchId)) {
                    nextNode.predecessors.push(branchId);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  function walkSequential(
    children: GanttNode[],
    afterTaskId: string | null
  ): string | null {
    let prevTaskId = afterTaskId;
    for (const node of children) {
      if (node.kind === 'task') {
        if (prevTaskId) {
          const taskNode = taskMap.get(node.id);
          if (taskNode && !taskNode.predecessors.includes(prevTaskId)) {
            taskNode.predecessors.push(prevTaskId);
          }
        }
        prevTaskId = node.id;
      } else if (node.kind === 'group') {
        const lastId = walkSequential(node.children, prevTaskId);
        if (lastId) prevTaskId = lastId;
      } else if (node.kind === 'parallel') {
        walkChildren([node], prevTaskId);
        const lastId = findLastTask(node.children);
        if (lastId) prevTaskId = lastId;
      }
    }
    return prevTaskId;
  }
}

/** Find the first task ID in a tree (depth-first). */
function findFirstTask(nodes: GanttNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === 'task') return node.id;
    if (node.kind === 'group' || node.kind === 'parallel') {
      const found = findFirstTask(node.children);
      if (found) return found;
    }
  }
  return null;
}

/** Find the last task ID in a tree (depth-first, last branch). */
function findLastTask(nodes: GanttNode[]): string | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.kind === 'task') return node.id;
    if (node.kind === 'group' || node.kind === 'parallel') {
      const found = findLastTask(node.children);
      if (found) return found;
    }
  }
  return null;
}

// ── Topological sort ────────────────────────────────────────

function topologicalSort(taskMap: Map<string, TaskNode>): string[] | null {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const [id, node] of taskMap) {
    inDegree.set(id, node.predecessors.length);
    for (const pred of node.predecessors) {
      const adj = adjacency.get(pred) ?? [];
      adj.push(id);
      adjacency.set(pred, adj);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const succ of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDegree);
      if (newDegree === 0) queue.push(succ);
    }
  }

  return sorted.length === taskMap.size ? sorted : null;
}

function findCycle(taskMap: Map<string, TaskNode>): string[] {
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const parent = new Map<string, string>();

  for (const id of taskMap.keys()) {
    if (!visited.has(id)) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
  }
  return [];

  function dfs(id: string): string[] | null {
    visited.add(id);
    onStack.add(id);

    const successors: string[] = [];
    for (const [otherId, otherNode] of taskMap) {
      if (otherNode.predecessors.includes(id)) {
        successors.push(otherId);
      }
    }

    for (const succ of successors) {
      if (!visited.has(succ)) {
        parent.set(succ, id);
        const cycle = dfs(succ);
        if (cycle) return cycle;
      } else if (onStack.has(succ)) {
        const cycle = [succ];
        let current = id;
        while (current !== succ) {
          cycle.push(current);
          current = parent.get(current)!;
        }
        cycle.push(succ);
        return cycle.reverse();
      }
    }

    onStack.delete(id);
    return null;
  }
}

/**
 * Break a cycle by removing the last edge. The cycle array is [A, B, ..., A]
 * (starts and ends with the same node). We remove A's predecessor edge to
 * the penultimate node, which breaks the cycle.
 */
function breakCycle(
  cycle: string[],
  taskMap: Map<string, TaskNode>,
  depOffsetMap: Map<string, Offset>
): void {
  if (cycle.length < 3) return; // need at least [A, B, A]
  // Remove the edge from second-to-last → first (i.e. the edge that closes the cycle)
  const fromId = cycle[cycle.length - 2];
  const toId = cycle[0];
  const toNode = taskMap.get(toId);
  if (toNode) {
    const idx = toNode.predecessors.indexOf(fromId);
    if (idx !== -1) {
      toNode.predecessors.splice(idx, 1);
      depOffsetMap.delete(`${fromId}->${toId}`);
    }
  }
}

// ── Critical path ───────────────────────────────────────────

function computeCriticalPath(
  sortedIds: string[],
  taskMap: Map<string, TaskNode>,
  depOffsetMap: Map<string, Offset>,
  holidays: GanttHolidays,
  holidaySet: Set<string>,
  sprintOpts?: { sprintLength?: Duration }
): Set<string> {
  if (sortedIds.length === 0) return new Set();

  const latestEnd = new Map<string, number>();
  const latestStart = new Map<string, number>();

  let projectEnd = 0;
  for (const id of sortedIds) {
    const node = taskMap.get(id)!;
    if (node.endDate && node.endDate.getTime() > projectEnd) {
      projectEnd = node.endDate.getTime();
    }
  }

  const successors = new Map<string, string[]>();
  for (const [id, node] of taskMap) {
    for (const pred of node.predecessors) {
      const succs = successors.get(pred) ?? [];
      succs.push(id);
      successors.set(pred, succs);
    }
  }

  // Backward pass (reverse order)
  for (let i = sortedIds.length - 1; i >= 0; i--) {
    const id = sortedIds[i];
    const node = taskMap.get(id)!;
    const succs = successors.get(id) ?? [];

    if (succs.length === 0) {
      latestEnd.set(id, projectEnd);
    } else {
      let minVal = Infinity;
      for (const succId of succs) {
        let succLS = latestStart.get(succId);
        if (succLS === undefined) continue;

        // Reverse successor's task-level offset
        const succTask = taskMap.get(succId)!.task;
        if (succTask.offset) {
          const reverseDir = (succTask.offset.direction * -1) as 1 | -1;
          const adjusted = addGanttDuration(
            new Date(succLS),
            succTask.offset.duration,
            holidays,
            holidaySet,
            reverseDir,
            sprintOpts
          );
          succLS = adjusted.getTime();
        }

        // Reverse dep offset
        const depOffset = depOffsetMap.get(`${id}->${succId}`);
        if (depOffset) {
          const reverseDir = (depOffset.direction * -1) as 1 | -1;
          const adjusted = addGanttDuration(
            new Date(succLS),
            depOffset.duration,
            holidays,
            holidaySet,
            reverseDir,
            sprintOpts
          );
          succLS = adjusted.getTime();
        }

        if (succLS < minVal) {
          minVal = succLS;
        }
      }
      latestEnd.set(id, minVal);
    }

    const duration = node.endDate!.getTime() - node.startDate!.getTime();
    latestStart.set(id, latestEnd.get(id)! - duration);
  }

  const critical = new Set<string>();
  for (const id of sortedIds) {
    const node = taskMap.get(id)!;
    const slack = (latestStart.get(id) ?? 0) - node.startDate!.getTime();
    if (Math.abs(slack) < 86400000) {
      critical.add(id);
    }
  }

  return critical;
}

// ── Resolved groups builder ─────────────────────────────────

function buildResolvedGroups(
  nodes: GanttNode[],
  taskMap: Map<string, TaskNode>,
  groups: ResolvedGroup[],
  depth: number
): void {
  for (const node of nodes) {
    if (node.kind === 'group') {
      const childTasks = collectTasks(node.children);
      if (childTasks.length === 0) {
        groups.push({
          name: node.name,
          color: node.color,
          metadata: node.metadata,
          startDate: new Date(),
          endDate: new Date(),
          progress: null,
          lineNumber: node.lineNumber,
          depth,
        });
        continue;
      }

      let minStart = Infinity;
      let maxEnd = -Infinity;
      let totalProgress = 0;
      let totalDuration = 0;
      let hasProgress = false;

      for (const task of childTasks) {
        const resolved = taskMap.get(task.id);
        if (!resolved?.startDate || !resolved?.endDate) continue;
        if (resolved.startDate.getTime() < minStart)
          minStart = resolved.startDate.getTime();
        if (resolved.endDate.getTime() > maxEnd)
          maxEnd = resolved.endDate.getTime();
        const dur = resolved.endDate.getTime() - resolved.startDate.getTime();
        totalDuration += dur;
        if (task.progress !== null) {
          totalProgress += task.progress * dur;
          hasProgress = true;
        }
      }

      groups.push({
        name: node.name,
        color: node.color,
        metadata: node.metadata,
        startDate: new Date(minStart === Infinity ? 0 : minStart),
        endDate: new Date(maxEnd === -Infinity ? 0 : maxEnd),
        progress:
          hasProgress && totalDuration > 0
            ? totalProgress / totalDuration
            : null,
        lineNumber: node.lineNumber,
        depth,
      });

      buildResolvedGroups(node.children, taskMap, groups, depth + 1);
    } else if (node.kind === 'parallel') {
      buildResolvedGroups(node.children, taskMap, groups, depth);
    }
  }
}

// ── Sprint band generation ──────────────────────────────────

function generateSprintBands(
  options: GanttOptions,
  chartStart: Date,
  chartEnd: Date,
  projectStart: Date
): ResolvedSprint[] {
  const sprintLength = options.sprintLength!;
  const sprintNumber = options.sprintNumber ?? 1;

  // Determine anchor date: sprint-start or chart start or today
  let anchorDate: Date;
  if (options.sprintStart) {
    anchorDate = new Date(options.sprintStart + 'T00:00:00');
  } else if (options.start) {
    anchorDate = new Date(projectStart);
  } else {
    const now = new Date();
    anchorDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  anchorDate.setHours(0, 0, 0, 0);

  // Sprint length in whole days (parser ensures only d/w with integer day result)
  const sprintDays = Math.round(
    sprintLength.amount * (sprintLength.unit === 'w' ? 7 : 1)
  );
  if (sprintDays <= 0) return []; // defensive guard

  // Bail if anchor date is invalid (e.g. sprint-start 2026-13-45)
  if (Number.isNaN(anchorDate.getTime())) return [];

  // Calculate which sprint chartStart falls in, relative to the anchor
  const chartStartTime = new Date(chartStart);
  chartStartTime.setHours(0, 0, 0, 0);
  const chartEndTime = new Date(chartEnd);
  chartEndTime.setHours(0, 0, 0, 0);

  const msPerDay = 86400000;
  const dayDiff = Math.floor(
    (chartStartTime.getTime() - anchorDate.getTime()) / msPerDay
  );
  // Floor division: which sprint index (from anchor) does chartStart fall in?
  const startSprintIndex = Math.floor(dayDiff / sprintDays);

  const sprints: ResolvedSprint[] = [];
  const maxSprints = 1000; // safety guard against infinite loops

  // Generate sprints that overlap with [chartStart, chartEnd]
  // Sprint at index i (relative to anchor) has number: sprintNumber + i
  for (let i = startSprintIndex; sprints.length < maxSprints; i++) {
    const sprintStartDate = new Date(anchorDate);
    sprintStartDate.setDate(sprintStartDate.getDate() + i * sprintDays);
    sprintStartDate.setHours(0, 0, 0, 0);

    const sprintEndDate = new Date(sprintStartDate);
    sprintEndDate.setDate(sprintEndDate.getDate() + sprintDays);
    sprintEndDate.setHours(0, 0, 0, 0);

    // Stop when sprint start is past chart end
    if (sprintStartDate.getTime() >= chartEndTime.getTime() + msPerDay) break;

    sprints.push({
      number: sprintNumber + i,
      startDate: sprintStartDate,
      endDate: sprintEndDate,
    });
  }

  return sprints;
}

// ── Utility ─────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
