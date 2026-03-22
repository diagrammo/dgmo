// ============================================================
// Gantt Dot-Notation Task Resolver
// ============================================================
//
// Resolves `-> TargetName` dependency references to actual tasks.
// Implements greedy right-to-left dot splitting for disambiguation.

import type { GanttTask, GanttNode } from './types';

export interface ResolverMatch {
  task: GanttTask;
}

export interface ResolverError {
  kind: 'not_found' | 'ambiguous';
  message: string;
}

export type ResolverResult = ResolverMatch | ResolverError;

export function isResolverError(r: ResolverResult): r is ResolverError {
  return 'kind' in r;
}

/**
 * Collect all tasks from a tree of GanttNodes, annotating each with its
 * fully qualified group path (e.g., ["Backend", "API"]).
 */
export function collectTasks(nodes: GanttNode[]): GanttTask[] {
  const tasks: GanttTask[] = [];
  function walk(children: GanttNode[]) {
    for (const node of children) {
      if (node.kind === 'task') {
        tasks.push(node);
      } else if (node.kind === 'group' || node.kind === 'parallel') {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return tasks;
}

/**
 * Resolve a dependency target name to a task.
 *
 * Resolution strategy (greedy right-to-left):
 * 1. Try the full string as an exact task label match
 * 2. If no match, split at the last dot → group prefix + task label
 * 3. Recurse for deeper paths
 *
 * Returns a match or an error with helpful suggestions.
 */
export function resolveTaskName(
  name: string,
  allTasks: GanttTask[],
): ResolverResult {
  const trimmed = name.trim();

  // 1. Try exact label match (no dots involved)
  const exactMatches = allTasks.filter(t => t.label === trimmed);
  if (exactMatches.length === 1) {
    return { task: exactMatches[0] };
  }
  if (exactMatches.length > 1) {
    // Multiple tasks with same name — need disambiguation
    const suggestions = exactMatches.map(t =>
      t.groupPath.length > 0 ? `${t.groupPath.join('.')}.${t.label}` : t.label
    );
    return {
      kind: 'ambiguous',
      message: `Multiple tasks match "${trimmed}". Did you mean ${suggestions.map(s => `\`${s}\``).join(' or ')}?`,
    };
  }

  // 2. Try dot-notation: split at last dot (greedy right-to-left)
  const lastDotIdx = trimmed.lastIndexOf('.');
  if (lastDotIdx > 0) {
    const groupPrefix = trimmed.substring(0, lastDotIdx);
    const taskLabel = trimmed.substring(lastDotIdx + 1);

    // Find tasks whose label matches and whose group path ends with the prefix
    const matches = allTasks.filter(t => {
      if (t.label !== taskLabel) return false;
      return matchesGroupPath(t.groupPath, groupPrefix);
    });

    if (matches.length === 1) {
      return { task: matches[0] };
    }
    if (matches.length > 1) {
      const suggestions = matches.map(t =>
        t.groupPath.length > 0 ? `${t.groupPath.join('.')}.${t.label}` : t.label
      );
      return {
        kind: 'ambiguous',
        message: `Multiple tasks match "${trimmed}". Did you mean ${suggestions.map(s => `\`${s}\``).join(' or ')}?`,
      };
    }

    // Try further left splits (for dots in group names)
    // e.g., "U.S. Operations.Task A" — last dot split tried "U.S. Operations" + "Task A"
    // Now try "U.S." + "Operations.Task A" — but that doesn't help.
    // The greedy approach handles this: "U.S. Operations" is the group name.
    // If the group name itself contains dots, the last dot split already tried the correct split.
  }

  // 3. No match found — try case-insensitive as a fallback for suggestions
  const caseInsensitive = allTasks.filter(t =>
    t.label.toLowerCase() === trimmed.toLowerCase()
  );
  if (caseInsensitive.length > 0) {
    return {
      kind: 'not_found',
      message: `No task found with name "${trimmed}". Did you mean "${caseInsensitive[0].label}" (case mismatch)?`,
    };
  }

  return {
    kind: 'not_found',
    message: `No task found with name "${trimmed}".`,
  };
}

/**
 * Check if a task's group path matches a dot-separated prefix.
 * The prefix can be a single group name or a dot-separated path.
 * Matching is done from the end of the group path.
 *
 * Example: groupPath = ["Backend", "API"], prefix = "Backend" → true
 * Example: groupPath = ["Backend", "API"], prefix = "API" → true
 * Example: groupPath = ["Backend", "API"], prefix = "Backend.API" → true
 */
function matchesGroupPath(groupPath: string[], prefix: string): boolean {
  // Simple case: prefix is a single segment
  if (!prefix.includes('.')) {
    return groupPath.some(g => g === prefix);
  }

  // Multi-segment prefix: try matching from the start of the group path
  const pathStr = groupPath.join('.');
  // Check if the full prefix matches any contiguous section of the path
  return pathStr === prefix || pathStr.endsWith('.' + prefix) || pathStr.startsWith(prefix + '.') || pathStr.includes('.' + prefix + '.');
}
