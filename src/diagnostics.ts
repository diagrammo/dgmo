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
 * Canonical message for `E_AKA_REMOVED`. Emitted when a sequence
 * participant declaration uses the removed `aka` keyword.
 */
export function akaRemovedMessage(): string {
  return `'aka' is no longer supported — use the participant name directly`;
}

// ============================================================
// Universal Alias Syntax diagnostic codes (TD-18)
// ============================================================
//
// See `_bmad-output/implementation-artifacts/tech-spec-universal-alias-syntax.md`
// (P2 appendix) for canonical message text. Parsers MUST import
// these factories rather than inlining wording.

export const ALIAS_DIAGNOSTIC_CODES = {
  /** Alias token used before its declaration (strict-ordering rule). */
  ALIAS_BEFORE_DECL: 'E_ALIAS_BEFORE_DECL',
  /** Same alias bound to two different canonicals. */
  ALIAS_COLLISION: 'E_ALIAS_COLLISION',
  /** Alias literal matches an existing canonical name. */
  ALIAS_SHADOWS_NAME: 'E_ALIAS_SHADOWS_NAME',
  /** Same canonical re-declared with a different alias. */
  ALIAS_REBINDING: 'E_ALIAS_REBINDING',
  /** `pm as p` where `pm` is itself an alias — must alias the canonical. */
  ALIAS_OF_ALIAS: 'E_ALIAS_OF_ALIAS',
  /** Alias matches a reserved keyword (`as`, `is`, chart-type tokens, etc.). */
  ALIAS_RESERVED_KEYWORD: 'E_ALIAS_RESERVED_KEYWORD',
  /** `as` matched but token doesn't fit `[A-Za-z][A-Za-z0-9_]{0,11}`. */
  ALIAS_INVALID_FORMAT: 'E_ALIAS_INVALID_FORMAT',
  /** Canonical name was used plainly before its alias declaration. */
  ALIAS_AFTER_CANONICAL: 'E_ALIAS_AFTER_CANONICAL',
  /** Legacy `tag Name x` shorthand encountered — use `tag Name as x`. */
  TAG_SHORTHAND_REMOVED: 'E_TAG_SHORTHAND_REMOVED',
  /** Legacy venn `Name(color) alias X` encountered — use `as`. */
  VENN_ALIAS_KEYWORD_REMOVED: 'E_VENN_ALIAS_KEYWORD_REMOVED',
  /** Reference token differs from a declared alias only in case. */
  ALIAS_CASE_NEAR_MATCH: 'W_ALIAS_CASE_NEAR_MATCH',
  /** Alias declared but referenced ≤1 time. */
  ALIAS_UNDERUSED: 'W_ALIAS_UNDERUSED',
} as const;

export function aliasBeforeDeclMessage(token: string): string {
  return (
    `Alias '${token}' used before declaration. ` +
    `Declare '<canonical> as ${token}' on or above this line.`
  );
}

export function aliasCollisionMessage(args: {
  token: string;
  existingCanonical: string;
  existingLine: number;
  incomingCanonical: string;
}): string {
  return (
    `Alias '${args.token}' is already bound to '${args.existingCanonical}' ` +
    `(line ${args.existingLine}). Cannot rebind to '${args.incomingCanonical}'.`
  );
}

export function aliasShadowsNameMessage(token: string): string {
  return `Alias '${token}' would shadow an existing canonical name. Choose a different alias.`;
}

export function aliasRebindingMessage(args: {
  canonical: string;
  existingAlias: string;
  existingLine: number;
  incomingAlias: string;
}): string {
  return (
    `'${args.canonical}' is already aliased as '${args.existingAlias}' ` +
    `(line ${args.existingLine}). Cannot also alias as '${args.incomingAlias}'.`
  );
}

export function aliasOfAliasMessage(args: {
  token: string;
  canonical: string;
}): string {
  return (
    `'${args.token}' is itself an alias for '${args.canonical}'. ` +
    `Cannot alias an alias — alias the canonical instead.`
  );
}

export function aliasReservedKeywordMessage(token: string): string {
  return `'${token}' is a reserved keyword and cannot be used as an alias.`;
}

export function aliasInvalidFormatMessage(token: string): string {
  return (
    `Alias '${token}' must match [A-Za-z][A-Za-z0-9_]{0,11} ` +
    `(letter start, letters/digits/underscore, max 12 chars).`
  );
}

export function aliasAfterCanonicalMessage(args: {
  canonical: string;
  existingLine: number;
}): string {
  return (
    `'${args.canonical}' was already used as a canonical name (line ${args.existingLine}). ` +
    `Aliases must be declared on or before first use.`
  );
}

export function tagShorthandRemovedMessage(args: {
  name: string;
  alias: string;
}): string {
  return (
    `Bare tag shorthand 'tag ${args.name} ${args.alias}' was removed. ` +
    `Use 'tag ${args.name} as ${args.alias}' instead.`
  );
}

export function vennAliasKeywordRemovedMessage(args: {
  name: string;
  alias: string;
}): string {
  return (
    `Venn 'alias' keyword was removed. ` +
    `Use 'as' instead — '${args.name} as ${args.alias}'.`
  );
}

export function aliasCaseNearMatchMessage(args: {
  reference: string;
  declared: string;
}): string {
  return (
    `'${args.reference}' differs only in case from declared alias '${args.declared}'. ` +
    `Did you mean '${args.declared}'?`
  );
}

export function aliasUnderusedMessage(token: string): string {
  return (
    `Alias '${token}' is declared but referenced ≤1 time. ` +
    `Aliases earn their keep on names that repeat 3+ times.`
  );
}
