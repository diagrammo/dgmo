// ============================================================
// RACI / RASCI / DACI parser
// ============================================================
//
// Three-level indented hierarchy under the chart-type header:
//   raci [title]
//   <directives>           // e.g. `no-rule-enforcement`
//   [Phase]               // optional, one level deep, bracketed
//     Task name
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
import { resolveColorWithDiagnostic } from '../colors';
import {
  measureIndent,
  parseFirstLine,
  parsePipeMetadata,
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
  VARIANTS,
  RACI_ERROR_CODES,
  RACI_WARNING_CODES,
  ALL_MARKERS,
  inferVariant,
} from './variants';
import type {
  ParsedRaci,
  RaciMarker,
  RaciPhase,
  RaciRoleAssignment,
  RaciTask,
  RaciVariant,
} from './types';

/**
 * Chart-type ids accepted on the first line. All three route here via the
 * router; writing `rasci` or `daci` as line 1 is equivalent to `raci` plus a
 * `variant-rasci` / `variant-daci` lock directive.
 */
const RACI_CHART_TYPE_IDS: ReadonlySet<string> = new Set([
  'raci',
  'rasci',
  'daci',
]);

/** First-line chart-type ids that imply a variant lock. */
const CHART_TYPE_VARIANT_LOCK: Record<string, RaciVariant> = {
  rasci: 'rasci',
  daci: 'daci',
};

/** Variant lock directives — hyphenated bare keywords, one per variant. */
const VARIANT_LOCK_DIRECTIVES: Record<string, RaciVariant> = {
  'variant-raci': 'raci',
  'variant-rasci': 'rasci',
  'variant-daci': 'daci',
};

/** Header options that take a value (`key value`). */
const KNOWN_OPTIONS = new Set(['roles', 'palette', 'theme', 'active-tag']);
/** Header options that are bare booleans (presence = on). */
const KNOWN_BOOLEANS = new Set<string>([
  'no-rule-enforcement',
  'no-title',
  ...Object.keys(VARIANT_LOCK_DIRECTIVES),
]);

// Allow optional trailing `| key: value, ...` after the bracket,
// e.g. `[Voyage] | color: blue` — matches the modern dgmo idiom
// (cycle / pyramid / ring / journey-map / boxes-and-lines).
const PHASE_RE = /^\[(.+?)\]\s*(?:\|\s*(.+))?\s*$/;
const ROLE_ASSIGNMENT_RE = /^([^:]+):\s*(.*)$/;

/**
 * Decide whether `trimmed` is a role-assignment line and split it into
 * `rawRole` + `markersBlob`. Two accepted forms:
 *   - Explicit colon: `Bos: A R` / `Bos:` (markers may be empty).
 *   - Colon-less:    `Bos A R` / `Bos AR` — the role name is everything
 *                    before the first whitespace-separated token whose
 *                    every character is a marker letter from the union
 *                    of all variant alphabets. If no such token exists,
 *                    this isn't an assignment (likely a description line).
 *
 * The colon-less form uses the widest alphabet (R/A/S/C/I/D) so the
 * tokenizer doesn't depend on knowing the variant up front — variant
 * resolution happens AFTER parsing in a post-pass.
 *
 * Returns null when the line does not look like an assignment. The
 * caller then falls through to description / unexpected-line handling.
 */
function parseRoleAssignmentLine(
  trimmed: string
): { rawRole: string; markersBlob: string } | null {
  const colonMatch = trimmed.match(ROLE_ASSIGNMENT_RE);
  if (colonMatch) {
    return {
      rawRole: colonMatch[1].trim(),
      markersBlob: colonMatch[2].trim(),
    };
  }
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 2) return null;
  const isAllMarkers = (tok: string): boolean => {
    if (tok.length === 0) return false;
    for (const ch of tok) {
      if (!ALL_MARKERS.has(ch as RaciMarker)) return false;
    }
    return true;
  };
  let firstMarkerIdx = -1;
  for (let j = 0; j < tokens.length; j++) {
    if (isAllMarkers(tokens[j])) {
      firstMarkerIdx = j;
      break;
    }
  }
  // No marker token found, OR the entire line is markers (no role
  // prefix) — not a role-assignment line.
  if (firstMarkerIdx <= 0) return null;
  return {
    rawRole: tokens.slice(0, firstMarkerIdx).join(' '),
    markersBlob: tokens.slice(firstMarkerIdx).join(' '),
  };
}

/**
 * Parse RACI/RASCI/DACI source. The leading chart-type id (if a
 * recognized variant id) acts as a hint for default variant when the
 * `variant` directive is absent.
 */
export function parseRaci(
  content: string,
  palette?: PaletteColors
): ParsedRaci {
  const result: ParsedRaci = {
    type: 'raci',
    variant: 'raci',
    roles: [],
    roleDisplayNames: [],
    roleColors: [],
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

  // Variant resolution happens after parse:
  //   1. If a `variant-*` lock directive was present → use it.
  //   2. Else infer from markers used (D → daci, S → rasci, else raci).
  //   3. If both D and S without a lock → E_RACI_MIXED_VARIANTS.
  // Writing `rasci` or `daci` as the first-line chart type also sets the
  // lock, equivalent to a `variant-rasci` / `variant-daci` directive on
  // line 1.
  let lockedVariant: RaciVariant | null = null;
  let lockedVariantLine = 0;

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
      let msg = `Expected chart type "raci", "rasci", or "daci", got "${firstLine.chartType}"`;
      const hint = suggest(firstLine.chartType, ['raci', 'rasci', 'daci']);
      if (hint) msg += `. ${hint}`;
      return fail(i + 1, msg);
    }
    const impliedVariant = CHART_TYPE_VARIANT_LOCK[firstLine.chartType];
    if (impliedVariant) {
      lockedVariant = impliedVariant;
      lockedVariantLine = i + 1;
    }
    if (firstLine.title) {
      result.title = firstLine.title;
      result.titleLineNumber = i + 1;
    }
    i++;
    break;
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

  /**
   * Helper: register a role and return its normalized id. The optional
   * `color` (resolved hex) overrides any prior color for that role —
   * declared roles win over usage-only roles.
   */
  const getOrAddRole = (
    label: string,
    line: number,
    color?: string
  ): string | null => {
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
      // Late color upgrade — if a previously-undeclared role gets
      // color via a later declaration, accept it.
      if (color !== undefined) {
        const idx = result.roles.indexOf(key);
        if (idx >= 0) result.roleColors[idx] = color;
      }
      return key;
    }
    roleStore.set(key, { displayName: display, declaredLine: line });
    result.roles.push(key);
    result.roleDisplayNames.push(display);
    result.roleColors.push(color);
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
          const stripped = nextTrim.replace(/,\s*$/, '');
          // Optional pipe metadata: `Cap | color: blue` — matches
          // every modern chart-type's per-element styling form.
          const segments = stripped.split('|').map((s) => s.trim());
          const roleLabel = segments[0] ?? '';
          let roleColor: string | undefined;
          if (segments.length > 1) {
            const meta = parsePipeMetadata(segments);
            if (meta['color']) {
              roleColor = resolveColorWithDiagnostic(
                meta['color'],
                j + 1,
                result.diagnostics,
                palette
              );
            }
          }
          if (roleLabel) getOrAddRole(roleLabel, j + 1, roleColor);
        }
        i = j - 1; // outer loop's i++ lands on the first non-block line
        continue;
      }

      // Bare boolean directives — includes `variant-raci`/`variant-rasci`/
      // `variant-daci` (each maps to a variant lock) plus `no-rule-enforcement`.
      const lower = trimmed.toLowerCase();
      if (KNOWN_BOOLEANS.has(lower)) {
        if (lower in VARIANT_LOCK_DIRECTIVES) {
          const v = VARIANT_LOCK_DIRECTIVES[lower];
          if (lockedVariant !== null) {
            // Redundant restatement of the same lock is fine; conflicting
            // locks (e.g. `rasci` chart type + `variant-daci`) error out.
            if (lockedVariant !== v) {
              errorAt(
                lineNumber,
                `Conflicting variant directive '${lower}' — chart already locked to '${lockedVariant}' on line ${lockedVariantLine}.`,
                RACI_ERROR_CODES.DUPLICATE_VARIANT
              );
            }
          } else {
            lockedVariant = v;
            lockedVariantLine = lineNumber;
          }
          result.options[lower] = 'on';
          continue;
        }
        result.options[lower] = 'on';
        continue;
      }
      if (tryParseSharedOption(trimmed, result.options)) continue;

      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        const key = optMatch[1].trim().toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          const value = optMatch[2].trim();
          if (key === 'roles') {
            rolesExplicit = true;
            // Inline form is name-only. For per-role color use the
            // block form: each role on its own line with `| color: ...`.
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
        // Optional pipe metadata: `[Voyage] | color: blue`.
        let phaseColor: string | undefined;
        if (phaseMatch[2]) {
          const meta = parsePipeMetadata(['', phaseMatch[2]]);
          if (meta['color']) {
            phaseColor = resolveColorWithDiagnostic(
              meta['color'],
              lineNumber,
              result.diagnostics,
              palette
            );
          }
        }
        currentPhase = {
          id: normalizeName(display),
          displayName: display,
          color: phaseColor,
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
      const display = displayNameOf(trimmed);
      if (!display) {
        errorAt(lineNumber, 'Task name is empty.');
        return;
      }
      const taskId = registerTask(display, lineNumber);

      const task: RaciTask = {
        id: taskId,
        displayName: display,
        description: '',
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
      // Resolve to (rawRole, markersBlob) for either the colon form
      // (`Bos: A R`) or the colon-less form (`Bos A R`, `Bos AR`).
      const parsedAssign = parseRoleAssignmentLine(trimmed);
      if (parsedAssign) {
        const { rawRole, markersBlob } = parsedAssign;
        const markers: RaciMarker[] = [];
        // Tokens may be space-separated (`A R`), concatenated (`AR`),
        // or any mix (`A RC I`). Split by whitespace, then by character.
        // Validation against the resolved variant's alphabet happens in
        // a post-pass after variant resolution; here we accept any token
        // from the union of alphabets and reject unknown letters outright.
        const tokens: string[] = [];
        for (const tok of markersBlob.split(/\s+/)) {
          if (!tok) continue;
          for (const ch of tok) tokens.push(ch);
        }
        for (const tok of tokens) {
          if (ALL_MARKERS.has(tok as RaciMarker)) {
            markers.push(tok as RaciMarker);
          } else {
            errorAt(
              lineNumber,
              `Marker '${tok}' is not a recognized RACI marker (R A S C I D).`,
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

  // ── Variant resolution ───────────────────────────────────────
  //
  // 1. Explicit lock from a `variant-*` directive wins.
  // 2. Otherwise infer from the markers actually used.
  // 3. Mixed `D` + `S` without a lock is unresolvable → MIXED_VARIANTS.
  //    Falls back to RASCI for downstream rule application so cells
  //    still render, but the chart-level error makes the conflict loud.

  const usedMarkers: RaciMarker[] = [];
  for (const task of allTasks(result)) {
    for (const a of task.roleAssignments) {
      for (const m of a.markers) usedMarkers.push(m);
    }
  }

  if (lockedVariant !== null) {
    result.variant = lockedVariant;
  } else {
    const inferred = inferVariant(usedMarkers);
    if (inferred === null) {
      const titleLine = result.titleLineNumber ?? 1;
      errorAt(
        titleLine,
        `Chart uses both 'D' and 'S' markers but neither RASCI nor DACI covers both. Add a 'variant-rasci' or 'variant-daci' directive to lock the variant explicitly.`,
        RACI_ERROR_CODES.MIXED_VARIANTS
      );
      result.variant = 'rasci';
    } else {
      result.variant = inferred;
    }
  }

  // ── Marker validation against the resolved variant ───────────
  //
  // The first pass accepted any letter from the union alphabet; now
  // that we know the variant, drop markers that fall outside it and
  // surface INVALID_MARKER for each.

  const resolvedAlphabet = VARIANTS[result.variant].alphabet;
  for (const task of allTasks(result)) {
    for (const a of task.roleAssignments) {
      const kept: RaciMarker[] = [];
      for (const m of a.markers) {
        if (resolvedAlphabet.includes(m)) {
          kept.push(m);
        } else {
          errorAt(
            a.lineNumber,
            `Marker '${m}' is not in the ${result.variant.toUpperCase()} alphabet (${resolvedAlphabet.join(' ')}).`,
            RACI_ERROR_CODES.INVALID_MARKER
          );
        }
      }
      a.markers = kept;
    }
  }

  // ── Constraint linting ───────────────────────────────────────
  //
  // Single chart-wide escape hatch: `no-rule-enforcement` suppresses
  // ALL rules — both structural errors (multi-A, multi-D) and warnings
  // (missing-A, conflicting markers, orphan roles, etc.). For sandbox /
  // teaching contexts where the matrix intentionally violates RACI
  // norms.

  const noRuleEnforcement = result.options['no-rule-enforcement'] === 'on';
  const variantRules = VARIANTS[result.variant];

  if (!noRuleEnforcement) {
    for (const task of allTasks(result)) {
      for (const rule of variantRules.errorRules) {
        result.diagnostics.push(...rule(task));
      }
      for (const rule of variantRules.warningRules) {
        result.diagnostics.push(...rule(task));
      }
    }

    // Orphan-role check: any role declared (or first seen via assignment)
    // but never *actually* assigned a marker is dead weight on the matrix.
    const usedRoleIds = new Set<string>();
    for (const task of allTasks(result)) {
      for (const a of task.roleAssignments) {
        if (a.markers.length > 0) usedRoleIds.add(a.id);
      }
    }
    for (let i = 0; i < result.roles.length; i++) {
      const roleId = result.roles[i];
      if (usedRoleIds.has(roleId)) continue;
      const declared = roleStore.get(roleId);
      const displayName = result.roleDisplayNames[i] ?? roleId;
      result.diagnostics.push(
        makeDgmoError(
          declared?.declaredLine ?? 1,
          `Role '${displayName}' is declared but never assigned to any task.`,
          'warning',
          RACI_WARNING_CODES.ORPHAN_ROLE
        )
      );
    }
  }

  return result;
}

// ── Helpers ────────────────────────────────────────────────────

/** Iterate every task — phased and unphased, in source order. */
export function* allTasks(parsed: ParsedRaci): Iterable<RaciTask> {
  for (const t of parsed.tasksWithoutPhase) yield t;
  for (const phase of parsed.phases) {
    for (const t of phase.tasks) yield t;
  }
}
