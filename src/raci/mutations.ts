// ============================================================
// RACI mutation engine
// ============================================================
//
// Greenfield, peer to `kanban/mutations.ts` (NOT extracted shared
// utility — see Technical Decision #15 in the tech spec). All
// mutations are pure functions that return a new DGMO source string,
// or `null` for no-ops.
//
// Mutation flow (do not deviate):
//
//   click / drop in RACIPreview
//     ─→ pure mutation here returns new content
//     ─→ Zustand stores updated (`useFileStore.setFileContent`,
//        `useEditorStore.setContent`)
//     ─→ `useCodeMirror` watcher dispatches a CM transaction
//
// Preview NEVER calls `view.dispatch()` directly. Same contract as
// kanban — see `KanbanPreview.tsx:476-477` + `useCodeMirror.ts:269-283`.
//
// Indent preservation comes from operating on whole lines + matching
// the indent of the task's existing role-assignment block. The parser
// owns identity (taskId / roleId are normalized keys); mutations look
// up by id pair.

import { measureIndent } from '../utils/parsing';
import type {
  ParsedRaci,
  RaciMarker,
  RaciRoleAssignment,
  RaciTask,
} from './types';
import { allTasks } from './parser';

// ── Public surface ───────────────────────────────────────────

/**
 * Set the markers on a cell to exactly `[marker]`, replacing whatever
 * was there. If `marker` is `null`, the cell is cleared (the role
 * assignment line is removed if it was the only marker; otherwise the
 * line stays with its other markers untouched — see `cellRemove` for
 * specific-marker removal semantics).
 *
 * Insertion point when the role assignment doesn't exist:
 *   - After the last existing role assignment under the task, OR
 *   - After the task's description block, OR
 *   - Immediately after the task line.
 *
 * Returns `null` for no-ops (the cell already contains `[marker]`).
 */
export function cellReplace(
  content: string,
  parsed: ParsedRaci,
  taskId: string,
  roleId: string,
  marker: RaciMarker | null
): string | null {
  const task = findTask(parsed, taskId);
  if (!task) return null;

  const lines = content.split('\n');
  const existing = task.roleAssignments.find((a) => a.id === roleId);

  if (existing) {
    // No-op short-circuit: cell already holds exactly one marker.
    if (
      marker !== null &&
      existing.markers.length === 1 &&
      existing.markers[0] === marker
    ) {
      return null;
    }
    // No-op short-circuit: clearing an already-empty cell.
    if (marker === null && existing.markers.length === 0) {
      return null;
    }

    if (marker === null) {
      // Drop the line entirely.
      lines.splice(existing.lineNumber - 1, 1);
      return lines.join('\n');
    }

    lines[existing.lineNumber - 1] = rewriteAssignmentLine(
      lines[existing.lineNumber - 1],
      existing.displayName,
      [marker]
    );
    return lines.join('\n');
  }

  // No existing role assignment for this role; insert one (unless null).
  if (marker === null) return null;

  const roleDisplay = lookupRoleDisplay(parsed, roleId);
  if (!roleDisplay) return null;

  const indent = inferAssignmentIndent(task, lines);
  const insertAt = insertionLineFor(task, roleId, parsed);
  const newLine = `${' '.repeat(indent)}${roleDisplay}: ${marker}`;
  lines.splice(insertAt, 0, newLine);
  return lines.join('\n');
}

/**
 * Append `marker` to the cell, producing a combined-marker string
 * like `A R`. Idempotent — if `marker` is already present, returns
 * `null`. If the cell is empty (no existing role assignment line),
 * behaves like `cellReplace(content, ..., marker)`.
 */
export function cellAppendMarker(
  content: string,
  parsed: ParsedRaci,
  taskId: string,
  roleId: string,
  marker: RaciMarker
): string | null {
  const task = findTask(parsed, taskId);
  if (!task) return null;

  const existing = task.roleAssignments.find((a) => a.id === roleId);
  if (!existing) {
    return cellReplace(content, parsed, taskId, roleId, marker);
  }
  if (existing.markers.includes(marker)) return null;

  const lines = content.split('\n');
  lines[existing.lineNumber - 1] = rewriteAssignmentLine(
    lines[existing.lineNumber - 1],
    existing.displayName,
    [...existing.markers, marker]
  );
  return lines.join('\n');
}

/**
 * Remove a single `marker` from the cell, OR all markers when
 * `marker` is `undefined`. If the cell becomes empty as a result,
 * the entire role-assignment line is dropped.
 *
 * Returns `null` for no-ops (e.g. removing a marker that wasn't
 * there).
 */
export function cellRemove(
  content: string,
  parsed: ParsedRaci,
  taskId: string,
  roleId: string,
  marker?: RaciMarker
): string | null {
  const task = findTask(parsed, taskId);
  if (!task) return null;

  const existing = task.roleAssignments.find((a) => a.id === roleId);
  if (!existing) return null;

  const lines = content.split('\n');

  let nextMarkers: RaciMarker[];
  if (marker === undefined) {
    nextMarkers = [];
  } else {
    if (!existing.markers.includes(marker)) return null;
    nextMarkers = existing.markers.filter((m) => m !== marker);
  }

  if (nextMarkers.length === 0) {
    lines.splice(existing.lineNumber - 1, 1);
    return lines.join('\n');
  }

  lines[existing.lineNumber - 1] = rewriteAssignmentLine(
    lines[existing.lineNumber - 1],
    existing.displayName,
    nextMarkers
  );
  return lines.join('\n');
}

/**
 * Cycle the cell's marker through the variant alphabet. Used by the
 * click-to-cycle interaction in `RACIPreview`. Cycle order:
 *
 *   blank → alphabet[0] → alphabet[1] → … → alphabet[n-1] → blank → …
 *
 * If the cell currently has multiple markers (e.g. `A R`), cycling
 * collapses to a single marker chosen as the *next* one after the
 * first existing marker — interpretation: "cycle from the dominant
 * marker." This keeps the affordance simple; combined-markers stay
 * the territory of drag-from-palette (per TD #10).
 */
export function cellCycle(
  content: string,
  parsed: ParsedRaci,
  taskId: string,
  roleId: string,
  alphabet: ReadonlyArray<RaciMarker>
): string | null {
  if (alphabet.length === 0) return null;
  const task = findTask(parsed, taskId);
  if (!task) return null;

  const existing = task.roleAssignments.find((a) => a.id === roleId);
  const current = existing?.markers ?? [];

  let next: RaciMarker | null;
  if (current.length === 0) {
    next = alphabet[0];
  } else {
    const dominant = current[0];
    const idx = alphabet.indexOf(dominant);
    if (idx < 0) {
      // First marker is not in alphabet (shouldn't normally happen —
      // parser would have flagged it). Restart the cycle.
      next = alphabet[0];
    } else if (idx === alphabet.length - 1) {
      // Wrap → blank
      next = null;
    } else {
      next = alphabet[idx + 1];
    }
  }

  return cellReplace(content, parsed, taskId, roleId, next);
}

// ── Internals ────────────────────────────────────────────────

function findTask(parsed: ParsedRaci, taskId: string): RaciTask | null {
  for (const t of allTasks(parsed)) {
    if (t.id === taskId) return t;
  }
  return null;
}

function lookupRoleDisplay(parsed: ParsedRaci, roleId: string): string | null {
  const idx = parsed.roles.indexOf(roleId);
  if (idx < 0) return null;
  return parsed.roleDisplayNames[idx] ?? null;
}

/**
 * Build a fresh role-assignment line at `existing`'s indent and role
 * display, with the given markers. Preserves trailing whitespace /
 * comments after the markers? — no: we treat the value segment after
 * the colon as wholly owned by the markers. RACI does not currently
 * support trailing pipe metadata on role-assignment lines (per
 * Out-of-Scope), so this is safe.
 */
function rewriteAssignmentLine(
  originalLine: string,
  displayName: string,
  markers: ReadonlyArray<RaciMarker>
): string {
  const indent = measureIndent(originalLine);
  return `${' '.repeat(indent)}${displayName}: ${markers.join(' ')}`;
}

/**
 * Indent for a NEW role-assignment line under `task`. Use the indent
 * of the first existing role assignment if any; otherwise infer from
 * a sibling task's role assignment; otherwise default to the task's
 * own indent + 2.
 */
function inferAssignmentIndent(task: RaciTask, lines: string[]): number {
  if (task.roleAssignments.length > 0) {
    return measureIndent(lines[task.roleAssignments[0].lineNumber - 1]);
  }
  const taskIndent = measureIndent(lines[task.lineNumber - 1]);
  return taskIndent + 2;
}

/**
 * 1-based line *index for splice*: the index BEFORE which the new
 * line is inserted. Returns the position immediately after the
 * task's last contentful line (description or role assignment) — or
 * directly after the task line when neither exists.
 */
function insertionLineFor(
  task: RaciTask,
  roleId: string,
  parsed: ParsedRaci
): number {
  // No existing role assignments — insert directly after the task block
  // (after the task line and any description lines).
  if (task.roleAssignments.length === 0) {
    return task.endLineNumber;
  }

  // Match role-declaration order: insert before the first existing
  // role assignment whose role-index is greater than this role's. If
  // none has a higher index (i.e. this role belongs at the bottom of
  // the declared order), append after the last existing assignment.
  const targetIdx = parsed.roles.indexOf(roleId);
  const lastAssignmentLine = Math.max(
    ...task.roleAssignments.map((a: RaciRoleAssignment) => a.endLineNumber)
  );
  if (targetIdx < 0) {
    // Role not registered (shouldn't normally happen since callers
    // look up by parsed.roles index) — fall back to end-of-block.
    return lastAssignmentLine;
  }
  for (const a of task.roleAssignments) {
    const aIdx = parsed.roles.indexOf(a.id);
    if (aIdx > targetIdx) {
      // splice index = (1-based line) - 1 places the new line BEFORE
      // the existing line at `a.lineNumber`.
      return a.lineNumber - 1;
    }
  }
  return lastAssignmentLine;
}
