import type { DiagnosticSpec } from '../diagnostics';

// ============================================================
// PERT chart diagnostics
// ============================================================
//
// Additive metadata catalog for the PERT parser's coded diagnostics.
// The parser (`src/pert/parser.ts`) still owns emission — these codes are
// passed as inline string literals to `makeDgmoError(line, msg, severity,
// code)` via the local `error()`/`warn()` helpers. This file re-declares
// each code's canonical wording, severity, and a triggering example so the
// catalog stays discoverable without changing the parser.
//
// Every `severity` below reflects the RUNTIME value actually passed to
// makeDgmoError at the emit site (via `error()` → 'error' / `warn()` →
// 'warning'), verified against `src/pert/parser.ts`. All PERT codes'
// runtime severities agree with their `E_`/`W_` prefix.

/** Keyed specs — referenced by the parser's `emit()` call sites. */
export const PERT_DX = {
  BOTH_ANCHORS: {
    code: 'E_PERT_BOTH_ANCHORS',
    severity: 'error', // Runtime: error() @ parser.ts ~1508
    chartType: 'pert',
    title: 'Both start-date and end-date set',
    // Message interpolates an optional `priorRef` suffix referencing the
    // first anchor's kind + line. Builder tolerates `{}` (suffix omitted).
    message: (p) => {
      const kind = p.firstAnchorKey;
      const line = p.firstAnchorLine;
      const priorRef =
        kind && line
          ? ` Conflicts with \`${String(kind)}\` declared on line ${String(line)}.`
          : '';
      return `Specify \`start-date\` or \`end-date\`, not both. Use one anchor — both directives are discarded; re-author one to recover.${priorRef}`;
    },
    hint: 'Pick a single anchor: either `start-date` (forward) or `end-date` (backward).',
    example: 'pert\nstart-date 2026-06-01\nend-date 2026-09-15\nA 1 2 3\n',
  },
  END_DATE_NOW: {
    code: 'E_PERT_END_DATE_NOW',
    severity: 'error', // Runtime: error() @ parser.ts ~1530
    chartType: 'pert',
    title: '`end-date now` not allowed',
    message:
      '`end-date` requires an explicit YYYY-MM-DD; `now` is only valid for `start-date`.',
    hint: 'Give `end-date` a literal date, or use `start-date now` if you want today.',
    example: 'pert\nend-date now\nA 1 2 3\n',
  },
  INVALID_DATE: {
    code: 'E_PERT_INVALID_DATE',
    severity: 'error', // Runtime: error() @ parser.ts ~1519 and ~1545
    chartType: 'pert',
    title: 'Invalid anchor date',
    // Emitted from TWO sites with different wording:
    //  (a) empty value @ ~1519:  "`${key}` requires a full date (YYYY-MM-DD), got '${value}'."
    //  (b) unparseable  @ ~1545:  "Invalid date '${trimmed}' for ${key}. Expected YYYY-MM-DD."
    // The builder reproduces BOTH: pass `empty: true` + `value`/`key` for
    // variant (a); pass `trimmed`/`key` for variant (b). The `{}` default
    // shows variant (b)'s representative wording.
    message: (p) => {
      const key = p.key ?? 'start-date';
      if (p.empty) {
        return `\`${String(key)}\` requires a full date (YYYY-MM-DD), got '${String(p.value ?? '')}'.`;
      }
      const date = p.trimmed ?? p.value;
      return date
        ? `Invalid date '${String(date)}' for ${String(key)}. Expected YYYY-MM-DD.`
        : `Invalid date for ${String(key)}. Expected YYYY-MM-DD.`;
    },
    hint: 'Use a calendar-valid date — ISO (`2026-06-01`), slash (`6/1/2026`), or month-name (`Jun 1, 2026`).',
    example: 'pert\nstart-date 2026-13-99\nA 1 2 3\n',
  },
  NEAR_DIRECTIVE: {
    code: 'E_PERT_NEAR_DIRECTIVE',
    severity: 'error', // Runtime: error() @ parser.ts ~938
    chartType: 'pert',
    title: 'Near-miss directive typo',
    // Interpolates the mistyped head + the suggested canonical directive.
    message: (p) => {
      const head = p.head ?? 'start';
      const canonical = p.canonical ?? 'start-date';
      return `Unknown directive '${String(head)}'. Did you mean '${String(canonical)}'?`;
    },
    hint: 'Use the full directive name (`start-date`, `end-date`, `default-confidence`, `time-unit`).',
    example: 'pert\nstart 2026-06-01\nA 1 2 3\n',
  },
  BD_WITH_ANCHOR: {
    code: 'W_PERT_BD_WITH_ANCHOR',
    severity: 'warning', // Runtime: warn() @ parser.ts ~1024
    chartType: 'pert',
    title: 'Business days with date anchor',
    message:
      '`bd` (business days) is treated as calendar days when `start-date`/`end-date` is set. For business-day scheduling with weekend/holiday awareness, use Gantt.',
    hint: 'Drop the date anchor, or switch to Gantt for weekend/holiday-aware scheduling.',
    example: 'pert\ntime-unit bd\nstart-date 2026-06-01\nA 1 2 3\n',
  },
  SUBDAY_WITH_ANCHOR: {
    code: 'W_PERT_SUBDAY_WITH_ANCHOR',
    severity: 'warning', // Runtime: warn() @ parser.ts ~1030
    chartType: 'pert',
    title: 'Sub-day time-unit with date anchor',
    message:
      "Date display rounds to whole days; sub-day `time-unit` ('h'/'min') will lose precision when `start-date`/`end-date` is set. For honest output use `time-unit d`.",
    hint: 'Use `time-unit d` when anchoring to dates, or remove the anchor.',
    example: 'pert\ntime-unit h\nstart-date 2026-06-01\nA 1 2 3\n',
  },
} satisfies Record<string, DiagnosticSpec>;

export const PERT_DIAGNOSTICS: DiagnosticSpec[] = Object.values(PERT_DX);
