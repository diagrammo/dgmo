// ============================================================
// RACI / RASCI / DACI parser
// ============================================================
//
// Three-level indented hierarchy under the chart-type header:
//   raci [title]
//   <directives>
//   [Phase]               // optional, one level deep, bracketed
//     Task name [# allow-incomplete]
//       Optional description line(s)
//       Role: <markers>
//
// Patterns followed:
//   - Stack-based indent parse (org/c4 precedent)
//   - measureIndent() from utils/parsing
//   - Forgiving identity via normalizeName() — first-seen casing wins
//   - All diagnostics accumulated in result.diagnostics; never throws
//
// See `docs/dgmo-language-spec.md` § "RACI Matrix".

import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import {
  measureIndent,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  tryParseSharedOption,
} from '../utils/parsing';
import {
  normalizeName,
  displayName as displayNameOf,
} from '../utils/name-normalize';
import { NAME_DIAGNOSTIC_CODES, nameMergedMessage } from '../diagnostics';
import type { PaletteColors } from '../palettes';
import {
  parseTaskAnnotations,
  type ParsedTaskAnnotations,
} from './annotations';
import {
  VARIANTS,
  RACI_ERROR_CODES,
  RACI_WARNING_CODES,
  isVariantMarker,
} from './variants';
import type {
  ParsedRaci,
  RaciMarker,
  RaciPhase,
  RaciRoleAssignment,
  RaciTask,
  RaciTaskAnnotation,
  RaciVariant,
} from './types';

const RACI_VARIANT_IDS: ReadonlySet<RaciVariant> = new Set([
  'raci',
  'rasci',
  'daci',
]);
const RACI_CHART_TYPE_IDS: ReadonlySet<string> = RACI_VARIANT_IDS;

/** Valid `# annotation` names recognized on task lines. */
const ALLOWED_TASK_ANNOTATIONS: ReadonlySet<RaciTaskAnnotation> = new Set([
  'allow-incomplete',
]);

/** Header options that take a value (`key value`). */
const KNOWN_OPTIONS = new Set([
  'variant',
  'roles',
  'palette',
  'theme',
  'active-tag',
]);
/** Header options that are bare booleans (presence = on). */
const KNOWN_BOOLEANS = new Set<string>(['draft']);

const PHASE_RE = /^\[(.+)\]\s*$/;
const ROLE_ASSIGNMENT_RE = /^([^:]+):\s*(.*)$/;

/**
 * Parse RACI/RASCI/DACI source. The leading chart-type id (if a
 * recognized variant id) acts as a hint for default variant when the
 * `variant` directive is absent.
 */
export function parseRaci(
  content: string,
  _palette?: PaletteColors
): ParsedRaci {
  const result: ParsedRaci = {
    type: 'raci',
    variant: 'raci',
    roles: [],
    roleDisplayNames: [],
    phases: [],
    tasksWithoutPhase: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedRaci => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const warn = (line: number, message: string, code?: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };

  const errorAt = (line: number, message: string, code?: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'error', code));
  };

  if (!content || !content.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');

  // ── Header phase ─────────────────────────────────────────────

  let i = 0;
  let leadingChartTypeId: string | null = null;

  // First non-empty / non-comment line: chart type + optional title.
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const firstLine = parseFirstLine(trimmed);
    if (!firstLine) {
      return fail(
        i + 1,
        'Expected chart type "raci", "rasci", or "daci" on the first line.'
      );
    }
    if (!RACI_CHART_TYPE_IDS.has(firstLine.chartType)) {
      let msg = `Expected chart type "raci"/"rasci"/"daci", got "${firstLine.chartType}"`;
      const hint = suggest(firstLine.chartType, ['raci', 'rasci', 'daci']);
      if (hint) msg += `. ${hint}`;
      return fail(i + 1, msg);
    }
    leadingChartTypeId = firstLine.chartType;
    if (firstLine.title) {
      result.title = firstLine.title;
      result.titleLineNumber = i + 1;
    }
    i++;
    break;
  }

  // Default variant comes from the leading id; a `variant` directive overrides.
  if (
    leadingChartTypeId &&
    RACI_VARIANT_IDS.has(leadingChartTypeId as RaciVariant)
  ) {
    result.variant = leadingChartTypeId as RaciVariant;
  }

  // ── Directives + body, single pass ───────────────────────────

  // Tracks header-vs-body phase. Once we see a phase or task, the
  // header window closes — directives after that are content errors.
  let bodyStarted = false;

  // Role identity store — single source of truth for role display names.
  // role normalized key → { displayName, declaredLine }
  const roleStore = new Map<
    string,
    { displayName: string; declaredLine: number }
  >();

  // Task identity store — only used for `I_NAME_MERGED` detection on
  // tasks. Mutations look up tasks by `task.id`, which is the
  // normalized key set during parse.
  const taskStore = new Map<
    string,
    { displayName: string; declaredLine: number }
  >();

  // Explicit `roles:` directive → strict column ordering + unknown-role diagnostics.
  let rolesExplicit = false;

  // Stack-based indent tracking: which phase / task is currently
  // accepting children?
  let currentPhase: RaciPhase | null = null;
  let currentTask: RaciTask | null = null;
  /** Indent of the task line itself (children must be deeper than this). */
  let taskIndent = 0;
  /** True once we've parsed at least one role assignment under `currentTask`.
   *  After that, free-text lines under the task are an error. */
  let taskHasRoleAssignment = false;

  /** Helper: register a role and return its normalized id. */
  const getOrAddRole = (label: string, line: number): string | null => {
    const display = displayNameOf(label);
    if (!display) {
      errorAt(line, 'Role name is empty.');
      return null;
    }
    const key = normalizeName(display);
    const existing = roleStore.get(key);
    if (existing) {
      if (existing.displayName !== display) {
        warn(
          line,
          nameMergedMessage({
            incomingDisplay: display,
            incomingLine: line,
            existingDisplay: existing.displayName,
            existingLine: existing.declaredLine,
          }),
          NAME_DIAGNOSTIC_CODES.NAME_MERGED
        );
      }
      return key;
    }
    roleStore.set(key, { displayName: display, declaredLine: line });
    result.roles.push(key);
    result.roleDisplayNames.push(display);
    return key;
  };

  /** Helper: register a task identity (returns normalized id). */
  const registerTask = (display: string, line: number): string => {
    const key = normalizeName(display);
    const existing = taskStore.get(key);
    if (existing) {
      if (existing.displayName !== display) {
        warn(
          line,
          nameMergedMessage({
            incomingDisplay: display,
            incomingLine: line,
            existingDisplay: existing.displayName,
            existingLine: existing.declaredLine,
          }),
          NAME_DIAGNOSTIC_CODES.NAME_MERGED
        );
      }
    } else {
      taskStore.set(key, { displayName: display, declaredLine: line });
    }
    return key;
  };

  /** Finalize the current task — set endLineNumber to last contentful line. */
  const finalizeTask = (uptoLineExclusive: number): void => {
    if (!currentTask) return;
    let end = uptoLineExclusive - 1;
    while (end > currentTask.lineNumber && !lines[end - 1].trim()) end--;
    currentTask.endLineNumber = end;
    if (currentPhase) currentPhase.endLineNumber = end;
    currentTask = null;
    taskHasRoleAssignment = false;
  };

  /** Finalize the current phase (also finalizes its tail task). */
  const finalizePhase = (uptoLineExclusive: number): void => {
    if (currentTask) finalizeTask(uptoLineExclusive);
    if (currentPhase) {
      let end = uptoLineExclusive - 1;
      while (end > currentPhase.lineNumber && !lines[end - 1].trim()) end--;
      currentPhase.endLineNumber = Math.max(currentPhase.endLineNumber, end);
      currentPhase = null;
    }
  };

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const lineNumber = i + 1;
    const trimmed = raw.trim();
    const indent = measureIndent(raw);

    if (!trimmed) continue;
    if (trimmed.startsWith('//')) continue;

    // ── Directives (header window only, indent === 0) ──────────
    if (!bodyStarted && indent === 0 && !PHASE_RE.test(trimmed)) {
      // Bare `roles` followed by indented role names (block form):
      //   roles
      //     Cap
      //     QM
      //     Bos
      // Mirrors the kanban-tag-block / `series:` precedents. Both
      // this and the inline `roles Cap, QM, Bos` form are accepted.
      if (trimmed.toLowerCase() === 'roles') {
        rolesExplicit = true;
        let j = i + 1;
        for (; j < lines.length; j++) {
          const next = lines[j];
          const nextTrim = next.trim();
          if (!nextTrim) continue;
          if (nextTrim.startsWith('//')) continue;
          // First non-indented line ends the block.
          if (next.length > 0 && next[0] !== ' ' && next[0] !== '\t') break;
          // Strip a possible trailing comma (user habit tolerance,
          // matches `collectIndentedValues`).
          const roleLabel = nextTrim.replace(/,\s*$/, '');
          if (roleLabel) getOrAddRole(roleLabel, j + 1);
        }
        i = j - 1; // outer loop's i++ lands on the first non-block line
        continue;
      }

      // Bare boolean directives (e.g. `draft`, `solid-fill`)
      if (KNOWN_BOOLEANS.has(trimmed.toLowerCase())) {
        result.options[trimmed.toLowerCase()] = 'on';
        continue;
      }
      if (tryParseSharedOption(trimmed, result.options)) continue;

      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        const key = optMatch[1].trim().toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          const value = optMatch[2].trim();
          if (key === 'variant') {
            const v = value.toLowerCase();
            if (RACI_VARIANT_IDS.has(v as RaciVariant)) {
              result.variant = v as RaciVariant;
            } else {
              errorAt(
                lineNumber,
                `Unknown variant '${value}'. Expected raci, rasci, or daci.`
              );
            }
          } else if (key === 'roles') {
            rolesExplicit = true;
            const declared = value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            for (const rawRole of declared) {
              getOrAddRole(rawRole, lineNumber);
            }
          } else {
            result.options[key] = value;
          }
          continue;
        }
      }
      // Falls through → treated as a task line below.
    }

    // ── Phase header: `[Label]` at indent 0 ────────────────────
    if (indent === 0) {
      const phaseMatch = trimmed.match(PHASE_RE);
      if (phaseMatch) {
        bodyStarted = true;
        finalizePhase(lineNumber);
        const label = phaseMatch[1].trim();
        const display = displayNameOf(label);
        if (!display) {
          errorAt(lineNumber, 'Phase label is empty.');
          continue;
        }
        currentPhase = {
          id: normalizeName(display),
          displayName: display,
          tasks: [],
          lineNumber,
          endLineNumber: lineNumber,
        };
        result.phases.push(currentPhase);
        continue;
      }
    }

    // Helper to start a fresh task. Called from each line-shape that
    // resolves to a task declaration.
    const startTask = (): void => {
      const annotated = parseTaskAnnotations<RaciTaskAnnotation>(
        trimmed,
        ALLOWED_TASK_ANNOTATIONS
      );
      reportUnknownAnnotations(annotated, lineNumber, warn);

      const display = displayNameOf(annotated.stripped);
      if (!display) {
        errorAt(lineNumber, 'Task name is empty.');
        return;
      }
      const taskId = registerTask(display, lineNumber);

      const task: RaciTask = {
        id: taskId,
        displayName: display,
        description: '',
        annotations: annotated.annotations,
        roleAssignments: [],
        lineNumber,
        endLineNumber: lineNumber,
      };

      if (currentPhase) {
        currentPhase.tasks.push(task);
      } else {
        result.tasksWithoutPhase.push(task);
      }
      currentTask = task;
      taskIndent = indent;
      taskHasRoleAssignment = false;
    };

    // ── Top-level task at indent 0 (no current phase) ──────────
    if (indent === 0 && !currentPhase) {
      bodyStarted = true;
      finalizeTask(lineNumber);
      startTask();
      continue;
    }

    // ── Top-level task at indent 0 that closes an open phase ───
    if (indent === 0 && currentPhase) {
      bodyStarted = true;
      finalizePhase(lineNumber);
      startTask();
      continue;
    }

    // ── Task under an open phase: indent > 0 and either no
    //    current task yet, or this line is at-or-shallower than
    //    the current task's indent (a sibling task closing it).
    if (currentPhase && indent > 0 && (!currentTask || indent <= taskIndent)) {
      bodyStarted = true;
      finalizeTask(lineNumber);
      startTask();
      continue;
    }

    // ── Lines under an open task (indent > taskIndent) ──────────
    if (currentTask && indent > taskIndent) {
      // Snapshot — `let`-binding narrowing is lost across nested
      // closures (warn/errorAt/getOrAddRole), so capture the
      // narrowed reference once and use it for the rest of the block.
      const task: RaciTask = currentTask;
      // Try parsing as a role assignment first.
      const m = trimmed.match(ROLE_ASSIGNMENT_RE);
      if (m) {
        const rawRole = m[1].trim();
        const valuePart = m[2].trim();
        const tokens = valuePart.length > 0 ? valuePart.split(/\s+/) : [];

        // All tokens must be valid markers in the active variant — if
        // ANY token is not a marker, the line is treated as an
        // assignment with an invalid-marker error rather than as a
        // description (descriptions are positional, before first role).
        const looksLikeAssignment = tokens.length > 0 || /:\s*$/.test(trimmed);

        if (looksLikeAssignment) {
          const markers: RaciMarker[] = [];
          for (const tok of tokens) {
            if (isVariantMarker(tok, result.variant)) {
              markers.push(tok);
            } else {
              errorAt(
                lineNumber,
                `Marker '${tok}' is not in the ${result.variant.toUpperCase()} alphabet (${VARIANTS[result.variant].alphabet.join(' ')}).`,
                RACI_ERROR_CODES.INVALID_MARKER
              );
            }
          }

          const roleId = getOrAddRole(rawRole, lineNumber);
          if (roleId === null) continue;

          // unknown-role diagnostic only when `roles:` is declared.
          if (rolesExplicit) {
            // The role is "unknown" if it wasn't pre-declared at the
            // header — but `getOrAddRole` adds it on first sight. So
            // detect by whether it was declared before `bodyStarted`.
            // We piggyback the `declaredLine` we recorded.
            const entry = roleStore.get(roleId);
            if (entry && entry.declaredLine === lineNumber) {
              const candidates = result.roleDisplayNames.filter(
                (n) => n !== entry.displayName
              );
              const hint = suggest(rawRole, candidates);
              const msg = `Role '${rawRole}' is not declared in the 'roles:' directive.${hint ? ' ' + hint : ''}`;
              warn(lineNumber, msg, RACI_WARNING_CODES.UNKNOWN_ROLE);
            }
          }

          const assignment: RaciRoleAssignment = {
            id: roleId,
            displayName: roleStore.get(roleId)!.displayName,
            markers,
            lineNumber,
            endLineNumber: lineNumber,
          };
          task.roleAssignments.push(assignment);
          task.endLineNumber = lineNumber;
          taskHasRoleAssignment = true;
          continue;
        }
      }

      // Description line — only valid BEFORE the first role assignment.
      if (!taskHasRoleAssignment) {
        task.description = task.description
          ? task.description + '\n' + trimmed
          : trimmed;
        task.endLineNumber = lineNumber;
        continue;
      }

      // Free-text line AFTER a role assignment is unexpected.
      errorAt(
        lineNumber,
        `Unexpected line after role assignments under task '${task.displayName}'. Lines under a task must be either a description (before the first 'Role: markers' line) or another role assignment.`,
        RACI_ERROR_CODES.UNEXPECTED_LINE
      );
      continue;
    }

    // ── Catch-all: stray content line in body ────────────────────
    if (bodyStarted) {
      errorAt(lineNumber, `Unexpected line: '${trimmed}'.`);
    } else {
      // Pre-body unrecognized line — likely a typo'd directive. Tolerate
      // by emitting a warning rather than failing the whole parse.
      warn(lineNumber, `Unrecognized directive: '${trimmed}'.`);
    }
  }

  finalizePhase(lines.length + 1);

  // ── Constraint linting ───────────────────────────────────────

  const draftMode = result.options['draft'] === 'on';
  const variantRules = VARIANTS[result.variant];

  for (const task of allTasks(result)) {
    // Errors always fire.
    for (const rule of variantRules.errorRules) {
      result.diagnostics.push(...rule(task));
    }
    // Warnings: suppress if draft directive OR per-task `# allow-incomplete`.
    const taskSuppressesWarnings =
      draftMode || task.annotations.has('allow-incomplete');
    if (!taskSuppressesWarnings) {
      for (const rule of variantRules.warningRules) {
        result.diagnostics.push(...rule(task));
      }
    }
  }

  return result;
}

// ── Helpers ────────────────────────────────────────────────────

function reportUnknownAnnotations(
  parsed: ParsedTaskAnnotations<RaciTaskAnnotation>,
  lineNumber: number,
  warn: (line: number, msg: string, code?: string) => void
): void {
  for (const name of parsed.unknown) {
    warn(
      lineNumber,
      `Unknown task annotation '#${name}'.`,
      RACI_WARNING_CODES.UNKNOWN_ANNOTATION
    );
  }
}

/** Iterate every task — phased and unphased, in source order. */
export function* allTasks(parsed: ParsedRaci): Iterable<RaciTask> {
  for (const t of parsed.tasksWithoutPhase) yield t;
  for (const phase of parsed.phases) {
    for (const t of phase.tasks) yield t;
  }
}
