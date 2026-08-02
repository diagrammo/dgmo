// ============================================================
// Gantt Dot-Notation Task Resolver
// ============================================================
//
// Resolves `-> TargetName` dependency references to actual tasks.
// Implements greedy right-to-left dot splitting for disambiguation.

import type { GanttTask, GanttNode } from './types';
import { normalizeName } from '../utils/name-normalize';
import { peelQuotedName } from '../utils/parsing';

interface ResolverMatch {
  task: GanttTask;
}

interface ResolverError {
  kind: 'not_found' | 'ambiguous';
  message: string;
}

type ResolverResult = ResolverMatch | ResolverError;

export function isResolverError(r: ResolverResult): r is ResolverError {
  return 'kind' in r;
}

/**
 * Collect all tasks from a tree of GanttNodes, annotating each with its
 * fully qualified group path (e.g., ["Backend", "API"]).
 */
export function collectTasks(nodes: readonly GanttNode[]): GanttTask[] {
  const tasks: GanttTask[] = [];
  function walk(children: readonly GanttNode[]) {
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
/** Strip bracket syntax: `[Backend].API Design` → `Backend.API Design` */
const BRACKET_GROUP_RE = /^\[(.+?)\]\.(.+)$/;

/** Disambiguation message when a name matches more than one task. */
function ambiguousTaskMessage(trimmed: string, suggestions: string[]): string {
  return `Multiple tasks match "${trimmed}". Did you mean ${suggestions
    .map((s) => `\`${s}\``)
    .join(' or ')}?`;
}

export function resolveTaskName(
  name: string,
  allTasks: GanttTask[]
): ResolverResult {
  // §2.2 quoting is the escape hatch for a reserved character — peel it so a
  // quoted reference and a bare one land on the same task.
  let trimmed = peelQuotedName(name.trim()).trim();

  // Strip bracket syntax — `[Group].Task` is sugar for `Group.Task`
  const bracketMatch = trimmed.match(BRACKET_GROUP_RE);
  if (bracketMatch) {
    trimmed = `${peelQuotedName(bracketMatch[1]!)}.${bracketMatch[2]}`;
  }

  const normTrimmed = normalizeName(trimmed);

  // 1. Try exact label match (no dots involved). Forgiving normalization
  // (case-insensitive, whitespace-collapsed) per the universal name handling
  // spec — `myTask` and `MyTask` resolve to the same task.
  const exactMatches = allTasks.filter(
    (t) => normalizeName(t.label) === normTrimmed
  );
  if (exactMatches.length === 1) {
    // In-bounds by length === 1 check.
    return { task: exactMatches[0]! };
  }
  if (exactMatches.length > 1) {
    // Multiple tasks with same name — need disambiguation
    const suggestions = exactMatches.map((t) =>
      t.groupPath.length > 0 ? `${t.groupPath.join('.')}.${t.label}` : t.label
    );
    return {
      kind: 'ambiguous',
      message: ambiguousTaskMessage(trimmed, suggestions),
    };
  }

  // 2. Try dot-notation: split at last dot (greedy right-to-left)
  const lastDotIdx = trimmed.lastIndexOf('.');
  if (lastDotIdx > 0) {
    const groupPrefix = peelQuotedName(trimmed.substring(0, lastDotIdx));
    const taskLabel = peelQuotedName(trimmed.substring(lastDotIdx + 1));

    // Find tasks whose label matches and whose group path ends with the prefix
    const normTaskLabel = normalizeName(taskLabel);
    const matches = allTasks.filter((t) => {
      if (normalizeName(t.label) !== normTaskLabel) return false;
      return matchesGroupPath(t.groupPath, groupPrefix);
    });

    if (matches.length === 1) {
      // In-bounds by length === 1 check.
      return { task: matches[0]! };
    }
    if (matches.length > 1) {
      const suggestions = matches.map((t) =>
        t.groupPath.length > 0 ? `${t.groupPath.join('.')}.${t.label}` : t.label
      );
      return {
        kind: 'ambiguous',
        message: ambiguousTaskMessage(trimmed, suggestions),
      };
    }

    // Try further left splits (for dots in group names)
    // e.g., "U.S. Operations.Task A" — last dot split tried "U.S. Operations" + "Task A"
    // Now try "U.S." + "Operations.Task A" — but that doesn't help.
    // The greedy approach handles this: "U.S. Operations" is the group name.
    // If the group name itself contains dots, the last dot split already tried the correct split.
  }

  // 3. No match found.
  // (Case-insensitive fallback removed — the primary match is now itself
  // case- and whitespace-insensitive via normalizeName.)

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
function matchesGroupPath(
  groupPath: readonly string[],
  prefix: string
): boolean {
  const normPrefix = normalizeName(prefix);
  // Simple case: prefix is a single segment
  if (!prefix.includes('.')) {
    return groupPath.some((g) => normalizeName(g) === normPrefix);
  }

  // Multi-segment prefix: try matching from the start of the group path
  const pathStr = groupPath.map((g) => normalizeName(g)).join('.');
  // Check if the full prefix matches any contiguous section of the path
  return (
    pathStr === normPrefix ||
    pathStr.endsWith('.' + normPrefix) ||
    pathStr.startsWith(normPrefix + '.') ||
    pathStr.includes('.' + normPrefix + '.')
  );
}
