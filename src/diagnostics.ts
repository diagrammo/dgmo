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

export function formatDgmoError(err: DgmoError): string {
  return err.line > 0 ? `Line ${err.line}: ${err.message}` : err.message;
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
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
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
  /**
   * Error: a name contains a reserved character (`|`, `:`, edge
   * sigils `-> <- ~> <~ -- ..`, shape brackets `[] () {} <>`,
   * leading/trailing whitespace) without being wrapped in `"..."`.
   */
  NAME_RESERVED_CHAR: 'E_NAME_RESERVED_CHAR',
  /**
   * Error: the removed `aka` keyword was used in a sequence
   * participant declaration. Forgiving normalization makes aliasing
   * unnecessary; the diagnostic directs users to the new syntax.
   */
  AKA_REMOVED: 'E_AKA_REMOVED',
} as const;

export const NAME_DIAGNOSTIC_SEVERITY: Record<
  keyof typeof NAME_DIAGNOSTIC_CODES,
  DgmoSeverity
> = {
  NAME_MERGED: 'warning',
  NAME_RESERVED_CHAR: 'error',
  AKA_REMOVED: 'error',
};

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

/**
 * Canonical message for `E_NAME_RESERVED_CHAR`. The `char` argument
 * is the offending character (`|`, `:`, etc.) — the wording names
 * it explicitly so the diagnostic is actionable.
 */
export function nameReservedCharMessage(char: string): string {
  return `name contains reserved character '${char}' — wrap in "..." to use literally`;
}

/**
 * Canonical message for `E_AKA_REMOVED`. Emitted when a sequence
 * participant declaration uses the removed `aka` keyword.
 */
export function akaRemovedMessage(): string {
  return `'aka' is no longer supported — use the participant name directly`;
}
