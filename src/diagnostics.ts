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
  /**
   * Error: a removed sequence participant-type keyword was used in
   * an `is a X` declaration. The 0.16.0 trim retained only
   * `actor`/`database`/`cache`/`queue`; `service`/`frontend`/
   * `networking`/`gateway`/`external` no longer carry semantic
   * weight and emit this error so users drop the override.
   */
  PARTICIPANT_TYPE_REMOVED: 'E_PARTICIPANT_TYPE_REMOVED',
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

/**
 * Canonical message for `E_PARTICIPANT_TYPE_REMOVED`. Emitted when a
 * sequence participant declaration uses a removed type keyword
 * (`service`, `frontend`, `networking`, `gateway`, `external`).
 */
export function participantTypeRemovedMessage(type: string): string {
  return (
    `'${type}' is no longer supported — drop 'is a ${type}'; ` +
    `the participant renders as the default rectangle`
  );
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

export function aliasReservedKeywordMessage(token: string): string {
  return `'${token}' is a reserved keyword and cannot be used as an alias.`;
}

export function aliasInvalidFormatMessage(token: string): string {
  return (
    `Alias '${token}' must match [A-Za-z][A-Za-z0-9_]{0,11} ` +
    `(letter start, letters/digits/underscore, max 12 chars).`
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
   * Error: `|` appears in a position that used to host metadata.
   * The pipe operator was retired in 0.18.0 in favor of the unified
   * same-line / indented metadata grammar. Hint points at the new
   * same-line `key: value, ...` form.
   */
  PIPE_OPERATOR_REMOVED: 'E_PIPE_OPERATOR_REMOVED',
  /**
   * Error: legacy gantt bare-percent `| 100%` task progress syntax.
   * Replaced by the `progress: <N>` key.
   */
  GANTT_BARE_PERCENT_REMOVED: 'E_GANTT_BARE_PERCENT_REMOVED',
  /**
   * Error: legacy journey-map bare-score-prefix `| 4 Delighted`
   * step syntax. Replaced by `score: <N>, emotion: <Word>` keys.
   */
  JOURNEY_BARE_SCORE_REMOVED: 'E_JOURNEY_BARE_SCORE_REMOVED',
  /**
   * Error: legacy pyramid bare-description shorthand `| Some text`
   * after a layer name. Replaced by the `description: <text>` key.
   */
  PYRAMID_BARE_DESCRIPTION_REMOVED: 'E_PYRAMID_BARE_DESCRIPTION_REMOVED',
  /**
   * Error: legacy ring bare-description shorthand `| Some text`
   * after a layer name. Replaced by the `description: <text>` key.
   */
  RING_BARE_DESCRIPTION_REMOVED: 'E_RING_BARE_DESCRIPTION_REMOVED',
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
  /**
   * Warning: an indented attribute line (`key: value` where `key`
   * is in the reserved-key registry) appears at the same indent
   * level as preceding structural children. The attribute attaches
   * to the parent — indent further to attach to the preceding child.
   */
  ATTRIBUTE_AT_PARENT_INDENT: 'W_ATTRIBUTE_AT_PARENT_INDENT',
} as const;

/**
 * Canonical message for `E_PIPE_OPERATOR_REMOVED`. Emitted when a
 * `|` appears in a position that used to host metadata (i.e. outside
 * its surviving uses: wireframe dropdown options, in-arrow label
 * characters per §1.10, quoted name strings).
 */
export function pipeOperatorRemovedMessage(): string {
  return `'|' removed — 'Node | c: red' → 'Node c: red'. Run 'dgmo migrate'`;
}

/**
 * Canonical message for `E_GANTT_BARE_PERCENT_REMOVED`. Emitted
 * when a gantt task uses the legacy `| <N>%` progress shorthand.
 */
export function ganttBarePercentRemovedMessage(percent: string): string {
  return (
    `Bare-percent progress shorthand '| ${percent}' was removed. ` +
    `Use 'progress: ${percent.replace(/%$/, '')}' (integer 0–100, no '%').`
  );
}

/**
 * Canonical message for `E_JOURNEY_BARE_SCORE_REMOVED`. Emitted
 * when a journey-map step uses the legacy `| <N>` or `| <N> <Word>`
 * score shorthand.
 */
export function journeyBareScoreRemovedMessage(args: {
  score: string;
  emotion?: string;
}): string {
  const replacement = args.emotion
    ? `'score: ${args.score}, emotion: ${args.emotion}'`
    : `'score: ${args.score}'`;
  return `Bare-score shorthand after '|' was removed. ` + `Use ${replacement}.`;
}

/**
 * Canonical message for `E_PYRAMID_BARE_DESCRIPTION_REMOVED` /
 * `E_RING_BARE_DESCRIPTION_REMOVED`. Emitted when a pyramid or ring
 * layer uses the legacy `| <text>` description shorthand.
 */
export function bareDescriptionRemovedMessage(args: {
  chartType: 'pyramid' | 'ring';
  text: string;
}): string {
  const quoted = args.text.includes(',') ? `"${args.text}"` : args.text;
  return `'|' description shorthand removed in ${args.chartType} — use 'description: ${quoted}'`;
}

/**
 * Canonical message for `E_TAG_DECLARED_AFTER_CONTENT`.
 */
export function tagDeclaredAfterContentMessage(tagName: string): string {
  return `'tag ${tagName}' must appear before content — move it above diagram lines`;
}

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

/**
 * Canonical message for `W_ATTRIBUTE_AT_PARENT_INDENT`. Emitted
 * when an indented reserved-key attribute appears at the same indent
 * level as preceding structural children.
 */
export function attributeAtParentIndentMessage(key: string): string {
  return (
    `Attribute '${key}:' attaches to the parent above — ` +
    `indent further if you meant it on the preceding structural child.`
  );
}
