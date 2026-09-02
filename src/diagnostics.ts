// ============================================================
// Structured Diagnostic Types
// ============================================================

export type DgmoSeverity = 'error' | 'warning';

export interface DgmoError {
  line: number; // 1-based (0 = no line info)
  column?: number; // optional 1-based column
  message: string; // without "Line N:" prefix
  severity: DgmoSeverity;
  /**
   * Optional stable diagnostic code (e.g. 'E_ARROW_SUBSTRING_IN_LABEL').
   * Additive; pre-existing diagnostics omit this field and existing
   * substring-on-`.message` assertions keep working unchanged.
   */
  code?: string;
  /**
   * Set only when the error was raised in a file OTHER than the one being
   * parsed — today, a file pulled in by an org chart's `import`. Holds that
   * file's path as the import directive wrote it. When present, `line` points
   * at the top-level `import` line that led there, NOT at the offending line,
   * and `fileLine` carries the line within `file`.
   */
  file?: string;
  /** 1-based line within `file`. Only set alongside `file`. */
  fileLine?: number;
  /**
   * The fix, in a sentence, copied from the emitting `DiagnosticSpec`.
   *
   * 🔴 This exists so an EDITOR can show it. Until 2026-09-01 the registry's
   * hints reached `dgmo diagnostics --json` and nothing else: `emit()` copied
   * line, message, severity and code and never read `spec.hint`, so 84
   * sentences saying how to repair each mistake were written, reviewed and
   * then dropped one function before any consumer could render them. Do not
   * "tidy" this away as unused — the app reads it.
   */
  hint?: string;
}

export function makeDgmoError(
  line: number,
  message: string,
  severity: DgmoSeverity = 'error',
  code?: string
): DgmoError {
  return code !== undefined
    ? { line, message, severity, code }
    : { line, message, severity };
}

// ============================================================
// Declarative Diagnostic Registry
// ============================================================
//
// Every coded diagnostic is declared ONCE as a `DiagnosticSpec` — the
// single source of truth for its code, severity, owning chart type,
// canonical wording, and a triggering example. Parsers emit through
// `emit(spec, line, params)` instead of re-typing the code/severity/
// message at each call site, and consumers (the CLI `diagnostics`
// subcommand, the console error-review surface, MCP `validate_diagram`,
// and the spec docs) enumerate the catalog via `listDiagnosticCodes()`
// in `diagnostics-registry.ts`. This keeps parser output and the spec's
// error catalog from drifting.

/** Runtime params passed to `emit()` and forwarded to a message builder. */
export type DiagnosticParams = Record<string, unknown>;

/**
 * Parameter type for a `DiagnosticSpec.message` builder body. Typed loosely
 * (`any`) on purpose: builders are hand-authored interpolation bags keyed by
 * ad-hoc names, and dgmo's tsconfig enables `noPropertyAccessFromIndexSignature`
 * (which forbids `p.name` dot-access on a `Record<string, unknown>`). Using
 * `any` here keeps builder bodies readable (`p.name`) instead of forcing
 * `p['name']` bracket access at every interpolation site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DiagnosticMessageParams = any;

export interface DiagnosticSpec {
  /** Stable diagnostic code, e.g. `'E_MAP_UNKNOWN_PLACE'`. */
  code: string;
  /** Severity — must agree with the `E_`/`W_`/`I_` code prefix. */
  severity: DgmoSeverity;
  /** Owning chart type (`'map'`, `'swimlane'`, …) or `null` for universal/global codes. */
  chartType: string | null;
  /** Short human label for the catalog UI. */
  title: string;
  /**
   * Canonical message wording. A plain string for static messages, or a
   * builder `(params) => string` when the message interpolates runtime
   * values. The builder must tolerate being called with `{}` so the
   * catalog can show a representative message without live params.
   */
  message: string | ((params: DiagnosticMessageParams) => string);
  /** Optional fix guidance shown alongside the message. */
  hint?: string;
  /** Minimal `.dgmo` source that triggers this diagnostic (for docs/console). */
  example?: string;
}

/** Optional extras when emitting (currently just an explicit column). */
export interface EmitOptions {
  column?: number;
}

/**
 * Emit a diagnostic from its `DiagnosticSpec`. The code, severity, and
 * canonical wording all come from the spec — call sites supply only the
 * line and the interpolation params, so the code/severity can never drift
 * out of sync with the declared spec. Replaces the per-parser
 * `push`/`err`/`fail` wrappers that each re-declared this shape.
 */
export function emit(
  spec: DiagnosticSpec,
  line: number,
  params: DiagnosticParams = {},
  opts: EmitOptions = {}
): DgmoError {
  const message =
    typeof spec.message === 'function' ? spec.message(params) : spec.message;
  const err: DgmoError = {
    line,
    message,
    severity: spec.severity,
    code: spec.code,
  };
  if (spec.hint !== undefined) err.hint = spec.hint;
  if (opts.column !== undefined) err.column = opts.column;
  return err;
}

/**
 * Drop exact-duplicate diagnostics, preserving first-seen order. Two
 * diagnostics are "the same" when their line, column, severity, code, and
 * message all match — i.e. the same problem reported more than once (which
 * happens when several validators flag one offending line). Deduping at the
 * parse boundary keeps the signal clean for every consumer: the CLI, the
 * editor, and the MCP `validate_diagram` tool agents rely on.
 */
export function dedupeDiagnostics(diagnostics: DgmoError[]): DgmoError[] {
  const seen = new Set<string>();
  const out: DgmoError[] = [];
  for (const d of diagnostics) {
    const key = `${d.line}\0${d.column ?? ''}\0${d.severity}\0${d.code ?? ''}\0${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export function formatDgmoError(err: DgmoError): string {
  return err.line > 0 ? `Line ${err.line}: ${err.message}` : err.message;
}

/**
 * The fatal-error accumulator every structured parser re-declared identically
 * (Story 111.4): push a fresh error diagnostic, set `result.error`, and return
 * the partial result so callers can `return fail(line, msg)`. Generic over any
 * result carrying `diagnostics` + `error`.
 */
export function makeFail<
  T extends { diagnostics: DgmoError[]; error?: string | null },
>(result: T): (line: number, message: string) => T {
  return (line: number, message: string): T => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };
}

// ============================================================
// "Did you mean?" Suggestions
// ============================================================

/**
 * Simple Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array(n + 1)
    .fill(0)
    .map((_, i) => i);

  for (let i = 1; i <= m; i++) {
    // dp has length n+1, all indices 0..n are valid by construction.
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[n]!;
}

/**
 * Returns a "did you mean 'X'?" suggestion if the input is close to one of the candidates.
 * Returns null if no good match is found.
 * Threshold: distance ≤ max(2, floor(input.length / 3))
 */
export function suggest(
  input: string,
  candidates: readonly string[]
): string | null {
  if (!input || candidates.length === 0) return null;
  const lower = input.toLowerCase();
  const threshold = Math.max(2, Math.floor(lower.length / 3));

  let best: string | null = null;
  let bestDist = Infinity;

  for (const c of candidates) {
    const dist = levenshtein(lower, c.toLowerCase());
    if (dist < bestDist && dist <= threshold && dist > 0) {
      bestDist = dist;
      best = c;
    }
  }

  return best ? `Did you mean '${best}'?` : null;
}

// ============================================================
// Universal Name Handling diagnostic codes
// ============================================================
//
// Stable diagnostic codes + canonical message strings for the
// universal name handling spec. Parsers MUST import these factories
// rather than inlining wording — a single source of truth keeps
// parser output and the spec's error catalog from drifting.
//
// See `docs/dgmo-language-spec.md` § "Universal Name Handling".

export const NAME_DIAGNOSTIC_CODES = {
  /**
   * Warning: two source-distinct names normalized to the same key
   * (case- or whitespace-only difference). The first occurrence wins
   * for display; subsequent occurrences fold into it. Suppressible
   * per-line via `# allow-merge` annotation when intentional.
   *
   * Note: the `I_` prefix is intentionally preserved for stability —
   * callers may have pinned this string. The diagnostic emits at
   * `warning` severity (no `info` severity exists in DgmoError).
   */
  NAME_MERGED: 'I_NAME_MERGED',
} as const;

/**
 * Canonical message for `I_NAME_MERGED`. Emitted when two distinct
 * source labels normalize to the same key AND their displayed forms
 * differ — identical re-declarations are silent.
 *
 * Parsers wrap this with `makeDgmoError(line, msg, 'warning',
 * NAME_DIAGNOSTIC_CODES.NAME_MERGED)`.
 */
export function nameMergedMessage(args: {
  incomingDisplay: string;
  incomingLine: number;
  existingDisplay: string;
  existingLine: number;
}): string {
  return (
    `merged '${args.incomingDisplay}' (line ${args.incomingLine}) into ` +
    `'${args.existingDisplay}' (line ${args.existingLine}) — ` +
    'names differ only in case/whitespace'
  );
}

// ============================================================
// Unified Metadata Grammar diagnostic codes (0.18.0)
// ============================================================
//
// See `docs/dgmo-language-spec.md` §1.4 (Metadata Grammar) and
// `_bmad-output/implementation-artifacts/tech-spec-unified-metadata-no-pipe.md`.
// Parsers MUST import these factories rather than inlining wording —
// the spec's diagnostic catalog (§1.4.4) and parser output must
// not drift.

export const METADATA_DIAGNOSTIC_CODES = {
  /**
   * Error: a `tag` declaration appears after the first non-tag
   * content line. The reserved-key registry is finalized before
   * content-line mode begins; downstream-declared tag aliases
   * cannot retroactively apply to earlier lines.
   */
  TAG_DECLARED_AFTER_CONTENT: 'E_TAG_DECLARED_AFTER_CONTENT',
  /**
   * Warning: a metadata pair has an empty value (`Foo c:`). The
   * pair is dropped from the entity's metadata.
   */
  EMPTY_METADATA_VALUE: 'W_EMPTY_METADATA_VALUE',
} as const;

/**
 * Canonical message for `W_EMPTY_METADATA_VALUE`. Emitted when a
 * `key:` token has no value following the colon.
 */
export function emptyMetadataValueMessage(key: string): string {
  return (
    `Metadata key '${key}:' has no value — the pair is dropped. ` +
    `Provide a value or remove the key.`
  );
}

// ============================================================
// Data-chart `title` directive (decision #48)
// ============================================================

/**
 * The data-chart `title <text>` directive was removed (decision #48): the
 * chart title is line 1 (`bar My Chart`). The directive no longer sets
 * anything — it raises this error. A regular diagnostic, deliberately NOT a
 * resurrected `E_*_REMOVED` guard (#28). Emitted by all three data-chart
 * parsers (`parseChart`, `parseExtendedChart`, `parseVisualization`);
 * gantt's `title` option is a different directive and is unaffected.
 */
export const NEGATIVE_VALUE_DX: DiagnosticSpec = {
  code: 'E_VALUE_NEGATIVE',
  severity: 'error',
  chartType: null,
  title: 'Negative value on a magnitude channel',
  message: (p: DiagnosticMessageParams) =>
    `Negative value ${p.value ?? -300} on "${p.label ?? 'Refunds'}" — ${p.channel ?? "this chart's values"} encode magnitude and can't be negative.`,
  hint: 'Restate the data as positive magnitudes (e.g. "decline %"). If direction matters, use a bar chart — bars support negative values.',
  example: 'pie Budget\nRent 1200\nRefunds -300',
};

/**
 * A first line that ALMOST names a chart type.
 *
 * 🔴 The router does not fail when line 1 is not a known type — it falls
 * through to content inference, which is a supported path: `[A] -> [B]` with no
 * declaration is legal and draws a sequence. The cost is that a TYPO reaches
 * the same place silently. `flowchar Deploy` over `[A] -> [B]` resolved to a
 * `sequence` and the only diagnostic was a warning about the title line, phrased
 * in the vocabulary of a chart the author never chose. Mermaid muscle memory
 * (`graph TD`) behaved the same way.
 *
 * So this says the word was not understood, names what was drawn instead, and
 * offers the correction. It stays a WARNING because the diagram did render and
 * inference may genuinely be what the author wanted.
 */
// cspell:ignore flowchar -- deliberately misspelled: it is the typo this
// diagnostic exists to catch, and it appears in the message and the example.
export const MISTYPED_CHART_TYPE_DX: DiagnosticSpec = {
  code: 'W_CHART_TYPE_INFERRED',
  severity: 'warning',
  chartType: null,
  title: 'First line almost names a chart type',
  message: (p: DiagnosticMessageParams) =>
    `'${p.word ?? 'flowchar'}' is not a chart type, so this was drawn as a ${p.resolved ?? 'sequence'} inferred from its content. ${p.suggestion ?? "Did you mean 'flowchart'?"}`,
  hint: 'Line 1 names the chart type. Correct the spelling, or delete the line if the content really should be inferred.',
  example: 'flowchar Deploy\n[A] -> [B]',
};

export const TITLE_DIRECTIVE_DX: DiagnosticSpec = {
  code: 'E_TITLE_DIRECTIVE',
  severity: 'error',
  chartType: null,
  title: 'title directive on a data chart',
  message:
    'The `title` directive is not supported — the chart title is line 1 — remove the title directive.',
  hint: 'Put the title on the declaration line (`bar My Chart`) and delete the `title` line.',
  example: 'bar Revenue\ntitle Revenue\nQ1 100',
};
